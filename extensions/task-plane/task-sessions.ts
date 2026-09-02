import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { derivedId } from "./serialize.ts";

export interface TaskTurnRunner {
	run(taskId: string, prompt: string): Promise<void>;
	release(taskId: string): Promise<void>;
}

export interface TaskSession {
	readonly sessionId: string;
	readonly sessionFile: string | undefined;
	prompt(text: string): Promise<void>;
	close(): Promise<void>;
}

export interface TaskSessionFactoryInput {
	readonly taskId: string;
	readonly cwd: string;
	readonly agentDir: string;
	readonly sessionManager: SessionManager;
	readonly customTools: readonly ToolDefinition[];
	readonly excludedExtensionRoot: string;
}

export type TaskSessionFactory = (input: TaskSessionFactoryInput) => Promise<TaskSession>;

export interface TaskSessionHostOptions {
	readonly cwd: string;
	readonly sessionDir: string;
	readonly customTools: readonly ToolDefinition[];
	readonly excludedExtensionRoot: string;
	readonly agentDir?: string;
	readonly createSession?: TaskSessionFactory;
	readonly log?: (record: Readonly<Record<string, unknown>>) => void;
}

/** Cache one durable Pi session for each Task handled by this resident process. */
export class TaskSessionHost implements TaskTurnRunner {
	readonly #options: TaskSessionHostOptions;
	readonly #sessions = new Map<string, Promise<TaskSession>>();
	readonly #sessionPaths: Promise<Map<string, string[]>>;
	#closed = false;

	constructor(options: TaskSessionHostOptions) {
		this.#options = options;
		this.#sessionPaths = SessionManager.listAll(options.sessionDir).then((sessions) => {
			const paths = new Map<string, string[]>();
			for (const session of sessions) {
				paths.set(session.id, [...(paths.get(session.id) ?? []), session.path]);
			}
			return paths;
		});
	}

	async run(taskId: string, prompt: string): Promise<void> {
		if (this.#closed) throw new Error("task session host is closed");
		const session = await this.#session(taskId);
		await session.prompt(prompt);
	}

	async release(taskId: string): Promise<void> {
		const pending = this.#sessions.get(taskId);
		if (!pending) return;
		this.#sessions.delete(taskId);
		const session = await pending.catch(() => undefined);
		await session?.close().catch(() => {});
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		const sessions = [...this.#sessions.values()];
		this.#sessions.clear();
		await Promise.all(
			sessions.map(async (pending) => {
				const session = await pending.catch(() => undefined);
				await session?.close().catch(() => {});
			}),
		);
	}

	#session(taskId: string): Promise<TaskSession> {
		let pending = this.#sessions.get(taskId);
		if (pending) return pending;
		pending = this.#create(taskId).catch((error) => {
			this.#sessions.delete(taskId);
			throw error;
		});
		this.#sessions.set(taskId, pending);
		return pending;
	}

	async #create(taskId: string): Promise<TaskSession> {
		const sessionId = derivedId("task", taskId);
		const sessionPaths = await this.#sessionPaths;
		const existingPaths = [
			...new Set(
				(sessionPaths.get(sessionId) ?? []).map((path) => resolve(path)).filter(existsSync),
			),
		];
		sessionPaths.set(sessionId, existingPaths);
		if (existingPaths.length > 1) {
			throw new Error(`multiple Pi sessions exist for task "${taskId}"`);
		}
		const existingPath = existingPaths[0];
		const sessionManager = existingPath
			? SessionManager.open(existingPath, this.#options.sessionDir, this.#options.cwd)
			: SessionManager.create(this.#options.cwd, this.#options.sessionDir, { id: sessionId });
		const createSession = this.#options.createSession ?? createPiTaskSession;
		const session = await createSession({
			taskId,
			cwd: this.#options.cwd,
			agentDir: this.#options.agentDir ?? getAgentDir(),
			sessionManager,
			customTools: this.#options.customTools,
			excludedExtensionRoot: this.#options.excludedExtensionRoot,
		});
		const sessionFile = sessionManager.getSessionFile();
		if (sessionFile) sessionPaths.set(sessionId, [sessionFile]);
		this.#options.log?.({
			event: existingPath ? "task_session_reopened" : "task_session_created",
			taskId,
			sessionId: session.sessionId,
		});
		return session;
	}
}

async function createPiTaskSession(input: TaskSessionFactoryInput): Promise<TaskSession> {
	const settingsManager = SettingsManager.create(input.cwd, input.agentDir);
	const resourceLoader = new DefaultResourceLoader({
		cwd: input.cwd,
		agentDir: input.agentDir,
		settingsManager,
		extensionsOverride: (loaded) => ({
			...loaded,
			extensions: loaded.extensions.filter(
				(extension) => !isPathInside(extension.resolvedPath, input.excludedExtensionRoot),
			),
		}),
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: input.cwd,
		agentDir: input.agentDir,
		sessionManager: input.sessionManager,
		settingsManager,
		resourceLoader,
		customTools: [...input.customTools],
	});
	await session.bindExtensions({ mode: "print" });
	return wrapSession(session);
}

function wrapSession(session: AgentSession): TaskSession {
	return {
		sessionId: session.sessionManager.getSessionId(),
		sessionFile: session.sessionManager.getSessionFile(),
		async prompt(text) {
			await session.prompt(text);
			await session.waitForIdle();
		},
		async close() {
			try {
				try {
					if (!session.isIdle) await session.abort();
				} finally {
					await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				}
			} finally {
				session.dispose();
			}
		},
	};
}

export function isPathInside(path: string, root: string): boolean {
	const fromRoot = relative(resolve(root), resolve(path));
	return (
		fromRoot === "" ||
		(fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
	);
}
