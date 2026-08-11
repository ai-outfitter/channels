import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { A2aClient } from "../extensions/a2a/client.ts";
import {
	type A2aRelayServerConfig,
	type RunningA2aRelayServer,
	startA2aRelayServer,
} from "../extensions/a2a-relay/server.ts";

const cleanups: Array<() => Promise<void>> = [];
after(async () => {
	for (const cleanup of cleanups.reverse()) await cleanup();
});

async function config(): Promise<A2aRelayServerConfig> {
	const directory = await mkdtemp(join(tmpdir(), "a2a-relay-server-test-"));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	return {
		agentId: "resident-a",
		queuePath: join(directory, "queue.json"),
		a2a: {
			host: "127.0.0.1",
			port: 0,
			storePath: join(directory, "tasks.json"),
			credentials: [{ token: "caller-token", principal: "caller-a" }],
			agentName: "resident-a",
			agentDescription: "relay-backed resident agent",
			publicUrl: "https://relay.example/agents/resident-a",
			agentVersion: "0.0.1",
		},
		connectorHost: "127.0.0.1",
		connectorPort: 0,
		workerCredentials: [{ token: "worker-token", worker: "worker-a", agentIds: ["resident-a"] }],
		allowInsecureLoopback: true,
		leaseMs: 60_000,
	};
}

function client(server: RunningA2aRelayServer): A2aClient {
	return new A2aClient({
		baseUrl: server.a2aUrl,
		token: "caller-token",
		allowInsecureLoopback: true,
	});
}

function connector(
	server: RunningA2aRelayServer,
	path: string,
	options: {
		readonly method?: string;
		readonly lease?: string;
		readonly body?: unknown;
		readonly token?: string;
	} = {},
): Promise<Response> {
	return fetch(`${server.connectorUrl}${path}`, {
		method: options.method ?? "GET",
		headers: {
			authorization: `Bearer ${options.token ?? "worker-token"}`,
			...(options.lease ? { "x-a2a-relay-lease": options.lease } : {}),
			...(options.body === undefined ? {} : { "content-type": "application/json" }),
		},
		...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
	});
}

async function createTask(a2a: A2aClient, messageId: string) {
	const result = await a2a.sendMessage({
		message: { messageId, role: "ROLE_USER", parts: [{ text: `body for ${messageId}` }] },
		configuration: { returnImmediately: true },
	});
	assert.ok("task" in result);
	return result.task;
}

test("the relay accepts work while offline and a fenced worker settles it", async () => {
	const server = await startA2aRelayServer(await config());
	cleanups.push(() => server.close());
	const a2a = client(server);
	const created = await createTask(a2a, "relay-message-1");
	assert.equal(created.status.state, "TASK_STATE_SUBMITTED");

	const denied = await connector(server, "/v1/tasks:claim", { token: "wrong" });
	assert.equal(denied.status, 401);
	const claimedResponse = await connector(server, "/v1/tasks:claim");
	assert.equal(claimedResponse.status, 200);
	const claimed = (await claimedResponse.json()) as {
		delivery: { taskId: string; lease: { id: string } };
		task: { history: [{ parts: [{ text: string }] }] };
	};
	assert.equal(claimed.delivery.taskId, created.id);
	assert.equal(claimed.task.history[0].parts[0].text, "body for relay-message-1");

	const wrongLease = await connector(server, `/v1/tasks/${created.id}`, { lease: "wrong" });
	assert.equal(wrongLease.status, 409);
	const lease = claimed.delivery.lease.id;
	const working = await connector(server, `/v1/tasks/${created.id}:status`, {
		method: "POST",
		lease,
		body: { state: "TASK_STATE_WORKING" },
	});
	assert.equal(working.status, 200);
	const artifact = await connector(server, `/v1/tasks/${created.id}:artifact`, {
		method: "POST",
		lease,
		body: { artifact: { artifactId: "result", parts: [{ text: "finished output" }] } },
	});
	assert.equal(artifact.status, 200);
	const completed = await connector(server, `/v1/tasks/${created.id}:status`, {
		method: "POST",
		lease,
		body: { state: "TASK_STATE_COMPLETED" },
	});
	assert.equal(completed.status, 200);

	const visible = await a2a.getTask(created.id);
	assert.equal(visible.status.state, "TASK_STATE_COMPLETED");
	assert.equal(visible.artifacts?.[0]?.parts[0]?.text, "finished output");
	assert.equal((await connector(server, "/v1/tasks:claim")).status, 204);
});

test("release returns unfinished work to the durable queue with a new lease", async () => {
	const server = await startA2aRelayServer(await config());
	cleanups.push(() => server.close());
	const created = await createTask(client(server), "relay-release");
	const first = (await (await connector(server, "/v1/tasks:claim")).json()) as {
		delivery: { lease: { id: string } };
	};
	const released = await connector(server, `/v1/tasks/${created.id}:release`, {
		method: "POST",
		lease: first.delivery.lease.id,
	});
	assert.equal(released.status, 200);
	const second = (await (await connector(server, "/v1/tasks:claim")).json()) as {
		delivery: { lease: { id: string } };
		task: { status: { state: string } };
	};
	assert.notEqual(second.delivery.lease.id, first.delivery.lease.id);
	assert.equal(second.task.status.state, "TASK_STATE_SUBMITTED");
});

test("caller cancellation removes queued work before a worker can claim it", async () => {
	const server = await startA2aRelayServer(await config());
	cleanups.push(() => server.close());
	const a2a = client(server);
	const created = await createTask(a2a, "relay-cancel");
	await a2a.cancelTask(created.id);
	assert.equal((await connector(server, "/v1/tasks:claim")).status, 204);
});

test("a worker observes caller cancellation through its lease and the queue clears", async () => {
	const server = await startA2aRelayServer(await config());
	cleanups.push(() => server.close());
	const a2a = client(server);
	const created = await createTask(a2a, "relay-active-cancel");
	const claimed = (await (await connector(server, "/v1/tasks:claim")).json()) as {
		delivery: { lease: { id: string } };
	};
	await a2a.cancelTask(created.id);
	const read = await connector(server, `/v1/tasks/${created.id}`, {
		lease: claimed.delivery.lease.id,
	});
	assert.equal(read.status, 200);
	assert.equal(
		((await read.json()) as { status: { state: string } }).status.state,
		"TASK_STATE_CANCELED",
	);
	assert.equal((await connector(server, "/v1/tasks:claim")).status, 204);
});

test("relay restart recovers accepted offline work without minting another task", async () => {
	const relayConfig = await config();
	const first = await startA2aRelayServer(relayConfig);
	const created = await createTask(client(first), "relay-restart");
	await first.close();

	const second = await startA2aRelayServer(relayConfig);
	cleanups.push(() => second.close());
	const claimed = (await (await connector(second, "/v1/tasks:claim")).json()) as {
		delivery: { taskId: string };
	};
	assert.equal(claimed.delivery.taskId, created.id);
	const page = await client(second).listTasks();
	assert.deepEqual(
		page.tasks.map((task) => task.id),
		[created.id],
	);
});
