/**
 * JMAP push (EventSource / SSE) channel source.
 *
 * Consumes JMAP `StateChange` **pings** for the account's `Email` type and
 * `CalendarAlert` pushes when calendar alarms fire. It never reads message or
 * event bodies. The `mail` skill (via the `xin` CLI) does the actual mail work,
 * so this stays a push *signal* listener, not a mail or calendar client. Reuses
 * the mail skill's existing `XIN_*` credentials.
 *
 * Tested shape: Stalwart's JMAP EventSource (RFC 8620 §7.3).
 */
import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { ChannelEvent, ChannelSource } from "./types.ts";
import { RECONNECT_DELAY_MS, scopedLog, supervise } from "./util.ts";

const log = scopedLog("jmap");

/** The account has ~30s ping; treat a stream silent for this long as dead. */
const IDLE_TIMEOUT_MS = 90_000;
const MAIL_CAPABILITY = "urn:ietf:params:jmap:mail";
const CORE_CAPABILITY = "urn:ietf:params:jmap:core";
const CALENDARS_CAPABILITY = "urn:ietf:params:jmap:calendars";
/**
 * The uid is the only event-derived text surfaced in the trusted wake summary,
 * so it must match this conservative charset (which also bounds its length);
 * anything else falls back to the generic summary.
 */
const CALENDAR_ALERT_UID_PATTERN = /^[A-Za-z0-9._:@-]{1,128}$/;
/**
 * Statuses on the `Email,CalendarAlert` subscription that plausibly mean "this
 * push type is unacceptable" — a bad request, an unknown resource, an
 * unprocessable type list, or an unimplemented one. These are properties of the
 * request, not of the moment, so retrying the same subscription would fail the
 * same way; narrowing to `Email` is the only way forward. Everything else
 * (401/403 auth, 408 timeout, 429 throttling, 5xx) is transient or a whole-
 * connection problem, and must throw instead — see the downgrade site.
 */
const DOWNGRADE_STATUSES: ReadonlySet<number> = new Set([400, 404, 422, 501]);

export interface JmapConfig {
	baseUrl: string;
	user: string;
	pass: string;
	statePath?: string;
}

/** Build config from the mail skill's XIN_* env, or undefined if unset. */
export function jmapConfigFromEnv(): JmapConfig | undefined {
	const baseUrl = process.env.XIN_BASE_URL;
	const user = process.env.XIN_BASIC_USER;
	const pass = process.env.XIN_BASIC_PASS;
	if (!baseUrl || !user || !pass) return undefined;
	const statePath = process.env.JMAP_STATE_PATH?.trim();
	if (statePath && !isAbsolute(statePath)) throw new Error("JMAP_STATE_PATH must be absolute");
	return { baseUrl: baseUrl.replace(/\/+$/, ""), user, pass, ...(statePath ? { statePath } : {}) };
}

export function createJmapSource(
	cfg: JmapConfig,
	retryMs: number = RECONNECT_DELAY_MS,
): ChannelSource {
	const auth = `Basic ${Buffer.from(`${cfg.user}:${cfg.pass}`).toString("base64")}`;

	return {
		async start(onEvent) {
			let cursor = cfg.statePath ? await readEmailCursor(cfg.statePath) : undefined;
			return supervise(
				async (signal) => {
					const session = await fetchSession(cfg.baseUrl, auth, signal);
					if (cursor?.accountId !== session.accountId) cursor = undefined;
					if (session.apiUrl && !cursor) {
						const state = await currentEmailState(session, auth, signal);
						cursor = { accountId: session.accountId, state };
						if (cfg.statePath) await writeEmailCursor(cfg.statePath, session.accountId, state);
					}
					log(`watching Email state and calendar alerts for account ${session.accountId}`);
					await streamStateChanges(session, auth, signal, async (wake) => {
						if (wake.emailState && session.apiUrl && cursor) {
							const state = await reconcileEmailChanges(
								session,
								auth,
								cursor.state,
								wake.emailState,
								signal,
								onEvent,
								cfg.statePath,
							);
							cursor = { accountId: session.accountId, state };
							return;
						}
						await onEvent({ channel: "jmap", ...wake });
					});
				},
				log,
				retryMs,
			);
		},
	};
}

/** A trusted wake signal: the summary plus an optional queue-coalescing key. */
interface JmapWake extends Pick<ChannelEvent, "summary" | "dedupeKey" | "work"> {
	readonly emailState?: string;
}

/**
 * The accounts one connection accepts frames for. Calendar alerts may arrive on
 * the calendars primary account, which some servers keep distinct from mail.
 * `onUnknownAlertAccount` reports an alert dropped for an account outside the
 * set; the connection that builds this object owns the log-once state, so a
 * fresh connection always gets its own first log line.
 */
interface JmapAccounts {
	mailAccountId: string;
	alertAccountIds: ReadonlySet<string>;
	onUnknownAlertAccount(accountId: unknown): void;
}

interface JmapSession {
	accountId: string;
	alertAccountIds: ReadonlySet<string>;
	apiUrl?: string;
	/** Absolute EventSource URL for the given push `{types}` list. */
	eventSourceUrlFor: (types: string) => string;
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
		apiUrl?: string;
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

	// Alerts may be pushed on the calendars primary account, which servers can
	// keep distinct from the mail account; accept both when both are advertised.
	// Resolved like the mail account: the primary, else the accounts that
	// advertise the capability, else mail-only alerts. Unlike the mail account —
	// which names the single account whose Email state is watched — this is only a
	// membership set for the alert path, so *every* calendars-capable account is
	// admitted: shared and delegated calendars each get their own account id, and
	// any of them may carry an alarm meant for this user.
	const calendarsAccountIds = body.primaryAccounts?.[CALENDARS_CAPABILITY]
		? [body.primaryAccounts[CALENDARS_CAPABILITY]]
		: Object.keys(body.accounts ?? {}).filter(
				(id) => body.accounts?.[id]?.accountCapabilities?.[CALENDARS_CAPABILITY] != null,
			);
	const alertAccountIds = new Set([accountId, ...calendarsAccountIds]);

	// Fill the RFC 8620 template and resolve against the (post-redirect) session
	// URL, so a relative eventSourceUrl lands under the right path.
	const template = body.eventSourceUrl;
	const sessionUrl = res.url;
	const eventSourceUrlFor = (types: string) =>
		new URL(
			template.replace("{types}", types).replace("{closeafter}", "no").replace("{ping}", "30"),
			sessionUrl,
		).toString();
	const apiUrl = body.apiUrl ? new URL(body.apiUrl, sessionUrl).toString() : undefined;
	return { accountId, alertAccountIds, ...(apiUrl ? { apiUrl } : {}), eventSourceUrlFor };
}

async function streamStateChanges(
	session: JmapSession,
	auth: string,
	parentSignal: AbortSignal,
	onWake: (wake: JmapWake) => unknown,
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
		const open = (types: string) =>
			fetch(session.eventSourceUrlFor(types), {
				headers: { Authorization: auth, Accept: "text/event-stream" },
				signal: ac.signal,
			});
		let res = await open("Email,CalendarAlert");
		// Some JMAP servers reject unknown push types instead of ignoring them, so
		// the wider subscription needs a fallback — but which failures earn one
		// matters, because the downgraded stream is *long-lived* SSE. Once the
		// Email-only stream opens successfully, `Email,CalendarAlert` is not
		// re-attempted until that stream drops or goes idle past IDLE_TIMEOUT_MS,
		// which a healthy mail stream may not do for hours. A transient 429 or 503
		// treated as a downgrade would therefore silence calendar alarms for as
		// long as that stream lasts, and push is at-most-once, so every alarm in
		// that window is lost outright.
		// So downgrade only on statuses that plausibly mean "this push type is
		// unacceptable" and would mean it again on the next attempt; anything else
		// throws, and `supervise` reconnects asking for the full subscription.
		if (!res.ok && DOWNGRADE_STATUSES.has(res.status)) {
			log(`eventsource ${res.status} for Email,CalendarAlert; subscribing to Email only`);
			await res.body?.cancel().catch(() => {});
			res = await open("Email");
		}
		if (!res.ok || !res.body) {
			// Drain before throwing, mirroring the downgrade path above: a server
			// stuck on 429/5xx throws on every attempt, so an unconsumed body here
			// strands an undici socket until GC once per reconnect, forever.
			await res.body?.cancel().catch(() => {});
			throw new Error(`eventsource ${res.status}`);
		}

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		// Log-once state lives here, in the connection: the first alert dropped for
		// an unknown account is logged (naming that accountId, so the mismatch is
		// diagnosable) and later drops stay silent rather than logging per frame.
		let unknownAlertAccountLogged = false;
		const accounts: JmapAccounts = {
			mailAccountId: session.accountId,
			alertAccountIds: session.alertAccountIds,
			onUnknownAlertAccount(accountId) {
				if (unknownAlertAccountLogged) return;
				unknownAlertAccountLogged = true;
				// JSON.stringify escapes a hostile accountId's control characters,
				// and the slice bounds an overlong one.
				log(
					`dropping calendar alert for unknown account ${(JSON.stringify(accountId) ?? "undefined").slice(0, 160)}`,
				);
			},
		};
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
				buffer = await emitFrames(buffer, accounts, onWake);
			}
			// Flush a trailing complete frame the server sent right before EOF.
			buffer = (buffer + decoder.decode()).replace(/\r\n/g, "\n");
			if (buffer.trim()) await emitFrame(buffer, accounts, onWake);
		} finally {
			await reader.cancel().catch(() => {});
		}
	} finally {
		if (idle) clearTimeout(idle);
		parentSignal.removeEventListener("abort", onParentAbort);
	}
}

/** Consume every complete `\n\n`-terminated SSE frame; return the remainder. */
async function emitFrames(
	buffer: string,
	accounts: JmapAccounts,
	onWake: (wake: JmapWake) => unknown,
): Promise<string> {
	let rest = buffer;
	let sep = rest.indexOf("\n\n");
	while (sep !== -1) {
		await emitFrame(rest.slice(0, sep), accounts, onWake);
		rest = rest.slice(sep + 2);
		sep = rest.indexOf("\n\n");
	}
	return rest;
}

async function emitFrame(
	frame: string,
	accounts: JmapAccounts,
	onWake: (wake: JmapWake) => unknown,
): Promise<void> {
	// Per SSE, the last `event:` line names the frame and `data:` lines rejoin
	// with "\n".
	let event: string | undefined;
	const dataLines: string[] = [];
	for (const line of frame.split("\n")) {
		if (line.startsWith("event:")) event = line.slice(6).trim();
		else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
	}
	const data = dataLines.join("\n");
	if (!data) return;
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null) return;
	const payload = parsed as Record<string, unknown>;
	// Route on the *payload*, the way the mail path keys on `@type: StateChange`.
	// The frame name is only a hint: it is Stalwart's, not RFC 8620's, so a
	// server that names the frame differently must still wake the agent.
	if (isCalendarAlert(payload, event)) {
		const wake = calendarAlertWake(payload, accounts);
		if (wake) await onWake(wake);
		return;
	}
	const wake = mailStateChangeWake(payload, accounts.mailAccountId);
	if (wake) await onWake(wake);
}

/**
 * A frame is a calendar alert when its payload says so. An explicit `@type` is
 * authoritative in both directions (a `StateChange` is never an alert, whatever
 * the frame is named); failing that, the `calendarAlert` frame name is accepted
 * as a fast path; failing that, the payload is matched structurally — an alert
 * carries a string `accountId` and `uid` and, unlike a StateChange, no
 * `changed` member.
 */
function isCalendarAlert(payload: Record<string, unknown>, event: string | undefined): boolean {
	const type = payload["@type"];
	if (typeof type === "string") return type === "CalendarAlert";
	if (event === "calendarAlert") return true;
	return (
		typeof payload.accountId === "string" &&
		typeof payload.uid === "string" &&
		!("changed" in payload)
	);
}

function calendarAlertWake(
	payload: Record<string, unknown>,
	accounts: JmapAccounts,
): JmapWake | undefined {
	// Stalwart's PushObject::CalendarAlert serializes these exact camelCase
	// names, captured from a live 0.15.5 server: accountId, calendarEventId,
	// uid, alertId, and recurrenceId — the last is `null`, not absent, when the
	// event does not recur. All but the matching account are optional here so
	// partial/future payloads stay safe.
	const { accountId, uid, recurrenceId } = payload;
	if (typeof accountId !== "string" || !accounts.alertAccountIds.has(accountId)) {
		accounts.onUnknownAlertAccount(accountId);
		return undefined;
	}
	// A hostile or malformed uid (embedded newlines, overlong, non-string)
	// must not reach the trusted wake summary — only the conservative charset
	// passes; everything else gets the generic form.
	if (typeof uid !== "string" || !CALENDAR_ALERT_UID_PATTERN.test(uid)) {
		return calendarWork(payload, accountId, "calendar alert", "calendar-alert");
	}
	// A recurring event can have two occurrences pending in one wake window;
	// keying on the occurrence keeps them distinct. recurrenceId is
	// server-supplied text, so it passes the same conservative charset gate
	// as the uid or is left out of the key.
	const recurrence =
		typeof recurrenceId === "string" && CALENDAR_ALERT_UID_PATTERN.test(recurrenceId)
			? recurrenceId
			: undefined;
	// The occurrence belongs in the summary too, not only the key: the wake prompt
	// renders one line per *distinct summary*, so two occurrences of one uid that
	// share a summary would collapse to a single line — spending two of the wake's
	// bounded entries to say one thing, and pushing another channel's signal out.
	const summary = recurrence ? `calendar alert: ${uid} (${recurrence})` : `calendar alert: ${uid}`;
	const dedupeKey = recurrence ? `calendar-alert:${uid}#${recurrence}` : `calendar-alert:${uid}`;
	return calendarWork(payload, accountId, summary, dedupeKey, uid);
}

function mailStateChangeWake(
	payload: Record<string, unknown>,
	accountId: string,
): JmapWake | undefined {
	if (payload["@type"] !== "StateChange") return undefined;
	const changed = payload.changed as Record<string, Record<string, string>> | undefined;
	const state = changed?.[accountId]?.Email;
	if (typeof state !== "string" || state.length === 0 || state.length > 512) return undefined;
	const id = digest(`${accountId}\0${state}`);
	return {
		summary: "new mail",
		emailState: state,
		work: {
			providerEventId: `jmap-email:${id}`,
			nativeLocator: { accountId, emailState: state },
			receivedAt: new Date().toISOString(),
			dedupeKey: `jmap-email:${id}`,
			sourceSummary: "new mail",
			parts: [{ data: { channel: "jmap", accountId, emailState: state } }],
		},
	};
}

function calendarWork(
	payload: Record<string, unknown>,
	accountId: string,
	summary: string,
	dedupeKey: string,
	uid?: string,
): JmapWake {
	const id = digest(JSON.stringify(payload));
	const calendarEventId = structuralField(payload.calendarEventId);
	const recurrenceId = structuralField(payload.recurrenceId);
	const alertId = structuralField(payload.alertId);
	return {
		summary,
		dedupeKey,
		work: {
			providerEventId: `jmap-calendar:${id}`,
			nativeLocator: {
				accountId,
				eventDigest: id,
				...(calendarEventId ? { calendarEventId } : {}),
				...(uid ? { uid } : {}),
				...(recurrenceId ? { recurrenceId } : {}),
				...(alertId ? { alertId } : {}),
			},
			receivedAt: new Date().toISOString(),
			dedupeKey: `jmap-calendar:${id}`,
			sourceSummary: summary,
			parts: [
				{
					data: {
						channel: "jmap",
						kind: "calendar-alert",
						accountId,
						eventDigest: id,
						...(calendarEventId ? { calendarEventId } : {}),
						...(uid ? { uid } : {}),
						...(recurrenceId ? { recurrenceId } : {}),
						...(alertId ? { alertId } : {}),
					},
				},
			],
		},
	};
}

function structuralField(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 && value.length <= 1_024 ? value : undefined;
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 48);
}

interface EmailCursor {
	readonly accountId: string;
	readonly state: string;
}

interface JmapEmail {
	readonly id: string;
	readonly threadId?: string;
	readonly receivedAt?: string;
}

async function currentEmailState(
	session: JmapSession,
	auth: string,
	signal: AbortSignal,
): Promise<string> {
	const result = await jmapMethod(session, auth, signal, "Email/get", {
		accountId: session.accountId,
		ids: [],
		properties: ["id"],
	});
	const state = result.state;
	if (typeof state !== "string" || state.length === 0) {
		throw new Error("Email/get returned no state");
	}
	return state;
}

async function reconcileEmailChanges(
	session: JmapSession,
	auth: string,
	sinceState: string,
	targetState: string,
	signal: AbortSignal,
	onEvent: (event: ChannelEvent) => unknown,
	statePath: string | undefined,
): Promise<string> {
	let cursor = sinceState;
	while (cursor !== targetState) {
		const changes = await jmapMethod(session, auth, signal, "Email/changes", {
			accountId: session.accountId,
			sinceState: cursor,
			maxChanges: 256,
		});
		if (!Array.isArray(changes.created) || typeof changes.newState !== "string") {
			throw new Error("Email/changes returned an invalid result");
		}
		const ids = changes.created.filter((id): id is string => typeof id === "string");
		if (ids.length > 0) await emitExactEmails(session, auth, signal, ids, onEvent);
		cursor = changes.newState;
		if (statePath) await writeEmailCursor(statePath, session.accountId, cursor);
		if (changes.hasMoreChanges !== true) break;
	}
	return cursor;
}

async function emitExactEmails(
	session: JmapSession,
	auth: string,
	signal: AbortSignal,
	ids: readonly string[],
	onEvent: (event: ChannelEvent) => unknown,
): Promise<void> {
	const fetched = await jmapMethod(session, auth, signal, "Email/get", {
		accountId: session.accountId,
		ids,
		properties: ["id", "threadId", "receivedAt"],
	});
	if (!Array.isArray(fetched.list)) throw new Error("Email/get returned an invalid list");
	for (const value of fetched.list) {
		const email = validateJmapEmail(value);
		if ((await onEvent(exactEmailEvent(session.accountId, email))) === false) {
			throw new Error("the A2A source router rejected an exact email activation");
		}
	}
}

function exactEmailEvent(accountId: string, email: JmapEmail): ChannelEvent {
	const id = digest(`${accountId}\0${email.id}`);
	const receivedAt =
		email.receivedAt && Number.isFinite(Date.parse(email.receivedAt))
			? new Date(email.receivedAt).toISOString()
			: new Date().toISOString();
	return {
		channel: "jmap",
		summary: "new mail",
		dedupeKey: `jmap-email:${id}`,
		work: {
			providerEventId: `jmap-email:${id}`,
			nativeLocator: {
				accountId,
				emailId: email.id,
				...(email.threadId ? { threadId: email.threadId } : {}),
			},
			receivedAt,
			dedupeKey: `jmap-email:${id}`,
			...(email.threadId
				? { correlationKey: `jmap-email-thread:${digest(`${accountId}\0${email.threadId}`)}` }
				: {}),
			sourceSummary: "new mail",
			parts: [{ data: { channel: "jmap", accountId, emailId: email.id } }],
		},
	};
}

function validateJmapEmail(value: unknown): JmapEmail {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Email/get returned an invalid email");
	}
	const email = value as Record<string, unknown>;
	if (typeof email.id !== "string" || email.id.length === 0 || email.id.length > 1_024) {
		throw new Error("Email/get returned an invalid email id");
	}
	return {
		id: email.id,
		...(typeof email.threadId === "string" && email.threadId.length <= 1_024
			? { threadId: email.threadId }
			: {}),
		...(typeof email.receivedAt === "string" ? { receivedAt: email.receivedAt } : {}),
	};
}

async function jmapMethod(
	session: JmapSession,
	auth: string,
	signal: AbortSignal,
	name: "Email/get" | "Email/changes",
	arguments_: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	if (!session.apiUrl) throw new Error("JMAP session has no apiUrl");
	const response = await fetch(session.apiUrl, {
		method: "POST",
		headers: {
			Authorization: auth,
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			using: [CORE_CAPABILITY, MAIL_CAPABILITY],
			methodCalls: [[name, arguments_, "c0"]],
		}),
		signal,
	});
	if (!response.ok) throw new Error(`JMAP API returned HTTP ${response.status}`);
	const body = (await response.json()) as { methodResponses?: unknown[] };
	const method = body.methodResponses?.[0];
	if (!Array.isArray(method) || method[0] !== name || method[2] !== "c0") {
		throw new Error(`JMAP API returned no ${name} response`);
	}
	if (!method[1] || typeof method[1] !== "object" || Array.isArray(method[1])) {
		throw new Error(`JMAP API returned an invalid ${name} response`);
	}
	return method[1] as Record<string, unknown>;
}

async function readEmailCursor(path: string): Promise<EmailCursor | undefined> {
	try {
		const value = JSON.parse(await readFile(path, "utf8")) as Partial<EmailCursor> & {
			version?: number;
		};
		if (
			value.version !== 1 ||
			typeof value.accountId !== "string" ||
			typeof value.state !== "string"
		) {
			throw new Error("JMAP email cursor is invalid");
		}
		return { accountId: value.accountId, state: value.state };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

async function writeEmailCursor(path: string, accountId: string, state: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.${digest(`${accountId}\0${state}`)}.tmp`;
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		handle = await open(temporary, "w", 0o600);
		await handle.writeFile(`${JSON.stringify({ version: 1, accountId, state })}\n`, "utf8");
		await handle.sync();
		await handle.close();
		handle = undefined;
		await rename(temporary, path);
	} finally {
		await handle?.close().catch(() => {});
		await unlink(temporary).catch(() => {});
	}
}
