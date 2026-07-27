import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocket } from "undici";
import { RelayAgentTransport } from "../extensions/agent/relay.ts";
import { type RelayCredential, startRelayServer } from "../extensions/relay/server.ts";

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
		alice.send({ type: "list_conversations", requestId: "conversations-1" });
		const conversations = await alice.next((frame) => frame.requestId === "conversations-1");
		assert.deepEqual(
			(conversations.conversations as Array<{ id: string }>).map((item) => item.id),
			["conversation-1"],
		);
		alice.send({
			type: "read_history",
			requestId: "history-1",
			conversationId: "conversation-1",
			limit: 1,
		});
		const history = await alice.next((frame) => frame.requestId === "history-1");
		assert.equal((history.messages as unknown[]).length, 1);
		assert.equal(
			(history.messages as Array<{ message: { id: string } }>)[0]?.message.id,
			"message-2",
		);

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
	const alice = new RelayAgentTransport({
		url: relay.url,
		token: "alice-secret",
		endpointId: "alice-web",
		principalId: "operator:alice",
		statePath: join(root, "alice-state.json"),
	});
	const bob = new RelayAgentTransport({
		url: relay.url,
		token: "bob-secret",
		endpointId: "bob-agent",
		principalId: "agent:bob",
		statePath: join(root, "bob-state.json"),
	});
	try {
		let receiveBob = (_id: string): void => {};
		const bobDelivery = new Promise<string>((resolve) => {
			receiveBob = resolve;
		});
		let receiveAlice = (_id: string): void => {};
		const aliceDelivery = new Promise<string>((resolve) => {
			receiveAlice = resolve;
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
		assert.equal((await bob.read("client-request")).target.state, "read");
		const response = await bob.respond("client-request", "transport contract response");
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
