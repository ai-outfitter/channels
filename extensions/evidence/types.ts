import type { OutfitterTaskLocator } from "../a2a/types.ts";

export const EVIDENCE_VERSION = 1 as const;

export const EVIDENCE_RECORD_TYPES = [
	"task.activation",
	"task.status",
	"model.invocation",
	"model.output",
	"tool.call",
	"tool.result",
	"artifact.created",
	"policy.decision",
	"approval.request",
	"approval.statement",
	"action.execution",
	"effect.verification",
	"capture.gap",
	"run.manifest",
] as const;

export type EvidenceRecordType = (typeof EVIDENCE_RECORD_TYPES)[number];
export type CaptureRequirement = "required" | "optional" | "forbidden";

/** The same locator the task plane stamps; one wire concept, one type. */
export type EvidenceTaskLocator = OutfitterTaskLocator;

export interface EvidenceRunIdentity {
	readonly ticketRunId: string;
	readonly task: EvidenceTaskLocator;
	readonly attemptId: string;
	readonly turnId: string;
}

export interface EvidenceActor {
	readonly principal: string;
	readonly workloadIdentity: string;
}

export interface EvidencePolicyBundle {
	readonly captureProfile: string;
	readonly capture: Readonly<Partial<Record<EvidenceRecordType, CaptureRequirement>>>;
	readonly allowedTools: readonly string[];
	readonly protectedTools?: readonly string[];
}

export interface EvidencePayloadReference {
	readonly mediaType: string;
	readonly digest: string;
	readonly byteSize: number;
	readonly locator: string;
}

export interface EvidenceRecord {
	readonly version: 1;
	readonly recordId: string;
	readonly recordType: EvidenceRecordType;
	readonly ticketRunId: string;
	readonly task: EvidenceTaskLocator;
	readonly attemptId: string;
	readonly turnId: string;
	readonly actionId?: string;
	readonly parentRecordIds: readonly string[];
	readonly sequence: number;
	readonly observedAt: string;
	readonly actor: EvidenceActor;
	readonly policy: {
		readonly bundleDigest: string;
		readonly captureProfile: string;
		readonly decisionRecordId?: string;
	};
	readonly request?: EvidencePayloadReference;
	readonly response?: EvidencePayloadReference;
	readonly capture: {
		readonly required: readonly EvidenceRecordType[];
		readonly present: readonly EvidenceRecordType[];
		readonly missing: readonly EvidenceRecordType[];
	};
	readonly previousCheckpoint?: string;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface EvidenceManifest {
	readonly record: EvidenceRecord;
	readonly recordDigests: readonly string[];
	readonly payloadDigests: readonly string[];
}
