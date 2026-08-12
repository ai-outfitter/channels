/**
 * Transport hardening shared by every A2A HTTP surface — the task-plane client,
 * the relay connector, and the servers that authenticate them. These rules —
 * HTTPS except opted-in loopback, no credentials in the URL, a hard cap on
 * response bytes, constant-time bearer matching — are security invariants, so
 * they live in one place rather than being restated per surface.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { validateIdentifier } from "./types.ts";

/** Largest response body any A2A client will buffer. */
export const MAX_RESPONSE_BYTES = 1024 * 1024;
/** Default request deadline for A2A clients. */
export const DEFAULT_TIMEOUT_MS = 60_000;

export interface BaseUrlOptions {
	/** Prefix for thrown messages, e.g. `"A2A baseUrl"`. */
	readonly label: string;
	/** Permit `http:` on loopback hosts. Callers opt in explicitly. */
	readonly allowInsecureLoopback: boolean;
}

/** Parse and harden a client base URL, returning it with a trailing-slash path. */
export function validateBaseUrl(value: string, options: BaseUrlOptions): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${options.label} must be an absolute URL`);
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new Error(`${options.label} must not contain credentials, a query, or a fragment`);
	}
	const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
	if (
		url.protocol !== "https:" &&
		!(options.allowInsecureLoopback && loopback && url.protocol === "http:")
	) {
		throw new Error(`${options.label} must use HTTPS, except explicit loopback development`);
	}
	url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
	return url;
}

/** Validate an A2A identifier against the wire grammar and encode it for a URL path. */
export function pathIdentifier(value: string, label: string): string {
	return encodeURIComponent(validateIdentifier(value, label));
}

/** Read a response body, aborting past {@link MAX_RESPONSE_BYTES}. */
export async function readBoundedText(response: Response, tooLarge: () => Error): Promise<string> {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_RESPONSE_BYTES) {
			await reader.cancel();
			throw tooLarge();
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

/**
 * Read an inbound request body, aborting past `maximum` bytes. The inbound
 * mirror of {@link readBoundedText}: the cap is what keeps an unauthenticated
 * caller from buffering a server out of memory, so it lives here rather than
 * being restated per server.
 */
export async function readBoundedBody(
	request: AsyncIterable<unknown>,
	maximum: number,
	tooLarge: () => Error,
): Promise<string> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of request) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
		total += bytes.length;
		if (total > maximum) throw tooLarge();
		chunks.push(bytes);
	}
	return Buffer.concat(chunks).toString("utf8");
}

/**
 * Match an `Authorization` header against configured credentials.
 *
 * Compares fixed-size digests, not the tokens themselves: a raw comparison
 * needs a length short-circuit before timingSafeEqual, and that short-circuit
 * leaks each configured token's length to an unauthenticated prober. Every
 * inbound A2A surface authenticates through this one function so the property
 * is verified once.
 */
export function findBearerCredential<T extends { readonly token: string }>(
	header: string | undefined,
	credentials: readonly T[],
): T | undefined {
	if (!header?.startsWith("Bearer ")) return undefined;
	const token = header.slice("Bearer ".length).trim();
	if (!token) return undefined;
	const digest = (value: string): Buffer => createHash("sha256").update(value).digest();
	const supplied = digest(token);
	return credentials.find((candidate) => timingSafeEqual(digest(candidate.token), supplied));
}

/** Parse a response body as JSON, raising the caller's error type on failure. */
export function parseJson(text: string, invalid: () => Error): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw invalid();
	}
}
