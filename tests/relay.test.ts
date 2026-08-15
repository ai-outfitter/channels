import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocket } from "undici";
import { AgentSessionJournal } from "../extensions/agent/journal.ts";
import { RelayAgentTransport } from "../extensions/agent/relay.ts";
import { type RelayCredential, startRelayServer } from "../extensions/relay/server.ts";
import { RelayStore } from "../extensions/relay/store.ts";

interface Frame {
	readonly type: string;
	readonly [key: string]: unknown;
}

class TestClient {
	readonly socket: WebSocket;
	readonly #frames: Frame[] = [];
	readonly #waiters: Array<{
		predicate(frame: Frame): boolean;
		resolve(frame: Frame): void;
	}> = [];

	private constructor(socket: WebSocket) {
		this.socket = socket;
		socket.addEventListener("message", (event) => {
			const frame = JSON.parse(String(event.data)) as Frame;
			const waiterIndex = this.#waiters.findIndex((waiter) => waiter.predicate(frame));
			const waiter = waiterIndex >= 0 ? this.#waiters.splice(waiterIndex, 1)[0] : undefined;
			if (waiter) waiter.resolve(frame);
			else this.#frames.push(frame);
		});
	}

	static async open(url: string): Promise<TestClient> {
		const socket = new WebSocket(url);
		await new Promise<void>((resolve, reject) => {
			socket.addEventListener("open", () => resolve(), { once: true });
			socket.addEventListener("error", () => reject(new Error("websocket failed")), {
				once: true,
			});
		});
		return new TestClient(socket);
	}

	send(frame: Frame): void {
		this.socket.send(JSON.stringify(frame));
	}

	next(predicate: (frame: Frame) => boolean): Promise<Frame> {
		const index = this.#frames.findIndex(predicate);
		const existing = index >= 0 ? this.#frames.splice(index, 1)[0] : undefined;
		if (existing) return Promise.resolve(existing);
		return new Promise((resolve) => {
			this.#waiters.push({ predicate, resolve });
		});
	}

	async expectNone(predicate: (frame: Frame) => boolean, durationMs = 50): Promise<void> {
		const existing = this.#frames.find(predicate);
		if (existing) throw new Error(`unexpected frame: ${JSON.stringify(existing)}`);
		await new Promise<void>((resolve, reject) => {
			const waiter = {
				predicate,
				resolve(frame: Frame) {
					reject(new Error(`unexpected frame: ${JSON.stringify(frame)}`));
				},
			};
			this.#waiters.push(waiter);
			setTimeout(() => {
				const index = this.#waiters.indexOf(waiter);
				if (index >= 0) this.#waiters.splice(index, 1);
				resolve();
			}, durationMs);
		});
	}

	async authenticate(
		token: string,
		endpoint: string,
		principal: string,
		cursor = 0,
	): Promise<Frame> {
		this.send({
			type: "authenticate",
			version: 1,
			token,
			endpoint,
			principal,
			cursor,
		});
		return this.next((frame) => frame.type === "authenticated" || frame.type === "error");
	}

	close(): void {
		this.socket.close();
	}
}

const CREDENTIALS: readonly RelayCredential[] = [
	{
		token: "alice-secret",
		principal: "operator:alice",
		register: ["alice-web"],
		send: ["bob-agent"],
		list: ["bob-agent"],
	},
	{
		token: "bob-secret",
		principal: "agent:bob",
		register: ["bob-agent"],
		send: ["alice-web"],
		list: ["alice-web"],
	},
];

test("relay requires TLS outside explicit loopback development", async () => {
	await assert.rejects(
		startRelayServer({
			host: "0.0.0.0",
			port: 0,
			storePath: "/tmp/not-created-relay-test.json",
			credentials: CREDENTIALS,
			allowInsecureLoopback: true,
		}),
		/TLS is required/,
	);
});

test("relay store durably queues only unacked bodies and keeps body-free retry metadata", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-relay-store-"));
	const path = join(root, "relay.json");
	const store = new RelayStore(path);
	try {
		const accepted = await store.accept("alice-web", {
			id: "compact-me",
			recipient: "bob-agent",
			conversationId: "delivery-only",
			body: "body removed after ack",
		});
		assert.match(await readFile(path, "utf8"), /body removed after ack/);
		await Promise.all([store.ready(), store.acknowledge("bob-agent", accepted.cursor)]);
		const persisted = await readFile(path, "utf8");
		assert.doesNotMatch(persisted, /body removed after ack/);
		assert.equal((await store.pending("bob-agent", 0)).length, 0);
		const duplicate = await store.accept("alice-web", {
			id: "compact-me",
			recipient: "bob-agent",
			conversationId: "delivery-only",
			body: "body removed after ack",
		});
		assert.equal(duplicate.duplicate, true);
		assert.equal(duplicate.queued, false);
		assert.equal(duplicate.message.createdAt, accepted.message.createdAt);
	} finally {
		store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("relay authenticates routes, persists offline messages, resumes cursors, and redacts logs", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-relay-test-"));
	const logs: Array<Readonly<Record<string, unknown>>> = [];
	const storePath = join(root, "relay.json");
	let relay = await startRelayServer({
		host: "127.0.0.1",
		port: 0,
		storePath,
		credentials: CREDENTIALS,
		allowInsecureLoopback: true,
		heartbeatMs: 10_000,
		logger: (record) => logs.push(record),
	});
	try {
		const healthUrl = relay.url.replace(/^ws:/, "http:").replace("/v1/connect", "/healthz");
		const readyUrl = relay.url.replace(/^ws:/, "http:").replace("/v1/connect", "/readyz");
		assert.equal((await fetch(healthUrl)).status, 200);
		assert.equal((await fetch(readyUrl)).status, 200);

		const rejected = await TestClient.open(relay.url);
		const rejection = await rejected.authenticate("wrong-secret", "alice-web", "operator:alice");
		assert.equal(rejection.type, "error");
		assert.equal(rejection.code, "authentication_failed");

		const alice = await TestClient.open(relay.url);
		assert.equal(
			(await alice.authenticate("alice-secret", "alice-web", "operator:alice")).type,
			"authenticated",
		);
		alice.send({ type: "list", requestId: "list-1" });
		const endpoints = await alice.next((frame) => frame.requestId === "list-1");
		assert.deepEqual(
			(endpoints.endpoints as Array<{ id: string }>).map((endpoint) => endpoint.id),
			["alice-web", "bob-agent"],
		);

		alice.send({
			type: "send",
			requestId: "send-1",
			input: {
				id: "message-1",
				recipient: "bob-agent",
				conversationId: "conversation-1",
				body: "private first body",
			},
		});
		const accepted = await alice.next((frame) => frame.requestId === "send-1");
		assert.equal(accepted.type, "accepted");
		assert.equal(accepted.duplicate, false);

		alice.send({
			type: "send",
			requestId: "duplicate-1",
			input: {
				id: "message-1",
				recipient: "bob-agent",
				conversationId: "conversation-1",
				body: "private first body",
			},
		});
		assert.equal((await alice.next((frame) => frame.requestId === "duplicate-1")).duplicate, true);

		alice.send({
			type: "send",
			requestId: "forbidden-1",
			input: {
				recipient: "mallory-agent",
				conversationId: "conversation-1",
				body: "must not route",
			},
		});
		const forbidden = await alice.next((frame) => frame.requestId === "forbidden-1");
		assert.equal(forbidden.code, "route_forbidden");

		const bob = await TestClient.open(relay.url);
		await bob.authenticate("bob-secret", "bob-agent", "agent:bob");
		const firstDelivery = await bob.next((frame) => frame.type === "deliver");
		assert.equal((firstDelivery.message as { id: string }).id, "message-1");
		const firstCursor = firstDelivery.cursor as number;
		bob.send({ type: "ack", cursor: firstCursor });
		await waitFor(async () => !(await readFile(storePath, "utf8")).includes("private first body"));
		alice.send({
			type: "send",
			requestId: "duplicate-after-ack",
			input: {
				id: "message-1",
				recipient: "bob-agent",
				conversationId: "conversation-1",
				body: "private first body",
			},
		});
		assert.equal(
			(await alice.next((frame) => frame.requestId === "duplicate-after-ack")).duplicate,
			true,
		);
		await bob.expectNone((frame) => frame.type === "deliver");
		bob.close();

		alice.send({
			type: "send",
			requestId: "send-2",
			input: {
				id: "message-2",
				recipient: "bob-agent",
				conversationId: "conversation-1",
				body: "private second body",
			},
		});
		await alice.next((frame) => frame.requestId === "send-2");

		await relay.close();
		alice.close();
		relay = await startRelayServer({
			host: "127.0.0.1",
			port: 0,
			storePath,
			credentials: CREDENTIALS,
			allowInsecureLoopback: true,
			logger: (record) => logs.push(record),
		});
		const restartedBob = await TestClient.open(relay.url);
		await restartedBob.authenticate("bob-secret", "bob-agent", "agent:bob", firstCursor);
		const resumed = await restartedBob.next((frame) => frame.type === "deliver");
		assert.equal((resumed.message as { id: string }).id, "message-2");
		restartedBob.close();

		const serializedLogs = JSON.stringify(logs);
		assert.doesNotMatch(serializedLogs, /alice-secret|bob-secret/);
		assert.doesNotMatch(serializedLogs, /private first body|private second body/);
		assert.match(serializedLogs, /message_accepted/);
	} finally {
		await relay.close().catch(() => {});
		await rm(root, { recursive: true, force: true });
	}
});

test("relay expires a client that does not answer application heartbeats", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-relay-heartbeat-"));
	const relay = await startRelayServer({
		host: "127.0.0.1",
		port: 0,
		storePath: join(root, "relay.json"),
		credentials: CREDENTIALS,
		allowInsecureLoopback: true,
		heartbeatMs: 25,
		logger: () => {},
	});
	try {
		const client = await TestClient.open(relay.url);
		await client.authenticate("bob-secret", "bob-agent", "agent:bob");
		await new Promise<void>((resolve) => {
			client.socket.addEventListener("close", () => resolve(), { once: true });
		});
		assert.equal(client.socket.readyState, WebSocket.CLOSED);
	} finally {
		await relay.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("WSS client transport satisfies the same two-agent read/respond contract", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-relay-client-"));
	const relay = await startRelayServer({
		host: "127.0.0.1",
		port: 0,
		storePath: join(root, "relay.json"),
		credentials: CREDENTIALS,
		allowInsecureLoopback: true,
		logger: () => {},
	});
	const bobJournal = new AgentSessionJournal();
	const alice = new RelayAgentTransport({
		url: relay.url,
		token: "alice-secret",
		endpointId: "alice-web",
		principalId: "operator:alice",
	});
	const bob = new RelayAgentTransport(
		{
			url: relay.url,
			token: "bob-secret",
			endpointId: "bob-agent",
			principalId: "agent:bob",
		},
		bobJournal,
	);
	try {
		let receiveBob = async (_message: { id: string }): Promise<void> => {};
		const bobDelivery = new Promise<string>((resolve) => {
			receiveBob = async (message) => resolve(message.id);
		});
		let receiveAlice = async (_message: { id: string }): Promise<void> => {};
		const aliceDelivery = new Promise<string>((resolve) => {
			receiveAlice = async (message) => resolve(message.id);
		});
		await bob.subscribe(receiveBob);
		await alice.subscribe(receiveAlice);
		assert.deepEqual(
			(await alice.list()).map((endpoint) => endpoint.id),
			["alice-web", "bob-agent"],
		);
		const sent = await alice.send({
			id: "client-request",
			recipient: "bob-agent",
			conversationId: "client-contract",
			body: "transport contract request",
		});
		assert.equal(sent.duplicate, false);
		assert.equal(await bobDelivery, "client-request");
		await waitFor(async () => bobJournal.message("client-request") !== undefined);
		assert.equal((await bob.read("client-request")).target.state, "read");
		const response = await bob.respond("client-request", "transport contract response");
		bobJournal.recordMessage(
			{
				version: 1,
				id: "private-to-bob",
				conversationId: "not-alices-conversation",
				sender: "mallory-agent",
				recipient: "bob-agent",
				createdAt: "2026-07-26T12:00:00.000Z",
				body: "must not leak to Alice",
			},
			"delivered",
		);
		assert.deepEqual(
			(await alice.listConversations("bob-agent")).map((conversation) => conversation.id),
			["client-contract"],
		);
		const history = await alice.readHistory("bob-agent", "client-contract");
		assert.deepEqual(
			history.map((item) => item.message.id),
			["client-request", response.response.message.id],
		);
		await assert.rejects(
			alice.readHistory("bob-agent", "not-alices-conversation"),
			/session query was rejected/,
		);
		assert.equal(await aliceDelivery, response.response.message.id);
		assert.equal(
			(await alice.read(response.response.message.id)).target.message.body,
			"transport contract response",
		);
	} finally {
		await alice.close();
		await bob.close();
		await relay.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("relay acknowledgment waits for durable listener acceptance", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-relay-acceptance-"));
	const storePath = join(root, "relay.json");
	const relay = await startRelayServer({
		host: "127.0.0.1",
		port: 0,
		storePath,
		credentials: CREDENTIALS,
		allowInsecureLoopback: true,
		logger: () => {},
	});
	const alice = new RelayAgentTransport({
		url: relay.url,
		token: "alice-secret",
		endpointId: "alice-web",
		principalId: "operator:alice",
	});
	const journal = new AgentSessionJournal();
	const bob = new RelayAgentTransport(
		{
			url: relay.url,
			token: "bob-secret",
			endpointId: "bob-agent",
			principalId: "agent:bob",
		},
		journal,
	);
	let release = (): void => {};
	const accepted = new Promise<void>((resolve) => {
		release = resolve;
	});
	let offered = false;
	try {
		await alice.subscribe(async () => {});
		await alice.send({
			id: "accept-before-ack",
			recipient: "bob-agent",
			conversationId: "ordering",
			body: "must remain queued",
		});
		await bob.subscribe(async () => {
			offered = true;
			await accepted;
		});
		await waitFor(async () => offered);
		assert.match(await readFile(storePath, "utf8"), /must remain queued/);
		assert.equal(journal.relayCheckpoint("bob-agent"), 0);
		release();
		await waitFor(async () => journal.relayCheckpoint("bob-agent") > 0);
		await waitFor(async () => !(await readFile(storePath, "utf8")).includes("must remain queued"));
	} finally {
		release();
		await alice.close();
		await bob.close();
		await relay.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("relay leaves a delivery queued when no source listener is subscribed", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-relay-no-listener-"));
	const storePath = join(root, "relay.json");
	const relay = await startRelayServer({
		host: "127.0.0.1",
		port: 0,
		storePath,
		credentials: CREDENTIALS,
		allowInsecureLoopback: true,
		logger: () => {},
	});
	const alice = new RelayAgentTransport({
		url: relay.url,
		token: "alice-secret",
		endpointId: "alice-web",
		principalId: "operator:alice",
	});
	const journal = new AgentSessionJournal();
	const bob = new RelayAgentTransport(
		{
			url: relay.url,
			token: "bob-secret",
			endpointId: "bob-agent",
			principalId: "agent:bob",
			reconnectMs: 0,
		},
		journal,
	);
	let delivered = 0;
	try {
		await alice.subscribe(async () => {});
		const unsubscribe = await bob.subscribe(async () => {
			throw new Error("unsubscribed listener was called");
		});
		await unsubscribe();
		await alice.send({
			id: "wait-for-listener",
			recipient: "bob-agent",
			conversationId: "listener-window",
			body: "must remain queued without a listener",
		});
		await waitFor(async () => (await readFile(storePath, "utf8")).includes("must remain queued"));
		assert.equal(journal.message("wait-for-listener"), undefined);
		assert.equal(journal.relayCheckpoint("bob-agent"), 0);
		await new Promise((resolve) => setTimeout(resolve, 20));
		await bob.subscribe(async (message) => {
			if (message.id === "wait-for-listener") delivered += 1;
		});
		await waitFor(async () => delivered === 1);
		await waitFor(async () => !(await readFile(storePath, "utf8")).includes("must remain queued"));
		assert.equal(journal.message("wait-for-listener")?.state, "delivered");
	} finally {
		await alice.close();
		await bob.close();
		await relay.close();
		await rm(root, { recursive: true, force: true });
	}
});

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!(await predicate())) {
		if (Date.now() >= deadline) throw new Error("timed out waiting for relay state");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

test("relay forwards ephemeral stream previews without persisting them", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-relay-stream-test-"));
	const logs: Array<Readonly<Record<string, unknown>>> = [];
	const storePath = join(root, "relay.json");
	const relay = await startRelayServer({
		host: "127.0.0.1",
		port: 0,
		storePath,
		credentials: CREDENTIALS,
		allowInsecureLoopback: true,
		logger: (record) => logs.push(record),
	});
	try {
		const alice = await TestClient.open(relay.url);
		const bob = await TestClient.open(relay.url);
		assert.equal(
			(await alice.authenticate("alice-secret", "alice-web", "operator:alice")).type,
			"authenticated",
		);
		assert.equal(
			(await bob.authenticate("bob-secret", "bob-agent", "agent:bob")).type,
			"authenticated",
		);

		// Preview events reuse Pi's text event vocabulary and pass through.
		bob.send({
			type: "stream",
			input: {
				id: "preview-1",
				recipient: "alice-web",
				conversationId: "conversation-1",
				replyTo: "message-1",
				event: { type: "text_start", contentIndex: 0 },
			},
		});
		bob.send({
			type: "stream",
			input: {
				id: "preview-1",
				recipient: "alice-web",
				conversationId: "conversation-1",
				replyTo: "message-1",
				event: { type: "text_delta", contentIndex: 0, delta: "Hello, wor" },
			},
		});
		const started = await alice.next((frame) => frame.type === "stream");
		assert.deepEqual(started, {
			type: "stream",
			id: "preview-1",
			conversationId: "conversation-1",
			sender: "bob-agent",
			recipient: "alice-web",
			replyTo: "message-1",
			event: { type: "text_start", contentIndex: 0 },
		});
		const delta = await alice.next((frame) => frame.type === "stream");
		assert.deepEqual(delta.event, {
			type: "text_delta",
			contentIndex: 0,
			delta: "Hello, wor",
		});

		// Unauthorized routes are refused.
		alice.send({
			type: "stream",
			input: {
				id: "preview-2",
				recipient: "alice-web",
				conversationId: "conversation-1",
				event: { type: "text_start", contentIndex: 0 },
			},
		});
		const forbidden = await alice.next((frame) => frame.type === "error");
		assert.equal(forbidden.code, "route_forbidden");

		// A preview is forwarded live to a connected recipient and is never stored
		// or spooled — the durable message that follows is the only record.
		bob.send({
			type: "stream",
			input: {
				id: "preview-1",
				recipient: "alice-web",
				conversationId: "conversation-1",
				event: { type: "text_end", contentIndex: 0, content: "Hello, world" },
			},
		});
		await alice.next((frame) => frame.type === "stream");

		// Content-free status events pass through with phase and tool name.
		bob.send({
			type: "stream",
			input: {
				id: "preview-1",
				recipient: "alice-web",
				conversationId: "conversation-1",
				replyTo: "message-1",
				event: { type: "status", contentIndex: 0, phase: "tool_start", tool: "read_file" },
			},
		});
		const status = await alice.next((frame) => frame.type === "stream");
		assert.deepEqual(status.event, {
			type: "status",
			contentIndex: 0,
			phase: "tool_start",
			tool: "read_file",
		});

		// Unknown status phases are refused rather than forwarded blind.
		bob.send({
			type: "stream",
			input: {
				id: "preview-1",
				recipient: "alice-web",
				conversationId: "conversation-1",
				event: { type: "status", contentIndex: 0, phase: "exfiltrate" },
			},
		});
		const badPhase = await bob.next((frame) => frame.type === "error");
		assert.equal(badPhase.code, "invalid_request");

		// Tool phases require the tool name; other phases must not carry one.
		bob.send({
			type: "stream",
			input: {
				id: "preview-1",
				recipient: "alice-web",
				conversationId: "conversation-1",
				event: { type: "status", contentIndex: 0, phase: "tool_start" },
			},
		});
		const namelessTool = await bob.next((frame) => frame.type === "error");
		assert.equal(namelessTool.code, "invalid_request");
		bob.send({
			type: "stream",
			input: {
				id: "preview-1",
				recipient: "alice-web",
				conversationId: "conversation-1",
				event: { type: "status", contentIndex: 0, phase: "thinking_start", tool: "read_file" },
			},
		});
		const toolOnThinking = await bob.next((frame) => frame.type === "error");
		assert.equal(toolOnThinking.code, "invalid_request");

		// Pi legitimately ends a text block that produced nothing: an empty
		// `text_end` must pass validation and forward, not be rejected as an
		// invalid body.
		bob.send({
			type: "stream",
			input: {
				id: "preview-1",
				recipient: "alice-web",
				conversationId: "conversation-1",
				event: { type: "text_end", contentIndex: 1, content: "" },
			},
		});
		const emptyEnd = await alice.next((frame) => frame.type === "stream");
		assert.deepEqual(emptyEnd.event, { type: "text_end", contentIndex: 1, content: "" });

		const persisted = await readFile(storePath, "utf8").catch(() => "");
		assert.ok(!persisted.includes("Hello"), "previews must never be persisted");
		assert.ok(!persisted.includes("preview-1"), "preview ids must never be persisted");

		// Structural logging only: no preview text in log records.
		const serialized = JSON.stringify(logs);
		assert.ok(!serialized.includes("Hello"), "log records must not contain preview text");
		assert.ok(serialized.includes("stream_forwarded"));

		alice.close();
		bob.close();
	} finally {
		await relay.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("singleton endpoints fold every peer and channel into one conversation", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-relay-singleton-test-"));
	const relay = await startRelayServer({
		host: "127.0.0.1",
		port: 0,
		storePath: join(root, "relay.json"),
		credentials: CREDENTIALS,
		allowInsecureLoopback: true,
		singletonEndpoints: ["bob-agent"],
		logger: () => {},
	});
	try {
		const alice = await TestClient.open(relay.url);
		const bob = await TestClient.open(relay.url);
		await alice.authenticate("alice-secret", "alice-web", "operator:alice");
		await bob.authenticate("bob-secret", "bob-agent", "agent:bob");

		// Sender-supplied conversation ids are overridden on the way in.
		alice.send({
			type: "send",
			requestId: "send-1",
			input: { recipient: "bob-agent", conversationId: "made-up-1", body: "first" },
		});
		const first = await alice.next((frame) => frame.type === "accepted");
		assert.equal((first.message as { conversationId: string }).conversationId, "bob-agent");

		alice.send({
			type: "send",
			requestId: "send-2",
			input: { recipient: "bob-agent", conversationId: "made-up-2", body: "second" },
		});
		const second = await alice.next((frame) => frame.type === "accepted");
		assert.equal((second.message as { conversationId: string }).conversationId, "bob-agent");

		// The agent's outbound reply lands in its own thread too.
		const delivered1 = await bob.next((frame) => frame.type === "deliver");
		bob.send({ type: "ack", cursor: delivered1.cursor });
		bob.send({
			type: "send",
			requestId: "reply-1",
			input: { recipient: "alice-web", conversationId: "agent-chose-this", body: "reply" },
		});
		const reply = await bob.next((frame) => frame.type === "accepted");
		assert.equal((reply.message as { conversationId: string }).conversationId, "bob-agent");

		// Streaming previews are folded the same way.
		bob.send({
			type: "stream",
			input: {
				id: "preview-1",
				recipient: "alice-web",
				conversationId: "another-made-up",
				event: { type: "text_start", contentIndex: 0 },
			},
		});
		const preview = await alice.next((frame) => frame.type === "stream");
		assert.equal(preview.conversationId, "bob-agent");

		alice.close();
		bob.close();
	} finally {
		await relay.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("configFromEnv keeps broker policy on AGENT_RELAY_* variables only", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-relay-env-test-"));
	const credentialsPath = join(root, "credentials.json");
	const { writeFile } = await import("node:fs/promises");
	await writeFile(credentialsPath, JSON.stringify({ credentials: CREDENTIALS }));
	const saved = { ...process.env };
	try {
		process.env.AGENT_RELAY_CREDENTIALS_PATH = credentialsPath;
		process.env.AGENT_RELAY_STORE_PATH = join(root, "store.json");
		// The client transport's identity variable must never leak into broker
		// policy: no singleton fallback, no wide bind, just because it is set.
		process.env.AGENT_ENDPOINT_ID = "link:vega";
		delete process.env.AGENT_RELAY_SINGLETON_ENDPOINTS;
		delete process.env.AGENT_RELAY_HOST;
		delete process.env.AGENT_RELAY_TLS_KEY_PATH;
		delete process.env.AGENT_RELAY_TLS_CERT_PATH;
		const { configFromEnv } = await import("../extensions/relay/server.ts");
		const config = await configFromEnv();
		assert.equal(config.singletonEndpoints, undefined);
		assert.equal(config.host, "127.0.0.1");

		// Folding is enabled only by its own explicit variable.
		process.env.AGENT_RELAY_SINGLETON_ENDPOINTS = "link:vega link:rigel";
		const explicit = await configFromEnv();
		assert.deepEqual(explicit.singletonEndpoints, ["link:vega", "link:rigel"]);

		// A missing store path refuses to start rather than opening an empty
		// store somewhere the operator did not choose.
		delete process.env.AGENT_RELAY_STORE_PATH;
		await assert.rejects(configFromEnv(), /AGENT_RELAY_STORE_PATH is required/);
	} finally {
		process.env = saved;
		await rm(root, { recursive: true, force: true });
	}
});

test("a connection killed while parsing the upgrade head does not leak its slot", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-relay-slot-test-"));
	const relay = await startRelayServer({
		host: "127.0.0.1",
		port: 0,
		storePath: join(root, "relay.json"),
		credentials: CREDENTIALS,
		allowInsecureLoopback: true,
		maxConnections: 1,
	});
	try {
		const { connect } = await import("node:net");
		const port = Number(new URL(relay.url.replace(/^ws/, "http")).port);
		// The upgrade request and a malformed websocket frame (FIN=0) in one
		// segment: the frame is consumed synchronously inside the ServerWebSocket
		// constructor and kills the connection before it is tracked. Do it a few
		// times — with the leak, one dead socket already exhausts maxConnections=1.
		const upgrade = Buffer.from(
			[
				"GET /v1/connect HTTP/1.1",
				"Host: 127.0.0.1",
				"Upgrade: websocket",
				"Connection: Upgrade",
				"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
				"Sec-WebSocket-Version: 13",
				"",
				"",
			].join("\r\n"),
		);
		const badFrame = Buffer.from([0x01, 0x80, 0x00, 0x00, 0x00, 0x00]);
		for (let attempt = 0; attempt < 3; attempt += 1) {
			await new Promise<void>((resolve) => {
				const socket = connect(port, "127.0.0.1", () => {
					socket.write(Buffer.concat([upgrade, badFrame]));
				});
				// Keep the readable side flowing: a paused socket never surfaces the
				// server's FIN, and this promise waits forever.
				socket.resume();
				socket.on("close", () => resolve());
				socket.on("error", () => resolve());
			});
		}
		// Every slot must still be free for a real client.
		const client = await TestClient.open(relay.url);
		const auth = await client.authenticate("alice-secret", "alice-web", "operator:alice");
		assert.equal(auth.type, "authenticated");
		client.close();
	} finally {
		await relay.close();
		await rm(root, { recursive: true, force: true });
	}
});
