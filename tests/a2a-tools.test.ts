import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type A2aExecutor, configFromEnv } from "../extensions/a2a/server.ts";
import { A2aTaskStore } from "../extensions/a2a/store.ts";
import {
	loadWorkflowOutputsFromEnv,
	type WorkflowOutputDeclarations,
} from "../extensions/a2a/workflow-outputs.ts";
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
	const activations: Array<{ source: string; contentDigest: string }> = [];
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
			async accept(input: { source: string; contentDigest: string }) {
				activations.push(input);
				return {
					activationId: "a",
					taskId: "task-a2a",
					contextId: "context-a2a",
					disposition: "created",
				};
			},
		} as never,
	);
	assert.equal(received, taskStore);
	assert.ok(executor);
	const outcome = await executor({
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
	assert.deepEqual(outcome, { kind: "task", taskId: "task-a2a" });
	assert.equal(activations.length, 1);
	assert.equal(activations[0]?.source, "a2a");
	await stop();
});

test("A2A journal acceptance survives a crash without minting or conflicting on retry", async () => {
	let executor: A2aExecutor | undefined;
	let accepted = false;
	let calls = 0;
	const inputs: Array<{ contentDigest: string; conversationKey?: string }> = [];
	const listener = createA2aRuntimeListener({
		enabled: () => true,
		loadConfig: async () => ({
			host: "127.0.0.1",
			port: 0,
			storePath: "",
			credentials: [],
			agentName: "test",
			agentDescription: "test",
			publicUrl: "http://127.0.0.1",
			agentVersion: "test",
		}),
		async start(_config, inboundExecutor) {
			executor = inboundExecutor;
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
	await listener.start(
		{ taskStore: {} } as never,
		{
			async accept(input: { contentDigest: string; conversationKey?: string }) {
				calls += 1;
				inputs.push(input);
				if (!accepted) {
					accepted = true;
					throw new Error("crash after durable journal claim");
				}
				return {
					activationId: "activation-prior",
					taskId: "task-prior",
					contextId: "context-prior",
					disposition: "duplicate",
				};
			},
		} as never,
	);
	assert.ok(executor);
	const context = {
		principal: "a2a:caller",
		message: { messageId: "message-retry", role: "ROLE_USER" as const, parts: [{ text: "work" }] },
		async begin() {
			throw new Error("the listener must not mint before journal acceptance");
		},
	};
	await assert.rejects(executor(context), /crash after durable journal claim/);
	assert.deepEqual(await executor(context), { kind: "task", taskId: "task-prior" });
	assert.equal(calls, 2);
	assert.equal(inputs[0]?.contentDigest, inputs[1]?.contentDigest);
});

test("A2A persistence failure propagates and leaves intake retryable", async () => {
	let executor: A2aExecutor | undefined;
	let attempts = 0;
	const listener = createA2aRuntimeListener({
		enabled: () => true,
		loadConfig: async () => ({
			host: "127.0.0.1",
			port: 0,
			storePath: "",
			credentials: [],
			agentName: "test",
			agentDescription: "test",
			publicUrl: "http://127.0.0.1",
			agentVersion: "test",
		}),
		async start(_config, inboundExecutor) {
			executor = inboundExecutor;
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
	await listener.start(
		{ taskStore: {} } as never,
		{
			async accept() {
				attempts += 1;
				if (attempts === 1) throw new Error("journal fsync failed");
				return {
					activationId: "activation-new",
					taskId: "task-new",
					contextId: "context-new",
					disposition: "created",
				};
			},
		} as never,
	);
	assert.ok(executor);
	const context = {
		principal: "a2a:caller",
		message: { messageId: "message-fsync", role: "ROLE_USER" as const, parts: [{ text: "work" }] },
		async begin() {
			throw new Error("must not mint before persistence");
		},
	};
	await assert.rejects(executor(context), /journal fsync failed/);
	assert.deepEqual(await executor(context), { kind: "task", taskId: "task-new" });
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

test("a2a_complete_task records declared outputs before the response", async () => {
	const artifacts: Array<{ name?: string }> = [];
	const states: string[] = [];
	const tools = new Map<string, { execute(id: string, params: never): Promise<unknown> }>();
	const task = {
		id: "task-output",
		contextId: "context-output",
		status: { state: "TASK_STATE_WORKING" as const },
	};
	const declarations: WorkflowOutputDeclarations = new Map([
		["pull-request", { type: "pull-request" }],
		["merge-commit", { type: "git-commit" }],
	]);
	registerA2aTools(
		{
			registerTool(tool: { name: string; execute(id: string, params: never): Promise<unknown> }) {
				tools.set(tool.name, tool);
			},
		} as never,
		() => ({
			async readTask() {
				return task;
			},
			async controllerForTask() {
				return {
					task,
					async artifact(artifact: { name?: string }) {
						artifacts.push(artifact);
						return task;
					},
					async status(state: string) {
						states.push(state);
						return task;
					},
				};
			},
		}),
		async () => true,
		() => true,
		() => declarations,
	);
	await tools.get("a2a_complete_task")?.execute("call", {
		taskId: task.id,
		response: "done",
		outcome: "completed",
		outputs: [
			{ output: "pull-request", value: { number: 69 } },
			{ output: "merge-commit", value: { sha: "abc123" } },
		],
	} as never);
	assert.deepEqual(
		artifacts.map(({ name }) => name),
		["pull-request", "merge-commit", "response"],
	);
	assert.deepEqual(states, ["TASK_STATE_COMPLETED"]);
});

test("loadWorkflowOutputsFromEnv selects absent, single, and explicitly named workflows", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-workflow-outputs-"));
	const manifest = join(root, "workflow-composition.json");
	const priorManifest = process.env.A2A_WORKFLOW_MANIFEST;
	const priorWorkflow = process.env.A2A_WORKFLOW;
	try {
		delete process.env.A2A_WORKFLOW_MANIFEST;
		delete process.env.A2A_WORKFLOW;
		assert.equal(await loadWorkflowOutputsFromEnv(), undefined);
		await writeFile(
			manifest,
			JSON.stringify({
				workflows: [
					{ id: "build", outputs: { branch: { from: "implement", type: "git-branch" } } },
				],
			}),
		);
		process.env.A2A_WORKFLOW_MANIFEST = manifest;
		assert.deepEqual(
			[...((await loadWorkflowOutputsFromEnv())?.entries() ?? [])],
			[["branch", { type: "git-branch" }]],
		);
		await writeFile(
			manifest,
			JSON.stringify({
				workflows: [
					{ id: "build", outputs: {} },
					{ id: "release", outputs: { commit: { from: "merge", type: "git-commit" } } },
				],
			}),
		);
		process.env.A2A_WORKFLOW = "release";
		assert.deepEqual(
			[...((await loadWorkflowOutputsFromEnv())?.entries() ?? [])],
			[["commit", { type: "git-commit" }]],
		);
		process.env.A2A_WORKFLOW = "missing";
		await assert.rejects(loadWorkflowOutputsFromEnv(), /workflow "missing" is absent/);
	} finally {
		if (priorManifest === undefined) delete process.env.A2A_WORKFLOW_MANIFEST;
		else process.env.A2A_WORKFLOW_MANIFEST = priorManifest;
		if (priorWorkflow === undefined) delete process.env.A2A_WORKFLOW;
		else process.env.A2A_WORKFLOW = priorWorkflow;
	}
});

test("a2a_complete_task rejects invalid output sets without recording anything", async (t) => {
	const declared: WorkflowOutputDeclarations = new Map([
		["pull-request", { type: "pull-request" }],
	]);
	const cases = [
		{
			name: "undeclared output",
			declarations: declared,
			outcome: "completed",
			outputs: [{ output: "issue", value: { number: 69 } }],
			error: /output "issue" is not declared by the workflow/,
		},
		{
			name: "missing declarations",
			declarations: undefined,
			outcome: "completed",
			outputs: [{ output: "pull-request", value: { number: 69 } }],
			error: /no workflow output declarations are configured; set A2A_WORKFLOW_MANIFEST/,
		},
		{
			name: "duplicate output",
			declarations: declared,
			outcome: "completed",
			outputs: [
				{ output: "pull-request", value: { number: 69 } },
				{ output: "pull-request", value: { number: 70 } },
			],
			error: /output "pull-request" is duplicated/,
		},
		{
			name: "outputs on rejection",
			declarations: declared,
			outcome: "rejected",
			outputs: [{ output: "pull-request", value: { number: 69 } }],
			error: /outputs cannot be recorded when outcome is rejected/,
		},
	] as const;
	for (const testCase of cases) {
		await t.test(testCase.name, async () => {
			const recorded: string[] = [];
			const tools = new Map<string, { execute(id: string, params: never): Promise<unknown> }>();
			const task = {
				id: "task-invalid-output",
				contextId: "context-invalid-output",
				status: { state: "TASK_STATE_WORKING" as const },
			};
			registerA2aTools(
				{
					registerTool(tool: {
						name: string;
						execute(id: string, params: never): Promise<unknown>;
					}) {
						tools.set(tool.name, tool);
					},
				} as never,
				() => ({
					async readTask() {
						return task;
					},
					async controllerForTask() {
						return {
							task,
							async artifact() {
								recorded.push("artifact");
								return task;
							},
							async status() {
								recorded.push("status");
								return task;
							},
						};
					},
				}),
				async () => true,
				() => true,
				() => testCase.declarations,
			);
			const complete = tools.get("a2a_complete_task");
			assert.ok(complete);
			await assert.rejects(
				complete.execute("call", {
					taskId: task.id,
					response: "done",
					outcome: testCase.outcome,
					outputs: testCase.outputs,
				} as never),
				testCase.error,
			);
			assert.deepEqual(recorded, []);
		});
	}
});
