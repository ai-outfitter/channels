/**
 * Chatto exact-item mention source and actions.
 *
 * The source consumes the protocol-v2 server projection. It emits locators from
 * pending NotificationItem rows in notifications_replace, rather than the
 * transient RealtimeMentionNotificationEvent, because only the durable
 * notification row contains the notification ID needed for exact handled state.
 */
import { createPromiseClient, type PromiseClient, type Transport } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { WebSocket } from "undici";
import { A2aError } from "../a2a/types.ts";
import { contentDigest, sourceIdentifier } from "../task-plane/source-activation.ts";
import type { SourceTaskActivationSink } from "../task-plane/types.ts";
import { MessageService } from "../vendor/chatto/chatto/api/v1/messages_connect.js";
import { NotificationService } from "../vendor/chatto/chatto/api/v1/notifications_connect.js";
import type { NotificationItem } from "../vendor/chatto/chatto/api/v1/notifications_pb.js";
import type {
	RoomTimelineEvent,
	RoomTimelinePage,
} from "../vendor/chatto/chatto/api/v1/room_timeline_pb.js";
import { RoomService } from "../vendor/chatto/chatto/api/v1/rooms_connect.js";
import { ThreadService } from "../vendor/chatto/chatto/api/v1/threads_connect.js";
import { ViewerService } from "../vendor/chatto/chatto/api/v1/viewer_connect.js";
import {
	RealtimeClientFrame,
	RealtimeClientHello,
	type RealtimeError,
	type RealtimeProjectionEvent,
	type RealtimeProjectionNotificationsReplace,
	RealtimeServerFrame,
	type RealtimeServerHello,
	RealtimeSubscribeEvents,
} from "../vendor/chatto/chatto/realtime/v1/realtime_pb.js";
import type {
	ChannelActions,
	ChannelContextMessage,
	ChannelEvent,
	ChannelReadResult,
	ChannelRespondResult,
	ChannelSource,
} from "./types.ts";
import { parseList, RECONNECT_DELAY_MS, scopedLog, supervise } from "./util.ts";

const log = scopedLog("chatto");
const STRUCTURAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_CONTEXT = 10;
const PROTOCOL_VERSION = 2;
const MAX_LOCATOR_BYTES = 1024;

export interface ChattoConfig {
	baseUrl: string;
	token: string;
	/** Empty means every room visible to the authenticated identity. */
	roomIds: Set<string>;
}

interface ChattoLocator {
	notificationId: string;
	roomId: string;
	messageEventId: string;
	threadRootEventId?: string;
}

export interface ChattoApi {
	viewerId(): Promise<string>;
	getNotification(notificationId: string): Promise<NotificationItem | undefined>;
	getRoomContext(locator: ChattoLocator): Promise<RoomTimelinePage>;
	getThreadContext(
		locator: ChattoLocator & { threadRootEventId: string },
	): Promise<RoomTimelinePage>;
	createReply(locator: ChattoLocator, body: string): Promise<string>;
	dismiss(notificationId: string): Promise<void>;
}

interface ChattoSocketEvent {
	data?: unknown;
	code?: number;
	reason?: string;
}

export interface ChattoSocket {
	binaryType: string;
	addEventListener(type: string, listener: (event: ChattoSocketEvent) => void): void;
	removeEventListener(type: string, listener: (event: ChattoSocketEvent) => void): void;
	send(data: Uint8Array): void;
	close(code?: number, reason?: string): void;
}

export type ChattoSocketFactory = (url: string) => ChattoSocket;

const defaultSocketFactory: ChattoSocketFactory = (url) =>
	new WebSocket(url) as unknown as ChattoSocket;

/** Build complete Chatto config, or undefined when a required value is absent. */
export function chattoConfigFromEnv(): ChattoConfig | undefined {
	const rawBaseUrl = process.env.CHATTO_BASE_URL?.trim();
	const token = process.env.CHATTO_TOKEN?.trim();
	if (!rawBaseUrl || !token) return undefined;

	let url: URL;
	try {
		url = new URL(rawBaseUrl);
	} catch {
		throw new Error("CHATTO_BASE_URL must be an absolute HTTP(S) URL");
	}
	if (
		(url.protocol !== "https:" && url.protocol !== "http:") ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new Error("CHATTO_BASE_URL must be an HTTP(S) origin without credentials or query");
	}
	url.pathname = url.pathname.replace(/\/+$/, "");
	const roomIds = parseStructuralIds("CHATTO_ROOM_IDS", process.env.CHATTO_ROOM_IDS);
	return { baseUrl: url.toString().replace(/\/$/, ""), token, roomIds };
}

export function createChattoActions(
	cfg: ChattoConfig,
	api: ChattoApi | undefined,
	taskSink: SourceTaskActivationSink,
): ChannelActions {
	api ??= createConnectChattoApi(cfg);
	return {
		async read(locator): Promise<ChannelReadResult> {
			const decoded = decodeChattoLocator(locator);
			assertAllowedRoom(decoded, cfg.roomIds);
			const taskForLocator = taskSink.taskForLocator?.bind(taskSink);
			const notification = await api.getNotification(decoded.notificationId);
			if (!notification && !taskForLocator) {
				return {
					channel: "chatto",
					locator,
					handled: true,
					messages: [],
				};
			}
			if (notification) assertMatchingMention(notification, decoded);
			const taskId = taskForLocator ? await taskForLocator("chatto", locator) : undefined;
			const handled =
				taskId && taskSink.taskIsTerminal ? await taskSink.taskIsTerminal(taskId) : false;
			const page = decoded.threadRootEventId
				? await api.getThreadContext({
						...decoded,
						threadRootEventId: decoded.threadRootEventId,
					})
				: await api.getRoomContext(decoded);
			const messages = contextMessages(page, decoded.messageEventId, decoded.threadRootEventId);
			if (!messages.some((message) => message.target)) {
				throw new Error("Chatto did not return the located message");
			}
			return {
				channel: "chatto",
				locator,
				handled,
				messages,
			};
		},

		async respond(locator, response): Promise<ChannelRespondResult> {
			const decoded = decodeChattoLocator(locator);
			assertAllowedRoom(decoded, cfg.roomIds);
			const notification = await api.getNotification(decoded.notificationId);
			if (notification) assertMatchingMention(notification, decoded);
			else if (!taskSink.taskForLocator) throw new Error("Chatto notification is already handled");
			if (!taskSink.taskForLocator || !taskSink.deliver) {
				throw new Error("Chatto task delivery is not configured");
			}
			const activeTaskId = await taskSink.taskForLocator("chatto", locator);
			const responseId = await taskSink.deliver(
				{
					taskId: activeTaskId,
					source: "chatto",
					operationId: `reply:${locator}`,
					payloadDigest: contentDigest(response),
					recovery: "ambiguous",
				},
				() => api.createReply(decoded, response),
			);
			if (!responseId) throw new Error("Chatto returned no response message id");
			const replied = {
				channel: "chatto",
				locator,
				replied: true,
				responseId,
			} as const;
			try {
				await taskSink.deliver(
					{
						taskId: activeTaskId,
						source: "chatto",
						operationId: `dismiss:${decoded.notificationId}`,
						payloadDigest: contentDigest({
							notificationId: decoded.notificationId,
							dismissed: true,
						}),
						recovery: "idempotent",
					},
					async () => {
						await api.dismiss(decoded.notificationId);
						return decoded.notificationId;
					},
				);
				return { ...replied, handled: true };
			} catch (error) {
				return {
					...replied,
					handled: false,
					warning: `Dismissing the notification failed: ${errorMessage(error)}`,
				};
			}
		},
	};
}

export function createChattoSource(
	cfg: ChattoConfig,
	socketFactory: ChattoSocketFactory | undefined,
	retryMs: number | undefined,
	api: ChattoApi | undefined,
	taskSink: SourceTaskActivationSink,
): ChannelSource {
	socketFactory ??= defaultSocketFactory;
	retryMs ??= RECONNECT_DELAY_MS;
	api ??= createConnectChattoApi(cfg);
	let resumeCursor: string | undefined;
	const emittedNotificationIds = new Set<string>();
	return {
		async start() {
			return supervise(
				async (signal) => {
					const viewerId = await api.viewerId();
					const principal = sourceIdentifier("chatto", viewerId);
					const checkpoint = taskSink.checkpoint
						? await taskSink.checkpoint<{ cursor: string }>(principal, "chatto")
						: undefined;
					resumeCursor = checkpoint?.cursor ?? resumeCursor;
					await runChattoAttempt(
						cfg,
						socketFactory,
						signal,
						viewerId,
						resumeCursor,
						async (cursor) => {
							resumeCursor = cursor;
							await taskSink.advanceCheckpoint?.(principal, "chatto", { cursor });
						},
						emittedNotificationIds,
						(event) => acceptChattoEvent(taskSink, principal, api, event),
					);
				},
				log,
				retryMs,
			);
		},
	};
}

async function acceptChattoEvent(
	taskSink: SourceTaskActivationSink,
	principal: string,
	api: ChattoApi,
	event: ChannelEvent,
): Promise<boolean> {
	const locator = event.locator?.key;
	if (!locator) return false;
	const decoded = decodeChattoLocator(locator);
	let acceptance: Awaited<ReturnType<SourceTaskActivationSink["accept"]>>;
	try {
		acceptance = await taskSink.accept({
			principal,
			source: "chatto",
			providerEventId: sourceIdentifier("event", decoded.notificationId),
			providerDedupeKey: sourceIdentifier("event", decoded.notificationId),
			nativeLocator: {
				notificationId: decoded.notificationId,
				roomId: decoded.roomId,
				messageId: decoded.messageEventId,
				threadRootId: decoded.threadRootEventId ?? decoded.messageEventId,
				channelLocator: locator,
			},
			receivedAt: new Date().toISOString(),
			conversationKey: sourceIdentifier(
				"conversation",
				`${decoded.roomId}\0${decoded.threadRootEventId ?? decoded.messageEventId}`,
			),
			parts: [{ data: { channelLocator: locator } }],
			contentDigest: contentDigest(decoded),
		});
	} catch (error) {
		if (!(error instanceof A2aError) || error.reason !== "DUPLICATE_MESSAGE_ID") throw error;
		await recordPermanentChattoProjection(
			taskSink,
			decoded.notificationId,
			"duplicate-notification-payload",
			error,
		);
		return true;
	}
	const dismiss = async (): Promise<string> => {
		try {
			await api.dismiss(decoded.notificationId);
		} catch (error) {
			if (connectErrorCode(error) !== "not_found") throw error;
			await recordPermanentChattoProjection(
				taskSink,
				decoded.notificationId,
				"notification-already-dismissed",
				error,
			);
		}
		return decoded.notificationId;
	};
	if (!taskSink.deliver) throw new Error("Chatto task delivery is not configured");
	await taskSink.deliver(
		{
			taskId: acceptance.taskId,
			source: "chatto",
			operationId: `dismiss:${decoded.notificationId}`,
			payloadDigest: contentDigest({
				notificationId: decoded.notificationId,
				dismissed: true,
			}),
			recovery: "idempotent",
		},
		dismiss,
	);
	return true;
}

async function recordPermanentChattoProjection(
	taskSink: SourceTaskActivationSink,
	notificationId: string,
	reason: string,
	error: unknown,
): Promise<void> {
	await taskSink.recordEvidence?.({
		evidenceId: sourceIdentifier(
			"evidence",
			`${notificationId}\0${reason}\0${errorMessage(error)}`,
		),
		source: "chatto",
		kind: "permanent-projection-error",
		detail: { notificationId, reason, error: errorMessage(error) },
	});
	log(`advancing past permanent projection error for ${notificationId}: ${reason}`);
}

export function mentionNotificationEvent(
	notification: NotificationItem,
	viewerId: string,
	roomIds: ReadonlySet<string>,
): ChannelEvent | undefined {
	if (
		!STRUCTURAL_ID.test(notification.id) ||
		notification.actor?.id === viewerId ||
		notification.kind.case !== "mention"
	) {
		return undefined;
	}
	const mention = notification.kind.value;
	const roomId = mention.room?.id;
	if (
		!roomId ||
		!STRUCTURAL_ID.test(roomId) ||
		!STRUCTURAL_ID.test(mention.eventId) ||
		(roomIds.size > 0 && !roomIds.has(roomId)) ||
		(mention.threadRootEventId && !STRUCTURAL_ID.test(mention.threadRootEventId))
	) {
		return undefined;
	}
	return {
		channel: "chatto",
		summary: "new mention",
		locator: {
			key: encodeChattoLocator({
				notificationId: notification.id,
				roomId,
				messageEventId: mention.eventId,
				...(mention.threadRootEventId ? { threadRootEventId: mention.threadRootEventId } : {}),
			}),
		},
	};
}

async function runChattoAttempt(
	cfg: ChattoConfig,
	socketFactory: ChattoSocketFactory,
	signal: AbortSignal,
	viewerId: string,
	resumeCursor: string | undefined,
	onCursor: (cursor: string) => Promise<void>,
	emittedNotificationIds: Set<string>,
	onEvent: (event: ChannelEvent) => unknown | Promise<unknown>,
): Promise<void> {
	const socket = socketFactory(realtimeUrl(cfg.baseUrl));
	socket.binaryType = "arraybuffer";

	await new Promise<void>((resolve, reject) => {
		let settled = false;
		let heartbeatTimer: NodeJS.Timeout | undefined;
		let frames: Promise<void> = Promise.resolve();
		const state = { subscribed: false, heartbeatMs: 75_000 };

		const finish = (error?: Error): void => {
			if (settled) return;
			settled = true;
			if (heartbeatTimer) clearTimeout(heartbeatTimer);
			signal.removeEventListener("abort", abort);
			socket.removeEventListener("open", open);
			socket.removeEventListener("message", message);
			socket.removeEventListener("close", close);
			socket.removeEventListener("error", socketError);
			if (error) reject(error);
			else resolve();
		};
		const resetHeartbeat = (): void => {
			if (heartbeatTimer) clearTimeout(heartbeatTimer);
			heartbeatTimer = setTimeout(() => {
				socket.close(4000, "heartbeat timeout");
			}, state.heartbeatMs);
		};
		const abort = (): void => {
			socket.close(1000, "shutdown");
			void frames.then(
				() => finish(),
				(error) => finish(error as Error),
			);
		};
		const open = (): void => {
			socket.send(
				new RealtimeClientFrame({
					frame: {
						case: "hello",
						value: new RealtimeClientHello({
							protocolVersion: PROTOCOL_VERSION,
							bearerToken: cfg.token,
						}),
					},
				}).toBinary(),
			);
			resetHeartbeat();
		};
		const message = (event: ChattoSocketEvent): void => {
			frames = frames.then(() =>
				handleChattoMessage(event.data, {
					cfg,
					socket,
					state,
					viewerId,
					resumeCursor,
					onCursor,
					emittedNotificationIds,
					onEvent,
					resetHeartbeat,
				}),
			);
			void frames.catch((error) => {
				socket.close(4002, "invalid frame");
				finish(error instanceof Error ? error : new Error(String(error)));
			});
		};
		const close = (event: ChattoSocketEvent): void => {
			if (signal.aborted || event.code === 1000) {
				void frames.then(
					() => finish(),
					(error) => finish(error as Error),
				);
			} else finish(new Error(`Chatto realtime socket closed (${event.code ?? "unknown"})`));
		};
		const socketError = (): void => {
			finish(new Error("Chatto realtime socket failed"));
		};

		signal.addEventListener("abort", abort, { once: true });
		socket.addEventListener("open", open);
		socket.addEventListener("message", message);
		socket.addEventListener("close", close);
		socket.addEventListener("error", socketError);
		if (signal.aborted) abort();
	});
}

interface ChattoFrameContext {
	cfg: ChattoConfig;
	socket: ChattoSocket;
	state: { subscribed: boolean; heartbeatMs: number };
	viewerId: string;
	resumeCursor: string | undefined;
	onCursor(cursor: string): Promise<void>;
	emittedNotificationIds: Set<string>;
	onEvent(event: ChannelEvent): unknown | Promise<unknown>;
	resetHeartbeat(): void;
}

async function handleChattoMessage(data: unknown, context: ChattoFrameContext): Promise<void> {
	const frame = RealtimeServerFrame.fromBinary(await messageBytes(data));
	context.resetHeartbeat();
	await handleChattoFrame(frame, context);
}

async function handleChattoFrame(
	frame: RealtimeServerFrame,
	context: ChattoFrameContext,
): Promise<void> {
	switch (frame.frame.case) {
		case "hello":
			handleChattoHello(frame.frame.value, context);
			return;
		case "subscribed":
			context.state.subscribed = true;
			return;
		case "projectionEvent":
			await handleChattoProjection(frame.frame.value, context);
			return;
		case "caughtUp":
			if (frame.frame.value.cursor) await context.onCursor(frame.frame.value.cursor);
			return;
		case "error":
			handleChattoError(frame.frame.value);
			return;
		case "close":
			context.socket.close(1000, frame.frame.value.code || "server close");
			return;
		default:
			return;
	}
}

function handleChattoHello(hello: RealtimeServerHello, context: ChattoFrameContext): void {
	if (hello.protocolVersion !== PROTOCOL_VERSION) {
		throw new Error(`Chatto negotiated unsupported realtime protocol ${hello.protocolVersion}`);
	}
	context.state.heartbeatMs = Math.max(30_000, (hello.heartbeatIntervalSeconds || 25) * 3000);
	context.socket.send(
		new RealtimeClientFrame({
			frame: {
				case: "subscribeEvents",
				value: new RealtimeSubscribeEvents({
					...(context.resumeCursor ? { resumeCursor: context.resumeCursor } : {}),
				}),
			},
		}).toBinary(),
	);
}

async function handleChattoProjection(
	projection: RealtimeProjectionEvent,
	context: ChattoFrameContext,
): Promise<void> {
	if (!context.state.subscribed) throw new Error("Chatto projected events before subscription");
	for (const operation of projection.operations) {
		if (operation.operation.case !== "notificationsReplace") continue;
		await handleNotificationReplacement(operation.operation.value, context);
	}
	if (projection.resumeCursor) await context.onCursor(projection.resumeCursor);
}

async function handleNotificationReplacement(
	replacement: RealtimeProjectionNotificationsReplace,
	context: ChattoFrameContext,
): Promise<void> {
	const notifications = replacement.page?.notifications ?? [];
	const currentIds = new Set(notifications.map((notification) => notification.id));
	for (const notification of notifications) {
		if (context.emittedNotificationIds.has(notification.id)) continue;
		const mention = mentionNotificationEvent(notification, context.viewerId, context.cfg.roomIds);
		if (mention && (await context.onEvent(mention)) === false) currentIds.delete(notification.id);
	}
	context.emittedNotificationIds.clear();
	for (const id of currentIds) context.emittedNotificationIds.add(id);
}

function handleChattoError(error: RealtimeError): void {
	if (error.fatal) {
		throw new Error(`Chatto realtime error ${error.code}: ${error.message}`);
	}
	log(`realtime warning ${error.code}: ${error.message}`);
}

function createConnectChattoApi(cfg: ChattoConfig): ChattoApi {
	const transport = chattoTransport(cfg);
	const notifications = createPromiseClient(NotificationService, transport);
	const rooms = createPromiseClient(RoomService, transport);
	const threads = createPromiseClient(ThreadService, transport);
	const messages = createPromiseClient(MessageService, transport);
	const viewer = createPromiseClient(ViewerService, transport);
	return connectApi({ notifications, rooms, threads, messages, viewer });
}

function connectApi(clients: {
	notifications: PromiseClient<typeof NotificationService>;
	rooms: PromiseClient<typeof RoomService>;
	threads: PromiseClient<typeof ThreadService>;
	messages: PromiseClient<typeof MessageService>;
	viewer: PromiseClient<typeof ViewerService>;
}): ChattoApi {
	return {
		async viewerId() {
			const response = await clients.viewer.getViewer({});
			if (!response.user?.profile?.id) {
				throw new Error("Chatto viewer response contained no user id");
			}
			return response.user.profile.id;
		},
		async getNotification(notificationId) {
			try {
				const response = await clients.notifications.getNotification({ notificationId });
				return response.notification;
			} catch (error) {
				if (connectErrorCode(error) === "not_found") return undefined;
				throw error;
			}
		},
		async getRoomContext(locator) {
			const response = await clients.rooms.getRoomEventsAround({
				roomId: locator.roomId,
				eventId: locator.messageEventId,
				limit: MAX_CONTEXT,
			});
			if (!response.page) throw new Error("Chatto returned no room timeline page");
			return response.page;
		},
		async getThreadContext(locator) {
			const response = await clients.threads.getThreadEventsAround({
				roomId: locator.roomId,
				threadRootEventId: locator.threadRootEventId,
				eventId: locator.messageEventId,
				limit: MAX_CONTEXT,
			});
			if (!response.page) throw new Error("Chatto returned no thread timeline page");
			return response.page;
		},
		async createReply(locator, body) {
			const response = await clients.messages.createMessage({
				roomId: locator.roomId,
				body,
				threadRootEventId: locator.threadRootEventId ?? locator.messageEventId,
				inReplyTo: locator.messageEventId,
			});
			if (!response.message?.id) throw new Error("Chatto returned no response message id");
			return response.message.id;
		},
		async dismiss(notificationId) {
			await clients.notifications.dismissNotification({ notificationId });
		},
	};
}

function chattoTransport(cfg: ChattoConfig): Transport {
	return createConnectTransport({
		baseUrl: `${cfg.baseUrl}/api/connect`,
		interceptors: [
			(next) => async (request) => {
				request.header.set("authorization", `Bearer ${cfg.token}`);
				return await next(request);
			},
		],
	});
}

function contextMessages(
	page: RoomTimelinePage,
	targetId: string,
	threadRootId: string | undefined,
): ChannelContextMessage[] {
	const renderable = page.events.filter(
		(
			event,
		): event is RoomTimelineEvent & {
			event: { case: "messagePosted"; value: { message?: { id: string; body?: string } } };
		} => event.event.case === "messagePosted" && Boolean(event.event.value.message),
	);
	const bounded = boundTimeline(renderable, targetId, threadRootId);
	return bounded.map((event) => {
		const user = page.includes?.users[event.actorId];
		return {
			id: event.event.value.message?.id || event.id,
			author: user?.displayName || user?.login || event.actorId || "unknown",
			text: event.event.value.message?.body ?? "",
			target:
				event.id === targetId ||
				event.event.value.message?.id === targetId ||
				event.event.value.message?.echoOfEventId === targetId,
		};
	});
}

function boundTimeline<T extends RoomTimelineEvent>(
	events: T[],
	targetId: string,
	threadRootId: string | undefined,
): T[] {
	const targetIndex = events.findIndex(
		(event) =>
			event.id === targetId ||
			(event.event.case === "messagePosted" &&
				(event.event.value.message?.id === targetId ||
					event.event.value.message?.echoOfEventId === targetId)),
	);
	if (targetIndex < 0) return events.slice(-MAX_CONTEXT);
	const start = Math.max(0, targetIndex - (MAX_CONTEXT - 1));
	const around = events.slice(start, targetIndex + 1);
	if (!threadRootId || around.some((event) => event.id === threadRootId)) return around;
	const root = events.find((event) => event.id === threadRootId);
	return root ? [root, ...around.slice(-(MAX_CONTEXT - 1))] : around;
}

function assertMatchingMention(notification: NotificationItem, locator: ChattoLocator): void {
	if (notification.kind.case !== "mention") {
		throw new Error("Chatto locator no longer identifies a mention notification");
	}
	const mention = notification.kind.value;
	if (
		notification.id !== locator.notificationId ||
		mention.room?.id !== locator.roomId ||
		mention.eventId !== locator.messageEventId ||
		(mention.threadRootEventId || undefined) !== locator.threadRootEventId
	) {
		throw new Error("Chatto notification does not match the channel locator");
	}
}

function assertAllowedRoom(locator: ChattoLocator, roomIds: ReadonlySet<string>): void {
	if (roomIds.size > 0 && !roomIds.has(locator.roomId)) {
		throw new Error("Chatto channel locator is outside CHATTO_ROOM_IDS");
	}
}

function encodeChattoLocator(locator: ChattoLocator): string {
	const payload = {
		n: locator.notificationId,
		r: locator.roomId,
		m: locator.messageEventId,
		...(locator.threadRootEventId ? { t: locator.threadRootEventId } : {}),
	};
	return `chatto:v1:${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

function decodeChattoLocator(locator: string): ChattoLocator {
	const payload = decodeLocatorPayload(locator, "chatto");
	const notificationId = payload.n;
	const roomId = payload.r;
	const messageEventId = payload.m;
	const threadRootEventId = payload.t;
	if (
		typeof notificationId !== "string" ||
		!STRUCTURAL_ID.test(notificationId) ||
		typeof roomId !== "string" ||
		!STRUCTURAL_ID.test(roomId) ||
		typeof messageEventId !== "string" ||
		!STRUCTURAL_ID.test(messageEventId) ||
		(threadRootEventId !== undefined &&
			(typeof threadRootEventId !== "string" || !STRUCTURAL_ID.test(threadRootEventId)))
	) {
		throw new Error("invalid Chatto channel locator");
	}
	return {
		notificationId,
		roomId,
		messageEventId,
		...(threadRootEventId ? { threadRootEventId } : {}),
	};
}

function decodeLocatorPayload(locator: string, channel: string): Record<string, unknown> {
	const [name, version, encoded, extra] = locator.split(":");
	if (
		name !== channel ||
		version !== "v1" ||
		extra !== undefined ||
		!encoded ||
		encoded.length > MAX_LOCATOR_BYTES ||
		!/^[A-Za-z0-9_-]+$/.test(encoded)
	) {
		throw new Error(`invalid ${channel} channel locator`);
	}
	try {
		const bytes = Buffer.from(encoded, "base64url");
		if (bytes.toString("base64url") !== encoded) throw new Error("non-canonical");
		const value: unknown = JSON.parse(bytes.toString("utf8"));
		if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
		return value as Record<string, unknown>;
	} catch {
		throw new Error(`invalid ${channel} channel locator`);
	}
}

function parseStructuralIds(name: string, raw: string | undefined): Set<string> {
	const ids = parseList(raw);
	for (const id of ids) {
		if (!STRUCTURAL_ID.test(id)) throw new Error(`${name} contains an invalid id: ${id}`);
	}
	return new Set(ids);
}

function realtimeUrl(baseUrl: string): string {
	const url = new URL(baseUrl);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/realtime`;
	return url.toString();
}

async function messageBytes(data: unknown): Promise<Uint8Array> {
	if (data instanceof Uint8Array) return data;
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (
		typeof data === "object" &&
		data !== null &&
		"arrayBuffer" in data &&
		typeof data.arrayBuffer === "function"
	) {
		return new Uint8Array(await data.arrayBuffer());
	}
	throw new Error("Chatto realtime delivered a non-binary frame");
}

function connectErrorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
	const code = error.code;
	if (code === 5 || code === "not_found") return "not_found";
	return undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
