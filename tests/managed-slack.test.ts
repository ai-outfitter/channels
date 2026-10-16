import assert from "node:assert/strict";
import test from "node:test";
import {
	managedSlackActions,
	managedSlackFromEnv,
	managedSlackSource,
	readManagedSlack,
} from "../extensions/sources/managed-slack.ts";
import type { SourceTaskActivationSink } from "../extensions/task-plane/types.ts";

const origin = "https://resident.example.test";
const options = {
	url: `${origin}/api/connectors/resident-slack/runtime/config`,
	token: "synthetic-runtime-scoped-credential",
	residentId: "synthetic-resident",
};
const config = {
	residentId: options.residentId,
	workspaceId: "T0123456789",
	revision: "one",
	channelIds: ["C0123456789"],
	inboxUrl: `${origin}/api/connectors/resident-slack/runtime/events`,
	proxyUrl: `${origin}/api/connectors/resident-slack/runtime/slack/`,
};
const sink = {} as SourceTaskActivationSink;
test("managed Slack pins resident and endpoints without accepting provider credentials or arbitrary proxy hosts", async () => {
	let value = config;
	const transport: typeof fetch = async (_input, init) => {
		assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${options.token}`);
		assert.equal(init?.redirect, "error");
		return Response.json(value);
	};
	assert.deepEqual(await readManagedSlack({ ...options, transport }), config);
	value = { ...config, residentId: "another-resident" };
	await assert.rejects(readManagedSlack({ ...options, transport }), /binding mismatch/);
	value = { ...config, proxyUrl: "https://other.example.test/" };
	await assert.rejects(readManagedSlack({ ...options, transport }), /binding mismatch/);
	assert.equal(
		await readManagedSlack({
			...options,
			transport: async () => new Response("Not configured", { status: 409 }),
		}),
		null,
	);
});
test("managed Slack actions check current grants on every operation and stop after disconnect", async () => {
	let enabled = true;
	let reads = 0;
	const transport: typeof fetch = async () => {
		reads++;
		return enabled ? Response.json(config) : new Response("Not connected", { status: 409 });
	};
	const actions = managedSlackActions({ ...options, transport }, sink);
	const locator = `slack:v1:${Buffer.from(JSON.stringify({ c: "C9999999999", m: "1000.000001" })).toString("base64url")}`;
	await assert.rejects(actions.read(locator), /not granted/);
	enabled = false;
	await assert.rejects(actions.respond(locator, "hello"), /not granted/);
	assert.equal(reads, 2);
});
test("a disconnected managed Slack source waits without blocking or requiring Socket Mode", async () => {
	let calls = 0;
	const stop = await managedSlackSource(
		{
			...options,
			pollMs: 5,
			transport: async () => {
				calls++;
				return new Response("Not connected", { status: 409 });
			},
		},
		sink,
	).start(() => {});
	const deadline = Date.now() + 1000;
	while (calls < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
	await stop();
	const stopped = calls;
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(calls, stopped);
	assert.ok(calls >= 2);
});
test("managed Slack configuration requires a pinned resident and HTTPS platform path", () => {
	const previous = {
		url: process.env.OUTFITTER_SLACK_CONFIG_URL,
		token: process.env.OUTFITTER_SLACK_RUNTIME_TOKEN,
		resident: process.env.OUTFITTER_RESIDENT_ID,
	};
	try {
		process.env.OUTFITTER_SLACK_CONFIG_URL = "https://resident.example.test/wrong";
		process.env.OUTFITTER_SLACK_RUNTIME_TOKEN = options.token;
		process.env.OUTFITTER_RESIDENT_ID = options.residentId;
		assert.throws(() => managedSlackFromEnv(), /Invalid managed Slack endpoint/);
		process.env.OUTFITTER_SLACK_CONFIG_URL = options.url;
		assert.equal(managedSlackFromEnv()?.residentId, options.residentId);
	} finally {
		for (const [env, value] of [
			["OUTFITTER_SLACK_CONFIG_URL", previous.url],
			["OUTFITTER_SLACK_RUNTIME_TOKEN", previous.token],
			["OUTFITTER_RESIDENT_ID", previous.resident],
		] as const) {
			if (value === undefined) delete process.env[env];
			else process.env[env] = value;
		}
	}
});

test("a changed inbox revision cannot silently acknowledge a newly granted channel", async () => {
	const { pollSlackInbox } = await import("../extensions/sources/slack.ts");
	let requests = 0;
	const transport: typeof fetch = async () => {
		requests++;
		return Response.json({
			residentId: options.residentId,
			workspaceId: config.workspaceId,
			revision: "new-revision",
			events: [
				{
					eventId: "event-new-channel",
					body: {
						type: "event_callback",
						team_id: config.workspaceId,
						event_id: "event-new-channel",
						event: {
							type: "app_mention",
							channel: "C9999999999",
							ts: "1000.000001",
							user: "U0123456789",
						},
					},
				},
			],
		});
	};
	await assert.rejects(
		pollSlackInbox(
			{
				appToken: "",
				botToken: options.token,
				inboxUrl: config.inboxUrl,
				inboxToken: options.token,
				inboxRevision: "old-revision",
				residentId: options.residentId,
				workspaceId: config.workspaceId,
				channelIds: new Set(config.channelIds),
			},
			sink,
			new AbortController().signal,
			transport,
		),
		/configuration changed/,
	);
	assert.equal(requests, 1);
});
