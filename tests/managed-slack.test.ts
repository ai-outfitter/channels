import assert from "node:assert/strict";
import test from "node:test";
import {
	managedSlackActions,
	managedSlackFromEnv,
	managedSlackSource,
	readManagedSlack,
} from "../extensions/sources/managed-slack.ts";
import type { SourceTaskActivationSink } from "../extensions/task-plane/types.ts";

const origin = "https://service.example.test";
const options = {
	url: `${origin}/integrations/bot-config`,
	token: "synthetic-runtime-scoped-credential",
	bindingId: "synthetic-resident",
};
const config = {
	bindingId: options.bindingId,
	workspaceId: "T0123456789",
	revision: "one",
	channelIds: ["C0123456789"],
	inboxUrl: `${origin}/inbox/deliveries`,
	proxyUrl: `${origin}/gateway/slack/`,
};
const sink = {} as SourceTaskActivationSink;
test("managed Slack pins binding and endpoints without accepting provider credentials or arbitrary proxy hosts", async () => {
	let value = config;
	const transport: typeof fetch = async (_input, init) => {
		assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${options.token}`);
		assert.equal(init?.redirect, "error");
		return Response.json(value);
	};
	assert.deepEqual(await readManagedSlack({ ...options, transport }), config);
	value = { ...config, bindingId: "another-resident" };
	await assert.rejects(readManagedSlack({ ...options, transport }), /binding mismatch/);
	for (const overrides of [
		{ proxyUrl: "https://other.example.test/" },
		{ inboxUrl: "https://other.example.test/events" },
		{ proxyUrl: `${origin}/proxy` },
		{ inboxUrl: `${origin}/events/` },
		{ proxyUrl: `${origin}/proxy/?token=secret` },
		{ inboxUrl: `https://user:secret@service.example.test/events` },
		{ inboxUrl: `${origin}/events#fragment` },
		{ inboxUrl: `http://service.example.test/events` },
	]) {
		value = { ...config, ...overrides };
		await assert.rejects(readManagedSlack({ ...options, transport }), /binding mismatch/);
	}
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
test("managed Slack configuration requires a pinned binding and HTTPS service URL", () => {
	const previous = {
		url: process.env.SLACK_CONFIG_URL,
		token: process.env.SLACK_CONFIG_TOKEN,
		resident: process.env.SLACK_BINDING_ID,
	};
	try {
		process.env.SLACK_CONFIG_URL = "http://service.example.test/config";
		process.env.SLACK_CONFIG_TOKEN = options.token;
		process.env.SLACK_BINDING_ID = options.bindingId;
		assert.throws(() => managedSlackFromEnv(), /Invalid managed Slack endpoint/);
		process.env.SLACK_CONFIG_URL = options.url;
		assert.equal(managedSlackFromEnv()?.bindingId, options.bindingId);
	} finally {
		for (const [env, value] of [
			["SLACK_CONFIG_URL", previous.url],
			["SLACK_CONFIG_TOKEN", previous.token],
			["SLACK_BINDING_ID", previous.resident],
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
			bindingId: options.bindingId,
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
				bindingId: options.bindingId,
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

test("managed Slack accepts discovered memberships beyond the old twenty-channel selection limit", async () => {
	const channelIds = Array.from({ length: 1500 }, (_, i) => `C${String(i).padStart(10, "0")}`);
	const result = await readManagedSlack({
		...options,
		transport: async () => Response.json({ ...config, channelIds }),
	});
	assert.deepEqual(result?.channelIds, channelIds);
	const converted = { ...config, channelIds: ["G0123456789"] };
	assert.deepEqual(
		(await readManagedSlack({ ...options, transport: async () => Response.json(converted) }))
			?.channelIds,
		converted.channelIds,
	);
	await assert.rejects(
		readManagedSlack({
			...options,
			transport: async () =>
				Response.json({ ...config, channelIds: Array(10_001).fill("C0123456789") }),
		}),
		/binding mismatch/,
	);
});
