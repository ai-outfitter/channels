import type { MessageUpdateEvent } from "@earendil-works/pi-coding-agent";
import type {
	AgentEndpoint,
	AgentMessageState,
	AgentMessageV1,
	AgentSendInput,
} from "../agent/types.ts";

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
	readonly endpoint: string;
	readonly limit?: number;
	readonly beforeCursor?: number;
}

export interface RelayConversationSummary {
	readonly id: string;
	readonly updatedAt: string;
	readonly cursor: number;
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
	readonly endpoint: string;
	readonly conversationId: string;
	readonly limit?: number;
	readonly beforeCursor?: number;
}

export interface RelayHistoryItem {
	readonly cursor: number;
	readonly message: AgentMessageV1;
	readonly state: AgentMessageState;
	readonly responseId?: string;
	readonly updatedAt: string;
}

export interface RelayHistoryFrame {
	readonly type: "history";
	readonly requestId: string;
	readonly conversationId: string;
	readonly messages: readonly RelayHistoryItem[];
}

export type RelaySessionQueryRequest =
	| {
			readonly type: "list_conversations";
			readonly limit: number;
			readonly beforeCursor: number;
	  }
	| {
			readonly type: "read_history";
			readonly conversationId: string;
			readonly limit: number;
			readonly beforeCursor: number;
	  };

export interface RelaySessionQueryFrame {
	readonly type: "session_query";
	readonly queryId: string;
	readonly requesterEndpoint: string;
	readonly request: RelaySessionQueryRequest;
}

export type RelaySessionQueryResult =
	| {
			readonly type: "conversations";
			readonly conversations: readonly RelayConversationSummary[];
	  }
	| {
			readonly type: "history";
			readonly conversationId: string;
			readonly messages: readonly RelayHistoryItem[];
	  }
	| {
			readonly type: "error";
			readonly code: string;
			readonly message: string;
	  };

export interface RelaySessionResultFrame {
	readonly type: "session_result";
	readonly queryId: string;
	readonly result: RelaySessionQueryResult;
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

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Streamable assistant text events reuse Pi's own `AssistantMessageEvent`
 * vocabulary (via `MessageUpdateEvent["assistantMessageEvent"]`) restricted
 * to visible text: `text_start`, `text_delta`, and `text_end`. The
 * heavyweight `partial` assistant message is stripped — only the event's own
 * fields travel.
 */
export type RelayStreamTextEvent = DistributiveOmit<
	Extract<
		MessageUpdateEvent["assistantMessageEvent"],
		{ type: "text_start" | "text_delta" | "text_end" }
	>,
	"partial"
>;

export const RELAY_STATUS_TOOL_PHASES = ["tool_start", "tool_end"] as const;
export const RELAY_STATUS_PHASES = [
	"turn_start",
	"thinking_start",
	"thinking_end",
	...RELAY_STATUS_TOOL_PHASES,
	"turn_end",
] as const;

export type RelayStatusPhase = (typeof RELAY_STATUS_PHASES)[number];
export type RelayStatusToolPhase = (typeof RELAY_STATUS_TOOL_PHASES)[number];
export type RelayStatusTurnPhase = Exclude<RelayStatusPhase, RelayStatusToolPhase>;

export const RELAY_STATUS_MAX_TOOL_LENGTH = 128;

/**
 * Coarse turn-activity signal: the agent woke, is thinking, is running a
 * named tool, or ended the turn. Deliberately content-free — thinking text
 * and tool arguments never cross the relay. Tool phases carry the tool's
 * name and nothing else; every other phase carries no tool at all. This is
 * what lets a chat surface show "thinking…" or "running <tool>…" during the
 * long silence before the reply text starts streaming.
 */
export interface RelayStatusTurnEvent {
	readonly type: "status";
	readonly contentIndex: number;
	readonly phase: RelayStatusTurnPhase;
	readonly tool?: undefined;
}

export interface RelayStatusToolEvent {
	readonly type: "status";
	readonly contentIndex: number;
	readonly phase: RelayStatusToolPhase;
	readonly tool: string;
}

export type RelayStatusEvent = RelayStatusTurnEvent | RelayStatusToolEvent;

export type RelayStreamEvent = RelayStreamTextEvent | RelayStatusEvent;

/**
 * Ephemeral chat-plane streaming preview. While producing a durable reply, a
 * sender may push incremental Pi text events under a stable preview id
 * derived from the message being answered. The relay forwards previews to
 * currently connected recipients only: previews are never stored, never
 * spooled, never acknowledged, and never appear in history. The durable
 * reply still arrives as an ordinary send/deliver and supersedes any preview
 * via `replyTo`. Ordering relies on the WebSocket transport.
 */
export interface RelayStreamInput {
	readonly id: string;
	readonly recipient: string;
	readonly conversationId: string;
	readonly replyTo?: string;
	readonly event: RelayStreamEvent;
}

export interface RelayStreamFrame {
	readonly type: "stream";
	readonly input: RelayStreamInput;
}

export interface RelayStreamDeliverFrame {
	readonly type: "stream";
	readonly id: string;
	readonly conversationId: string;
	readonly sender: string;
	readonly recipient: string;
	readonly replyTo?: string;
	readonly event: RelayStreamEvent;
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
	| RelaySessionResultFrame
	| RelayStreamFrame
	| RelayAckFrame
	| RelayPongFrame;

export type RelayServerFrame =
	| RelayAuthenticatedFrame
	| RelayEndpointsFrame
	| RelayConversationsFrame
	| RelayHistoryFrame
	| RelayAcceptedFrame
	| RelayDeliverFrame
	| RelayStreamDeliverFrame
	| RelaySessionQueryFrame
	| RelayPingFrame
	| RelayErrorFrame;

export function parseRelayFrame(value: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(value);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("frame must be a JSON object");
	}
	return parsed as Record<string, unknown>;
}
