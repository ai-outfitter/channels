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

export function createAgentSource(
	config: AgentChannelConfig,
	createTransport: (
		config: AgentChannelConfig,
		journal?: AgentSessionJournal,
	) => AgentTransport = sharedAgentTransport,
	journal = new AgentSessionJournal(),
): ChannelSource {
	return {
		async start(onEvent) {
			const transport = createTransport(config, journal);
			const unsubscribe = await transport.subscribe((messageId) => {
				onEvent({
					channel: "agent",
					summary: "new agent message",
					locator: { key: agentLocator(messageId) },
				});
			});
			return async () => {
				await unsubscribe();
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
 * being produced. Two sources feed the preview, both reusing Pi's text
 * event vocabulary on the wire:
 *
 * - assistant text events pass through as-is;
 * - `channel_respond` tool-call argument deltas are decoded incrementally
 *   and re-emitted as synthesized text events, because the durable reply
 *   body is that tool call's `response` parameter, not assistant prose.
 *
 * Deltas are coalesced and flushed at most every `flushMs` so relay frame
 * budgets hold. Previews are only sent while exactly one
 * delivered-but-unreplied agent message exists — with several open targets
 * the attribution would be a guess, so we skip.
 */
export function createAgentStreamForwarder(
	config: AgentChannelConfig,
	createTransport: (
		config: AgentChannelConfig,
		journal?: AgentSessionJournal,
	) => AgentTransport = sharedAgentTransport,
	journal = new AgentSessionJournal(),
	flushMs = STREAM_FLUSH_MS,
): (event: MessageUpdateEvent) => void {
	let bufferedDelta = "";
	let bufferedIndex = 0;
	let flushTimer: ReturnType<typeof setTimeout> | undefined;
	const toolArgs = new Map<number, string>();
	const toolEmitted = new Map<number, number>();

	const soleOpenTarget = (): string | undefined => {
		const open = journal.openTargets(config.endpointId);
		return open.length === 1 ? open[0]?.message.id : undefined;
	};

	const emit = (event: RelayStreamEvent): void => {
		const targetId = soleOpenTarget();
		if (!targetId) return;
		const transport = createTransport(config, journal);
		void transport.stream?.(targetId, event).catch(() => {});
	};

	const flushDeltas = (): void => {
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = undefined;
		}
		if (bufferedDelta === "") return;
		const delta = bufferedDelta;
		bufferedDelta = "";
		emit({ type: "text_delta", contentIndex: bufferedIndex, delta });
	};

	const bufferDelta = (contentIndex: number, delta: string): void => {
		if (bufferedDelta !== "" && bufferedIndex !== contentIndex) flushDeltas();
		bufferedIndex = contentIndex;
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
	return (event) => {
		const assistant = event.assistantMessageEvent;
		switch (assistant.type) {
			case "text_start":
				flushDeltas();
				emit({ type: "text_start", contentIndex: assistant.contentIndex });
				break;
			case "text_delta":
				if (!soleOpenTarget()) break;
				bufferDelta(assistant.contentIndex, assistant.delta);
				break;
			case "text_end":
				bufferedDelta = "";
				if (flushTimer) {
					clearTimeout(flushTimer);
					flushTimer = undefined;
				}
				emit({
					type: "text_end",
					contentIndex: assistant.contentIndex,
					content: assistant.content,
				});
				break;
			case "toolcall_start":
				toolArgs.set(assistant.contentIndex, "");
				toolEmitted.set(assistant.contentIndex, 0);
				break;
			case "toolcall_delta": {
				const args = (toolArgs.get(assistant.contentIndex) ?? "") + assistant.delta;
				toolArgs.set(assistant.contentIndex, args);
				if (!respondToolAt(assistant.partial, assistant.contentIndex)) break;
				if (!soleOpenTarget()) break;
				const response = extractJsonStringValue(args, "response");
				if (response === undefined) break;
				const emitted = toolEmitted.get(assistant.contentIndex) ?? 0;
				if (emitted === 0) emit({ type: "text_start", contentIndex: assistant.contentIndex });
				if (response.length > emitted) {
					bufferDelta(assistant.contentIndex, response.slice(emitted));
					toolEmitted.set(assistant.contentIndex, response.length);
				}
				break;
			}
			case "toolcall_end": {
				toolArgs.delete(assistant.contentIndex);
				const emitted = toolEmitted.get(assistant.contentIndex) ?? 0;
				toolEmitted.delete(assistant.contentIndex);
				const call = assistant.toolCall;
				if (call.name !== RESPOND_TOOL_NAME || emitted === 0) break;
				bufferedDelta = "";
				if (flushTimer) {
					clearTimeout(flushTimer);
					flushTimer = undefined;
				}
				const response = (call.arguments as { response?: unknown }).response;
				if (typeof response === "string") {
					emit({ type: "text_end", contentIndex: assistant.contentIndex, content: response });
				}
				break;
			}
			default:
				break;
		}
	};
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
