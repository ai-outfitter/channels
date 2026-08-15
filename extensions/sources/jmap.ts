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

import { contentDigest, sourceIdentifier } from "../task-plane/source-activation.ts";
import type { SourceTaskActivationSink } from "../task-plane/types.ts";
import type { ChannelEvent, ChannelSource } from "./types.ts";
import { errorMessage, RECONNECT_DELAY_MS, scopedLog, supervise } from "./util.ts";

const log = scopedLog("jmap");

/** The account has ~30s ping; treat a stream silent for this long as dead. */
const IDLE_TIMEOUT_MS = 90_000;
const MAIL_CAPABILITY = "urn:ietf:params:jmap:mail";
const CALENDARS_CAPABILITY = "urn:ietf:params:jmap:calendars";
const CORE_CAPABILITY = "urn:ietf:params:jmap:core";
const RESYNC_QUERY_LIMIT = 100;
const DEFAULT_MAX_OBJECTS_IN_GET = 256;
const RECONCILE_ATTEMPTS = 3;
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
}

/** Build config from the mail skill's XIN_* env, or undefined if unset. */
export function jmapConfigFromEnv(): JmapConfig | undefined {
	const baseUrl = process.env.XIN_BASE_URL;
	const user = process.env.XIN_BASIC_USER;
	const pass = process.env.XIN_BASIC_PASS;
	if (!baseUrl || !user || !pass) return undefined;
	return { baseUrl: baseUrl.replace(/\/+$/, ""), user, pass };
}

export function createJmapSource(
	cfg: JmapConfig,
	retryMs: number | undefined,
	taskSink: SourceTaskActivationSink,
): ChannelSource {
	retryMs ??= RECONNECT_DELAY_MS;
	const auth = `Basic ${Buffer.from(`${cfg.user}:${cfg.pass}`).toString("base64")}`;

	return {
		async start() {
			return supervise(
				async (signal) => {
					const session = await fetchSession(cfg.baseUrl, auth, signal);
					log(`watching Email state and calendar alerts for account ${session.accountId}`);
					const principal = sourceIdentifier("jmap", `${cfg.baseUrl}\0${cfg.user}`);
					let changes = Promise.resolve();
					const reconcile = (): void => {
						changes = changes
							.then(() =>
								reconcileEmailsWithRetry(session, auth, principal, taskSink, signal, retryMs),
							)
							.catch((error) => log(`email reconcile failed: ${errorMessage(error)}`));
					};
					reconcile();
					await streamStateChanges(
						session,
						auth,
						signal,
						(wake) => acceptJmapSignal(taskSink, principal, { channel: "jmap", ...wake }),
						reconcile,
					);
					await changes;
				},
				log,
				retryMs,
			);
		},
	};
}

async function acceptJmapSignal(
	taskSink: SourceTaskActivationSink,
	principal: string,
	wake: ChannelEvent,
): Promise<void> {
	const identity = wake.dedupeKey ?? wake.summary;
	await taskSink.accept({
		principal,
		source: "jmap-calendar",
		providerEventId: sourceIdentifier("event", identity),
		providerDedupeKey: sourceIdentifier("event", identity),
		nativeLocator: { signal: identity },
		receivedAt: new Date().toISOString(),
		parts: [
			{ data: { summary: wake.summary, ...(wake.dedupeKey ? { dedupeKey: wake.dedupeKey } : {}) } },
		],
		contentDigest: contentDigest(wake),
	});
}

/** A trusted wake signal: the summary plus an optional queue-coalescing key. */
type JmapWake = Pick<ChannelEvent, "summary" | "dedupeKey">;

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
	apiUrl?: string;
	alertAccountIds: ReadonlySet<string>;
	maxObjectsInGet: number;
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
		eventSourceUrl?: string;
		primaryAccounts?: Record<string, string>;
		accounts?: Record<string, { accountCapabilities?: Record<string, unknown> }>;
		capabilities?: Record<string, { maxObjectsInGet?: unknown }>;
		apiUrl?: string;
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
	const advertisedMax = body.capabilities?.[CORE_CAPABILITY]?.maxObjectsInGet;
	const maxObjectsInGet =
		typeof advertisedMax === "number" && Number.isSafeInteger(advertisedMax) && advertisedMax > 0
			? advertisedMax
			: DEFAULT_MAX_OBJECTS_IN_GET;

	// Fill the RFC 8620 template and resolve against the (post-redirect) session
	// URL, so a relative eventSourceUrl lands under the right path.
	const template = body.eventSourceUrl;
	const sessionUrl = res.url;
	const eventSourceUrlFor = (types: string) =>
		new URL(
			template.replace("{types}", types).replace("{closeafter}", "no").replace("{ping}", "30"),
			sessionUrl,
		).toString();
	return {
		accountId,
		...(body.apiUrl ? { apiUrl: new URL(body.apiUrl, sessionUrl).toString() } : {}),
		alertAccountIds,
		maxObjectsInGet,
		eventSourceUrlFor,
	};
}

async function reconcileEmailsWithRetry(
	session: JmapSession,
	auth: string,
	principal: string,
	taskSink: SourceTaskActivationSink,
	signal: AbortSignal,
	retryMs: number,
): Promise<void> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= RECONCILE_ATTEMPTS; attempt += 1) {
		try {
			await reconcileEmails(session, auth, principal, taskSink, signal);
			return;
		} catch (error) {
			if (signal.aborted) return;
			lastError = error;
			if (attempt === RECONCILE_ATTEMPTS) break;
			log(`email reconcile attempt ${attempt} failed: ${errorMessage(error)}; retrying`);
			await abortableDelay(retryMs * 2 ** (attempt - 1), signal);
		}
	}
	throw lastError;
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return;
	await new Promise<void>((resolve) => {
		const timer = setTimeout(done, ms);
		function done(): void {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		}
		signal.addEventListener("abort", done, { once: true });
	});
}

async function streamStateChanges(
	session: JmapSession,
	auth: string,
	parentSignal: AbortSignal,
	onWake: (wake: JmapWake) => void | Promise<void>,
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
				buffer = await emitFrames(buffer, accounts, onWake, onMailChange);
			}
			// Flush a trailing complete frame the server sent right before EOF.
			buffer = (buffer + decoder.decode()).replace(/\r\n/g, "\n");
			if (buffer.trim()) await emitFrame(buffer, accounts, onWake, onMailChange);
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
	onWake: (wake: JmapWake) => void | Promise<void>,
	onMailChange: () => void,
): Promise<string> {
	let rest = buffer;
	let sep = rest.indexOf("\n\n");
	while (sep !== -1) {
		await emitFrame(rest.slice(0, sep), accounts, onWake, onMailChange);
		rest = rest.slice(sep + 2);
		sep = rest.indexOf("\n\n");
	}
	return rest;
}

async function emitFrame(
	frame: string,
	accounts: JmapAccounts,
	onWake: (wake: JmapWake) => void | Promise<void>,
	onMailChange: () => void,
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
	if (isMailStateChange(payload, accounts.mailAccountId)) onMailChange();
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
		const occurrence = `${String(uid)}\0${String(recurrenceId)}`;
		return {
			summary: "calendar alert",
			dedupeKey: sourceIdentifier("calendar-alert", occurrence),
		};
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
	return {
		summary: recurrence ? `calendar alert: ${uid} (${recurrence})` : `calendar alert: ${uid}`,
		dedupeKey: recurrence ? `calendar-alert:${uid}#${recurrence}` : `calendar-alert:${uid}`,
	};
}

/** A StateChange whose `changed[account]` includes the Email type means new/changed mail. */
function isMailStateChange(payload: Record<string, unknown>, accountId: string): boolean {
	if (payload["@type"] !== "StateChange") return false;
	const changed = payload.changed as Record<string, Record<string, string>> | undefined;
	return changed?.[accountId]?.Email != null;
}

interface JmapEmailCheckpoint {
	readonly state: string;
}

interface ChangedEmail {
	readonly id: string;
	readonly threadId: string;
	readonly mailboxIds?: Readonly<Record<string, boolean>>;
}

async function reconcileEmails(
	session: JmapSession,
	auth: string,
	principal: string,
	taskSink: SourceTaskActivationSink,
	signal: AbortSignal,
): Promise<void> {
	if (!taskSink.checkpoint || !taskSink.advanceCheckpoint) {
		throw new Error("JMAP task routing requires durable checkpoint services");
	}
	const checkpoint = await taskSink.checkpoint<JmapEmailCheckpoint>(principal, "jmap");
	if (!checkpoint) {
		const state = await currentEmailState(session, auth, signal);
		await taskSink.advanceCheckpoint(principal, "jmap", { state });
		return;
	}
	let sinceState = checkpoint.state;
	const inboxId = await inboxMailboxId(session, auth, signal);
	for (;;) {
		let changes: {
			oldState: string;
			newState: string;
			hasMoreChanges?: boolean;
			created?: string[];
			updated?: string[];
		};
		try {
			changes = await jmapCall(session, auth, signal, "Email/changes", {
				accountId: session.accountId,
				sinceState,
			});
		} catch (error) {
			if (!(error instanceof JmapMethodError) || error.type !== "cannotCalculateChanges")
				throw error;
			await resynchronizeInbox(session, auth, principal, taskSink, signal, inboxId, sinceState);
			return;
		}
		const ids = [...new Set([...(changes.created ?? []), ...(changes.updated ?? [])])];
		await acceptInboxEmails(session, auth, principal, taskSink, signal, inboxId, ids);
		await taskSink.advanceCheckpoint(principal, "jmap", { state: changes.newState });
		sinceState = changes.newState;
		if (!changes.hasMoreChanges) return;
	}
}

async function resynchronizeInbox(
	session: JmapSession,
	auth: string,
	principal: string,
	taskSink: SourceTaskActivationSink,
	signal: AbortSignal,
	inboxId: string,
	staleState: string,
): Promise<void> {
	const state = await currentEmailState(session, auth, signal);
	const query = await jmapCall<{ ids?: string[] }>(session, auth, signal, "Email/query", {
		accountId: session.accountId,
		filter: { inMailbox: inboxId },
		limit: RESYNC_QUERY_LIMIT,
	});
	const ids = [...new Set(query.ids ?? [])];
	const accepted = await acceptInboxEmails(
		session,
		auth,
		principal,
		taskSink,
		signal,
		inboxId,
		ids,
	);
	await taskSink.recordEvidence?.({
		evidenceId: sourceIdentifier("evidence", `${principal}\0${staleState}\0${state}`),
		source: "jmap",
		kind: "checkpoint-resync",
		detail: {
			accountId: session.accountId,
			staleState,
			currentState: state,
			queried: String(ids.length),
			accepted: String(accepted),
		},
	});
	await taskSink.advanceCheckpoint?.(principal, "jmap", { state });
	log(`resynchronized Email checkpoint and reconciled ${ids.length} bounded INBOX item(s)`);
}

async function acceptInboxEmails(
	session: JmapSession,
	auth: string,
	principal: string,
	taskSink: SourceTaskActivationSink,
	signal: AbortSignal,
	inboxId: string,
	ids: readonly string[],
): Promise<number> {
	if (ids.length === 0) return 0;
	let accepted = 0;
	for (let offset = 0; offset < ids.length; offset += session.maxObjectsInGet) {
		const chunk = ids.slice(offset, offset + session.maxObjectsInGet);
		const result = await jmapCall<{ list?: ChangedEmail[] }>(session, auth, signal, "Email/get", {
			accountId: session.accountId,
			ids: chunk,
			properties: ["id", "threadId", "mailboxIds"],
		});
		for (const email of result.list ?? []) {
			if (!email.mailboxIds?.[inboxId]) continue;
			const eventKey = `${session.accountId}\0${email.id}`;
			await taskSink.accept({
				principal,
				source: "jmap",
				providerEventId: sourceIdentifier("event", eventKey),
				providerDedupeKey: sourceIdentifier("event", eventKey),
				nativeLocator: {
					accountId: session.accountId,
					emailId: email.id,
					threadId: email.threadId,
				},
				receivedAt: new Date().toISOString(),
				conversationKey: sourceIdentifier("conversation", email.threadId),
				parts: [{ data: { accountId: session.accountId, emailId: email.id } }],
				contentDigest: contentDigest({
					accountId: session.accountId,
					emailId: email.id,
					threadId: email.threadId,
				}),
			});
			accepted += 1;
		}
	}
	return accepted;
}

async function inboxMailboxId(
	session: JmapSession,
	auth: string,
	signal: AbortSignal,
): Promise<string> {
	const result = await jmapCall<{ list?: Array<{ id: string; role?: string }> }>(
		session,
		auth,
		signal,
		"Mailbox/get",
		{ accountId: session.accountId, properties: ["id", "role"] },
	);
	const inbox = result.list?.find((mailbox) => mailbox.role === "inbox")?.id;
	if (!inbox) throw new Error("Mailbox/get returned no inbox mailbox");
	return inbox;
}

async function currentEmailState(
	session: JmapSession,
	auth: string,
	signal: AbortSignal,
): Promise<string> {
	const result = await jmapCall<{ state?: string }>(session, auth, signal, "Email/get", {
		accountId: session.accountId,
		ids: [],
		properties: ["id"],
	});
	if (!result.state) throw new Error("Email/get returned no state");
	return result.state;
}

async function jmapCall<T>(
	session: JmapSession,
	auth: string,
	signal: AbortSignal,
	method: string,
	arguments_: Record<string, unknown>,
): Promise<T> {
	if (!session.apiUrl) throw new Error("session has no apiUrl for durable Email/changes intake");
	const apiUrl = session.apiUrl.replace("{accountId}", encodeURIComponent(session.accountId));
	const response = await fetch(apiUrl, {
		method: "POST",
		headers: {
			Authorization: auth,
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify({ using: [MAIL_CAPABILITY], methodCalls: [[method, arguments_, "c1"]] }),
		signal,
	});
	if (!response.ok) throw new Error(`${method} request failed ${response.status}`);
	const body = (await response.json()) as { methodResponses?: [string, unknown, string][] };
	const tuple = body.methodResponses?.[0];
	if (!tuple || tuple[0] !== method) {
		const detail = tuple?.[1] as { type?: string; description?: string } | undefined;
		throw new JmapMethodError(method, detail?.type ?? "invalidResponse", detail?.description);
	}
	return tuple[1] as T;
}

class JmapMethodError extends Error {
	readonly type: string;

	constructor(method: string, type: string, description?: string) {
		super(`${method} failed: ${description ?? type}`);
		this.type = type;
	}
}
