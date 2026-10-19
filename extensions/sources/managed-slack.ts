/** Binding-scoped managed Slack: provider credentials never enter the runtime. */

import { setTimeout as delay } from "node:timers/promises";
import { WebClient } from "@slack/web-api";
import { readBody } from "../slack-inbox/body.ts";
import type { SourceTaskActivationSink } from "../task-plane/types.ts";
import {
	createSlackActions,
	createSlackSource,
	decodeSlackLocator,
	type SlackConfig,
} from "./slack.ts";
import type { ChannelActions, ChannelSource } from "./types.ts";

interface ManagedConfig {
	bindingId: string;
	workspaceId: string;
	revision: string;
	channelIds: string[];
	inboxUrl: string;
	proxyUrl: string;
}
export interface ManagedSlackOptions {
	url: string;
	token: string;
	bindingId: string;
	transport?: typeof fetch;
	pollMs?: number;
}
export function managedSlackFromEnv(): ManagedSlackOptions | undefined {
	const url = process.env.SLACK_CONFIG_URL?.trim();
	const token = process.env.SLACK_CONFIG_TOKEN?.trim();
	const bindingId = process.env.SLACK_BINDING_ID?.trim();
	if (!url && !token) return undefined;
	if (!url || !token || !bindingId)
		throw new Error("Managed Slack requires configuration URL, runtime credential, and binding ID");
	const endpoint = serviceEndpoint(url);
	return { url: endpoint.href, token, bindingId };
}
function serviceEndpoint(value: string): URL {
	const endpoint = new URL(value);
	if (
		endpoint.protocol !== "https:" ||
		endpoint.username ||
		endpoint.password ||
		endpoint.hash ||
		endpoint.search
	)
		throw new Error("Invalid managed Slack endpoint");
	return endpoint;
}
function sameOriginEndpoint(value: unknown, origin: string, directory: boolean): boolean {
	if (typeof value !== "string") return false;
	try {
		const endpoint = serviceEndpoint(value);
		return endpoint.origin === origin && endpoint.pathname.endsWith("/") === directory;
	} catch {
		return false;
	}
}

export async function readManagedSlack(
	options: ManagedSlackOptions,
): Promise<ManagedConfig | null> {
	const response = await (options.transport ?? fetch)(serviceEndpoint(options.url), {
		headers: { Authorization: `Bearer ${options.token}` },
		redirect: "error",
		signal: AbortSignal.timeout(10_000),
	});
	if (response.status === 409) {
		await response.body?.cancel();
		return null;
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error("Managed Slack configuration unavailable");
	}
	const cfg = JSON.parse(await readBody(response, 256 * 1024)) as ManagedConfig;
	const origin = new URL(options.url).origin;
	if (
		cfg.bindingId !== options.bindingId ||
		typeof cfg.workspaceId !== "string" ||
		!/^T[A-Z0-9]{8,20}$/.test(cfg.workspaceId) ||
		typeof cfg.revision !== "string" ||
		!Array.isArray(cfg.channelIds) ||
		!cfg.channelIds.length ||
		cfg.channelIds.length > 10_000 ||
		cfg.channelIds.some((id) => typeof id !== "string" || !/^[CG][A-Z0-9]{8,20}$/.test(id)) ||
		!sameOriginEndpoint(cfg.inboxUrl, origin, false) ||
		!sameOriginEndpoint(cfg.proxyUrl, origin, true)
	)
		throw new Error("Managed Slack binding mismatch");
	return cfg;
}
function adapters(options: ManagedSlackOptions, cfg: ManagedConfig) {
	const web = new WebClient(options.token, {
		slackApiUrl: cfg.proxyUrl,
		retryConfig: { retries: 0 },
	});
	const config: SlackConfig = {
		appToken: "",
		botToken: options.token,
		inboxUrl: cfg.inboxUrl,
		inboxToken: options.token,
		inboxRevision: cfg.revision,
		bindingId: cfg.bindingId,
		workspaceId: cfg.workspaceId,
		channelIds: new Set(cfg.channelIds),
	};
	return { web, config };
}
export function managedSlackSource(
	options: ManagedSlackOptions,
	sink: SourceTaskActivationSink,
): ChannelSource {
	return {
		async start(onEvent) {
			const controller = new AbortController();
			let stop: (() => Promise<void>) | undefined;
			let revision: string | undefined;
			const refresh = async () => {
				try {
					const cfg = await readManagedSlack(options);
					if (cfg?.revision !== revision) {
						await stop?.();
						stop = undefined;
						revision = undefined;
					}
					if (cfg && !stop && !controller.signal.aborted) {
						const { web, config } = adapters(options, cfg);
						stop = await createSlackSource(
							config,
							{
								socket: () => {
									throw new Error("Managed Slack does not use Socket Mode");
								},
								web: () => web,
								...(options.transport ? { inbox: options.transport } : {}),
							},
							undefined,
							sink,
						).start(onEvent);
						revision = cfg.revision;
					}
				} catch {
					await stop?.();
					stop = undefined;
					revision = undefined;
				}
			};
			const loop = (async () => {
				while (!controller.signal.aborted) {
					await refresh();
					try {
						await delay(options.pollMs ?? 30_000, undefined, { signal: controller.signal });
					} catch {
						break;
					}
				}
				await stop?.();
			})();
			return async () => {
				controller.abort();
				await loop;
			};
		},
	};
}
export function managedSlackActions(
	options: ManagedSlackOptions,
	sink: SourceTaskActivationSink,
): ChannelActions {
	const load = async (locator: string) => {
		const cfg = await readManagedSlack(options);
		if (!cfg?.channelIds.includes(decodeSlackLocator(locator).channelId))
			throw new Error("Slack channel is not granted");
		const { web } = adapters(options, cfg);
		return createSlackActions(
			{ botToken: options.token, doneEmoji: "white_check_mark" },
			web,
			sink,
		);
	};
	return {
		read: async (locator) => (await load(locator)).read(locator),
		respond: async (locator, response) => (await load(locator)).respond(locator, response),
	};
}
