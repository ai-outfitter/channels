import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SourceRegistration } from "../extensions/index.ts";
import channelsRuntimeExtension from "../extensions/runtime-extension.ts";
import type {
	RunningChannelsRuntime,
	RuntimeDependencies,
} from "../extensions/task-plane/runtime.ts";
import { startChannelsRuntime } from "../extensions/task-plane/runtime.ts";

type Handler = (...args: never[]) => Promise<void> | void;

function fakePi(): {
	pi: ExtensionAPI;
	handlers: Map<string, Handler[]>;
	tools: Map<string, { execute(id: string, params: Record<string, string>): Promise<unknown> }>;
} {
	const handlers = new Map<string, Handler[]>();
	const tools = new Map<
		string,
		{ execute(id: string, params: Record<string, string>): Promise<unknown> }
	>();
	const pi = {
		on(event: string, handler: Handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerTool(tool: {
			name: string;
			execute(id: string, params: Record<string, string>): Promise<unknown>;
		}) {
			tools.set(tool.name, tool);
		},
		appendEntry() {},
		sendUserMessage() {},
	} as unknown as ExtensionAPI;
	return { pi, handlers, tools };
}

async function fire(handlers: Map<string, Handler[]>, event: string): Promise<Error[]> {
	const errors: Error[] = [];
	for (const handler of handlers.get(event) ?? []) {
		try {
			await handler();
		} catch (error) {
			errors.push(error as Error);
		}
	}
	return errors;
}

function running(onClose: () => Promise<void> | void = () => {}): RunningChannelsRuntime {
	const sink = {
		async accept() {
			throw new Error("unused");
		},
		async continue() {
			throw new Error("unused");
		},
		async claim() {
			throw new Error("unused");
		},
	};
	return {
		healthy: true,
		taskPlane: {} as never,
		sink,
		sourceSink: sink,
		wakeQueue: {
			beforeAgentStart: async () => {},
			agentEnd() {},
		} as never,
		close: async () => onClose(),
	};
}

async function withEnv(
	values: Readonly<Record<string, string | undefined>>,
	body: () => Promise<void>,
): Promise<void> {
	const prior = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
	try {
		for (const [key, value] of Object.entries(values)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await body();
	} finally {
		for (const [key, value] of Object.entries(prior)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test("reports ready only when both task-plane and channel startup succeed", async () => {
	await withEnv(
		{ OUTFITTER_CHANNELS: "test", A2A_SERVER: undefined, OUTFITTER_AGENT_RELAY: undefined },
		async () => {
			for (const failure of ["none", "plane", "channel"] as const) {
				let closes = 0;
				const { pi, handlers } = fakePi();
				const logs: Array<Readonly<Record<string, unknown>>> = [];
				const sources: Record<string, SourceRegistration> = {
					test: {
						configured: () => true,
						load: async () => ({
							async start() {
								if (failure === "channel") throw new Error("channel failed");
								return async () => {};
							},
						}),
					},
				};
				channelsRuntimeExtension(pi, {
					sources,
					log: (record) => logs.push(record),
					startRuntime: async () => {
						if (failure === "plane") throw new Error("plane failed");
						return running(() => {
							closes += 1;
						});
					},
				});
				await fire(handlers, "session_start");
				const health = logs
					.map((record) => record.event)
					.filter((event) => event === "channels_ready" || event === "channels_unhealthy");
				assert.deepEqual(health, [failure === "none" ? "channels_ready" : "channels_unhealthy"]);
				assert.equal(
					closes,
					failure === "channel" ? 1 : 0,
					"explicit source failure rolls back the task plane",
				);
			}
		},
	);
});

test("disables task-plane startup when channels are off and never uses A2A_STORE_PATH", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-runtime-root-"));
	const a2aPath = join(root, "a2a", "tasks.json");
	const taskRoot = join(root, "native-plane");
	await withEnv(
		{
			A2A_SERVER: undefined,
			A2A_STORE_PATH: a2aPath,
			CHANNELS_TASK_STORE_PATH: taskRoot,
			OUTFITTER_AGENT_RELAY: undefined,
			OUTFITTER_CHANNELS: "off",
		},
		async () => {
			const { pi, handlers } = fakePi();
			let starts = 0;
			channelsRuntimeExtension(pi, {
				startRuntime: async () => {
					starts += 1;
					return running();
				},
			});
			await fire(handlers, "session_start");
			assert.equal(starts, 0);
		},
	);

	await withEnv(
		{
			A2A_SERVER: undefined,
			A2A_STORE_PATH: a2aPath,
			CHANNELS_TASK_STORE_PATH: taskRoot,
			OUTFITTER_AGENT_RELAY: undefined,
			OUTFITTER_CHANNELS: "",
		},
		async () => {
			const { pi, handlers } = fakePi();
			let captured: RuntimeDependencies | undefined;
			channelsRuntimeExtension(pi, {
				startRuntime: async (_pi, dependencies) => {
					captured = dependencies;
					return running();
				},
			});
			await fire(handlers, "session_start");
			assert.equal(captured?.storePath, join(taskRoot, "tasks.json"));
			assert.equal(captured?.originStorePath, join(taskRoot, "origins.json"));
			assert.notEqual(captured?.storePath, a2aPath);
		},
	);

	await withEnv(
		{
			A2A_SERVER: undefined,
			A2A_STORE_PATH: a2aPath,
			CHANNELS_TASK_STORE_PATH: undefined,
			OUTFITTER_AGENT_RELAY: undefined,
			OUTFITTER_CHANNELS: "",
			XDG_DATA_HOME: join(root, "xdg-data"),
		},
		async () => {
			const { pi, handlers } = fakePi();
			let captured: RuntimeDependencies | undefined;
			channelsRuntimeExtension(pi, {
				startRuntime: async (_pi, dependencies) => {
					captured = dependencies;
					return running();
				},
			});
			await fire(handlers, "session_start");
			assert.equal(
				captured?.storePath,
				join(root, "xdg-data", "outfitter", "channels", "task-plane", "tasks.json"),
			);
			assert.doesNotMatch(captured?.storePath ?? "", /\.channels/);
		},
	);
});

test("A2A remains enabled with channels off, registers tools only when enabled, and uses production authority wiring", async () => {
	await withEnv(
		{ OUTFITTER_CHANNELS: "off", A2A_SERVER: undefined, OUTFITTER_AGENT_RELAY: undefined },
		async () => {
			const { pi, tools } = fakePi();
			channelsRuntimeExtension(pi, { startRuntime: async () => running() });
			assert.equal(tools.size, 0);
		},
	);
	await withEnv(
		{ OUTFITTER_CHANNELS: "off", A2A_SERVER: "1", OUTFITTER_AGENT_RELAY: undefined },
		async () => {
			const { pi, handlers, tools } = fakePi();
			const logs: Array<Readonly<Record<string, unknown>>> = [];
			let captured: RuntimeDependencies | undefined;
			const states: string[] = [];
			const task = (id: string) => ({
				id,
				contextId: `context-${id}`,
				status: { state: "TASK_STATE_WORKING" as const, timestamp: new Date().toISOString() },
				history: [],
			});
			const active = task("active");
			const legacy = task("legacy");
			const loaded = running();
			Object.assign(loaded.taskPlane, {
				taskStore: {
					async lookup(id: string) {
						const found = id === "active" ? active : id === "legacy" ? legacy : undefined;
						return found ? { principal: "p", task: found } : undefined;
					},
					async updateStatus(_principal: string, id: string, input: { state: string }) {
						states.push(`${id}:${input.state}`);
						return {
							...(id === "active" ? active : legacy),
							status: { state: input.state, timestamp: new Date().toISOString() },
						};
					},
					async addArtifact(_principal: string, id: string) {
						return id === "active" ? active : legacy;
					},
				},
			});
			Object.assign(loaded.wakeQueue, {
				hasAuthority: async (id: string) => id === "active",
				sourceForTask: () => "a2a",
			});
			channelsRuntimeExtension(pi, {
				log: (record) => logs.push(record),
				startRuntime: async (_pi, dependencies) => {
					captured = dependencies;
					return loaded;
				},
			});
			await fire(handlers, "session_start");
			assert.deepEqual(
				logs.filter(
					(record) => record.event === "channels_ready" || record.event === "channels_unhealthy",
				),
				[{ event: "channels_ready" }],
				"deliberately disabled native channels do not make the A2A-only runtime unhealthy",
			);
			assert.ok(captured?.listener, "A2A listener is selected independently of channels");
			assert.deepEqual([...tools.keys()].sort(), [
				"a2a_complete_task",
				"a2a_read_task",
				"a2a_require_input",
			]);
			const readTool = tools.get("a2a_read_task");
			const completeTool = tools.get("a2a_complete_task");
			assert.ok(readTool && completeTool);
			await assert.rejects(readTool.execute("call", { taskId: "foreign" }), /not authorized/);
			await assert.rejects(readTool.execute("call", { taskId: "legacy" }), /not authorized/);
			await completeTool.execute("call", {
				taskId: "active",
				response: "done",
				outcome: "completed",
			});
			assert.deepEqual(states, ["active:TASK_STATE_COMPLETED"]);
		},
	);
});

test("real wake-queue source wiring denies continuation for a native Task", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-real-authority-"));
	await withEnv(
		{
			OUTFITTER_CHANNELS: "off",
			A2A_SERVER: "1",
			CHANNELS_TASK_STORE_PATH: root,
			OUTFITTER_AGENT_RELAY: undefined,
		},
		async () => {
			const { pi, handlers, tools } = fakePi();
			const prompts: string[] = [];
			Object.assign(pi, {
				sendUserMessage(prompt: string) {
					prompts.push(prompt);
				},
			});
			let runtime: RunningChannelsRuntime | undefined;
			channelsRuntimeExtension(pi, {
				startRuntime: async (runtimePi, dependencies) => {
					const { listener: _listener, ...withoutListener } = dependencies;
					runtime = await startChannelsRuntime(runtimePi, {
						...withoutListener,
					});
					return runtime;
				},
			});
			await fire(handlers, "session_start");
			assert.ok(runtime);
			const accepted = await runtime.sourceSink.accept({
				principal: "slack:test",
				source: "slack",
				providerEventId: "event:test",
				nativeLocator: { channelLocator: "slack:v1:test" },
				receivedAt: "2026-08-15T12:00:00.000Z",
				providerDedupeKey: "event:test",
				conversationKey: "conversation:test",
				parts: [{ text: "untrusted" }],
				contentDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			});
			for (let attempt = 0; prompts.length === 0 && attempt < 100; attempt += 1) {
				await new Promise((resolve) => setImmediate(resolve));
			}
			const before = handlers.get("before_agent_start")?.[0];
			assert.ok(before && prompts[0]);
			await (before as unknown as (event: { prompt: string }) => Promise<void>)({
				prompt: prompts[0],
			});
			const requireInput = tools.get("a2a_require_input");
			assert.ok(requireInput);
			await assert.rejects(
				requireInput.execute("call", { taskId: accepted.taskId, question: "more?" }),
				/source has no continuation method/,
			);
			await fire(handlers, "session_shutdown");
		},
	);
});

test("A2A tools fail closed after a channel failure clears the runtime", async () => {
	await withEnv(
		{ OUTFITTER_CHANNELS: "test", A2A_SERVER: "1", OUTFITTER_AGENT_RELAY: undefined },
		async () => {
			const { pi, handlers, tools } = fakePi();
			const loaded = running();
			const task = {
				id: "never-woken",
				contextId: "context-never-woken",
				status: { state: "TASK_STATE_WORKING" as const, timestamp: new Date().toISOString() },
				history: [],
			};
			Object.assign(loaded.taskPlane, {
				taskStore: {
					async lookup() {
						return { principal: "p", task };
					},
					async updateStatus() {
						throw new Error("must not update without authority");
					},
					async addArtifact() {
						throw new Error("must not write without authority");
					},
				},
			});
			Object.assign(loaded.wakeQueue, {
				hasAuthority: async () => true,
				sourceForTask: () => "a2a",
			});
			channelsRuntimeExtension(pi, {
				sources: {
					test: {
						configured: () => true,
						load: async () => ({
							async start() {
								throw new Error("source failed after plane startup");
							},
						}),
					},
				},
				startRuntime: async () => loaded,
			});
			await fire(handlers, "session_start");
			const complete = tools.get("a2a_complete_task");
			assert.ok(complete);
			await assert.rejects(
				complete.execute("call", {
					taskId: "never-woken",
					response: "should not land",
					outcome: "completed",
				}),
				/not authorized/,
			);
		},
	);
});

test("stops channel sources before closing the task plane", async () => {
	await withEnv(
		{ OUTFITTER_CHANNELS: "test", A2A_SERVER: undefined, OUTFITTER_AGENT_RELAY: undefined },
		async () => {
			const order: string[] = [];
			const source = {
				async start() {
					return async () => {
						order.push("source");
					};
				},
			};
			const { pi, handlers } = fakePi();
			channelsRuntimeExtension(pi, {
				sources: {
					test: { configured: () => true, load: async () => source },
				},
				startRuntime: async () =>
					running(() => {
						order.push("plane");
					}),
			});
			await fire(handlers, "session_start");
			await fire(handlers, "session_shutdown");
			assert.deepEqual(order, ["source", "plane"]);
		},
	);
});
