import {
	A2A_MEDIA_TYPE,
	A2A_PROTOCOL_VERSION,
	A2A_VERSION_HEADER,
	type A2aErrorBody,
	type A2aSendMessageRequest,
	type A2aSendMessageResponse,
	type A2aStreamResponse,
	type A2aTask,
	type A2aTaskState,
} from "./types.ts";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface A2aClientConfig {
	readonly baseUrl: string;
	readonly token: string;
	readonly allowInsecureLoopback?: boolean;
	readonly timeoutMs?: number;
	readonly fetch?: typeof globalThis.fetch;
}

export interface A2aListTasksFilter {
	readonly contextId?: string;
	readonly status?: A2aTaskState;
	readonly statusTimestampAfter?: string;
	readonly pageSize?: number;
	readonly historyLength?: number;
	readonly pageToken?: string;
	readonly includeArtifacts?: boolean;
}

export interface A2aListTasksPage {
	readonly tasks: readonly A2aTask[];
	readonly nextPageToken: string;
}

export class A2aRemoteError extends Error {
	readonly status: number;
	readonly reason: string | undefined;

	constructor(status: number, message: string, reason?: string) {
		super(message);
		this.status = status;
		this.reason = reason;
	}
}

/** Authenticated HTTP+JSON client for one deployment-approved A2A interface. */
export class A2aClient {
	readonly #baseUrl: URL;
	readonly #token: string;
	readonly #timeoutMs: number;
	readonly #fetch: typeof globalThis.fetch;

	constructor(config: A2aClientConfig) {
		this.#baseUrl = validateBaseUrl(config.baseUrl, config.allowInsecureLoopback ?? false);
		if (!config.token.trim()) throw new Error("A2A bearer token is required");
		this.#token = config.token;
		this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1) {
			throw new Error("A2A client timeoutMs must be a positive integer");
		}
		this.#fetch = config.fetch ?? globalThis.fetch;
	}

	sendMessage(request: A2aSendMessageRequest): Promise<A2aSendMessageResponse> {
		return this.#json("POST", "message:send", request);
	}

	getTask(taskId: string, historyLength?: number): Promise<A2aTask> {
		const query = new URLSearchParams();
		if (historyLength !== undefined)
			query.set("historyLength", integer(historyLength, "historyLength"));
		return this.#json("GET", withQuery(`tasks/${pathIdentifier(taskId)}`, query));
	}

	listTasks(filter: A2aListTasksFilter = {}): Promise<A2aListTasksPage> {
		const query = new URLSearchParams();
		if (filter.contextId !== undefined) query.set("contextId", filter.contextId);
		if (filter.status !== undefined) query.set("status", filter.status);
		if (filter.statusTimestampAfter !== undefined) {
			query.set("statusTimestampAfter", filter.statusTimestampAfter);
		}
		if (filter.pageSize !== undefined) query.set("pageSize", integer(filter.pageSize, "pageSize"));
		if (filter.historyLength !== undefined) {
			query.set("historyLength", integer(filter.historyLength, "historyLength"));
		}
		if (filter.pageToken !== undefined) query.set("pageToken", filter.pageToken);
		if (filter.includeArtifacts !== undefined) {
			query.set("includeArtifacts", String(filter.includeArtifacts));
		}
		return this.#json("GET", withQuery("tasks", query));
	}

	cancelTask(taskId: string): Promise<A2aTask> {
		return this.#json("POST", `tasks/${pathIdentifier(taskId)}:cancel`);
	}

	async subscribeTask(
		taskId: string,
		onEvent: (event: A2aStreamResponse) => void,
		signal?: AbortSignal,
	): Promise<void> {
		const response = await this.#request(
			"GET",
			`tasks/${pathIdentifier(taskId)}:subscribe`,
			undefined,
			signal,
			true,
		);
		if (!response.body) throw new A2aRemoteError(502, "A2A subscription response has no body");
		const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
		let buffer = "";
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer = consumeSseFrames(buffer + value, onEvent);
				if (Buffer.byteLength(buffer) > MAX_RESPONSE_BYTES) {
					throw new A2aRemoteError(502, "A2A subscription frame exceeded the response limit");
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	async #json<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
		const response = await this.#request(method, path, body);
		return parseJson(await readBoundedText(response)) as T;
	}

	async #request(
		method: "GET" | "POST",
		path: string,
		body?: unknown,
		signal?: AbortSignal,
		connectionOnlyTimeout = false,
	): Promise<Response> {
		const timeoutController = connectionOnlyTimeout ? new AbortController() : undefined;
		const timeout = timeoutController?.signal ?? AbortSignal.timeout(this.#timeoutMs);
		const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
		const timer = timeoutController
			? setTimeout(() => timeoutController.abort(), this.#timeoutMs)
			: undefined;
		let response: Response;
		try {
			response = await this.#fetch(new URL(`./${path}`, this.#baseUrl), {
				method,
				headers: {
					authorization: `Bearer ${this.#token}`,
					accept: A2A_MEDIA_TYPE,
					[A2A_VERSION_HEADER]: A2A_PROTOCOL_VERSION,
					...(body === undefined ? {} : { "content-type": A2A_MEDIA_TYPE }),
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				signal: combined,
			});
		} finally {
			if (timer) clearTimeout(timer);
		}
		if (response.ok) return response;
		const text = await readBoundedText(response);
		let error: A2aErrorBody | undefined;
		try {
			error = parseJson(text) as A2aErrorBody;
		} catch {
			// The remote failed outside its A2A handler. Keep the response body out
			// of the error because it may contain proxy or infrastructure details.
		}
		throw new A2aRemoteError(
			response.status,
			error?.message ?? `A2A request failed with HTTP ${response.status}`,
			error?.details?.[0]?.reason,
		);
	}
}

function validateBaseUrl(value: string, allowInsecureLoopback: boolean): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("A2A baseUrl must be an absolute URL");
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new Error("A2A baseUrl must not contain credentials, a query, or a fragment");
	}
	const loopback =
		url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "localhost";
	if (
		url.protocol !== "https:" &&
		!(allowInsecureLoopback && loopback && url.protocol === "http:")
	) {
		throw new Error("A2A baseUrl must use HTTPS, except explicit loopback development");
	}
	url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
	return url;
}

function pathIdentifier(value: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
		throw new Error("A2A task id is invalid");
	}
	return encodeURIComponent(value);
}

function integer(value: number, label: string): string {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new Error(`${label} must be a non-negative integer`);
	return String(value);
}

function withQuery(path: string, query: URLSearchParams): string {
	const encoded = query.toString();
	return encoded ? `${path}?${encoded}` : path;
}

function consumeSseFrames(input: string, onEvent: (event: A2aStreamResponse) => void): string {
	let buffer = input;
	for (;;) {
		const boundary = buffer.search(/\r?\n\r?\n/);
		if (boundary < 0) return buffer;
		const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? "\n\n";
		const frame = buffer.slice(0, boundary);
		buffer = buffer.slice(boundary + separator.length);
		for (const line of frame.split(/\r?\n/)) {
			if (line.startsWith("data: ")) onEvent(parseJson(line.slice(6)) as A2aStreamResponse);
		}
	}
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
			throw new A2aRemoteError(502, "A2A response exceeded the response limit");
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
		throw new A2aRemoteError(502, "A2A response was not valid JSON");
	}
}
