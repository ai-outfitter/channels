import { createHash, randomUUID } from "node:crypto";
import { WebSocket } from "undici";
import {
	parseRelayFrame,
	RELAY_MAX_FRAME_BYTES,
	RELAY_PROTOCOL_VERSION,
	type RelayAuthenticateFrame,
	type RelayClientFrame,
	type RelayConversationSummary,
	type RelayHistoryItem,
	type RelaySessionQueryRequest,
	type RelaySessionQueryResult,
	type RelayStreamEvent,
} from "../relay/protocol.ts";
import { AgentSessionJournal } from "./journal.ts";
import {
	type AgentEndpoint,
	type AgentMessageV1,
	type AgentReadResult,
	type AgentRespondResult,
	type AgentSendInput,
	type AgentSendResult,
	type AgentTransport,
	validateBody,
	validateIdentifier,
	validateMessage,
} from "./types.ts";

export interface RelayAgentConfig {
	readonly url: string;
	readonly token: string;
	readonly endpointId: string;
	readonly principalId: string;
	readonly reconnectMs?: number;
}

interface PendingRequest {
	resolve(frame: Record<string, unknown>): void;
	reject(error: Error): void;
}

export class RelayAgentTransport implements AgentTransport {
	readonly endpoint: AgentEndpoint;
	readonly #config: RelayAgentConfig;
	readonly #journal: AgentSessionJournal;
	#connection: Promise<WebSocket> | undefined;
	#socket: WebSocket | undefined;
	#authenticated = false;
	#closed = false;
	#reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	#incoming: Promise<void> = Promise.resolve();
	readonly #requests = new Map<string, PendingRequest>();
	readonly #listeners = new Set<(messageId: string) => void>();

	constructor(config: RelayAgentConfig, journal = new AgentSessionJournal()) {
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
		this.#journal = journal;
	}

	async list(): Promise<readonly AgentEndpoint[]> {
		const response = await this.#request({ type: "list", requestId: randomUUID() });
		if (response.type !== "endpoints" || !Array.isArray(response.endpoints)) {
			throw new Error("relay returned an invalid endpoint list");
		}
		return (response.endpoints as unknown[]).map((candidate) => {
			if (!candidate || typeof candidate !== "object") {
				throw new Error("relay returned an invalid endpoint");
			}
			const endpoint = candidate as Partial<AgentEndpoint>;
			if (typeof endpoint.id !== "string" || typeof endpoint.principal !== "string") {
				throw new Error("relay returned an invalid endpoint");
			}
			return {
				id: validateIdentifier(endpoint.id, "endpoint id"),
				principal: validateIdentifier(endpoint.principal, "principal id"),
			};
		});
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
		if (
			response.type !== "accepted" ||
			response.state !== "accepted" ||
			!response.message ||
			typeof response.message !== "object"
		) {
			throw new Error("relay returned an invalid acceptance");
		}
		const message = validateMessage(response.message as unknown as AgentMessageV1);
		if (message.sender !== this.endpoint.id) {
			throw new Error("relay returned an acceptance for another sender");
		}
		const stored = this.#journal.recordMessage(message, "accepted");
		return {
			message: stored.message,
			state: stored.state,
			duplicate: response.duplicate === true,
		};
	}

	async read(messageId: string): Promise<AgentReadResult> {
		const id = validateIdentifier(messageId, "message id");
		const target = this.#journal.message(id);
		if (!target || target.message.recipient !== this.endpoint.id) {
			throw new Error("agent message was not delivered to this endpoint");
		}
		const updated =
			target.state === "accepted" || target.state === "delivered"
				? this.#journal.transition(id, "read")
				: target;
		return { target: updated, messages: this.#journal.context(id) };
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
		const target =
			read.target.state === "replied"
				? read.target
				: this.#journal.transition(messageId, "replied", id);
		return { target, response: sent };
	}

	async listConversations(
		endpoint: string,
		options: { readonly limit?: number; readonly beforeCursor?: number } = {},
	): Promise<readonly RelayConversationSummary[]> {
		const targetEndpoint = validateIdentifier(endpoint, "endpoint id");
		const response = await this.#request({
			type: "list_conversations",
			requestId: randomUUID(),
			endpoint: targetEndpoint,
			...options,
		});
		if (response.type !== "conversations" || !Array.isArray(response.conversations)) {
			throw new Error("relay returned an invalid conversation response");
		}
		return (response.conversations as unknown[]).map((value) =>
			validateConversationSummary(value, this.endpoint.id, targetEndpoint),
		);
	}

	async readHistory(
		endpoint: string,
		conversationId: string,
		options: { readonly limit?: number; readonly beforeCursor?: number } = {},
	): Promise<readonly RelayHistoryItem[]> {
		const targetEndpoint = validateIdentifier(endpoint, "endpoint id");
		const response = await this.#request({
			type: "read_history",
			requestId: randomUUID(),
			endpoint: targetEndpoint,
			conversationId: validateIdentifier(conversationId, "conversation id"),
			...options,
		});
		if (
			response.type !== "history" ||
			response.conversationId !== conversationId ||
			!Array.isArray(response.messages)
		) {
			throw new Error("relay returned an invalid history response");
		}
		return (response.messages as unknown[]).map((value) =>
			validateHistoryItem(value, this.endpoint.id, targetEndpoint, conversationId),
		);
	}

	/**
	 * Push an ephemeral streaming preview of the reply being produced for
	 * `messageId`. Fire-and-forget: previews are never journaled, never
	 * acknowledged, and silently dropped when the transport is not connected.
	 * The durable `respond()` supersedes previews via `replyTo`.
	 */
	async stream(messageId: string, event: RelayStreamEvent): Promise<void> {
		const id = validateIdentifier(messageId, "message id");
		const target = this.#journal.message(id);
		if (!target || target.message.recipient !== this.endpoint.id) return;
		let socket: WebSocket;
		try {
			socket = await this.#ensureConnected();
		} catch {
			return;
		}
		const frame: RelayClientFrame = {
			type: "stream",
			input: {
				id: streamPreviewId(this.endpoint.id, id),
				recipient: target.message.sender,
				conversationId: target.message.conversationId,
				replyTo: id,
				event,
			},
		};
		try {
			socket.send(JSON.stringify(frame));
		} catch {
			// Previews are best-effort; the durable reply still follows.
		}
	}

	async subscribe(onMessage: (messageId: string) => void): Promise<() => Promise<void>> {
		this.#listeners.add(onMessage);
		try {
			await this.#ensureConnected();
		} catch (error) {
			this.#listeners.delete(onMessage);
			throw error;
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

	async #ensureConnected(): Promise<WebSocket> {
		if (this.#socket && this.#authenticated && this.#socket.readyState === WebSocket.OPEN) {
			return this.#socket;
		}
		if (!this.#connection) {
			this.#connection = new Promise<WebSocket>((resolve, reject) => {
				const socket = new WebSocket(this.#config.url);
				this.#socket = socket;
				let settled = false;
				const fail = (error: Error) => {
					this.#connection = undefined;
					if (settled) return;
					settled = true;
					reject(error);
				};
				const succeed = (authenticatedSocket: WebSocket) => {
					if (settled) return;
					settled = true;
					resolve(authenticatedSocket);
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
							cursor: this.#journal.relayCheckpoint(this.endpoint.id),
						};
						socket.send(JSON.stringify(auth));
					},
					{ once: true },
				);
				socket.addEventListener("message", (event) => {
					this.#incoming = this.#incoming
						.then(() => this.#handleMessage(String(event.data), socket, succeed, fail))
						.catch(() => socket.close());
				});
				socket.addEventListener("error", () => fail(new Error("agent relay connection failed")), {
					once: true,
				});
				socket.addEventListener("close", () => {
					const authenticated = this.#authenticated;
					this.#authenticated = false;
					this.#socket = undefined;
					this.#connection = undefined;
					this.#rejectRequests(new Error("agent relay disconnected"));
					if (!authenticated) fail(new Error("agent relay disconnected before authentication"));
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
		const frame = parseRelayFrame(text);
		if (frame.type === "authenticated") {
			if (
				frame.endpoint !== this.endpoint.id ||
				typeof frame.cursor !== "number" ||
				!Number.isSafeInteger(frame.cursor) ||
				frame.cursor !== this.#journal.relayCheckpoint(this.endpoint.id)
			) {
				rejectConnection(new Error("agent relay returned an invalid resume cursor"));
				socket.close();
				return;
			}
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
			const cursor = requireCursor(frame.cursor);
			const message = validateMessage(frame.message as unknown as AgentMessageV1);
			if (message.recipient !== this.endpoint.id) {
				throw new Error("agent relay delivered a message for another endpoint");
			}
			const checkpoint = this.#journal.relayCheckpoint(this.endpoint.id);
			const existing = this.#journal.message(message.id);
			if (cursor < checkpoint || (cursor === checkpoint && !existing)) {
				throw new Error("agent relay delivery cursor is invalid");
			}
			const stored = this.#journal.recordMessage(message, "delivered");
			this.#journal.recordRelayCheckpoint(this.endpoint.id, cursor);
			socket.send(JSON.stringify({ type: "ack", cursor } satisfies RelayClientFrame));
			for (const listener of this.#listeners) listener(stored.message.id);
			return;
		}
		if (frame.type === "session_query") {
			await this.#answerSessionQuery(frame, socket);
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

	async #answerSessionQuery(frame: Record<string, unknown>, socket: WebSocket): Promise<void> {
		const queryId =
			typeof frame.queryId === "string"
				? validateIdentifier(frame.queryId, "query id")
				: (() => {
						throw new Error("session query id is required");
					})();
		if (!frame.request || typeof frame.request !== "object" || Array.isArray(frame.request)) {
			throw new Error("invalid session query");
		}
		const requesterEndpoint =
			typeof frame.requesterEndpoint === "string"
				? validateIdentifier(frame.requesterEndpoint, "requester endpoint")
				: (() => {
						throw new Error("session query requester is required");
					})();
		let result: RelaySessionQueryResult;
		try {
			result = this.#queryResult(
				frame.request as unknown as RelaySessionQueryRequest,
				requesterEndpoint,
			);
		} catch {
			result = { type: "error", code: "invalid_query", message: "session query was rejected" };
		}
		const response = boundedSessionResult({ type: "session_result", queryId, result });
		socket.send(JSON.stringify(response satisfies RelayClientFrame));
	}

	#queryResult(
		request: RelaySessionQueryRequest,
		requesterEndpoint: string,
	): RelaySessionQueryResult {
		if (request.type === "list_conversations") {
			return {
				type: "conversations",
				conversations: this.#journal.conversations(
					request.limit,
					request.beforeCursor,
					requesterEndpoint,
				),
			};
		}
		if (request.type === "read_history") {
			if (!this.#journal.hasParticipant(request.conversationId, requesterEndpoint)) {
				throw new Error("requester does not participate in this conversation");
			}
			return {
				type: "history",
				conversationId: validateIdentifier(request.conversationId, "conversation id"),
				messages: this.#journal.history(
					request.conversationId,
					request.limit,
					request.beforeCursor,
					requesterEndpoint,
				),
			};
		}
		throw new Error("unsupported session query");
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

function boundedSessionResult(frame: {
	readonly type: "session_result";
	readonly queryId: string;
	readonly result: RelaySessionQueryResult;
}): typeof frame {
	if (frame.result.type === "history") {
		const messages = [...frame.result.messages];
		while (
			messages.length > 0 &&
			frameBytes({ ...frame, result: { ...frame.result, messages } }) > RELAY_MAX_FRAME_BYTES
		) {
			messages.shift();
		}
		const bounded = { ...frame, result: { ...frame.result, messages } };
		if (frameBytes(bounded) > RELAY_MAX_FRAME_BYTES)
			throw new Error("history response is too large");
		return bounded;
	}
	if (frame.result.type === "conversations") {
		const conversations = [...frame.result.conversations];
		while (
			conversations.length > 0 &&
			frameBytes({ ...frame, result: { ...frame.result, conversations } }) > RELAY_MAX_FRAME_BYTES
		) {
			conversations.pop();
		}
		return { ...frame, result: { ...frame.result, conversations } };
	}
	return frame;
}

function frameBytes(frame: unknown): number {
	return Buffer.byteLength(JSON.stringify(frame));
}

function requireCursor(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error("agent relay returned an invalid delivery cursor");
	}
	return value;
}

function validateConversationSummary(
	value: unknown,
	requester: string,
	target: string,
): RelayConversationSummary {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("relay returned an invalid conversation summary");
	}
	const summary = value as Partial<RelayConversationSummary>;
	if (
		typeof summary.id !== "string" ||
		typeof summary.updatedAt !== "string" ||
		!Number.isFinite(Date.parse(summary.updatedAt)) ||
		typeof summary.cursor !== "number" ||
		!Number.isSafeInteger(summary.cursor) ||
		summary.cursor < 1 ||
		!Array.isArray(summary.participants)
	) {
		throw new Error("relay returned an invalid conversation summary");
	}
	const participants = summary.participants.map((participant) =>
		validateIdentifier(participant, "participant endpoint"),
	);
	if (!participants.includes(requester) || !participants.includes(target)) {
		throw new Error("relay returned a conversation outside the requested route");
	}
	return {
		id: validateIdentifier(summary.id, "conversation id"),
		updatedAt: summary.updatedAt,
		cursor: summary.cursor,
		participants,
	};
}

function validateHistoryItem(
	value: unknown,
	requester: string,
	target: string,
	conversationId: string,
): RelayHistoryItem {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("relay returned an invalid history item");
	}
	const item = value as Partial<RelayHistoryItem>;
	if (
		typeof item.cursor !== "number" ||
		!Number.isSafeInteger(item.cursor) ||
		item.cursor < 1 ||
		!item.message ||
		typeof item.updatedAt !== "string" ||
		!Number.isFinite(Date.parse(item.updatedAt)) ||
		(item.state !== "accepted" &&
			item.state !== "delivered" &&
			item.state !== "read" &&
			item.state !== "replied" &&
			item.state !== "handled")
	) {
		throw new Error("relay returned an invalid history item");
	}
	const message = validateMessage(item.message);
	if (
		message.conversationId !== conversationId ||
		!(
			[message.sender, message.recipient].includes(requester) &&
			[message.sender, message.recipient].includes(target)
		)
	) {
		throw new Error("relay returned history outside the requested route");
	}
	const responseId =
		item.responseId === undefined ? undefined : validateIdentifier(item.responseId, "response id");
	return {
		cursor: item.cursor,
		message,
		state: item.state,
		...(responseId ? { responseId } : {}),
		updatedAt: item.updatedAt,
	};
}

/** Stable per-target preview id so every chunk updates one message. */
function streamPreviewId(endpoint: string, messageId: string): string {
	return `preview-${createHash("sha256")
		.update(endpoint)
		.update("\0")
		.update(messageId)
		.digest("hex")
		.slice(0, 32)}`;
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
