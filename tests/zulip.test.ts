import assert from "node:assert/strict";
import test from "node:test";
import {
	createZulipActions,
	createZulipSource,
	type ZulipApi,
	type ZulipConfig,
	type ZulipMessage,
	zulipConfigFromEnv,
	zulipMentionEvent,
} from "../extensions/sources/zulip.ts";

const config: ZulipConfig = {
	baseUrl: "https://zulip.example.com",
	email: "bot@zulip.example.com",
	apiKey: "secret",
	channelIds: new Set(),
};

test("Zulip configuration validates the organization and channel boundary", () => {
	const prior = snapshot(
		"ZULIP_ORGANIZATION_URL",
		"ZULIP_BOT_EMAIL",
		"ZULIP_API_KEY",
		"ZULIP_CHANNEL_IDS",
	);
	try {
		process.env.ZULIP_ORGANIZATION_URL = "https://zulip.example.com/";
		process.env.ZULIP_BOT_EMAIL = " bot@zulip.example.com ";
		process.env.ZULIP_API_KEY = " secret ";
		process.env.ZULIP_CHANNEL_IDS = "12, 34 12";
		assert.deepEqual(zulipConfigFromEnv(), {
			baseUrl: "https://zulip.example.com",
			email: "bot@zulip.example.com",
			apiKey: "secret",
			channelIds: new Set([12, 34]),
		});
		delete process.env.ZULIP_API_KEY;
		assert.equal(zulipConfigFromEnv(), undefined);
		process.env.ZULIP_API_KEY = "secret";
		process.env.ZULIP_ORGANIZATION_URL = "file:///tmp/zulip";
		assert.throws(zulipConfigFromEnv, /HTTP/);
		process.env.ZULIP_ORGANIZATION_URL = "https://zulip.example.com";
		process.env.ZULIP_CHANNEL_IDS = "not-a-number";
		assert.throws(zulipConfigFromEnv, /invalid channel id/);
	} finally {
		restore(prior);
	}
});

test("Zulip events filter self and channel mentions while direct messages remain eligible", () => {
	const channelEvent = messageEvent(streamMessage(11, 7, "untrusted body"), 1, ["mentioned"]);
	const event = zulipMentionEvent(channelEvent, 99, new Set([7]));
	assert.ok(event?.locator);
	assert.equal(event.summary, "new mention");
	assert.doesNotMatch(event.locator.key, /11|7|untrusted/);
	assert.equal(zulipMentionEvent(channelEvent, 99, new Set([8])), undefined);
	assert.equal(
		zulipMentionEvent(messageEvent(streamMessage(11, 7), 1, []), 99, new Set()),
		undefined,
	);
	assert.equal(
		zulipMentionEvent(messageEvent(streamMessage(11, 7, "self", 99), 1), 99, new Set()),
		undefined,
	);

	const direct = zulipMentionEvent(messageEvent(directMessage(12), 2, []), 99, new Set([8]));
	assert.ok(direct?.locator);
});

test("Zulip actions read bounded topic context and handled state", async () => {
	const target = streamMessage(11, 7, "target");
	target.reactions = [{ user_id: 99, emoji_name: "white_check_mark" }];
	const locator = locatorFor(target);
	const context = Array.from({ length: 11 }, (_, index) =>
		streamMessage(index + 1, 7, `message ${index + 1}`, index % 2 ? 41 : 42),
	);
	const result = await createZulipActions(config, fakeApi({ target, context })).read(locator);
	assert.equal(result.handled, true);
	assert.equal(result.messages.length, 10);
	assert.equal(result.messages[0]?.id, "2");
	assert.equal(result.messages.at(-1)?.target, true);
	assert.equal(result.messages.at(-1)?.text, "target");
});

test("Zulip actions reject invalid and mismatched locators", async () => {
	await assert.rejects(
		createZulipActions(config, fakeApi()).read("zulip:v1:not-json"),
		/invalid Zulip/,
	);
	const target = streamMessage(11, 7);
	await assert.rejects(
		createZulipActions(config, fakeApi({ target: { ...target, stream_id: 8 } })).read(
			locatorFor(target),
		),
		/does not match/,
	);
	await assert.rejects(
		createZulipActions({ ...config, channelIds: new Set([8]) }, fakeApi({ target })).read(
			locatorFor(target),
		),
		/outside ZULIP_CHANNEL_IDS/,
	);
});

test("Zulip replies preserve addressing and report reaction partial success", async () => {
	const streamTarget = streamMessage(11, 7);
	const directTarget = directMessage(12);
	const inputs: Array<{ message: ZulipMessage; botId: number; content: string }> = [];
	const streamResult = await createZulipActions(
		config,
		fakeApi({
			target: streamTarget,
			onReply: (message, botId, content) => inputs.push({ message, botId, content }),
		}),
	).respond(locatorFor(streamTarget), "stream answer");
	assert.equal(streamResult.handled, true);
	assert.deepEqual(inputs[0], { message: streamTarget, botId: 99, content: "stream answer" });

	const alreadyHandled = await createZulipActions(
		config,
		fakeApi({
			target: directTarget,
			onReply: (message, botId, content) => inputs.push({ message, botId, content }),
			reactionError: Object.assign(new Error("already present"), {
				code: "REACTION_ALREADY_EXISTS",
			}),
		}),
	).respond(locatorFor(directTarget), "direct answer");
	assert.equal(alreadyHandled.handled, true);
	assert.deepEqual(inputs[1], {
		message: directTarget,
		botId: 99,
		content: "direct answer",
	});

	const partial = await createZulipActions(
		config,
		fakeApi({
			target: streamTarget,
			reactionError: new Error("permission denied"),
		}),
	).respond(locatorFor(streamTarget), "answer");
	assert.equal(partial.replied, true);
	assert.equal(partial.handled, false);
	assert.match(partial.warning ?? "", /permission denied/);
});

test("Zulip source retries, recreates expired queues, emits mentions, and shuts down", async (t) => {
	let registrations = 0;
	let reads = 0;
	const deleted: string[] = [];
	const locators: string[] = [];
	const api = fakeApi({
		async registerQueue() {
			registrations += 1;
			if (registrations === 1) throw new Error("temporary network failure");
			return { queue_id: `queue-${registrations}`, last_event_id: 0 };
		},
		async getEvents(queueId, _lastEventId, signal) {
			reads += 1;
			if (queueId === "queue-2" && reads === 1) {
				return [messageEvent(streamMessage(11, 7), 1)];
			}
			if (queueId === "queue-2") {
				throw Object.assign(new Error("queue expired"), { code: "BAD_EVENT_QUEUE_ID" });
			}
			return await waitForAbort(signal);
		},
		async deleteQueue(queueId) {
			deleted.push(queueId);
		},
	});
	const source = createZulipSource(config, 0, api);
	const originalError = console.error;
	console.error = () => {};
	const stop = await source.start((event) => {
		if (event.locator) locators.push(event.locator.key);
	});
	t.after(async () => {
		console.error = originalError;
		await stop();
	});
	await waitFor(() => registrations === 3 && locators.length === 1);
	assert.deepEqual(deleted, ["queue-2"]);
	await stop();
	assert.deepEqual(deleted, ["queue-2", "queue-3"]);
	console.error = originalError;
});

function messageEvent(
	message: ZulipMessage,
	id: number,
	flags: string[] = ["mentioned"],
): { id: number; type: string; message: ZulipMessage; flags: string[] } {
	return { id, type: "message", message, flags };
}

function streamMessage(
	id: number,
	streamId: number,
	content = "message",
	senderId = 41,
): ZulipMessage {
	return {
		id,
		type: "stream",
		content,
		sender_id: senderId,
		sender_email: `user-${senderId}@example.com`,
		sender_full_name: `User ${senderId}`,
		stream_id: streamId,
		subject: "agent work",
		display_recipient: "operations",
	};
}

function directMessage(id: number): ZulipMessage {
	return {
		id,
		type: "private",
		content: "direct message",
		sender_id: 41,
		sender_email: "user-41@example.com",
		sender_full_name: "User 41",
		display_recipient: [
			{ id: 41, email: "user-41@example.com", full_name: "User 41" },
			{ id: 99, email: "bot@zulip.example.com", full_name: "Bot" },
		],
	};
}

function locatorFor(message: ZulipMessage): string {
	const event = zulipMentionEvent(messageEvent(message, 1), 99, new Set());
	assert.ok(event?.locator);
	return event.locator.key;
}

function fakeApi(
	options: {
		target?: ZulipMessage;
		context?: ZulipMessage[];
		onReply?: (message: ZulipMessage, botId: number, content: string) => void;
		reactionError?: Error;
		registerQueue?: ZulipApi["registerQueue"];
		getEvents?: ZulipApi["getEvents"];
		deleteQueue?: ZulipApi["deleteQueue"];
	} = {},
): ZulipApi {
	return {
		async me() {
			return { user_id: 99 };
		},
		registerQueue:
			options.registerQueue ??
			(async () => {
				return { queue_id: "queue-1", last_event_id: 0 };
			}),
		getEvents:
			options.getEvents ??
			(async (_queueId, _lastEventId, signal) => {
				return await waitForAbort(signal);
			}),
		deleteQueue: options.deleteQueue ?? (async () => {}),
		async getMessage(messageId) {
			return options.target ?? streamMessage(messageId, 7, "target");
		},
		async getContext() {
			return options.context ?? [];
		},
		async sendReply(message, botId, content) {
			options.onReply?.(message, botId, content);
			return 101;
		},
		async addReaction() {
			if (options.reactionError) throw options.reactionError;
		},
	};
}

async function waitForAbort(signal: AbortSignal): Promise<never> {
	return await new Promise((_, reject) => {
		signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
	});
}

function snapshot(...names: string[]): Map<string, string | undefined> {
	return new Map(names.map((name) => [name, process.env[name]]));
}

function restore(values: ReadonlyMap<string, string | undefined>): void {
	for (const [name, value] of values) {
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
