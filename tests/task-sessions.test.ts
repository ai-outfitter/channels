import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { derivedId } from "../extensions/task-plane/serialize.ts";
import {
	isPathInside,
	type TaskSessionFactory,
	TaskSessionHost,
} from "../extensions/task-plane/task-sessions.ts";

test("Task session host isolates Tasks, reuses a session, and reopens it after restart", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-task-sessions-"));
	const sessionDir = join(root, "sessions");
	const created: Array<{
		taskId: string;
		sessionId: string;
		existingEntries: number;
		prompts: string[];
	}> = [];
	const createSession: TaskSessionFactory = async ({ taskId, sessionManager }) => {
		const record = {
			taskId,
			sessionId: sessionManager.getSessionId(),
			existingEntries: sessionManager.getEntries().length,
			prompts: [] as string[],
		};
		created.push(record);
		return {
			sessionId: record.sessionId,
			sessionFile: sessionManager.getSessionFile(),
			async prompt(prompt) {
				record.prompts.push(prompt);
				sessionManager.appendMessage({
					role: "assistant",
					content: [{ type: "text", text: prompt }],
					timestamp: Date.now(),
				} as never);
			},
			async close() {},
		};
	};
	const options = {
		cwd: root,
		sessionDir,
		customTools: [],
		excludedExtensionRoot: root,
		createSession,
	};

	const firstHost = new TaskSessionHost(options);
	await firstHost.run("task-one", "first");
	await firstHost.run("task-one", "second");
	await firstHost.run("task-two", "other");
	await firstHost.close();

	assert.equal(created.length, 2);
	assert.notEqual(created[0]?.sessionId, created[1]?.sessionId);
	assert.deepEqual(created[0]?.prompts, ["first", "second"]);

	const secondHost = new TaskSessionHost({ ...options, cwd: join(root, "different-cwd") });
	await secondHost.run("task-one", "after restart");
	await secondHost.close();

	assert.equal(created.length, 3);
	assert.equal(created[2]?.sessionId, created[0]?.sessionId);
	assert.ok((created[2]?.existingEntries ?? 0) >= 2);
	assert.deepEqual(created[2]?.prompts, ["after restart"]);
});

test("Task session host releases terminal sessions without deleting durable history", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-task-session-release-"));
	let created = 0;
	let closed = 0;
	const sessionIds: string[] = [];
	const host = new TaskSessionHost({
		cwd: root,
		sessionDir: join(root, "sessions"),
		customTools: [],
		excludedExtensionRoot: root,
		createSession: async ({ sessionManager }) => {
			created += 1;
			sessionIds.push(sessionManager.getSessionId());
			return {
				sessionId: sessionManager.getSessionId(),
				sessionFile: sessionManager.getSessionFile(),
				async prompt() {},
				async close() {
					closed += 1;
				},
			};
		},
	});
	await host.run("task", "first");
	await host.release("task");
	await host.run("task", "second");
	await host.close();
	assert.equal(created, 2);
	assert.equal(closed, 2);
	assert.equal(sessionIds[1], sessionIds[0]);
});

test("Task session host ignores stale duplicate paths for a durable session", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-task-session-stale-path-"));
	const sessionDir = join(root, "sessions");
	const sessionId = derivedId("task", "task");
	const manager = SessionManager.create(root, sessionDir, { id: sessionId });
	manager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "persist" }],
		timestamp: Date.now(),
	} as never);
	const sessionFile = manager.getSessionFile();
	assert.ok(sessionFile);
	const listAll = SessionManager.listAll;
	SessionManager.listAll = async () =>
		[
			{ id: sessionId, path: sessionFile },
			{ id: sessionId, path: join(sessionDir, "missing.jsonl") },
		] as Awaited<ReturnType<typeof SessionManager.listAll>>;
	try {
		const host = new TaskSessionHost({
			cwd: root,
			sessionDir,
			customTools: [],
			excludedExtensionRoot: root,
			createSession: async ({ sessionManager }) => ({
				sessionId: sessionManager.getSessionId(),
				sessionFile: sessionManager.getSessionFile(),
				async prompt() {},
				async close() {},
			}),
		});
		await host.run("task", "resume");
		await host.close();
	} finally {
		SessionManager.listAll = listAll;
	}
});

test("extension containment uses path boundaries", () => {
	const root = join(tmpdir(), "channels-package");
	assert.equal(isPathInside(root, root), true);
	assert.equal(isPathInside(join(root, "extensions", "index.ts"), root), true);
	assert.equal(isPathInside(`${root}-extra`, root), false);
	assert.equal(isPathInside("relative/extension.ts", "relative"), true);
});
