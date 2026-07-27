import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RelayServerConfig, RunningRelay } from "../extensions/relay/server.ts";
import relayServerExtension from "../extensions/relay-extension.ts";

type LifecycleHandler = () => Promise<void> | void;

function fakePi(): {
	readonly handlers: Map<string, LifecycleHandler>;
	readonly pi: ExtensionAPI;
} {
	const handlers = new Map<string, LifecycleHandler>();
	const pi = {
		on(event: string, handler: LifecycleHandler) {
			handlers.set(event, handler);
		},
	} as unknown as ExtensionAPI;
	return { handlers, pi };
}

const CONFIG: RelayServerConfig = {
	host: "127.0.0.1",
	port: 0,
	storePath: "/workspace/.channels/relay/store.json",
	credentials: [],
	allowInsecureLoopback: true,
};

test("relay profile extension is inert unless explicitly enabled", () => {
	const { handlers, pi } = fakePi();
	relayServerExtension(pi, { enabled: () => false });
	assert.equal(handlers.size, 0);
});

test("relay profile starts once, stops once, and never needs an agent-turn API", async () => {
	const { handlers, pi } = fakePi();
	let starts = 0;
	let closes = 0;
	const logs: Array<Readonly<Record<string, unknown>>> = [];
	const running: RunningRelay = {
		url: "wss://relay.test/v1/connect",
		async close() {
			closes += 1;
		},
	};
	relayServerExtension(pi, {
		enabled: () => true,
		loadConfig: async () => CONFIG,
		start: async () => {
			starts += 1;
			return running;
		},
		log: (record) => logs.push(record),
	});

	await handlers.get("session_start")?.();
	await handlers.get("session_start")?.();
	await handlers.get("session_shutdown")?.();
	await handlers.get("session_shutdown")?.();

	assert.equal(starts, 1);
	assert.equal(closes, 1);
	assert.deepEqual(
		logs.map((record) => record.event),
		["relay_profile_started", "relay_profile_stopped"],
	);
});

test("relay profile closes a server whose startup races session shutdown", async () => {
	const { handlers, pi } = fakePi();
	let resolveStart = (_relay: RunningRelay): void => {};
	const started = new Promise<RunningRelay>((resolve) => {
		resolveStart = resolve;
	});
	let closes = 0;
	relayServerExtension(pi, {
		enabled: () => true,
		loadConfig: async () => CONFIG,
		start: async () => started,
		log: () => {},
	});

	const startup = handlers.get("session_start")?.();
	const shutdown = handlers.get("session_shutdown")?.();
	resolveStart({
		url: "wss://relay.test/v1/connect",
		async close() {
			closes += 1;
		},
	});
	await Promise.all([startup, shutdown]);
	assert.equal(closes, 1);
});
