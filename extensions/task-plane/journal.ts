import { mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
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
	| ActivationWakeFailed
	| ActivationQuarantined;

interface JournalLine {
	readonly record: ActivationJournalRecord;
	readonly checksum: string;
}

export class ActivationJournal {
	readonly #path: string;
	readonly #quarantinePath: string;
	// The log is append-only and never compacted, so every lookup is served
	// from an index built alongside it rather than by scanning the records.
	#claims: ActivationClaim[] = [];
	#claimsByProviderKey = new Map<string, ActivationClaim>();
	#claimsByActivationId = new Map<string, ActivationClaim>();
	#accepted = new Set<string>();
	#woken = new Set<string>();
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

	#index(record: ActivationJournalRecord): void {
		if (record.kind === "CLAIM") {
			this.#claims.push(record);
			this.#claimsByProviderKey.set(record.providerKey, record);
			this.#claimsByActivationId.set(record.activationId, record);
		} else if (record.kind === "ACCEPTED") {
			this.#accepted.add(record.activationId);
		} else if (record.kind === "WOKEN") {
			this.#woken.add(record.activationId);
		} else if (record.kind === "WAKE_FAILED") {
			this.#wakeFailed.add(record.activationId);
		} else {
			this.#quarantined.add(record.activationId);
		}
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: checksum validation distinguishes a recoverable torn tail from corrupt committed records
	async #load(): Promise<void> {
		await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
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
