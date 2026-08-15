import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import {
	type A2aArtifact,
	A2aError,
	type A2aMessage,
	type A2aTask,
	type A2aTaskState,
	type A2aTaskStatus,
	isTerminal,
	MAX_HISTORY_MESSAGES,
	TASK_STATES,
	validateIdentifier,
	validateMessage,
} from "./types.ts";

/**
 * Idempotency record. Scope is (authenticated principal, messageId); the
 * stored outcome is the full prior result kind — the created task's id (the
 * duplicate returns that task's current state) or the direct Message
 * verbatim. A duplicate messageId with a different payload is an explicit
 * error, never a silent replay. This is deliberately stronger than the A2A
 * minimum, which only says sends MAY be idempotent.
 */
interface DedupeRecord {
	readonly principal: string;
	readonly messageId: string;
	readonly payloadHash: string;
	readonly createdAt: string;
	readonly outcome:
		| { readonly kind: "task"; readonly taskId: string }
		| { readonly kind: "message"; readonly message: A2aMessage };
}

export interface StoredTask {
	readonly task: A2aTask;
	readonly principal: string;
	readonly updatedAt: string;
}

interface TaskStoreData {
	readonly version: 1;
	tasks: Record<string, StoredTask>;
	dedupe: DedupeRecord[];
}

const MAX_DEDUPE_RECORDS = 10_000;
export const DEDUPE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const TASK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface ListTasksFilter {
	readonly contextId?: string;
	readonly status?: A2aTaskState;
	readonly statusTimestampAfter?: string;
	readonly pageSize?: number;
	readonly includeArtifacts?: boolean;
	readonly historyLength?: number;
}

/**
 * Durable, single-process A2A task store. Same discipline as the relay
 * store: atomic rename persistence, serialized operations, validate on
 * parse. Task state here is the durable record the recovery rules point at —
 * a reconnecting client reads the task, then subscribes; it never depends on
 * stream replay.
 */
export class A2aTaskStore {
	readonly #path: string;
	#data: TaskStoreData = { version: 1, tasks: {}, dedupe: [] };
	#initialized: Promise<void> | undefined;
	#operations: Promise<unknown> = Promise.resolve();

	constructor(path: string) {
		if (!path) throw new Error("a2a store path is required");
		this.#path = path;
	}

	async initialize(): Promise<void> {
		if (!this.#initialized) {
			this.#initialized = (async () => {
				await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
				await chmod(dirname(this.#path), 0o700);
				try {
					const parsed = JSON.parse(await readFile(this.#path, "utf8")) as unknown;
					this.#data = parseStoreData(parsed);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				this.#prune(Date.now());
				await this.#persist();
			})();
		}
		await this.#initialized;
	}

	/**
	 * Returns the prior outcome for a duplicate (principal, messageId), or
	 * undefined for a first send. Throws when the duplicate carries a
	 * different payload.
	 */
	async priorOutcome(
		principal: string,
		message: A2aMessage,
	): Promise<DedupeRecord["outcome"] | undefined> {
		return this.#run(async () => {
			const index = this.#data.dedupe.findIndex(
				(entry) => entry.principal === principal && entry.messageId === message.messageId,
			);
			const record = this.#data.dedupe[index];
			if (!record) return undefined;
			if (record.payloadHash !== hashPayload(message)) {
				throw new A2aError(
					409,
					"DUPLICATE_MESSAGE_ID",
					`messageId "${message.messageId}" was already used with a different payload`,
				);
			}
			if (record.outcome.kind === "task" && !this.#data.tasks[record.outcome.taskId]) {
				this.#data.dedupe.splice(index, 1);
				await this.#persist();
				return undefined;
			}
			return record.outcome;
		});
	}

	async recordOutcome(
		principal: string,
		message: A2aMessage,
		outcome: DedupeRecord["outcome"],
	): Promise<void> {
		return this.#run(async () => {
			const record = {
				principal,
				messageId: message.messageId,
				payloadHash: hashPayload(message),
				createdAt: new Date().toISOString(),
				outcome,
			} as const;
			const prior = this.#data.dedupe.findIndex(
				(entry) => entry.principal === principal && entry.messageId === message.messageId,
			);
			if (prior >= 0) this.#data.dedupe[prior] = record;
			else this.#data.dedupe.push(record);
			if (this.#data.dedupe.length > MAX_DEDUPE_RECORDS) {
				this.#data.dedupe.splice(0, this.#data.dedupe.length - MAX_DEDUPE_RECORDS);
			}
			await this.#persist();
		});
	}

	/**
	 * Creates a task owned by `principal`. The server generates the task id —
	 * a client never supplies one, so equal ids minted by two different
	 * servers can never collide here: identity is (this server, this id).
	 * A client-supplied contextId only attaches when this principal already
	 * owns it; a foreign or unknown contextId gets a fresh context instead of
	 * joining local work.
	 */
	async createTask(principal: string, requestedContextId: string | undefined): Promise<A2aTask> {
		return this.#run(async () => {
			const contextId =
				requestedContextId && this.#principalOwnsContext(principal, requestedContextId)
					? requestedContextId
					: randomUUID();
			return this.#createTask(principal, randomUUID(), contextId);
		});
	}

	/** Trusted task-plane creation in an already resolved context. */
	async beginNew(principal: string, contextId: string): Promise<A2aTask> {
		return this.#run(async () => {
			validateIdentifier(contextId, "contextId");
			if (!this.#principalOwnsContext(principal, contextId)) {
				throw new A2aError(404, "TASK_NOT_FOUND", `context "${contextId}" was not found`);
			}
			return this.#createTask(principal, randomUUID(), contextId);
		});
	}

	/**
	 * Idempotent projection used by activation-journal replay. The task id is
	 * minted before the journal claim is flushed, so recovery must use it
	 * verbatim rather than minting another task.
	 */
	async createTaskWithId(principal: string, taskId: string, contextId: string): Promise<A2aTask> {
		return this.#run(async () => {
			validateIdentifier(principal, "principal");
			validateIdentifier(taskId, "taskId");
			validateIdentifier(contextId, "contextId");
			const prior = this.#data.tasks[taskId];
			if (prior) {
				if (prior.principal !== principal || prior.task.contextId !== contextId) {
					throw new Error(`task "${taskId}" conflicts with its activation claim`);
				}
				await this.#persist();
				return prior.task;
			}
			return this.#createTask(principal, taskId, contextId);
		});
	}

	async getTask(principal: string, taskId: string): Promise<A2aTask> {
		return this.#run(async () => this.#owned(principal, taskId).task);
	}

	/**
	 * Principal-free lookup for the hosting process's own tools. Never
	 * reachable from the HTTP surface, which always scopes by authenticated
	 * principal.
	 */
	async lookup(taskId: string): Promise<StoredTask | undefined> {
		return this.#run(async () => this.#data.tasks[taskId]);
	}

	async ownsContext(principal: string, contextId: string): Promise<boolean> {
		return this.#run(async () => {
			validateIdentifier(principal, "principal");
			validateIdentifier(contextId, "contextId");
			return this.#principalOwnsContext(principal, contextId);
		});
	}

	/**
	 * Contexts still referenced by any retained Task, across every principal.
	 * Terminal Tasks remain durable for TASK_RETENTION_MS and keep their context
	 * mapping reachable for exactly that same period.
	 */
	async activeContextIds(): Promise<ReadonlySet<string>> {
		return this.#run(
			async () => new Set(Object.values(this.#data.tasks).map((entry) => entry.task.contextId)),
		);
	}

	async retainedTaskIds(): Promise<ReadonlySet<string>> {
		return this.#run(async () => new Set(Object.keys(this.#data.tasks)));
	}

	async listTasks(principal: string, filter: ListTasksFilter): Promise<readonly A2aTask[]> {
		return this.#run(async () => {
			const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 100);
			return Object.values(this.#data.tasks)
				.filter((entry) => entry.principal === principal)
				.filter((entry) => !filter.contextId || entry.task.contextId === filter.contextId)
				.filter((entry) => !filter.status || entry.task.status.state === filter.status)
				.filter(
					(entry) =>
						!filter.statusTimestampAfter ||
						(entry.task.status.timestamp ?? entry.updatedAt) >= filter.statusTimestampAfter,
				)
				.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
				.slice(0, pageSize)
				.map((entry) =>
					trimTask(entry.task, filter.historyLength ?? 0, filter.includeArtifacts ?? false),
				);
		});
	}

	async appendHistory(principal: string, taskId: string, message: A2aMessage): Promise<A2aTask> {
		return this.#run(async () => this.#appendHistory(this.#owned(principal, taskId), message));
	}

	async appendHistoryIdempotent(
		principal: string,
		taskId: string,
		message: A2aMessage,
	): Promise<A2aTask> {
		return this.#run(async () => {
			const stored = this.#owned(principal, taskId);
			const prior = stored.task.history?.find((entry) => entry.messageId === message.messageId);
			if (prior) {
				if (JSON.stringify(prior) !== JSON.stringify(message)) {
					throw new Error(`message "${message.messageId}" conflicts with its activation claim`);
				}
				await this.#persist();
				return stored.task;
			}
			if (isTerminal(stored.task.status.state)) {
				throw new A2aError(
					400,
					"UNSUPPORTED_OPERATION",
					`task "${taskId}" is already in terminal state ${stored.task.status.state}`,
				);
			}
			return this.#appendHistory(stored, message);
		});
	}

	#appendHistory(stored: StoredTask, message: A2aMessage): Promise<A2aTask> {
		const history = [...(stored.task.history ?? []), message].slice(-MAX_HISTORY_MESSAGES);
		return this.#replace(stored, { ...stored.task, history });
	}

	async updateStatus(principal: string, taskId: string, status: A2aTaskStatus): Promise<A2aTask> {
		return this.#run(async () => {
			const stored = this.#owned(principal, taskId);
			if (isTerminal(stored.task.status.state)) {
				throw new A2aError(
					400,
					"UNSUPPORTED_OPERATION",
					`task "${taskId}" is already in terminal state ${stored.task.status.state}`,
				);
			}
			return this.#replace(stored, {
				...stored.task,
				status: { ...status, timestamp: status.timestamp ?? new Date().toISOString() },
			});
		});
	}

	async addArtifact(principal: string, taskId: string, artifact: A2aArtifact): Promise<A2aTask> {
		return this.#run(async () => {
			const stored = this.#owned(principal, taskId);
			if (isTerminal(stored.task.status.state)) {
				throw new A2aError(
					400,
					"UNSUPPORTED_OPERATION",
					`task "${taskId}" is already in terminal state ${stored.task.status.state}`,
				);
			}
			const artifacts = [
				...(stored.task.artifacts ?? []).filter(
					(entry) => entry.artifactId !== artifact.artifactId,
				),
				artifact,
			];
			return this.#replace(stored, { ...stored.task, artifacts });
		});
	}

	async #replace(stored: StoredTask, task: A2aTask): Promise<A2aTask> {
		this.#data.tasks[task.id] = {
			task,
			principal: stored.principal,
			updatedAt: new Date().toISOString(),
		};
		await this.#persist();
		return task;
	}

	async #createTask(principal: string, taskId: string, contextId: string): Promise<A2aTask> {
		const task: A2aTask = {
			id: taskId,
			contextId,
			status: { state: "TASK_STATE_SUBMITTED", timestamp: new Date().toISOString() },
			artifacts: [],
			history: [],
		};
		this.#data.tasks[task.id] = {
			task,
			principal,
			updatedAt: new Date().toISOString(),
		};
		await this.#persist();
		return task;
	}

	#owned(principal: string, taskId: string): StoredTask {
		validateIdentifier(taskId, "taskId");
		const stored = this.#data.tasks[taskId];
		// A foreign principal's task is indistinguishable from a missing one:
		// no existence oracle across authentication scopes.
		if (!stored || stored.principal !== principal) {
			throw new A2aError(404, "TASK_NOT_FOUND", `task "${taskId}" was not found`);
		}
		return stored;
	}

	#principalOwnsContext(principal: string, contextId: string): boolean {
		return Object.values(this.#data.tasks).some(
			(entry) => entry.principal === principal && entry.task.contextId === contextId,
		);
	}

	#prune(now: number): void {
		const taskCutoff = new Date(now - TASK_RETENTION_MS).toISOString();
		for (const [id, entry] of Object.entries(this.#data.tasks)) {
			if (isTerminal(entry.task.status.state) && entry.updatedAt < taskCutoff) {
				delete this.#data.tasks[id];
			}
		}
		const dedupeCutoff = new Date(now - DEDUPE_RETENTION_MS).toISOString();
		this.#data.dedupe = this.#data.dedupe.filter((entry) => {
			if (entry.outcome.kind === "task" && !(entry.outcome.taskId in this.#data.tasks)) {
				return false;
			}
			if (entry.createdAt >= dedupeCutoff) return true;
			// Never expire a dedupe record before its task: the retention
			// contract is max(window, referenced task lifetime).
			return entry.outcome.kind === "task" && entry.outcome.taskId in this.#data.tasks;
		});
	}

	async #run<T>(operation: () => Promise<T>): Promise<T> {
		await this.initialize();
		const result = this.#operations.then(operation, operation);
		this.#operations = result;
		return result;
	}

	async #persist(): Promise<void> {
		const temporary = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
		const file = await open(temporary, "wx", 0o600);
		try {
			await file.writeFile(`${JSON.stringify(this.#data)}\n`);
			await file.sync();
		} finally {
			await file.close();
		}
		try {
			await rename(temporary, this.#path);
			const directory = await open(dirname(this.#path), "r");
			try {
				await directory.sync();
			} finally {
				await directory.close();
			}
		} catch (error) {
			await unlink(temporary).catch(() => {});
			throw error;
		}
	}
}

export function trimTask(task: A2aTask, historyLength: number, includeArtifacts: boolean): A2aTask {
	return {
		...task,
		history: historyLength > 0 ? (task.history ?? []).slice(-historyLength) : [],
		artifacts: includeArtifacts ? (task.artifacts ?? []) : [],
	};
}

/**
 * Payload identity for dedupe mismatch detection: the message content minus
 * the client-random fields that legitimately vary on retry. JSON.stringify
 * over a key-sorted projection — not RFC 8785, but stable for this store's
 * single-writer comparison purpose.
 */
function hashPayload(message: A2aMessage): string {
	const projection = {
		contextId: message.contextId ?? "",
		taskId: message.taskId ?? "",
		role: message.role,
		parts: message.parts,
		referenceTaskIds: message.referenceTaskIds ?? [],
	};
	return createHash("sha256").update(JSON.stringify(projection)).digest("hex");
}

function parseStoreData(value: unknown): TaskStoreData {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("invalid a2a task store");
	}
	const parsed = value as Partial<TaskStoreData>;
	if (
		parsed.version !== 1 ||
		!parsed.tasks ||
		typeof parsed.tasks !== "object" ||
		Array.isArray(parsed.tasks) ||
		!Array.isArray(parsed.dedupe)
	) {
		throw new Error("unsupported a2a task store");
	}
	for (const entry of Object.values(parsed.tasks)) {
		validateIdentifier(entry.principal, "principal");
		validateIdentifier(entry.task.id, "taskId");
		validateIdentifier(entry.task.contextId, "contextId");
		if (!TASK_STATES.includes(entry.task.status.state)) {
			throw new Error(`unknown task state ${entry.task.status.state}`);
		}
	}
	for (const entry of parsed.dedupe) {
		validateIdentifier(entry.principal, "principal");
		validateIdentifier(entry.messageId, "messageId");
		if (!/^[a-f0-9]{64}$/.test(entry.payloadHash)) throw new Error("invalid dedupe payload hash");
		if (entry.outcome.kind === "task") {
			validateIdentifier(entry.outcome.taskId, "dedupe taskId");
		} else {
			validateMessage(entry.outcome.message);
		}
	}
	return parsed as TaskStoreData;
}
