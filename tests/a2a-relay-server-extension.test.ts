import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	A2aRelayServerConfig,
	RunningA2aRelayServer,
} from "../extensions/a2a-relay/server.ts";
import a2aRelayServerExtension from "../extensions/a2a-relay-server-extension.ts";
import { fakePi } from "./helpers.ts";

const CONFIG = {} as A2aRelayServerConfig;

test("the A2A relay server extension is inert unless enabled", () => {
	const { handlers, pi } = fakePi();
	a2aRelayServerExtension(pi, { enabled: () => false });
	assert.equal(handlers.size, 0);
});

test("the A2A relay server extension starts and stops once", async () => {
	const { handlers, pi } = fakePi();
	let starts = 0;
	let closes = 0;
	const logs: Array<Readonly<Record<string, unknown>>> = [];
	const running: RunningA2aRelayServer = {
		a2aUrl: "http://127.0.0.1:8788",
		connectorUrl: "http://127.0.0.1:8789",
		async close() {
			closes += 1;
		},
	};
	a2aRelayServerExtension(pi, {
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
		["a2a_relay_started", "a2a_relay_stopped"],
	);
});
