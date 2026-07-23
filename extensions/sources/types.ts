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
	 * Returns an idempotent stop handle that closes the connection.
	 */
	start(onEvent: (event: ChannelEvent) => void): Promise<() => Promise<void>>;
}

/**
 * A **trusted** "there is work" ping — deliberately carries no untrusted message
 * body. The channel skill fetches and reads the actual (untrusted) content, so
 * attacker-controlled text never enters the session as a user message.
 */
export interface ChannelEvent {
	/** Which channel produced the signal, e.g. "jmap". */
	channel: string;
	/** Short trusted human summary for logs/UI, e.g. "new mail". */
	summary: string;
}
