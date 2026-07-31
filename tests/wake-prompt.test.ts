import assert from "node:assert/strict";
import test from "node:test";
import { wakePrompt } from "../extensions/index.ts";

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
	assert.match(prompt, /signal that work exists/i, "says the wake is a signal, not a message");
	assert.match(
		prompt,
		/Do not call channel_read or channel_respond/i,
		"names the tools that do not apply, so the agent stops looking for them",
	);
	assert.match(prompt, /find the work/i, "gives the agent somewhere to go instead");
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

test("a mixed batch keeps the located instruction", () => {
	// Any locator in the batch means the channel tools are usable for something.
	const prompt = wakePrompt([
		{ channel: "github", summary: "author" },
		{ channel: "slack", summary: "mention", locator: { key: "slack:v1:abc" } },
	]);
	assert.ok(prompt.includes("github"));
	assert.ok(prompt.includes("slack"));
	assert.match(prompt, /channel_read/);
});
