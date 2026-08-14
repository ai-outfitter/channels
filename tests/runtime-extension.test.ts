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

type Handler = (...args: never[]) => Promise<void> | void;

function fakePi(): { pi: ExtensionAPI; handlers: Map<string, Handler[]> } {
	const handlers = new Map<string, Handler[]>();
	const pi = {
		on(event: string, handler: Handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerTool() {},
		appendEntry() {},
		sendUserMessage() {},
	} as unknown as ExtensionAPI;
	return { pi, handlers };
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
	};
	return {
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
						return running();
					},
				});
				await fire(handlers, "session_start");
				const health = logs
					.map((record) => record.event)
					.filter((event) => event === "channels_ready" || event === "channels_unhealthy");
				assert.deepEqual(health, [failure === "none" ? "channels_ready" : "channels_unhealthy"]);
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
