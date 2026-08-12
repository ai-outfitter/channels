import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import channelEventsExtension, { MAX_SIGNAL_ENTRIES_PER_WAKE } from "../extensions/index.ts";
import { createJmapSource } from "../extensions/sources/jmap.ts";
import type { ChannelEvent, ChannelSource } from "../extensions/sources/types.ts";

const ACCOUNT_ID = "account-1";
const CALENDARS_ACCOUNT_ID = "calendars-1";
const RECURRENCE_ID = "2026-08-03T15:00:00Z";
const CONFIG = { baseUrl: "https://jmap.example", user: "user", pass: "pass" };

function calendarAlert(accountId = ACCOUNT_ID, uid: unknown = "task-123"): string {
	return `event: calendarAlert\ndata: ${JSON.stringify({
		accountId,
		calendarEventId: "event-1",
		uid,
		alertId: "alert-1",
		recurrenceId: RECURRENCE_ID,
	})}\n\n`;
}

const STATE_CHANGE = JSON.stringify({
	"@type": "StateChange",
	changed: { [ACCOUNT_ID]: { Email: "state-2" } },
});

function sessionResponse(url: string): Response {
	const response = Response.json({
		eventSourceUrl: "https://jmap.example/events?types={types}&closeafter={closeafter}&ping={ping}",
		primaryAccounts: {
			"urn:ietf:params:jmap:mail": ACCOUNT_ID,
			"urn:ietf:params:jmap:calendars": CALENDARS_ACCOUNT_ID,
		},
	});
	Object.defineProperty(response, "url", { value: url });
	return response;
}

function wakeShape(event: ChannelEvent) {
	const { channel, summary, dedupeKey } = event;
	return { channel, summary, ...(dedupeKey ? { dedupeKey } : {}) };
}

/** An SSE response streaming one chunk per entry of `chunks`, then ending. */
function sseResponse(chunks: string[]): Response {
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
	return new Response(body, { status: 200 });
}

const settle = async (rounds = 10) => {
	for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

/** Poll `condition` instead of sleeping a fixed time, so slow CI cannot flake. */
async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error("timed out waiting for condition");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

/**
 * Drive one connection through the real `createJmapSource().start()` path — the
 * public surface — and collect the events it emits for `chunks`.
 */
async function streamEvents(chunks: string[]): Promise<ChannelEvent[]> {
	const originalFetch = globalThis.fetch;
	const events: ChannelEvent[] = [];
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = String(input);
		if (url.endsWith("/.well-known/jmap")) return sessionResponse(url);
		return sseResponse(chunks);
	}) as typeof fetch;
	try {
		const stop = await createJmapSource(CONFIG).start((event) => events.push(event));
		await settle();
		await stop();
	} finally {
		globalThis.fetch = originalFetch;
	}
	return events;
}

const summariesOf = async (chunks: string[]): Promise<string[]> =>
	(await streamEvents(chunks)).map((event) => event.summary);

test("a calendarAlert frame wakes with the event uid", async () => {
	// The helper's payload recurs, so the occurrence rides the summary as well as
	// the key — two occurrences of one uid must render as two distinct lines.
	assert.deepEqual(await summariesOf([calendarAlert()]), [
		`calendar alert: task-123 (${RECURRENCE_ID})`,
	]);
	assert.deepEqual(
		await summariesOf([
			`event: calendarAlert\ndata: ${JSON.stringify({ accountId: ACCOUNT_ID })}\n\n`,
		]),
		["calendar alert"],
	);
});

test("a uid outside the conservative charset falls back to the generic summary", async () => {
	// Overlong: the charset pattern also bounds length, so nothing is sliced in.
	assert.deepEqual(await summariesOf([calendarAlert(ACCOUNT_ID, "x".repeat(500))]), [
		"calendar alert",
	]);
	// An embedded newline could forge extra lines in the trusted wake message.
	assert.deepEqual(await summariesOf([calendarAlert(ACCOUNT_ID, "task-123\nforged: line")]), [
		"calendar alert",
	]);
	assert.deepEqual(await summariesOf([calendarAlert(ACCOUNT_ID, 42)]), ["calendar alert"]);
	// Every rejected uid gets the same constant key, deliberately: with no uid the
	// source cannot tell two alerts apart, and one honest "a calendar alert fired"
	// entry beats minting keys that claim a distinction it cannot make.
	assert.deepEqual(
		(await streamEvents([calendarAlert(ACCOUNT_ID, "task\n123")])).map((event) => event.dedupeKey),
		["calendar-alert"],
	);
	// So two *distinct* rejected alerts coalesce onto that one queue entry. Pinned
	// rather than incidental: this is the accepted cost of not trusting the uid.
	const events = await streamEvents([
		calendarAlert(ACCOUNT_ID, "task\n123"),
		calendarAlert(ACCOUNT_ID, "x".repeat(500)),
	]);
	assert.deepEqual(events.map(wakeShape), [
		{ channel: "jmap", summary: "calendar alert", dedupeKey: "calendar-alert" },
		{ channel: "jmap", summary: "calendar alert", dedupeKey: "calendar-alert" },
	]);
	assert.equal(new Set(events.map((event) => event.dedupeKey)).size, 1, "one queue entry");
});

test("an Email StateChange wakes regardless of the SSE event name", async () => {
	assert.deepEqual(await summariesOf([`event: state\ndata: ${STATE_CHANGE}\n\n`]), ["new mail"]);
	assert.deepEqual(await summariesOf([`data: ${STATE_CHANGE}\n\n`]), ["new mail"]);
	// The payload's @type/changed shape is the discriminator, not the frame name.
	assert.deepEqual(await summariesOf([`event: ping\ndata: ${STATE_CHANGE}\n\n`]), ["new mail"]);
});

test("Email state changes reconcile to exact durable message activations", async () => {
	const originalFetch = globalThis.fetch;
	const directory = await mkdtemp(join(tmpdir(), "channels-jmap-cursor-"));
	const statePath = join(directory, "email-state.json");
	const apiCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith("/.well-known/jmap")) {
			const response = Response.json({
				apiUrl: "https://jmap.example/api",
				eventSourceUrl:
					"https://jmap.example/events?types={types}&closeafter={closeafter}&ping={ping}",
				primaryAccounts: { "urn:ietf:params:jmap:mail": ACCOUNT_ID },
			});
			Object.defineProperty(response, "url", { value: url });
			return response;
		}
		if (url === "https://jmap.example/api") {
			const request = JSON.parse(String(init?.body)) as {
				methodCalls: [[string, Record<string, unknown>, string]];
			};
			const [name, arguments_, callId] = request.methodCalls[0];
			apiCalls.push({ name, arguments: arguments_ });
			if (name === "Email/get" && Array.isArray(arguments_.ids) && arguments_.ids.length === 0) {
				return Response.json({ methodResponses: [[name, { state: "state-1", list: [] }, callId]] });
			}
			if (name === "Email/changes") {
				return Response.json({
					methodResponses: [
						[
							name,
							{
								oldState: "state-1",
								newState: "state-2",
								hasMoreChanges: false,
								created: ["email-1"],
								updated: [],
								destroyed: [],
							},
							callId,
						],
					],
				});
			}
			return Response.json({
				methodResponses: [
					[
						name,
						{
							state: "state-2",
							list: [
								{
									id: "email-1",
									threadId: "thread-1",
									receivedAt: "2026-08-11T12:34:56Z",
								},
							],
						},
						callId,
					],
				],
			});
		}
		return sseResponse([`event: state\ndata: ${STATE_CHANGE}\n\n`]);
	}) as typeof fetch;

	const events: ChannelEvent[] = [];
	const stop = await createJmapSource({ ...CONFIG, statePath }).start((event) =>
		events.push(event),
	);
	try {
		await waitFor(() => events.some((event) => event.work?.nativeLocator.emailId === "email-1"));
	} finally {
		await stop();
		globalThis.fetch = originalFetch;
	}
	const exact = events.find((event) => event.work?.nativeLocator.emailId === "email-1");
	assert.deepEqual(exact?.work?.nativeLocator, {
		accountId: ACCOUNT_ID,
		emailId: "email-1",
		threadId: "thread-1",
	});
	assert.equal(exact?.work?.receivedAt, "2026-08-11T12:34:56.000Z");
	assert.deepEqual(
		apiCalls.map((call) => call.name),
		["Email/get", "Email/changes", "Email/get"],
	);
	assert.equal(apiCalls[1]?.arguments.sinceState, "state-1");
	assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")), {
		version: 1,
		accountId: ACCOUNT_ID,
		state: "state-2",
	});
});

test("a calendar alert wakes regardless of the SSE event name", async () => {
	// The frame name is Stalwart's, not RFC 8620's, so the payload decides.
	const alert = JSON.stringify({
		accountId: ACCOUNT_ID,
		calendarEventId: "event-1",
		uid: "task-123",
	});
	for (const frame of [
		`event: state\ndata: ${alert}\n\n`,
		`event: calendar_alert\ndata: ${alert}\n\n`,
		`data: ${alert}\n\n`,
	]) {
		assert.deepEqual(await summariesOf([frame]), ["calendar alert: task-123"], frame);
	}
	// An explicit `@type` routes on its own, without the structural match.
	assert.deepEqual(
		await summariesOf([
			`event: push\ndata: ${JSON.stringify({
				"@type": "CalendarAlert",
				accountId: ACCOUNT_ID,
				uid: "task-123",
			})}\n\n`,
		]),
		["calendar alert: task-123"],
	);
});

test("a calendar activation preserves the exact occurrence locator and never correlates schedules", async () => {
	const [event] = await streamEvents([calendarAlert(ACCOUNT_ID, "task-123")]);
	assert.ok(event?.work);
	assert.deepEqual(event?.work?.nativeLocator, {
		accountId: ACCOUNT_ID,
		eventDigest: event.work.nativeLocator.eventDigest,
		calendarEventId: "event-1",
		uid: "task-123",
		recurrenceId: RECURRENCE_ID,
		alertId: "alert-1",
	});
	assert.equal(event?.work?.correlationKey, undefined);
	assert.deepEqual(event?.work?.parts[0]?.data, {
		channel: "jmap",
		kind: "calendar-alert",
		accountId: ACCOUNT_ID,
		eventDigest: event.work.nativeLocator.eventDigest,
		calendarEventId: "event-1",
		uid: "task-123",
		recurrenceId: RECURRENCE_ID,
		alertId: "alert-1",
	});
});

test("a mail StateChange is never routed to the alert path", async () => {
	// `@type` is authoritative in both directions: even under the alert frame
	// name, a StateChange stays mail.
	assert.deepEqual(await summariesOf([`event: calendarAlert\ndata: ${STATE_CHANGE}\n\n`]), [
		"new mail",
	]);
	// A StateChange carrying `changed` but no `@type` is not structurally an alert.
	const untyped = JSON.stringify({
		accountId: ACCOUNT_ID,
		uid: "task-123",
		changed: { [ACCOUNT_ID]: { Email: "state-2" } },
	});
	assert.deepEqual(await summariesOf([`event: state\ndata: ${untyped}\n\n`]), []);
});

test("a recurrenceId lands in the dedupe key so two occurrences stay distinct", async () => {
	// The helper's payload carries a recurrenceId, so the key names the occurrence.
	assert.deepEqual(
		(await streamEvents([calendarAlert()])).map((event) => event.dedupeKey),
		[`calendar-alert:task-123#${RECURRENCE_ID}`],
	);
	// Distinct keys alone are not enough: the wake prompt renders one line per
	// distinct *summary*, so two occupied queue slots that read identically would
	// collapse to one line and waste a slot. The summary names the occurrence too.
	const occurrences = await streamEvents([
		`event: calendarAlert\ndata: ${JSON.stringify({
			accountId: ACCOUNT_ID,
			uid: "task-123",
			recurrenceId: RECURRENCE_ID,
		})}\n\n`,
		`event: calendarAlert\ndata: ${JSON.stringify({
			accountId: ACCOUNT_ID,
			uid: "task-123",
			recurrenceId: "2026-08-04T15:00:00Z",
		})}\n\n`,
	]);
	assert.deepEqual(
		occurrences.map((event) => event.summary),
		[
			`calendar alert: task-123 (${RECURRENCE_ID})`,
			"calendar alert: task-123 (2026-08-04T15:00:00Z)",
		],
	);
	assert.equal(new Set(occurrences.map((event) => event.summary)).size, 2, "two rendered lines");
	// Without one (a non-recurring event), the key is the uid alone.
	const single = `event: calendarAlert\ndata: ${JSON.stringify({
		accountId: ACCOUNT_ID,
		uid: "task-123",
	})}\n\n`;
	assert.deepEqual(
		(await streamEvents([single])).map((event) => event.dedupeKey),
		["calendar-alert:task-123"],
	);
	// A recurrenceId outside the conservative charset stays out of the key.
	const hostile = `event: calendarAlert\ndata: ${JSON.stringify({
		accountId: ACCOUNT_ID,
		uid: "task-123",
		recurrenceId: "forged\nline",
	})}\n\n`;
	assert.deepEqual(
		(await streamEvents([hostile])).map((event) => event.dedupeKey),
		["calendar-alert:task-123"],
	);
});

test("a calendarAlert on the calendars primary account wakes", async () => {
	assert.deepEqual(await summariesOf([calendarAlert(CALENDARS_ACCOUNT_ID)]), [
		`calendar alert: task-123 (${RECURRENCE_ID})`,
	]);
});

test("a calendars account found only by accountCapabilities wakes", async () => {
	// No primaryAccounts entry for calendars — the account is discoverable only by
	// the capability it advertises, which is the fallback branch in fetchSession.
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = String(input);
		if (url.endsWith("/.well-known/jmap")) {
			const response = Response.json({
				eventSourceUrl:
					"https://jmap.example/events?types={types}&closeafter={closeafter}&ping={ping}",
				primaryAccounts: { "urn:ietf:params:jmap:mail": ACCOUNT_ID },
				accounts: {
					[ACCOUNT_ID]: { accountCapabilities: { "urn:ietf:params:jmap:mail": {} } },
					[CALENDARS_ACCOUNT_ID]: {
						accountCapabilities: { "urn:ietf:params:jmap:calendars": {} },
					},
				},
			});
			Object.defineProperty(response, "url", { value: url });
			return response;
		}
		return sseResponse([calendarAlert(CALENDARS_ACCOUNT_ID)]);
	}) as typeof fetch;

	const events: ChannelEvent[] = [];
	const stop = await createJmapSource(CONFIG, 20).start((event) => events.push(event));
	try {
		await waitFor(() => events.length >= 1);
	} finally {
		await stop();
		globalThis.fetch = originalFetch;
	}
	assert.equal(events[0]?.summary, `calendar alert: task-123 (${RECURRENCE_ID})`);
});

test("a calendarAlert for an unknown account is dropped and logged once", async () => {
	const originalError = console.error;
	const logged: string[] = [];
	console.error = (msg: string) => logged.push(msg);
	try {
		// Two frames on the same connection: both dropped, one log line.
		assert.deepEqual(
			await summariesOf([calendarAlert("account-2"), calendarAlert("account-2")]),
			[],
		);
		const dropLogs = logged.filter((msg) => msg.includes("unknown account"));
		assert.equal(dropLogs.length, 1);
		assert.match(dropLogs[0] ?? "", /account-2/, "names the mismatched accountId");
	} finally {
		console.error = originalError;
	}
});

test("a calendarAlert split across read boundaries parses after completion", async () => {
	const whole = calendarAlert();
	const split = "event: calendarAl";
	assert.deepEqual(await summariesOf([split, whole.slice(split.length)]), [
		`calendar alert: task-123 (${RECURRENCE_ID})`,
	]);
});

test("streams calendar-alert and mail events through the public fetch path", async () => {
	// CRLF line endings, per the wire: the reader must normalize them.
	const events = await streamEvents([
		`event: calendarAlert\r\ndata: ${JSON.stringify({ accountId: ACCOUNT_ID, uid: "task-123" })}\r\n\r\n`,
		`event: calendarAlert\r\ndata: ${JSON.stringify({ accountId: ACCOUNT_ID, uid: "task-456" })}\r\n\r\n`,
		// Pushed on the calendars primary account, not the mail account.
		`event: calendarAlert\r\ndata: ${JSON.stringify({ accountId: CALENDARS_ACCOUNT_ID, uid: "task-789" })}\r\n\r\n`,
		`event: state\r\ndata: ${STATE_CHANGE}\r\n\r\n`,
	]);

	assert.deepEqual(events.map(wakeShape), [
		{ channel: "jmap", summary: "calendar alert: task-123", dedupeKey: "calendar-alert:task-123" },
		{ channel: "jmap", summary: "calendar alert: task-456", dedupeKey: "calendar-alert:task-456" },
		{ channel: "jmap", summary: "calendar alert: task-789", dedupeKey: "calendar-alert:task-789" },
		{ channel: "jmap", summary: "new mail" },
	]);
});

/** Start the extension over stub sources and hand back its wake plumbing. */
function startExtension(channels: string[]): {
	emit: (event: ChannelEvent) => boolean;
	prompts: string[];
	fire: (event: string) => Promise<void>;
} {
	const handlers = new Map<string, () => Promise<void> | void>();
	const prompts: string[] = [];
	const emitters = new Map<string, (event: ChannelEvent) => boolean>();
	const sources = Object.fromEntries(
		channels.map((channel) => [
			channel,
			{
				configured: () => true,
				load: async (): Promise<ChannelSource> => ({
					async start(onEvent) {
						emitters.set(channel, onEvent as (event: ChannelEvent) => boolean);
						return async () => {};
					},
				}),
			},
		]),
	);
	channelEventsExtension(
		{
			on(event: string, handler: () => Promise<void> | void) {
				handlers.set(event, handler);
			},
			registerTool() {},
			sendUserMessage(prompt: string) {
				prompts.push(prompt);
			},
		} as never,
		sources,
	);
	return {
		emit: (event) => {
			const send = emitters.get(event.channel);
			assert.ok(send, `channel "${event.channel}" is not started`);
			return send(event);
		},
		prompts,
		fire: async (event) => {
			await handlers.get(event)?.();
		},
	};
}

/** Run `body` with OUTFITTER_CHANNELS pinned to `selection`. */
async function withChannels(selection: string, body: () => Promise<void>): Promise<void> {
	const prior = process.env.OUTFITTER_CHANNELS;
	try {
		process.env.OUTFITTER_CHANNELS = selection;
		await body();
	} finally {
		if (prior === undefined) delete process.env.OUTFITTER_CHANNELS;
		else process.env.OUTFITTER_CHANNELS = prior;
	}
}

test("distinct alerts stay distinct and redelivery coalesces in the real queue", async () => {
	await withChannels("jmap", async () => {
		const { emit, prompts, fire } = startExtension(["jmap"]);
		await fire("session_start");

		// The first event wakes immediately; the alert burst lands while that
		// wake is still in flight and must queue behind it.
		emit({ channel: "jmap", summary: "new mail" });
		assert.equal(prompts.length, 1);

		const alert = (uid: string): ChannelEvent => ({
			channel: "jmap",
			summary: `calendar alert: ${uid}`,
			dedupeKey: `calendar-alert:${uid}`,
		});
		emit(alert("task-123"));
		emit(alert("task-456"));
		// Redelivery of a pending alert coalesces onto its entry.
		emit(alert("task-123"));
		emit({ channel: "jmap", summary: "new mail" });
		assert.equal(prompts.length, 1);

		await fire("agent_end");
		assert.equal(prompts.length, 2);
		const prompt = prompts[1] ?? "";
		assert.equal(prompt.match(/calendar alert: task-123/g)?.length, 1);
		assert.equal(prompt.match(/calendar alert: task-456/g)?.length, 1);
		// The bare-channel-key mail event rides the wake. Its coalesced summary is
		// not positively claimed, but a neutral marker keeps it from being
		// silently dropped while the agent services the named alerts.
		assert.equal(prompt.match(/new mail/g), null);
		assert.ok(prompt.includes("other activity"));
		await fire("session_shutdown");
	});
});

test("an alarm storm is bounded per channel and cannot evict another channel", async () => {
	await withChannels("jmap,github", async () => {
		const { emit, prompts, fire } = startExtension(["jmap", "github"]);
		await fire("session_start");

		// The first event wakes immediately; the storm of distinct dedupe keys
		// lands while that wake is still in flight.
		emit({ channel: "jmap", summary: "new mail" });
		assert.equal(prompts.length, 1);
		for (let i = 0; i < MAX_SIGNAL_ENTRIES_PER_WAKE + 5; i += 1) {
			emit({
				channel: "jmap",
				summary: `calendar alert: storm-${i}`,
				dedupeKey: `calendar-alert:storm-${i}`,
			});
		}
		// Another channel's event is still enqueueable behind the storm.
		assert.equal(emit({ channel: "github", summary: "review_requested" }), true);

		// The first drain carries exactly the cap of keyed jmap entries — and
		// github's event alongside them. The per-wake bound is counted per channel,
		// so jmap's storm spends jmap's allowance, not github's: a quiet channel is
		// never deferred a whole wake by a noisy one.
		await fire("agent_end");
		assert.equal(prompts.length, 2);
		const first = prompts[1] ?? "";
		assert.equal(first.match(/calendar alert: storm-/g)?.length, MAX_SIGNAL_ENTRIES_PER_WAKE);
		assert.match(first, /sent no item locator: jmap \(.*\), github\./);

		// The overflow past the cap collapsed onto one bare `jmap` entry rather
		// than minting 5 more keys, and rides the next wake alone.
		await fire("agent_end");
		assert.equal(prompts.length, 3);
		const remainder = prompts[2] ?? "";
		assert.equal(remainder.match(/calendar alert: storm-/g), null);
		assert.match(remainder, /sent no item locator: jmap\./);

		await fire("agent_end");
		assert.equal(prompts.length, 3, "an empty queue wakes nothing");
		await fire("session_shutdown");
	});
});

/**
 * Classify a subscription URL, asserting its shape rather than inferring it:
 * "email" must be an exact `types=Email`, and no `{…}` template placeholder
 * (`{types}`, `{closeafter}`, `{ping}`) may survive substitution.
 */
const kindOf = (url: string): "session" | "wide" | "email" => {
	if (url.endsWith("/.well-known/jmap")) return "session";
	assert.ok(!/\{[^}]*\}/.test(url), `unsubstituted template placeholder in ${url}`);
	const types = new URL(url).searchParams.get("types");
	if (types === "Email,CalendarAlert") return "wide";
	assert.equal(types, "Email", `unexpected subscription types in ${url}`);
	return "email";
};

// Only statuses that plausibly mean "this push type is unacceptable" downgrade.
// The distinction is load-bearing because the downgraded stream is long-lived
// SSE: it is not re-widened until it drops or idles out, so downgrading on a
// transient failure would silence calendar alarms — which push at most once —
// for as long as the healthy mail stream lasts.
for (const status of [400, 404, 422, 501]) {
	test(`a ${status} on the wider subscription downgrades and mail wakes survive`, async () => {
		const originalFetch = globalThis.fetch;
		const originalError = console.error;
		const logged: string[] = [];
		console.error = (msg: string) => logged.push(msg);
		const calls: string[] = [];
		globalThis.fetch = (async (input: string | URL | Request) => {
			const url = String(input);
			calls.push(url);
			if (kindOf(url) === "session") return sessionResponse(url);
			if (kindOf(url) === "wide") return new Response("rejected", { status });
			// The downgraded Email-only stream still carries real mail pushes.
			return sseResponse([`event: state\r\ndata: ${STATE_CHANGE}\r\n\r\n`]);
		}) as typeof fetch;

		const summaries: string[] = [];
		const stop = await createJmapSource(CONFIG, 20).start((event) => {
			summaries.push(event.summary);
		});
		try {
			// Within the same attempt: the wider subscription is refused, the
			// Email-only stream opens without waiting for a reconnect, and a mail
			// StateChange delivered on it still wakes after the downgrade.
			await waitFor(() => summaries.includes("new mail"));
			assert.deepEqual(calls.slice(0, 3).map(kindOf), ["session", "wide", "email"]);
			// The docs promise the downgrade is logged, and the verification
			// checklist tells the reader to look for it.
			const downgradeLogs = logged.filter((msg) => msg.includes("Email,CalendarAlert"));
			assert.ok(downgradeLogs.length >= 1, "logs the downgrade");
			assert.match(downgradeLogs[0] ?? "", new RegExp(`\\b${status}\\b`), "names the status");
			assert.match(downgradeLogs[0] ?? "", /Email only/, "names the narrowed subscription");
			// The next attempt retries the wider subscription from scratch.
			await waitFor(() => calls.length >= 6);
			assert.deepEqual(calls.slice(0, 6).map(kindOf), [
				"session",
				"wide",
				"email",
				"session",
				"wide",
				"email",
			]);
		} finally {
			// Stop before restoring fetch: a leaked supervise loop would otherwise
			// hit the real network and keep the process alive forever.
			await stop();
			globalThis.fetch = originalFetch;
			console.error = originalError;
		}
	});
}

// Auth, throttling and server faults say nothing about the push *type*: they are
// transient or whole-connection problems. Narrowing on one would trade a brief
// outage for a silently calendar-blind stream that may live for hours, so these
// throw and the supervisor reconnects asking for CalendarAlert again.
for (const status of [401, 403, 429, 503]) {
	test(`a ${status} on the wider subscription throws and reconnects wide`, async () => {
		const originalFetch = globalThis.fetch;
		const calls: string[] = [];
		globalThis.fetch = (async (input: string | URL | Request) => {
			const url = String(input);
			calls.push(url);
			if (kindOf(url) === "session") return sessionResponse(url);
			return new Response("refused", { status });
		}) as typeof fetch;

		const stop = await createJmapSource(CONFIG, 20).start(() => {});
		try {
			await waitFor(() => calls.length >= 4);
			// No Email-only attempt at all — every retry asks for the full
			// subscription, so calendar wakes resume the moment the cause clears.
			assert.deepEqual(calls.slice(0, 4).map(kindOf), ["session", "wide", "session", "wide"]);
			assert.equal(
				calls.map(kindOf).filter((kind) => kind === "email").length,
				0,
				"never downgrades on a transient failure",
			);
		} finally {
			// Stop before restoring fetch: a leaked supervise loop would otherwise
			// hit the real network and keep the process alive forever.
			await stop();
			globalThis.fetch = originalFetch;
		}
	});
}

test("a failure on both subscriptions throws so the supervisor reconnects", async () => {
	const originalFetch = globalThis.fetch;
	const calls: string[] = [];
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = String(input);
		calls.push(url);
		if (kindOf(url) === "session") return sessionResponse(url);
		// A classified downgrade status, but the narrowed subscription fails too.
		return new Response("refused", { status: 400 });
	}) as typeof fetch;

	const stop = await createJmapSource(CONFIG, 20).start(() => {});
	try {
		// Nothing is left to narrow to: the attempt throws and the supervisor
		// reconnects the wider subscription from scratch.
		await waitFor(() => calls.length >= 6);
		assert.deepEqual(calls.slice(0, 6).map(kindOf), [
			"session",
			"wide",
			"email",
			"session",
			"wide",
			"email",
		]);
	} finally {
		await stop();
		globalThis.fetch = originalFetch;
	}
});

// The frame below was captured verbatim from a live Stalwart 0.15.5 server
// (JMAP EventSource, display alarm on a JSCalendar event) on 2026-08-03. It is
// the only evidence in this suite that the wire contract is real rather than
// assumed, so keep it byte-for-byte: `CalendarAlert` is not part of RFC 8620,
// the field names are Stalwart's own, and `recurrenceId` is null — not absent —
// for a non-recurring event.
const CAPTURED_STALWART_ALERT =
	'event: calendarAlert\ndata: {"@type":"CalendarAlert","accountId":"i","calendarEventId":"b","uid":"vega-cron-probe-001","recurrenceId":null,"alertId":"a1"}\n\n';

test("the captured live-Stalwart alert frame wakes with its uid", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = String(input);
		if (url.endsWith("/.well-known/jmap")) {
			// The live account id is "i"; mirror that rather than the synthetic one.
			const response = Response.json({
				eventSourceUrl:
					"https://jmap.example/events?types={types}&closeafter={closeafter}&ping={ping}",
				primaryAccounts: { "urn:ietf:params:jmap:mail": "i" },
				accounts: { i: { accountCapabilities: { "urn:ietf:params:jmap:mail": {} } } },
			});
			// The source resolves the template against the session's own URL.
			Object.defineProperty(response, "url", { value: url });
			return response;
		}
		return Promise.resolve(sseResponse([CAPTURED_STALWART_ALERT]));
	}) as typeof fetch;

	const events: ChannelEvent[] = [];
	const stop = await createJmapSource(CONFIG, 20).start((event) => events.push(event));
	try {
		await waitFor(() => events.length >= 1);
	} finally {
		await stop();
		globalThis.fetch = originalFetch;
	}
	assert.deepEqual(wakeShape(events[0] as ChannelEvent), {
		channel: "jmap",
		summary: "calendar alert: vega-cron-probe-001",
		dedupeKey: "calendar-alert:vega-cron-probe-001",
	});
});
