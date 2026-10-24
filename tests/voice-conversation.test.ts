import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	FileVoiceJournal,
	MainPiConversation,
	type VoiceJournal,
} from "../extensions/voice/conversation.ts";

const scope = { callId: "call-1", organizationId: "org-1", userId: "user-1" };
const expiresAt = Date.now() + 60000;
function fixture(journal?: VoiceJournal) {
	const records: unknown[] = [];
	const store = journal ?? {
		read: () => structuredClone(records) as ReturnType<VoiceJournal["read"]>,
		append: (record: unknown) => {
			records.push(structuredClone(record));
		},
	};
	const sent: string[] = [];
	let idle = true;
	const adapter = new MainPiConversation(
		store,
		{
			idle: () => idle,
			send: (text) => {
				sent.push(text);
				idle = false;
			},
		},
		["voice"],
	);
	const request = (path: string, body: Record<string, unknown> = {}) =>
		adapter.handle(path, "voice", { ...scope, ...body });
	return {
		adapter,
		request,
		records,
		sent,
		store,
		idle: () => {
			idle = true;
		},
	};
}
test("exact text, durable queued receipt, deduplication and serial main session turns", async () => {
	const f = fixture();
	f.request("/voice/lease", { expiresAt });
	const text = "  exact ai-outfitter/webapp\ntext  ";
	assert.deepEqual(f.request("/voice/turns", { turnId: "one", text }), {
		turnId: "one",
		state: "queued",
	});
	assert.equal(f.sent.length, 0);
	assert.equal(f.records.length, 2);
	await Promise.resolve();
	assert.deepEqual(f.sent, [text]);
	f.request("/voice/turns", { turnId: "one", text });
	assert.throws(() => f.request("/voice/turns", { turnId: "one", text: "changed" }), /conflict/);
	f.request("/voice/turns", { turnId: "two", text: "next" });
	await Promise.resolve();
	assert.equal(f.sent.length, 1);
	f.adapter.beforeStart(text);
	f.adapter.userMessage(text);
	f.adapter.text("resident answer");
	f.adapter.status("tool-running");
	f.adapter.end(false);
	f.adapter.settled();
	f.idle();
	f.adapter.pump();
	assert.deepEqual(f.sent, [text, "next"]);
	const result = f.request("/voice/turns/poll", { turnId: "one", afterSeq: 0 }) as {
		events: { seq: number; type: string }[];
	};
	assert.deepEqual(
		result.events.map((event) => event.seq),
		[1, 2, 3, 4, 5],
	);
	assert.equal(result.events.at(-1)?.type, "terminal");
});
test("caller lease and turn history stay bound even under same service credential", () => {
	const f = fixture();
	f.request("/voice/lease", { expiresAt });
	f.request("/voice/turns", { turnId: "one", text: "private" });
	assert.throws(
		() => f.adapter.handle("/voice/lease", "forge", { ...scope, expiresAt }),
		/principal/,
	);
	assert.throws(() => f.request("/voice/lease", { userId: "other", expiresAt }), /busy/);
	assert.throws(
		() => f.request("/voice/turns/poll", { userId: "other", turnId: "one", afterSeq: 0 }),
		/not found/,
	);
	assert.throws(
		() => f.request("/voice/turns", { callId: "other", turnId: "one", text: "private" }),
		/not found/,
	);
});
test("release during work never cancels accepted turns or frees lease early", async () => {
	const f = fixture();
	f.request("/voice/lease", { expiresAt });
	f.request("/voice/turns", { turnId: "one", text: "first" });
	f.request("/voice/turns", { turnId: "two", text: "second" });
	f.request("/voice/lease/release");
	await Promise.resolve();
	assert.deepEqual(f.sent, ["first"]);
	assert.throws(() => f.request("/voice/lease", { callId: "other", expiresAt }), /busy/);
	f.adapter.beforeStart("first");
	f.adapter.userMessage("first");
	f.adapter.end(false);
	f.adapter.settled();
	f.idle();
	f.adapter.pump();
	assert.deepEqual(f.sent, ["first", "second"]);
	f.adapter.beforeStart("second");
	f.adapter.userMessage("second");
	f.adapter.end(false);
	f.adapter.settled();
	f.idle();
	f.adapter.pump();
	assert.deepEqual(f.request("/voice/lease", { callId: "other", expiresAt }), { leased: true });
});
test("restart marks queued and running uncertain, never replays; original owner can poll", async () => {
	const f = fixture();
	f.request("/voice/lease", { expiresAt });
	f.request("/voice/turns", { turnId: "running", text: "one" });
	f.request("/voice/turns", { turnId: "queued", text: "two" });
	await Promise.resolve();
	f.adapter.close();
	const recovered = fixture(f.store);
	recovered.adapter.pump();
	assert.deepEqual(recovered.sent, []);
	for (const turnId of ["running", "queued"]) {
		assert.deepEqual(
			recovered.request("/voice/turns", { turnId, text: turnId === "running" ? "one" : "two" }),
			{ turnId, state: "uncertain" },
		);
		const page = recovered.request("/voice/turns/poll", { turnId, afterSeq: 0 }) as {
			events: { state?: string }[];
		};
		assert.equal(page.events.at(-1)?.state, "uncertain");
	}
});
test("correlation mismatch exposes no foreign response and fails closed", async () => {
	const f = fixture();
	f.request("/voice/lease", { expiresAt });
	f.request("/voice/turns", { turnId: "one", text: "own" });
	await Promise.resolve();
	f.adapter.beforeStart("foreign");
	f.adapter.text("foreign secret");
	f.adapter.end(false);
	f.adapter.settled();
	const page = f.request("/voice/turns/poll", { turnId: "one", afterSeq: 0 });
	assert.ok(!JSON.stringify(page).includes("foreign secret"));
	assert.ok(JSON.stringify(page).includes("uncertain"));
});
test("poll pages have contiguous sequences and bounded UTF8 bytes/text", async () => {
	const f = fixture();
	f.request("/voice/lease", { expiresAt });
	f.request("/voice/turns", { turnId: "one", text: "own" });
	await Promise.resolve();
	f.adapter.beforeStart("own");
	f.adapter.userMessage("own");
	f.adapter.text("🙂".repeat(20000));
	f.adapter.end(false);
	f.adapter.settled();
	let cursor = 0;
	let count = 0;
	for (;;) {
		const page = f.request("/voice/turns/poll", { turnId: "one", afterSeq: cursor }) as {
			events: { seq: number; text?: string }[];
		};
		assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 16000);
		assert.ok(page.events.length <= 32);
		if (!page.events.length) break;
		for (const event of page.events) {
			assert.equal(event.seq, ++cursor);
			if (event.text) assert.ok(event.text.length <= 2048);
			count++;
		}
	}
	assert.ok(count > 10);
	assert.throws(() => f.request("/voice/turns/poll", { turnId: "one", afterSeq: -1 }), /cursor/);
});
test("disk journal survives without Pi audit flush and rejects torn records", () => {
	const path = join(mkdtempSync(join(tmpdir(), "voice-journal-")), "journal.jsonl");
	const journal = new FileVoiceJournal(path, () => {});
	const f = fixture(journal);
	f.request("/voice/lease", { expiresAt });
	f.request("/voice/turns", { turnId: "one", text: "durable" });
	f.adapter.close();
	assert.match(readFileSync(path, "utf8"), /durable/);
	const g = fixture(new FileVoiceJournal(path, () => {}));
	assert.deepEqual(g.sent, []);
	appendFileSync(path, "{torn");
	assert.throws(() => fixture(new FileVoiceJournal(path, () => {})), /JSON/);
});

test("journal failure prevents dispatch and further admission", async () => {
	let fail = false;
	const records: ReturnType<VoiceJournal["read"]> = [];
	const f = fixture({
		read: () => records,
		append: (record) => {
			if (fail) throw new Error("disk full");
			records.push(structuredClone(record));
		},
	});
	f.request("/voice/lease", { expiresAt });
	fail = true;
	assert.throws(() => f.request("/voice/turns", { turnId: "one", text: "never run" }), /disk full/);
	await Promise.resolve();
	assert.deepEqual(f.sent, []);
	assert.throws(
		() => f.request("/voice/turns", { turnId: "one", text: "never run" }),
		/unavailable/,
	);
});

test("foreign user input during an owned run is uncertain, never forwarded", async () => {
	const f = fixture();
	f.request("/voice/lease", { expiresAt });
	f.request("/voice/turns", { turnId: "one", text: "own" });
	await Promise.resolve();
	f.adapter.beforeStart("own");
	f.adapter.userMessage("own");
	f.adapter.text("own answer");
	f.adapter.userMessage("foreign prompt");
	f.adapter.text("foreign answer");
	f.adapter.end(false);
	f.idle();
	f.adapter.settled();
	const result = JSON.stringify(f.request("/voice/turns/poll", { turnId: "one", afterSeq: 0 }));
	assert.match(result, /own answer/);
	assert.match(result, /uncertain/);
	assert.doesNotMatch(result, /foreign answer/);
});

test("preflight with no hooks becomes uncertain and quarantines instead of replaying or exposing late work", async () => {
	const f = fixture();
	f.request("/voice/lease", { expiresAt });
	f.request("/voice/turns", { turnId: "one", text: "same" });
	f.request("/voice/turns", { turnId: "two", text: "same" });
	await Promise.resolve();
	f.idle();
	f.adapter.checkDispatch();
	assert.match(
		JSON.stringify(f.request("/voice/turns/poll", { turnId: "one", afterSeq: 0 })),
		/uncertain/,
	);
	assert.throws(() => f.request("/voice/lease", { callId: "other", expiresAt }), /quarantined/);
	f.adapter.pump();
	assert.equal(f.sent.length, 1);
	f.adapter.beforeStart("same");
	f.adapter.userMessage("same");
	f.adapter.messageRole("assistant");
	f.adapter.text("late old answer");
	assert.doesNotMatch(
		JSON.stringify(f.request("/voice/turns/poll", { turnId: "one", afterSeq: 0 })),
		/late old/,
	);
	f.adapter.end(false);
	f.adapter.settled();
	assert.equal(f.sent.length, 1);
});

test("foreign custom input after assistant start invalidates correlation", async () => {
	const f = fixture();
	f.request("/voice/lease", { expiresAt });
	f.request("/voice/turns", { turnId: "one", text: "own" });
	await Promise.resolve();
	f.adapter.beforeStart("own");
	f.adapter.userMessage("own");
	f.adapter.messageRole("custom"); // allowed initial extension context
	f.adapter.messageRole("assistant");
	f.adapter.text("own answer");
	f.adapter.messageRole("custom");
	f.adapter.text("foreign secret");
	const result = JSON.stringify(f.request("/voice/turns/poll", { turnId: "one", afterSeq: 0 }));
	assert.match(result, /uncertain/);
	assert.doesNotMatch(result, /foreign secret/);
});

test("retry status distinguishes failed attempt text from subsequent resident answer", async () => {
	const f = fixture();
	f.request("/voice/lease", { expiresAt });
	f.request("/voice/turns", { turnId: "one", text: "own" });
	await Promise.resolve();
	f.adapter.beforeStart("own");
	f.adapter.userMessage("own");
	f.adapter.messageRole("assistant");
	f.adapter.text("partial");
	f.adapter.end(true);
	f.adapter.messageRole("assistant");
	f.adapter.text("full answer");
	f.adapter.end(false);
	f.idle();
	f.adapter.settled();
	const page = f.request("/voice/turns/poll", { turnId: "one", afterSeq: 0 }) as {
		events: { type: string; state?: string }[];
	};
	assert.ok(page.events.some((event) => event.state === "retrying"));
	assert.equal(page.events.at(-1)?.state, "completed");
});

test("small text deltas are batched, output capped, audit failure does not lose durable acceptance", async () => {
	const f = fixture();
	f.request("/voice/lease", { expiresAt });
	f.request("/voice/turns", { turnId: "one", text: "own" });
	await Promise.resolve();
	f.adapter.beforeStart("own");
	f.adapter.userMessage("own");
	const before = f.records.length;
	for (let index = 0; index < 1000; index++) f.adapter.text("x");
	assert.equal(f.records.length, before);
	f.adapter.flushText();
	assert.equal(f.records.length, before + 1);
	f.adapter.text("x".repeat(256 * 1024));
	assert.match(
		JSON.stringify(f.request("/voice/turns/poll", { turnId: "one", afterSeq: 0 })),
		/uncertain/,
	);
	const path = join(mkdtempSync(join(tmpdir(), "voice-audit-")), "journal.jsonl");
	const g = fixture(
		new FileVoiceJournal(path, () => {
			throw new Error("audit unavailable");
		}),
	);
	g.request("/voice/lease", { expiresAt });
	assert.deepEqual(g.request("/voice/turns", { turnId: "audit", text: "accepted" }), {
		turnId: "audit",
		state: "queued",
	});
	await Promise.resolve();
	assert.deepEqual(g.sent, ["accepted"]);
	g.adapter.close();
});

test("unrelated settle during dispatch quarantines pending preflight", async () => {
	const f = fixture();
	f.request("/voice/lease", { expiresAt });
	f.request("/voice/turns", { turnId: "one", text: "yes" });
	f.request("/voice/turns", { turnId: "two", text: "yes" });
	await Promise.resolve();
	f.idle();
	f.adapter.settled();
	assert.equal(f.sent.length, 1);
	assert.match(
		JSON.stringify(f.request("/voice/turns/poll", { turnId: "one", afterSeq: 0 })),
		/uncertain/,
	);
	assert.throws(() => f.request("/voice/lease", { expiresAt }), /quarantined/);
	f.adapter.settled();
	f.adapter.pump();
	assert.equal(f.sent.length, 1, "unrelated later settle cannot prove pending preflight ended");
});

test("finished turn watchdog cannot quarantine a subsequent healthy preflight", async (context) => {
	context.mock.timers.enable({ apis: ["setTimeout"] });
	const f = fixture();
	f.request("/voice/lease", { expiresAt });
	f.request("/voice/turns", { turnId: "one", text: "one" });
	await Promise.resolve();
	context.mock.timers.tick(9000);
	f.adapter.beforeStart("one");
	f.adapter.userMessage("one");
	f.adapter.end(false);
	f.idle();
	f.adapter.settled();
	f.request("/voice/turns", { turnId: "two", text: "two" });
	await Promise.resolve();
	context.mock.timers.tick(1000);
	assert.deepEqual(f.request("/voice/turns", { turnId: "two", text: "two" }), {
		turnId: "two",
		state: "running",
	});
	f.adapter.beforeStart("two");
	f.adapter.userMessage("two");
	f.adapter.end(false);
	f.idle();
	f.adapter.settled();
	f.adapter.close();
});
