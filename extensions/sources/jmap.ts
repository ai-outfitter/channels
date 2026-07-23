/**
 * JMAP push (EventSource / SSE) channel source.
 *
 * Consumes only the JMAP `StateChange` **ping** for the account's `Email` type —
 * it never reads message bodies. The `mail` skill (via the `xin` CLI) does the
 * actual fetch/reply/move, so this stays a push *signal* listener, not a mail
 * client. Reuses the mail skill's existing `XIN_*` credentials.
 *
 * Tested shape: Stalwart's JMAP EventSource (RFC 8620 §7.3).
 */
import type { ChannelSource } from "./types.ts";
import { scopedLog, supervise } from "./util.ts";

const log = scopedLog("jmap");

/** The account has ~30s ping; treat a stream silent for this long as dead. */
const IDLE_TIMEOUT_MS = 90_000;
const MAIL_CAPABILITY = "urn:ietf:params:jmap:mail";

export interface JmapConfig {
	baseUrl: string;
	user: string;
	pass: string;
}

/** Build config from the mail skill's XIN_* env, or undefined if unset. */
export function jmapConfigFromEnv(): JmapConfig | undefined {
	const baseUrl = process.env.XIN_BASE_URL;
	const user = process.env.XIN_BASIC_USER;
	const pass = process.env.XIN_BASIC_PASS;
	if (!baseUrl || !user || !pass) return undefined;
	return { baseUrl: baseUrl.replace(/\/+$/, ""), user, pass };
}

export function createJmapSource(cfg: JmapConfig): ChannelSource {
	const auth = `Basic ${Buffer.from(`${cfg.user}:${cfg.pass}`).toString("base64")}`;

	return {
		async start(onEvent) {
			return supervise(async (signal) => {
				const session = await fetchSession(cfg.baseUrl, auth, signal);
				log(`watching Email state for account ${session.accountId}`);
				await streamStateChanges(session, auth, signal, () => {
					onEvent({ channel: "jmap", summary: "new mail" });
				});
			}, log);
		},
	};
}

interface JmapSession {
	accountId: string;
	/** Absolute EventSource URL, template already filled. */
	eventSourceUrl: string;
}

async function fetchSession(
	baseUrl: string,
	auth: string,
	signal: AbortSignal,
): Promise<JmapSession> {
	const res = await fetch(`${baseUrl}/.well-known/jmap`, {
		headers: { Authorization: auth, Accept: "application/json" },
		redirect: "follow",
		signal,
	});
	if (!res.ok) throw new Error(`session fetch ${res.status}`);
	const body = (await res.json()) as {
		eventSourceUrl?: string;
		primaryAccounts?: Record<string, string>;
		accounts?: Record<string, { accountCapabilities?: Record<string, unknown> }>;
	};
	if (!body.eventSourceUrl) throw new Error("session has no eventSourceUrl");

	// Prefer the primary mail account; else the first account that actually
	// advertises the mail capability; else give up (don't guess a random one).
	const accountId =
		body.primaryAccounts?.[MAIL_CAPABILITY] ??
		Object.keys(body.accounts ?? {}).find(
			(id) => body.accounts?.[id]?.accountCapabilities?.[MAIL_CAPABILITY] != null,
		);
	if (!accountId) throw new Error("session has no mail account");

	// Fill the RFC 8620 template and resolve against the (post-redirect) session
	// URL, so a relative eventSourceUrl lands under the right path.
	const filled = body.eventSourceUrl
		.replace("{types}", "Email")
		.replace("{closeafter}", "no")
		.replace("{ping}", "30");
	const eventSourceUrl = new URL(filled, res.url).toString();
	return { accountId, eventSourceUrl };
}

async function streamStateChanges(
	session: JmapSession,
	auth: string,
	parentSignal: AbortSignal,
	onMailChange: () => void,
): Promise<void> {
	// A derived controller: aborts when the supervisor stops us OR when the
	// stream goes idle past IDLE_TIMEOUT_MS (a half-open connection), which
	// throws out of read() and lets the supervisor reconnect.
	const ac = new AbortController();
	const onParentAbort = () => ac.abort();
	parentSignal.addEventListener("abort", onParentAbort, { once: true });
	let idle: ReturnType<typeof setTimeout> | undefined;
	const armIdle = () => {
		if (idle) clearTimeout(idle);
		idle = setTimeout(() => ac.abort(new Error("stream idle")), IDLE_TIMEOUT_MS);
	};

	try {
		if (parentSignal.aborted) return;
		const res = await fetch(session.eventSourceUrl, {
			headers: { Authorization: auth, Accept: "text/event-stream" },
			signal: ac.signal,
		});
		if (!res.ok || !res.body) throw new Error(`eventsource ${res.status}`);

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		armIdle();
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				armIdle();
				// Normalize CRLF on the whole buffer so a \r\n split across read
				// boundaries can't hide an SSE frame separator.
				buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
				buffer = emitFrames(buffer, session.accountId, onMailChange);
			}
			// Flush a trailing complete frame the server sent right before EOF.
			buffer = (buffer + decoder.decode()).replace(/\r\n/g, "\n");
			if (buffer.trim()) emitFrame(buffer, session.accountId, onMailChange);
		} finally {
			await reader.cancel().catch(() => {});
		}
	} finally {
		if (idle) clearTimeout(idle);
		parentSignal.removeEventListener("abort", onParentAbort);
	}
}

/** Consume every complete `\n\n`-terminated SSE frame; return the remainder. */
function emitFrames(buffer: string, accountId: string, onMailChange: () => void): string {
	let rest = buffer;
	let sep = rest.indexOf("\n\n");
	while (sep !== -1) {
		emitFrame(rest.slice(0, sep), accountId, onMailChange);
		rest = rest.slice(sep + 2);
		sep = rest.indexOf("\n\n");
	}
	return rest;
}

function emitFrame(frame: string, accountId: string, onMailChange: () => void): void {
	// Per SSE, a frame's `data:` lines rejoin with "\n".
	const data = frame
		.split("\n")
		.filter((l) => l.startsWith("data:"))
		.map((l) => l.slice(5).trim())
		.join("\n");
	if (data && isMailStateChange(data, accountId)) onMailChange();
}

/** A StateChange whose `changed[account]` includes the Email type means new/changed mail. */
function isMailStateChange(data: string, accountId: string): boolean {
	try {
		const parsed = JSON.parse(data) as {
			"@type"?: string;
			changed?: Record<string, Record<string, string>>;
		};
		if (parsed["@type"] !== "StateChange") return false;
		return parsed.changed?.[accountId]?.Email != null;
	} catch {
		return false;
	}
}
