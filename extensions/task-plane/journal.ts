import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { TASK_RETENTION_MS } from "../a2a/store.ts";
import { serialize, sha256Hex } from "./serialize.ts";
import type { NativeActivation } from "./types.ts";

export interface ActivationClaim {
	readonly kind: "CLAIM";
	readonly providerKey: string;
	readonly activationId: string;
	readonly taskId: string;
	readonly input: NativeActivation;
	readonly contextId: string;
	readonly intendedRoute: "created" | "continued";
	/** The trusted protocol binding persisted this Task and message before claiming it. */
	readonly taskAlreadyPersisted?: true;
	readonly claimedAt: string;
}

export interface ActivationAccepted {
	readonly kind: "ACCEPTED";
	readonly activationId: string;
	readonly acceptedAt: string;
}

export interface ActivationWoken {
	readonly kind: "WOKEN";
	readonly activationId: string;
	readonly wokenAt: string;
}

export interface ActivationWakeDelivered {
	readonly kind: "WAKE_DELIVERED";
	readonly activationId: string;
	readonly delivery: number;
	readonly deliveredAt: string;
}

export interface ActivationWakeFailed {
	readonly kind: "WAKE_FAILED";
	readonly activationId: string;
	readonly attempts: number;
	readonly error: string;
	readonly failedAt: string;
}

export interface ActivationQuarantined {
	readonly kind: "QUARANTINED";
	readonly activationId: string;
	readonly error: string;
	readonly quarantinedAt: string;
}

export type ActivationJournalRecord =
	| ActivationClaim
	| ActivationAccepted
	| ActivationWoken
	| ActivationWakeDelivered
	| ActivationWakeFailed
	| ActivationQuarantined;

interface JournalLine {
	readonly record: ActivationJournalRecord;
	readonly checksum: string;
}

export class ActivationJournal {
	readonly #path: string;
	readonly #quarantinePath: string;
	// Lookups are served from indexes rebuilt after load and compaction.
	#claims: ActivationClaim[] = [];
	#claimsByProviderKey = new Map<string, ActivationClaim>();
	#claimsByActivationId = new Map<string, ActivationClaim>();
	#accepted = new Set<string>();
	#woken = new Set<string>();
	#wakeDeliveries = new Map<string, number>();
	#wakeFailed = new Set<string>();
	#quarantined = new Set<string>();
	#initialized: Promise<void> | undefined;
	#operations: Promise<unknown> = Promise.resolve();

	constructor(path: string, quarantinePath = `${path}.quarantine`) {
		this.#path = path;
		this.#quarantinePath = quarantinePath;
	}

	async initialize(): Promise<void> {
		if (!this.#initialized) this.#initialized = this.#load();
		await this.#initialized;
	}

	claims(): readonly ActivationClaim[] {
		return this.#claims;
	}

	claimByProviderKey(providerKey: string): ActivationClaim | undefined {
		return this.#claimsByProviderKey.get(providerKey);
	}

	claimByActivationId(activationId: string): ActivationClaim | undefined {
		return this.#claimsByActivationId.get(activationId);
	}

	isAccepted(activationId: string): boolean {
		return this.#accepted.has(activationId);
	}

	isWoken(activationId: string): boolean {
		return this.#woken.has(activationId);
	}

	wakeDeliveries(activationId: string): number {
		return this.#wakeDeliveries.get(activationId) ?? 0;
	}

	isWakeFailed(activationId: string): boolean {
		return this.#wakeFailed.has(activationId);
	}

	isQuarantined(activationId: string): boolean {
		return this.#quarantined.has(activationId);
	}

	async append(
		record: ActivationJournalRecord,
		afterAppend?: () => void | Promise<void>,
	): Promise<void> {
		await this.initialize();
		const operation = serialize(this.#operations, async () => {
			const line: JournalLine = { record, checksum: checksum(record) };
			const file = await open(this.#path, "a", 0o600);
			const offset = await file.stat().then(
				(value) => value.size,
				async (error) => {
					await file.close().catch(() => {});
					throw error;
				},
			);
			try {
				await file.writeFile(`${JSON.stringify(line)}\n`);
				await afterAppend?.();
				await file.sync();
				await file.close();
			} catch (error) {
				await file.close().catch(() => {});
				try {
					const rollback = await open(this.#path, "r+");
					try {
						await rollback.truncate(offset);
						await rollback.sync();
					} finally {
						await rollback.close();
					}
				} catch (rollbackError) {
					if (error instanceof Error) error.cause = rollbackError;
				}
				throw error;
			}
			// Never publish an index entry until both the durable flush and handle
			// close have succeeded. A retry then sees exactly the rolled-back state.
			this.#index(record);
		});
		this.#operations = operation;
		await operation;
	}

	/**
	 * Rewrite the journal to the retention contract. Incomplete claims and all
	 * records for retained Tasks survive regardless of age. Accepted claims never
	 * outlive their Task; quarantine evidence expires after the retention window.
	 */
	async compact(now: number, retainedTaskIds: ReadonlySet<string>): Promise<void> {
		await this.initialize();
		const operation = serialize(this.#operations, async () => {
			const cutoff = now - TASK_RETENTION_MS;
			const retainedActivations = new Set(
				this.#claims
					.filter((claim) => {
						const accepted = this.#accepted.has(claim.activationId);
						const quarantined = this.#quarantined.has(claim.activationId);
						if (!accepted && !quarantined) return true;
						if (retainedTaskIds.has(claim.taskId)) return true;
						// An accepted claim may never dedupe to a Task that no longer
						// exists. Quarantine evidence remains auditable for the window.
						return quarantined && Date.parse(claim.claimedAt) >= cutoff;
					})
					.map((claim) => claim.activationId),
			);
			const records = await this.#readRecords();
			const kept = records.filter((record) => retainedActivations.has(record.activationId));
			const temporary = `${this.#path}.${process.pid}.${randomUUID()}.compact.tmp`;
			const file = await open(temporary, "wx", 0o600);
			try {
				await file.writeFile(
					kept.map((record) => JSON.stringify({ record, checksum: checksum(record) })).join("\n") +
						(kept.length > 0 ? "\n" : ""),
				);
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
			this.#resetIndexes();
			for (const record of kept) this.#index(record);
		});
		this.#operations = operation;
		await operation;
	}

	async #readRecords(): Promise<ActivationJournalRecord[]> {
		const text = await readFile(this.#path, "utf8");
		return text
			.split("\n")
			.filter(Boolean)
			.map((raw) => (JSON.parse(raw) as JournalLine).record);
	}

	#resetIndexes(): void {
		this.#claims = [];
		this.#claimsByProviderKey.clear();
		this.#claimsByActivationId.clear();
		this.#accepted.clear();
		this.#woken.clear();
		this.#wakeDeliveries.clear();
		this.#wakeFailed.clear();
		this.#quarantined.clear();
	}

	#index(record: ActivationJournalRecord): void {
		if (record.kind === "CLAIM") {
			this.#claims.push(record);
			this.#claimsByProviderKey.set(record.providerKey, record);
			this.#claimsByActivationId.set(record.activationId, record);
		} else if (record.kind === "ACCEPTED") {
			this.#accepted.add(record.activationId);
		} else if (record.kind === "WOKEN") {
			this.#woken.add(record.activationId);
		} else if (record.kind === "WAKE_DELIVERED") {
			this.#wakeDeliveries.set(
				record.activationId,
				Math.max(record.delivery, this.#wakeDeliveries.get(record.activationId) ?? 0),
			);
		} else if (record.kind === "WAKE_FAILED") {
			this.#wakeFailed.add(record.activationId);
		} else {
			this.#quarantined.add(record.activationId);
		}
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: checksum validation distinguishes a recoverable torn tail from corrupt committed records
	async #load(): Promise<void> {
		await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
		const compactPrefix = `${basename(this.#path)}.`;
		for (const entry of await readdir(dirname(this.#path))) {
			if (entry.startsWith(compactPrefix) && entry.endsWith(".compact.tmp")) {
				await unlink(join(dirname(this.#path), entry)).catch(() => {});
			}
		}
		let bytes: Buffer;
		try {
			bytes = await readFile(this.#path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			const journal = await open(this.#path, "wx", 0o600);
			await journal.close();
			const directory = await open(dirname(this.#path), "r");
			try {
				await directory.sync();
			} finally {
				await directory.close();
			}
			return;
		}
		let offset = 0;
		const lines = bytes.toString("utf8").split("\n");
		const hasFinalNewline = bytes.length === 0 || bytes.at(-1) === 10;
		for (let index = 0; index < lines.length; index += 1) {
			const raw = lines[index] as string;
			const lineBytes = Buffer.byteLength(raw) + (index < lines.length - 1 ? 1 : 0);
			if (!raw) {
				offset += lineBytes;
				continue;
			}
			try {
				const line = JSON.parse(raw) as JournalLine;
				if (!line.record || line.checksum !== checksum(line.record)) {
					throw new Error("activation journal checksum mismatch");
				}
				this.#index(line.record);
				offset += lineBytes;
			} catch (error) {
				const final = index === lines.length - 1 && !hasFinalNewline;
				if (!final) throw error;
				const quarantine = await open(this.#quarantinePath, "a", 0o600);
				try {
					await quarantine.writeFile(bytes.subarray(offset));
					await quarantine.sync();
				} finally {
					await quarantine.close();
				}
				const journal = await open(this.#path, "r+");
				try {
					await journal.truncate(offset);
					await journal.sync();
				} finally {
					await journal.close();
				}
				return;
			}
		}
	}
}

function checksum(record: ActivationJournalRecord): string {
	return sha256Hex(JSON.stringify(record));
}
