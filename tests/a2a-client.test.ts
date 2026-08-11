import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { A2aClient, A2aRemoteError } from "../extensions/a2a/client.ts";
import {
	type A2aExecutor,
	type A2aServerConfig,
	type RunningA2aServer,
	startA2aServer,
} from "../extensions/a2a/server.ts";
import type { A2aStreamResponse } from "../extensions/a2a/types.ts";

const cleanups: Array<() => Promise<void>> = [];
after(async () => {
	for (const cleanup of cleanups.reverse()) await cleanup();
});

async function launch(executor: A2aExecutor): Promise<RunningA2aServer> {
	const directory = await mkdtemp(join(tmpdir(), "a2a-client-test-"));
	const config: A2aServerConfig = {
		host: "127.0.0.1",
		port: 0,
		storePath: join(directory, "store.json"),
		credentials: [{ token: "test-token", principal: "client" }],
		agentName: "client-test-agent",
		agentDescription: "client test agent",
		publicUrl: "https://agent.test/a2a",
		agentVersion: "0.0.1",
	};
	const server = await startA2aServer(config, executor);
	cleanups.push(async () => {
		await server.close();
		await rm(directory, { recursive: true, force: true });
	});
	return server;
}

test("the outbound client sends, reads, lists, and cancels authenticated tasks", async () => {
	const server = await launch(async (context) => {
		await context.begin();
		return undefined;
	});
	const client = new A2aClient({
		baseUrl: server.url,
		token: "test-token",
		allowInsecureLoopback: true,
	});
	const result = await client.sendMessage({
		message: { messageId: "client-message", role: "ROLE_USER", parts: [{ text: "work" }] },
		configuration: { returnImmediately: true },
	});
	assert.ok("task" in result);
	const task = await client.getTask(result.task.id, 10);
	assert.equal(task.id, result.task.id);
	const page = await client.listTasks({ contextId: task.contextId, includeArtifacts: true });
	assert.deepEqual(
		page.tasks.map((item) => item.id),
		[task.id],
	);
	const canceled = await client.cancelTask(task.id);
	assert.equal(canceled.status.state, "TASK_STATE_CANCELED");
});

test("the outbound client preserves the A2A error reason without exposing proxy bodies", async () => {
	const server = await launch(async (context) => {
		await context.begin();
		return undefined;
	});
	const client = new A2aClient({
		baseUrl: server.url,
		token: "wrong-token",
		allowInsecureLoopback: true,
	});
	await assert.rejects(
		() =>
			client.sendMessage({
				message: { messageId: "denied", role: "ROLE_USER", parts: [{ text: "work" }] },
			}),
		(error: unknown) => {
			assert.ok(error instanceof A2aRemoteError);
			assert.equal(error.status, 401);
			assert.equal(error.reason, "UNAUTHENTICATED");
			return true;
		},
	);
});

test("the outbound client accepts only deployment-fixed HTTPS or explicit loopback", () => {
	assert.throws(
		() => new A2aClient({ baseUrl: "http://agent.example/a2a", token: "token" }),
		/must use HTTPS/,
	);
	assert.throws(
		() => new A2aClient({ baseUrl: "https://user:pass@agent.example/a2a", token: "token" }),
		/must not contain credentials/,
	);
	assert.doesNotThrow(
		() =>
			new A2aClient({
				baseUrl: "http://127.0.0.1:8788/a2a",
				token: "token",
				allowInsecureLoopback: true,
			}),
	);
});

test("the outbound client sends the pinned protocol headers under the configured base path", async () => {
	let request: Request | undefined;
	const client = new A2aClient({
		baseUrl: "https://relay.example/agents/worker/",
		token: "secret",
		fetch: async (input, init) => {
			request = new Request(input, init);
			return new Response(
				JSON.stringify({
					message: { messageId: "reply", role: "ROLE_AGENT", parts: [{ text: "ok" }] },
				}),
				{ status: 200, headers: { "content-type": "application/a2a+json" } },
			);
		},
	});
	await client.sendMessage({
		message: { messageId: "outbound", role: "ROLE_USER", parts: [{ text: "work" }] },
	});
	assert.equal(request?.url, "https://relay.example/agents/worker/message:send");
	assert.equal(request?.headers.get("authorization"), "Bearer secret");
	assert.equal(request?.headers.get("a2a-version"), "1.0");
});

test("the outbound client parses task subscription events", async () => {
	const frames: A2aStreamResponse[] = [
		{
			statusUpdate: {
				taskId: "task-1",
				contextId: "context-1",
				status: { state: "TASK_STATE_WORKING" },
			},
		},
		{
			statusUpdate: {
				taskId: "task-1",
				contextId: "context-1",
				status: { state: "TASK_STATE_COMPLETED" },
			},
		},
	];
	const client = new A2aClient({
		baseUrl: "https://agent.example/a2a",
		token: "secret",
		fetch: async () =>
			new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""), {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			}),
	});
	const seen: A2aStreamResponse[] = [];
	await client.subscribeTask("task-1", (event) => seen.push(event));
	assert.deepEqual(seen, frames);
});
