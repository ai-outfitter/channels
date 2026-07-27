import type { AgentEndpoint, AgentMessageV1, AgentSendInput } from "../agent/types.ts";

export const RELAY_PROTOCOL_VERSION = 1 as const;
export const RELAY_MAX_FRAME_BYTES = 64 * 1024;

export interface RelayAuthenticateFrame {
	readonly type: "authenticate";
	readonly version: typeof RELAY_PROTOCOL_VERSION;
	readonly token: string;
	readonly endpoint: string;
	readonly principal: string;
	readonly cursor: number;
}

export interface RelayAuthenticatedFrame {
	readonly type: "authenticated";
	readonly endpoint: string;
	readonly cursor: number;
}

export interface RelayListFrame {
	readonly type: "list";
	readonly requestId: string;
}

export interface RelayEndpointsFrame {
	readonly type: "endpoints";
	readonly requestId: string;
	readonly endpoints: readonly AgentEndpoint[];
}

export interface RelaySendFrame {
	readonly type: "send";
	readonly requestId: string;
	readonly input: AgentSendInput;
}

export interface RelayListConversationsFrame {
	readonly type: "list_conversations";
	readonly requestId: string;
}

export interface RelayConversationSummary {
	readonly id: string;
	readonly updatedAt: string;
	readonly participants: readonly string[];
}

export interface RelayConversationsFrame {
	readonly type: "conversations";
	readonly requestId: string;
	readonly conversations: readonly RelayConversationSummary[];
}

export interface RelayReadHistoryFrame {
	readonly type: "read_history";
	readonly requestId: string;
	readonly conversationId: string;
	readonly limit?: number;
	readonly beforeCursor?: number;
}

export interface RelayHistoryFrame {
	readonly type: "history";
	readonly requestId: string;
	readonly conversationId: string;
	readonly messages: readonly { readonly cursor: number; readonly message: AgentMessageV1 }[];
}

export interface RelayAcceptedFrame {
	readonly type: "accepted";
	readonly requestId: string;
	readonly message: AgentMessageV1;
	readonly state: "accepted";
	readonly duplicate: boolean;
}

export interface RelayDeliverFrame {
	readonly type: "deliver";
	readonly cursor: number;
	readonly message: AgentMessageV1;
}

export interface RelayAckFrame {
	readonly type: "ack";
	readonly cursor: number;
}

export interface RelayPingFrame {
	readonly type: "ping";
	readonly nonce: string;
}

export interface RelayPongFrame {
	readonly type: "pong";
	readonly nonce: string;
}

export interface RelayErrorFrame {
	readonly type: "error";
	readonly code: string;
	readonly message: string;
	readonly requestId?: string;
}

export type RelayClientFrame =
	| RelayAuthenticateFrame
	| RelayListFrame
	| RelayListConversationsFrame
	| RelayReadHistoryFrame
	| RelaySendFrame
	| RelayAckFrame
	| RelayPongFrame;

export type RelayServerFrame =
	| RelayAuthenticatedFrame
	| RelayEndpointsFrame
	| RelayConversationsFrame
	| RelayHistoryFrame
	| RelayAcceptedFrame
	| RelayDeliverFrame
	| RelayPingFrame
	| RelayErrorFrame;

export function parseRelayFrame(value: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(value);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("frame must be a JSON object");
	}
	return parsed as Record<string, unknown>;
}
