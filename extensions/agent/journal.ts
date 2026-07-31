import {
	AGENT_MAX_CONTEXT_BYTES,
	AGENT_MAX_CONTEXT_MESSAGES,
	type AgentMessageState,
	type AgentMessageV1,
	advanceState,
	compareMessages,
	type StoredAgentMessage,
	validateIdentifier,
	validateMessage,
} from "./types.ts";

export const AGENT_SESSION_ENTRY_TYPE = "channels-agent-session-v1";

type AgentSessionEntry =
	| {
			readonly version: 1;
			readonly kind: "message";
			readonly message: AgentMessageV1;
			readonly state: AgentMessageState;
			readonly updatedAt: string;
	  }
	| {
			readonly version: 1;
			readonly kind: "transition";
			readonly messageId: string;
			readonly state: "read" | "replied" | "handled";
			readonly responseId?: string;
			readonly updatedAt: string;
	  }
	| {
			readonly version: 1;
			readonly kind: "relay_checkpoint";
			readonly endpoint: string;
			readonly cursor: number;
			readonly updatedAt: string;
	  };

export interface AgentSessionConversation {
	readonly id: string;
	readonly updatedAt: string;
	readonly cursor: number;
	readonly participants: readonly string[];
}

export interface AgentSessionHistoryItem {
	readonly cursor: number;
	readonly message: AgentMessageV1;
	readonly state: AgentMessageState;
	readonly responseId?: string;
	readonly updatedAt: string;
}

interface IndexedMessage {
	stored: StoredAgentMessage;
	cursor: number;
}

/**
 * Projection of the agent channel's Pi custom session entries.
 *
 * The append callback is deliberately synchronous: Pi's appendEntry() updates
 * the native JSONL session before the caller can acknowledge a relay delivery.
 */
export class AgentSessionJournal {
	readonly #append: (customType: string, data: AgentSessionEntry) => void;
	readonly #messages = new Map<string, IndexedMessage>();
	readonly #checkpoints = new Map<string, number>();
	#cursor = 0;

	constructor(append: (customType: string, data: AgentSessionEntry) => void = () => {}) {
		this.#append = append;
	}

	restore(entries: readonly unknown[]): void {
		this.#messages.clear();
		this.#checkpoints.clear();
		this.#cursor = 0;
		for (const candidate of entries) {
			if (!candidate || typeof candidate !== "object") continue;
			const entry = candidate as {
				type?: unknown;
				customType?: unknown;
				data?: unknown;
			};
			if (entry.type !== "custom" || entry.customType !== AGENT_SESSION_ENTRY_TYPE) continue;
			this.#apply(parseEntry(entry.data));
		}
	}

	recordMessage(message: AgentMessageV1, state: "accepted" | "delivered"): StoredAgentMessage {
		const validated = validateMessage(message);
		const existing = this.#messages.get(validated.id);
		if (existing && !sameImmutableMessage(existing.stored.message, validated)) {
			throw new Error(`message id "${validated.id}" already exists with different content`);
		}
		if (existing) return existing.stored;
		const entry: AgentSessionEntry = {
			version: 1,
			kind: "message",
			message: validated,
			state,
			updatedAt: new Date().toISOString(),
		};
		this.#append(AGENT_SESSION_ENTRY_TYPE, entry);
		this.#apply(entry);
		return this.#messages.get(validated.id)?.stored as StoredAgentMessage;
	}

	transition(
		messageId: string,
		state: "read" | "replied" | "handled",
		responseId?: string,
	): StoredAgentMessage {
		const id = validateIdentifier(messageId, "message id");
		const existing = this.#messages.get(id);
		if (!existing) throw new Error("agent message is not present in this Pi session");
		const validatedResponse =
			responseId === undefined ? undefined : validateIdentifier(responseId, "response id");
		if (state === "replied" && !validatedResponse) {
			throw new Error("replied state requires a response id");
		}
		if (state !== "replied" && validatedResponse) {
			throw new Error("response id is valid only for replied state");
		}
		if (
			existing.stored.responseId &&
			validatedResponse &&
			existing.stored.responseId !== validatedResponse
		) {
			throw new Error("message already has a different response");
		}
		const entry: AgentSessionEntry = {
			version: 1,
			kind: "transition",
			messageId: id,
			state,
			...(validatedResponse ? { responseId: validatedResponse } : {}),
			updatedAt: new Date().toISOString(),
		};
		this.#append(AGENT_SESSION_ENTRY_TYPE, entry);
		this.#apply(entry);
		return this.#messages.get(id)?.stored as StoredAgentMessage;
	}

	recordRelayCheckpoint(endpoint: string, cursor: number): void {
		const id = validateIdentifier(endpoint, "endpoint id");
		requireCursor(cursor);
		if (cursor <= (this.#checkpoints.get(id) ?? 0)) return;
		const entry: AgentSessionEntry = {
			version: 1,
			kind: "relay_checkpoint",
			endpoint: id,
			cursor,
			updatedAt: new Date().toISOString(),
		};
		this.#append(AGENT_SESSION_ENTRY_TYPE, entry);
		this.#apply(entry);
	}

	relayCheckpoint(endpoint: string): number {
		return this.#checkpoints.get(validateIdentifier(endpoint, "endpoint id")) ?? 0;
	}

	message(messageId: string): StoredAgentMessage | undefined {
		return this.#messages.get(validateIdentifier(messageId, "message id"))?.stored;
	}

	/**
	 * The conversation around one message, as the model will read it.
	 *
	 * Filters on the two peers of the target message, not on the conversation
	 * alone. A relay configured with singleton conversations folds every peer's
	 * messages under one conversation id, so a conversation-only filter hands the
	 * model another principal's message body on a turn that principal never
	 * started — both a cross-principal disclosure and a hole in the rule that
	 * attacker-controlled text never enters the session unbidden. `history()`
	 * already filters this way; this is the same rule.
	 */
	context(messageId: string): readonly StoredAgentMessage[] {
		const target = this.message(messageId);
		if (!target) throw new Error("agent message is not present in this Pi session");
		const peers = new Set([target.message.sender, target.message.recipient]);
		const messages = [...this.#messages.values()]
			.map((item) => item.stored)
			.filter(
				(item) =>
					item.message.conversationId === target.message.conversationId &&
					peers.has(item.message.sender) &&
					peers.has(item.message.recipient),
			)
			.sort(compareMessages);
		return boundedContext(messages, target.message.id);
	}

	conversations(
		limit = 50,
		beforeCursor = Number.MAX_SAFE_INTEGER,
		participant?: string,
	): readonly AgentSessionConversation[] {
		requirePage(limit, 1, 100, "conversation limit");
		requirePage(beforeCursor, 1, Number.MAX_SAFE_INTEGER, "conversation cursor");
		const summaries = new Map<string, AgentSessionConversation>();
		for (const indexed of this.#messages.values()) {
			if (indexed.cursor >= beforeCursor) continue;
			const { message, updatedAt } = indexed.stored;
			if (participant && message.sender !== participant && message.recipient !== participant) {
				continue;
			}
			const previous = summaries.get(message.conversationId);
			const participants = new Set(previous?.participants ?? []);
			participants.add(message.sender);
			participants.add(message.recipient);
			summaries.set(message.conversationId, {
				id: message.conversationId,
				updatedAt: previous && previous.updatedAt > updatedAt ? previous.updatedAt : updatedAt,
				cursor: Math.max(previous?.cursor ?? 0, indexed.cursor),
				participants: [...participants].sort(),
			});
		}
		return [...summaries.values()].sort((a, b) => b.cursor - a.cursor).slice(0, limit);
	}

	history(
		conversationId: string,
		limit = 50,
		beforeCursor = Number.MAX_SAFE_INTEGER,
		participant?: string,
	): readonly AgentSessionHistoryItem[] {
		const id = validateIdentifier(conversationId, "conversation id");
		requirePage(limit, 1, 50, "history limit");
		requirePage(beforeCursor, 1, Number.MAX_SAFE_INTEGER, "history cursor");
		return [...this.#messages.values()]
			.filter(
				(item) =>
					item.stored.message.conversationId === id &&
					item.cursor < beforeCursor &&
					(!participant ||
						item.stored.message.sender === participant ||
						item.stored.message.recipient === participant),
			)
			.sort((a, b) => a.cursor - b.cursor)
			.slice(-limit)
			.map((item) => ({
				cursor: item.cursor,
				message: item.stored.message,
				state: item.stored.state,
				...(item.stored.responseId ? { responseId: item.stored.responseId } : {}),
				updatedAt: item.stored.updatedAt,
			}));
	}

	hasParticipant(conversationId: string, participant: string): boolean {
		const id = validateIdentifier(conversationId, "conversation id");
		const endpoint = validateIdentifier(participant, "participant endpoint");
		return [...this.#messages.values()].some(
			(item) =>
				item.stored.message.conversationId === id &&
				(item.stored.message.sender === endpoint || item.stored.message.recipient === endpoint),
		);
	}

	#apply(entry: AgentSessionEntry): void {
		this.#cursor += 1;
		if (entry.kind === "relay_checkpoint") {
			this.#checkpoints.set(
				entry.endpoint,
				Math.max(this.#checkpoints.get(entry.endpoint) ?? 0, entry.cursor),
			);
			return;
		}
		if (entry.kind === "message") {
			const previous = this.#messages.get(entry.message.id);
			if (previous && !sameImmutableMessage(previous.stored.message, entry.message)) {
				throw new Error(`message id "${entry.message.id}" has conflicting Pi session entries`);
			}
			if (!previous) {
				this.#messages.set(entry.message.id, {
					cursor: this.#cursor,
					stored: {
						message: entry.message,
						state: entry.state,
						updatedAt: entry.updatedAt,
					},
				});
			}
			return;
		}
		const previous = this.#messages.get(entry.messageId);
		if (!previous) throw new Error(`transition references unknown message "${entry.messageId}"`);
		previous.stored = {
			message: previous.stored.message,
			state: advanceState(previous.stored.state, entry.state),
			updatedAt: entry.updatedAt,
			...(previous.stored.responseId || entry.responseId
				? { responseId: previous.stored.responseId ?? entry.responseId }
				: {}),
		};
	}
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: all persisted union variants are validated at this single trust boundary
function parseEntry(value: unknown): AgentSessionEntry {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("invalid agent Pi session entry");
	}
	const entry = value as Partial<AgentSessionEntry>;
	if (entry.version !== 1 || typeof entry.kind !== "string") {
		throw new Error("unsupported agent Pi session entry");
	}
	if (entry.kind === "message") {
		if (!entry.message || (entry.state !== "accepted" && entry.state !== "delivered")) {
			throw new Error("invalid agent message session entry");
		}
		return {
			version: 1,
			kind: "message",
			message: validateMessage(entry.message),
			state: entry.state,
			updatedAt: requireTimestamp(entry.updatedAt),
		};
	}
	if (entry.kind === "transition") {
		if (
			typeof entry.messageId !== "string" ||
			(entry.state !== "read" && entry.state !== "replied" && entry.state !== "handled")
		) {
			throw new Error("invalid agent transition session entry");
		}
		const responseId =
			entry.responseId === undefined
				? undefined
				: validateIdentifier(entry.responseId, "response id");
		if (entry.state === "replied" && !responseId) {
			throw new Error("replied session entry requires a response id");
		}
		return {
			version: 1,
			kind: "transition",
			messageId: validateIdentifier(entry.messageId, "message id"),
			state: entry.state,
			...(responseId ? { responseId } : {}),
			updatedAt: requireTimestamp(entry.updatedAt),
		};
	}
	if (entry.kind === "relay_checkpoint") {
		if (typeof entry.endpoint !== "string") {
			throw new Error("invalid relay checkpoint session entry");
		}
		return {
			version: 1,
			kind: "relay_checkpoint",
			endpoint: validateIdentifier(entry.endpoint, "endpoint id"),
			cursor: requireCursor(entry.cursor),
			updatedAt: requireTimestamp(entry.updatedAt),
		};
	}
	throw new Error("unsupported agent Pi session entry");
}

function requireCursor(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new Error("invalid relay checkpoint");
	}
	return value;
}

function requirePage(value: number, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new Error(`invalid ${label}`);
	}
	return value;
}

function requireTimestamp(value: unknown): string {
	if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
		throw new Error("invalid agent session timestamp");
	}
	return value;
}

function sameImmutableMessage(a: AgentMessageV1, b: AgentMessageV1): boolean {
	return (
		a.version === b.version &&
		a.id === b.id &&
		a.conversationId === b.conversationId &&
		a.sender === b.sender &&
		a.recipient === b.recipient &&
		a.createdAt === b.createdAt &&
		a.body === b.body &&
		a.replyTo === b.replyTo
	);
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
