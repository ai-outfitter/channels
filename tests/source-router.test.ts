import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { A2aSendMessageRequest, A2aSendMessageResponse } from "../extensions/a2a/types.ts";
import { SourceRouter } from "../extensions/source-router.ts";

test("the source router persists before delivery and removes only an accepted send", async () => {
	const directory = await mkdtemp(join(tmpdir(), "channels-source-router-"));
	const path = join(directory, "outbox.json");
	const requests: A2aSendMessageRequest[] = [];
	let fail = true;
	const router = await SourceRouter.start(
		{
			async sendMessage(request): Promise<A2aSendMessageResponse> {
				requests.push(request);
				if (fail) throw new Error("offline");
				return {
					task: {
						id: "task-1",
						contextId: "context-1",
						status: { state: "TASK_STATE_SUBMITTED" },
					},
				};
			},
		},
		path,
		5,
	);
	const event = {
		channel: "slack",
		summary: "new mention",
		work: {
			providerEventId: "Ev123",
			nativeLocator: { workspaceId: "T1", channelId: "C1", messageTs: "1.2" },
			receivedAt: "2026-08-11T12:00:00.000Z",
			dedupeKey: "slack:C1:1.2",
			correlationKey: "slack:C1:1.2",
			sourceSummary: "new mention",
			parts: [{ text: "please inspect this" }],
		},
	};
	assert.equal(await router.accept(event), true);
	await waitFor(() => requests.length >= 1);
	const queued = JSON.parse(await readFile(path, "utf8")) as { entries: unknown[] };
	assert.equal(queued.entries.length, 1);

	fail = false;
	await waitFor(async () => {
		const current = JSON.parse(await readFile(path, "utf8")) as { entries: unknown[] };
		return current.entries.length === 0;
	});
	assert.ok(requests.length >= 2);
	assert.equal(requests[0]?.message.messageId, requests.at(-1)?.message.messageId);
	assert.deepEqual(requests[0]?.message.parts, [{ text: "please inspect this" }]);
	await router.close();
});

test("redelivery with the same provider event id is one outbox entry", async () => {
	const directory = await mkdtemp(join(tmpdir(), "channels-source-router-"));
	const path = join(directory, "outbox.json");
	const router = await SourceRouter.start(
		{
			async sendMessage(): Promise<A2aSendMessageResponse> {
				throw new Error("offline");
			},
		},
		path,
		60_000,
	);
	const event = {
		channel: "github",
		summary: "assigned_issue",
		work: {
			providerEventId: "thread-1-at-2",
			nativeLocator: { threadId: "1" },
			receivedAt: "2026-08-11T12:00:00.000Z",
			dedupeKey: "thread-1-at-2",
			sourceSummary: "assigned_issue",
			parts: [{ data: { notificationId: "1" } }],
		},
	};
	await router.accept(event);
	await router.accept(event);
	const queued = JSON.parse(await readFile(path, "utf8")) as { entries: unknown[] };
	assert.equal(queued.entries.length, 1);
	await router.close();
});

test("native delivery is persisted and reported against the accepted task", async () => {
	const directory = await mkdtemp(join(tmpdir(), "channels-source-router-"));
	const path = join(directory, "outbox.json");
	const reports: Array<{ taskId: string; delivery: { state: string; responseId?: string } }> = [];
	const router = await SourceRouter.start(
		{
			async sendMessage(): Promise<A2aSendMessageResponse> {
				return {
					task: {
						id: "task-native-1",
						contextId: "context-1",
						status: { state: "TASK_STATE_SUBMITTED" },
					},
				};
			},
		},
		path,
		5,
		{
			async report(taskId, delivery) {
				reports.push({ taskId, delivery });
			},
		},
	);
	await router.accept({
		channel: "slack",
		summary: "new mention",
		work: {
			providerEventId: "Ev-native",
			nativeLocator: { channelLocator: "slack:v1:opaque" },
			receivedAt: "2026-08-11T12:00:00.000Z",
			dedupeKey: "Ev-native",
			sourceSummary: "new mention",
			parts: [{ data: { channel: "slack", locator: "slack:v1:opaque" } }],
		},
	});
	await waitFor(async () => {
		const current = JSON.parse(await readFile(path, "utf8")) as { entries: unknown[] };
		return current.entries.length === 0;
	});
	await router.recordDelivery("slack", "slack:v1:opaque", {
		channel: "slack",
		locator: "slack:v1:opaque",
		replied: true,
		handled: true,
		responseId: "1712345681.000250",
	});
	await waitFor(() => reports.length === 1);
	assert.deepEqual(reports, [
		{
			taskId: "task-native-1",
			delivery: {
				sourceKind: "slack",
				providerEventId: "Ev-native",
				state: "delivered",
				attemptCount: 1,
				responseId: "1712345681.000250",
			},
		},
	]);
	await router.close();
});

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (!(await predicate())) {
		if (Date.now() >= deadline) throw new Error("condition was not met");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
