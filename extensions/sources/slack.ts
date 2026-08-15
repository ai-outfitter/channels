/**
 * Slack push channel source (Socket Mode).
 *
 * The official Socket Mode client owns connection setup, acknowledgements,
 * reconnects, and shutdown. This source accepts only `app_mention` events and
 * emits validated structural locators; it never copies mention text into the
 * trusted wake. The Slack responder fetches context and replies with the bot
 * token through the Web API.
 */
import { SocketModeClient } from "@slack/socket-mode";
import {
	type ConversationsHistoryResponse,
	type ConversationsRepliesResponse,
	WebClient,
} from "@slack/web-api";
import { contentDigest, sourceIdentifier } from "../task-plane/source-activation.ts";
import type { SourceTaskActivationSink } from "../task-plane/types.ts";
import { compareSlackTimestamps, parseSlackChannelIds } from "./slack-config.ts";
import type {
	ChannelActions,
	ChannelContextMessage,
	ChannelEvent,
	ChannelReadResult,
	ChannelRespondResult,
	ChannelSource,
} from "./types.ts";
import { RECONNECT_DELAY_MS, scopedLog, supervise } from "./util.ts";

const log = scopedLog("slack");
const CHANNEL_ID = /^[A-Z][A-Z0-9]{1,}$/;
const MESSAGE_TS = /^\d+\.\d+$/;
const EMOJI_NAME = /^[a-z0-9_+-]{1,100}$/;
const DEFAULT_DONE_EMOJI = "white_check_mark";
const MAX_THREAD_PAGES = 20;

export interface SlackConfig {
	/** App-level token (`xapp-…`) with `connections:write`, for Socket Mode. */
	appToken: string;
	/** Bot token (`xoxb-…`) validated here and used by the responder's Web API calls. */
	botToken: string;
	/** Explicit channel allowlist; empty = every channel the bot has joined. */
	channelIds: Set<string>;
}

export interface SlackActionsConfig {
	botToken: string;
	doneEmoji: string;
}

/** The official SDK's message shape, as returned by the context-fetch methods. */
type SlackMessage =
	| NonNullable<ConversationsHistoryResponse["messages"]>[number]
	| NonNullable<ConversationsRepliesResponse["messages"]>[number];

export interface SlackClientFactories {
	socket(appToken: string): SocketModeClient;
	web(botToken: string): WebClient;
}

const defaultClients: SlackClientFactories = {
	socket: (appToken) => new SocketModeClient({ appToken }),
	web: (botToken) => new WebClient(botToken),
};

interface SlackEnvelope {
	type?: string;
	body?: unknown;
	ack?: () => Promise<void>;
}

/** Build complete Slack channel config, or undefined when either token is absent. */
export function slackConfigFromEnv(): SlackConfig | undefined {
	const appToken = process.env.SLACK_APP_TOKEN?.trim();
	const botToken = process.env.SLACK_BOT_TOKEN?.trim();
	if (!appToken || !botToken) return undefined;
	return {
		appToken,
		botToken,
		channelIds: parseSlackChannelIds(process.env.SLACK_CHANNEL_IDS),
	};
}

/** Build the Slack action adapter config from the responder's bot credential. */
export function slackActionsConfigFromEnv(): SlackActionsConfig | undefined {
	const botToken = process.env.SLACK_BOT_TOKEN?.trim();
	if (!botToken) return undefined;
	const doneEmoji = process.env.LINK_SLACK_DONE_EMOJI?.trim() || DEFAULT_DONE_EMOJI;
	if (!EMOJI_NAME.test(doneEmoji)) {
		throw new Error("LINK_SLACK_DONE_EMOJI is not a valid Slack emoji name");
	}
	return { botToken, doneEmoji };
}

/**
 * Convert an untrusted Socket Mode event into a trusted body-free locator.
 * Invalid ids, bot messages, subtypes, and channels outside an explicit
 * allowlist are ignored. With the default joined policy, Slack delivers
 * mentions from conversations the installed bot has joined.
 */
export function mentionEvent(
	raw: unknown,
	channelIds: ReadonlySet<string>,
): ChannelEvent | undefined {
	if (!isRecord(raw)) return undefined;
	if (raw.type !== "app_mention" || raw.subtype || raw.bot_id) return undefined;
	if (typeof raw.channel !== "string" || !CHANNEL_ID.test(raw.channel)) return undefined;
	if (typeof raw.ts !== "string" || !MESSAGE_TS.test(raw.ts)) return undefined;
	if (channelIds.size > 0 && !channelIds.has(raw.channel)) return undefined;
	if (
		raw.thread_ts !== undefined &&
		(typeof raw.thread_ts !== "string" || !MESSAGE_TS.test(raw.thread_ts))
	) {
		return undefined;
	}

	return {
		channel: "slack",
		summary: "new mention",
		locator: {
			key: encodeSlackLocator({
				channel: raw.channel,
				ts: raw.ts,
				...(typeof raw.thread_ts === "string" ? { thread_ts: raw.thread_ts } : {}),
			}),
		},
	};
}

interface DecodedSlackLocator {
	channelId: string;
	messageTs: string;
	threadTs?: string;
}

export function createSlackActions(
	cfg: SlackActionsConfig,
	web: WebClient | undefined,
	taskSink: SourceTaskActivationSink,
): ChannelActions {
	web ??= new WebClient(cfg.botToken);
	let botUserId: Promise<string> | undefined;
	const getBotUserId = (): Promise<string> => {
		botUserId ??= authenticateBot(web).catch((error) => {
			botUserId = undefined;
			throw error;
		});
		return botUserId;
	};

	return {
		async read(locator): Promise<ChannelReadResult> {
			const decoded = decodeSlackLocator(locator);
			const [messages, ownUserId] = await Promise.all([
				decoded.threadTs
					? readThreadContext(web, { ...decoded, threadTs: decoded.threadTs })
					: readChannelContext(web, decoded),
				getBotUserId(),
			]);
			const target = messages.find((message) => message.ts === decoded.messageTs);
			if (!target) throw new Error("Slack did not return the located message");

			return {
				channel: "slack",
				locator,
				handled: hasOwnReaction(target, cfg.doneEmoji, ownUserId),
				messages: messages.map((message) => contextMessage(message, decoded.messageTs)),
			};
		},

		async respond(locator, response): Promise<ChannelRespondResult> {
			const decoded = decodeSlackLocator(locator);
			const post = async (): Promise<string> => {
				const posted = await web.chat.postMessage({
					channel: decoded.channelId,
					thread_ts: decoded.threadTs ?? decoded.messageTs,
					text: response,
				});
				assertSlackOk(posted, "chat.postMessage");
				if (!posted.ts) throw new Error("chat.postMessage returned no response timestamp");
				return posted.ts;
			};
			if (!taskSink.taskForLocator || !taskSink.deliver) {
				throw new Error("Slack task delivery is not configured");
			}
			const activeTaskId = await taskSink.taskForLocator("slack", locator);
			const responseId = await taskSink.deliver(
				{
					taskId: activeTaskId,
					source: "slack",
					operationId: `reply:${locator}`,
					payloadDigest: contentDigest(response),
					recovery: "ambiguous",
				},
				post,
			);
			if (!responseId) throw new Error("chat.postMessage returned no response timestamp");
			const replied = {
				channel: "slack",
				locator,
				replied: true,
				responseId,
			} as const;

			try {
				const addReaction = async (): Promise<string> => {
					const handled = await web.reactions.add({
						channel: decoded.channelId,
						timestamp: decoded.messageTs,
						name: cfg.doneEmoji,
					});
					assertSlackOk(handled, "reactions.add");
					return decoded.messageTs;
				};
				await taskSink.deliver(
					{
						taskId: activeTaskId,
						source: "slack",
						operationId: `handled:${locator}`,
						payloadDigest: contentDigest({ emoji: cfg.doneEmoji }),
						recovery: "idempotent",
					},
					addReaction,
				);
				return { ...replied, handled: true };
			} catch (error) {
				if (slackErrorCode(error) === "already_reacted") {
					return { ...replied, handled: true };
				}
				return {
					...replied,
					handled: false,
					warning: `Marking handled failed: ${errorMessage(error)}`,
				};
			}
		},
	};
}

function decodeSlackLocator(locator: string): DecodedSlackLocator {
	const [channel, version, encoded, extra] = locator.split(":");
	if (
		channel !== "slack" ||
		version !== "v1" ||
		extra !== undefined ||
		!encoded ||
		encoded.length > 512 ||
		!/^[A-Za-z0-9_-]+$/.test(encoded)
	) {
		throw new Error("invalid Slack channel locator");
	}
	let payload: unknown;
	try {
		const bytes = Buffer.from(encoded, "base64url");
		if (bytes.toString("base64url") !== encoded) throw new Error("non-canonical locator");
		payload = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error("invalid Slack channel locator");
	}
	if (!isRecord(payload)) throw new Error("invalid Slack channel locator");
	const channelId = payload.c;
	const messageTs = payload.m;
	const threadTs = payload.r;
	if (
		typeof channelId !== "string" ||
		!CHANNEL_ID.test(channelId) ||
		typeof messageTs !== "string" ||
		!MESSAGE_TS.test(messageTs) ||
		(threadTs !== undefined && (typeof threadTs !== "string" || !MESSAGE_TS.test(threadTs)))
	) {
		throw new Error("invalid Slack channel locator");
	}
	return { channelId, messageTs, ...(threadTs ? { threadTs } : {}) };
}

function encodeSlackLocator(mention: { channel: string; ts: string; thread_ts?: string }): string {
	const payload = {
		c: mention.channel,
		m: mention.ts,
		...(mention.thread_ts ? { r: mention.thread_ts } : {}),
	};
	return `slack:v1:${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

async function authenticateBot(web: WebClient): Promise<string> {
	const identity = await web.auth.test();
	if (!identity.ok || !identity.user_id) throw new Error("bot token failed auth.test");
	return identity.user_id;
}

async function readChannelContext(
	web: WebClient,
	locator: DecodedSlackLocator,
): Promise<SlackMessage[]> {
	const response = await web.conversations.history({
		channel: locator.channelId,
		latest: locator.messageTs,
		inclusive: true,
		limit: 10,
	});
	assertSlackOk(response, "conversations.history");
	return [...(response.messages ?? [])].sort(compareMessages);
}

async function readThreadContext(
	web: WebClient,
	locator: DecodedSlackLocator & { threadTs: string },
): Promise<SlackMessage[]> {
	const messages = new Map<string, SlackMessage>();
	let cursor: string | undefined;

	for (let page = 0; page < MAX_THREAD_PAGES; page += 1) {
		const response = await web.conversations.replies({
			channel: locator.channelId,
			ts: locator.threadTs,
			limit: 100,
			...(cursor ? { cursor } : {}),
		});
		assertSlackOk(response, "conversations.replies");
		addMessages(messages, response.messages);
		if (messages.has(locator.messageTs)) return boundedThreadContext(messages, locator);
		cursor = response.response_metadata?.next_cursor?.trim() || undefined;
		if (!cursor) break;
	}

	throw new Error("Slack did not return the located thread message");
}

function addMessages(
	target: Map<string, SlackMessage>,
	messages: SlackMessage[] | undefined,
): void {
	for (const message of messages ?? []) {
		if (message.ts) target.set(message.ts, message);
	}
}

function boundedThreadContext(
	messages: ReadonlyMap<string, SlackMessage>,
	locator: DecodedSlackLocator & { threadTs: string },
): SlackMessage[] {
	const ordered = [...messages.values()].sort(compareMessages);
	const targetIndex = ordered.findIndex((message) => message.ts === locator.messageTs);
	const throughTarget = ordered.slice(0, targetIndex + 1);
	const recent = throughTarget.slice(-10);
	const root = ordered.find((message) => message.ts === locator.threadTs);
	if (root && !recent.some((message) => message.ts === root.ts)) {
		return [root, ...recent.slice(-9)];
	}
	return recent;
}

function compareMessages(left: SlackMessage, right: SlackMessage): number {
	return compareSlackTimestamps(left.ts ?? "0", right.ts ?? "0");
}

function contextMessage(message: SlackMessage, targetTs: string): ChannelContextMessage {
	return {
		id: message.ts ?? "unknown",
		author: message.user ?? message.bot_id ?? "unknown",
		text: message.text ?? "",
		target: message.ts === targetTs,
	};
}

function hasOwnReaction(message: SlackMessage, emoji: string, botUserId: string): boolean {
	return Boolean(
		message.reactions?.some(
			(reaction) => reaction.name === emoji && reaction.users?.includes(botUserId),
		),
	);
}

function assertSlackOk<T extends { ok?: boolean; error?: string }>(
	response: T,
	method: string,
): asserts response is T & { ok: true } {
	if (!response.ok) throw new Error(`${method} failed: ${response.error ?? "unknown error"}`);
}

function slackErrorCode(error: unknown): string | undefined {
	if (!isRecord(error)) return undefined;
	if (typeof error.error === "string") return error.error;
	if (!isRecord(error.data)) return undefined;
	return typeof error.data.error === "string" ? error.data.error : undefined;
}

export function createSlackSource(
	cfg: SlackConfig,
	clients: SlackClientFactories | undefined,
	retryMs: number | undefined,
	taskSink: SourceTaskActivationSink,
): ChannelSource {
	clients ??= defaultClients;
	retryMs ??= RECONNECT_DELAY_MS;
	return {
		async start() {
			return supervise((signal) => runSlackAttempt(cfg, clients, signal, taskSink), log, retryMs);
		},
	};
}

async function runSlackAttempt(
	cfg: SlackConfig,
	clients: SlackClientFactories,
	signal: AbortSignal,
	taskSink: SourceTaskActivationSink,
): Promise<void> {
	const botUserId = await authenticateBot(clients.web(cfg.botToken));

	const socket = clients.socket(cfg.appToken);
	socket.on("error", (error) => {
		log(`socket mode error: ${errorMessage(error)}`);
	});
	socket.on("slack_event", (payload) => {
		void handleSlackEnvelope(payload, cfg.channelIds, taskSink).catch((error) => {
			log(`Slack activation failed: ${errorMessage(error)}`);
		});
	});
	try {
		await socket.start();
		if (signal.aborted) return;
		log(`socket mode connected as ${botUserId}`);
		await untilAborted(signal);
	} finally {
		await socket.disconnect().catch((error) => {
			log(`socket mode disconnect failed: ${errorMessage(error)}`);
		});
	}
}

function untilAborted(signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve) =>
		signal.addEventListener("abort", () => resolve(), { once: true }),
	);
}

async function handleSlackEnvelope(
	raw: unknown,
	channelIds: ReadonlySet<string>,
	taskSink: SourceTaskActivationSink,
): Promise<void> {
	if (!isRecord(raw)) return;
	const envelope = raw as SlackEnvelope;
	if (typeof envelope.ack !== "function") {
		log("Slack envelope did not provide an acknowledgement callback");
		return;
	}
	const acknowledge = async (): Promise<void> => {
		try {
			await envelope.ack?.();
		} catch (error) {
			log(`failed to acknowledge Slack envelope: ${errorMessage(error)}`);
		}
	};
	if (envelope.type !== "events_api" || !isRecord(envelope.body)) {
		await acknowledge();
		return;
	}
	const event = mentionEvent(envelope.body.event, channelIds);
	if (!event) {
		await acknowledge();
		return;
	}
	const body = envelope.body as Record<string, unknown>;
	const native = body.event as Record<string, unknown>;
	const eventId = body.event_id;
	const workspace = body.team_id ?? native.team;
	if (typeof eventId !== "string" || typeof workspace !== "string") {
		await recordMalformedSlackEnvelope(
			taskSink,
			body,
			"Slack event is missing event_id or workspace identity",
		);
		await acknowledge();
		return;
	}
	const channel = native.channel as string;
	const messageTs = native.ts as string;
	const threadTs = typeof native.thread_ts === "string" ? native.thread_ts : messageTs;
	const text = typeof native.text === "string" ? native.text : "";
	const locator = event.locator?.key;
	if (!locator) {
		await recordMalformedSlackEnvelope(taskSink, body, "Slack mention has no exact locator");
		await acknowledge();
		return;
	}
	await taskSink.accept({
		principal: sourceIdentifier("slack", workspace),
		source: "slack",
		providerEventId: sourceIdentifier("event", eventId),
		providerDedupeKey: sourceIdentifier("event", eventId),
		nativeLocator: {
			workspace,
			channel,
			messageTimestamp: messageTs,
			threadTimestamp: threadTs,
			channelLocator: locator,
		},
		receivedAt: new Date().toISOString(),
		conversationKey: sourceIdentifier("conversation", `${workspace}\0${channel}\0${threadTs}`),
		parts: [{ data: { channelLocator: locator } }, { text }],
		contentDigest: contentDigest({ workspace, channel, messageTs, threadTs, text }),
	});
	await acknowledge();
}

async function recordMalformedSlackEnvelope(
	taskSink: SourceTaskActivationSink,
	body: Record<string, unknown>,
	reason: string,
): Promise<void> {
	const eventId = typeof body.event_id === "string" ? body.event_id : undefined;
	const workspace =
		typeof body.team_id === "string"
			? body.team_id
			: isRecord(body.event) && typeof body.event.team === "string"
				? body.event.team
				: undefined;
	await taskSink.recordEvidence?.({
		evidenceId: sourceIdentifier("evidence", `${contentDigest(body)}\0${reason}`),
		source: "slack",
		kind: "malformed-envelope",
		detail: {
			reason,
			...(eventId ? { eventId } : {}),
			...(workspace ? { workspace } : {}),
		},
	});
	log(`acknowledging malformed envelope: ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
