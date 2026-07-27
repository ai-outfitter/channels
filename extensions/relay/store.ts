import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import {
	AGENT_MAX_PENDING_MESSAGES,
	AGENT_PROTOCOL_VERSION,
	AGENT_RETENTION_MS,
	type AgentMessageV1,
	type AgentSendInput,
	type AgentSendResult,
	validateBody,
	validateIdentifier,
	validateMessage,
} from "../agent/types.ts";

export interface RelayStoredMessage {
	readonly cursor: number;
	readonly message: AgentMessageV1;
}

export interface RelayAccepted extends AgentSendResult {
	readonly cursor: number;
	readonly state: "accepted";
	/** Internal queue state; intentionally not exposed on the wire. */
	readonly queued: boolean;
}

interface RelayDedupeRecord {
	readonly cursor: number;
	readonly id: string;
	readonly conversationId: string;
	readonly sender: string;
	readonly recipient: string;
	readonly createdAt: string;
	readonly replyTo?: string;
	readonly bodyHash: string;
}

interface RelayStoreData {
	readonly version: 2;
	nextCursor: number;
	messages: RelayStoredMessage[];
	acknowledged: Record<string, number>;
	dedupe: RelayDedupeRecord[];
}

const MAX_DEDUPE_RECORDS = 10_000;

/**
 * Durable, single-process offline-delivery queue.
 *
 * Message bodies remain here only until the recipient acknowledges that the
 * envelope and checkpoint were appended to its Pi JSONL session. ACK compacts
 * those bodies immediately. Bounded, body-free hashes remain temporarily for
 * idempotent send retries; this store never serves transcript/history reads.
 */
export class RelayStore {
	readonly #path: string;
	#data: RelayStoreData = {
		version: 2,
		nextCursor: 1,
		messages: [],
		acknowledged: {},
		dedupe: [],
	};
	#initialized: Promise<void> | undefined;
	#operations: Promise<unknown> = Promise.resolve();
	#closed = false;

	constructor(path: string) {
		if (!path) throw new Error("relay store path is required");
		this.#path = path;
	}

	async initialize(): Promise<void> {
		if (this.#closed) throw new Error("relay store is closed");
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

	async accept(sender: string, input: AgentSendInput): Promise<RelayAccepted> {
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: validation, pending retry, and body-free dedupe are one atomic queue operation
		return this.#run(async () => {
			const validatedSender = validateIdentifier(sender, "sender");
			const id = validateIdentifier(input.id ?? randomUUID(), "message id");
			const recipient = validateIdentifier(input.recipient, "recipient");
			const conversationId = validateIdentifier(input.conversationId, "conversation id");
			const body = validateBody(input.body);
			const replyTo =
				input.replyTo === undefined ? undefined : validateIdentifier(input.replyTo, "reply target");
			this.#prune(Date.now());
			const pending = this.#data.messages.find((entry) => entry.message.id === id);
			if (pending) {
				assertSameInput(pending.message, validatedSender, {
					...input,
					id,
					recipient,
					conversationId,
					body,
					...(replyTo ? { replyTo } : {}),
				});
				return {
					cursor: pending.cursor,
					message: pending.message,
					state: "accepted",
					duplicate: true,
					queued: true,
				};
			}
			const dedupe = this.#data.dedupe.find((entry) => entry.id === id);
			if (dedupe) {
				assertSameDedupe(dedupe, validatedSender, recipient, conversationId, body, replyTo);
				return {
					cursor: dedupe.cursor,
					message: validateMessage({
						version: AGENT_PROTOCOL_VERSION,
						id: dedupe.id,
						conversationId: dedupe.conversationId,
						sender: dedupe.sender,
						recipient: dedupe.recipient,
						createdAt: dedupe.createdAt,
						body,
						...(dedupe.replyTo ? { replyTo: dedupe.replyTo } : {}),
					}),
					state: "accepted",
					duplicate: true,
					queued: false,
				};
			}
			const pendingCount = this.#data.messages.filter(
				(entry) => entry.message.recipient === recipient,
			).length;
			if (pendingCount >= AGENT_MAX_PENDING_MESSAGES) {
				throw new Error(`recipient queue is full (${AGENT_MAX_PENDING_MESSAGES})`);
			}
			const message = validateMessage({
				version: AGENT_PROTOCOL_VERSION,
				id,
				conversationId,
				sender: validatedSender,
				recipient,
				createdAt: new Date().toISOString(),
				body,
				...(replyTo ? { replyTo } : {}),
			});
			const cursor = this.#data.nextCursor;
			this.#data.nextCursor += 1;
			this.#data.messages.push({ cursor, message });
			this.#data.dedupe.push(toDedupe(cursor, message));
			this.#boundDedupe();
			await this.#persist();
			return { cursor, message, state: "accepted", duplicate: false, queued: true };
		});
	}

	async pending(endpoint: string, after: number): Promise<readonly RelayStoredMessage[]> {
		return this.#run(async () => {
			const id = validateIdentifier(endpoint, "endpoint id");
			requireCursor(after);
			const removed = this.#prune(Date.now());
			if (removed > 0) await this.#persist();
			return this.#data.messages
				.filter((entry) => entry.message.recipient === id && entry.cursor > after)
				.sort((a, b) => a.cursor - b.cursor);
		});
	}

	async acknowledge(endpoint: string, cursor: number): Promise<number> {
		return this.#run(async () => {
			const id = validateIdentifier(endpoint, "endpoint id");
			requireCursor(cursor);
			const current = this.#data.acknowledged[id] ?? 0;
			if (cursor <= current) return current;
			const owned = this.#data.messages.some(
				(entry) => entry.cursor === cursor && entry.message.recipient === id,
			);
			if (!owned) throw new Error("cursor does not belong to endpoint");
			this.#data.acknowledged[id] = cursor;
			this.#compactAcknowledged(id, cursor);
			await this.#persist();
			return cursor;
		});
	}

	async resume(endpoint: string, cursor: number): Promise<number> {
		return this.#run(async () => {
			const id = validateIdentifier(endpoint, "endpoint id");
			requireCursor(cursor);
			const current = this.#data.acknowledged[id] ?? 0;
			if (cursor > current) {
				const owned = this.#data.messages.some(
					(entry) => entry.cursor === cursor && entry.message.recipient === id,
				);
				if (!owned) throw new Error("resume cursor does not belong to endpoint");
				this.#data.acknowledged[id] = cursor;
				this.#compactAcknowledged(id, cursor);
				await this.#persist();
			}
			return Math.max(current, cursor);
		});
	}

	async acknowledged(endpoint: string): Promise<number> {
		return this.#run(async () => {
			const id = validateIdentifier(endpoint, "endpoint id");
			return this.#data.acknowledged[id] ?? 0;
		});
	}

	async pruneExpired(now = Date.now()): Promise<number> {
		return this.#run(async () => {
			const removed = this.#prune(now);
			if (removed > 0) await this.#persist();
			return removed;
		});
	}

	async ready(): Promise<boolean> {
		try {
			await this.#run(async () => {
				await this.#persist();
			});
			return true;
		} catch {
			return false;
		}
	}

	close(): void {
		this.#closed = true;
	}

	async #run<T>(operation: () => Promise<T>): Promise<T> {
		await this.initialize();
		const result = this.#operations.then(operation, operation);
		this.#operations = result;
		return result;
	}

	#compactAcknowledged(endpoint: string, cursor: number): void {
		this.#data.messages = this.#data.messages.filter(
			(entry) => entry.message.recipient !== endpoint || entry.cursor > cursor,
		);
	}

	#prune(now: number): number {
		const cutoff = now - AGENT_RETENTION_MS;
		const before = this.#data.messages.length;
		this.#data.messages = this.#data.messages.filter(
			(entry) => Date.parse(entry.message.createdAt) >= cutoff,
		);
		this.#data.dedupe = this.#data.dedupe.filter((entry) => Date.parse(entry.createdAt) >= cutoff);
		this.#boundDedupe();
		return before - this.#data.messages.length;
	}

	#boundDedupe(): void {
		if (this.#data.dedupe.length > MAX_DEDUPE_RECORDS) {
			this.#data.dedupe.splice(0, this.#data.dedupe.length - MAX_DEDUPE_RECORDS);
		}
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

function parseStoreData(value: unknown): RelayStoreData {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("invalid relay delivery store");
	}
	const parsed = value as Partial<RelayStoreData>;
	if (
		parsed.version !== 2 ||
		!Number.isSafeInteger(parsed.nextCursor) ||
		(parsed.nextCursor ?? 0) < 1 ||
		!Array.isArray(parsed.messages) ||
		!parsed.acknowledged ||
		typeof parsed.acknowledged !== "object" ||
		Array.isArray(parsed.acknowledged) ||
		!Array.isArray(parsed.dedupe)
	) {
		throw new Error("unsupported relay delivery store");
	}
	for (const entry of parsed.messages) {
		requireCursor(entry.cursor);
		validateMessage(entry.message);
	}
	for (const [endpoint, cursor] of Object.entries(parsed.acknowledged)) {
		validateIdentifier(endpoint, "endpoint id");
		requireCursor(cursor);
	}
	for (const entry of parsed.dedupe) validateDedupe(entry);
	return parsed as RelayStoreData;
}

function validateDedupe(entry: RelayDedupeRecord): void {
	requireCursor(entry.cursor);
	validateIdentifier(entry.id, "message id");
	validateIdentifier(entry.conversationId, "conversation id");
	validateIdentifier(entry.sender, "sender");
	validateIdentifier(entry.recipient, "recipient");
	if (entry.replyTo) validateIdentifier(entry.replyTo, "reply target");
	if (!Number.isFinite(Date.parse(entry.createdAt)) || !/^[a-f0-9]{64}$/.test(entry.bodyHash)) {
		throw new Error("invalid relay dedupe record");
	}
}

function toDedupe(cursor: number, message: AgentMessageV1): RelayDedupeRecord {
	return {
		cursor,
		id: message.id,
		conversationId: message.conversationId,
		sender: message.sender,
		recipient: message.recipient,
		createdAt: message.createdAt,
		...(message.replyTo ? { replyTo: message.replyTo } : {}),
		bodyHash: hashBody(message.body),
	};
}

function assertSameInput(message: AgentMessageV1, sender: string, input: AgentSendInput): void {
	if (
		message.sender !== sender ||
		message.recipient !== input.recipient ||
		message.conversationId !== input.conversationId ||
		message.body !== input.body ||
		message.replyTo !== input.replyTo
	) {
		throw new Error(`message id "${message.id}" already exists with different content`);
	}
}

function assertSameDedupe(
	entry: RelayDedupeRecord,
	sender: string,
	recipient: string,
	conversationId: string,
	body: string,
	replyTo: string | undefined,
): void {
	if (
		entry.sender !== sender ||
		entry.recipient !== recipient ||
		entry.conversationId !== conversationId ||
		entry.bodyHash !== hashBody(body) ||
		entry.replyTo !== replyTo
	) {
		throw new Error(`message id "${entry.id}" already exists with different content`);
	}
}

function hashBody(body: string): string {
	return createHash("sha256").update(body).digest("hex");
}

function requireCursor(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new Error("invalid cursor");
	}
	return value;
}
