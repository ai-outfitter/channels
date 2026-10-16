import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { A2aTaskStore, TASK_IDLE_TTL_MS } from "../extensions/a2a/store.ts";

it("expires runnable tasks at the idle boundary and preserves waiting tasks across restart", async () => {
	const root = await mkdtemp(join(tmpdir(), "task-idle-"));
	try {
		const path = join(root, "tasks.json");
		const store = new A2aTaskStore(path);
		for (const id of ["working", "submitted", "input", "auth", "done"]) {
			await store.createTaskWithId("owner", id, "context");
		}
		await store.updateStatus("owner", "working", { state: "TASK_STATE_WORKING" });
		await store.updateStatus("owner", "input", { state: "TASK_STATE_INPUT_REQUIRED" });
		await store.updateStatus("owner", "auth", { state: "TASK_STATE_AUTH_REQUIRED" });
		await store.updateStatus("owner", "done", { state: "TASK_STATE_COMPLETED" });
		const data = JSON.parse(await readFile(path, "utf8"));
		const progress = Date.parse(data.tasks.working.lastProgressAt);
		assert.deepEqual(
			await store.expireIdle(Date.parse(data.tasks.submitted.updatedAt) + TASK_IDLE_TTL_MS - 1),
			[],
		);
		assert.deepEqual(
			new Set(await store.expireIdle(progress + TASK_IDLE_TTL_MS + 100)),
			new Set(["working", "submitted"]),
		);
		const restarted = new A2aTaskStore(path);
		assert.equal((await restarted.getTask("owner", "working")).status.state, "TASK_STATE_FAILED");
		assert.match(
			(await restarted.getTask("owner", "working")).status.message?.parts[0]?.text ?? "",
			/24 hours/,
		);
		assert.equal(
			(await restarted.getTask("owner", "input")).status.state,
			"TASK_STATE_INPUT_REQUIRED",
		);
		assert.equal(
			(await restarted.getTask("owner", "auth")).status.state,
			"TASK_STATE_AUTH_REQUIRED",
		);
		await assert.rejects(restarted.getTask("other", "working"), /not found/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("timestamp-only status updates do not renew progress, but new output does", async () => {
	const root = await mkdtemp(join(tmpdir(), "task-progress-"));
	try {
		const path = join(root, "tasks.json");
		const store = new A2aTaskStore(path);
		await store.createTaskWithId("owner", "task", "context");
		await store.updateStatus("owner", "task", { state: "TASK_STATE_WORKING" });
		const data = JSON.parse(await readFile(path, "utf8"));
		const old = new Date(Date.now() - TASK_IDLE_TTL_MS + 60_000).toISOString();
		data.tasks.task.lastProgressAt = old;
		await writeFile(path, JSON.stringify(data));
		const restarted = new A2aTaskStore(path);
		await restarted.updateStatus("owner", "task", {
			state: "TASK_STATE_WORKING",
			timestamp: new Date().toISOString(),
		});
		assert.equal((await restarted.lookup("task"))?.lastProgressAt, old);
		await restarted.addArtifact("owner", "task", {
			artifactId: "output",
			parts: [{ text: "result" }],
		});
		assert.notEqual((await restarted.lookup("task"))?.lastProgressAt, old);
		assert.deepEqual(await restarted.expireIdle(Date.parse(old) + TASK_IDLE_TTL_MS), []);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("expires old version-1 runnable records during startup maintenance without deleting evidence", async () => {
	const root = await mkdtemp(join(tmpdir(), "task-upgrade-"));
	try {
		const path = join(root, "tasks.json");
		const old = new Date(Date.now() - TASK_IDLE_TTL_MS - 1000).toISOString();
		await writeFile(
			path,
			JSON.stringify({
				version: 1,
				dedupe: [],
				tasks: {
					task: {
						principal: "owner",
						updatedAt: old,
						task: {
							id: "task",
							contextId: "context",
							status: { state: "TASK_STATE_WORKING", timestamp: old },
							history: [],
						},
					},
				},
			}),
		);
		const store = new A2aTaskStore(path);
		await store.expireIdle();
		assert.equal((await store.getTask("owner", "task")).status.state, "TASK_STATE_FAILED");
		assert.ok((await store.retainedTaskIds()).has("task"));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("maintenance persists failures before notifying stream observers", async () => {
	const root = await mkdtemp(join(tmpdir(), "task-expiry-event-"));
	try {
		const path = join(root, "tasks.json");
		const store = new A2aTaskStore(path);
		await store.createTaskWithId("owner", "task", "context");
		const updatedAt = (await store.lookup("task"))?.updatedAt;
		assert.ok(updatedAt);
		const seen: string[] = [];
		const unsubscribe = store.onExpired((task) => seen.push(task.status.state));
		await store.expireIdle(Date.parse(updatedAt) + TASK_IDLE_TTL_MS);
		assert.deepEqual(seen, ["TASK_STATE_FAILED"]);
		assert.equal(
			JSON.parse(await readFile(path, "utf8")).tasks.task.task.status.state,
			"TASK_STATE_FAILED",
		);
		await store.expireIdle(Date.parse(updatedAt) + TASK_IDLE_TTL_MS + 1000);
		assert.equal(seen.length, 1);
		unsubscribe();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("runtime startup expires old tasks before admitting source work", async () => {
	const { startChannelsRuntime } = await import("../extensions/task-plane/runtime.ts");
	const root = await mkdtemp(join(tmpdir(), "runtime-expiry-"));
	try {
		const path = join(root, "tasks.json");
		const old = new Date(Date.now() - TASK_IDLE_TTL_MS - 1).toISOString();
		await writeFile(
			path,
			JSON.stringify({
				version: 1,
				dedupe: [],
				tasks: {
					task: {
						principal: "owner",
						updatedAt: old,
						task: { id: "task", contextId: "context", status: { state: "TASK_STATE_WORKING" } },
					},
				},
			}),
		);
		const events: string[] = [];
		const runtime = await startChannelsRuntime(
			{ sendUserMessage: async () => {} },
			{
				storePath: path,
				agentInterface: "test",
				sources: [
					{
						name: "test",
						async start() {
							assert.equal(
								JSON.parse(await readFile(path, "utf8")).tasks.task.task.status.state,
								"TASK_STATE_FAILED",
							);
							return async () => {};
						},
					},
				],
				log: (record) => events.push(String(record.event)),
			},
		);
		assert.ok(events.includes("task_idle_expired"));
		await runtime.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
