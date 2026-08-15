import assert from "node:assert/strict";
import test from "node:test";
import { A2aError } from "../extensions/a2a/types.ts";
import {
	createMattermostActions as createMattermostActionsImpl,
	createMattermostSource as createMattermostSourceImpl,
	type MattermostApi,
	type MattermostConfig,
	type MattermostPost,
	type MattermostSocket,
	mattermostConfigFromEnv,
	mattermostMentionEvent,
} from "../extensions/sources/mattermost.ts";
import type {
	NativeActivation,
	SourceEvidenceInput,
	SourceTaskActivationSink,
} from "../extensions/task-plane/types.ts";

const config: MattermostConfig = {
	baseUrl: "https://mattermost.example.com",
	token: "token",
	channelIds: new Set(),
};

const actionSink: SourceTaskActivationSink = {
	async accept() {
		throw new Error("unused");
	},
	async continue() {
		throw new Error("unused");
	},
	async taskForLocator() {
		return "task-1";
	},
	async deliver(_input, send) {
		return send();
	},
};

function createMattermostActions(cfg: MattermostConfig, api?: MattermostApi) {
	return createMattermostActionsImpl(cfg, api, actionSink);
}

function createMattermostSource(
	cfg: MattermostConfig,
	socketFactory?: Parameters<typeof createMattermostSourceImpl>[1],
	retryMs?: number,
	api?: MattermostApi,
) {
	return {
		async start(onEvent: (event: { locator?: { key: string } }) => unknown) {
			const sink: SourceTaskActivationSink = {
				async accept(input: NativeActivation) {
					onEvent({ locator: { key: input.nativeLocator.channelLocator as string } });
					return {
						activationId: input.providerEventId,
						taskId: "task-1",
						contextId: input.conversationKey ?? "context",
						disposition: "created",
					};
				},
				async continue() {
					throw new Error("unused");
				},
				async advanceCheckpoint() {},
			};
			return createMattermostSourceImpl(cfg, socketFactory, retryMs, api, sink).start(() => {
				throw new Error("legacy onEvent must not be used");
			});
		},
	};
}

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
	const unhandled = await createMattermostActions(
		config,
		fakeApi({ target, threadContext: context, reactions: null }),
	).read(locator);
	assert.equal(unhandled.handled, false);
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
	await assert.rejects(
		createMattermostActions(
			config,
			fakeApi({ target: { ...target, channel_id: "channel-2" } }),
		).respond(locator, "answer"),
		/does not match/,
	);
	await assert.rejects(
		createMattermostActions(
			{ ...config, channelIds: new Set(["channel-2"]) },
			fakeApi({ target }),
		).read(locator),
		/outside MATTERMOST_CHANNEL_IDS/,
	);
});

test("Mattermost replies preserve thread addressing and report partial success", async () => {
	const target = post("reply-1", "channel-1", "user-1", "target", "root-1");
	const locator = locatorFor(target);
	let input: { channel_id: string; message: string; root_id: string } | undefined;
	const success = await createMattermostActions(
		config,
		fakeApi({
			target,
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
			target,
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

test("Mattermost retains an unaccepted mention and never calls legacy onEvent", async () => {
	const sockets: FakeSocket[] = [];
	let attempts = 0;
	const sink: SourceTaskActivationSink = {
		async accept(input) {
			attempts += 1;
			if (attempts === 1) throw new Error("task store unavailable");
			return {
				activationId: input.providerEventId,
				taskId: "task-1",
				contextId: input.conversationKey ?? "context",
				disposition: "created",
			};
		},
		async continue() {
			throw new Error("unused");
		},
		async advanceCheckpoint() {},
	};
	const source = createMattermostSourceImpl(
		config,
		() => {
			const socket = new FakeSocket();
			sockets.push(socket);
			return socket;
		},
		0,
		fakeApi(),
		sink,
	);
	const stop = await source.start(() => {
		throw new Error("legacy onEvent must not be used");
	});
	try {
		const frame = JSON.stringify(
			postedFrame({
				id: "post-retry",
				channel_id: "channel-1",
				user_id: "user-1",
				message: "untrusted",
			}),
		);
		await waitFor(() => sockets.length === 1);
		sockets[0]?.emit("open", {});
		sockets[0]?.emit("message", { data: JSON.stringify({ status: "OK", seq_reply: 1 }) });
		sockets[0]?.emit("message", { data: frame });
		await waitFor(() => attempts === 2);
		assert.equal(sockets.length, 1);
	} finally {
		await stop();
	}
});

test("Mattermost records a permanent 4xx intake failure and processes the next frame", async () => {
	const sockets: FakeSocket[] = [];
	const accepted: string[] = [];
	const checkpoints: string[] = [];
	const evidence: SourceEvidenceInput[] = [];
	const sink: SourceTaskActivationSink = {
		async accept(input) {
			const postId = input.nativeLocator.postId as string;
			if (postId === "post-invalid") {
				throw new A2aError(400, "INVALID_ARGUMENT", "invalid activation");
			}
			accepted.push(postId);
			return {
				activationId: input.providerEventId,
				taskId: "task-1",
				contextId: input.conversationKey ?? "context",
				disposition: "created",
			};
		},
		async continue() {
			throw new Error("unused");
		},
		async advanceCheckpoint(_principal, _source, checkpoint) {
			checkpoints.push((checkpoint as { postId: string }).postId);
		},
		async recordEvidence(input) {
			evidence.push(input);
		},
	};
	const source = createMattermostSourceImpl(
		config,
		() => {
			const socket = new FakeSocket();
			sockets.push(socket);
			return socket;
		},
		0,
		fakeApi(),
		sink,
	);
	const stop = await source.start(() => {
		throw new Error("legacy onEvent must not be used");
	});
	try {
		await waitFor(() => sockets.length === 1);
		const socket = sockets[0];
		assert.ok(socket);
		socket.emit("open", {});
		socket.emit("message", { data: JSON.stringify({ status: "OK", seq_reply: 1 }) });
		for (const id of ["post-invalid", "post-next"]) {
			socket.emit("message", {
				data: JSON.stringify(
					postedFrame({ id, channel_id: "channel-1", user_id: "user-1", message: "work" }),
				),
			});
		}
		await waitFor(() => accepted.length === 1);
		assert.deepEqual(accepted, ["post-next"]);
		assert.deepEqual(checkpoints, ["post-invalid", "post-next"]);
		assert.equal(evidence.length, 1);
		assert.equal(evidence[0]?.kind, "permanent-invalid-activation");
		assert.deepEqual(evidence[0]?.detail, { postId: "post-invalid" });
	} finally {
		await stop();
	}
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
		reactions?: Array<{ user_id: string; post_id: string; emoji_name: string }> | null;
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
			return options.reactions === undefined ? [] : options.reactions;
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
