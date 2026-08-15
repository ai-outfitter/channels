/**
 * Channel event-source extension — multi-channel.
 *
 * Turns each configured channel's **native push stream** into durable Task
 * activations. Connection lifecycle runs on inference-free hooks
 * (`session_start` / `session_shutdown`); the task plane owns every wake.
 *
 * Multiple channels run at once. A composed personal agent (email + slack + …)
 * brings each channel's credentials, and this extension lights up every channel it
 * finds configured — the shared extension is deduplicated across the channel
 * profiles that select it.
 *
 * Channel selection:
 * - `OUTFITTER_CHANNELS` set (comma/space list, e.g. `jmap,signal`) → start
 *   exactly those.
 * - unset → auto-detect: start every registered source whose credentials are
 *   present. Unconfigured sources are skipped.
 * - set to `off`/`none` → disabled (keeps pure loop-polling).
 */
import type { ExtensionAPI, MessageUpdateEvent } from "@earendil-works/pi-coding-agent";
import { AgentSessionJournal } from "./agent/journal.ts";
import { registerAgentTools } from "./agent-tools.ts";
import { registerChannelTools } from "./channel-tools.ts";
import type { AgentChannelActions } from "./sources/agent.ts";
import type { ChannelActions, ChannelSource } from "./sources/types.ts";
import { errorMessage, parseList, scopedLog } from "./sources/util.ts";
import type { SourceTaskActivationSink } from "./task-plane/types.ts";

const log = scopedLog("");

export interface SourceRegistration {
	/** Cheap environment probe that must not import the channel implementation. */
	configured(): boolean;
	/** Dynamically load and configure the channel implementation. */
	load(
		journal: AgentSessionJournal | undefined,
		taskSink: SourceTaskActivationSink,
	): Promise<ChannelSource | undefined>;
	/** Dynamically load the channel's agent-facing actions, when supported. */
	loadActions?(
		journal: AgentSessionJournal | undefined,
		taskSink: SourceTaskActivationSink,
	): Promise<ChannelActions | undefined>;
	/** Load the native agent channel's discovery/send actions, when supported. */
	loadAgentActions?(journal?: AgentSessionJournal): Promise<AgentChannelActions | undefined>;
	/** Load a forwarder that streams Pi assistant text events as previews. */
	loadStreamForwarder?(journal?: AgentSessionJournal): Promise<StreamForwarder | undefined>;
}

/**
 * A message-update forwarder; `stop` latches it off at session shutdown, and
 * the optional turn hooks announce turn boundaries as status previews.
 */
export type StreamForwarder = ((event: MessageUpdateEvent) => void) & {
	stop?(): void;
	turnStart?(): void;
	turnEnd?(): void;
};

/** Run a source module's env-config probe and construct it when configured. */
function configure<C, T>(fromEnv: () => C | undefined, create: (cfg: C) => T): T | undefined {
	const cfg = fromEnv();
	return cfg ? create(cfg) : undefined;
}

/**
 * The source registry. Keep configuration probes dependency-free and dynamically
 * import every implementation so unused channel SDKs are never evaluated.
 */
const SOURCES: Record<string, SourceRegistration> = {
	jmap: {
		configured: () =>
			Boolean(process.env.XIN_BASE_URL || process.env.XIN_BASIC_USER || process.env.XIN_BASIC_PASS),
		async load(_journal, taskSink) {
			const m = await import("./sources/jmap.ts");
			const cfg = m.jmapConfigFromEnv();
			return cfg ? m.createJmapSource(cfg, undefined, taskSink) : undefined;
		},
	},
	signal: {
		configured: () => Boolean(process.env.SIGNAL_NUMBER || process.env.SIGNAL_CLI_CONFIG),
		async load() {
			const m = await import("./sources/signal.ts");
			return configure(m.signalConfigFromEnv, m.createSignalSource);
		},
	},
	github: {
		configured: () => Boolean(process.env.GITHUB_NOTIFY_TOKEN || process.env.GITHUB_TOKEN),
		async load(_journal, taskSink) {
			const m = await import("./sources/github.ts");
			const cfg = m.githubConfigFromEnv();
			return cfg ? m.createGithubSource(cfg, taskSink) : undefined;
		},
	},
	forgejo: {
		configured: () => Boolean(process.env.FORGEJO_TOKEN),
		async load() {
			const m = await import("./sources/forgejo.ts");
			return configure(m.forgejoConfigFromEnv, m.createForgejoSource);
		},
	},
	slack: {
		configured: () => Boolean(process.env.SLACK_APP_TOKEN || process.env.SLACK_BOT_TOKEN),
		async load(_journal, taskSink) {
			const m = await import("./sources/slack.ts");
			const cfg = m.slackConfigFromEnv();
			return cfg ? m.createSlackSource(cfg, undefined, undefined, taskSink) : undefined;
		},
		async loadActions(_journal, taskSink) {
			const m = await import("./sources/slack.ts");
			const cfg = m.slackActionsConfigFromEnv();
			return cfg ? m.createSlackActions(cfg, undefined, taskSink) : undefined;
		},
	},
	agent: {
		configured: () =>
			Boolean(
				process.env.AGENT_ENDPOINT_ID ||
					process.env.AGENT_SPOOL_PATH ||
					process.env.AGENT_RELAY_URL ||
					process.env.AGENT_RELAY_TOKEN,
			),
		async load(journal) {
			const m = await import("./sources/agent.ts");
			const config = m.agentConfigFromEnv();
			return config ? m.createAgentSource(config, undefined, journal) : undefined;
		},
		async loadActions(journal) {
			const m = await import("./sources/agent.ts");
			const config = m.agentConfigFromEnv();
			return config ? m.createAgentActions(config, undefined, journal) : undefined;
		},
		async loadAgentActions(journal) {
			const m = await import("./sources/agent.ts");
			const config = m.agentConfigFromEnv();
			return config ? m.createAgentActions(config, undefined, journal) : undefined;
		},
		async loadStreamForwarder(journal) {
			const m = await import("./sources/agent.ts");
			const config = m.agentConfigFromEnv();
			return config ? m.createAgentStreamForwarder(config, undefined, journal) : undefined;
		},
	},
	chatto: {
		configured: () =>
			Boolean(
				process.env.CHATTO_BASE_URL || process.env.CHATTO_TOKEN || process.env.CHATTO_ROOM_IDS,
			),
		async load(_journal, taskSink) {
			const m = await import("./sources/chatto.ts");
			const cfg = m.chattoConfigFromEnv();
			return cfg ? m.createChattoSource(cfg, undefined, undefined, undefined, taskSink) : undefined;
		},
		async loadActions(_journal, taskSink) {
			const m = await import("./sources/chatto.ts");
			const cfg = m.chattoConfigFromEnv();
			return cfg ? m.createChattoActions(cfg, undefined, taskSink) : undefined;
		},
	},
	mattermost: {
		configured: () =>
			Boolean(
				process.env.MATTERMOST_BASE_URL ||
					process.env.MATTERMOST_BOT_TOKEN ||
					process.env.MATTERMOST_CHANNEL_IDS,
			),
		async load() {
			const m = await import("./sources/mattermost.ts");
			return configure(m.mattermostConfigFromEnv, m.createMattermostSource);
		},
		async loadActions() {
			const m = await import("./sources/mattermost.ts");
			return configure(m.mattermostConfigFromEnv, m.createMattermostActions);
		},
	},
	zulip: {
		configured: () =>
			Boolean(
				process.env.ZULIP_ORGANIZATION_URL ||
					process.env.ZULIP_BOT_EMAIL ||
					process.env.ZULIP_API_KEY ||
					process.env.ZULIP_CHANNEL_IDS,
			),
		async load() {
			const m = await import("./sources/zulip.ts");
			return configure(m.zulipConfigFromEnv, m.createZulipSource);
		},
		async loadActions() {
			const m = await import("./sources/zulip.ts");
			return configure(m.zulipConfigFromEnv, m.createZulipActions);
		},
	},
};

export default function channelEventsExtension(
	pi: ExtensionAPI,
	taskSink: () => SourceTaskActivationSink,
	sources: Readonly<Record<string, SourceRegistration>> = SOURCES,
	onTransactionalFailure: () => void | Promise<void> = () => {},
): ChannelEventsLifecycle | undefined {
	const selection = process.env.OUTFITTER_CHANNELS?.trim();
	if (selection === "off" || selection === "none") return undefined;

	// unset → auto-detect all; set (even to "") → exactly the listed channels,
	// de-duplicated so a repeated name can't start a source twice.
	const wanted =
		selection === undefined ? Object.keys(sources) : [...new Set(parseList(selection))];
	const actionCache = new Map<string, Promise<ChannelActions>>();
	let agentActions: Promise<AgentChannelActions> | undefined;
	const agentJournal = new AgentSessionJournal((customType, data) => {
		pi.appendEntry(customType, data);
	});

	registerChannelTools(pi, async (locator) => {
		const channel = locatorChannel(locator);
		if (!wanted.includes(channel)) {
			throw new Error(`channel "${channel}" is not selected`);
		}
		const registration = sources[channel];
		if (!registration?.loadActions) {
			// The agent reads this string and must know what to do next, so it says
			// so. "Does not support channel tools" alone leaves it retrying a tool
			// that can never work.
			throw new Error(
				`channel "${channel}" has no channel tools. It is a signal-only channel. ` +
					`Use the channel's skill to find the work instead.`,
			);
		}
		let actions = actionCache.get(channel);
		if (!actions) {
			actions = registration
				.loadActions(channel === "agent" ? agentJournal : undefined, taskSink())
				.then((loaded) => {
					if (!loaded) throw new Error(`channel "${channel}" actions are not configured`);
					return loaded;
				})
				.catch((error) => {
					actionCache.delete(channel);
					throw error;
				});
			actionCache.set(channel, actions);
		}
		return actions;
	});
	registerAgentTools(pi, async () => {
		if (!wanted.includes("agent")) throw new Error('channel "agent" is not selected');
		const registration = sources.agent;
		if (!registration?.loadAgentActions) {
			throw new Error('channel "agent" does not support agent tools');
		}
		if (!agentActions) {
			agentActions = registration
				.loadAgentActions(agentJournal)
				.then((loaded) => {
					if (!loaded) throw new Error('channel "agent" actions are not configured');
					return loaded;
				})
				.catch((error) => {
					agentActions = undefined;
					throw error;
				});
		}
		return agentActions;
	});

	const stops: Array<() => Promise<void>> = [];
	let starting = false;
	let stopped = false;
	let startupSucceeded = false;

	const lifecycle: ChannelEventsLifecycle = {
		startupSucceeded: () => startupSucceeded,
	};

	// Resolve and start one channel. Explicit
	// selection is transactional; auto-detection preserves 1.7's per-source
	// isolation and simply skips a source that cannot load or start.
	const startChannel = async (
		kind: string,
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: explicit and auto-detected startup deliberately have different failure contracts
	): Promise<(() => Promise<void>) | undefined> => {
		try {
			const registration = sources[kind];
			if (!registration) throw new Error(`unknown channel "${kind}"`);
			if (!registration.configured()) {
				if (selection !== undefined) throw new Error(`channel "${kind}" is not configured`);
				return undefined;
			}
			const source = await registration.load(
				kind === "agent" ? agentJournal : undefined,
				taskSink(),
			);
			if (!source) throw new Error(`channel "${kind}" configuration is incomplete`);
			return await source.start(() => {
				throw new Error(`channel "${kind}" emitted through the removed legacy wake path`);
			});
		} catch (error) {
			if (selection !== undefined) throw error;
			log(`failed to start "${kind}": ${(error as Error).message}; skipping`);
			return undefined;
		}
	};

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: startup deliberately keeps staging, rollback, shutdown races, and readiness in one lifecycle transaction
	pi.on("session_start", async (_event, ctx) => {
		if (stops.length > 0 || starting) return; // idempotent across reload / concurrent fires
		agentJournal.restore(ctx?.sessionManager.getEntries() ?? []);
		starting = true;
		stopped = false;
		startupSucceeded = false;
		const started: Array<{ kind: string; stop: () => Promise<void> }> = [];
		try {
			const results = await Promise.allSettled(
				wanted.map(async (kind) => ({ kind, stop: await startChannel(kind) })),
			);
			for (const [index, result] of results.entries()) {
				if (result.status === "fulfilled") {
					const { kind, stop } = result.value;
					if (stop) started.push({ kind, stop });
				} else {
					log(`channel "${wanted[index]}" startup failed: ${errorMessage(result.reason)}`);
				}
			}
			const failed = results.find((result) => result.status === "rejected");
			if (failed?.status === "rejected") throw failed.reason;
			if (stopped) {
				for (const { stop } of started.reverse()) await stop().catch(() => {});
				return;
			}
			for (const { kind, stop } of started) {
				stops.push(stop);
				log(`started channel "${kind}"`);
			}
			startupSucceeded = true;
			if (stops.length === 0) log("no channels started");
		} catch (error) {
			for (const { stop } of started.reverse()) await stop().catch(() => {});
			await onTransactionalFailure();
			log(`channels unhealthy: ${(error as Error).message}`);
			throw error;
		} finally {
			starting = false;
		}
	});

	// Stream assistant text as ephemeral previews to the agent channel while a
	// reply is in flight, and turn/thinking/tool activity as status previews.
	// Loaded lazily on the first event; failures disable streaming for the
	// session rather than affecting the turn.
	const agentRegistration = sources.agent;
	let forwarder: StreamForwarder | null | undefined;
	let forwarderLoading: Promise<void> | undefined;
	if (wanted.includes("agent") && agentRegistration?.loadStreamForwarder) {
		const withForwarder = (apply: (forwarder: StreamForwarder) => void): void => {
			if (stopped || forwarder === null) return;
			if (forwarder) {
				apply(forwarder);
				return;
			}
			if (forwarderLoading) return;
			forwarderLoading = agentRegistration
				.loadStreamForwarder?.(agentJournal)
				.then((loaded) => {
					forwarder = loaded ?? null;
					if (forwarder) apply(forwarder);
				})
				.catch((err) => {
					forwarder = null;
					log(`stream previews disabled: ${(err as Error).message}`);
				});
		};
		pi.on("message_update", (event) => {
			withForwarder((loaded) => loaded(event as MessageUpdateEvent));
		});
		pi.on("agent_start", () => withForwarder((loaded) => loaded.turnStart?.()));
		pi.on("agent_end", () => withForwarder((loaded) => loaded.turnEnd?.()));
	}

	pi.on("session_shutdown", async () => {
		stopped = true;
		startupSucceeded = false;
		// Stop the forwarder before releasing transports: a pending flush after
		// the shared transport is released must be dropped, not given a chance
		// to open a fresh connection nothing will ever close.
		forwarder?.stop?.();
		forwarder = undefined;
		forwarderLoading = undefined;
		const all = stops.splice(0);
		await Promise.all(all.map((stop) => stop().catch(() => {})));
	});

	return lifecycle;
}

export interface ChannelEventsLifecycle {
	startupSucceeded(): boolean;
}

/**
 * A **trusted** wake prompt: it names which channels have activity and tells the
 * agent to use channel tools, but carries no untrusted message body. Action
 * adapters fetch the actual content, keeping attacker-controlled text out of the
 * session as a user message.
 */
export function locatorChannel(locator: string): string {
	const match = /^([a-z][a-z0-9-]*):v[1-9]\d*:[A-Za-z0-9_-]+$/.exec(locator);
	if (!match?.[1]) throw new Error("invalid channel locator");
	return match[1];
}
