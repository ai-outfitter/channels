import assert from "node:assert/strict";
import test from "node:test";
import { A2aError } from "../extensions/a2a/types.ts";
import {
	type ChattoApi,
	type ChattoConfig,
	type ChattoSocket,
	chattoConfigFromEnv,
	createChattoActions,
	createChattoSource,
	mentionNotificationEvent,
} from "../extensions/sources/chatto.ts";
import type { SourceTaskActivationSink } from "../extensions/task-plane/types.ts";
import { Message } from "../extensions/vendor/chatto/chatto/api/v1/message_types_pb.js";
import {
	ListNotificationsResponse,
	MentionNotification,
	NotificationItem,
} from "../extensions/vendor/chatto/chatto/api/v1/notifications_pb.js";
import {
	RoomMessagePosted,
	RoomTimelineEvent,
	RoomTimelineIncludes,
	RoomTimelinePage,
} from "../extensions/vendor/chatto/chatto/api/v1/room_timeline_pb.js";
import { RoomSummary } from "../extensions/vendor/chatto/chatto/api/v1/rooms_pb.js";
import { User } from "../extensions/vendor/chatto/chatto/api/v1/users_pb.js";
import {
	RealtimeCaughtUp,
	RealtimeClientFrame,
	RealtimeProjectionEvent,
	RealtimeProjectionNotificationAction,
	RealtimeProjectionNotificationChange,
	RealtimeProjectionNotificationsReplace,
	RealtimeProjectionOperation,
	RealtimeServerFrame,
	RealtimeServerHello,
	RealtimeSubscribed,
} from "../extensions/vendor/chatto/chatto/realtime/v1/realtime_pb.js";

const config: ChattoConfig = {
	baseUrl: "https://chat.example.com",
	token: "token",
	roomIds: new Set(),
};

test("Chatto configuration requires a clean HTTP origin and validates room ids", () => {
	const prior = envSnapshot("CHATTO_BASE_URL", "CHATTO_TOKEN", "CHATTO_ROOM_IDS");
	try {
		process.env.CHATTO_BASE_URL = "https://chat.example.com/";
		process.env.CHATTO_TOKEN = " token ";
		process.env.CHATTO_ROOM_IDS = "room-1, room_2 room-1";
		assert.deepEqual(chattoConfigFromEnv(), {
			baseUrl: "https://chat.example.com",
			token: "token",
			roomIds: new Set(["room-1", "room_2"]),
		});
		delete process.env.CHATTO_TOKEN;
		assert.equal(chattoConfigFromEnv(), undefined);
		process.env.CHATTO_TOKEN = "token";
		process.env.CHATTO_BASE_URL = "https://user:pass@chat.example.com";
		assert.throws(chattoConfigFromEnv, /without credentials/);
		process.env.CHATTO_BASE_URL = "https://chat.example.com";
		process.env.CHATTO_ROOM_IDS = "room/body";
		assert.throws(chattoConfigFromEnv, /invalid id/);
	} finally {
		restoreSnapshot(prior);
	}
});

test("Chatto notifications emit body-free locators and enforce the room boundary", () => {
	const notification = mention("notification-1", "room-1", "message-1", "user-1");
	Object.assign(notification, { summary: "untrusted body" });
	const event = mentionNotificationEvent(notification, "bot-1", new Set(["room-1"]));
	assert.ok(event?.locator);
	assert.equal(event.summary, "new mention");
	assert.doesNotMatch(event.locator.key, /untrusted|message-1|room-1|notification-1/);
	assert.equal(mentionNotificationEvent(notification, "bot-1", new Set(["room-2"])), undefined);
	assert.equal(mentionNotificationEvent(notification, "user-1", new Set()), undefined);
	const emptyThread = mention("notification-2", "room-1", "message-2", "user-1");
	if (emptyThread.kind.case !== "mention") throw new Error("expected mention");
	emptyThread.kind.value.threadRootEventId = "";
	assert.ok(mentionNotificationEvent(emptyThread, "bot-1", new Set())?.locator);
});

test("Chatto actions validate the notification and return bounded thread context", async () => {
	const notification = mention("notification-1", "room-1", "reply-11", "user-1", "root-1");
	const locator = mentionNotificationEvent(notification, "bot-1", new Set())?.locator?.key;
	assert.ok(locator);
	const page = timeline(
		[
			timelineMessage("root-1", "user-2", "root"),
			...Array.from({ length: 10 }, (_, index) =>
				timelineMessage(`reply-${index + 2}`, "user-1", `reply ${index + 2}`),
			),
		],
		{
			"user-1": new User({ id: "user-1", displayName: "Ada" }),
			"user-2": new User({ id: "user-2", login: "root-author" }),
		},
	);
	const calls: string[] = [];
	const api = fakeApi({
		notification,
		threadPage: page,
		onThread: () => calls.push("thread"),
	});
	const result = await createChattoActions(config, api).read(locator);
	assert.equal(result.handled, false);
	assert.equal(result.messages.length, 10);
	assert.equal(result.messages[0]?.id, "root-1");
	assert.equal(result.messages.at(-1)?.target, true);
	assert.equal(result.messages.at(-1)?.author, "Ada");
	assert.deepEqual(calls, ["thread"]);

	const emptyThread = mention("notification-2", "room-1", "reply-11", "user-1");
	if (emptyThread.kind.case !== "mention") throw new Error("expected mention");
	emptyThread.kind.value.threadRootEventId = "";
	const emptyLocator = mentionNotificationEvent(emptyThread, "bot-1", new Set())?.locator?.key;
	assert.ok(emptyLocator);
	const emptyResult = await createChattoActions(
		config,
		fakeApi({ notification: emptyThread, roomPage: page }),
	).read(emptyLocator);
	assert.equal(emptyResult.handled, false);
});

test("Chatto reads dismissed notifications as handled and rejects mismatched locators", async () => {
	const notification = mention("notification-1", "room-1", "message-1", "user-1");
	const locator = mentionNotificationEvent(notification, "bot-1", new Set())?.locator?.key;
	assert.ok(locator);
	const page = timeline([timelineMessage("message-1", "user-1", "hello")]);
	const handled = await createChattoActions(
		config,
		fakeApi({ notification: undefined, roomPage: page }),
	).read(locator);
	assert.equal(handled.handled, true);
	assert.deepEqual(handled.messages, []);

	const mismatched = mention("notification-1", "room-2", "message-1", "user-1");
	await assert.rejects(
		createChattoActions(config, fakeApi({ notification: mismatched, roomPage: page })).read(
			locator,
		),
		/does not match/,
	);
	await assert.rejects(
		createChattoActions(config, fakeApi()).read("chatto:v1:not-json"),
		/invalid chatto/i,
	);
	await assert.rejects(
		createChattoActions(
			{ ...config, roomIds: new Set(["room-2"]) },
			fakeApi({ notification, roomPage: page }),
		).read(locator),
		/outside CHATTO_ROOM_IDS/,
	);
});

test("Chatto reads and answers a Task after intake dismissed its notification", async () => {
	const notification = mention("notification-1", "room-1", "message-1", "user-1");
	const locator = mentionNotificationEvent(notification, "bot-1", new Set())?.locator?.key;
	assert.ok(locator);
	const replies: string[] = [];
	const api = fakeApi({
		notification,
		roomPage: timeline([timelineMessage("message-1", "user-1", "hello")]),
		onReply: () => replies.push("reply"),
	});
	await api.dismiss("notification-1");
	assert.equal(await api.getNotification("notification-1"), undefined, "dismiss returns NOT_FOUND");
	const sink: SourceTaskActivationSink = {
		async taskIsTerminal(taskId) {
			assert.equal(taskId, "task-1");
			return terminal;
		},
		async accept() {
			throw new Error("unused");
		},
		async continue() {
			throw new Error("unused");
		},
		async taskForLocator(source, key) {
			assert.equal(source, "chatto");
			assert.equal(key, locator);
			return "task-1";
		},
		async deliver(_input, send) {
			return send();
		},
	};
	let terminal = false;
	const actions = createChattoActions(config, api, sink);
	const context = await actions.read(locator);
	assert.equal(context.handled, false);
	assert.equal(context.messages.find((message) => message.target)?.text, "hello");
	terminal = true;
	assert.equal(
		(await actions.read(locator)).handled,
		true,
		"durable terminal Task state is handled",
	);
	assert.equal((await actions.respond(locator, "answer")).responseId, "response-1");
	assert.deepEqual(replies, ["reply"]);
});

test("Chatto replies into the correct thread and preserves partial success", async () => {
	const top = mention("notification-1", "room-1", "message-1", "user-1");
	const topLocator = mentionNotificationEvent(top, "bot-1", new Set())?.locator?.key;
	assert.ok(topLocator);
	let repliedThread = "";
	const success = await createChattoActions(
		config,
		fakeApi({
			notification: top,
			onReply: (locator) => {
				repliedThread = locator.threadRootEventId ?? locator.messageEventId;
			},
		}),
	).respond(topLocator, "answer");
	assert.equal(repliedThread, "message-1");
	assert.deepEqual(success, {
		channel: "chatto",
		locator: topLocator,
		replied: true,
		handled: true,
		responseId: "response-1",
	});

	const threaded = mention("notification-2", "room-1", "reply-2", "user-1", "root-1");
	const threadedLocator = mentionNotificationEvent(threaded, "bot-1", new Set())?.locator?.key;
	assert.ok(threadedLocator);
	let replies = 0;
	const partial = await createChattoActions(
		config,
		fakeApi({
			notification: threaded,
			onReply: (locator) => {
				replies += 1;
				assert.equal(locator.threadRootEventId, "root-1");
			},
			dismissError: new Error("network down"),
		}),
	).respond(threadedLocator, "answer");
	assert.equal(replies, 1);
	assert.equal(partial.replied, true);
	assert.equal(partial.handled, false);
	assert.match(partial.warning ?? "", /network down/);
	await assert.rejects(
		createChattoActions(config, fakeApi({ notification: undefined })).respond(
			topLocator,
			"duplicate",
		),
		/already handled/,
	);
});

test("Chatto source negotiates protocol v2, resumes, filters, and shuts down", async (t) => {
	const sockets: FakeSocket[] = [];
	const events: string[] = [];
	let deliveryAttempts = 0;
	let rejectNextDelivery = true;
	const source = createChattoSource(
		config,
		() => {
			const socket = new FakeSocket();
			sockets.push(socket);
			return socket;
		},
		0,
		fakeApi({ viewer: "bot-1" }),
	);
	const stop = await source.start((event) => {
		deliveryAttempts += 1;
		if (rejectNextDelivery) {
			rejectNextDelivery = false;
			return false;
		}
		if (event.locator) events.push(event.locator.key);
		return true;
	});
	t.after(stop);
	await waitFor(() => sockets.length === 1);
	const first = sockets[0];
	assert.ok(first);
	first.emit("open", {});
	assert.equal(
		RealtimeClientFrame.fromBinary(first.sent[0] ?? new Uint8Array()).frame.case,
		"hello",
	);
	first.emit("message", { data: serverHello() });
	await waitFor(() => first.sent.length >= 2);
	const subscribe = RealtimeClientFrame.fromBinary(first.sent[1] ?? new Uint8Array());
	assert.equal(subscribe.frame.case, "subscribeEvents");
	if (subscribe.frame.case !== "subscribeEvents") throw new Error("expected subscription");
	assert.equal(subscribe.frame.value.resumeCursor, undefined);
	first.emit("message", {
		data: new RealtimeServerFrame({
			frame: { case: "subscribed", value: new RealtimeSubscribed() },
		}).toBinary(),
	});
	first.emit("message", {
		data: notificationProjection(
			"bootstrap-cursor",
			mention("notification-1", "room-1", "message-1", "user-1"),
			false,
		),
	});
	await waitFor(() => deliveryAttempts === 1);
	assert.equal(events.length, 0);
	first.emit("message", {
		data: notificationProjection(
			"cursor-1",
			mention("notification-1", "room-1", "message-1", "user-1"),
		),
	});
	await waitFor(() => events.length === 1);
	assert.equal(deliveryAttempts, 2);
	first.emit("message", {
		data: notificationProjection(
			"cursor-1b",
			mention("notification-1", "room-1", "message-1", "user-1"),
		),
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(events.length, 1);
	assert.equal(deliveryAttempts, 2);
	first.emit("message", {
		data: new RealtimeServerFrame({
			frame: { case: "caughtUp", value: new RealtimeCaughtUp({ cursor: "cursor-2" }) },
		}).toBinary(),
	});
	await new Promise((resolve) => setImmediate(resolve));
	first.emit("close", { code: 1006 });
	await waitFor(() => sockets.length === 2);
	const second = sockets[1];
	assert.ok(second);
	second.emit("open", {});
	second.emit("message", { data: serverHello() });
	await waitFor(() => second.sent.length >= 2);
	const resumed = RealtimeClientFrame.fromBinary(second.sent[1] ?? new Uint8Array());
	if (resumed.frame.case !== "subscribeEvents") throw new Error("expected subscription");
	assert.equal(resumed.frame.value.resumeCursor, "cursor-2");
	second.emit("message", {
		data: new RealtimeServerFrame({
			frame: { case: "subscribed", value: new RealtimeSubscribed() },
		}).toBinary(),
	});
	second.emit("message", {
		data: notificationProjection(
			"cursor-3",
			mention("notification-1", "room-1", "message-1", "user-1"),
			false,
		),
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(events.length, 1);
	await stop();
	assert.equal(second.closed, true);
});

test("Chatto resumes its durable cursor and dismisses only after Task acceptance", async () => {
	const socket = new FakeSocket();
	const order: string[] = [];
	let checkpoint = { cursor: "cursor-old" };
	const sink: SourceTaskActivationSink = {
		async accept(input) {
			order.push(`accept:${input.nativeLocator.notificationId}`);
			return { activationId: "a", taskId: "t", contextId: "c", disposition: "created" };
		},
		async continue() {
			throw new Error("unused");
		},
		async checkpoint<T>() {
			return checkpoint as T;
		},
		async advanceCheckpoint(_principal, _source, value) {
			checkpoint = value as { cursor: string };
			order.push(`checkpoint:${checkpoint.cursor}`);
		},
		async deliver(_input, send) {
			order.push("delivery");
			return send();
		},
	};
	const source = createChattoSource(
		config,
		() => socket,
		1000,
		fakeApi({ viewer: "bot-1", onDismiss: () => order.push("dismiss") }),
		sink,
	);
	const stop = await source.start(() => {});
	await waitFor(() => socket.handlers.has("open"));
	socket.emit("open", {});
	socket.emit("message", { data: serverHello() });
	await waitFor(() => socket.sent.length >= 2);
	const subscribe = RealtimeClientFrame.fromBinary(socket.sent[1] ?? new Uint8Array());
	if (subscribe.frame.case !== "subscribeEvents") throw new Error("expected subscription");
	assert.equal(subscribe.frame.value.resumeCursor, "cursor-old");
	socket.emit("message", {
		data: new RealtimeServerFrame({
			frame: { case: "subscribed", value: new RealtimeSubscribed() },
		}).toBinary(),
	});
	socket.emit("message", {
		data: notificationProjection(
			"cursor-new",
			mention("notification-1", "room-1", "message-1", "user-1"),
		),
	});
	await waitFor(() => checkpoint.cursor === "cursor-new");
	await stop();
	assert.deepEqual(order, [
		"accept:notification-1",
		"delivery",
		"dismiss",
		"checkpoint:cursor-new",
	]);
});

test("Chatto advances past already-dismissed and mutated-duplicate notifications", async () => {
	const socket = new FakeSocket();
	let checkpoint: { cursor: string } | undefined;
	const evidence: Array<{ detail?: Readonly<Record<string, string>> }> = [];
	let accepts = 0;
	const sink: SourceTaskActivationSink = {
		async accept() {
			accepts += 1;
			if (accepts === 2) {
				throw new A2aError(
					409,
					"DUPLICATE_MESSAGE_ID",
					"provider dedupe key was reused with a different activation",
				);
			}
			return { activationId: "a", taskId: "t", contextId: "c", disposition: "created" };
		},
		async continue() {
			throw new Error("unused");
		},
		async checkpoint<T>() {
			return checkpoint as T | undefined;
		},
		async advanceCheckpoint(_principal, _source, value) {
			checkpoint = value as { cursor: string };
		},
		async recordEvidence(input) {
			evidence.push(input);
		},
		async deliver(_input, send) {
			return send();
		},
	};
	const notFound = Object.assign(new Error("notification not found"), { code: 5 });
	const source = createChattoSource(
		config,
		() => socket,
		1000,
		fakeApi({ viewer: "bot-1", dismissError: notFound }),
		sink,
	);
	const stop = await source.start(() => {});
	try {
		await waitFor(() => socket.handlers.has("open"));
		socket.emit("open", {});
		socket.emit("message", { data: serverHello() });
		await waitFor(() => socket.sent.length >= 2);
		socket.emit("message", {
			data: new RealtimeServerFrame({
				frame: { case: "subscribed", value: new RealtimeSubscribed() },
			}).toBinary(),
		});
		socket.emit("message", {
			data: notificationProjection(
				"cursor-dismissed",
				mention("notification-1", "room-1", "message-1", "user-1"),
			),
		});
		await waitFor(() => checkpoint?.cursor === "cursor-dismissed");
		socket.emit("message", {
			data: notificationProjection(
				"cursor-duplicate",
				mention("notification-2", "room-1", "mutated-message", "user-1"),
			),
		});
		await waitFor(() => checkpoint?.cursor === "cursor-duplicate");
		assert.equal(socket.closed, false);
		assert.deepEqual(
			evidence.map((entry) => entry.detail?.reason),
			["notification-already-dismissed", "duplicate-notification-payload"],
		);
	} finally {
		await stop();
	}
});

function mention(
	id: string,
	roomId: string,
	eventId: string,
	actorId: string,
	threadRootEventId?: string,
): NotificationItem {
	return new NotificationItem({
		id,
		actor: new User({ id: actorId }),
		kind: {
			case: "mention",
			value: new MentionNotification({
				room: new RoomSummary({ id: roomId }),
				eventId,
				...(threadRootEventId ? { threadRootEventId } : {}),
			}),
		},
	});
}

function timelineMessage(id: string, actorId: string, body: string): RoomTimelineEvent {
	return new RoomTimelineEvent({
		id,
		actorId,
		event: {
			case: "messagePosted",
			value: new RoomMessagePosted({
				message: new Message({ id, actorId, body }),
			}),
		},
	});
}

function timeline(events: RoomTimelineEvent[], users: Record<string, User> = {}): RoomTimelinePage {
	return new RoomTimelinePage({
		events,
		includes: new RoomTimelineIncludes({ users }),
	});
}

function fakeApi(
	options: {
		viewer?: string;
		notification?: NotificationItem | undefined;
		roomPage?: RoomTimelinePage;
		threadPage?: RoomTimelinePage;
		onThread?: () => void;
		onReply?: (locator: { messageEventId: string; threadRootEventId?: string }) => void;
		onDismiss?: () => void;
		dismissError?: Error;
	} = {},
): ChattoApi {
	let dismissed = false;
	return {
		async viewerId() {
			return options.viewer ?? "bot-1";
		},
		async getNotification() {
			return dismissed ? undefined : options.notification;
		},
		async getRoomContext() {
			return options.roomPage ?? timeline([]);
		},
		async getThreadContext() {
			options.onThread?.();
			return options.threadPage ?? timeline([]);
		},
		async createReply(locator) {
			options.onReply?.(locator);
			return "response-1";
		},
		async dismiss() {
			options.onDismiss?.();
			if (options.dismissError) throw options.dismissError;
			dismissed = true;
		},
	};
}

class FakeSocket implements ChattoSocket {
	binaryType = "blob";
	readonly sent: Uint8Array[] = [];
	readonly handlers = new Map<string, Set<(event: Record<string, unknown>) => void>>();
	closed = false;

	addEventListener(type: string, listener: (event: Record<string, unknown>) => void): void {
		const listeners = this.handlers.get(type) ?? new Set();
		listeners.add(listener);
		this.handlers.set(type, listeners);
	}

	removeEventListener(type: string, listener: (event: Record<string, unknown>) => void): void {
		this.handlers.get(type)?.delete(listener);
	}

	send(data: Uint8Array): void {
		this.sent.push(data);
	}

	close(code = 1000): void {
		this.closed = true;
		queueMicrotask(() => this.emit("close", { code }));
	}

	emit(type: string, event: Record<string, unknown>): void {
		for (const listener of this.handlers.get(type) ?? []) listener(event);
	}
}

function serverHello(): Uint8Array {
	return new RealtimeServerFrame({
		frame: {
			case: "hello",
			value: new RealtimeServerHello({
				protocolVersion: 2,
				heartbeatIntervalSeconds: 25,
			}),
		},
	}).toBinary();
}

function notificationProjection(
	cursor: string,
	notification: NotificationItem,
	live = true,
): Uint8Array {
	return new RealtimeServerFrame({
		frame: {
			case: "projectionEvent",
			value: new RealtimeProjectionEvent({
				resumeCursor: cursor,
				operations: [
					new RealtimeProjectionOperation({
						operation: {
							case: "notificationsReplace",
							value: new RealtimeProjectionNotificationsReplace({
								page: new ListNotificationsResponse({ notifications: [notification] }),
								...(live
									? {
											change: new RealtimeProjectionNotificationChange({
												action: RealtimeProjectionNotificationAction.CREATED,
												notificationId: notification.id,
											}),
										}
									: {}),
							}),
						},
					}),
				],
			}),
		},
	}).toBinary();
}

function envSnapshot(...names: string[]): Map<string, string | undefined> {
	return new Map(names.map((name) => [name, process.env[name]]));
}

function restoreSnapshot(snapshot: ReadonlyMap<string, string | undefined>): void {
	for (const [name, value] of snapshot) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	throw new Error("condition was not met");
}
