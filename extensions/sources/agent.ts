import { FilesystemAgentTransport } from "../agent/filesystem.ts";
import { RelayAgentTransport } from "../agent/relay.ts";
import {
	type AgentEndpoint,
	type AgentSendInput,
	type AgentSendResult,
	type AgentTransport,
	agentLocator,
	decodeAgentLocator,
} from "../agent/types.ts";
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
	readonly relayStatePath?: string;
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
		...(env.AGENT_RELAY_CURSOR_PATH?.trim()
			? { relayStatePath: env.AGENT_RELAY_CURSOR_PATH.trim() }
			: {}),
		...(parsedPoll === undefined ? {} : { pollMs: parsedPoll }),
	};
}

export function createFilesystemAgentTransport(config: AgentChannelConfig): AgentTransport {
	if (config.relayUrl && config.relayToken) {
		return new RelayAgentTransport({
			url: config.relayUrl,
			token: config.relayToken,
			endpointId: config.endpointId,
			principalId: config.principalId,
			...(config.relayStatePath ? { statePath: config.relayStatePath } : {}),
		});
	}
	return new FilesystemAgentTransport({
		root: config.spoolPath,
		endpointId: config.endpointId,
		principalId: config.principalId,
		...(config.pollMs === undefined ? {} : { pollMs: config.pollMs }),
	});
}

const sharedTransports = new Map<string, AgentTransport>();

function sharedAgentTransport(config: AgentChannelConfig): AgentTransport {
	const key = JSON.stringify(config);
	let transport = sharedTransports.get(key);
	if (!transport) {
		transport = createFilesystemAgentTransport(config);
		sharedTransports.set(key, transport);
	}
	return transport;
}

async function releaseSharedAgentTransport(
	config: AgentChannelConfig,
	transport: AgentTransport,
): Promise<void> {
	const key = JSON.stringify(config);
	if (sharedTransports.get(key) === transport) sharedTransports.delete(key);
	await transport.close();
}

export function createAgentSource(
	config: AgentChannelConfig,
	createTransport: (config: AgentChannelConfig) => AgentTransport = sharedAgentTransport,
): ChannelSource {
	return {
		async start(onEvent) {
			const transport = createTransport(config);
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

export function createAgentActions(
	config: AgentChannelConfig,
	createTransport: (config: AgentChannelConfig) => AgentTransport = sharedAgentTransport,
): AgentChannelActions {
	let injectedTransport: AgentTransport | undefined;
	const getTransport = (): AgentTransport => {
		if (createTransport === sharedAgentTransport) return sharedAgentTransport(config);
		injectedTransport ??= createTransport(config);
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
