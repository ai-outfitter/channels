import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { forwardSourceTaskSink, type SourceRegistration } from "../extensions/index.ts";
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

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("condition was not met");
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

test("cached channel adapters resolve the current task sink on every call", async () => {
	let generation = "first";
	let current = {
		async accept() {
			throw new Error("unused");
		},
		async continue() {
			throw new Error("unused");
		},
		async taskIsTerminal() {
			return generation === "first";
		},
	};
	const forwarding = forwardSourceTaskSink(() => current);
	const cachedMethod = forwarding.taskIsTerminal;
	assert.ok(cachedMethod);
	assert.equal(await cachedMethod("task"), true);
	generation = "second";
	current = { ...current, taskIsTerminal: async () => false };
	assert.equal(await cachedMethod("task"), false);
});

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
				let sessionCloses = 0;
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
					createTaskSessionHost: () => ({
						async run() {},
						async release() {},
						async close() {
							sessionCloses += 1;
						},
					}),
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
				assert.equal(sessionCloses, failure === "none" ? 0 : 1);
				await fire(handlers, "session_shutdown");
				assert.equal(sessionCloses, 1);
			}
		},
	);
});

test("concurrent runtime shutdowns share the active cleanup barrier", async () => {
	await withEnv(
		{ OUTFITTER_CHANNELS: "test", A2A_SERVER: undefined, OUTFITTER_AGENT_RELAY: undefined },
		async () => {
			const { pi, handlers } = fakePi();
			let runtimeStarts = 0;
			let runtimeCloses = 0;
			let sourceStarts = 0;
			let sourceStops = 0;
			let closeStarted = (): void => {};
			const closing = new Promise<void>((resolve) => {
				closeStarted = resolve;
			});
			let finishClose = (): void => {};
			const closeBlocked = new Promise<void>((resolve) => {
				finishClose = resolve;
			});
			channelsRuntimeExtension(pi, {
				sources: {
					test: {
						configured: () => true,
						load: async () => ({
							async start() {
								sourceStarts += 1;
								return async () => {
									sourceStops += 1;
								};
							},
						}),
					},
				},
				startRuntime: async () => {
					runtimeStarts += 1;
					return running(async () => {
						runtimeCloses += 1;
						closeStarted();
						if (runtimeCloses === 1) await closeBlocked;
					});
				},
				createTaskSessionHost: () => ({
					async run() {},
					async release() {},
					async close() {},
				}),
			});
			await fire(handlers, "session_start");
			assert.equal(sourceStarts, 1);
			const first = fire(handlers, "session_shutdown");
			await closing;
			const restart = fire(handlers, "session_start");
			let secondShutdownResolved = false;
			const secondShutdown = fire(handlers, "session_shutdown").then(() => {
				secondShutdownResolved = true;
			});
			await new Promise((resolve) => setImmediate(resolve));
			assert.equal(runtimeStarts, 1, "restart must wait for the active cleanup barrier");
			assert.equal(secondShutdownResolved, false);
			finishClose();
			await Promise.all([first, restart, secondShutdown]);
			assert.equal(secondShutdownResolved, true);
			assert.equal(runtimeStarts, 1, "the overlapping shutdown must cancel the waiting restart");
			assert.equal(runtimeCloses, 1);
			assert.equal(sourceStarts, 1, "the canceled start event must not restart channel sources");
			assert.equal(sourceStops, 1);

			await fire(handlers, "session_start");
			assert.equal(runtimeStarts, 2, "a later clean start remains available");
			assert.equal(sourceStarts, 2);
			await fire(handlers, "session_shutdown");
			assert.equal(runtimeCloses, 2);
			assert.equal(sourceStops, 2);
		},
	);
});

test("channel restart joins a source startup canceled by shutdown", async () => {
	await withEnv(
		{ OUTFITTER_CHANNELS: "test", A2A_SERVER: undefined, OUTFITTER_AGENT_RELAY: undefined },
		async () => {
			const { pi, handlers } = fakePi();
			let runtimeStarts = 0;
			let runtimeCloses = 0;
			let sourceStarts = 0;
			let sourceStops = 0;
			let sourceStartEntered = (): void => {};
			const sourceStarting = new Promise<void>((resolve) => {
				sourceStartEntered = resolve;
			});
			let finishSourceStart = (): void => {};
			const sourceStartBlocked = new Promise<void>((resolve) => {
				finishSourceStart = resolve;
			});
			channelsRuntimeExtension(pi, {
				sources: {
					test: {
						configured: () => true,
						load: async () => ({
							async start() {
								sourceStarts += 1;
								if (sourceStarts === 1) {
									sourceStartEntered();
									await sourceStartBlocked;
								}
								return async () => {
									sourceStops += 1;
								};
							},
						}),
					},
				},
				startRuntime: async () => {
					runtimeStarts += 1;
					return running(() => {
						runtimeCloses += 1;
					});
				},
				createTaskSessionHost: () => ({
					async run() {},
					async release() {},
					async close() {},
				}),
			});

			const firstStart = fire(handlers, "session_start");
			await sourceStarting;
			const shutdown = fire(handlers, "session_shutdown");
			await shutdown;
			const restart = fire(handlers, "session_start");
			const joinedRestart = fire(handlers, "session_start");
			await new Promise((resolve) => setImmediate(resolve));
			assert.equal(runtimeStarts, 2);
			assert.equal(sourceStarts, 1, "the new channel generation must join the old startup");
			finishSourceStart();
			await Promise.all([firstStart, restart, joinedRestart]);
			assert.equal(sourceStarts, 2);
			assert.equal(runtimeStarts, 2, "concurrent restart requests share one new generation");
			assert.equal(sourceStops, 1, "the canceled generation must stop its staged source");
			assert.equal(runtimeCloses, 1);

			await fire(handlers, "session_shutdown");
			assert.equal(sourceStops, 2);
			assert.equal(runtimeCloses, 2);
		},
	);
});

test("concurrent starts join one successful zero-source generation", async () => {
	await withEnv(
		{ OUTFITTER_CHANNELS: undefined, A2A_SERVER: undefined, OUTFITTER_AGENT_RELAY: undefined },
		async () => {
			const { pi, handlers } = fakePi();
			const logs: Readonly<Record<string, unknown>>[] = [];
			let finishRuntimeStart = (): void => {};
			const runtimeStartBlocked = new Promise<void>((resolve) => {
				finishRuntimeStart = resolve;
			});
			let runtimeStarts = 0;
			let configuredChecks = 0;
			channelsRuntimeExtension(pi, {
				log: (record) => logs.push(record),
				sources: {
					test: {
						configured: () => {
							configuredChecks += 1;
							return false;
						},
						load: async () => assert.fail("unconfigured source must not load"),
					},
				},
				startRuntime: async () => {
					runtimeStarts += 1;
					if (runtimeStarts === 1) await runtimeStartBlocked;
					return running();
				},
				createTaskSessionHost: () => ({
					async run() {},
					async release() {},
					async close() {},
				}),
			});
			const first = fire(handlers, "session_start");
			const second = fire(handlers, "session_start");
			finishRuntimeStart();
			await Promise.all([first, second]);
			assert.equal(runtimeStarts, 1);
			assert.equal(configuredChecks, 1, "the successful zero-source generation runs once");
			assert.equal(
				logs.filter((record) => record.event === "channels_ready").length,
				2,
				"both lifecycle events observe the one successful generation",
			);
			await fire(handlers, "session_shutdown");
		},
	);
});

test("a canceled source-start rejection does not close its replacement task plane", async () => {
	await withEnv(
		{ OUTFITTER_CHANNELS: "test", A2A_SERVER: undefined, OUTFITTER_AGENT_RELAY: undefined },
		async () => {
			const { pi, handlers } = fakePi();
			let runtimeStarts = 0;
			let runtimeCloses = 0;
			let sourceStarts = 0;
			let sourceStartEntered = (): void => {};
			const sourceStarting = new Promise<void>((resolve) => {
				sourceStartEntered = resolve;
			});
			let rejectSourceStart = (): void => {};
			const sourceStartBlocked = new Promise<void>((_resolve, reject) => {
				rejectSourceStart = () => reject(new Error("canceled source failed"));
			});
			channelsRuntimeExtension(pi, {
				sources: {
					test: {
						configured: () => true,
						load: async () => ({
							async start() {
								sourceStarts += 1;
								if (sourceStarts === 1) {
									sourceStartEntered();
									await sourceStartBlocked;
								}
								return async () => {};
							},
						}),
					},
				},
				startRuntime: async () => {
					runtimeStarts += 1;
					return running(() => {
						runtimeCloses += 1;
					});
				},
				createTaskSessionHost: () => ({
					async run() {},
					async release() {},
					async close() {},
				}),
			});

			const firstStart = fire(handlers, "session_start");
			await sourceStarting;
			await fire(handlers, "session_shutdown");
			const restart = fire(handlers, "session_start");
			await new Promise((resolve) => setImmediate(resolve));
			assert.equal(runtimeStarts, 2);
			rejectSourceStart();
			await Promise.all([firstStart, restart]);
			assert.equal(sourceStarts, 2);
			assert.equal(runtimeCloses, 1, "the canceled generation must not close runtime two");

			await fire(handlers, "session_shutdown");
			assert.equal(runtimeCloses, 2);
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
			A2A_HOST: "0.0.0.0",
			A2A_PORT: "9444",
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
			assert.equal(captured?.agentInterface, "http://0.0.0.0:9444");
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
			assert.deepEqual([...tools.keys()].filter((name) => name.startsWith("a2a_")).sort(), [
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

test("Task tools use startup authority and source access while replay opens a Task session", async () => {
	await withEnv(
		{ OUTFITTER_CHANNELS: "test", A2A_SERVER: "1", OUTFITTER_AGENT_RELAY: undefined },
		async () => {
			const { pi, handlers, tools } = fakePi();
			const loaded = running();
			let sessionToolNames: string[] = [];
			const task = {
				id: "replayed",
				contextId: "context-replayed",
				status: { state: "TASK_STATE_WORKING" as const, timestamp: new Date().toISOString() },
				history: [],
			};
			Object.assign(loaded.taskPlane, {
				taskStore: {
					async lookup(taskId: string) {
						return taskId === task.id ? { principal: "p", task } : undefined;
					},
				},
			});
			Object.assign(loaded.wakeQueue, {
				hasAuthority: async (taskId: string) => taskId === task.id,
				sourceForTask: () => "a2a",
			});
			let readDuringStartup = false;
			let sourceSinkWorkedDuringStartup = false;
			Object.assign(loaded.sourceSink, {
				taskIsTerminal: async (taskId: string) => taskId === "during-startup",
			});
			channelsRuntimeExtension(pi, {
				sources: {
					test: {
						configured: () => true,
						load: async () => ({ start: async () => async () => {} }),
						loadActions: async (_journal, sourceSink) => {
							sourceSinkWorkedDuringStartup =
								(await sourceSink.taskIsTerminal?.("during-startup")) === true;
							return {
								read: async (locator: string) => ({ locator, messages: [] }),
							} as never;
						},
					},
				},
				createTaskSessionHost: (options) => {
					sessionToolNames = options.customTools.map((tool) => tool.name).sort();
					return {
						async run() {},
						async release() {},
						async close() {},
					};
				},
				startRuntime: async (_pi, dependencies) => {
					dependencies.taskPlaneReady?.(loaded.taskPlane, loaded.wakeQueue, loaded.sourceSink);
					await tools.get("a2a_read_task")?.execute("call", { taskId: task.id });
					await tools.get("channel_read")?.execute("call", { locator: "test:v1:item" });
					readDuringStartup = true;
					return loaded;
				},
			});
			assert.deepEqual(await fire(handlers, "session_start"), []);
			assert.equal(readDuringStartup, true);
			assert.equal(sourceSinkWorkedDuringStartup, true);
			assert.deepEqual(sessionToolNames, [
				"a2a_complete_task",
				"a2a_read_task",
				"a2a_require_input",
				"channel_read",
				"channel_respond",
			]);
			assert.ok(tools.has("channel_publish"), "top-level resident keeps publication tools");
			assert.ok(tools.has("agent_list"), "top-level resident keeps agent discovery tools");
			assert.ok(tools.has("agent_send"), "top-level resident keeps outbound agent tools");
			await fire(handlers, "session_shutdown");
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
			let finishTurn: (() => void) | undefined;
			Object.assign(pi, {
				sendUserMessage: () => assert.fail("coordinator must not run inference"),
			});
			let runtime: RunningChannelsRuntime | undefined;
			channelsRuntimeExtension(pi, {
				createTaskSessionHost: () => ({
					async run(_taskId, prompt) {
						prompts.push(prompt);
						await new Promise<void>((resolve) => {
							finishTurn = resolve;
						});
					},
					async release() {},
					async close() {
						finishTurn?.();
					},
				}),
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
			await waitFor(() => prompts.length === 1);
			const requireInput = tools.get("a2a_require_input");
			assert.ok(requireInput);
			await assert.rejects(
				requireInput.execute("call", { taskId: accepted.taskId, question: "more?" }),
				/source has no continuation method/,
			);
			await tools.get("a2a_complete_task")?.execute("call", {
				taskId: accepted.taskId,
				response: "done",
				outcome: "completed",
			});
			finishTurn?.();
			await fire(handlers, "session_shutdown");
		},
	);
});

test("native-only deployment registers task tools and settles a Task end to end", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-native-tools-"));
	await withEnv(
		{
			OUTFITTER_CHANNELS: "",
			A2A_SERVER: undefined,
			CHANNELS_TASK_STORE_PATH: root,
			OUTFITTER_AGENT_RELAY: undefined,
		},
		async () => {
			const { pi, handlers, tools } = fakePi();
			const prompts: string[] = [];
			let finishTurn: (() => void) | undefined;
			Object.assign(pi, {
				sendUserMessage: () => assert.fail("coordinator must not run inference"),
			});
			let runtime: RunningChannelsRuntime | undefined;
			channelsRuntimeExtension(pi, {
				createTaskSessionHost: () => ({
					async run(_taskId, prompt) {
						prompts.push(prompt);
						await new Promise<void>((resolve) => {
							finishTurn = resolve;
						});
					},
					async release() {},
					async close() {
						finishTurn?.();
					},
				}),
				startRuntime: async (runtimePi, dependencies) => {
					runtime = await startChannelsRuntime(runtimePi, dependencies);
					return runtime;
				},
			});
			await fire(handlers, "session_start");
			assert.deepEqual([...tools.keys()].filter((name) => name.startsWith("a2a_")).sort(), [
				"a2a_complete_task",
				"a2a_read_task",
				"a2a_require_input",
			]);
			const accepted = await runtime?.sourceSink.accept({
				principal: "slack:test",
				source: "slack",
				providerEventId: "event:native-only",
				nativeLocator: { channelLocator: "slack:v1:native-only" },
				receivedAt: "2026-08-15T12:00:00.000Z",
				providerDedupeKey: "event:native-only",
				parts: [{ text: "work" }],
				contentDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			});
			assert.ok(accepted && runtime);
			await waitFor(() => prompts.length === 1);
			const read = await tools.get("a2a_read_task")?.execute("call", {
				taskId: accepted.taskId,
			});
			assert.ok(read, "read succeeds without a before_agent_start callback");
			await tools.get("a2a_complete_task")?.execute("call", {
				taskId: accepted.taskId,
				response: "done",
				outcome: "completed",
			});
			assert.equal(
				(await runtime.taskPlane.taskStore.lookup(accepted.taskId))?.task.status.state,
				"TASK_STATE_COMPLETED",
			);
			finishTurn?.();
			const journal = await readFile(join(root, "activation-journal.v1.jsonl"), "utf8");
			assert.equal(journal.match(/"kind":"WOKEN"/g)?.length, 1);
			await fire(handlers, "session_shutdown");
		},
	);
});

test("A2A tools fail closed after a channel failure clears the runtime", async () => {
	await withEnv(
		{ OUTFITTER_CHANNELS: "test", A2A_SERVER: "1", OUTFITTER_AGENT_RELAY: undefined },
		async () => {
			const { pi, handlers, tools } = fakePi();
			let sessionCloses = 0;
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
				createTaskSessionHost: () => ({
					async run() {},
					async release() {},
					async close() {
						sessionCloses += 1;
					},
				}),
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
			assert.equal(sessionCloses, 1);
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
