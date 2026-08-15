import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type A2aExecutor, configFromEnv } from "../extensions/a2a/server.ts";
import { A2aTaskStore } from "../extensions/a2a/store.ts";
import { createA2aRuntimeListener, registerA2aTools } from "../extensions/a2a-extension.ts";

test("task-plane tools enforce active authority and reject input-required without continuation", async () => {
	const tools = new Map<
		string,
		{ execute(id: string, params: { taskId: string; question?: string }): Promise<unknown> }
	>();
	const task = {
		id: "task-native",
		contextId: "context-native",
		status: { state: "TASK_STATE_WORKING" as const, timestamp: new Date().toISOString() },
	};
	registerA2aTools(
		{
			registerTool(tool: { name: string; execute(id: string, params: never): Promise<unknown> }) {
				tools.set(tool.name, tool as never);
			},
		} as never,
		() => ({
			async readTask() {
				return task;
			},
			async controllerForTask() {
				return {
					task,
					async status() {
						throw new Error("status must not change");
					},
					async artifact() {
						return task;
					},
				};
			},
		}),
		async (taskId) => taskId === "task-native",
		() => false,
	);
	const read = tools.get("a2a_read_task");
	const requireInput = tools.get("a2a_require_input");
	assert.ok(read && requireInput);
	await assert.rejects(
		read.execute("call", { taskId: "task-other" }),
		/not authorized for the active turn/,
	);
	await assert.rejects(
		requireInput.execute("call", {
			taskId: "task-native",
			question: "More information?",
		}),
		/no continuation method/,
	);
});

test("the runtime listener injects the task plane's one shared Task store", async () => {
	const taskStore = new A2aTaskStore("/unused/shared-task-store.json");
	let received: A2aTaskStore | undefined;
	let executor: A2aExecutor | undefined;
	const claims: Array<{ source: string; taskId: string }> = [];
	const listener = createA2aRuntimeListener({
		enabled: () => true,
		loadConfig: async () => ({
			host: "127.0.0.1",
			port: 0,
			storePath: "/must-not-be-opened.json",
			credentials: [],
			agentName: "test",
			agentDescription: "test",
			publicUrl: "http://127.0.0.1",
			agentVersion: "test",
		}),
		async start(_config, inboundExecutor, sharedStore) {
			executor = inboundExecutor;
			received = sharedStore;
			return {
				url: "http://127.0.0.1:1",
				async close() {},
				async readTask() {
					return undefined;
				},
				async controllerForTask() {
					return undefined;
				},
			};
		},
	});
	assert.ok(listener);
	const stop = await listener.start(
		{ taskStore } as never,
		{
			async claim(input: { source: string }, taskId: string) {
				claims.push({ source: input.source, taskId });
				return { activationId: "a", taskId, contextId: "context-a2a", disposition: "continued" };
			},
		} as never,
	);
	assert.equal(received, taskStore);
	assert.ok(executor);
	await executor({
		principal: "a2a:caller",
		message: { messageId: "message-a2a", role: "ROLE_USER", parts: [{ text: "work" }] },
		async begin() {
			return {
				task: {
					id: "task-a2a",
					contextId: "context-a2a",
					status: { state: "TASK_STATE_SUBMITTED", timestamp: new Date().toISOString() },
				},
				async status() {
					throw new Error("listener must not set working before queue authority");
				},
				async artifact() {
					throw new Error("unused");
				},
			};
		},
	});
	assert.deepEqual(claims, [{ source: "a2a", taskId: "task-a2a" }]);
	await stop();
});

test("composed A2A configuration does not require the retired standalone store path", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-a2a-config-"));
	const credentials = join(root, "credentials.json");
	await writeFile(credentials, JSON.stringify({ credentials: [] }));
	const priorCredentials = process.env.A2A_CREDENTIALS_PATH;
	const priorStore = process.env.A2A_STORE_PATH;
	try {
		process.env.A2A_CREDENTIALS_PATH = credentials;
		delete process.env.A2A_STORE_PATH;
		assert.equal((await configFromEnv()).storePath, "");
	} finally {
		if (priorCredentials === undefined) delete process.env.A2A_CREDENTIALS_PATH;
		else process.env.A2A_CREDENTIALS_PATH = priorCredentials;
		if (priorStore === undefined) delete process.env.A2A_STORE_PATH;
		else process.env.A2A_STORE_PATH = priorStore;
	}
});
