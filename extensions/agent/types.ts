import { Buffer } from "node:buffer";

export const AGENT_PROTOCOL_VERSION = 1 as const;
export const AGENT_MAX_BODY_BYTES = 40_000;
export const AGENT_MAX_ID_LENGTH = 128;
export const AGENT_MAX_CONTEXT_MESSAGES = 50;
export const AGENT_MAX_CONTEXT_BYTES = 256 * 1024;
export const AGENT_MAX_PENDING_MESSAGES = 1_000;
export const AGENT_MAX_LOCATOR_LENGTH = 512;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;

export type AgentMessageState = "accepted" | "delivered" | "read" | "replied" | "handled";

export interface AgentMessageV1 {
	readonly version: typeof AGENT_PROTOCOL_VERSION;
	readonly id: string;
	readonly conversationId: string;
	readonly sender: string;
	readonly recipient: string;
	readonly createdAt: string;
	readonly body: string;
	readonly replyTo?: string;
}

export interface StoredAgentMessage {
	readonly message: AgentMessageV1;
	readonly state: AgentMessageState;
	readonly responseId?: string;
	readonly updatedAt: string;
}

export interface AgentEndpoint {
	readonly id: string;
	readonly principal: string;
}

export interface AgentSendInput {
	readonly recipient: string;
	readonly conversationId: string;
	readonly body: string;
	readonly id?: string;
	readonly replyTo?: string;
}

export interface AgentSendResult {
	readonly message: AgentMessageV1;
	readonly state: AgentMessageState;
	readonly duplicate: boolean;
}

export interface AgentReadResult {
	readonly target: StoredAgentMessage;
	readonly messages: readonly StoredAgentMessage[];
}

export interface AgentRespondResult {
	readonly target: StoredAgentMessage;
	readonly response: AgentSendResult;
}

/**
 * Transport-neutral agent channel boundary. Implementations own durable
 * acceptance, authentication, retries, and delivery notification.
 */
export interface AgentTransport {
	readonly endpoint: AgentEndpoint;
	list(): Promise<readonly AgentEndpoint[]>;
	send(input: AgentSendInput): Promise<AgentSendResult>;
	read(messageId: string): Promise<AgentReadResult>;
	respond(messageId: string, response: string): Promise<AgentRespondResult>;
	subscribe(onMessage: (messageId: string) => void): Promise<() => Promise<void>>;
	close(): Promise<void>;
}

export function validateIdentifier(value: string, label: string): string {
	if (
		value.length < 1 ||
		value.length > AGENT_MAX_ID_LENGTH ||
		!IDENTIFIER.test(value) ||
		Buffer.byteLength(value) !== value.length
	) {
		throw new Error(`${label} must be 1-${AGENT_MAX_ID_LENGTH} URL-safe ASCII characters`);
	}
	return value;
}

export function validateBody(value: string): string {
	const bytes = Buffer.byteLength(value);
	if (bytes < 1 || bytes > AGENT_MAX_BODY_BYTES) {
		throw new Error(`body must be 1-${AGENT_MAX_BODY_BYTES} UTF-8 bytes`);
	}
	return value;
}

export function validateMessage(message: AgentMessageV1): AgentMessageV1 {
	if (message.version !== AGENT_PROTOCOL_VERSION) throw new Error("unsupported agent protocol");
	validateIdentifier(message.id, "message id");
	validateIdentifier(message.conversationId, "conversation id");
	validateIdentifier(message.sender, "sender");
	validateIdentifier(message.recipient, "recipient");
	if (message.replyTo !== undefined) validateIdentifier(message.replyTo, "reply target");
	validateBody(message.body);
	if (!Number.isFinite(Date.parse(message.createdAt))) throw new Error("invalid message timestamp");
	return message;
}

export function agentLocator(messageId: string): string {
	validateIdentifier(messageId, "message id");
	const encoded = Buffer.from(messageId, "utf8").toString("base64url");
	const locator = `agent:v1:${encoded}`;
	if (locator.length > AGENT_MAX_LOCATOR_LENGTH) throw new Error("agent locator is too long");
	return locator;
}

export function decodeAgentLocator(locator: string): string {
	if (locator.length > AGENT_MAX_LOCATOR_LENGTH) throw new Error("agent locator is too long");
	const match = /^agent:v1:([A-Za-z0-9_-]+)$/.exec(locator);
	if (!match?.[1]) throw new Error("invalid agent locator");
	const messageId = Buffer.from(match[1], "base64url").toString("utf8");
	if (agentLocator(messageId) !== locator) throw new Error("invalid agent locator encoding");
	return messageId;
}

export function compareMessages(a: StoredAgentMessage, b: StoredAgentMessage): number {
	return (
		a.message.createdAt.localeCompare(b.message.createdAt) ||
		a.message.id.localeCompare(b.message.id)
	);
}

const STATE_RANK: Readonly<Record<AgentMessageState, number>> = {
	accepted: 0,
	delivered: 1,
	read: 2,
	replied: 3,
	handled: 3,
};

export function advanceState(
	current: AgentMessageState,
	next: AgentMessageState,
): AgentMessageState {
	return STATE_RANK[next] > STATE_RANK[current] ? next : current;
}
