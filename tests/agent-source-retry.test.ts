import assert from "node:assert/strict";
import test from "node:test";
import type { AgentTransport } from "../extensions/agent/types.ts";
import { createAgentSource } from "../extensions/sources/agent.ts";

const config = { endpointId: "link:vega", principalId: "link:vega", spoolPath: "" };

function transportWith(subscribe: AgentTransport["subscribe"]): AgentTransport {
	return {
		endpoint: { id: "link:vega", principal: "link:vega" },
		subscribe,
		async close() {},
	} as unknown as AgentTransport;
}

test("agent source retries the initial subscribe with backoff", async () => {
	let attempts = 0;
	let listener: ((messageId: string) => void) | undefined;
	const transport = transportWith(async (onMessage) => {
		attempts += 1;
		if (attempts < 3) throw new Error("relay not listening yet");
		listener = onMessage;
		return async () => {};
	});
	const events: string[] = [];
	const source = createAgentSource(config, () => transport, undefined, 5);
	const stop = await source.start((event) => events.push(event.locator?.key ?? ""));

	assert.equal(attempts, 1, "first attempt fails inline without throwing");
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.equal(attempts, 3, "kept retrying until subscribe succeeded");
	assert.ok(listener, "listener attached after retry");
	listener?.("message-1");
	assert.equal(events.length, 1, "events flow after recovery");
	await stop();
});

test("stopping during retry cancels cleanly and closes the transport", async () => {
	let attempts = 0;
	let closed = false;
	const transport = {
		endpoint: { id: "link:vega", principal: "link:vega" },
		async subscribe() {
			attempts += 1;
			throw new Error("always down");
		},
		async close() {
			closed = true;
		},
	} as unknown as AgentTransport;
	const source = createAgentSource(config, () => transport, undefined, 5);
	const stop = await source.start(() => {});
	await stop();
	const attemptsAtStop = attempts;
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.equal(attempts, attemptsAtStop, "no further attempts after stop");
	assert.ok(closed, "transport closed on stop");
});
