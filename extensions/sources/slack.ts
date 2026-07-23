/**
 * Slack push channel source (Socket Mode).
 *
 * Opens a Slack **Socket Mode** websocket (`apps.connections.open` → `wss`) and
 * consumes only the **event envelope** as a trusted "new message" ping — it never
 * reads message text. The `slack-responder` skill (via the bot token) does the
 * actual read/reply. Every envelope is ACK'd so Slack doesn't redeliver.
 *
 * A third transport shape (websocket) alongside JMAP SSE and the signal-cli
 * child process; like them it collapses to `onEvent` + a stop and runs under the
 * shared `supervise` restart loop.
 */
import type { ChannelSource } from "./types.ts";
import { parseList, scopedLog, supervise } from "./util.ts";

const log = scopedLog("slack");

export interface SlackConfig {
	/** App-level token (`xapp-…`) with `connections:write`, for Socket Mode. */
	appToken: string;
	/** Channels to watch; empty = every channel the bot is in. */
	channelIds: Set<string>;
}

/** Build config from the slack-responder skill's env, or undefined if unset. */
export function slackConfigFromEnv(): SlackConfig | undefined {
	const appToken = process.env.SLACK_APP_TOKEN;
	if (!appToken) return undefined;
	return { appToken, channelIds: new Set(parseList(process.env.SLACK_CHANNEL_IDS)) };
}

export function createSlackSource(cfg: SlackConfig): ChannelSource {
	return {
		async start(onEvent) {
			return supervise((signal) => runSocket(cfg, signal, onEvent), log);
		},
	};
}

/** Open a Socket Mode connection and pump it until it closes or is aborted. */
async function runSocket(
	cfg: SlackConfig,
	signal: AbortSignal,
	onEvent: (event: { channel: string; summary: string }) => void,
): Promise<void> {
	const url = await openConnection(cfg.appToken, signal);
	await pumpSocket(url, cfg, signal, onEvent);
}

/** Ask Slack for a fresh Socket Mode websocket URL. */
async function openConnection(appToken: string, signal: AbortSignal): Promise<string> {
	const res = await fetch("https://slack.com/api/apps.connections.open", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${appToken}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		signal,
	});
	const body = (await res.json()) as { ok?: boolean; url?: string; error?: string };
	if (!body.ok || !body.url) {
		throw new Error(`apps.connections.open failed: ${body.error ?? `HTTP ${res.status}`}`);
	}
	return body.url;
}

/**
 * Resolves when `signal` aborts (clean stop); rejects on socket error/close so
 * the supervisor reconnects. Slack's own `disconnect` frame also triggers a
 * reconnect by closing the socket.
 */
function pumpSocket(
	url: string,
	cfg: SlackConfig,
	signal: AbortSignal,
	onEvent: (event: { channel: string; summary: string }) => void,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const ws = new WebSocket(url);
		const onAbort = () => ws.close();
		const cleanup = () => signal.removeEventListener("abort", onAbort);

		if (signal.aborted) ws.close();
		else signal.addEventListener("abort", onAbort, { once: true });

		ws.addEventListener("open", () => log("socket mode connected"));
		ws.addEventListener("message", (ev) => handleFrame(ev.data, ws, cfg, signal, onEvent));
		ws.addEventListener("error", () => {
			cleanup();
			reject(new Error("socket error"));
		});
		ws.addEventListener("close", () => {
			cleanup();
			if (signal.aborted) resolve();
			else reject(new Error("socket closed"));
		});
	});
}

interface SocketFrame {
	type?: string;
	envelope_id?: string;
	payload?: { event?: SlackEvent };
}

interface SlackEvent {
	type?: string;
	subtype?: string;
	bot_id?: string;
	channel?: string;
}

/** ACK every envelope; wake only on a human message in a watched channel. */
function handleFrame(
	raw: unknown,
	ws: WebSocket,
	cfg: SlackConfig,
	signal: AbortSignal,
	onEvent: (event: { channel: string; summary: string }) => void,
): void {
	if (signal.aborted) return;
	const frame = parseFrame(raw);
	if (!frame) return;
	if (frame.type === "disconnect") {
		ws.close(); // Slack asked us to reconnect
		return;
	}
	if (frame.envelope_id) {
		ws.send(JSON.stringify({ envelope_id: frame.envelope_id }));
	}
	if (frame.type === "events_api" && isUserMessage(frame.payload?.event, cfg.channelIds)) {
		onEvent({ channel: "slack", summary: "new message" });
	}
}

function parseFrame(raw: unknown): SocketFrame | undefined {
	if (typeof raw !== "string") return undefined;
	try {
		return JSON.parse(raw) as SocketFrame;
	} catch {
		return undefined;
	}
}

/** A real user message (not an edit/delete/bot post) in a watched channel. */
function isUserMessage(event: SlackEvent | undefined, channelIds: Set<string>): boolean {
	if (event?.type !== "message" || event.subtype || event.bot_id) return false;
	return channelIds.size === 0 || (event.channel != null && channelIds.has(event.channel));
}
