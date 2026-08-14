import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { type A2aTaskStore, TASK_RETENTION_MS } from "../a2a/store.ts";
import { validateIdentifier } from "../a2a/types.ts";
import { serialize } from "./serialize.ts";
import type { NativeActivation, OutboundDelivery } from "./types.ts";

/** Contexts are retained for the same window as the Tasks that reference them. */
const RETENTION_MS = TASK_RETENTION_MS;

/**
 * Crash-safe whole-document write. The caller must have created the parent
 * directory (every store does so once in `initialize`).
 */
export async function atomicWrite(path: string, value: unknown): Promise<void> {
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	const file = await open(temporary, "wx", 0o600);
	try {
		await file.writeFile(`${JSON.stringify(value)}\n`);
		await file.sync();
	} finally {
		await file.close();
	}
	try {
		await rename(temporary, path);
		const directory = await open(dirname(path), "r");
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

/**
 * Validate a version-1 store document. `fields` names each top-level
 * collection and whether it is stored as an array or as a keyed record.
 */
export function parseVersion1<T>(
	value: unknown,
	label: string,
	fields: Readonly<Record<string, "array" | "record">>,
): T {
	const parsed = value as Record<string, unknown> | null;
	const valid =
		parsed?.version === 1 &&
		Object.entries(fields).every(([field, shape]) =>
			shape === "array" ? Array.isArray(parsed[field]) : isRecord(parsed[field]),
		);
	if (!valid) throw new Error(`unsupported ${label}`);
	return parsed as T;
}

function isRecord(value: unknown): boolean {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export abstract class JsonStore<T> {
	readonly path: string;
	protected data: T;
	#initialized: Promise<void> | undefined;
	#operations: Promise<unknown> = Promise.resolve();

	constructor(path: string, initial: T) {
		this.path = path;
		this.data = initial;
	}

	async initialize(): Promise<void> {
		if (!this.#initialized) {
			this.#initialized = (async () => {
				await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
				await chmod(dirname(this.path), 0o700);
				try {
					this.data = this.parse(JSON.parse(await readFile(this.path, "utf8")));
					return;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				// Only a missing store is created here; a document that parsed
				// cleanly is already the bytes this write would reproduce.
				await atomicWrite(this.path, this.data);
			})();
		}
		await this.#initialized;
	}

	protected abstract parse(value: unknown): T;

	protected async run<R>(operation: () => Promise<R>): Promise<R> {
		await this.initialize();
		const result = serialize(this.#operations, operation);
		this.#operations = result;
		return result;
	}

	protected persist(): Promise<void> {
		return atomicWrite(this.path, this.data);
	}
}

interface ContextRecord {
	readonly principal: string;
	readonly source: string;
	readonly conversationKey: string;
	readonly contextId: string;
	lastActiveAt: string;
}

interface ContextData {
	readonly version: 1;
	contexts: ContextRecord[];
}

export class ContextStore extends JsonStore<ContextData> {
	constructor(path: string) {
		super(path, { version: 1, contexts: [] });
	}

	protected parse(value: unknown): ContextData {
		return parseVersion1(value, "context store", { contexts: "array" });
	}

	async resolve(
		principal: string,
		source: string,
		conversationKey: string | undefined,
		now = new Date(),
	): Promise<string> {
		return this.run(async () => {
			const timestamp = now.toISOString();
			if (!conversationKey) return randomUUID();
			const prior = this.data.contexts.find(
				(entry) =>
					entry.principal === principal &&
					entry.source === source &&
					entry.conversationKey === conversationKey,
			);
			if (prior) {
				prior.lastActiveAt = timestamp;
				await this.persist();
				return prior.contextId;
			}
			const contextId = randomUUID();
			this.data.contexts.push({
				principal,
				source,
				conversationKey,
				contextId,
				lastActiveAt: timestamp,
			});
			await this.persist();
			return contextId;
		});
	}

	/** Drop expired contexts, except those a live Task still refers to. */
	async prune(now: number, retained: ReadonlySet<string>): Promise<void> {
		return this.run(async () => {
			this.data.contexts = this.data.contexts.filter(
				(entry) =>
					Date.parse(entry.lastActiveAt) >= now - RETENTION_MS || retained.has(entry.contextId),
			);
			await this.persist();
		});
	}
}

interface CheckpointData {
	readonly version: 1;
	checkpoints: Record<string, unknown>;
}

export class SourceCheckpointStore extends JsonStore<CheckpointData> {
	constructor(path: string) {
		super(path, { version: 1, checkpoints: {} });
	}

	protected parse(value: unknown): CheckpointData {
		return parseVersion1(value, "source checkpoint store", { checkpoints: "record" });
	}

	async get<T>(principal: string, source: string): Promise<T | undefined> {
		return this.run(async () => this.data.checkpoints[`${principal}\0${source}`] as T | undefined);
	}

	async advance<T>(principal: string, source: string, checkpoint: T): Promise<void> {
		return this.run(async () => {
			this.data.checkpoints[`${principal}\0${source}`] = checkpoint;
			await this.persist();
		});
	}
}

interface ReplyAnchorRecord {
	readonly principal: string;
	readonly source: string;
	readonly providerResponseId: string;
	readonly taskId: string;
	readonly createdAt: string;
}

interface ReplyAnchorData {
	readonly version: 1;
	anchors: ReplyAnchorRecord[];
}

export class ReplyAnchorStore extends JsonStore<ReplyAnchorData> {
	readonly #tasks: Pick<A2aTaskStore, "getTask">;

	constructor(path: string, tasks: Pick<A2aTaskStore, "getTask">) {
		super(path, { version: 1, anchors: [] });
		this.#tasks = tasks;
	}

	protected parse(value: unknown): ReplyAnchorData {
		return parseVersion1(value, "reply-anchor store", { anchors: "array" });
	}

	async record(
		principal: string,
		source: string,
		providerResponseId: string,
		taskId: string,
	): Promise<void> {
		return this.run(async () => {
			validateIdentifier(taskId, "taskId");
			await this.#tasks.getTask(principal, taskId);
			const prior = this.data.anchors.find(
				(entry) =>
					entry.principal === principal &&
					entry.source === source &&
					entry.providerResponseId === providerResponseId,
			);
			if (prior && prior.taskId !== taskId)
				throw new Error("reply anchor already selects another task");
			if (!prior) {
				this.data.anchors.push({
					principal,
					source,
					providerResponseId,
					taskId,
					createdAt: new Date().toISOString(),
				});
			}
			await this.persist();
		});
	}

	async resolve(
		principal: string,
		source: string,
		providerResponseId: string,
	): Promise<string | undefined> {
		return this.run(
			async () =>
				this.data.anchors.find(
					(entry) =>
						entry.principal === principal &&
						entry.source === source &&
						entry.providerResponseId === providerResponseId,
				)?.taskId,
		);
	}
}

interface DeliveryData {
	readonly version: 1;
	deliveries: Record<string, OutboundDelivery>;
}

export class OutboundDeliveryStore extends JsonStore<DeliveryData> {
	constructor(path: string) {
		super(path, { version: 1, deliveries: {} });
	}

	protected parse(value: unknown): DeliveryData {
		return parseVersion1(value, "outbound-delivery store", { deliveries: "record" });
	}

	async put(delivery: OutboundDelivery): Promise<void> {
		return this.run(async () => {
			this.data.deliveries[delivery.deliveryId] = delivery;
			await this.persist();
		});
	}
}

interface ActivationEvidenceRecord {
	readonly activationId: string;
	readonly taskId: string;
	readonly recordType: "task.activation";
	readonly contentDigest: string;
	readonly locator: Readonly<Record<string, string>>;
	readonly recordedAt: string;
}

interface UnhealthyEvidenceRecord {
	readonly activationId: string;
	readonly taskId: string;
	readonly recordType: "activation.unhealthy";
	readonly source: string;
	readonly error: string;
	readonly recordedAt: string;
}

type EvidenceRecord = ActivationEvidenceRecord | UnhealthyEvidenceRecord;

interface EvidenceData {
	readonly version: 1;
	records: EvidenceRecord[];
}

export class ActivationEvidenceStore extends JsonStore<EvidenceData> {
	constructor(path: string) {
		super(path, { version: 1, records: [] });
	}

	protected parse(value: unknown): EvidenceData {
		return parseVersion1(value, "activation evidence store", { records: "array" });
	}

	async append(activationId: string, taskId: string, input: NativeActivation): Promise<void> {
		return this.run(async () => {
			const prior = this.data.records.find(
				(entry) => entry.activationId === activationId && entry.recordType === "task.activation",
			) as ActivationEvidenceRecord | undefined;
			if (prior) {
				if (prior.taskId !== taskId || prior.contentDigest !== input.contentDigest) {
					throw new Error("activation evidence conflicts with its durable claim");
				}
				await this.persist();
				return;
			}
			this.data.records.push({
				activationId,
				taskId,
				recordType: "task.activation",
				contentDigest: input.contentDigest,
				locator: input.nativeLocator,
				recordedAt: new Date().toISOString(),
			});
			await this.persist();
		});
	}

	async appendUnhealthy(
		activationId: string,
		taskId: string,
		source: string,
		error: string,
	): Promise<void> {
		return this.run(async () => {
			const prior = this.data.records.find(
				(entry) =>
					entry.activationId === activationId && entry.recordType === "activation.unhealthy",
			) as UnhealthyEvidenceRecord | undefined;
			if (prior) {
				if (prior.taskId !== taskId || prior.source !== source) {
					throw new Error("unhealthy activation evidence conflicts with its durable claim");
				}
				await this.persist();
				return;
			}
			this.data.records.push({
				activationId,
				taskId,
				recordType: "activation.unhealthy",
				source,
				error,
				recordedAt: new Date().toISOString(),
			});
			await this.persist();
		});
	}
}
