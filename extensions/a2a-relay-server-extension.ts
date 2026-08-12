import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type A2aRelayServerConfig,
	a2aRelayConfigFromEnv,
	type RunningA2aRelayServer,
	startA2aRelayServer,
} from "./a2a-relay/server.ts";

export interface A2aRelayServerExtensionDependencies {
	readonly enabled?: () => boolean;
	readonly loadConfig?: () => Promise<A2aRelayServerConfig>;
	readonly start?: (config: A2aRelayServerConfig) => Promise<RunningA2aRelayServer>;
	readonly log?: (record: Readonly<Record<string, unknown>>) => void;
}

function enabledFromEnv(): boolean {
	const value = process.env.A2A_RELAY_SERVER?.trim().toLowerCase();
	return value === "1" || value === "true";
}

/** Hosts the public A2A authority and its private outbound worker connector. */
export default function a2aRelayServerExtension(
	pi: ExtensionAPI,
	dependencies: A2aRelayServerExtensionDependencies = {},
): void {
	const enabled = dependencies.enabled ?? enabledFromEnv;
	if (!enabled()) return;
	const loadConfig = dependencies.loadConfig ?? a2aRelayConfigFromEnv;
	const start = dependencies.start ?? startA2aRelayServer;
	const log = dependencies.log ?? ((record) => console.error(JSON.stringify(record)));
	let running: RunningA2aRelayServer | undefined;
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
			log({
				event: "a2a_relay_started",
				a2aUrl: relay.a2aUrl,
				connectorUrl: relay.connectorUrl,
			});
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
		log({ event: "a2a_relay_stopped" });
	});
}
