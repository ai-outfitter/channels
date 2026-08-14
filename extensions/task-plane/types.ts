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
}

/** The deliberately narrower sink injected into untrusted provider sources. */
export interface SourceTaskActivationSink {
	accept(input: NativeActivation): Promise<ActivationAcceptance>;
	continue(input: NativeSourceContinuation): Promise<ActivationAcceptance>;
}

export interface OutboundDelivery {
	readonly deliveryId: string;
	readonly taskId: string;
	readonly source: string;
	readonly state: "prepared" | "sending" | "delivered" | "failed" | "ambiguous";
	readonly updatedAt: string;
	readonly providerResponseId?: string;
}
