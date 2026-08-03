import assert from "node:assert/strict";
import test from "node:test";
import { channelEventKey, wakePrompt } from "../extensions/index.ts";

/**
 * A locator-less wake used to inherit the same "process each item with the
 * channel tools" instruction as a message channel. For a notification poller
 * there is nothing to read: `channel_read` throws "does not support channel
 * tools". Agents followed the instruction, hunted for a locator that was never
 * sent, and ended the turn having called no tools at all.
 */
test("a locator-less wake does not send the agent to the channel tools", () => {
	const prompt = wakePrompt([{ channel: "github", summary: "review_requested" }]);
	assert.ok(prompt.includes("github"), "names the channel that woke the agent");
	assert.ok(
		!prompt.includes("Pass each opaque locator"),
		"must not reference locators it did not send",
	);
	assert.match(prompt, /sent no item locator/i, "names the channel as locator-less");
	assert.match(prompt, /signal that work exists/i, "says the wake is a signal, not a message");
	assert.match(
		prompt,
		/Do not call channel_read or channel_respond/i,
		"names the tools that do not apply, so the agent stops looking for them",
	);
	assert.match(prompt, /skill to find that work/i, "gives the agent somewhere to go instead");
	assert.match(prompt, /untrusted data/i, "keeps the untrusted-content warning");
});

test("a located wake still routes through the channel tools", () => {
	const prompt = wakePrompt([
		{ channel: "slack", summary: "mention", locator: { key: "slack:v1:abc" } },
	]);
	assert.ok(prompt.includes("slack:v1:abc"), "passes the locator through verbatim");
	assert.match(prompt, /channel_read/, "still points at the tool that works here");
	assert.match(prompt, /channel_respond/);
	assert.match(prompt, /untrusted data/i);
	assert.ok(
		!/carries no item locator/i.test(prompt),
		"must not claim there is no locator when one was sent",
	);
});

test("a mixed batch gives every channel a usable route", () => {
	// The queue is global, so one wake can carry a located slack event and a
	// locator-less github one. Branching on the batch as a whole named both
	// channels and then gave the agent a route for only one of them — and the
	// abandoned event was deleted from the queue, not redelivered.
	const prompt = wakePrompt([
		{ channel: "github", summary: "author" },
		{ channel: "slack", summary: "mention", locator: { key: "slack:v1:abc" } },
	]);
	assert.ok(prompt.includes("slack:v1:abc"), "slack keeps its locator");
	assert.match(prompt, /channel_read/, "slack keeps the tool route");
	assert.match(
		prompt,
		/sent no item locator: github/i,
		"github is named as locator-less rather than silently stranded",
	);
	assert.match(prompt, /Use each channel's skill/i, "github gets a route of its own");
});

test("a dedupe-keyed wake carries its trusted summary so signals stay distinguishable", () => {
	// Without the summary a calendar alert reaches the agent as an anonymous
	// jmap ping, indistinguishable from new mail.
	const prompt = wakePrompt([
		{ channel: "jmap", summary: "calendar alert: task-123", dedupeKey: "calendar-alert:task-123" },
	]);
	assert.ok(prompt.includes("jmap (calendar alert: task-123)"));

	// A bare-channel-key event (jmap's "new mail") coalesces every reason onto
	// one entry, so its summary is not positively claimed alongside the keyed
	// alert — but it must not vanish either, or the agent services the alert and
	// never checks its mail, with nothing left to re-raise it.
	const mixed = wakePrompt([
		{ channel: "jmap", summary: "new mail" },
		{ channel: "jmap", summary: "calendar alert: task-123", dedupeKey: "calendar-alert:task-123" },
	]);
	assert.ok(mixed.includes("jmap (calendar alert: task-123; other activity)"));
	assert.ok(!mixed.includes("new mail"), "the coalesced bare-key summary is not claimed");
});

test("a channel that coalesces reasons onto its bare key renders as the bare name", () => {
	// github coalesces review_requested/author/mention onto one bare-channel
	// entry, keeping only the last summary — naming it would positively claim
	// the sole reason for work that may have had several.
	const prompt = wakePrompt([{ channel: "github", summary: "author" }]);
	assert.match(prompt, /sent no item locator: github\./i);
	assert.ok(!prompt.includes("github ("), "no parenthetical summary for a bare-key channel");
	assert.ok(!prompt.includes("author"), "the last-writer summary is not claimed");
});

test("locator-less events coalesce on their dedupe key, never on summary text", () => {
	const mail = channelEventKey({ channel: "jmap", summary: "new mail" });
	const first = channelEventKey({
		channel: "jmap",
		summary: "calendar alert: task-1",
		dedupeKey: "calendar-alert:task-1",
	});
	const second = channelEventKey({
		channel: "jmap",
		summary: "calendar alert: task-2",
		dedupeKey: "calendar-alert:task-2",
	});
	assert.equal(mail, "jmap");
	// The dedupe key is namespaced by channel, like a located key, so two
	// sources cannot collide on the same dedupeKey text.
	assert.equal(first, "jmap:calendar-alert:task-1");
	assert.notEqual(first, mail);
	// Two distinct alerts in one wake window are two distinct pending entries.
	assert.notEqual(first, second);
	// Redelivery of the same alert still coalesces.
	assert.equal(
		first,
		channelEventKey({
			channel: "jmap",
			summary: "calendar alert: task-1",
			dedupeKey: "calendar-alert:task-1",
		}),
	);
	// The key comes from the dedupeKey field, not from sniffing the summary.
	assert.equal(channelEventKey({ channel: "jmap", summary: "calendar alert: task-1" }), "jmap");
	// Located events keep their locator-based key.
	assert.equal(
		channelEventKey({ channel: "slack", summary: "mention", locator: { key: "slack:v1:abc" } }),
		"slack:slack:v1:abc",
	);
});
