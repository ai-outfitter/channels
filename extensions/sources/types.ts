import type { A2aPart } from "../a2a/types.ts";

/**
 * A channel event-source turns a channel's native push stream (JMAP EventSource,
 * signal-cli daemon, Slack Socket Mode, …) into callbacks the extension can use to
 * wake the agent. Sources open their connection in `start` and return a `stop`
 * handle; the extension calls `stop` from the inference-free `session_shutdown`
 * hook.
 */
export interface ChannelSource {
	/**
	 * Open the push connection and invoke `onEvent` once per received signal.
	 * The sink returns false when its bounded queue cannot accept an event, so
	 * sources with replayable streams can retry it.
	 * Returns an idempotent stop handle that closes the connection.
	 */
	start(onEvent: (event: ChannelEvent) => unknown): Promise<() => Promise<void>>;
}

/**
 * A **trusted** "there is work" ping — deliberately carries no untrusted message
 * body. An action adapter fetches and exposes the actual (untrusted) content
 * through a channel tool, so attacker-controlled text never enters the session
 * as a user message.
 */
export interface ChannelEvent {
	/** Which channel produced the signal, e.g. "jmap". */
	channel: string;
	/** Short trusted human summary for logs/UI, e.g. "new mail". */
	summary: string;
	/**
	 * Optional trusted coalescing key for locator-less events: distinct keys keep
	 * distinct pending entries; the same key coalesces redelivery. The source must
	 * validate it and must never derive it from message content.
	 */
	dedupeKey?: string;
	/**
	 * Optional trusted structural locator. Values must be validated by the source
	 * and must never contain sender-controlled message content.
	 */
	locator?: ChannelLocator;
	/** Exact, untrusted work submitted to the shared A2A source router. */
	work?: ChannelWork;
}

/** Source-owned evidence and routing keys for one native provider event. */
export interface ChannelWork {
	/** Provider-stable event id. Redelivery MUST use the same value. */
	providerEventId: string;
	/** Provider-native structural fields. Values MUST NOT contain message bodies. */
	nativeLocator: Readonly<Record<string, string>>;
	/** Time at which this source received or reconciled the event. */
	receivedAt: string;
	/** Provider-stable idempotency key. */
	dedupeKey: string;
	/** Stable conversation key. Events with this key MAY continue one task. */
	correlationKey?: string;
	/** Trusted source-authored summary. */
	sourceSummary: string;
	/** Direct provider link, when the source can derive one safely. */
	nativeUrl?: string;
	/** Exact untrusted A2A message parts for the task history. */
	parts: readonly A2aPart[];
}

/** A channel-specific reference that lets a skill fetch the untrusted content. */
export interface ChannelLocator {
	/**
	 * Stable opaque key used for redelivery coalescing and channel tool calls.
	 * Only the owning adapter may decode it.
	 */
	key: string;
}

/** One untrusted message returned by a channel adapter. */
export interface ChannelContextMessage {
	id: string;
	author: string;
	text: string;
	target: boolean;
}

/** Channel-neutral context returned by `channel_read`. */
export interface ChannelReadResult {
	channel: string;
	locator: string;
	handled: boolean;
	messages: readonly ChannelContextMessage[];
}

/** Channel-neutral outcome returned by `channel_respond`. */
export interface ChannelRespondResult {
	channel: string;
	locator: string;
	replied: boolean;
	handled: boolean;
	responseId?: string;
	warning?: string;
}

/** Operations a channel adapter exposes to the agent-facing tools. */
export interface ChannelActions {
	read(locator: string): Promise<ChannelReadResult>;
	respond(locator: string, response: string): Promise<ChannelRespondResult>;
}
