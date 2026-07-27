import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { WebSocket } from "undici";
import {
	parseRelayFrame,
	RELAY_PROTOCOL_VERSION,
	type RelayAuthenticateFrame,
	type RelayClientFrame,
} from "../relay/protocol.ts";
import {
	AGENT_MAX_CONTEXT_BYTES,
	AGENT_MAX_CONTEXT_MESSAGES,
	type AgentEndpoint,
	type AgentMessageV1,
	type AgentReadResult,
	type AgentRespondResult,
	type AgentSendInput,
	type AgentSendResult,
	type AgentTransport,
	advanceState,
	compareMessages,
	type StoredAgentMessage,
	validateBody,
	validateIdentifier,
	validateMessage,
} from "./types.ts";

export interface RelayAgentConfig {
	readonly url: string;
	readonly token: string;
	readonly endpointId: string;
	readonly principalId: string;
	readonly statePath?: string;
	readonly reconnectMs?: number;
}

interface RelayClientState {
	readonly version: 1;
	cursor: number;
	messages: StoredAgentMessage[];
}

interface PendingRequest {
	resolve(frame: Record<string, unknown>): void;
	reject(error: Error): void;
}

export class RelayAgentTransport implements AgentTransport {
	readonly endpoint: AgentEndpoint;
	readonly #config: RelayAgentConfig;
	#state: RelayClientState = { version: 1, cursor: 0, messages: [] };
	#initialized: Promise<void> | undefined;
	#connection: Promise<WebSocket> | undefined;
	#socket: WebSocket | undefined;
	#authenticated = false;
	#closed = false;
	#reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	#incoming: Promise<void> = Promise.resolve();
	readonly #requests = new Map<string, PendingRequest>();
	readonly #listeners = new Set<(messageId: string) => void>();

	constructor(config: RelayAgentConfig) {
		const url = new URL(config.url);
		if (url.protocol !== "wss:" && url.protocol !== "ws:") {
			throw new Error("agent relay URL must use wss:// or ws://");
		}
		if (
			url.protocol === "ws:" &&
			url.hostname !== "127.0.0.1" &&
			url.hostname !== "::1" &&
			url.hostname !== "localhost"
		) {
			throw new Error("insecure agent relay URL is allowed only on loopback");
		}
		this.endpoint = {
			id: validateIdentifier(config.endpointId, "endpoint id"),
			principal: validateIdentifier(config.principalId, "principal id"),
		};
		if (!config.token) throw new Error("agent relay token is required");
		this.#config = config;
	}

	async list(): Promise<readonly AgentEndpoint[]> {
		const response = await this.#request({ type: "list", requestId: randomUUID() });
		if (response.type !== "endpoints" || !Array.isArray(response.endpoints)) {
			throw new Error("relay returned an invalid endpoint list");
		}
		return response.endpoints as unknown as AgentEndpoint[];
	}

	async send(input: AgentSendInput): Promise<AgentSendResult> {
		validateIdentifier(input.recipient, "recipient");
		validateIdentifier(input.conversationId, "conversation id");
		validateBody(input.body);
		const response = await this.#request({
			type: "send",
			requestId: randomUUID(),
			input,
		});
		if (response.type !== "accepted" || !response.message || typeof response.message !== "object") {
			throw new Error("relay returned an invalid acceptance");
		}
		const message = validateMessage(response.message as unknown as AgentMessageV1);
		this.#upsert(message, "accepted");
		await this.#persist();
		return {
			message,
			state: "accepted",
			duplicate: response.duplicate === true,
		};
	}

	async read(messageId: string): Promise<AgentReadResult> {
		await this.#initialize();
		const id = validateIdentifier(messageId, "message id");
		const target = this.#state.messages.find((item) => item.message.id === id);
		if (!target || target.message.recipient !== this.endpoint.id) {
			throw new Error("agent message was not delivered to this endpoint");
		}
		const updated = this.#upsert(target.message, "read");
		const conversation = this.#state.messages
			.filter((item) => item.message.conversationId === target.message.conversationId)
			.sort(compareMessages);
		await this.#persist();
		return { target: updated, messages: boundedContext(conversation, id) };
	}

	async respond(messageId: string, response: string): Promise<AgentRespondResult> {
		const read = await this.read(messageId);
		const id = stableResponseId(this.endpoint.id, messageId, validateBody(response));
		const sent = await this.send({
			id,
			recipient: read.target.message.sender,
			conversationId: read.target.message.conversationId,
			body: response,
			replyTo: messageId,
		});
		const target = this.#upsert(read.target.message, "replied", id);
		await this.#persist();
		return { target, response: sent };
	}

	async subscribe(onMessage: (messageId: string) => void): Promise<() => Promise<void>> {
		this.#listeners.add(onMessage);
		await this.#ensureConnected();
		for (const item of this.#state.messages) {
			if (item.message.recipient === this.endpoint.id && item.state === "delivered") {
				onMessage(item.message.id);
			}
		}
		return async () => {
			this.#listeners.delete(onMessage);
		};
	}

	async close(): Promise<void> {
		this.#closed = true;
		if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
		this.#socket?.close();
		this.#rejectRequests(new Error("agent relay transport closed"));
	}

	async #request(
		frame: RelayClientFrame & { readonly requestId: string },
	): Promise<Record<string, unknown>> {
		const socket = await this.#ensureConnected();
		return new Promise((resolve, reject) => {
			this.#requests.set(frame.requestId, { resolve, reject });
			try {
				socket.send(JSON.stringify(frame));
			} catch (error) {
				this.#requests.delete(frame.requestId);
				reject(error as Error);
			}
		});
	}

	async #initialize(): Promise<void> {
		if (!this.#initialized) {
			// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: state validation is intentionally centralized at the durable boundary
			this.#initialized = (async () => {
				if (!this.#config.statePath) return;
				try {
					const parsed = JSON.parse(
						await readFile(this.#config.statePath, "utf8"),
					) as RelayClientState;
					if (parsed.version !== 1 || !Array.isArray(parsed.messages)) {
						throw new Error("unsupported relay client state");
					}
					for (const item of parsed.messages) validateMessage(item.message);
					this.#state = parsed;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
			})();
		}
		await this.#initialized;
	}

	async #ensureConnected(): Promise<WebSocket> {
		await this.#initialize();
		if (this.#socket && this.#authenticated && this.#socket.readyState === WebSocket.OPEN) {
			return this.#socket;
		}
		if (!this.#connection) {
			this.#connection = new Promise<WebSocket>((resolve, reject) => {
				const socket = new WebSocket(this.#config.url);
				this.#socket = socket;
				const fail = (error: Error) => {
					this.#connection = undefined;
					reject(error);
				};
				socket.addEventListener(
					"open",
					() => {
						const auth: RelayAuthenticateFrame = {
							type: "authenticate",
							version: RELAY_PROTOCOL_VERSION,
							token: this.#config.token,
							endpoint: this.endpoint.id,
							principal: this.endpoint.principal,
							cursor: this.#state.cursor,
						};
						socket.send(JSON.stringify(auth));
					},
					{ once: true },
				);
				socket.addEventListener("message", (event) => {
					this.#incoming = this.#incoming
						.then(() => this.#handleMessage(String(event.data), socket, resolve, fail))
						.catch(() => socket.close());
				});
				socket.addEventListener("error", () => fail(new Error("agent relay connection failed")), {
					once: true,
				});
				socket.addEventListener("close", () => {
					this.#authenticated = false;
					this.#socket = undefined;
					this.#connection = undefined;
					this.#rejectRequests(new Error("agent relay disconnected"));
					this.#scheduleReconnect();
				});
			});
		}
		return this.#connection;
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one wire-frame dispatcher keeps connection state transitions together
	async #handleMessage(
		text: string,
		socket: WebSocket,
		resolveConnection: (socket: WebSocket) => void,
		rejectConnection: (error: Error) => void,
	): Promise<void> {
		let frame: Record<string, unknown>;
		try {
			frame = parseRelayFrame(text);
		} catch {
			socket.close();
			return;
		}
		if (frame.type === "authenticated") {
			this.#authenticated = true;
			resolveConnection(socket);
			return;
		}
		if (frame.type === "ping" && typeof frame.nonce === "string") {
			socket.send(JSON.stringify({ type: "pong", nonce: frame.nonce } satisfies RelayClientFrame));
			return;
		}
		if (
			frame.type === "deliver" &&
			typeof frame.cursor === "number" &&
			frame.message &&
			typeof frame.message === "object"
		) {
			const message = validateMessage(frame.message as unknown as AgentMessageV1);
			const stored = this.#upsert(message, "delivered");
			if (this.#config.statePath) {
				this.#state.cursor = Math.max(this.#state.cursor, frame.cursor);
				await this.#persist();
				socket.send(
					JSON.stringify({ type: "ack", cursor: frame.cursor } satisfies RelayClientFrame),
				);
			}
			for (const listener of this.#listeners) listener(stored.message.id);
			return;
		}
		const requestId = typeof frame.requestId === "string" ? frame.requestId : undefined;
		if (requestId) {
			const pending = this.#requests.get(requestId);
			if (!pending) return;
			this.#requests.delete(requestId);
			if (frame.type === "error") {
				pending.reject(
					new Error(typeof frame.message === "string" ? frame.message : "relay error"),
				);
			} else {
				pending.resolve(frame);
			}
			return;
		}
		if (frame.type === "error") rejectConnection(new Error("agent relay authentication failed"));
	}

	#upsert(
		message: AgentMessageV1,
		state: StoredAgentMessage["state"],
		responseId?: string,
	): StoredAgentMessage {
		const index = this.#state.messages.findIndex((item) => item.message.id === message.id);
		const previous = index >= 0 ? this.#state.messages[index] : undefined;
		const chosenResponseId = previous?.responseId ?? responseId;
		const stored: StoredAgentMessage = {
			message: previous?.message ?? message,
			state: advanceState(previous?.state ?? "accepted", state),
			updatedAt: new Date().toISOString(),
			...(chosenResponseId ? { responseId: chosenResponseId } : {}),
		};
		if (index >= 0) this.#state.messages[index] = stored;
		else this.#state.messages.push(stored);
		return stored;
	}

	async #persist(): Promise<void> {
		const path = this.#config.statePath;
		if (!path) return;
		await mkdir(dirname(path), { recursive: true, mode: 0o700 });
		const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
		const file = await open(temporary, "wx", 0o600);
		try {
			await file.writeFile(`${JSON.stringify(this.#state)}\n`);
			await file.sync();
		} finally {
			await file.close();
		}
		try {
			await rename(temporary, path);
			const directory = await open(dirname(path), "r");
			await directory.sync();
			await directory.close();
		} catch (error) {
			await unlink(temporary).catch(() => {});
			throw error;
		}
	}

	#scheduleReconnect(): void {
		if (this.#closed || this.#listeners.size === 0 || this.#reconnectTimer) return;
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = undefined;
			void this.#ensureConnected().catch(() => this.#scheduleReconnect());
		}, this.#config.reconnectMs ?? 1_000);
	}

	#rejectRequests(error: Error): void {
		for (const request of this.#requests.values()) request.reject(error);
		this.#requests.clear();
	}
}

function boundedContext(
	messages: readonly StoredAgentMessage[],
	targetId: string,
): readonly StoredAgentMessage[] {
	const targetIndex = messages.findIndex((item) => item.message.id === targetId);
	const selected: StoredAgentMessage[] = [];
	let bytes = 0;
	for (
		let index = targetIndex;
		index >= 0 && selected.length < AGENT_MAX_CONTEXT_MESSAGES;
		index -= 1
	) {
		const item = messages[index];
		if (!item) continue;
		const size = Buffer.byteLength(item.message.body);
		if (selected.length > 0 && bytes + size > AGENT_MAX_CONTEXT_BYTES) break;
		selected.unshift(item);
		bytes += size;
	}
	return selected;
}

function stableResponseId(endpoint: string, messageId: string, response: string): string {
	return `reply-${createHash("sha256")
		.update(endpoint)
		.update("\0")
		.update(messageId)
		.update("\0")
		.update(response)
		.digest("hex")
		.slice(0, 32)}`;
}
