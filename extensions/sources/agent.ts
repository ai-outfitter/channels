import type { MessageUpdateEvent } from "@earendil-works/pi-coding-agent";
import { FilesystemAgentTransport } from "../agent/filesystem.ts";
import { AgentSessionJournal } from "../agent/journal.ts";
import { RelayAgentTransport } from "../agent/relay.ts";
import {
	type AgentEndpoint,
	type AgentSendInput,
	type AgentSendResult,
	type AgentTransport,
	agentLocator,
	decodeAgentLocator,
} from "../agent/types.ts";
import type { RelayStreamEvent } from "../relay/protocol.ts";
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
): ChannelSource {
	const log = scopedLog("agent");
	return {
		async start(onEvent) {
			const transport = createTransport(config, journal);
			const deliver = (messageId: string) => {
				onEvent({
					channel: "agent",
					summary: "new agent message",
					locator: { key: agentLocator(messageId) },
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
			case "toolcall_start":
				toolArgs.set(assistant.contentIndex, "");
				toolEmitted.set(assistant.contentIndex, 0);
				break;
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
				if (call.name !== RESPOND_TOOL_NAME || emitted === 0) break;
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
	});
}

export function createAgentActions(
	config: AgentChannelConfig,
	createTransport: (
		config: AgentChannelConfig,
		journal?: AgentSessionJournal,
	) => AgentTransport = sharedAgentTransport,
	journal = new AgentSessionJournal(),
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
			const result = await getTransport().respond(decodeAgentLocator(locator), response);
			return {
				channel: "agent",
				locator,
				replied: true,
				handled: result.target.state === "replied",
				responseId: result.response.message.id,
			};
		},
	};
}
