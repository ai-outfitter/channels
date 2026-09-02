import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
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

	const secondHost = new TaskSessionHost(options);
	await secondHost.run("task-one", "after restart");
	await secondHost.close();

	assert.equal(created.length, 3);
	assert.equal(created[2]?.sessionId, created[0]?.sessionId);
	assert.ok((created[2]?.existingEntries ?? 0) >= 2);
	assert.deepEqual(created[2]?.prompts, ["after restart"]);
});
