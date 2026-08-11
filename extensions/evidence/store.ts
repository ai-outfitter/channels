import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	EVIDENCE_RECORD_TYPES,
	type EvidenceActor,
	type EvidenceManifest,
	type EvidencePayloadReference,
	type EvidencePolicyBundle,
	type EvidenceRecord,
	type EvidenceRecordType,
	type EvidenceRunIdentity,
} from "./types.ts";

interface LedgerData {
	readonly version: 1;
	records: EvidenceRecord[];
}

export interface AppendEvidenceInput {
	readonly recordType: EvidenceRecordType;
	readonly run: EvidenceRunIdentity;
	readonly actionId?: string;
	readonly parentRecordIds?: readonly string[];
	readonly request?: EvidencePayloadReference;
	readonly response?: EvidencePayloadReference;
	readonly decisionRecordId?: string;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

/** A durable content-addressed development sink. It does not claim compliance-grade retention. */
export class DevelopmentEvidenceStore {
	readonly #rootPath: string;
	readonly #ledgerPath: string;
	readonly #actor: EvidenceActor;
	readonly #policy: EvidencePolicyBundle;
	readonly #policyDigest: string;
	#data: LedgerData = { version: 1, records: [] };
	#initialized: Promise<void> | undefined;
	#operations: Promise<unknown> = Promise.resolve();
	#closed = false;

	constructor(rootPath: string, actor: EvidenceActor, policy: EvidencePolicyBundle) {
		if (!rootPath.startsWith("/")) throw new Error("evidence rootPath must be absolute");
		if (!actor.principal || !actor.workloadIdentity)
			throw new Error("evidence actor is incomplete");
		validatePolicy(policy);
		this.#rootPath = rootPath;
		this.#ledgerPath = join(rootPath, "ledger.json");
		this.#actor = actor;
		this.#policy = structuredClone(policy);
		this.#policyDigest = digest(canonicalJson(policy));
	}

	get policyDigest(): string {
		return this.#policyDigest;
	}

	async initialize(): Promise<void> {
		if (this.#closed) throw new Error("evidence store is closed");
		if (!this.#initialized) {
			this.#initialized = (async () => {
				await mkdir(join(this.#rootPath, "objects"), { recursive: true, mode: 0o700 });
				await chmod(this.#rootPath, 0o700);
				try {
					this.#data = parseLedger(JSON.parse(await readFile(this.#ledgerPath, "utf8")));
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					await this.#persist();
				}
			})();
		}
		await this.#initialized;
	}

	async putPayload(
		value: unknown,
		mediaType = "application/json",
	): Promise<EvidencePayloadReference> {
		await this.initialize();
		const bytes = Buffer.from(
			mediaType === "application/json" ? canonicalJson(value) : String(value),
		);
		const contentDigest = digest(bytes);
		const locator = `objects/${contentDigest.slice(7)}`;
		const path = join(this.#rootPath, locator);
		try {
			const handle = await open(path, "wx", 0o600);
			try {
				await handle.writeFile(bytes);
				await handle.sync();
			} finally {
				await handle.close();
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (digest(await readFile(path)) !== contentDigest)
				throw new Error("evidence object digest mismatch");
		}
		return { mediaType, digest: contentDigest, byteSize: bytes.byteLength, locator };
	}

	async append(input: AppendEvidenceInput): Promise<EvidenceRecord> {
		return this.#run(() => this.#appendUnlocked(input));
	}

	async finalize(run: EvidenceRunIdentity): Promise<EvidenceManifest> {
		return this.#run(async () => {
			const records = this.#data.records.filter((record) => sameRun(record, run));
			const present = new Set(records.map((record) => record.recordType));
			const missing = requiredTypes(this.#policy).filter((type) => !present.has(type));
			if (missing.length > 0)
				throw new Error(`required evidence is missing: ${missing.join(", ")}`);
			const references = records.flatMap((record) =>
				[record.request, record.response].filter(
					(value): value is EvidencePayloadReference => value !== undefined,
				),
			);
			for (const reference of references) await this.#verifyPayload(reference);
			const recordDigests = records.map((record) => digest(canonicalJson(record)));
			const payloadDigests = [...new Set(references.map((reference) => reference.digest))];
			const request = await this.putPayload({ recordDigests, payloadDigests });
			const record = await this.#appendUnlocked({
				recordType: "run.manifest",
				run,
				request,
				metadata: { recordDigests, payloadDigests },
			});
			return { record, recordDigests, payloadDigests };
		});
	}

	async records(run?: EvidenceRunIdentity): Promise<readonly EvidenceRecord[]> {
		await this.initialize();
		return structuredClone(
			run ? this.#data.records.filter((record) => sameRun(record, run)) : this.#data.records,
		);
	}

	async close(): Promise<void> {
		this.#closed = true;
		await this.#operations;
	}

	async #appendUnlocked(input: AppendEvidenceInput): Promise<EvidenceRecord> {
		validateRun(input.run);
		if (this.#policy.capture[input.recordType] === "forbidden") {
			throw new Error(`evidence policy forbids ${input.recordType}`);
		}
		const present = this.#data.records
			.filter((record) => sameRun(record, input.run))
			.map((record) => record.recordType);
		const required = requiredTypes(this.#policy);
		const prior = this.#data.records.at(-1);
		const record: EvidenceRecord = {
			version: 1,
			recordId: randomUUID(),
			recordType: input.recordType,
			ticketRunId: input.run.ticketRunId,
			task: input.run.task,
			attemptId: input.run.attemptId,
			turnId: input.run.turnId,
			...(input.actionId ? { actionId: input.actionId } : {}),
			parentRecordIds: [...(input.parentRecordIds ?? [])],
			sequence: this.#data.records.length + 1,
			observedAt: new Date().toISOString(),
			actor: this.#actor,
			policy: {
				bundleDigest: this.#policyDigest,
				captureProfile: this.#policy.captureProfile,
				...(input.decisionRecordId ? { decisionRecordId: input.decisionRecordId } : {}),
			},
			...(input.request ? { request: input.request } : {}),
			...(input.response ? { response: input.response } : {}),
			capture: {
				required,
				present: [...new Set([...present, input.recordType])],
				missing: required.filter((type) => !present.includes(type) && type !== input.recordType),
			},
			...(prior ? { previousCheckpoint: digest(canonicalJson(prior)) } : {}),
			...(input.metadata ? { metadata: input.metadata } : {}),
		};
		this.#data.records.push(record);
		await this.#persist();
		return record;
	}

	async #verifyPayload(reference: EvidencePayloadReference): Promise<void> {
		const bytes = await readFile(join(this.#rootPath, reference.locator));
		if (bytes.byteLength !== reference.byteSize || digest(bytes) !== reference.digest) {
			throw new Error(`evidence payload ${reference.digest} failed verification`);
		}
	}

	async #run<T>(operation: () => Promise<T>): Promise<T> {
		await this.initialize();
		const result = this.#operations.then(operation, operation);
		this.#operations = result;
		return result;
	}

	async #persist(): Promise<void> {
		await mkdir(dirname(this.#ledgerPath), { recursive: true, mode: 0o700 });
		const temporary = `${this.#ledgerPath}.${process.pid}.${randomUUID()}.tmp`;
		const handle = await open(temporary, "wx", 0o600);
		try {
			await handle.writeFile(`${canonicalJson(this.#data)}\n`);
			await handle.sync();
		} finally {
			await handle.close();
		}
		try {
			await rename(temporary, this.#ledgerPath);
			const directory = await open(dirname(this.#ledgerPath), "r");
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

export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.filter(([, item]) => item !== undefined)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
		.join(",")}}`;
}

function digest(value: string | Uint8Array): string {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requiredTypes(policy: EvidencePolicyBundle): EvidenceRecordType[] {
	return EVIDENCE_RECORD_TYPES.filter((type) => policy.capture[type] === "required");
}

function sameRun(record: EvidenceRecord, run: EvidenceRunIdentity): boolean {
	return (
		record.ticketRunId === run.ticketRunId &&
		record.task.agentInterface === run.task.agentInterface &&
		record.task.taskId === run.task.taskId &&
		record.attemptId === run.attemptId &&
		record.turnId === run.turnId
	);
}

function validatePolicy(policy: EvidencePolicyBundle): void {
	if (!policy.captureProfile || !Array.isArray(policy.allowedTools))
		throw new Error("evidence policy is invalid");
	for (const [type, requirement] of Object.entries(policy.capture)) {
		if (!EVIDENCE_RECORD_TYPES.includes(type as EvidenceRecordType))
			throw new Error(`unknown evidence record type ${type}`);
		if (!["required", "optional", "forbidden"].includes(requirement as string))
			throw new Error(`invalid capture requirement for ${type}`);
	}
}

function validateRun(run: EvidenceRunIdentity): void {
	if (!run.ticketRunId || !run.attemptId || !run.turnId || !run.task.taskId)
		throw new Error("evidence run identity is incomplete");
	if (run.task.protocolBinding !== "HTTP+JSON" || run.task.protocolVersion !== "1.0")
		throw new Error("evidence task locator is unsupported");
	new URL(run.task.agentInterface);
}

function parseLedger(value: unknown): LedgerData {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("evidence ledger is invalid");
	const ledger = value as Partial<LedgerData>;
	if (ledger.version !== 1 || !Array.isArray(ledger.records))
		throw new Error("evidence ledger version is unsupported");
	for (let index = 0; index < ledger.records.length; index += 1) {
		const record = ledger.records[index] as EvidenceRecord;
		if (record.sequence !== index + 1 || !EVIDENCE_RECORD_TYPES.includes(record.recordType))
			throw new Error("evidence ledger record is invalid");
		validateRun(record);
	}
	return ledger as LedgerData;
}
