import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { it } from "node:test";
import {
	handleSlackInbox,
	type ResidentSlackBinding,
	type SlackInboxEnv,
} from "../extensions/slack-inbox/worker.ts";
import { pollSlackInbox, type SlackConfig } from "../extensions/sources/slack.ts";
import type { SourceTaskActivationSink } from "../extensions/task-plane/types.ts";

const binding: ResidentSlackBinding = {
	organizationId: "org-a",
	residentId: "resident-a",
	workspaceId: "TEXAMPLE",
	appId: "AEXAMPLE",
	signingSecret: "synthetic-signing-secret",
	deliveryToken: "synthetic-delivery-a",
	channelIds: ["CTEST"],
};
const event = {
	type: "event_callback",
	api_app_id: binding.appId,
	team_id: binding.workspaceId,
	event_id: "EvEXAMPLE",
	event: {
		type: "app_mention",
		user: "UHUMAN",
		channel: "CTEST",
		ts: "1234567890.123456",
		text: "<@UBOT> verify task intake",
	},
};
function signed(
	body: unknown,
	timestamp = Math.floor(Date.now() / 1000).toString(),
	secret = binding.signingSecret,
) {
	const raw = JSON.stringify(body);
	const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex")}`;
	return new Request("https://inbox.example/slack/events", {
		method: "POST",
		body: raw,
		headers: { "x-slack-request-timestamp": timestamp, "x-slack-signature": signature },
	});
}
function fixture() {
	const database = new DatabaseSync(":memory:");
	database.exec(readFileSync(new URL("../deploy/slack-inbox/0001.sql", import.meta.url), "utf8"));
	const env: SlackInboxEnv = {
		SLACK_RESIDENT_BINDINGS: JSON.stringify([
			binding,
			{
				...binding,
				organizationId: "org-b",
				residentId: "resident-b",
				appId: "AOTHER",
				signingSecret: "other-signing",
				deliveryToken: "synthetic-delivery-b",
			},
		]),
		DB: {
			prepare(sql) {
				let values: (string | number)[] = [];
				return {
					bind(...input) {
						values = input;
						return this;
					},
					async run() {
						return database.prepare(sql).run(...values);
					},
					async all<T>() {
						return { results: database.prepare(sql).all(...values) as T[] };
					},
				};
			},
		},
	};
	const get = (token: string) =>
		handleSlackInbox(
			new Request("https://inbox.example/events", {
				headers: { Authorization: `Bearer ${token}` },
			}),
			env,
		);
	return { database, env, get };
}
it("verifies signatures and deduplicates retries while isolating resident delivery and acknowledgements", async () => {
	const { database, env, get } = fixture();
	try {
		assert.equal(
			(await handleSlackInbox(signed(event, undefined, "wrong-secret"), env)).status,
			401,
		);
		assert.equal((await handleSlackInbox(signed(event, "1"), env)).status, 401);
		assert.equal((await handleSlackInbox(signed(event), env)).status, 200);
		assert.equal((await handleSlackInbox(signed(event), env)).status, 200);
		assert.equal(database.prepare("SELECT count(*) AS n FROM resident_slack_events").get()?.n, 1);
		assert.equal((await get("wrong-token")).status, 401);
		assert.deepEqual(await (await get("synthetic-delivery-b")).json(), {
			residentId: "resident-b",
			workspaceId: binding.workspaceId,
			events: [],
		});
		assert.deepEqual(await (await get(binding.deliveryToken)).json(), {
			residentId: binding.residentId,
			workspaceId: binding.workspaceId,
			events: [{ eventId: event.event_id, body: event }],
		});
		const ack = (token: string) =>
			handleSlackInbox(
				new Request("https://inbox.example/events/ack", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ eventIds: [event.event_id] }),
				}),
				env,
			);
		await ack("synthetic-delivery-b");
		assert.equal(
			((await (await get(binding.deliveryToken)).json()) as { events: unknown[] }).events.length,
			1,
		);
		await ack(binding.deliveryToken);
		assert.deepEqual(await (await get(binding.deliveryToken)).json(), {
			residentId: binding.residentId,
			workspaceId: binding.workspaceId,
			events: [],
		});
		await handleSlackInbox(signed(event), env);
		assert.deepEqual(await (await get(binding.deliveryToken)).json(), {
			residentId: binding.residentId,
			workspaceId: binding.workspaceId,
			events: [],
		});
	} finally {
		database.close();
	}
});
it("ignores bot loops and disallowed channels, expires delivery, and fails acknowledgement on storage errors", async () => {
	const { database, env, get } = fixture();
	try {
		for (const change of [{ bot_id: "BBOT" }, { channel: "COTHER" }, { subtype: "bot_message" }])
			await handleSlackInbox(signed({ ...event, event: { ...event.event, ...change } }), env);
		assert.deepEqual(await (await get(binding.deliveryToken)).json(), {
			residentId: binding.residentId,
			workspaceId: binding.workspaceId,
			events: [],
		});
		await handleSlackInbox(signed(event), env);
		database.prepare("UPDATE resident_slack_events SET createdAt=?").run(Date.now() - 86_400_001);
		assert.deepEqual(await (await get(binding.deliveryToken)).json(), {
			residentId: binding.residentId,
			workspaceId: binding.workspaceId,
			events: [],
		});
		const broken = {
			...env,
			DB: {
				prepare() {
					throw new Error("storage unavailable");
				},
			},
		};
		assert.equal((await handleSlackInbox(signed(event), broken)).status, 503);
		assert.deepEqual(
			await (
				await handleSlackInbox(signed({ type: "url_verification", challenge: "challenge" }), env)
			).json(),
			{ challenge: "challenge" },
		);
	} finally {
		database.close();
	}
});
it("runtime acknowledges only after durable task acceptance, and retries failed acknowledgements idempotently", async () => {
	const cfg: SlackConfig = {
		appToken: "",
		botToken: "synthetic-bot",
		channelIds: new Set(["CTEST"]),
		inboxUrl: "https://inbox.example/events",
		inboxToken: binding.deliveryToken,
		residentId: binding.residentId,
		workspaceId: binding.workspaceId,
	};
	let accepts = 0,
		acks = 0,
		failAccept = true;
	const sink: SourceTaskActivationSink = {
		async accept(input) {
			assert.equal(input.source, "slack");
			accepts++;
			if (failAccept) throw new Error("not durable");
			return {
				activationId: "activation",
				taskId: "task",
				contextId: "context",
				disposition: "created",
			};
		},
		async continue() {
			throw new Error("unexpected continuation");
		},
	};
	const transport: typeof fetch = async (input, init) => {
		assert.equal(
			new Headers(init?.headers).get("authorization"),
			`Bearer ${binding.deliveryToken}`,
		);
		if (new URL(String(input)).pathname === "/events/ack") {
			acks++;
			return new Response("unavailable", { status: 503 });
		}
		return Response.json({
			residentId: binding.residentId,
			workspaceId: binding.workspaceId,
			events: [{ eventId: event.event_id, body: event }],
		});
	};
	await assert.rejects(
		pollSlackInbox(cfg, sink, new AbortController().signal, transport),
		/not durable/,
	);
	assert.equal(acks, 0);
	failAccept = false;
	await assert.rejects(
		pollSlackInbox(cfg, sink, new AbortController().signal, transport),
		/acknowledgement failed/,
	);
	assert.equal(accepts, 2);
	assert.equal(acks, 1);
});

it("rejects cross-app signatures and malformed requests, and erases acknowledged payloads", async () => {
	const { database, env } = fixture();
	try {
		assert.equal(
			(await handleSlackInbox(signed({ ...event, api_app_id: "AOTHER" }), env)).status,
			401,
		);
		assert.equal((await handleSlackInbox(signed(null), env)).status, 400);
		assert.equal(
			(
				await handleSlackInbox(
					signed({
						...event,
						event_id: "EvSECRET",
						token: "deprecated-secret",
						authorizations: [{ secret: "excluded" }],
					}),
					env,
				)
			).status,
			200,
		);
		const stored = String(database.prepare("SELECT body FROM resident_slack_events").get()?.body);
		assert.doesNotMatch(stored, /deprecated-secret|authorizations/);
		await handleSlackInbox(
			new Request("https://inbox.example/events/ack", {
				method: "POST",
				headers: { Authorization: `Bearer ${binding.deliveryToken}` },
				body: JSON.stringify({ eventIds: ["EvSECRET"] }),
			}),
			env,
		);
		assert.equal(database.prepare("SELECT body FROM resident_slack_events").get()?.body, "{}");
		assert.equal(
			(
				await handleSlackInbox(new Request("https://inbox.example/health"), {
					...env,
					SLACK_RESIDENT_BINDINGS: "broken",
				})
			).status,
			503,
		);
		assert.equal(
			(await handleSlackInbox(signed({ ...event, text: "x".repeat(70000) }), env)).status,
			413,
		);
	} finally {
		database.close();
	}
});

it("selects the shared inbox without a Socket Mode token and fails incomplete configuration explicitly", async () => {
	const { slackConfigFromEnv, createSlackSource } = await import("../extensions/sources/slack.ts");
	const keys = [
		"SLACK_APP_TOKEN",
		"SLACK_BOT_TOKEN",
		"SLACK_CHANNEL_IDS",
		"OUTFITTER_SLACK_EVENTS_URL",
		"OUTFITTER_SLACK_EVENTS_TOKEN",
		"OUTFITTER_RESIDENT_ID",
	];
	const saved = new Map(keys.map((key) => [key, process.env[key]]));
	try {
		delete process.env.SLACK_APP_TOKEN;
		process.env.SLACK_BOT_TOKEN = "xoxb-synthetic";
		process.env.SLACK_CHANNEL_IDS = "CTEST";
		process.env.OUTFITTER_SLACK_EVENTS_URL = "https://inbox.example/events";
		delete process.env.OUTFITTER_SLACK_EVENTS_TOKEN;
		assert.throws(() => slackConfigFromEnv(), /configured together/);
		process.env.OUTFITTER_SLACK_EVENTS_TOKEN = binding.deliveryToken;
		process.env.OUTFITTER_RESIDENT_ID = binding.residentId;
		const cfg = slackConfigFromEnv();
		assert.ok(cfg);
		assert.equal(cfg.appToken, "");
		const { WebClient } = await import("@slack/web-api");
		const web = {
			auth: {
				async test() {
					return { ok: true, user_id: "UBOT", team_id: binding.workspaceId };
				},
			},
		} as unknown as InstanceType<typeof WebClient>;
		let resolvePolled = () => {};
		const polled = new Promise<void>((resolve) => {
			resolvePolled = resolve;
		});
		const source = createSlackSource(
			cfg,
			{
				socket: () => assert.fail("Socket Mode selected"),
				web: () => web,
				inbox: async () => {
					resolvePolled();
					return Response.json({
						residentId: binding.residentId,
						workspaceId: binding.workspaceId,
						events: [],
					});
				},
			},
			0,
			{
				async accept() {
					throw new Error("unexpected work");
				},
				async continue() {
					throw new Error("unexpected continuation");
				},
			},
		);
		const stop = await source.start(() => {});
		try {
			await polled;
		} finally {
			await stop();
		}
	} finally {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

it("records permanent intake rejection and continues with newer mentions", async () => {
	const { A2aError } = await import("../extensions/a2a/types.ts");
	const cfg: SlackConfig = {
		appToken: "",
		botToken: "synthetic-bot",
		channelIds: new Set(["CTEST"]),
		inboxUrl: "https://inbox.example/events",
		inboxToken: binding.deliveryToken,
		residentId: binding.residentId,
		workspaceId: binding.workspaceId,
	};
	let attempts = 0,
		evidence = 0,
		acks = 0;
	const sink: SourceTaskActivationSink = {
		async accept() {
			attempts++;
			if (attempts === 1) throw new A2aError(409, "DUPLICATE_MESSAGE_ID", "conflicting event");
			return {
				activationId: "activation",
				taskId: "task",
				contextId: "context",
				disposition: "created",
			};
		},
		async continue() {
			throw new Error("unexpected continuation");
		},
		async recordEvidence() {
			evidence++;
		},
	};
	const transport: typeof fetch = async (input) => {
		if (new URL(String(input)).pathname === "/events/ack") {
			acks++;
			return new Response("ok");
		}
		return Response.json({
			residentId: binding.residentId,
			workspaceId: binding.workspaceId,
			events: [
				{ eventId: "EvBAD", body: { ...event, event_id: "EvBAD" } },
				{ eventId: "EvGOOD", body: { ...event, event_id: "EvGOOD" } },
			],
		});
	};
	await pollSlackInbox(cfg, sink, new AbortController().signal, transport);
	assert.equal(attempts, 2);
	assert.equal(evidence, 1);
	assert.equal(acks, 2);
});

it("delivers a signed webhook through the durable inbox into a real task store and settles it", async () => {
	const { mkdtemp, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { startChannelsRuntime } = await import("../extensions/task-plane/runtime.ts");
	const root = await mkdtemp(join(tmpdir(), "slack-resident-flow-"));
	const { database, env, get } = fixture();
	let finish = () => {};
	const completed = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const runtime = await startChannelsRuntime(
		{ sendUserMessage: () => assert.fail("coordinator inference") },
		{
			storePath: join(root, "tasks.json"),
			agentInterface: "test",
			sources: [],
			taskTurnRunner: {
				async run(taskId) {
					const stored = await runtime.taskPlane.taskStore.lookup(taskId);
					assert.ok(stored);
					await runtime.taskPlane.taskStore.updateStatus(stored.principal, taskId, {
						state: "TASK_STATE_COMPLETED",
					});
					finish();
				},
				async release() {},
			},
		},
	);
	try {
		assert.equal((await handleSlackInbox(signed(event), env)).status, 200);
		const cfg: SlackConfig = {
			appToken: "",
			botToken: "synthetic-bot",
			channelIds: new Set(["CTEST"]),
			inboxUrl: "https://inbox.example/events",
			inboxToken: binding.deliveryToken,
			residentId: binding.residentId,
			workspaceId: binding.workspaceId,
		};
		const transport: typeof fetch = (input, init) =>
			handleSlackInbox(new Request(String(input), init), env);
		await pollSlackInbox(cfg, runtime.sourceSink, new AbortController().signal, transport);
		await completed;
		const ids = await runtime.taskPlane.taskStore.retainedTaskIds();
		assert.equal(ids.size, 1);
		const id = [...ids][0];
		assert.ok(id);
		assert.equal(
			(await runtime.taskPlane.taskStore.lookup(id))?.task.status.state,
			"TASK_STATE_COMPLETED",
		);
		assert.equal(
			((await (await get(binding.deliveryToken)).json()) as { events: unknown[] }).events.length,
			0,
		);
		await handleSlackInbox(signed(event), env);
		await pollSlackInbox(cfg, runtime.sourceSink, new AbortController().signal, transport);
		assert.equal((await runtime.taskPlane.taskStore.retainedTaskIds()).size, 1);
	} finally {
		await runtime.close();
		database.close();
		await rm(root, { recursive: true, force: true });
	}
});

it("rebinding a resident to another workspace/app cannot read or acknowledge its previous queue", async () => {
	const { database, env, get } = fixture();
	try {
		await handleSlackInbox(signed(event), env);
		const configured = JSON.parse(env.SLACK_RESIDENT_BINDINGS) as ResidentSlackBinding[];
		const first = configured[0];
		assert.ok(first);
		first.workspaceId = "TNEW";
		first.appId = "ANEW";
		env.SLACK_RESIDENT_BINDINGS = JSON.stringify(configured);
		assert.equal(
			((await (await get(binding.deliveryToken)).json()) as { events: unknown[] }).events.length,
			0,
		);
		await handleSlackInbox(
			new Request("https://inbox.example/events/ack", {
				method: "POST",
				headers: { Authorization: `Bearer ${binding.deliveryToken}` },
				body: JSON.stringify({ eventIds: [event.event_id] }),
			}),
			env,
		);
		assert.equal(
			database.prepare("SELECT acknowledgedAt FROM resident_slack_events").get()?.acknowledgedAt,
			null,
		);
		assert.notEqual(database.prepare("SELECT body FROM resident_slack_events").get()?.body, "{}");
	} finally {
		database.close();
	}
});
