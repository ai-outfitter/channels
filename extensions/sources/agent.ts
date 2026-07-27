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

/**
 * Forward Pi assistant text events as ephemeral relay previews while a reply
 * is being produced. Consecutive `text_delta` events are coalesced and
 * flushed at most every `flushMs` so relay frame budgets hold. Previews are
 * only sent while exactly one delivered-but-unreplied agent message exists —
 * with several open targets the attribution would be a guess, so we skip.
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

	return (event) => {
		const assistant = event.assistantMessageEvent;
		switch (assistant.type) {
			case "text_start":
				flushDeltas();
				emit({ type: "text_start", contentIndex: assistant.contentIndex });
				break;
			case "text_delta":
				if (bufferedDelta !== "" && bufferedIndex !== assistant.contentIndex) flushDeltas();
				bufferedIndex = assistant.contentIndex;
				bufferedDelta += assistant.delta;
				flushTimer ??= setTimeout(flushDeltas, flushMs);
				flushTimer.unref?.();
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
