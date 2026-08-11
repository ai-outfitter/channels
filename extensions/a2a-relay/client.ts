import type { A2aArtifact, A2aMessage, A2aTask, A2aTaskState } from "../a2a/types.ts";
import type { A2aRelayDelivery } from "./store.ts";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface A2aRelayClientConfig {
	readonly baseUrl: string;
	readonly token: string;
	readonly allowInsecureLoopback?: boolean;
	readonly timeoutMs?: number;
	readonly fetch?: typeof globalThis.fetch;
}

export interface A2aRelayClaim {
	readonly delivery: A2aRelayDelivery & { readonly lease: NonNullable<A2aRelayDelivery["lease"]> };
	readonly task: A2aTask;
}

export class A2aRelayConnectorError extends Error {
	readonly status: number;
	readonly code: string | undefined;

	constructor(status: number, message: string, code?: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

/** Outbound-only client used by a private resident agent. */
export class A2aRelayClient {
	readonly #baseUrl: URL;
	readonly #token: string;
	readonly #timeoutMs: number;
	readonly #fetch: typeof globalThis.fetch;

	constructor(config: A2aRelayClientConfig) {
		this.#baseUrl = validateBaseUrl(config.baseUrl, config.allowInsecureLoopback ?? false);
		if (!config.token.trim()) throw new Error("A2A relay connector token is required");
		this.#token = config.token;
		this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1) {
			throw new Error("A2A relay connector timeoutMs must be a positive integer");
		}
		this.#fetch = config.fetch ?? globalThis.fetch;
	}

	async claim(): Promise<A2aRelayClaim | undefined> {
		const response = await this.#request("GET", "v1/tasks:claim");
		if (response.status === 204) return undefined;
		return parseJson(await readBoundedText(response)) as A2aRelayClaim;
	}

	readTask(taskId: string, leaseId: string): Promise<A2aTask> {
		return this.#json("GET", `v1/tasks/${identifier(taskId)}`, leaseId);
	}

	renew(taskId: string, leaseId: string): Promise<A2aRelayClaim["delivery"]> {
		return this.#json("POST", `v1/tasks/${identifier(taskId)}:renew`, leaseId);
	}

	release(taskId: string, leaseId: string): Promise<void> {
		return this.#json("POST", `v1/tasks/${identifier(taskId)}:release`, leaseId).then(
			() => undefined,
		);
	}

	updateStatus(
		taskId: string,
		leaseId: string,
		state: A2aTaskState,
		message?: A2aMessage,
	): Promise<A2aTask> {
		return this.#json("POST", `v1/tasks/${identifier(taskId)}:status`, leaseId, {
			state,
			...(message ? { message } : {}),
		});
	}

	addArtifact(taskId: string, leaseId: string, artifact: A2aArtifact): Promise<A2aTask> {
		return this.#json("POST", `v1/tasks/${identifier(taskId)}:artifact`, leaseId, { artifact });
	}

	async #json<T>(
		method: "GET" | "POST",
		path: string,
		leaseId: string,
		body?: unknown,
	): Promise<T> {
		const response = await this.#request(method, path, leaseId, body);
		return parseJson(await readBoundedText(response)) as T;
	}

	async #request(
		method: "GET" | "POST",
		path: string,
		leaseId?: string,
		body?: unknown,
	): Promise<Response> {
		const response = await this.#fetch(new URL(`./${path}`, this.#baseUrl), {
			method,
			headers: {
				authorization: `Bearer ${this.#token}`,
				accept: "application/a2a+json",
				...(leaseId ? { "x-a2a-relay-lease": leaseId } : {}),
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(this.#timeoutMs),
		});
		if (response.ok) return response;
		const text = await readBoundedText(response);
		let parsed: { readonly error?: { readonly code?: string; readonly message?: string } } = {};
		try {
			parsed = parseJson(text) as typeof parsed;
		} catch {
			// Do not expose an infrastructure response body.
		}
		throw new A2aRelayConnectorError(
			response.status,
			parsed.error?.message ?? `A2A relay connector failed with HTTP ${response.status}`,
			parsed.error?.code,
		);
	}
}

function validateBaseUrl(value: string, allowInsecureLoopback: boolean): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("A2A relay connector baseUrl must be an absolute URL");
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new Error(
			"A2A relay connector baseUrl must not contain credentials, a query, or a fragment",
		);
	}
	const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
	if (
		url.protocol !== "https:" &&
		!(allowInsecureLoopback && loopback && url.protocol === "http:")
	) {
		throw new Error(
			"A2A relay connector baseUrl must use HTTPS, except explicit loopback development",
		);
	}
	url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
	return url;
}

function identifier(value: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
		throw new Error("A2A relay task or lease id is invalid");
	}
	return encodeURIComponent(value);
}

async function readBoundedText(response: Response): Promise<string> {
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
			throw new A2aRelayConnectorError(502, "A2A relay response exceeded the response limit");
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

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new A2aRelayConnectorError(502, "A2A relay response was not valid JSON");
	}
}
