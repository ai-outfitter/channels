import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { A2aRelayStore } from "../extensions/a2a-relay/store.ts";

const cleanups: Array<() => Promise<void>> = [];
after(async () => {
	for (const cleanup of cleanups.reverse()) await cleanup();
});

async function storePath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "a2a-relay-store-test-"));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	return join(directory, "queue.json");
}

test("the relay queue leases oldest work and fences another worker", async () => {
	const store = new A2aRelayStore(await storePath());
	await store.enqueue("task-a", "agent-a");
	await new Promise((resolve) => setTimeout(resolve, 2));
	await store.enqueue("task-b", "agent-a");
	const claimed = await store.claim(["agent-a"], "worker-a", 60_000);
	assert.equal(claimed?.taskId, "task-a");
	assert.ok(claimed?.lease);
	await assert.rejects(
		() => store.requireLease("task-a", "worker-b", claimed?.lease?.id ?? "missing"),
		/owned by another worker/,
	);
	const next = await store.claim(["agent-a"], "worker-b", 60_000);
	assert.equal(next?.taskId, "task-b");
});

test("an expired relay lease is redelivered with a new fencing id", async () => {
	const store = new A2aRelayStore(await storePath());
	await store.enqueue("task-expired", "agent-a");
	const first = await store.claim(["agent-a"], "worker-a", 1, 1_000);
	const second = await store.claim(["agent-a"], "worker-b", 60_000, 2_000);
	assert.equal(second?.taskId, first?.taskId);
	assert.notEqual(second?.lease?.id, first?.lease?.id);
});

test("release preserves queued work and finish removes settled work", async () => {
	const store = new A2aRelayStore(await storePath());
	await store.enqueue("task-release", "agent-a");
	const first = await store.claim(["agent-a"], "worker-a", 60_000);
	assert.ok(first?.lease);
	await store.release(first.taskId, "worker-a", first.lease.id);
	const second = await store.claim(["agent-a"], "worker-b", 60_000);
	assert.equal(second?.taskId, first.taskId);
	assert.ok(second?.lease);
	await store.finish(second.taskId, "worker-b", second.lease.id);
	assert.deepEqual(await store.pending(), []);
});

test("the relay queue survives restart with its active lease", async () => {
	const path = await storePath();
	const first = new A2aRelayStore(path);
	await first.enqueue("task-persisted", "agent-a");
	const leased = await first.claim(["agent-a"], "worker-a", 60_000);
	first.close();
	const second = new A2aRelayStore(path);
	const pending = await second.pending();
	assert.equal(pending.length, 1);
	assert.equal(pending[0]?.taskId, "task-persisted");
	assert.equal(pending[0]?.lease?.id, leased?.lease?.id);
});
