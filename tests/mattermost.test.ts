import assert from "node:assert/strict";
import test from "node:test";
import {
	createMattermostActions,
	createMattermostSource,
	type MattermostApi,
	type MattermostConfig,
	type MattermostPost,
	type MattermostSocket,
	mattermostConfigFromEnv,
	mattermostMentionEvent,
} from "../extensions/sources/mattermost.ts";

const config: MattermostConfig = {
	baseUrl: "https://mattermost.example.com",
	token: "token",
	channelIds: new Set(),
};

test("Mattermost configuration validates the URL and channel boundary", () => {
	const prior = snapshot("MATTERMOST_BASE_URL", "MATTERMOST_BOT_TOKEN", "MATTERMOST_CHANNEL_IDS");
	try {
		process.env.MATTERMOST_BASE_URL = "https://mattermost.example.com/";
		process.env.MATTERMOST_BOT_TOKEN = " token ";
		process.env.MATTERMOST_CHANNEL_IDS = "channel-1, channel_2 channel-1";
		assert.deepEqual(mattermostConfigFromEnv(), {
			baseUrl: "https://mattermost.example.com",
			token: "token",
			channelIds: new Set(["channel-1", "channel_2"]),
		});
		delete process.env.MATTERMOST_BOT_TOKEN;
		assert.equal(mattermostConfigFromEnv(), undefined);
		process.env.MATTERMOST_BOT_TOKEN = "token";
		process.env.MATTERMOST_BASE_URL = "file:///tmp/mattermost";
		assert.throws(mattermostConfigFromEnv, /HTTP/);
		process.env.MATTERMOST_BASE_URL = "https://mattermost.example.com";
		process.env.MATTERMOST_CHANNEL_IDS = "not/an/id";
		assert.throws(mattermostConfigFromEnv, /invalid id/);
	} finally {
		restore(prior);
	}
});

test("Mattermost posted events require a recipient-scoped mention and emit no body", () => {
	const raw = postedFrame({
		id: "post-1",
		channel_id: "channel-1",
		user_id: "user-1",
		message: "untrusted body",
	});
	const event = mattermostMentionEvent(raw, "bot-1", new Set(["channel-1"]));
	assert.ok(event?.locator);
	assert.equal(event.summary, "new mention");
	assert.doesNotMatch(event.locator.key, /post-1|channel-1|untrusted/);
	assert.equal(mattermostMentionEvent(raw, "bot-1", new Set(["channel-2"])), undefined);
	assert.equal(
		mattermostMentionEvent(
			postedFrame(JSON.parse(raw.data.post), ["someone-else"]),
			"bot-1",
			new Set(),
		),
		undefined,
	);
	assert.equal(
		mattermostMentionEvent(
			postedFrame({ ...JSON.parse(raw.data.post), user_id: "bot-1" }),
			"bot-1",
			new Set(),
		),
		undefined,
	);
});

test("Mattermost actions read bounded thread context and handled state", async () => {
	const target = post("reply-11", "channel-1", "user-1", "target", "root-1", 11);
	const locator = locatorFor(target);
	const context = [
		post("root-1", "channel-1", "user-2", "root", undefined, 1),
		...Array.from({ length: 10 }, (_, index) =>
			post(`reply-${index + 2}`, "channel-1", "user-1", `reply ${index + 2}`, "root-1", index + 2),
		),
	];
	const api = fakeApi({
		target,
		threadContext: context,
		reactions: [{ user_id: "bot-1", post_id: "reply-11", emoji_name: "white_check_mark" }],
	});
	const result = await createMattermostActions(config, api).read(locator);
	assert.equal(result.handled, true);
	assert.equal(result.messages.length, 10);
	assert.equal(result.messages[0]?.id, "root-1");
	assert.equal(result.messages.at(-1)?.target, true);
});

test("Mattermost actions reject invalid or mismatched locators", async () => {
	await assert.rejects(
		createMattermostActions(config, fakeApi()).read("mattermost:v1:not-json"),
		/invalid Mattermost/,
	);
	const target = post("post-1", "channel-1", "user-1", "target");
	const locator = locatorFor(target);
	await assert.rejects(
		createMattermostActions(
			config,
			fakeApi({ target: { ...target, channel_id: "channel-2" } }),
		).read(locator),
		/does not match/,
	);
});

test("Mattermost replies preserve thread addressing and report partial success", async () => {
	const target = post("reply-1", "channel-1", "user-1", "target", "root-1");
	const locator = locatorFor(target);
	let input: { channel_id: string; message: string; root_id: string } | undefined;
	const success = await createMattermostActions(
		config,
		fakeApi({
			onCreate: (value) => {
				input = value;
			},
		}),
	).respond(locator, "answer");
	assert.deepEqual(input, {
		channel_id: "channel-1",
		message: "answer",
		root_id: "root-1",
	});
	assert.equal(success.handled, true);

	let replies = 0;
	const partial = await createMattermostActions(
		config,
		fakeApi({
			onCreate: () => {
				replies += 1;
			},
			reactionError: new Error("permission denied"),
		}),
	).respond(locator, "answer");
	assert.equal(replies, 1);
	assert.equal(partial.replied, true);
	assert.equal(partial.handled, false);
	assert.match(partial.warning ?? "", /permission denied/);
});

test("Mattermost source authenticates, reconnects, filters, and shuts down", async (t) => {
	const sockets: FakeSocket[] = [];
	const locators: string[] = [];
	const source = createMattermostSource(
		config,
		() => {
			const socket = new FakeSocket();
			sockets.push(socket);
			return socket;
		},
		0,
		fakeApi(),
	);
	const stop = await source.start((event) => {
		if (event.locator) locators.push(event.locator.key);
	});
	t.after(stop);
	await waitFor(() => sockets.length === 1);
	const first = sockets[0];
	assert.ok(first);
	first.emit("open", {});
	const challenge = JSON.parse(first.sent[0] ?? "{}");
	assert.deepEqual(challenge, {
		seq: 1,
		action: "authentication_challenge",
		data: { token: "token" },
	});
	first.emit("message", { data: JSON.stringify({ status: "OK", seq_reply: 1 }) });
	await new Promise((resolve) => setImmediate(resolve));
	first.emit("message", {
		data: JSON.stringify(
			postedFrame({
				id: "post-1",
				channel_id: "channel-1",
				user_id: "user-1",
				message: "untrusted",
			}),
		),
	});
	await waitFor(() => locators.length === 1);
	first.emit("close", { code: 1006 });
	await waitFor(() => sockets.length === 2);
	const second = sockets[1];
	assert.ok(second);
	second.emit("open", {});
	assert.equal(JSON.parse(second.sent[0] ?? "{}").action, "authentication_challenge");
	await stop();
	assert.equal(second.closed, true);
});

function postedFrame(
	value: MattermostPost,
	mentions: string[] = ["bot-1"],
): { event: string; data: { mentions: string; post: string } } {
	return {
		event: "posted",
		data: { mentions: JSON.stringify(mentions), post: JSON.stringify(value) },
	};
}

function post(
	id: string,
	channelId: string,
	userId: string,
	message: string,
	rootId?: string,
	createAt = 1,
): MattermostPost {
	return {
		id,
		channel_id: channelId,
		user_id: userId,
		message,
		create_at: createAt,
		...(rootId ? { root_id: rootId } : {}),
	};
}

function locatorFor(value: MattermostPost): string {
	const event = mattermostMentionEvent(postedFrame(value), "bot-1", new Set());
	assert.ok(event?.locator);
	return event.locator.key;
}

function fakeApi(
	options: {
		target?: MattermostPost;
		channelContext?: MattermostPost[];
		threadContext?: MattermostPost[];
		reactions?: Array<{ user_id: string; post_id: string; emoji_name: string }>;
		onCreate?: (input: { channel_id: string; message: string; root_id: string }) => void;
		reactionError?: Error;
	} = {},
): MattermostApi {
	return {
		async me() {
			return { id: "bot-1" };
		},
		async getPost(postId) {
			return options.target ?? post(postId, "channel-1", "user-1", "target");
		},
		async getChannelContext() {
			return options.channelContext ?? [];
		},
		async getThreadContext() {
			return options.threadContext ?? [];
		},
		async getReactions() {
			return options.reactions ?? [];
		},
		async createPost(input) {
			options.onCreate?.(input);
			return post("response-1", input.channel_id, "bot-1", input.message, input.root_id);
		},
		async addReaction() {
			if (options.reactionError) throw options.reactionError;
		},
	};
}

class FakeSocket implements MattermostSocket {
	readonly sent: string[] = [];
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

	send(data: string): void {
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
