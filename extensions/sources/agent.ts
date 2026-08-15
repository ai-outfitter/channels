import type { MessageUpdateEvent } from "@earendil-works/pi-coding-agent";
import { FilesystemAgentTransport } from "../agent/filesystem.ts";
import { AgentSessionJournal } from "../agent/journal.ts";
import { RelayAgentTransport } from "../agent/relay.ts";
import {
	type AgentEndpoint,
	type AgentMessageV1,
	type AgentSendInput,
	type AgentSendResult,
	type AgentTransport,
	agentLocator,
	decodeAgentLocator,
} from "../agent/types.ts";
import type {
	RelayStatusEvent,
	RelayStatusToolPhase,
	RelayStatusTurnPhase,
	RelayStreamEvent,
} from "../relay/protocol.ts";
import { contentDigest, sourceIdentifier } from "../task-plane/source-activation.ts";
import type { SourceTaskActivationSink } from "../task-plane/types.ts";
import type {
	ChannelActions,
	ChannelReadResult,
	ChannelRespondResult,
	ChannelSource,
} from "./types.ts";
import { scopedLog } from "./util.ts";

export interface AgentChannelConfig {
	readonly endpointId: string;
	readonly principalId: string;
	readonly spoolPath: string;
	readonly relayUrl?: string;
	readonly relayToken?: string;
	readonly pollMs?: number;
}

export interface AgentChannelActions extends ChannelActions {
	list(): Promise<readonly AgentEndpoint[]>;
	send(input: AgentSendInput): Promise<AgentSendResult>;
}

export function agentConfigFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): AgentChannelConfig | undefined {
	const endpointId = env.AGENT_ENDPOINT_ID?.trim();
	const spoolPath = env.AGENT_SPOOL_PATH?.trim();
	const relayUrl = env.AGENT_RELAY_URL?.trim();
	const relayToken = env.AGENT_RELAY_TOKEN?.trim();
	if (!endpointId || (!spoolPath && !relayUrl)) return undefined;
	if (Boolean(relayUrl) !== Boolean(relayToken)) {
		throw new Error("AGENT_RELAY_URL and AGENT_RELAY_TOKEN must be configured together");
	}
	const parsedPoll = env.AGENT_SPOOL_POLL_MS ? Number(env.AGENT_SPOOL_POLL_MS) : undefined;
	if (parsedPoll !== undefined && (!Number.isInteger(parsedPoll) || parsedPoll < 25)) {
		throw new Error("AGENT_SPOOL_POLL_MS must be an integer of at least 25");
	}
	return {
		endpointId,
		principalId: env.AGENT_PRINCIPAL_ID?.trim() || endpointId,
		spoolPath: spoolPath ?? "",
		...(relayUrl ? { relayUrl, relayToken: relayToken ?? "" } : {}),
		...(parsedPoll === undefined ? {} : { pollMs: parsedPoll }),
	};
}

export function createFilesystemAgentTransport(
	config: AgentChannelConfig,
	journal = new AgentSessionJournal(),
): AgentTransport {
	if (config.relayUrl && config.relayToken) {
		return new RelayAgentTransport(
			{
				url: config.relayUrl,
				token: config.relayToken,
				endpointId: config.endpointId,
				principalId: config.principalId,
			},
			journal,
		);
	}
	return new FilesystemAgentTransport(
		{
			root: config.spoolPath,
			endpointId: config.endpointId,
			principalId: config.principalId,
			...(config.pollMs === undefined ? {} : { pollMs: config.pollMs }),
		},
		journal,
	);
}

const sharedTransports = new Map<
	string,
	{ readonly transport: AgentTransport; readonly journal: AgentSessionJournal }
>();

function sharedAgentTransport(
	config: AgentChannelConfig,
	journal = new AgentSessionJournal(),
): AgentTransport {
	const key = JSON.stringify(config);
	let shared = sharedTransports.get(key);
	if (!shared) {
		shared = { transport: createFilesystemAgentTransport(config, journal), journal };
		sharedTransports.set(key, shared);
	} else if (shared.journal !== journal) {
		throw new Error("agent transport is already attached to another Pi session");
	}
	return shared.transport;
}

async function releaseSharedAgentTransport(
	config: AgentChannelConfig,
	transport: AgentTransport,
): Promise<void> {
	const key = JSON.stringify(config);
	if (sharedTransports.get(key)?.transport === transport) sharedTransports.delete(key);
	await transport.close();
}

export const SUBSCRIBE_RETRY_INITIAL_MS = 1_000;
export const SUBSCRIBE_RETRY_MAX_MS = 30_000;

export function createAgentSource(
	config: AgentChannelConfig,
	createTransport: (
		config: AgentChannelConfig,
		journal?: AgentSessionJournal,
	) => AgentTransport = sharedAgentTransport,
	journal = new AgentSessionJournal(),
	retryInitialMs = SUBSCRIBE_RETRY_INITIAL_MS,
	taskSink?: SourceTaskActivationSink,
): ChannelSource {
	if (!taskSink) throw new Error("agent task sink is required");
	const log = scopedLog("agent");
	return {
		async start() {
			const transport = createTransport(config, journal);
			const deliver = async (message: AgentMessageV1): Promise<void> => {
				const locator = agentLocator(message.id);
				await taskSink.accept({
					principal: sourceIdentifier("agent", config.principalId),
					source: "agent",
					providerEventId: sourceIdentifier("event", message.id),
					providerDedupeKey: sourceIdentifier("event", message.id),
					nativeLocator: {
						channelLocator: locator,
						messageId: message.id,
						sender: message.sender,
						recipient: message.recipient,
						conversationId: message.conversationId,
					},
					receivedAt: message.createdAt,
					conversationKey: sourceIdentifier("conversation", message.conversationId),
					parts: [{ data: { channelLocator: locator } }],
					contentDigest: contentDigest(message),
				});
			};
			// The initial subscribe races the relay's own startup when the relay
			// runs inside this very process (and the Service endpoint appearing
			// when it hairpins through Kubernetes), so it retries with capped
			// backoff instead of giving up. Established connections already
			// reconnect inside the transport.
			let unsubscribe: (() => Promise<void>) | undefined;
			let stopped = false;
			let retryTimer: ReturnType<typeof setTimeout> | undefined;

			const trySubscribe = async (): Promise<boolean> => {
				try {
					const cancel = await transport.subscribe(deliver);
					if (stopped) {
						await cancel();
						return true;
					}
					unsubscribe = cancel;
					return true;
				} catch (err) {
					log(`connect failed, will retry: ${(err as Error).message}`);
					return false;
				}
			};

			const scheduleRetry = (delayMs: number): void => {
				if (stopped) return;
				retryTimer = setTimeout(() => {
					void trySubscribe().then((connected) => {
						if (connected) log("connected after retry");
						else scheduleRetry(Math.min(delayMs * 2, SUBSCRIBE_RETRY_MAX_MS));
					});
				}, delayMs);
				retryTimer.unref?.();
			};

			if (!(await trySubscribe())) scheduleRetry(retryInitialMs);

			return async () => {
				stopped = true;
				if (retryTimer) clearTimeout(retryTimer);
				if (unsubscribe) await unsubscribe();
				if (createTransport === sharedAgentTransport) {
					await releaseSharedAgentTransport(config, transport);
				} else {
					await transport.close();
				}
			};
		},
	};
}

export const STREAM_FLUSH_MS = 250;
export const RESPOND_TOOL_NAME = "channel_respond";
/**
 * How many waiting counterparts receive turn-status previews. Status events
 * fire before any reply locator exists, so they fan out to the open (still
 * unreplied) inbound messages; the cap bounds relay frames when a queue has
 * piled up.
 */
export const MAX_STATUS_TARGETS = 8;

/**
 * Incrementally read a JSON string value out of a partial JSON document.
 * Returns the decoded value so far (possibly still growing), or undefined
 * when the key or its opening quote has not appeared yet. Trailing
 * incomplete escapes are held back until more input arrives.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a single incremental scanner keeps escape handling in one place
export function extractJsonStringValue(source: string, key: string): string | undefined {
	const keyToken = `"${key}"`;
	let index = source.indexOf(keyToken);
	if (index < 0) return undefined;
	index += keyToken.length;
	while (index < source.length && " \t\r\n".includes(source[index] ?? "")) index += 1;
	if (source[index] !== ":") return undefined;
	index += 1;
	while (index < source.length && " \t\r\n".includes(source[index] ?? "")) index += 1;
	if (source[index] !== '"') return undefined;
	index += 1;
	const escapes: Record<string, string> = {
		'"': '"',
		"\\": "\\",
		"/": "/",
		b: "\b",
		f: "\f",
		n: "\n",
		r: "\r",
		t: "\t",
	};
	let value = "";
	while (index < source.length) {
		const char = source[index];
		if (char === '"') return value;
		if (char === "\\") {
			const escaped = source[index + 1];
			if (escaped === undefined) return value;
			if (escaped === "u") {
				const hex = source.slice(index + 2, index + 6);
				if (hex.length < 4 || Number.isNaN(Number.parseInt(hex, 16))) return value;
				value += String.fromCharCode(Number.parseInt(hex, 16));
				index += 6;
				continue;
			}
			value += escapes[escaped] ?? escaped;
			index += 2;
			continue;
		}
		value += char;
		index += 1;
	}
	return value;
}

/**
 * Forward the in-progress reply as ephemeral relay previews while it is
 * being produced. Only `channel_respond` tool-call argument deltas feed the
 * preview: they are decoded incrementally and re-emitted as synthesized Pi
 * text events, because the durable reply body is that tool call's `response`
 * parameter, not assistant prose. Attribution is exact — the call's locator
 * argument names the target message, so no guessing from journal state.
 *
 * Deltas are coalesced and flushed at most every `flushMs` so relay frame
 * budgets hold.
 */
export interface AgentStreamForwarder {
	(event: MessageUpdateEvent): void;
	/**
	 * Latch the forwarder off and drop anything still buffered. Called at
	 * session shutdown so a pending flush or a late event can never construct
	 * a fresh transport after the shared one was released.
	 */
	stop(): void;
	/** Announce a turn beginning to every waiting counterpart. */
	turnStart(): void;
	/** Announce a turn ending, so a status indicator never hangs. */
	turnEnd(): void;
}

export function createAgentStreamForwarder(
	config: AgentChannelConfig,
	createTransport: (
		config: AgentChannelConfig,
		journal?: AgentSessionJournal,
	) => AgentTransport = sharedAgentTransport,
	journal = new AgentSessionJournal(),
	flushMs = STREAM_FLUSH_MS,
): AgentStreamForwarder {
	let bufferedDelta = "";
	let bufferedIndex = 0;
	let bufferedTarget: string | undefined;
	let flushTimer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	const toolArgs = new Map<number, string>();
	const toolEmitted = new Map<number, number>();

	// Exact attribution: the channel_respond call names its target via the
	// locator argument, which streams before (or alongside) the response.
	// Require the closing quote so a half-streamed locator never decodes to
	// the wrong message; locators are base64url so no JSON escapes occur.
	const targetFromArgs = (args: string): string | undefined => {
		const match = /"locator"\s*:\s*"(agent:v1:[A-Za-z0-9_-]+)"/.exec(args);
		if (!match?.[1]) return undefined;
		try {
			const messageId = decodeAgentLocator(match[1]);
			const target = journal.message(messageId);
			return target?.message.recipient === config.endpointId ? messageId : undefined;
		} catch {
			return undefined;
		}
	};

	// Emitting must never *construct* a transport: after session shutdown the
	// shared one is released, and creating a fresh one here would open a new
	// WebSocket with its own reconnect loop that nothing ever closes. Look up
	// the live shared transport, or fall back to the injected factory (which
	// tests use to hand in a fake).
	const sharedKey = JSON.stringify(config);
	const lookupTransport = (): AgentTransport | undefined =>
		createTransport === sharedAgentTransport
			? sharedTransports.get(sharedKey)?.transport
			: createTransport(config, journal);

	const emit = (targetId: string | undefined, event: RelayStreamEvent): void => {
		if (!targetId || stopped) return;
		const transport = lookupTransport();
		void transport?.stream?.(targetId, event).catch(() => {});
	};

	// Turn-status events fire before any channel_respond locator exists, so
	// they cannot be attributed the way text previews are. Instead every open
	// (still unreplied) inbound message gets the status — its sender is
	// waiting on this turn, and the durable reply or turn_end supersedes the
	// indicator. Content-free by design: phase and, for tool phases, the
	// tool's name only.
	const fanOutStatus = (event: RelayStatusEvent): void => {
		if (stopped) return;
		for (const open of journal.openMessages(config.endpointId).slice(0, MAX_STATUS_TARGETS)) {
			emit(open.message.id, event);
		}
	};
	const emitStatus = (phase: RelayStatusTurnPhase, contentIndex: number): void => {
		fanOutStatus({ type: "status", contentIndex, phase });
	};
	const emitToolStatus = (
		phase: RelayStatusToolPhase,
		contentIndex: number,
		tool: string,
	): void => {
		fanOutStatus({ type: "status", contentIndex, phase, tool });
	};

	const toolNameAt = (
		partial: { content: ReadonlyArray<{ type?: string; name?: string }> },
		contentIndex: number,
	): string | undefined => {
		const block = partial.content[contentIndex];
		return block?.type === "toolCall" ? block.name : undefined;
	};

	const flushDeltas = (): void => {
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = undefined;
		}
		if (bufferedDelta === "") return;
		const delta = bufferedDelta;
		bufferedDelta = "";
		emit(bufferedTarget, { type: "text_delta", contentIndex: bufferedIndex, delta });
	};

	const bufferDelta = (targetId: string, contentIndex: number, delta: string): void => {
		if (bufferedDelta !== "" && (bufferedIndex !== contentIndex || bufferedTarget !== targetId)) {
			flushDeltas();
		}
		bufferedIndex = contentIndex;
		bufferedTarget = targetId;
		bufferedDelta += delta;
		flushTimer ??= setTimeout(flushDeltas, flushMs);
		flushTimer.unref?.();
	};

	const respondToolAt = (
		partial: { content: ReadonlyArray<{ type?: string; name?: string }> },
		contentIndex: number,
	): boolean => {
		const block = partial.content[contentIndex];
		return block?.type === "toolCall" && block.name === RESPOND_TOOL_NAME;
	};

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one event dispatcher keeps the preview pipeline's state together
	const forward = (event: MessageUpdateEvent): void => {
		if (stopped) return;
		const assistant = event.assistantMessageEvent;
		switch (assistant.type) {
			case "thinking_start":
				emitStatus("thinking_start", assistant.contentIndex);
				break;
			case "thinking_end":
				// Only the phase crosses — never the thinking text.
				emitStatus("thinking_end", assistant.contentIndex);
				break;
			case "toolcall_start": {
				toolArgs.set(assistant.contentIndex, "");
				toolEmitted.set(assistant.contentIndex, 0);
				// The reply call itself is not activity worth announcing: its
				// argument text already streams as the reply preview. A start
				// whose name has not streamed yet is skipped too — tool phases
				// must carry the name, and the definitive toolcall_end still
				// announces the call.
				const name = toolNameAt(assistant.partial, assistant.contentIndex);
				if (name !== undefined && name !== RESPOND_TOOL_NAME) {
					emitToolStatus("tool_start", assistant.contentIndex, name);
				}
				break;
			}
			case "toolcall_delta": {
				const args = (toolArgs.get(assistant.contentIndex) ?? "") + assistant.delta;
				toolArgs.set(assistant.contentIndex, args);
				if (!respondToolAt(assistant.partial, assistant.contentIndex)) break;
				const target = targetFromArgs(args);
				if (!target) break;
				const response = extractJsonStringValue(args, "response");
				if (response === undefined) break;
				const emitted = toolEmitted.get(assistant.contentIndex) ?? 0;
				if (emitted === 0) {
					emit(target, { type: "text_start", contentIndex: assistant.contentIndex });
				}
				if (response.length > emitted) {
					bufferDelta(target, assistant.contentIndex, response.slice(emitted));
					toolEmitted.set(assistant.contentIndex, response.length);
				}
				break;
			}
			case "toolcall_end": {
				const args = toolArgs.get(assistant.contentIndex) ?? "";
				toolArgs.delete(assistant.contentIndex);
				const emitted = toolEmitted.get(assistant.contentIndex) ?? 0;
				toolEmitted.delete(assistant.contentIndex);
				const call = assistant.toolCall;
				if (call.name !== RESPOND_TOOL_NAME) {
					emitToolStatus("tool_end", assistant.contentIndex, call.name);
					break;
				}
				if (emitted === 0) break;
				// Flush rather than discard. The coalescing window means a reply that
				// completes inside it has every buffered delta pending here, and
				// dropping them makes the preview arrive all at once at the end —
				// which is the case streaming exists for.
				flushDeltas();
				const locator = (call.arguments as { locator?: unknown }).locator;
				const target =
					typeof locator === "string"
						? targetFromArgs(JSON.stringify({ locator }))
						: targetFromArgs(args);
				const response = (call.arguments as { response?: unknown }).response;
				if (target && typeof response === "string") {
					emit(target, {
						type: "text_end",
						contentIndex: assistant.contentIndex,
						content: response,
					});
				}
				break;
			}
			default:
				break;
		}
	};
	return Object.assign(forward, {
		stop(): void {
			stopped = true;
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = undefined;
			}
			bufferedDelta = "";
			toolArgs.clear();
			toolEmitted.clear();
		},
		turnStart(): void {
			emitStatus("turn_start", 0);
		},
		turnEnd(): void {
			emitStatus("turn_end", 0);
		},
	});
}

export function createAgentActions(
	config: AgentChannelConfig,
	createTransport: (
		config: AgentChannelConfig,
		journal?: AgentSessionJournal,
	) => AgentTransport = sharedAgentTransport,
	journal = new AgentSessionJournal(),
	taskSink?: SourceTaskActivationSink,
): AgentChannelActions {
	let injectedTransport: AgentTransport | undefined;
	const getTransport = (): AgentTransport => {
		if (createTransport === sharedAgentTransport) return sharedAgentTransport(config, journal);
		injectedTransport ??= createTransport(config, journal);
		return injectedTransport;
	};
	return {
		list: () => getTransport().list(),
		send: (input) => getTransport().send(input),
		async read(locator): Promise<ChannelReadResult> {
			const targetId = decodeAgentLocator(locator);
			const result = await getTransport().read(targetId);
			return {
				channel: "agent",
				locator,
				handled: result.target.state === "handled" || result.target.state === "replied",
				messages: result.messages.map((stored) => ({
					id: stored.message.id,
					author: stored.message.sender,
					text: stored.message.body,
					target: stored.message.id === targetId,
				})),
			};
		},
		async respond(locator, response): Promise<ChannelRespondResult> {
			if (!taskSink?.taskForLocator || !taskSink.deliver) {
				throw new Error("agent task delivery is not configured");
			}
			const taskId = await taskSink.taskForLocator("agent", locator);
			let result: Awaited<ReturnType<AgentTransport["respond"]>> | undefined;
			const responseId = await taskSink.deliver(
				{
					taskId,
					source: "agent",
					operationId: `reply:${locator}`,
					payloadDigest: contentDigest(response),
					recovery: "idempotent",
				},
				async () => {
					result = await getTransport().respond(decodeAgentLocator(locator), response);
					return result.response.message.id;
				},
			);
			if (!responseId) throw new Error("agent response returned no message id");
			return {
				channel: "agent",
				locator,
				replied: true,
				handled: true,
				responseId,
			};
		},
	};
}
