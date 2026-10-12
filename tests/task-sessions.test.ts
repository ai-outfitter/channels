import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";
import { derivedId } from "../extensions/task-plane/serialize.ts";
import {
	commandLineExtensionPaths,
	isPathInside,
	type TaskSessionFactory,
	type TaskSessionFactoryInput,
	TaskSessionHost,
} from "../extensions/task-plane/task-sessions.ts";

test("Task sessions inherit the parent's explicitly selected extension paths", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-task-extensions-"));
	const paths = commandLineExtensionPaths([
		"pi",
		"--extension",
		"/cache/github-mcp",
		"--mode",
		"rpc",
		"--extension=/cache/channels",
		"--extension",
		"/cache/github-mcp",
		"-e",
		"/cache/extra",
	]);
	assert.deepEqual(paths, ["/cache/github-mcp", "/cache/channels", "/cache/extra"]);
	let received: readonly string[] | undefined;
	const host = new TaskSessionHost({
		cwd: root,
		sessionDir: join(root, "sessions"),
		customTools: [],
		additionalExtensionPaths: paths,
		excludedExtensionRoot: "/cache/channels",
		createSession: async ({ sessionManager, additionalExtensionPaths }) => {
			received = additionalExtensionPaths;
			return {
				sessionId: sessionManager.getSessionId(),
				sessionFile: sessionManager.getSessionFile(),
				async prompt() {},
				async close() {},
			};
		},
	});
	await host.run("review", "check the PR");
	await host.close();
	assert.deepEqual(received, paths);
});

test("Pi's task resource loader sees an extension selected on the parent command line", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-task-extension-loader-"));
	const extension = join(root, "review-tool.mjs");
	await writeFile(extension, "export default function reviewTool() {}\n");
	const loader = new DefaultResourceLoader({
		cwd: root,
		agentDir: join(root, "agent"),
		additionalExtensionPaths: commandLineExtensionPaths(["pi", "--extension", extension]),
	});
	await loader.reload();
	assert.ok(loader.getExtensions().extensions.some((item) => item.resolvedPath === extension));
});

test("Task session host isolates Tasks, reuses a session, and reopens it after restart", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-task-sessions-"));
	const sessionDir = join(root, "sessions");
	const initialModel = { provider: "resident", id: "initial" } as NonNullable<
		TaskSessionFactoryInput["model"]
	>;
	const currentModel = { provider: "resident", id: "current" } as NonNullable<
		TaskSessionFactoryInput["model"]
	>;
	let residentModel = initialModel;
	let residentThinking: TaskSessionFactoryInput["thinkingLevel"] = "low";
	const created: Array<{
		taskId: string;
		sessionId: string;
		existingEntries: number;
		model: TaskSessionFactoryInput["model"];
		thinkingLevel: TaskSessionFactoryInput["thinkingLevel"];
		prompts: string[];
	}> = [];
	const createSession: TaskSessionFactory = async ({
		taskId,
		sessionManager,
		model,
		thinkingLevel,
	}) => {
		const record = {
			taskId,
			sessionId: sessionManager.getSessionId(),
			existingEntries: sessionManager.getEntries().length,
			model,
			thinkingLevel,
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
		model: () => residentModel,
		thinkingLevel: () => residentThinking,
		createSession,
	};

	const firstHost = new TaskSessionHost(options);
	await firstHost.run("task-one", "first");
	await firstHost.run("task-one", "second");
	await firstHost.run("task-two", "other");
	await firstHost.close();

	assert.equal(created.length, 2);
	assert.notEqual(created[0]?.sessionId, created[1]?.sessionId);
	assert.equal(created[0]?.model, initialModel);
	assert.equal(created[0]?.thinkingLevel, "low");
	assert.deepEqual(created[0]?.prompts, ["first", "second"]);

	residentModel = currentModel;
	residentThinking = "high";
	const secondHost = new TaskSessionHost({ ...options, cwd: join(root, "different-cwd") });
	await secondHost.run("task-one", "after restart");
	await secondHost.close();

	assert.equal(created.length, 3);
	assert.equal(created[2]?.sessionId, created[0]?.sessionId);
	assert.equal(created[2]?.model, currentModel);
	assert.equal(created[2]?.thinkingLevel, "high");
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

test("Task session host reopens a partial durable session after factory failure", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-task-session-partial-"));
	let attempts = 0;
	let reopenedEntries = 0;
	const host = new TaskSessionHost({
		cwd: root,
		sessionDir: join(root, "sessions"),
		customTools: [],
		excludedExtensionRoot: root,
		createSession: async ({ sessionManager }) => {
			attempts += 1;
			if (attempts === 1) {
				sessionManager.appendMessage({
					role: "assistant",
					content: [{ type: "text", text: "partial" }],
					timestamp: Date.now(),
				} as never);
				throw new Error("binding failed");
			}
			reopenedEntries = sessionManager.getEntries().length;
			return {
				sessionId: sessionManager.getSessionId(),
				sessionFile: sessionManager.getSessionFile(),
				async prompt() {},
				async close() {},
			};
		},
	});
	await assert.rejects(host.run("task", "first"), /binding failed/);
	await host.run("task", "retry");
	assert.ok(reopenedEntries > 0);
	await host.close();
});

test("Task session host reads inherited settings before creating a session manager", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-task-session-thunk-failure-"));
	for (const throwingOption of ["model", "thinkingLevel"] as const) {
		const sessionDir = join(root, throwingOption);
		const host = new TaskSessionHost({
			cwd: root,
			sessionDir,
			customTools: [],
			excludedExtensionRoot: root,
			[throwingOption]: () => {
				throw new Error(`${throwingOption} unavailable`);
			},
		});
		await assert.rejects(host.run("task", "wake"), new RegExp(`${throwingOption} unavailable`));
		assert.equal(existsSync(sessionDir), false);
		await host.close();
	}
});

test("Task session host retains an eager index failure for the first Task turn", async () => {
	const listAll = SessionManager.listAll;
	SessionManager.listAll = async () => {
		throw new Error("session directory unreadable");
	};
	try {
		const host = new TaskSessionHost({
			cwd: tmpdir(),
			sessionDir: join(tmpdir(), "unreadable-sessions"),
			customTools: [],
			excludedExtensionRoot: tmpdir(),
		});
		await new Promise((resolve) => setImmediate(resolve));
		await assert.rejects(host.run("task", "prompt"), /session directory unreadable/);
	} finally {
		SessionManager.listAll = listAll;
	}
});

test("concurrent Task session host closes share one quiescence barrier", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-task-session-close-"));
	let closeStarted = (): void => {};
	const closing = new Promise<void>((resolve) => {
		closeStarted = resolve;
	});
	let finishClose = (): void => {};
	const closeBlocked = new Promise<void>((resolve) => {
		finishClose = resolve;
	});
	const host = new TaskSessionHost({
		cwd: root,
		sessionDir: join(root, "sessions"),
		customTools: [],
		excludedExtensionRoot: root,
		createSession: async ({ sessionManager }) => ({
			sessionId: sessionManager.getSessionId(),
			sessionFile: sessionManager.getSessionFile(),
			async prompt() {},
			async close() {
				closeStarted();
				await closeBlocked;
			},
		}),
	});
	await host.run("task", "prompt");
	const first = host.close();
	await closing;
	const second = host.close();
	assert.equal(first, second);
	let resolved = false;
	void second.then(() => {
		resolved = true;
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(resolved, false);
	finishClose();
	await first;
	assert.equal(resolved, true);
});

test("Task session host close joins a release already in flight", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-task-session-release-close-"));
	let closeStarted = (): void => {};
	const closing = new Promise<void>((resolve) => {
		closeStarted = resolve;
	});
	let finishClose = (): void => {};
	const closeBlocked = new Promise<void>((resolve) => {
		finishClose = resolve;
	});
	const host = new TaskSessionHost({
		cwd: root,
		sessionDir: join(root, "sessions"),
		customTools: [],
		excludedExtensionRoot: root,
		createSession: async ({ sessionManager }) => ({
			sessionId: sessionManager.getSessionId(),
			sessionFile: sessionManager.getSessionFile(),
			async prompt() {},
			async close() {
				closeStarted();
				await closeBlocked;
			},
		}),
	});
	await host.run("task", "prompt");
	const release = host.release("task");
	await closing;
	let hostClosed = false;
	const close = host.close().then(() => {
		hostClosed = true;
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(hostClosed, false);
	finishClose();
	await Promise.all([release, close]);
	assert.equal(hostClosed, true);
});

test("extension containment uses path boundaries", () => {
	const root = join(tmpdir(), "channels-package");
	assert.equal(isPathInside(root, root), true);
	assert.equal(isPathInside(join(root, "extensions", "index.ts"), root), true);
	assert.equal(isPathInside(`${root}-extra`, root), false);
	assert.equal(isPathInside("relative/extension.ts", "relative"), true);
});

test("extension containment resolves symlinked package paths before excluding Channels", async () => {
	const sandbox = await mkdtemp(join(tmpdir(), "channels-package-link-"));
	try {
		const packageRoot = join(sandbox, "real", "channels");
		const extension = join(packageRoot, "extensions", "runtime-extension.mjs");
		const linkedExtension = join(sandbox, "linked-extension.mjs");
		await mkdir(join(packageRoot, "extensions"), { recursive: true });
		await writeFile(extension, "export default function extension() {}\n");
		await symlink(extension, linkedExtension);
		assert.equal(isPathInside(linkedExtension, packageRoot), true);
	} finally {
		await rm(sandbox, { recursive: true, force: true });
	}
});
