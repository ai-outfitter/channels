import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	registerResidentActionTools,
	residentActionClient,
} from "../extensions/resident-actions.ts";

const endpoint = "http://127.0.0.1:4141/v1/resident-actions";
test("resident action tools are opt-in and require the exact active task before and after invocation", async () => {
	const tools = new Map<string, ToolDefinition>();
	const pi = {
		registerTool: (tool: ToolDefinition) => {
			tools.set(tool.name, tool);
		},
	} as ExtensionAPI;
	registerResidentActionTools(pi, async () => true, "");
	assert.equal(tools.size, 0);
	let active = "task";
	const calls: RequestInit[] = [];
	registerResidentActionTools(
		pi,
		async (taskId) => taskId === active,
		endpoint,
		async (_url, options) => {
			assert.ok(options);
			calls.push(options);
			return Response.json({ apps: [] });
		},
	);
	assert.deepEqual([...tools.keys()], ["list_app_actions", "call_app_action"]);
	const list = tools.get("list_app_actions");
	assert.ok(list);
	const input = {
		taskId: "other",
		attemptId: "11111111-1111-4111-8111-111111111111",
		targetId: "resident",
	};
	await assert.rejects(
		list.execute("call", input, undefined, undefined, {} as never),
		/active turn/,
	);
	assert.equal(calls.length, 0);
	input.taskId = "task";
	assert.deepEqual((await list.execute("call", input, undefined, undefined, {} as never)).details, {
		apps: [],
	});
	assert.deepEqual(JSON.parse(calls[0]?.body as string), { ...input, operation: "list" });
	assert.deepEqual(calls[0]?.headers, { "Content-Type": "application/json" });
	assert.equal(calls[0]?.redirect, "manual");
	let checks = 0;
	registerResidentActionTools(
		pi,
		async () => ++checks === 1,
		endpoint,
		async () => Response.json({ private: true }),
	);
	const changed = tools.get("list_app_actions");
	assert.ok(changed);
	await assert.rejects(
		changed.execute("call", input, undefined, undefined, {} as never),
		/active turn/,
	);
	active = "";
	await assert.rejects(
		list.execute("call", input, undefined, undefined, {} as never),
		/active turn/,
	);
});

test("resident action client refuses URL escape, redirect/error bodies, oversized responses and forwards cancellation", async () => {
	for (const url of [
		"https://outside.example/v1/resident-actions",
		`${endpoint}?token=secret`,
		`${endpoint}/extra`,
		"http://user:secret@127.0.0.1:4141/v1/resident-actions",
		"http://127.0.0.1:4141/other",
	])
		assert.throws(() => residentActionClient(url), /loopback/);
	for (const status of [302, 403, 500]) {
		const client = residentActionClient(
			endpoint,
			async () => new Response("sensitive provider details", { status }),
		);
		await assert.rejects(
			client({}),
			(error: unknown) =>
				error instanceof Error && error.message === `Resident action refused (${status})`,
		);
	}
	const oversized = residentActionClient(
		endpoint,
		async () => new Response("x".repeat(1024 * 1024 + 1)),
	);
	await assert.rejects(oversized({}), /too large/);
	const malformed = residentActionClient(endpoint, async () => new Response("not JSON"));
	await assert.rejects(malformed({}), /Invalid resident/);
	const abort = new AbortController();
	abort.abort();
	const client = residentActionClient(endpoint, async (_url, options) => {
		assert.ok(options?.signal);
		assert.equal(options.signal.aborted, true);
		throw options.signal.reason;
	});
	await assert.rejects(client({}, abort.signal));
});
