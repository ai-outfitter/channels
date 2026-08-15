import { createHash } from "node:crypto";

/** Stable identifier-safe representation for provider values that can contain URLs, @, or /. */
export function sourceIdentifier(prefix: string, raw: string): string {
	return `${prefix}:${createHash("sha256").update(raw).digest("hex").slice(0, 40)}`;
}

export function contentDigest(value: unknown): string {
	return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
