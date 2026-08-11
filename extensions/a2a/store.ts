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
	isSettled,
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
 *
 * A "pending" outcome is a claim: the key is taken and the first send is
 * still executing. The claim is written in the same serialized operation
 * that checks for a prior record, so two concurrent sends can never both
 * decide they are first.
 */
interface DedupeRecord {
	readonly principal: string;
	readonly messageId: string;
	readonly payloadHash: string;
	readonly createdAt: string;
	readonly outcome:
		| { readonly kind: "pending" }
		| { readonly kind: "task"; readonly taskId: string }
		| { readonly kind: "message"; readonly message: A2aMessage };
}

export type DedupeOutcome =
	| { readonly kind: "task"; readonly taskId: string }
	| { readonly kind: "message"; readonly message: A2aMessage };

/**
 * Result of claiming a (principal, messageId) key.
 *
 * - `claimed`: this caller is first and owns the key; it MUST later call
 *   recordOutcome() or releaseClaim().
 * - `replay`: a prior send finished; return its outcome verbatim.
 * - `inProgress`: another send holds the claim right now. The caller answers
 *   409 and does not execute; it never waits.
 */
export type ClaimResult =
	| { readonly kind: "claimed" }
	| { readonly kind: "replay"; readonly outcome: DedupeOutcome }
	| { readonly kind: "inProgress" };

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
	/** Opaque cursor from a previous page's nextPageToken. */
	readonly pageToken?: string;
}

export interface ListTasksPage {
	readonly tasks: readonly A2aTask[];
	/** Empty when this page is the last one. */
	readonly nextPageToken: string;
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
	#closed = false;

	constructor(path: string) {
		if (!path) throw new Error("a2a store path is required");
		this.#path = path;
	}

	async initialize(): Promise<void> {
		if (this.#closed) throw new Error("a2a store is closed");
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
				// A pending claim is in-process state, not durable state: this
				// store serializes every operation in one process, so a claim can
				// only be held by an execute running in THIS process. Any claim
				// read back from disk therefore belongs to a process that died
				// mid-execute and can never be filled in. Clearing them at load
				// is exact — no age bound to tune, and no window in which a live
				// claim could be reclaimed under its owner.
				this.#data.dedupe = this.#data.dedupe.filter((entry) => entry.outcome.kind !== "pending");
				this.#prune(Date.now());
				await this.#persist();
			})();
		}
		await this.#initialized;
	}

	/**
	 * Find-or-insert on (principal, messageId), in ONE serialized operation.
	 * Reading a prior outcome and inserting the claim cannot be split: two
	 * concurrent sends of the same messageId would otherwise both see no
	 * record and both mint a task. The payload-hash check happens here, at
	 * claim time, so a mismatched duplicate is rejected before any work runs.
	 */
	async claimOutcome(principal: string, message: A2aMessage): Promise<ClaimResult> {
		return this.#run(async () => {
			const hash = hashPayload(message);
			const record = this.#data.dedupe.find(
				(entry) => entry.principal === principal && entry.messageId === message.messageId,
			);
			if (record) {
				if (record.payloadHash !== hash) {
					throw new A2aError(
						409,
						"DUPLICATE_MESSAGE_ID",
						`messageId "${message.messageId}" was already used with a different payload`,
					);
				}
				if (record.outcome.kind === "pending") return { kind: "inProgress" } as const;
				return { kind: "replay", outcome: record.outcome } as const;
			}
			this.#data.dedupe.push({
				principal,
				messageId: message.messageId,
				payloadHash: hash,
				createdAt: new Date().toISOString(),
				outcome: { kind: "pending" },
			});
			if (this.#data.dedupe.length > MAX_DEDUPE_RECORDS) {
				this.#data.dedupe.splice(0, this.#data.dedupe.length - MAX_DEDUPE_RECORDS);
			}
			await this.#persist();
			return { kind: "claimed" } as const;
		});
	}

	/**
	 * Fills in the claim this caller holds. It updates the claim rather than
	 * appending: an append would leave the pending record in front of the real
	 * one, and the finder above returns the first match, so the key would stay
	 * wedged as "in progress" forever.
	 */
	async recordOutcome(
		principal: string,
		message: A2aMessage,
		outcome: DedupeOutcome,
	): Promise<void> {
		return this.#run(async () => {
			const index = this.#data.dedupe.findIndex(
				(entry) => entry.principal === principal && entry.messageId === message.messageId,
			);
			const filled: DedupeRecord = {
				principal,
				messageId: message.messageId,
				payloadHash: hashPayload(message),
				createdAt:
					index >= 0
						? (this.#data.dedupe[index] as DedupeRecord).createdAt
						: new Date().toISOString(),
				outcome,
			};
			if (index >= 0) this.#data.dedupe[index] = filled;
			else this.#data.dedupe.push(filled);
			if (this.#data.dedupe.length > MAX_DEDUPE_RECORDS) {
				this.#data.dedupe.splice(0, this.#data.dedupe.length - MAX_DEDUPE_RECORDS);
			}
			await this.#persist();
		});
	}

	/**
	 * Drops an unfilled claim. A send that fails before it ever mints a task
	 * has no outcome to replay, and leaving the claim in place would 409 every
	 * retry of a message that was never executed.
	 */
	async releaseClaim(principal: string, messageId: string): Promise<void> {
		return this.#run(async () => {
			const index = this.#data.dedupe.findIndex(
				(entry) =>
					entry.principal === principal &&
					entry.messageId === messageId &&
					entry.outcome.kind === "pending",
			);
			if (index < 0) return;
			this.#data.dedupe.splice(index, 1);
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
			const task: A2aTask = {
				id: randomUUID(),
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

	/**
	 * Lists accepted work that still needs a resident-agent turn. This lookup
	 * is principal-free because only the hosting process uses it during
	 * recovery; no HTTP route exposes it. Oldest work runs first.
	 */
	async listRecoverable(): Promise<readonly StoredTask[]> {
		return this.#run(async () =>
			Object.values(this.#data.tasks)
				.filter((entry) => !isSettled(entry.task.status.state))
				.sort(
					(left, right) =>
						left.updatedAt.localeCompare(right.updatedAt) ||
						left.task.id.localeCompare(right.task.id),
				),
		);
	}

	/**
	 * One page of the principal's tasks, newest first. The order is a total
	 * order on (updatedAt descending, id ascending): updatedAt alone ties for
	 * tasks written in the same millisecond, and a cursor cannot resume an
	 * order that is not total. The cursor names the last entry returned, and
	 * the next page starts strictly after it in that same order, so no task is
	 * repeated and none is skipped.
	 */
	async listTasks(principal: string, filter: ListTasksFilter): Promise<ListTasksPage> {
		return this.#run(async () => {
			const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 100);
			const cursor = decodePageToken(filter.pageToken);
			const matching = Object.values(this.#data.tasks)
				.filter((entry) => entry.principal === principal)
				.filter((entry) => !filter.contextId || entry.task.contextId === filter.contextId)
				.filter((entry) => !filter.status || entry.task.status.state === filter.status)
				.filter(
					(entry) =>
						!filter.statusTimestampAfter ||
						(entry.task.status.timestamp ?? entry.updatedAt) >= filter.statusTimestampAfter,
				)
				.sort(compareListOrder)
				.filter((entry) => !cursor || isAfterCursor(entry, cursor));
			const page = matching.slice(0, pageSize);
			const last = page.at(-1);
			return {
				tasks: page.map((entry) =>
					trimTask(entry.task, filter.historyLength ?? 0, filter.includeArtifacts ?? false),
				),
				nextPageToken:
					last && matching.length > page.length
						? encodePageToken({ updatedAt: last.updatedAt, id: last.task.id })
						: "",
			};
		});
	}

	async appendHistory(principal: string, taskId: string, message: A2aMessage): Promise<A2aTask> {
		return this.#run(async () => {
			const stored = this.#owned(principal, taskId);
			const history = [...(stored.task.history ?? []), message].slice(-MAX_HISTORY_MESSAGES);
			return this.#replace(stored, { ...stored.task, history });
		});
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
			const artifacts = [
				...(stored.task.artifacts ?? []).filter(
					(entry) => entry.artifactId !== artifact.artifactId,
				),
				artifact,
			];
			return this.#replace(stored, { ...stored.task, artifacts });
		});
	}

	/**
	 * Latches the store shut. Every operation goes through #run, which calls
	 * initialize() first, so a write that arrives after the server closed
	 * fails loudly instead of re-creating the store directory and rewriting
	 * the file from whatever this instance still holds in memory.
	 */
	close(): void {
		this.#closed = true;
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

interface PageCursor {
	readonly updatedAt: string;
	readonly id: string;
}

/** Newest first, with the task id breaking same-millisecond ties. */
function compareListOrder(a: StoredTask, b: StoredTask): number {
	if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
	return a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0;
}

function isAfterCursor(entry: StoredTask, cursor: PageCursor): boolean {
	if (entry.updatedAt !== cursor.updatedAt) return entry.updatedAt < cursor.updatedAt;
	return entry.task.id > cursor.id;
}

function encodePageToken(cursor: PageCursor): string {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodePageToken(token: string | undefined): PageCursor | undefined {
	if (!token) return undefined;
	try {
		const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as PageCursor;
		if (typeof parsed?.updatedAt !== "string" || typeof parsed?.id !== "string") {
			throw new Error("malformed cursor");
		}
		return parsed;
	} catch {
		// A cursor the server did not mint is a client error, not a silent
		// restart from page one: a silent restart repeats tasks the caller
		// already read and looks like duplicated work.
		throw new A2aError(400, "INVALID_ARGUMENT", "pageToken is not a valid page cursor");
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
	for (const entry of parsed.dedupe) validateDedupeRecord(entry);
	return parsed as TaskStoreData;
}

function validateDedupeRecord(entry: DedupeRecord): void {
	validateIdentifier(entry.principal, "principal");
	validateIdentifier(entry.messageId, "messageId");
	if (!/^[a-f0-9]{64}$/.test(entry.payloadHash)) throw new Error("invalid dedupe payload hash");
	if (entry.outcome.kind === "task") {
		validateIdentifier(entry.outcome.taskId, "dedupe taskId");
	} else if (entry.outcome.kind === "message") {
		validateMessage(entry.outcome.message);
	} else if (entry.outcome.kind !== "pending") {
		throw new Error("unknown dedupe outcome kind");
	}
}
