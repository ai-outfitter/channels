import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	configFromEnv,
	type RelayServerConfig,
	type RunningRelay,
	startRelayServer,
} from "./relay/server.ts";

export interface RelayExtensionDependencies {
	readonly enabled?: () => boolean;
	readonly loadConfig?: () => Promise<RelayServerConfig>;
	readonly start?: (config: RelayServerConfig) => Promise<RunningRelay>;
	readonly log?: (record: Readonly<Record<string, unknown>>) => void;
}

function enabledFromEnv(): boolean {
	const value = process.env.AGENT_RELAY_SERVER?.trim().toLowerCase();
	return value === "1" || value === "true";
}

/**
 * Hosts the authenticated relay inside a resident Pi profile.
 *
 * This extension is inert unless AGENT_RELAY_SERVER is explicitly enabled.
 * Its lifecycle is inference-free: it registers only session hooks and never
 * sends a user message or starts an agent turn.
 */
export default function relayServerExtension(
	pi: ExtensionAPI,
	dependencies: RelayExtensionDependencies = {},
): void {
	const enabled = dependencies.enabled ?? enabledFromEnv;
	if (!enabled()) return;

	const loadConfig = dependencies.loadConfig ?? configFromEnv;
	const start = dependencies.start ?? startRelayServer;
	const log = dependencies.log ?? ((record) => console.error(JSON.stringify(record)));
	let running: RunningRelay | undefined;
	let starting: Promise<void> | undefined;
	let stopped = false;

	pi.on("session_start", async () => {
		if (running) return;
		if (starting) return starting;
		stopped = false;
		starting = (async () => {
			const relay = await start(await loadConfig());
			if (stopped) {
				await relay.close();
				return;
			}
			running = relay;
			log({ event: "relay_profile_started", url: relay.url });
		})();
		try {
			await starting;
		} finally {
			starting = undefined;
		}
	});

	pi.on("session_shutdown", async () => {
		stopped = true;
		await starting?.catch(() => {});
		const relay = running;
		running = undefined;
		if (!relay) return;
		await relay.close();
		log({ event: "relay_profile_stopped" });
	});
}
