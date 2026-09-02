import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
	type A2aExecutor,
	type A2aServerConfig,
	type RunningA2aServer,
	startA2aServer,
} from "../extensions/a2a/server.ts";
import { A2aTaskStore } from "../extensions/a2a/store.ts";
import { A2aError, type A2aSendMessageRequest, type A2aTask } from "../extensions/a2a/types.ts";

const cleanups: Array<() => Promise<void>> = [];
after(async () => {
	for (const cleanup of cleanups.reverse()) await cleanup();
});

async function launch(
	executor: A2aExecutor,
	overrides: Partial<A2aServerConfig> = {},
	onTaskCanceled: (taskId: string) => void | Promise<void> = () => {},
): Promise<RunningA2aServer> {
	const directory = await mkdtemp(join(tmpdir(), "a2a-test-"));
	const config: A2aServerConfig = {
		host: "127.0.0.1",
		port: 0,
		storePath: join(directory, "store.json"),
		credentials: [
			{ token: "token-a", principal: "alpha" },
			{ token: "token-b", principal: "beta" },
		],
		agentName: "test-agent",
		agentDescription: "test agent",
		publicUrl: "https://agent.test/a2a",
		agentVersion: "0.0.1",
		blockingTimeoutMs: 2_000,
		...overrides,
	};
	const server = await startA2aServer(config, executor, undefined, onTaskCanceled);
	cleanups.push(async () => {
		await server.close();
		await rm(directory, { recursive: true, force: true });
	});
	return server;
}

function send(
	server: RunningA2aServer,
	token: string,
	request: A2aSendMessageRequest,
	headers: Record<string, string> = {},
): Promise<Response> {
	return fetch(`${server.url}/message:send`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/a2a+json",
			...headers,
		},
		body: JSON.stringify(request),
	});
}

function userMessage(messageId: string, text: string, extra: Record<string, unknown> = {}) {
	return { messageId, role: "ROLE_USER" as const, parts: [{ text }], ...extra };
}

const directExecutor: A2aExecutor = async (context) => ({
	messageId: "",
	role: "ROLE_AGENT",
	parts: [{ text: `echo: ${context.message.parts[0]?.text ?? ""}` }],
});

const completingExecutor: A2aExecutor = async (context) => {
	const controller = await context.begin();
	await controller.status("TASK_STATE_WORKING");
	await controller.artifact({
		artifactId: "result",
		name: "result",
		parts: [{ text: "done" }],
	});
	await controller.status("TASK_STATE_COMPLETED");
	return undefined;
};

describe("a2a task plane", () => {
	it("a simple interaction returns a direct Message, and a duplicate direct Message returns its prior direct result", async () => {
		const server = await launch(directExecutor);
		const first = await send(server, "token-a", { message: userMessage("m-1", "hello") });
		assert.equal(first.status, 200);
		const firstBody = (await first.json()) as {
			message: { messageId: string; role: string; parts: unknown[] };
		};
		assert.equal(firstBody.message.role, "ROLE_AGENT");
		const duplicate = await send(server, "token-a", { message: userMessage("m-1", "hello") });
		const duplicateBody = (await duplicate.json()) as { message: { messageId: string } };
		assert.deepEqual(duplicateBody, firstBody);
	});

	it("a duplicate messageId that created a Task returns that Task, and a different payload under the same id is an explicit error", async () => {
		const server = await launch(completingExecutor);
		const first = await send(server, "token-a", { message: userMessage("m-2", "do work") });
		const firstBody = (await first.json()) as { task: A2aTask };
		assert.equal(firstBody.task.status.state, "TASK_STATE_COMPLETED");
		const duplicate = await send(server, "token-a", { message: userMessage("m-2", "do work") });
		const duplicateBody = (await duplicate.json()) as { task: A2aTask };
		assert.equal(duplicateBody.task.id, firstBody.task.id);
		const mismatched = await send(server, "token-a", {
			message: userMessage("m-2", "different work"),
		});
		assert.equal(mismatched.status, 409);
		const error = (await mismatched.json()) as { details: [{ reason: string }] };
		assert.equal(error.details[0].reason, "DUPLICATE_MESSAGE_ID");
	});

	it("a blocking send waits for a settled task; return_immediately returns the submitted task", async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const slowExecutor: A2aExecutor = async (context) => {
			const controller = await context.begin();
			void gate.then(async () => {
				await controller.status("TASK_STATE_COMPLETED");
			});
			return undefined;
		};
		const server = await launch(slowExecutor);
		const immediate = await send(server, "token-a", {
			message: userMessage("m-3", "queue this"),
			configuration: { returnImmediately: true },
		});
		const immediateBody = (await immediate.json()) as { task: A2aTask };
		assert.equal(immediateBody.task.status.state, "TASK_STATE_SUBMITTED");
		release();
		const blocking = await send(server, "token-a", { message: userMessage("m-4", "and this") });
		const blockingBody = (await blocking.json()) as { task: A2aTask };
		assert.equal(blockingBody.task.status.state, "TASK_STATE_COMPLETED");
	});

	it("a foreign contextId does not join local work", async () => {
		const server = await launch(completingExecutor);
		const alpha = await send(server, "token-a", { message: userMessage("m-5", "alpha work") });
		const alphaTask = ((await alpha.json()) as { task: A2aTask }).task;
		const beta = await send(server, "token-b", {
			message: userMessage("m-6", "beta work", { contextId: alphaTask.contextId }),
		});
		const betaTask = ((await beta.json()) as { task: A2aTask }).task;
		assert.notEqual(betaTask.contextId, alphaTask.contextId);
	});

	it("equal task ids from two servers do not collide: a task id resolves only on the server that minted it", async () => {
		const serverOne = await launch(completingExecutor);
		const serverTwo = await launch(completingExecutor);
		const created = await send(serverOne, "token-a", { message: userMessage("m-7", "work") });
		const task = ((await created.json()) as { task: A2aTask }).task;
		const foreign = await fetch(`${serverTwo.url}/tasks/${task.id}`, {
			headers: { authorization: "Bearer token-a" },
		});
		assert.equal(foreign.status, 404);
		const error = (await foreign.json()) as { details: [{ reason: string }] };
		assert.equal(error.details[0].reason, "TASK_NOT_FOUND");
	});

	it("a reconnect can miss transient status Messages without losing critical state", async () => {
		const server = await launch(completingExecutor);
		// No subscriber was connected while the task ran, so every streamed
		// update was missed. The durable Task still carries the artifact and
		// terminal state — the recovery contract.
		const created = await send(server, "token-a", { message: userMessage("m-8", "work") });
		const task = ((await created.json()) as { task: A2aTask }).task;
		const read = await fetch(`${server.url}/tasks/${task.id}?historyLength=10`, {
			headers: { authorization: "Bearer token-a" },
		});
		const snapshot = (await read.json()) as A2aTask;
		assert.equal(snapshot.status.state, "TASK_STATE_COMPLETED");
		assert.equal(snapshot.artifacts?.[0]?.artifactId, "result");
		assert.equal(snapshot.history?.length, 1);
	});

	it("an unsupported A2A version fails explicitly", async () => {
		const server = await launch(directExecutor);
		const response = await send(
			server,
			"token-a",
			{ message: userMessage("m-9", "hello") },
			{ "a2a-version": "0.5" },
		);
		assert.equal(response.status, 400);
		const error = (await response.json()) as { details: [{ reason: string }] };
		assert.equal(error.details[0].reason, "VERSION_NOT_SUPPORTED");
	});

	it("subscribe is GET, streams status updates, and rejects terminal tasks", async () => {
		let controllerRef: { status(state: string): Promise<unknown> } | undefined;
		const pausingExecutor: A2aExecutor = async (context) => {
			const controller = await context.begin();
			await controller.status("TASK_STATE_WORKING");
			controllerRef = controller as unknown as { status(state: string): Promise<unknown> };
			return undefined;
		};
		const server = await launch(pausingExecutor);
		const created = await send(server, "token-a", {
			message: userMessage("m-10", "long work"),
			configuration: { returnImmediately: true },
		});
		const task = ((await created.json()) as { task: A2aTask }).task;

		const asPost = await fetch(`${server.url}/tasks/${task.id}:subscribe`, {
			method: "POST",
			headers: { authorization: "Bearer token-a" },
		});
		assert.equal(asPost.status, 404);

		const stream = await fetch(`${server.url}/tasks/${task.id}:subscribe`, {
			headers: { authorization: "Bearer token-a" },
		});
		assert.equal(stream.status, 200);
		assert.match(stream.headers.get("content-type") ?? "", /text\/event-stream/);
		assert.ok(controllerRef);
		await controllerRef.status("TASK_STATE_COMPLETED");
		const text = await stream.text();
		assert.match(text, /statusUpdate/);
		assert.match(text, /TASK_STATE_COMPLETED/);

		const afterTerminal = await fetch(`${server.url}/tasks/${task.id}:subscribe`, {
			headers: { authorization: "Bearer token-a" },
		});
		assert.equal(afterTerminal.status, 400);
		const error = (await afterTerminal.json()) as { details: [{ reason: string }] };
		assert.equal(error.details[0].reason, "UNSUPPORTED_OPERATION");
	});

	it("input-required settles a blocking send, and a follow-up message continues the same non-terminal task", async () => {
		const askThenComplete: A2aExecutor = async (context) => {
			const controller = await context.begin();
			if (context.task) {
				await controller.status("TASK_STATE_COMPLETED");
				return undefined;
			}
			await controller.status("TASK_STATE_INPUT_REQUIRED", {
				messageId: "q-1",
				role: "ROLE_AGENT",
				parts: [{ text: "which environment?" }],
			});
			return undefined;
		};
		const server = await launch(askThenComplete);
		const first = await send(server, "token-a", { message: userMessage("m-11", "deploy it") });
		const task = ((await first.json()) as { task: A2aTask }).task;
		assert.equal(task.status.state, "TASK_STATE_INPUT_REQUIRED");
		assert.equal(task.status.message?.parts[0]?.text, "which environment?");
		const followUp = await send(server, "token-a", {
			message: userMessage("m-12", "production", { taskId: task.id }),
		});
		const continued = ((await followUp.json()) as { task: A2aTask }).task;
		assert.equal(continued.id, task.id);
		assert.equal(continued.status.state, "TASK_STATE_COMPLETED");
		const read = await fetch(`${server.url}/tasks/${task.id}?historyLength=10`, {
			headers: { authorization: "Bearer token-a" },
		});
		const snapshot = (await read.json()) as A2aTask;
		assert.equal(snapshot.history?.length, 2);
	});

	it("a refused continuation of a working task does not persist the caller's message", async () => {
		const rejectingExecutor: A2aExecutor = async (context) => {
			if (context.task) {
				throw new A2aError(400, "INVALID_ARGUMENT", "working task cannot accept supplied input");
			}
			const controller = await context.begin();
			await controller.status("TASK_STATE_WORKING");
			return undefined;
		};
		const server = await launch(rejectingExecutor);
		const created = await send(server, "token-a", {
			message: userMessage("m-working", "start work"),
			configuration: { returnImmediately: true },
		});
		const task = ((await created.json()) as { task: A2aTask }).task;
		assert.equal(task.status.state, "TASK_STATE_WORKING");
		const before = await fetch(`${server.url}/tasks/${task.id}?historyLength=10`, {
			headers: { authorization: "Bearer token-a" },
		});
		const historyBefore = ((await before.json()) as A2aTask).history;

		const refused = await send(server, "token-a", {
			message: userMessage("m-refused", "interrupt", { taskId: task.id }),
		});
		assert.equal(refused.status, 400);
		const error = (await refused.json()) as { details: [{ reason: string }] };
		assert.equal(error.details[0].reason, "INVALID_ARGUMENT");

		const responseAfter = await fetch(`${server.url}/tasks/${task.id}?historyLength=10`, {
			headers: { authorization: "Bearer token-a" },
		});
		const historyAfter = ((await responseAfter.json()) as A2aTask).history;
		assert.deepEqual(historyAfter, historyBefore);
	});

	it("continuing a terminal task fails, requests without a bearer token fail, and push-notification routes are explicitly unsupported", async () => {
		const server = await launch(completingExecutor);
		const created = await send(server, "token-a", { message: userMessage("m-13", "work") });
		const task = ((await created.json()) as { task: A2aTask }).task;
		const continuation = await send(server, "token-a", {
			message: userMessage("m-14", "more", { taskId: task.id }),
		});
		assert.equal(continuation.status, 400);
		const unauthenticated = await fetch(`${server.url}/tasks`, {});
		assert.equal(unauthenticated.status, 401);
		const push = await fetch(`${server.url}/tasks/${task.id}/pushNotificationConfigs`, {
			headers: { authorization: "Bearer token-a" },
		});
		assert.equal(push.status, 501);
	});

	it("the agent card is public, declares streaming without push notifications, and carries the outfitter-task extension", async () => {
		const server = await launch(directExecutor);
		const response = await fetch(`${server.url}/.well-known/agent-card.json`);
		assert.equal(response.status, 200);
		const card = (await response.json()) as {
			capabilities: {
				streaming: boolean;
				pushNotifications: boolean;
				extensions: [{ uri: string }];
			};
			supportedInterfaces: [{ protocolBinding: string; protocolVersion: string }];
		};
		assert.equal(card.capabilities.streaming, true);
		assert.equal(card.capabilities.pushNotifications, false);
		assert.match(card.capabilities.extensions[0].uri, /outfitter-task\/v1$/);
		assert.equal(card.supportedInterfaces[0].protocolBinding, "HTTP+JSON");
		assert.equal(card.supportedInterfaces[0].protocolVersion, "1.0");
	});

	it("listTasks filters by contextId and status within the authenticated principal", async () => {
		const server = await launch(completingExecutor);
		const created = await send(server, "token-a", { message: userMessage("m-15", "work") });
		const task = ((await created.json()) as { task: A2aTask }).task;
		await send(server, "token-b", { message: userMessage("m-16", "other principal") });
		const list = await fetch(
			`${server.url}/tasks?contextId=${task.contextId}&status=TASK_STATE_COMPLETED`,
			{ headers: { authorization: "Bearer token-a" } },
		);
		const body = (await list.json()) as { tasks: A2aTask[] };
		assert.equal(body.tasks.length, 1);
		assert.equal(body.tasks[0]?.id, task.id);
		const foreign = await fetch(`${server.url}/tasks`, {
			headers: { authorization: "Bearer token-b" },
		});
		const foreignBody = (await foreign.json()) as { tasks: A2aTask[] };
		assert.equal(
			foreignBody.tasks.some((entry) => entry.id === task.id),
			false,
		);
	});

	it("message:stream forwards status and artifact updates live and ends at the terminal frame", async () => {
		const parkingExecutor: A2aExecutor = async (context) => {
			const controller = await context.begin();
			await controller.status("TASK_STATE_WORKING");
			return undefined;
		};
		const server = await launch(parkingExecutor);
		const stream = await fetch(`${server.url}/message:stream`, {
			method: "POST",
			headers: {
				authorization: "Bearer token-a",
				"content-type": "application/a2a+json",
			},
			body: JSON.stringify({ message: userMessage("m-18", "stream this") }),
		});
		assert.equal(stream.status, 200);
		assert.match(stream.headers.get("content-type") ?? "", /text\/event-stream/);
		assert.ok(stream.body);
		const reader = stream.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		const readUntil = async (marker: string): Promise<void> => {
			while (!buffer.includes(marker)) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
			}
		};
		await readUntil('"task"');
		const taskId = /"id":"([^"]+)"/.exec(buffer)?.[1];
		assert.ok(taskId);
		const controller = await server.controllerForTask(taskId);
		assert.ok(controller);
		await controller.artifact({ artifactId: "streamed", parts: [{ text: "chunk" }] });
		await controller.status("TASK_STATE_COMPLETED");
		await readUntil("TASK_STATE_COMPLETED");
		assert.match(buffer, /artifactUpdate/);
		assert.match(buffer, /statusUpdate/);
	});

	it("cancel settles a non-terminal task and refuses a terminal one", async () => {
		const parkingExecutor: A2aExecutor = async (context) => {
			const controller = await context.begin();
			await controller.status("TASK_STATE_WORKING");
			return undefined;
		};
		const canceledTaskIds: string[] = [];
		const server = await launch(parkingExecutor, {}, (taskId) => {
			canceledTaskIds.push(taskId);
		});
		const created = await send(server, "token-a", {
			message: userMessage("m-19", "cancel me"),
			configuration: { returnImmediately: true },
		});
		const task = ((await created.json()) as { task: A2aTask }).task;
		const canceled = await fetch(`${server.url}/tasks/${task.id}:cancel`, {
			method: "POST",
			headers: { authorization: "Bearer token-a" },
		});
		assert.equal(canceled.status, 200);
		const canceledBody = (await canceled.json()) as A2aTask;
		assert.equal(canceledBody.status.state, "TASK_STATE_CANCELED");
		assert.deepEqual(canceledTaskIds, [task.id]);
		const again = await fetch(`${server.url}/tasks/${task.id}:cancel`, {
			method: "POST",
			headers: { authorization: "Bearer token-a" },
		});
		assert.equal(again.status, 400);
		const error = (await again.json()) as { details: [{ reason: string }] };
		assert.equal(error.details[0].reason, "TASK_NOT_CANCELABLE");
	});

	it("the store survives restart with tasks and dedupe intact", async () => {
		const directory = await mkdtemp(join(tmpdir(), "a2a-store-test-"));
		cleanups.push(() => rm(directory, { recursive: true, force: true }));
		const path = join(directory, "store.json");
		const first = new A2aTaskStore(path);
		const task = await first.createTask("alpha", undefined);
		await first.updateStatus("alpha", task.id, { state: "TASK_STATE_COMPLETED" });
		const message = userMessage("m-17", "persisted");
		await first.recordOutcome("alpha", message, { kind: "task", taskId: task.id });
		const second = new A2aTaskStore(path);
		const reloaded = await second.getTask("alpha", task.id);
		assert.equal(reloaded.status.state, "TASK_STATE_COMPLETED");
		const prior = await second.priorOutcome("alpha", message);
		assert.deepEqual(prior, { kind: "task", taskId: task.id });
	});

	it("rejects artifacts after a Task reaches a terminal state", async () => {
		const directory = await mkdtemp(join(tmpdir(), "a2a-terminal-artifact-"));
		cleanups.push(() => rm(directory, { recursive: true, force: true }));
		const store = new A2aTaskStore(join(directory, "store.json"));
		const task = await store.createTask("alpha", undefined);
		await store.updateStatus("alpha", task.id, { state: "TASK_STATE_COMPLETED" });
		await assert.rejects(
			store.addArtifact("alpha", task.id, {
				artifactId: "late",
				name: "late",
				parts: [{ text: "must not land" }],
			}),
			/already in terminal state/,
		);
	});

	it("reaccepts a duplicate whose referenced Task was pruned", async () => {
		const directory = await mkdtemp(join(tmpdir(), "a2a-pruned-dedupe-"));
		cleanups.push(() => rm(directory, { recursive: true, force: true }));
		const path = join(directory, "store.json");
		const first = new A2aTaskStore(path);
		const task = await first.createTask("alpha", undefined);
		await first.updateStatus("alpha", task.id, { state: "TASK_STATE_COMPLETED" });
		const message = userMessage("m-pruned", "retry me");
		await first.recordOutcome("alpha", message, { kind: "task", taskId: task.id });
		const document = JSON.parse(await readFile(path, "utf8"));
		const old = "2000-01-01T00:00:00.000Z";
		document.tasks[task.id].updatedAt = old;
		document.dedupe[0].createdAt = old;
		await writeFile(path, JSON.stringify(document));
		const restarted = new A2aTaskStore(path);
		assert.equal(await restarted.priorOutcome("alpha", message), undefined);
		const replacement = await restarted.createTask("alpha", undefined);
		await restarted.recordOutcome("alpha", message, {
			kind: "task",
			taskId: replacement.id,
		});
		assert.deepEqual(await restarted.priorOutcome("alpha", message), {
			kind: "task",
			taskId: replacement.id,
		});
	});
});
