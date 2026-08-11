import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { OriginStore } from "../extensions/origins/store.ts";
import {
	activationFromMessage,
	activationMetadata,
	type ChannelActivationInput,
	digestParts,
	OUTFITTER_ORIGIN_EXTENSION_URI,
	type TaskLocator,
} from "../extensions/origins/types.ts";

const cleanups: Array<() => Promise<void>> = [];
after(async () => {
	for (const cleanup of cleanups.reverse()) await cleanup();
});

async function storePath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "origin-store-test-"));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	return join(directory, "origins.json");
}

function activation(overrides: Partial<ChannelActivationInput> = {}): ChannelActivationInput {
	const parts = [{ text: "untrusted Slack message" }];
	return {
		sourceKind: "slack",
		providerEventId: "Ev123",
		nativeLocator: {
			workspace: "T123",
			channel: "C123",
			messageTs: "1712345678.000100",
			threadTs: "1712345678.000100",
		},
		receivedAt: "2026-08-11T12:00:00.000Z",
		dedupeKey: "Ev123",
		contentDigest: digestParts(parts),
		correlationKey: "slack:T123:C123:1712345678.000100",
		sourceSummary: "Slack mention",
		nativeUrl: "https://example.slack.com/archives/C123/p1712345678000100",
		...overrides,
	};
}

const TASK: TaskLocator = {
	agentInterface: "https://relay.example/agents/resident-a",
	protocolBinding: "HTTP+JSON",
	protocolVersion: "1.0",
	taskId: "task-123",
};

test("activation metadata is versioned and binds the exact A2A content digest", () => {
	const parts = [{ text: "untrusted Slack message" }];
	const input = activation();
	const message = {
		messageId: "message-1",
		role: "ROLE_USER" as const,
		parts,
		extensions: [OUTFITTER_ORIGIN_EXTENSION_URI],
		metadata: activationMetadata(input),
	};
	assert.deepEqual(activationFromMessage(message), input);
	assert.throws(
		() => activationFromMessage({ ...message, parts: [{ text: "edited body" }] }),
		/contentDigest does not match/,
	);
});

test("the origin store keeps immutable activation, decision, and task edges", async () => {
	const store = new OriginStore(await storePath());
	const first = await store.recordActivation("slack-bot", activation());
	const duplicate = await store.recordActivation("slack-bot", activation());
	assert.equal(duplicate.id, first.id);
	await assert.rejects(
		() =>
			store.recordActivation(
				"slack-bot",
				activation({ contentDigest: `sha256:${"0".repeat(64)}` }),
			),
		/conflicts with its activation/,
	);
	const decision = await store.recordDecision(first.id, {
		action: "create",
		reasonCode: "no-correlated-nonterminal-task",
		decider: { kind: "policy", id: "channels-source-router", version: "1" },
	});
	const origin = await store.recordOrigin(first.id, "created", TASK);
	assert.equal(origin.activationId, first.id);
	assert.equal(
		(await store.correlatedTask("slack-bot", "slack", activation().correlationKey as string))
			?.taskId,
		TASK.taskId,
	);

	const activationTrace = await store.activationTrace(new Set(["slack-bot"]), first.id);
	assert.equal(activationTrace?.decision?.id, decision.id);
	assert.equal(activationTrace?.origins[0]?.task.taskId, TASK.taskId);
	const taskTrace = await store.taskTrace(new Set(["slack-bot"]), TASK);
	assert.equal(taskTrace?.origins[0]?.activation.nativeLocator.messageTs, "1712345678.000100");
	assert.equal(await store.taskTrace(new Set(["other-principal"]), TASK), undefined);
});

test("origin trace survives restart", async () => {
	const path = await storePath();
	const first = new OriginStore(path);
	const recorded = await first.recordActivation("slack-bot", activation());
	await first.recordDecision(recorded.id, {
		action: "create",
		reasonCode: "no-correlated-nonterminal-task",
		decider: { kind: "policy", id: "channels-source-router", version: "1" },
	});
	await first.recordOrigin(recorded.id, "created", TASK);
	first.close();
	const second = new OriginStore(path);
	const trace = await second.taskTrace(new Set(["slack-bot"]), TASK);
	assert.equal(trace?.origins[0]?.activation.id, recorded.id);
});
