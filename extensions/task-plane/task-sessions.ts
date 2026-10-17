import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
	type AgentSession,
	type CreateAgentSessionOptions,
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
	readonly residentBio?: (() => string) | undefined;
	readonly promptSources?: { systemPrompt?: string; appendSystemPrompt?: string[] } | undefined;
	readonly cwd: string;
	readonly agentDir: string;
	readonly projectTrusted: boolean;
	readonly sessionManager: SessionManager;
	readonly customTools: readonly ToolDefinition[];
	readonly additionalExtensionPaths: readonly string[];
	readonly excludedExtensionRoot: string;
	readonly model?: CreateAgentSessionOptions["model"];
	readonly thinkingLevel?: CreateAgentSessionOptions["thinkingLevel"];
}

export type TaskSessionFactory = (input: TaskSessionFactoryInput) => Promise<TaskSession>;

export interface TaskSessionHostOptions {
	readonly cwd: string;
	readonly residentBio?: (() => string) | undefined;
	readonly promptSources?: { systemPrompt?: string; appendSystemPrompt?: string[] } | undefined;
	readonly sessionDir: string;
	readonly customTools: readonly ToolDefinition[];
	readonly additionalExtensionPaths?: readonly string[];
	readonly excludedExtensionRoot: string;
	readonly agentDir?: string;
	readonly projectTrusted?: boolean;
	readonly model?: () => CreateAgentSessionOptions["model"];
	readonly thinkingLevel?: () => CreateAgentSessionOptions["thinkingLevel"];
	readonly createSession?: TaskSessionFactory;
	readonly log?: (record: Readonly<Record<string, unknown>>) => void;
}

/** Cache one durable Pi session for each Task handled by this resident process. */
export class TaskSessionHost implements TaskTurnRunner {
	readonly #options: TaskSessionHostOptions;
	readonly #sessions = new Map<string, Promise<TaskSession>>();
	readonly #releases = new Set<Promise<void>>();
	readonly #sessionPaths: Promise<Map<string, string[]>>;
	#closed = false;
	#closePromise: Promise<void> | undefined;

	constructor(options: TaskSessionHostOptions) {
		this.#options = options;
		const sessionPaths = SessionManager.listAll(options.sessionDir).then((sessions) => {
			const paths = new Map<string, string[]>();
			for (const session of sessions) {
				paths.set(session.id, [...(paths.get(session.id) ?? []), session.path]);
			}
			return paths;
		});
		// Retain the failure for the first Task turn while preventing an idle host
		// from surfacing the eager scan as an unhandled rejection.
		void sessionPaths.catch(() => {});
		this.#sessionPaths = sessionPaths;
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
		const release = (async () => {
			const session = await pending.catch(() => undefined);
			await session?.close().catch(() => {});
		})();
		this.#releases.add(release);
		try {
			await release;
		} finally {
			this.#releases.delete(release);
		}
	}

	close(): Promise<void> {
		if (this.#closePromise) return this.#closePromise;
		this.#closed = true;
		const sessions = [...this.#sessions.values()];
		const releases = [...this.#releases];
		this.#sessions.clear();
		this.#closePromise = Promise.all([
			...releases,
			...sessions.map(async (pending) => {
				const session = await pending.catch(() => undefined);
				await session?.close().catch(() => {});
			}),
		]).then(() => {});
		return this.#closePromise;
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
		const createSession = this.#options.createSession ?? createPiTaskSession;
		const model = this.#options.model?.();
		const thinkingLevel = this.#options.thinkingLevel?.();
		const sessionManager = existingPath
			? SessionManager.open(existingPath, this.#options.sessionDir, this.#options.cwd)
			: SessionManager.create(this.#options.cwd, this.#options.sessionDir, { id: sessionId });
		let session: TaskSession;
		try {
			session = await createSession({
				taskId,
				residentBio: this.#options.residentBio,
				promptSources: this.#options.promptSources,
				cwd: this.#options.cwd,
				agentDir: this.#options.agentDir ?? getAgentDir(),
				projectTrusted: this.#options.projectTrusted ?? false,
				sessionManager,
				customTools: this.#options.customTools,
				additionalExtensionPaths: this.#options.additionalExtensionPaths ?? [],
				excludedExtensionRoot: this.#options.excludedExtensionRoot,
				...(model !== undefined ? { model } : {}),
				...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
			});
		} catch (error) {
			const partialFile = sessionManager.getSessionFile();
			if (partialFile && existsSync(partialFile))
				sessionPaths.set(sessionId, [resolve(partialFile)]);
			throw error;
		}
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
	const settingsManager = SettingsManager.create(input.cwd, input.agentDir, {
		projectTrusted: input.projectTrusted,
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: input.cwd,
		agentDir: input.agentDir,
		settingsManager,
		...input.promptSources,
		additionalExtensionPaths: [...input.additionalExtensionPaths],
		extensionFactories: input.residentBio
			? [
					(api) => {
						api.on("before_agent_start", (event) => {
							const bio = input.residentBio?.() ?? "";
							return {
								systemPrompt: bio
									? `${event.systemPrompt}\n\nResident bio:\n${bio}`
									: event.systemPrompt,
							};
						});
					},
				]
			: [],
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
		...(input.model !== undefined ? { model: input.model } : {}),
		...(input.thinkingLevel !== undefined ? { thinkingLevel: input.thinkingLevel } : {}),
	});
	const wrapped = wrapSession(session);
	try {
		await session.bindExtensions({ mode: "print" });
		return wrapped;
	} catch (error) {
		await wrapped.close().catch((closeError) => {
			if (error instanceof Error) error.cause = closeError;
		});
		throw error;
	}
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
	const canonical = (value: string) => {
		try {
			return realpathSync(value);
		} catch {
			return resolve(value);
		}
	};
	const fromRoot = relative(canonical(root), canonical(path));
	return (
		fromRoot === "" ||
		(fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
	);
}

/** Pi receives Outfitter-selected extensions on the command line, outside its default resource paths. */
export function commandLineExtensionPaths(argv: readonly string[]): string[] {
	const paths = new Set<string>();
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--extension" || arg === "-e") {
			const value = argv[index + 1];
			if (value && !value.startsWith("--")) {
				paths.add(value);
				index += 1;
			}
		} else if (arg?.startsWith("--extension=")) {
			const value = arg.slice("--extension=".length);
			if (value) paths.add(value);
		}
	}
	return [...paths];
}

/** Preserve resolved catalog prompt arguments when creating isolated task sessions. */
export function commandLinePromptSources(argv: readonly string[]): {
	systemPrompt?: string;
	appendSystemPrompt?: string[];
} {
	const result: { systemPrompt?: string; appendSystemPrompt?: string[] } = {};
	for (let index = 0; index < argv.length; index++) {
		const match = argv[index]?.match(/^--(system-prompt|append-system-prompt)(?:=(.*))?$/);
		if (!match) continue;
		const value = match[2] ?? argv[++index];
		if (!value || value.startsWith("--")) throw new Error(`Missing value for ${match[1]}`);
		if (match[1] === "system-prompt") result.systemPrompt = value;
		else result.appendSystemPrompt = [...(result.appendSystemPrompt ?? []), value];
	}
	return result;
}
