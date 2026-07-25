/**
 * Zulip exact-item mention source and actions.
 *
 * The source owns a realtime event queue and recreates it when Zulip reports
 * BAD_EVENT_QUEUE_ID. Channel allowlists apply to channel messages only; direct
 * messages stay eligible. Locators contain numeric IDs, never content, topics,
 * channel names, sender names, or recipient addresses.
 */
import type {
	ChannelActions,
	ChannelContextMessage,
	ChannelEvent,
	ChannelReadResult,
	ChannelRespondResult,
	ChannelSource,
} from "./types.ts";
import { parseList, RECONNECT_DELAY_MS, scopedLog, supervise } from "./util.ts";

const log = scopedLog("zulip");
const MAX_CONTEXT = 10;
const DONE_EMOJI = "white_check_mark";
const QUEUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/;

export interface ZulipConfig {
	baseUrl: string;
	email: string;
	apiKey: string;
	/** Empty means every channel visible to the bot account. */
	channelIds: Set<number>;
}

interface ZulipLocator {
	messageId: number;
	channelId?: number;
}

interface ZulipRecipient {
	id: number;
	email: string;
	full_name?: string;
}

interface ZulipReaction {
	user_id: number;
	emoji_name: string;
}

export interface ZulipMessage {
	id: number;
	type: "stream" | "private" | "channel" | "direct";
	content: string;
	sender_id: number;
	sender_email: string;
	sender_full_name?: string;
	stream_id?: number;
	subject?: string;
	display_recipient: string | ZulipRecipient[];
	flags?: string[];
	reactions?: ZulipReaction[];
}

interface ZulipEvent {
	id: number;
	type: string;
	message?: ZulipMessage;
}

interface ZulipQueue {
	queue_id: string;
	last_event_id: number;
	event_queue_longpoll_timeout_seconds?: number;
}

export interface ZulipApi {
	me(): Promise<{ user_id: number }>;
	registerQueue(): Promise<ZulipQueue>;
	getEvents(queueId: string, lastEventId: number, signal: AbortSignal): Promise<ZulipEvent[]>;
	deleteQueue(queueId: string): Promise<void>;
	getMessage(messageId: number): Promise<ZulipMessage>;
	getContext(message: ZulipMessage, botId: number): Promise<ZulipMessage[]>;
	sendReply(message: ZulipMessage, botId: number, content: string): Promise<number>;
	addReaction(messageId: number): Promise<void>;
}

export function zulipConfigFromEnv(): ZulipConfig | undefined {
	const rawBaseUrl = process.env.ZULIP_ORGANIZATION_URL?.trim();
	const email = process.env.ZULIP_BOT_EMAIL?.trim();
	const apiKey = process.env.ZULIP_API_KEY?.trim();
	if (!rawBaseUrl || !email || !apiKey) return undefined;
	if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
		throw new Error("ZULIP_BOT_EMAIL must be a valid email address");
	}
	const baseUrl = parseBaseUrl(rawBaseUrl);
	const channelIds = parseChannelIds(process.env.ZULIP_CHANNEL_IDS);
	return { baseUrl, email, apiKey, channelIds };
}

export function createZulipActions(
	cfg: ZulipConfig,
	api: ZulipApi = createZulipApi(cfg),
): ChannelActions {
	let botId: Promise<number> | undefined;
	const getBotId = (): Promise<number> => {
		botId ??= api
			.me()
			.then((user) => {
				if (!isPositiveInteger(user.user_id)) throw new Error("Zulip returned an invalid bot id");
				return user.user_id;
			})
			.catch((error) => {
				botId = undefined;
				throw error;
			});
		return botId;
	};

	return {
		async read(locator): Promise<ChannelReadResult> {
			const decoded = decodeZulipLocator(locator);
			const [message, ownId] = await Promise.all([api.getMessage(decoded.messageId), getBotId()]);
			assertMatchingMessage(message, decoded);
			const context = boundedMessages(await api.getContext(message, ownId), message);
			return {
				channel: "zulip",
				locator,
				handled: Boolean(
					message.reactions?.some(
						(reaction) => reaction.user_id === ownId && reaction.emoji_name === DONE_EMOJI,
					),
				),
				messages: context.map((item) => contextMessage(item, decoded.messageId)),
			};
		},

		async respond(locator, response): Promise<ChannelRespondResult> {
			const decoded = decodeZulipLocator(locator);
			const [message, ownId] = await Promise.all([api.getMessage(decoded.messageId), getBotId()]);
			assertMatchingMessage(message, decoded);
			const responseId = await api.sendReply(message, ownId, response);
			if (!isPositiveInteger(responseId)) throw new Error("Zulip returned no response message id");
			const replied = {
				channel: "zulip",
				locator,
				replied: true,
				responseId: String(responseId),
			} as const;
			try {
				await api.addReaction(decoded.messageId);
				return { ...replied, handled: true };
			} catch (error) {
				if (zulipErrorCode(error) === "REACTION_ALREADY_EXISTS") {
					return { ...replied, handled: true };
				}
				return {
					...replied,
					handled: false,
					warning: `Adding the handled reaction failed: ${errorMessage(error)}`,
				};
			}
		},
	};
}

export function createZulipSource(
	cfg: ZulipConfig,
	retryMs: number = RECONNECT_DELAY_MS,
	api: ZulipApi = createZulipApi(cfg),
): ChannelSource {
	return {
		async start(onEvent) {
			return supervise(
				async (signal) => {
					const user = await api.me();
					if (!isPositiveInteger(user.user_id)) throw new Error("Zulip returned an invalid bot id");
					await runZulipQueue(cfg, api, signal, user.user_id, onEvent);
				},
				log,
				retryMs,
			);
		},
	};
}

export function zulipMentionEvent(
	raw: unknown,
	botId: number,
	channelIds: ReadonlySet<number>,
): ChannelEvent | undefined {
	if (!isRecord(raw) || raw.type !== "message" || !isRecord(raw.message)) return undefined;
	const message = raw.message as unknown as ZulipMessage;
	if (
		!isPositiveInteger(message.id) ||
		!isPositiveInteger(message.sender_id) ||
		message.sender_id === botId
	) {
		return undefined;
	}
	const direct = message.type === "private" || message.type === "direct";
	const channel = message.type === "stream" || message.type === "channel";
	if (!direct && !channel) return undefined;
	if (
		channel &&
		(!isPositiveInteger(message.stream_id) ||
			(channelIds.size > 0 && !channelIds.has(message.stream_id)) ||
			!message.flags?.includes("mentioned"))
	) {
		return undefined;
	}
	return {
		channel: "zulip",
		summary: "new mention",
		locator: {
			key: encodeZulipLocator({
				messageId: message.id,
				...(channel && message.stream_id ? { channelId: message.stream_id } : {}),
			}),
		},
	};
}

async function runZulipQueue(
	cfg: ZulipConfig,
	api: ZulipApi,
	signal: AbortSignal,
	botId: number,
	onEvent: (event: ChannelEvent) => void,
): Promise<void> {
	let queue: ZulipQueue | undefined;
	try {
		queue = await api.registerQueue();
		if (!QUEUE_ID.test(queue.queue_id) || !Number.isSafeInteger(queue.last_event_id)) {
			throw new Error("Zulip returned invalid event queue metadata");
		}
		await consumeZulipEvents(cfg, api, queue, signal, botId, onEvent);
	} finally {
		if (queue) await deleteZulipQueue(api, queue.queue_id);
	}
}

async function consumeZulipEvents(
	cfg: ZulipConfig,
	api: ZulipApi,
	queue: ZulipQueue,
	signal: AbortSignal,
	botId: number,
	onEvent: (event: ChannelEvent) => void,
): Promise<void> {
	let lastEventId = queue.last_event_id;
	while (!signal.aborted) {
		let events: ZulipEvent[];
		try {
			events = await api.getEvents(queue.queue_id, lastEventId, signal);
		} catch (error) {
			if (signal.aborted || zulipErrorCode(error) === "BAD_EVENT_QUEUE_ID") return;
			throw error;
		}
		for (const event of events) {
			if (Number.isSafeInteger(event.id) && event.id > lastEventId) lastEventId = event.id;
			emitZulipMention(event, botId, cfg.channelIds, onEvent);
		}
	}
}

function emitZulipMention(
	event: ZulipEvent,
	botId: number,
	channelIds: ReadonlySet<number>,
	onEvent: (event: ChannelEvent) => void,
): void {
	const mention = zulipMentionEvent(event, botId, channelIds);
	if (mention) onEvent(mention);
}

async function deleteZulipQueue(api: ZulipApi, queueId: string): Promise<void> {
	try {
		await api.deleteQueue(queueId);
	} catch (error) {
		if (zulipErrorCode(error) !== "BAD_EVENT_QUEUE_ID") {
			log(`deleting event queue failed: ${errorMessage(error)}`);
		}
	}
}

function createZulipApi(cfg: ZulipConfig, fetchImpl: typeof fetch = fetch): ZulipApi {
	const request = async <T>(
		path: string,
		options: {
			method?: string;
			query?: URLSearchParams;
			form?: URLSearchParams;
			signal?: AbortSignal;
		} = {},
	): Promise<T> => {
		const query = options.query?.toString();
		const response = await fetchImpl(`${cfg.baseUrl}/api/v1${path}${query ? `?${query}` : ""}`, {
			...(options.method ? { method: options.method } : {}),
			...(options.signal ? { signal: options.signal } : {}),
			...(options.form ? { body: options.form.toString() } : {}),
			headers: {
				accept: "application/json",
				authorization: `Basic ${Buffer.from(`${cfg.email}:${cfg.apiKey}`).toString("base64")}`,
				...(options.form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
			},
		});
		return await parseZulipResponse<T>(response);
	};
	const messageQuery = (message: ZulipMessage, botId: number): URLSearchParams => {
		const narrow = isChannelMessage(message)
			? [
					{ operator: "channel", operand: message.stream_id },
					{ operator: "topic", operand: message.subject ?? "" },
				]
			: [
					{
						operator: "dm",
						operand: directRecipients(message, botId).map((recipient) => recipient.id),
					},
				];
		return params({
			anchor: message.id,
			num_before: MAX_CONTEXT - 1,
			num_after: 0,
			apply_markdown: false,
			allow_empty_topic_name: true,
			narrow: JSON.stringify(narrow),
		});
	};
	return {
		async me() {
			return await request("/users/me");
		},
		async registerQueue() {
			return await request("/register", {
				method: "POST",
				form: params({
					event_types: JSON.stringify(["message"]),
					apply_markdown: false,
					client_capabilities: JSON.stringify({ empty_topic_name: true }),
				}),
			});
		},
		async getEvents(queueId, lastEventId, signal) {
			const response = await request<{ events: ZulipEvent[] }>("/events", {
				query: params({ queue_id: queueId, last_event_id: lastEventId }),
				signal,
			});
			return response.events;
		},
		async deleteQueue(queueId) {
			await request("/events", {
				method: "DELETE",
				form: params({ queue_id: queueId }),
			});
		},
		async getMessage(messageId) {
			const response = await request<{ message: ZulipMessage }>(`/messages/${messageId}`, {
				query: params({ apply_markdown: false }),
			});
			return response.message;
		},
		async getContext(message, botId) {
			const response = await request<{ messages: ZulipMessage[] }>("/messages", {
				query: messageQuery(message, botId),
			});
			return response.messages;
		},
		async sendReply(message, botId, content) {
			const form = isChannelMessage(message)
				? params({
						type: "stream",
						to: message.stream_id,
						topic: message.subject ?? "",
						content,
					})
				: params({
						type: "direct",
						to: JSON.stringify(directRecipients(message, botId).map((recipient) => recipient.id)),
						content,
					});
			const response = await request<{ id: number }>("/messages", {
				method: "POST",
				form,
			});
			return response.id;
		},
		async addReaction(messageId) {
			await request(`/messages/${messageId}/reactions`, {
				method: "POST",
				form: params({ emoji_name: DONE_EMOJI }),
			});
		},
	};
}

async function parseZulipResponse<T>(response: Response): Promise<T> {
	const body = await response.text();
	let parsed: unknown;
	try {
		parsed = body ? JSON.parse(body) : {};
	} catch {
		throw new ZulipHttpError(response.status, undefined, body || response.statusText);
	}
	const code = isRecord(parsed) && typeof parsed.code === "string" ? parsed.code : undefined;
	if (!response.ok || (isRecord(parsed) && parsed.result === "error")) {
		const message =
			isRecord(parsed) && typeof parsed.msg === "string" ? parsed.msg : body || response.statusText;
		throw new ZulipHttpError(response.status, code, message);
	}
	return parsed as T;
}

class ZulipHttpError extends Error {
	readonly status: number;
	readonly code: string | undefined;

	constructor(status: number, code: string | undefined, message: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

function boundedMessages(context: ZulipMessage[], target: ZulipMessage): ZulipMessage[] {
	const unique = new Map(context.map((message) => [message.id, message]));
	unique.set(target.id, target);
	const ordered = [...unique.values()].sort((left, right) => left.id - right.id);
	const targetIndex = ordered.findIndex((message) => message.id === target.id);
	return ordered.slice(0, targetIndex + 1).slice(-MAX_CONTEXT);
}

function contextMessage(message: ZulipMessage, targetId: number): ChannelContextMessage {
	return {
		id: String(message.id),
		author: message.sender_full_name || message.sender_email || String(message.sender_id),
		text: message.content,
		target: message.id === targetId,
	};
}

function assertMatchingMessage(message: ZulipMessage, locator: ZulipLocator): void {
	const channelId = isChannelMessage(message) ? message.stream_id : undefined;
	if (message.id !== locator.messageId || channelId !== locator.channelId) {
		throw new Error("Zulip message does not match the channel locator");
	}
}

function isChannelMessage(
	message: ZulipMessage,
): message is ZulipMessage & { stream_id: number; display_recipient: string } {
	return (
		(message.type === "stream" || message.type === "channel") &&
		isPositiveInteger(message.stream_id) &&
		typeof message.display_recipient === "string"
	);
}

function directRecipients(message: ZulipMessage, botId: number): ZulipRecipient[] {
	if (!Array.isArray(message.display_recipient)) {
		throw new Error("Zulip direct message contained invalid recipients");
	}
	const recipients = message.display_recipient.filter(
		(recipient) => isPositiveInteger(recipient.id) && recipient.id !== botId,
	);
	if (recipients.length === 0) throw new Error("Zulip direct message has no reply recipients");
	return recipients;
}

function encodeZulipLocator(locator: ZulipLocator): string {
	const payload = {
		m: locator.messageId,
		...(locator.channelId ? { c: locator.channelId } : {}),
	};
	return `zulip:v1:${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

function decodeZulipLocator(locator: string): ZulipLocator {
	const [channel, version, encoded, extra] = locator.split(":");
	if (
		channel !== "zulip" ||
		version !== "v1" ||
		extra !== undefined ||
		!encoded ||
		encoded.length > 256 ||
		!/^[A-Za-z0-9_-]+$/.test(encoded)
	) {
		throw new Error("invalid Zulip channel locator");
	}
	let value: unknown;
	try {
		const bytes = Buffer.from(encoded, "base64url");
		if (bytes.toString("base64url") !== encoded) throw new Error();
		value = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error("invalid Zulip channel locator");
	}
	if (!isRecord(value)) throw new Error("invalid Zulip channel locator");
	const messageId = value.m;
	const channelId = value.c;
	if (!isPositiveInteger(messageId) || (channelId !== undefined && !isPositiveInteger(channelId))) {
		throw new Error("invalid Zulip channel locator");
	}
	return { messageId, ...(channelId ? { channelId } : {}) };
}

function params(values: Record<string, string | number | boolean>): URLSearchParams {
	const result = new URLSearchParams();
	for (const [name, value] of Object.entries(values)) result.set(name, String(value));
	return result;
}

function parseBaseUrl(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error("ZULIP_ORGANIZATION_URL must be an absolute HTTP(S) URL");
	}
	if (
		(url.protocol !== "https:" && url.protocol !== "http:") ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new Error(
			"ZULIP_ORGANIZATION_URL must be an HTTP(S) origin without credentials or query",
		);
	}
	url.pathname = url.pathname.replace(/\/+$/, "");
	return url.toString().replace(/\/$/, "");
}

function parseChannelIds(raw: string | undefined): Set<number> {
	const result = new Set<number>();
	for (const value of parseList(raw)) {
		const parsed = Number(value);
		if (!isPositiveInteger(parsed) || String(parsed) !== value) {
			throw new Error(`ZULIP_CHANNEL_IDS contains an invalid channel id: ${value}`);
		}
		result.add(parsed);
	}
	return result;
}

function zulipErrorCode(error: unknown): string | undefined {
	if (error instanceof ZulipHttpError) return error.code;
	if (!isRecord(error)) return undefined;
	return typeof error.code === "string" ? error.code : undefined;
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
