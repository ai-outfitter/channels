import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	A2aExecutor,
	A2aServerConfig,
	A2aTaskController,
	RunningA2aServer,
} from "../extensions/a2a/server.ts";
import type { A2aTask } from "../extensions/a2a/types.ts";
import a2aServerExtension from "../extensions/a2a-extension.ts";

type LifecycleHandler = () => Promise<void> | void;

interface RegisteredTool {
	readonly name: string;
	execute(toolCallId: string, params: Record<string, unknown>): Promise<unknown>;
}

interface Wake {
	readonly text: string;
	readonly options: unknown;
}

function fakePi(): {
	readonly handlers: Map<string, LifecycleHandler>;
	readonly tools: Map<string, RegisteredTool>;
	readonly wakes: Wake[];
	readonly pi: ExtensionAPI;
} {
	const handlers = new Map<string, LifecycleHandler>();
	const tools = new Map<string, RegisteredTool>();
	const wakes: Wake[] = [];
	const pi = {
		on(event: string, handler: LifecycleHandler) {
			handlers.set(event, handler);
		},
		registerTool(tool: RegisteredTool) {
			tools.set(tool.name, tool);
		},
		sendUserMessage(text: string, options: unknown) {
			wakes.push({ text, options });
		},
	} as unknown as ExtensionAPI;
	return { handlers, tools, wakes, pi };
}

const CONFIG: A2aServerConfig = {
	host: "127.0.0.1",
	port: 0,
	storePath: "/workspace/.channels/a2a/store.json",
	credentials: [{ token: "token-a", principal: "alpha" }],
	agentName: "test-agent",
	agentDescription: "test agent",
	publicUrl: "https://agent.test/a2a",
	agentVersion: "0.0.1",
};

function stubTask(id: string, text: string): A2aTask {
	return {
		id,
		contextId: `context-${id}`,
		status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() },
		artifacts: [],
		history: [{ messageId: "inbound-1", role: "ROLE_USER", parts: [{ text }] }],
	};
}

function stubController(task: A2aTask): A2aTaskController {
	return {
		task,
		async status() {
			return task;
		},
		async artifact() {
			return task;
		},
	};
}

/** Starts the extension and returns the executor the server was handed. */
async function startExtension(tasks: Map<string, A2aTask>): Promise<{
	readonly tools: Map<string, RegisteredTool>;
	readonly wakes: Wake[];
	readonly executor: A2aExecutor;
}> {
	const { handlers, tools, wakes, pi } = fakePi();
	let executor: A2aExecutor | undefined;
	const running: RunningA2aServer = {
		url: "http://127.0.0.1:8788",
		async close() {},
		async readTask(taskId) {
			return tasks.get(taskId);
		},
		async controllerForTask(taskId) {
			const task = tasks.get(taskId);
			return task ? stubController(task) : undefined;
		},
	};
	a2aServerExtension(pi, {
		enabled: () => true,
		loadConfig: async () => CONFIG,
		start: async (_config, given) => {
			executor = given;
			return running;
		},
		log: () => {},
	});
	await handlers.get("session_start")?.();
	assert.ok(executor);
	return { tools, wakes, executor };
}

test("the a2a tools refuse a task id this session was never woken for", async () => {
	const tasks = new Map([["task-other", stubTask("task-other", "someone else's work")]]);
	const { tools } = await startExtension(tasks);
	// The task exists on the server, so only the woken-set scoping stops the
	// read. Without it the tool would return another caller's content.
	await assert.rejects(
		() =>
			(tools.get("a2a_read_task") as RegisteredTool).execute("call-1", { taskId: "task-other" }),
		/was woken for/,
	);
	await assert.rejects(
		() =>
			(tools.get("a2a_complete_task") as RegisteredTool).execute("call-2", {
				taskId: "task-other",
				response: "hello",
				outcome: "completed",
			}),
		/was woken for/,
	);
	await assert.rejects(
		() =>
			(tools.get("a2a_require_input") as RegisteredTool).execute("call-3", {
				taskId: "task-other",
				question: "which one?",
			}),
		/was woken for/,
	);
});

test("a task the session was woken for is readable", async () => {
	const task = stubTask("task-mine", "please do the thing");
	const tasks = new Map([[task.id, task]]);
	const { tools, executor } = await startExtension(tasks);
	await executor({
		principal: "alpha",
		message: {
			messageId: "inbound-1",
			role: "ROLE_USER",
			parts: [{ text: "please do the thing" }],
		},
		begin: async () => stubController(task),
	});
	const result = (await (tools.get("a2a_read_task") as RegisteredTool).execute("call-1", {
		taskId: task.id,
	})) as { content: [{ text: string }] };
	assert.match(result.content[0].text, /please do the thing/);
});
