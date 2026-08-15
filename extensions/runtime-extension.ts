import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RunningA2aServer } from "./a2a/server.ts";
import { type A2aToolAccess, createA2aRuntimeListener, registerA2aTools } from "./a2a-extension.ts";
import channelEventsExtension, { type SourceRegistration } from "./index.ts";
import relayExtension from "./relay-extension.ts";
import { type RunningChannelsRuntime, startChannelsRuntime } from "./task-plane/runtime.ts";

export interface ChannelsRuntimeExtensionDependencies {
	readonly startRuntime?: typeof startChannelsRuntime;
	readonly sources?: Readonly<Record<string, SourceRegistration>>;
	readonly log?: (record: Readonly<Record<string, unknown>>) => void;
}

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
		const store = runtime?.taskPlane.taskStore;
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
	if (listener) {
		registerA2aTools(
			pi,
			taskAccess,
			async (taskId) => runtime?.wakeQueue.hasAuthority(taskId) ?? false,
			(taskId) => {
				const queue = runtime?.wakeQueue;
				return queue !== undefined && queue.sourceForTask(taskId) === "a2a";
			},
		);
	}

	// Register the task plane first. Pi dispatches lifecycle hooks in
	// registration order, so the durable local plane is ready before any
	// source or optional listener can accept work.
	if (taskPlaneEnabled || listener) {
		pi.on("session_start", async () => {
			if (runtime) {
				taskPlaneHealthy = runtime.healthy;
				return;
			}
			if (starting) return starting;
			stopped = false;
			taskPlaneHealthy = false;
			starting = (async () => {
				const taskPlaneRoot =
					process.env.CHANNELS_TASK_STORE_PATH?.trim() ||
					join(
						process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share"),
						"outfitter",
						"channels",
						"task-plane",
					);
				const loaded = await startRuntime(pi, {
					storePath: join(taskPlaneRoot, "tasks.json"),
					originStorePath: join(taskPlaneRoot, "origins.json"),
					agentInterface: process.env.A2A_PUBLIC_URL?.trim() || "http://127.0.0.1:8788",
					// Channel sources receive the guarded sink from this runtime after it opens.
					sources: [],
					...(listener ? { listener } : {}),
					log,
				});
				if (stopped) await loaded.close();
				else {
					runtime = loaded;
					taskPlaneHealthy = loaded.healthy;
				}
			})();
			try {
				await starting;
			} finally {
				starting = undefined;
			}
		});
	}
	pi.on("before_agent_start", async (event) => runtime?.wakeQueue.beforeAgentStart(event.prompt));
	pi.on("agent_end", () => runtime?.wakeQueue.agentEnd());

	const channels = channelEventsExtension(
		pi,
		() => {
			if (!runtime) throw new Error("task plane is not running");
			return runtime.sourceSink;
		},
		dependencies.sources,
		async () => {
			taskPlaneHealthy = false;
			const loaded = runtime;
			runtime = undefined;
			await loaded?.close();
		},
	);

	// Channel shutdown was registered immediately above. Registering the plane
	// shutdown afterward guarantees providers stop before intake closes.
	pi.on("session_shutdown", async () => {
		stopped = true;
		taskPlaneHealthy = false;
		await starting?.catch(() => {});
		const loaded = runtime;
		runtime = undefined;
		await loaded?.close();
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
