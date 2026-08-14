import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import a2aExtension from "./a2a-extension.ts";
import channelEventsExtension, { type SourceRegistration } from "./index.ts";
import relayExtension from "./relay-extension.ts";
import { type RunningChannelsRuntime, startChannelsRuntime } from "./task-plane/runtime.ts";

export interface ChannelsRuntimeExtensionDependencies {
	readonly startRuntime?: typeof startChannelsRuntime;
	readonly sources?: Readonly<Record<string, SourceRegistration>>;
	readonly log?: (record: Readonly<Record<string, unknown>>) => void;
}

/**
 * The package's sole Pi entrypoint. Legacy channel and relay behavior remains
 * registered alongside the task plane for the non-breaking 1.8 release; the
 * entrypoint is intentionally stateless so Jiti reloads with moduleCache:false
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
	const selection = process.env.OUTFITTER_CHANNELS?.trim();
	const taskPlaneEnabled = selection !== "off" && selection !== "none";
	const startRuntime = dependencies.startRuntime ?? startChannelsRuntime;
	const log =
		dependencies.log ??
		((record: Readonly<Record<string, unknown>>): void => console.error(JSON.stringify(record)));

	// Register the task plane first. Pi dispatches lifecycle hooks in
	// registration order, so the durable local plane is ready before any
	// compatibility source or optional listener can accept work.
	if (taskPlaneEnabled) {
		pi.on("session_start", async () => {
			if (runtime) {
				taskPlaneHealthy = true;
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
					// Source adapters are injected here by the source-routing commits.
					// Keeping the list empty preserves all legacy source behavior in 1.8.
					sources: [],
					log,
				});
				if (stopped) await loaded.close();
				else {
					runtime = loaded;
					taskPlaneHealthy = true;
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

	const channels = channelEventsExtension(pi, dependencies.sources, () => runtime?.sourceSink);

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
	a2aExtension(pi);
	if (taskPlaneEnabled) {
		pi.on("session_start", () => {
			if (taskPlaneHealthy && channels?.startupSucceeded()) log({ event: "channels_ready" });
			else log({ event: "channels_unhealthy" });
		});
	}
}
