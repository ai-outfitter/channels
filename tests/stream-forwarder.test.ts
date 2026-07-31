import assert from "node:assert/strict";
import test from "node:test";
import { AgentSessionJournal } from "../extensions/agent/journal.ts";
import type { AgentTransport } from "../extensions/agent/types.ts";
import type { RelayStreamEvent } from "../extensions/relay/protocol.ts";
import { createAgentStreamForwarder, extractJsonStringValue } from "../extensions/sources/agent.ts";

test("extractJsonStringValue decodes partial JSON string values", () => {
	assert.equal(extractJsonStringValue('{"locator":"x"', "response"), undefined);
	assert.equal(extractJsonStringValue('{"response"', "response"), undefined);
	assert.equal(extractJsonStringValue('{"response": "Hel', "response"), "Hel");
	assert.equal(extractJsonStringValue('{"response": "Hi\\n', "response"), "Hi\n");
	assert.equal(extractJsonStringValue('{"response": "A\\', "response"), "A");
	assert.equal(extractJsonStringValue('{"response": "A\\u00e', "response"), "A");
	assert.equal(extractJsonStringValue('{"response": "A\\u00e9B"}', "response"), "AéB");
	assert.equal(extractJsonStringValue('{"response":"done"}', "response"), "done");
});

test("forwarder streams channel_respond argument deltas as text events", async () => {
	const journal = new AgentSessionJournal();
	journal.recordMessage(
		{
			version: 1,
			id: "message-1",
			conversationId: "conversation-1",
			sender: "vega-web",
			recipient: "link:vega",
			createdAt: new Date().toISOString(),
			body: "hello",
		},
		"delivered",
	);
	const streamed: Array<{ messageId: string; event: RelayStreamEvent }> = [];
	const transport = {
		endpoint: { id: "link:vega", principal: "link:vega" },
		async stream(messageId: string, event: RelayStreamEvent) {
			streamed.push({ messageId, event });
		},
	} as unknown as AgentTransport;
	const forward = createAgentStreamForwarder(
		{ endpointId: "link:vega", principalId: "link:vega", spoolPath: "" },
		() => transport,
		journal,
		1,
	);

	const partial = {
		content: [{ type: "toolCall", name: "channel_respond" }],
	};
	const update = (assistantMessageEvent: Record<string, unknown>) =>
		forward({ type: "message_update", message: {}, assistantMessageEvent } as never);

	update({ type: "toolcall_start", contentIndex: 0, partial });
	update({
		type: "toolcall_delta",
		contentIndex: 0,
		delta: '{"locator":"agent:v1:bWVzc2FnZS0x","response":"Hello, ',
		partial,
	});
	update({ type: "toolcall_delta", contentIndex: 0, delta: "world", partial });
	await new Promise((resolve) => setTimeout(resolve, 20));
	update({
		type: "toolcall_end",
		contentIndex: 0,
		toolCall: {
			type: "toolCall",
			id: "call-1",
			name: "channel_respond",
			arguments: { locator: "agent:v1:bWVzc2FnZS0x", response: "Hello, world!" },
		},
		partial,
	});
	await new Promise((resolve) => setTimeout(resolve, 20));

	assert.equal(streamed[0]?.event.type, "text_start");
	const deltas = streamed
		.filter((entry) => entry.event.type === "text_delta")
		.map((entry) => (entry.event as { delta: string }).delta)
		.join("");
	assert.equal(deltas, "Hello, world");
	const last = streamed.at(-1);
	assert.deepEqual(last?.event, {
		type: "text_end",
		contentIndex: 0,
		content: "Hello, world!",
	});
	assert.ok(streamed.every((entry) => entry.messageId === "message-1"));
});

test("forwarder stays silent for non-respond tools and ambiguous targets", async () => {
	const journal = new AgentSessionJournal();
	const streamed: unknown[] = [];
	const transport = {
		endpoint: { id: "link:vega", principal: "link:vega" },
		async stream(_messageId: string, event: RelayStreamEvent) {
			streamed.push(event);
		},
	} as unknown as AgentTransport;
	const forward = createAgentStreamForwarder(
		{ endpointId: "link:vega", principalId: "link:vega", spoolPath: "" },
		() => transport,
		journal,
		1,
	);
	// No open target: nothing streams even for respond tool deltas.
	const respondPartial = { content: [{ type: "toolCall", name: "channel_respond" }] };
	forward({
		type: "message_update",
		message: {},
		assistantMessageEvent: {
			type: "toolcall_delta",
			contentIndex: 0,
			delta: '{"response":"hi"',
			partial: respondPartial,
		},
	} as never);
	// Open target but a different tool: still silent.
	journal.recordMessage(
		{
			version: 1,
			id: "message-2",
			conversationId: "conversation-1",
			sender: "vega-web",
			recipient: "link:vega",
			createdAt: new Date().toISOString(),
			body: "hello",
		},
		"delivered",
	);
	forward({
		type: "message_update",
		message: {},
		assistantMessageEvent: {
			type: "toolcall_delta",
			contentIndex: 0,
			delta: '{"path":"/etc"',
			partial: { content: [{ type: "toolCall", name: "read_file" }] },
		},
	} as never);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(streamed, []);
});

test("stop() drops the pending flush and latches the forwarder off", async () => {
	const journal = new AgentSessionJournal();
	journal.recordMessage(
		{
			version: 1,
			id: "message-1",
			conversationId: "conversation-1",
			sender: "vega-web",
			recipient: "link:vega",
			createdAt: new Date().toISOString(),
			body: "hello",
		},
		"delivered",
	);
	const streamed: RelayStreamEvent[] = [];
	const transport = {
		endpoint: { id: "link:vega", principal: "link:vega" },
		async stream(_messageId: string, event: RelayStreamEvent) {
			streamed.push(event);
		},
	} as unknown as AgentTransport;
	// A long flush window keeps the delta buffered until stop() runs.
	const forward = createAgentStreamForwarder(
		{ endpointId: "link:vega", principalId: "link:vega", spoolPath: "" },
		() => transport,
		journal,
		60_000,
	);
	const partial = { content: [{ type: "toolCall", name: "channel_respond" }] };
	forward({
		type: "message_update",
		message: {},
		assistantMessageEvent: {
			type: "toolcall_start",
			contentIndex: 0,
			partial,
		},
	} as never);
	forward({
		type: "message_update",
		message: {},
		assistantMessageEvent: {
			type: "toolcall_delta",
			contentIndex: 0,
			delta: '{"locator":"agent:v1:bWVzc2FnZS0x","response":"buffered text',
			partial,
		},
	} as never);
	assert.deepEqual(streamed, [{ type: "text_start", contentIndex: 0 }]);

	forward.stop();
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(streamed, [{ type: "text_start", contentIndex: 0 }], "flushed after stop");

	// Events after stop are ignored entirely — a late turn cannot re-open
	// anything once the session released its transports.
	forward({
		type: "message_update",
		message: {},
		assistantMessageEvent: {
			type: "toolcall_delta",
			contentIndex: 0,
			delta: ' and more"',
			partial,
		},
	} as never);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(streamed, [{ type: "text_start", contentIndex: 0 }], "emitted after stop");
});
