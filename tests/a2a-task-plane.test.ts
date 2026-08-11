import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
import {
	A2aError,
	type A2aSendMessageRequest,
	type A2aTask,
	MAX_MESSAGE_BYTES,
	taskMetadataFromTask,
	validateMessage,
} from "../extensions/a2a/types.ts";

const cleanups: Array<() => Promise<void>> = [];
after(async () => {
	for (const cleanup of cleanups.reverse()) await cleanup();
});

async function launch(
	executor: A2aExecutor,
	overrides: Partial<A2aServerConfig> = {},
): Promise<RunningA2aServer> {
	const directory = await mkdtemp(join(tmpdir(), "a2a-test-"));
	const config: A2aServerConfig = {
		host: "127.0.0.1",
		port: 0,
		storePath: join(directory, "store.json"),
		artifactStorePath: join(directory, "artifacts"),
		credentials: [
			{ token: "token-a", principal: "alpha" },
			{ token: "token-b", principal: "beta" },
		],
		agentName: "test-agent",
		agentDescription: "test agent",
		publicUrl: "https://agent.test/a2a",
		agentVersion: "0.0.1",
		policyDigest: `sha256:${"a".repeat(64)}`,
		blockingTimeoutMs: 2_000,
		...overrides,
	};
	const server = await startA2aServer(config, executor);
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
	await controller.evidence("evidence-record-1");
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
		assert.deepEqual(taskMetadataFromTask(firstBody.task), {
			ticketRunId: taskMetadataFromTask(firstBody.task).ticketRunId,
			task: {
				agentInterface: "https://agent.test/a2a",
				protocolBinding: "HTTP+JSON",
				protocolVersion: "1.0",
				taskId: firstBody.task.id,
			},
			policyDigest: `sha256:${"a".repeat(64)}`,
			evidence: ["evidence-record-1"],
			idempotency: { messageId: "m-2", scope: "alpha" },
		});
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

	it("a trusted executor can route a new message into an owned non-terminal task", async () => {
		let routedTaskId: string | undefined;
		const routingExecutor: A2aExecutor = async (context) => {
			const controller = await context.begin(routedTaskId);
			routedTaskId ??= controller.task.id;
			await controller.status("TASK_STATE_INPUT_REQUIRED");
			return undefined;
		};
		const server = await launch(routingExecutor);
		const first = await send(server, "token-a", {
			message: userMessage("m-routed-1", "first activation"),
		});
		const firstTask = ((await first.json()) as { task: A2aTask }).task;
		const second = await send(server, "token-a", {
			message: userMessage("m-routed-2", "thread continuation"),
		});
		const secondTask = ((await second.json()) as { task: A2aTask }).task;
		assert.equal(secondTask.id, firstTask.id);
		assert.deepEqual(
			secondTask.history?.map((message) => message.messageId),
			["m-routed-1", "m-routed-2"],
		);
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
				extensions: Array<{ uri: string }>;
			};
			supportedInterfaces: [{ protocolBinding: string; protocolVersion: string }];
		};
		assert.equal(card.capabilities.streaming, true);
		assert.equal(card.capabilities.pushNotifications, false);
		assert.match(card.capabilities.extensions[0]?.uri ?? "", /outfitter-task\/v1$/);
		assert.match(card.capabilities.extensions[1]?.uri ?? "", /outfitter-artifact\/v1$/);
		assert.equal(card.supportedInterfaces[0].protocolBinding, "HTTP+JSON");
		assert.equal(card.supportedInterfaces[0].protocolVersion, "1.0");
	});

	it("large artifacts use authenticated digest-bound URLs", async () => {
		const server = await launch(completingExecutor);
		const bytes = Buffer.alloc(300_000, 0x5a);
		const uploaded = await fetch(`${server.url}/artifacts`, {
			method: "POST",
			headers: {
				authorization: "Bearer token-a",
				"content-type": "application/a2a+json",
			},
			body: JSON.stringify({
				raw: bytes.toString("base64"),
				mediaType: "application/octet-stream",
				filename: "large.bin",
			}),
		});
		assert.equal(uploaded.status, 201);
		const artifact = (await uploaded.json()) as {
			artifact: {
				extensions: string[];
				parts: [{ url: string; metadata: { "outfitter-artifact/v1": { digest: string } } }];
			};
		};
		const digest = artifact.artifact.parts[0].metadata["outfitter-artifact/v1"].digest;
		assert.match(digest, /^sha256:[0-9a-f]{64}$/);
		assert.match(artifact.artifact.parts[0].url, new RegExp(digest.slice(7)));
		const path = `/artifacts/${digest.slice(7)}`;
		assert.equal((await fetch(`${server.url}${path}`)).status, 401);
		const downloaded = await fetch(`${server.url}${path}`, {
			headers: { authorization: "Bearer token-a" },
		});
		assert.equal(downloaded.status, 200);
		assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
	});

	it("malformed artifact base64 is an invalid client argument", async () => {
		const server = await launch(completingExecutor);
		const response = await fetch(`${server.url}/artifacts`, {
			method: "POST",
			headers: {
				authorization: "Bearer token-a",
				"content-type": "application/a2a+json",
			},
			body: JSON.stringify({ raw: "!!!!", mediaType: "application/octet-stream" }),
		});
		assert.equal(response.status, 400);
		const body = (await response.json()) as { details: [{ reason: string }] };
		assert.equal(body.details[0].reason, "INVALID_ARGUMENT");
	});

	it("message size limits count UTF-8 bytes", () => {
		const message = userMessage("multibyte-message", "界".repeat(MAX_MESSAGE_BYTES / 2));
		assert.ok(JSON.stringify(message).length < MAX_MESSAGE_BYTES);
		assert.throws(() => validateMessage(message, "ROLE_USER"), /message exceeds/);
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
		const server = await launch(parkingExecutor);
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
		const unfinished = await first.createTask("alpha", undefined);
		await first.updateStatus("alpha", unfinished.id, { state: "TASK_STATE_WORKING" });
		await first.updateStatus("alpha", task.id, { state: "TASK_STATE_COMPLETED" });
		const message = userMessage("m-17", "persisted");
		await first.recordOutcome("alpha", message, { kind: "task", taskId: task.id });
		const second = new A2aTaskStore(path);
		const reloaded = await second.getTask("alpha", task.id);
		assert.equal(reloaded.status.state, "TASK_STATE_COMPLETED");
		const prior = await second.claimOutcome("alpha", message);
		assert.deepEqual(prior, { kind: "replay", outcome: { kind: "task", taskId: task.id } });
		const recoverable = await second.listRecoverable();
		assert.deepEqual(
			recoverable.map((entry) => entry.task.id),
			[unfinished.id],
		);
	});

	it("task binding and its dedupe outcome survive one atomic restart boundary", async () => {
		const directory = await mkdtemp(join(tmpdir(), "a2a-bind-test-"));
		cleanups.push(() => rm(directory, { recursive: true, force: true }));
		const path = join(directory, "store.json");
		const message = userMessage("m-bound-before-crash", "persist this work");
		const first = new A2aTaskStore(path);
		assert.deepEqual(await first.claimOutcome("alpha", message), { kind: "claimed" });
		const task = await first.bindClaimToTask("alpha", message);
		first.close();

		const second = new A2aTaskStore(path);
		assert.deepEqual(await second.claimOutcome("alpha", message), {
			kind: "replay",
			outcome: { kind: "task", taskId: task.id },
		});
		assert.deepEqual(
			(await second.listTasks("alpha", {})).tasks.map((entry) => entry.id),
			[task.id],
		);
	});

	it("dedupe retention does not evict a live task record at the former size cap", async () => {
		const directory = await mkdtemp(join(tmpdir(), "a2a-dedupe-cap-test-"));
		cleanups.push(() => rm(directory, { recursive: true, force: true }));
		const path = join(directory, "store.json");
		const createdAt = new Date().toISOString();
		const firstMessage = userMessage("m-retained-task", "retained");
		const task: A2aTask = {
			id: "task-retained",
			contextId: "context-retained",
			status: { state: "TASK_STATE_WORKING", timestamp: createdAt },
			artifacts: [],
			history: [firstMessage],
		};
		const hash = (message: ReturnType<typeof userMessage>): string =>
			createHash("sha256")
				.update(
					JSON.stringify({
						contextId: "",
						taskId: "",
						role: message.role,
						parts: message.parts,
						referenceTaskIds: [],
					}),
				)
				.digest("hex");
		const directMessage = userMessage("direct-result", "done");
		const dedupe = [
			{
				principal: "alpha",
				messageId: firstMessage.messageId,
				payloadHash: hash(firstMessage),
				createdAt,
				outcome: { kind: "task", taskId: task.id },
			},
			...Array.from({ length: 9_999 }, (_, index) => {
				const message = userMessage(`m-retained-${index}`, "same payload");
				return {
					principal: "alpha",
					messageId: message.messageId,
					payloadHash: hash(message),
					createdAt,
					outcome: { kind: "message", message: directMessage },
				};
			}),
		];
		await writeFile(
			path,
			`${JSON.stringify({
				version: 1,
				tasks: { [task.id]: { task, principal: "alpha", updatedAt: createdAt } },
				dedupe,
			})}\n`,
		);
		const store = new A2aTaskStore(path);
		assert.deepEqual(await store.claimOutcome("alpha", userMessage("m-over-cap", "new")), {
			kind: "claimed",
		});
		assert.deepEqual(await store.claimOutcome("alpha", firstMessage), {
			kind: "replay",
			outcome: { kind: "task", taskId: task.id },
		});
		store.close();
	});

	it("a closed store refuses further operations instead of rebuilding itself", async () => {
		const directory = await mkdtemp(join(tmpdir(), "a2a-close-test-"));
		cleanups.push(() => rm(directory, { recursive: true, force: true }));
		const store = new A2aTaskStore(join(directory, "store.json"));
		await store.initialize();
		store.close();
		await assert.rejects(() => store.createTask("alpha", undefined), /store is closed/);
	});

	it("a stream request that fails before the stream opens returns an HTTP error, not an empty 200 stream", async () => {
		const server = await launch(completingExecutor);
		const stream = (text: string): Promise<Response> =>
			fetch(`${server.url}/message:stream`, {
				method: "POST",
				headers: { authorization: "Bearer token-a", "content-type": "application/a2a+json" },
				body: JSON.stringify({ message: userMessage("m-stream-dup", text) }),
			});
		const first = await stream("original");
		assert.equal(first.status, 200);
		await first.body?.cancel();
		const mismatched = await stream("different payload");
		assert.equal(mismatched.status, 409);
		assert.doesNotMatch(mismatched.headers.get("content-type") ?? "", /text\/event-stream/);
		const error = (await mismatched.json()) as { details: [{ reason: string }] };
		assert.equal(error.details[0].reason, "DUPLICATE_MESSAGE_ID");
	});

	it("GET /tasks pages through every task exactly once", async () => {
		const server = await launch(completingExecutor);
		const created = new Set<string>();
		for (let index = 0; index < 7; index += 1) {
			const response = await send(server, "token-a", {
				message: userMessage(`m-page-${index}`, `work ${index}`),
			});
			created.add(((await response.json()) as { task: A2aTask }).task.id);
		}
		const seen: string[] = [];
		let token = "";
		let pages = 0;
		do {
			const query = `pageSize=3${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`;
			const response = await fetch(`${server.url}/tasks?${query}`, {
				headers: { authorization: "Bearer token-a" },
			});
			assert.equal(response.status, 200);
			const body = (await response.json()) as { tasks: A2aTask[]; nextPageToken: string };
			assert.ok(body.tasks.length <= 3);
			for (const task of body.tasks) seen.push(task.id);
			token = body.nextPageToken;
			pages += 1;
			assert.ok(pages < 10, "pagination did not terminate");
		} while (token);
		assert.equal(seen.length, created.size);
		assert.deepEqual(new Set(seen), created);
	});

	it("a page token the server did not mint is a clean 400", async () => {
		const server = await launch(completingExecutor);
		const response = await fetch(`${server.url}/tasks?pageToken=not-a-cursor`, {
			headers: { authorization: "Bearer token-a" },
		});
		assert.equal(response.status, 400);
		const error = (await response.json()) as { details: [{ reason: string }] };
		assert.equal(error.details[0].reason, "INVALID_ARGUMENT");
	});

	it("a principal the store cannot parse back is refused at startup, not on the next restart", async () => {
		await assert.rejects(
			() =>
				launch(directExecutor, { credentials: [{ token: "t", principal: "nick@example.com" }] }),
			/principal must match/,
		);
	});

	it("two credentials sharing a token are refused at startup", async () => {
		await assert.rejects(
			() =>
				launch(directExecutor, {
					credentials: [
						{ token: "same", principal: "alpha" },
						{ token: "same", principal: "beta" },
					],
				}),
			/tokens must be unique/,
		);
	});

	it("concurrent sends of one messageId mint exactly one task", async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let begins = 0;
		const gatedExecutor: A2aExecutor = async (context) => {
			const controller = await context.begin();
			begins += 1;
			await gate;
			await controller.status("TASK_STATE_COMPLETED");
			return undefined;
		};
		const server = await launch(gatedExecutor);
		const request: A2aSendMessageRequest = {
			message: userMessage("m-concurrent", "once only"),
			configuration: { returnImmediately: true },
		};
		const first = send(server, "token-a", request);
		while (begins === 0) await new Promise((resolve) => setTimeout(resolve, 5));
		// begin() binds the claim and task in one store operation. The second
		// send can replay that durable task while the first executor is gated.
		const secondResponse = await send(server, "token-a", request);
		const secondTask = ((await secondResponse.json()) as { task: A2aTask }).task;
		release();
		const firstResponse = await first;
		const firstTask = ((await firstResponse.json()) as { task: A2aTask }).task;
		assert.equal(firstResponse.status, 200);
		assert.equal(secondResponse.status, 200);
		assert.equal(secondTask.id, firstTask.id);
		assert.equal(begins, 1);
		const listed = await fetch(`${server.url}/tasks`, {
			headers: { authorization: "Bearer token-a" },
		});
		const body = (await listed.json()) as { tasks: A2aTask[] };
		assert.equal(body.tasks.length, 1);
	});

	it("an executor that throws after begin() settles the task and records it for the retry", async () => {
		let attempts = 0;
		const failingExecutor: A2aExecutor = async (context) => {
			attempts += 1;
			await context.begin();
			throw new A2aError(400, "INVALID_ARGUMENT", "the executor refused this work");
		};
		const server = await launch(failingExecutor);
		const first = await send(server, "token-a", { message: userMessage("m-boom", "explode") });
		assert.equal(first.status, 400);
		const listed = await fetch(`${server.url}/tasks`, {
			headers: { authorization: "Bearer token-a" },
		});
		const tasks = ((await listed.json()) as { tasks: A2aTask[] }).tasks;
		assert.equal(tasks.length, 1);
		assert.equal((tasks[0] as A2aTask).status.state, "TASK_STATE_FAILED");
		// The retry replays the recorded failure instead of minting a second task.
		const retry = await send(server, "token-a", { message: userMessage("m-boom", "explode") });
		assert.equal(retry.status, 200);
		const retryBody = (await retry.json()) as { task: A2aTask };
		assert.equal(retryBody.task.id, (tasks[0] as A2aTask).id);
		assert.equal(retryBody.task.status.state, "TASK_STATE_FAILED");
		assert.equal(attempts, 1);
	});

	it("a send that fails before any task exists releases the key for a retry", async () => {
		let attempts = 0;
		const lateExecutor: A2aExecutor = async (context) => {
			attempts += 1;
			if (attempts === 1) throw new Error("transient failure before begin()");
			const controller = await context.begin();
			await controller.status("TASK_STATE_COMPLETED");
			return undefined;
		};
		const server = await launch(lateExecutor);
		const first = await send(server, "token-a", { message: userMessage("m-retry", "try me") });
		assert.equal(first.status, 500);
		const second = await send(server, "token-a", { message: userMessage("m-retry", "try me") });
		assert.equal(second.status, 200);
		assert.equal(attempts, 2);
	});
});
