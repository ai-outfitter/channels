import { createHash } from "node:crypto";
import { A2aError } from "../a2a/types.ts";

export type PermanentIntakeFailure =
	| { readonly kind: "permanent-duplicate-conflict" }
	| { readonly kind: "permanent-invalid-activation" };

/**
 * Classify failures at the provider-to-Task intake boundary. Invalid source
 * activations and provider-key payload conflicts cannot improve on retry;
 * network failures, server failures, and unknown errors must retain the item.
 */
export function permanentIntakeFailure(error: unknown): PermanentIntakeFailure | undefined {
	if (error instanceof A2aError) {
		if (error.reason === "DUPLICATE_MESSAGE_ID") {
			return { kind: "permanent-duplicate-conflict" };
		}
		if (error.httpStatus >= 400 && error.httpStatus < 500) {
			return { kind: "permanent-invalid-activation" };
		}
		return undefined;
	}
	if (error instanceof Error && isPlainActivationValidationError(error.message)) {
		return { kind: "permanent-invalid-activation" };
	}
	return undefined;
}

function isPlainActivationValidationError(message: string): boolean {
	return (
		message === "receivedAt is invalid" ||
		message === "contentDigest must be a SHA-256 digest" ||
		message === "nativeLocator is required" ||
		message === "activation parts are required" ||
		/^nativeLocator\.[^ ]+ must be a non-empty string of at most 4096 characters$/.test(message) ||
		/^task ".+" conflicts with its activation claim$/.test(message) ||
		/^message ".+" conflicts with its activation claim$/.test(message) ||
		message === "activation conflicts with its durable claim" ||
		message === "origin relation conflicts" ||
		message === "activation evidence conflicts with its durable claim" ||
		message === "activation claim was lost"
	);
}

/** Stable identifier-safe representation for provider values that can contain URLs, @, or /. */
export function sourceIdentifier(prefix: string, raw: string): string {
	return `${prefix}:${createHash("sha256").update(raw).digest("hex").slice(0, 40)}`;
}

export function contentDigest(value: unknown): string {
	return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
