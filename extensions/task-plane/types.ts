import type { A2aPart } from "../a2a/types.ts";

export interface NativeActivation {
	readonly principal: string;
	readonly source: string;
	readonly providerEventId: string;
	readonly nativeLocator: Readonly<Record<string, string>>;
	readonly receivedAt: string;
	readonly providerDedupeKey: string;
	readonly conversationKey?: string;
	readonly nativeDisplayUrl?: string;
	readonly parts: readonly A2aPart[];
	readonly contentDigest: string;
	readonly evidenceLocator?: string;
}

export interface NativeContinuation extends NativeActivation {
	readonly taskId?: string;
	readonly directReplyToProviderResponseId?: string;
	readonly sourceSupportsReplyAnchors?: boolean;
}

/** Native provider input. An explicit Task selector is never accepted here. */
export interface NativeSourceContinuation extends NativeActivation {
	readonly directReplyToProviderResponseId?: string;
	readonly sourceSupportsReplyAnchors?: boolean;
}

export interface ActivationAcceptance {
	readonly activationId: string;
	readonly taskId: string;
	readonly contextId: string;
	readonly disposition: "created" | "continued" | "duplicate";
}

export interface TaskActivationSink {
	accept(input: NativeActivation): Promise<ActivationAcceptance>;
	continue(input: NativeContinuation): Promise<ActivationAcceptance>;
	/** Journal and queue a Task already created by a trusted protocol binding. */
	claim(input: NativeActivation, taskId: string): Promise<ActivationAcceptance>;
}

/** The deliberately narrower sink injected into untrusted provider sources. */
export interface SourceTaskActivationSink {
	accept(input: NativeActivation): Promise<ActivationAcceptance>;
	continue(input: NativeSourceContinuation): Promise<ActivationAcceptance>;
	checkpoint?<T>(principal: string, source: string): Promise<T | undefined>;
	advanceCheckpoint?<T>(principal: string, source: string, checkpoint: T): Promise<void>;
	/** Return the active Task represented by an exact native channel locator. */
	taskForLocator?(source: string, locator: string): Promise<string>;
	/** Report whether a task selected through a native locator is durably terminal. */
	taskIsTerminal?(taskId: string): Promise<boolean>;
	/** Persist source-level evidence that does not create or belong to a Task. */
	recordEvidence?(input: SourceEvidenceInput): Promise<void>;
	deliver?(
		input: OutboundDeliveryInput,
		send: () => Promise<string | undefined>,
		reconcile?: () => Promise<string | undefined>,
	): Promise<string | undefined>;
}

export interface SourceEvidenceInput {
	readonly evidenceId: string;
	readonly source: string;
	readonly kind: string;
	readonly detail?: Readonly<Record<string, string>>;
	/** Update one bounded durable counter instead of appending per-envelope evidence. */
	readonly aggregation?: "counter";
}

export interface OutboundDelivery {
	readonly deliveryId: string;
	readonly taskId: string;
	readonly source: string;
	readonly operationId: string;
	readonly payloadDigest: string;
	readonly recovery: "idempotent" | "lookup" | "ambiguous";
	readonly state: "prepared" | "sending" | "delivered" | "failed" | "ambiguous";
	readonly updatedAt: string;
	readonly providerResponseId?: string;
	readonly error?: string;
}

export interface OutboundDeliveryInput {
	readonly taskId: string;
	readonly source: string;
	readonly operationId: string;
	readonly payloadDigest: string;
	readonly recovery: "idempotent" | "lookup" | "ambiguous";
}
