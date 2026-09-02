import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { RunningA2aServer } from "./a2a/server.ts";
import { type A2aToolAccess, createA2aRuntimeListener, registerA2aTools } from "./a2a-extension.ts";
import channelEventsExtension, { type SourceRegistration } from "./index.ts";
import relayExtension from "./relay-extension.ts";
import type { TaskPlane } from "./task-plane/plane.ts";
import { type RunningChannelsRuntime, startChannelsRuntime } from "./task-plane/runtime.ts";
import {
	TaskSessionHost,
	type TaskSessionHostOptions,
	type TaskTurnRunner,
} from "./task-plane/task-sessions.ts";
import type { SourceTaskActivationSink } from "./task-plane/types.ts";

type TaskSessionOwner = TaskTurnRunner & { close(): Promise<void> };

export interface ChannelsRuntimeExtensionDependencies {
	readonly startRuntime?: typeof startChannelsRuntime;
	readonly sources?: Readonly<Record<string, SourceRegistration>>;
	readonly log?: (record: Readonly<Record<string, unknown>>) => void;
	readonly createTaskSessionHost?: (options: TaskSessionHostOptions) => TaskSessionOwner;
}

const CHANNELS_PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The package's sole Pi entrypoint. The relay remains a separate session plane;
 * every work-producing source is composed with the task plane. The entrypoint
 * is intentionally stateless so Jiti reloads with moduleCache:false
 * create an independent runtime rather than consulting a module-global owner.
 */
export default function channelsRuntimeExtension(
	pi: ExtensionAPI,
	dependencies: ChannelsRuntimeExtensionDependencies = {},
): void {
	let runtime: RunningChannelsRuntime | undefined;
	let starting: Promise<void> | undefined;
	let stopped = false;
	let taskPlaneHealthy = false;
	let a2aServer: RunningA2aServer | undefined;
	let taskSessions: TaskSessionOwner | undefined;
	let startingTaskPlane: TaskPlane | undefined;
	let startingWakeQueue: RunningChannelsRuntime["wakeQueue"] | undefined;
	let startingSourceSink: SourceTaskActivationSink | undefined;
	const taskTools: ToolDefinition[] = [];
	const taskToolPi = captureTools(pi, taskTools);
	const selection = process.env.OUTFITTER_CHANNELS?.trim();
	const taskPlaneEnabled = selection !== "off" && selection !== "none";
	const startRuntime = dependencies.startRuntime ?? startChannelsRuntime;
	const log =
		dependencies.log ??
		((record: Readonly<Record<string, unknown>>): void => console.error(JSON.stringify(record)));
	const listener = createA2aRuntimeListener({ log }, (server) => {
		a2aServer = server;
	});
	const taskAccess = (): A2aToolAccess | undefined => {
		if (a2aServer) return a2aServer;
		const store = runtime?.taskPlane.taskStore ?? startingTaskPlane?.taskStore;
		if (!store) return undefined;
		return {
			readTask: async (taskId) => (await store.lookup(taskId))?.task,
			controllerForTask: async (taskId) => {
				const stored = await store.lookup(taskId);
				if (!stored) return undefined;
				let current = stored.task;
				return {
					get task() {
						return current;
					},
					async status(state, message) {
						current = await store.updateStatus(stored.principal, taskId, {
							state,
							...(message ? { message } : {}),
						});
						return current;
					},
					async artifact(artifact) {
						current = await store.addArtifact(stored.principal, taskId, artifact);
						return current;
					},
				};
			},
		};
	};
	if (taskPlaneEnabled || listener) {
		registerA2aTools(
			taskToolPi,
			taskAccess,
			async (taskId) => (runtime?.wakeQueue ?? startingWakeQueue)?.hasAuthority(taskId) ?? false,
			(taskId) => {
				const queue = runtime?.wakeQueue ?? startingWakeQueue;
				return queue !== undefined && queue.sourceForTask(taskId) === "a2a";
			},
		);
	}
	const closeTaskPlane = async (): Promise<void> => {
		const loaded = runtime;
		const sessions = taskSessions;
		runtime = undefined;
		taskSessions = undefined;
		startingTaskPlane = undefined;
		startingWakeQueue = undefined;
		startingSourceSink = undefined;
		try {
			await loaded?.close();
		} finally {
			await sessions?.close();
		}
	};

	// Register the task plane first. Pi dispatches lifecycle hooks in
	// registration order, so the durable local plane is ready before any
	// source or optional listener can accept work.
	if (taskPlaneEnabled || listener) {
		pi.on("session_start", async (_event, context) => {
			if (runtime) {
				taskPlaneHealthy = runtime.healthy;
				return;
			}
			if (starting) return starting;
			stopped = false;
			taskPlaneHealthy = false;
			// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keep coordinator, Task-session host, listener, and shutdown-race startup atomic
			starting = (async () => {
				const taskPlaneRoot =
					process.env.CHANNELS_TASK_STORE_PATH?.trim() ||
					join(
						process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share"),
						"outfitter",
						"channels",
						"task-plane",
					);
				const taskSessionOptions = {
					cwd: context?.cwd ?? process.cwd(),
					sessionDir: join(taskPlaneRoot, "pi-sessions"),
					customTools: taskTools,
					excludedExtensionRoot: CHANNELS_PACKAGE_ROOT,
					log,
				};
				const sessionOwner = dependencies.createTaskSessionHost
					? dependencies.createTaskSessionHost(taskSessionOptions)
					: new TaskSessionHost(taskSessionOptions);
				taskSessions = sessionOwner;
				try {
					const loaded = await startRuntime(pi, {
						storePath: join(taskPlaneRoot, "tasks.json"),
						originStorePath: join(taskPlaneRoot, "origins.json"),
						agentInterface:
							process.env.A2A_PUBLIC_URL?.trim() ||
							`http://${process.env.A2A_HOST?.trim() || "127.0.0.1"}:${process.env.A2A_PORT?.trim() || "8788"}`,
						// Channel sources receive the guarded sink from this runtime after it opens.
						sources: [],
						taskTurnRunner: sessionOwner,
						taskPlaneReady: (taskPlane, wakeQueue, sourceSink) => {
							startingTaskPlane = taskPlane;
							startingWakeQueue = wakeQueue;
							startingSourceSink = sourceSink;
						},
						...(listener ? { listener } : {}),
						log,
					});
					if (stopped) await loaded.close();
					else {
						runtime = loaded;
						startingTaskPlane = undefined;
						startingWakeQueue = undefined;
						startingSourceSink = undefined;
						taskPlaneHealthy = loaded.healthy;
					}
				} catch (error) {
					if (taskSessions === sessionOwner) taskSessions = undefined;
					startingTaskPlane = undefined;
					startingWakeQueue = undefined;
					startingSourceSink = undefined;
					await sessionOwner.close().catch(() => {});
					throw error;
				}
			})();
			try {
				await starting;
			} finally {
				starting = undefined;
				if (!runtime) startingTaskPlane = undefined;
			}
		});
	}
	const channels = channelEventsExtension(
		taskToolPi,
		() => {
			const sourceSink = runtime?.sourceSink ?? startingSourceSink;
			if (!sourceSink) throw new Error("task plane is not running");
			return sourceSink;
		},
		dependencies.sources,
		async () => {
			taskPlaneHealthy = false;
			await closeTaskPlane();
		},
	);

	// Channel shutdown was registered immediately above. Registering the plane
	// shutdown afterward guarantees providers stop before intake closes.
	pi.on("session_shutdown", async () => {
		stopped = true;
		taskPlaneHealthy = false;
		await starting?.catch(() => {});
		await closeTaskPlane();
	});

	relayExtension(pi);
	if (taskPlaneEnabled || listener) {
		pi.on("session_start", () => {
			const selectedChannelsHealthy = !taskPlaneEnabled || channels?.startupSucceeded() === true;
			if (taskPlaneHealthy && selectedChannelsHealthy) log({ event: "channels_ready" });
			else log({ event: "channels_unhealthy" });
		});
	}
}

function captureTools(pi: ExtensionAPI, captured: ToolDefinition[]): ExtensionAPI {
	return new Proxy(pi, {
		get(target, property) {
			if (property === "registerTool") {
				return (tool: ToolDefinition): void => {
					captured.push(tool);
					target.registerTool(tool);
				};
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}
