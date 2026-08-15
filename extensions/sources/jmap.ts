/**
 * JMAP push (EventSource / SSE) channel source.
 *
 * Consumes JMAP `StateChange` **pings** for the account's `Email` type and
 * `CalendarAlert` pushes when calendar alarms fire. It never reads message or
 * event bodies during intake. Exact-item channel actions fetch only the located
 * email and can reply through JMAP. Reuses the mail skill's existing `XIN_*`
 * credentials.
 *
 * Tested shape: Stalwart's JMAP EventSource (RFC 8620 §7.3).
 */

import { derivedId } from "../task-plane/serialize.ts";
import { contentDigest, sourceIdentifier } from "../task-plane/source-activation.ts";
import type { SourceTaskActivationSink } from "../task-plane/types.ts";
import type {
	ChannelActions,
	ChannelEvent,
	ChannelReadResult,
	ChannelRespondResult,
	ChannelSource,
} from "./types.ts";
import { errorMessage, RECONNECT_DELAY_MS, scopedLog, supervise } from "./util.ts";

const log = scopedLog("jmap");

/** The account has ~30s ping; treat a stream silent for this long as dead. */
const IDLE_TIMEOUT_MS = 90_000;
const MAIL_CAPABILITY = "urn:ietf:params:jmap:mail";
const SUBMISSION_CAPABILITY = "urn:ietf:params:jmap:submission";
const CALENDARS_CAPABILITY = "urn:ietf:params:jmap:calendars";
const CORE_CAPABILITY = "urn:ietf:params:jmap:core";
const RESYNC_QUERY_LIMIT = 100;
const DEFAULT_MAX_OBJECTS_IN_GET = 256;
const RECONCILE_ATTEMPTS = 3;
const MAX_LOCATOR_BYTES = 1024;
const MAX_EMAIL_BODY_BYTES = 64_000;
const MAX_EMAIL_BODY_CHARS = 40_000;
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

export interface JmapLocator {
	accountId: string;
	emailId: string;
	threadId?: string;
}

interface JmapAddress {
	email: string;
	name?: string;
}

export interface JmapEmail {
	id: string;
	threadId?: string;
	subject?: string;
	from?: JmapAddress[];
	replyTo?: JmapAddress[];
	to?: JmapAddress[];
	receivedAt?: string;
	sentAt?: string;
	messageId?: string[];
	references?: string[];
	textBody?: Array<{ partId?: string }>;
	bodyValues?: Record<string, { value?: string }>;
}

export interface JmapApi {
	getEmail(locator: JmapLocator): Promise<JmapEmail | undefined>;
	sendReply(
		locator: JmapLocator,
		original: JmapEmail,
		text: string,
		deliveryId: string,
	): Promise<string>;
	findReply(locator: JmapLocator, deliveryId: string): Promise<string | undefined>;
}

/** Build config from the mail skill's XIN_* env, or undefined if unset. */
export function jmapConfigFromEnv(): JmapConfig | undefined {
	const baseUrl = process.env.XIN_BASE_URL;
	const user = process.env.XIN_BASIC_USER;
	const pass = process.env.XIN_BASIC_PASS;
	if (!baseUrl || !user || !pass) return undefined;
	return { baseUrl: baseUrl.replace(/\/+$/, ""), user, pass };
}

/** Exact-item mail actions. No operation in this adapter queries the inbox. */
export function createJmapActions(
	cfg: JmapConfig,
	api: JmapApi | undefined,
	taskSink: SourceTaskActivationSink,
): ChannelActions {
	api ??= createHttpJmapApi(cfg);
	return {
		async read(locator): Promise<ChannelReadResult> {
			const decoded = decodeJmapLocator(locator);
			const email = await api.getEmail(decoded);
			if (!email || email.id !== decoded.emailId) {
				throw new Error("JMAP did not return the located email");
			}
			const taskId = taskSink.taskForLocator
				? await taskSink.taskForLocator("jmap", locator)
				: undefined;
			const handled =
				taskId && taskSink.taskIsTerminal ? await taskSink.taskIsTerminal(taskId) : false;
			return {
				channel: "jmap",
				locator,
				handled,
				messages: [
					{
						id: email.id,
						author: formatAddresses(email.from),
						text: formatEmail(email),
						target: true,
					},
				],
			};
		},

		async respond(locator, response): Promise<ChannelRespondResult> {
			const decoded = decodeJmapLocator(locator);
			if (!taskSink.taskForLocator || !taskSink.deliver) {
				throw new Error("JMAP task delivery is not configured");
			}
			const activeTaskId = await taskSink.taskForLocator("jmap", locator);
			const deliveryInput = {
				taskId: activeTaskId,
				source: "jmap",
				operationId: `reply:${locator}`,
				payloadDigest: contentDigest(response),
				recovery: "lookup" as const,
			};
			const deliveryId = derivedId(
				"delivery",
				`${deliveryInput.taskId}\0${deliveryInput.source}\0${deliveryInput.operationId}\0${deliveryInput.payloadDigest}`,
			);
			const responseId = await taskSink.deliver(
				deliveryInput,
				async () => {
					const original = await api.getEmail(decoded);
					if (!original || original.id !== decoded.emailId) {
						throw new Error("JMAP did not return the located email");
					}
					return api.sendReply(decoded, original, response, deliveryId);
				},
				() => api.findReply(decoded, deliveryId),
			);
			if (!responseId) throw new Error("JMAP reply delivery returned no response id");
			return {
				channel: "jmap",
				locator,
				replied: true,
				handled: true,
				responseId,
			};
		},
	};
}

export function encodeJmapLocator(locator: JmapLocator): string {
	assertLocatorField(locator.accountId);
	assertLocatorField(locator.emailId);
	if (locator.threadId !== undefined) assertLocatorField(locator.threadId);
	const payload = {
		a: locator.accountId,
		e: locator.emailId,
		...(locator.threadId ? { t: locator.threadId } : {}),
	};
	return `jmap:v1:${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

export function decodeJmapLocator(locator: string): JmapLocator {
	const [channel, version, encoded, extra] = locator.split(":");
	if (
		channel !== "jmap" ||
		version !== "v1" ||
		extra !== undefined ||
		!encoded ||
		encoded.length > MAX_LOCATOR_BYTES ||
		!/^[A-Za-z0-9_-]+$/.test(encoded)
	) {
		throw new Error("invalid JMAP channel locator");
	}
	let payload: unknown;
	try {
		const bytes = Buffer.from(encoded, "base64url");
		if (bytes.toString("base64url") !== encoded) throw new Error("non-canonical locator");
		payload = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error("invalid JMAP channel locator");
	}
	if (!isRecord(payload)) throw new Error("invalid JMAP channel locator");
	const accountId = payload.a;
	const emailId = payload.e;
	const threadId = payload.t;
	try {
		assertLocatorField(accountId);
		assertLocatorField(emailId);
		if (threadId !== undefined) assertLocatorField(threadId);
	} catch {
		throw new Error("invalid JMAP channel locator");
	}
	return {
		accountId,
		emailId,
		...(threadId ? { threadId } : {}),
	};
}

function assertLocatorField(value: unknown): asserts value is string {
	if (typeof value !== "string" || value.length === 0 || value.length > 512) {
		throw new Error("invalid JMAP channel locator");
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatAddresses(addresses: readonly JmapAddress[] | undefined): string {
	if (!addresses?.length) return "unknown sender";
	return addresses.map(({ name, email }) => (name ? `${name} <${email}>` : email)).join(", ");
}

function formatEmail(email: JmapEmail): string {
	const body = (email.textBody ?? [])
		.map((part) => (part.partId ? email.bodyValues?.[part.partId]?.value : undefined))
		.filter((value): value is string => typeof value === "string")
		.join("\n")
		.slice(0, MAX_EMAIL_BODY_CHARS);
	return [
		`Subject: ${email.subject ?? ""}`,
		`From: ${formatAddresses(email.from)}`,
		`To: ${formatAddresses(email.to)}`,
		`Date: ${email.receivedAt ?? email.sentAt ?? ""}`,
		"",
		body,
	].join("\n");
}

function createHttpJmapApi(cfg: JmapConfig): JmapApi {
	const auth = `Basic ${Buffer.from(`${cfg.user}:${cfg.pass}`).toString("base64")}`;
	let sessionPromise: Promise<JmapSession> | undefined;
	const session = (): Promise<JmapSession> => {
		sessionPromise ??= fetchSession(cfg.baseUrl, auth, new AbortController().signal).catch(
			(error) => {
				sessionPromise = undefined;
				throw error;
			},
		);
		return sessionPromise;
	};
	const locatedSession = async (locator: JmapLocator): Promise<JmapSession> => {
		const current = await session();
		if (current.accountId !== locator.accountId) {
			throw new Error("JMAP channel locator is outside the configured mail account");
		}
		return current;
	};

	return {
		async getEmail(locator) {
			const current = await locatedSession(locator);
			const result = await jmapCall<{ list?: JmapEmail[] }>(
				current,
				auth,
				new AbortController().signal,
				"Email/get",
				{
					accountId: locator.accountId,
					ids: [locator.emailId],
					properties: [
						"id",
						"threadId",
						"subject",
						"from",
						"replyTo",
						"to",
						"receivedAt",
						"sentAt",
						"messageId",
						"references",
						"textBody",
						"bodyValues",
					],
					fetchTextBodyValues: true,
					maxBodyValueBytes: MAX_EMAIL_BODY_BYTES,
				},
			);
			return result.list?.find((email) => email.id === locator.emailId);
		},

		async sendReply(locator, original, text, deliveryId) {
			const current = await locatedSession(locator);
			const emailCreationId = derivedId("email", deliveryId);
			const submissionCreationId = derivedId("submission", deliveryId);
			const [identity, mailboxes, matchingDrafts] = await Promise.all([
				jmapCall<{ list?: Array<{ id: string; email: string; name?: string }> }>(
					current,
					auth,
					new AbortController().signal,
					"Identity/get",
					{ accountId: locator.accountId, properties: ["id", "email", "name"] },
				),
				jmapCall<{ list?: Array<{ id: string; role?: string }> }>(
					current,
					auth,
					new AbortController().signal,
					"Mailbox/get",
					{ accountId: locator.accountId, properties: ["id", "role"] },
				),
				jmapCall<{ ids?: string[] }>(current, auth, new AbortController().signal, "Email/query", {
					accountId: locator.accountId,
					filter: {
						header: ["X-AI-Outfitter-Delivery-ID", deliveryId],
						hasKeyword: "$draft",
					},
					limit: 2,
				}),
			]);
			if ((matchingDrafts.ids?.length ?? 0) > 1) {
				throw new Error("JMAP delivery lookup returned multiple drafts");
			}
			const existingDraftId = matchingDrafts.ids?.[0];
			const { reply, submission, update } = prepareReply(
				identity.list,
				mailboxes.list,
				original,
				text,
				deliveryId,
				emailCreationId,
			);
			if (existingDraftId) submission.emailId = existingDraftId;
			const responses = await jmapCalls(current, auth, [
				...(existingDraftId
					? []
					: ([
							[
								"Email/set",
								{ accountId: locator.accountId, create: { [emailCreationId]: reply } },
								"email",
							],
						] as JmapMethodCall[])),
				[
					"EmailSubmission/set",
					{
						accountId: locator.accountId,
						create: { [submissionCreationId]: submission },
						onSuccessUpdateEmail: { [`#${submissionCreationId}`]: update },
					},
					"submission",
				],
			]);
			const submissionResult = methodResult<{ created?: Record<string, { id?: string }> }>(
				responses,
				"EmailSubmission/set",
				"submission",
			);
			const submissionId = submissionResult.created?.[submissionCreationId]?.id;
			if (!submissionId) throw new Error("EmailSubmission/set returned no submission id");
			if (existingDraftId) return existingDraftId;
			const emailResult = methodResult<{ created?: Record<string, { id?: string }> }>(
				responses,
				"Email/set",
				"email",
			);
			const emailId = emailResult.created?.[emailCreationId]?.id;
			if (!emailId) throw new Error("Email/set returned no email id");
			return emailId;
		},

		async findReply(locator, deliveryId) {
			const current = await locatedSession(locator);
			const result = await jmapCall<{ ids?: string[] }>(
				current,
				auth,
				new AbortController().signal,
				"Email/query",
				{
					accountId: locator.accountId,
					filter: {
						header: ["X-AI-Outfitter-Delivery-ID", deliveryId],
						notKeyword: "$draft",
					},
					limit: 2,
				},
			);
			if ((result.ids?.length ?? 0) > 1) {
				throw new Error("JMAP delivery lookup returned multiple emails");
			}
			return result.ids?.[0];
		},
	};
}

function selectReplyIdentity(
	identities: Array<{ id: string; email: string; name?: string }> | undefined,
	recipients: readonly JmapAddress[] | undefined,
): { id: string; email: string; name?: string } | undefined {
	return (
		identities?.find((identity) =>
			recipients?.some(
				(recipient) => recipient.email.toLowerCase() === identity.email.toLowerCase(),
			),
		) ?? identities?.[0]
	);
}

function prepareReply(
	identities: Array<{ id: string; email: string; name?: string }> | undefined,
	mailboxes: Array<{ id: string; role?: string }> | undefined,
	original: JmapEmail,
	text: string,
	deliveryId: string,
	emailCreationId: string,
): {
	reply: Record<string, unknown>;
	submission: Record<string, unknown>;
	update: Record<string, unknown>;
} {
	const replyIdentity = selectReplyIdentity(identities, original.to);
	const recipient = original.replyTo?.[0] ?? original.from?.[0];
	if (!replyIdentity) throw new Error("Identity/get returned no sending identity");
	if (!recipient?.email) throw new Error("located email has no sender to reply to");
	const draftsId = mailboxes?.find((mailbox) => mailbox.role === "drafts")?.id;
	if (!draftsId) throw new Error("Mailbox/get returned no drafts mailbox");
	const sentId = mailboxes?.find((mailbox) => mailbox.role === "sent")?.id;
	const messageIds = original.messageId ?? [];
	const references = [...new Set([...(original.references ?? []), ...messageIds])];
	return {
		reply: {
			mailboxIds: { [draftsId]: true },
			keywords: { $draft: true },
			from: [
				{
					email: replyIdentity.email,
					...(replyIdentity.name ? { name: replyIdentity.name } : {}),
				},
			],
			to: [recipient],
			subject: replySubject(original.subject),
			...(messageIds.length ? { "header:In-Reply-To:asMessageIds": messageIds } : {}),
			...(references.length ? { "header:References:asMessageIds": references } : {}),
			"header:X-AI-Outfitter-Delivery-ID:asText": deliveryId,
			bodyStructure: { type: "text/plain", partId: "body" },
			bodyValues: { body: { value: text } },
		},
		submission: {
			identityId: replyIdentity.id,
			emailId: `#${emailCreationId}`,
		},
		update: {
			"keywords/$draft": null,
			[`mailboxIds/${draftsId}`]: null,
			...(sentId ? { [`mailboxIds/${sentId}`]: true } : {}),
		},
	};
}

function replySubject(subject: string | undefined): string {
	const value = subject ?? "";
	return /^re\s*:/i.test(value) ? value : `Re: ${value}`;
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
			const channelLocator = encodeJmapLocator({
				accountId: session.accountId,
				emailId: email.id,
				threadId: email.threadId,
			});
			await taskSink.accept({
				principal,
				source: "jmap",
				providerEventId: sourceIdentifier("event", eventKey),
				providerDedupeKey: sourceIdentifier("event", eventKey),
				nativeLocator: {
					accountId: session.accountId,
					emailId: email.id,
					threadId: email.threadId,
					channelLocator,
				},
				receivedAt: new Date().toISOString(),
				conversationKey: sourceIdentifier("conversation", email.threadId),
				parts: [{ data: { channelLocator } }],
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
	const responses = await jmapCalls(session, auth, [[method, arguments_, "c1"]], signal);
	return methodResult<T>(responses, method, "c1");
}

type JmapMethodCall = [string, Record<string, unknown>, string];
type JmapMethodResponse = [string, unknown, string];

async function jmapCalls(
	session: JmapSession,
	auth: string,
	methodCalls: JmapMethodCall[],
	signal: AbortSignal = new AbortController().signal,
): Promise<JmapMethodResponse[]> {
	if (!session.apiUrl) throw new Error("session has no apiUrl for JMAP methods");
	const apiUrl = session.apiUrl.replace("{accountId}", encodeURIComponent(session.accountId));
	const using = [CORE_CAPABILITY, MAIL_CAPABILITY];
	if (
		methodCalls.some(
			([method]) => method.startsWith("Identity/") || method.startsWith("EmailSubmission/"),
		)
	) {
		using.push(SUBMISSION_CAPABILITY);
	}
	const response = await fetch(apiUrl, {
		method: "POST",
		headers: {
			Authorization: auth,
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify({ using, methodCalls }),
		signal,
	});
	if (!response.ok) throw new Error(`JMAP request failed ${response.status}`);
	const body = (await response.json()) as { methodResponses?: JmapMethodResponse[] };
	if (!body.methodResponses) throw new Error("JMAP response has no methodResponses");
	return body.methodResponses;
}

function methodResult<T>(
	responses: readonly JmapMethodResponse[],
	method: string,
	callId: string,
): T {
	const tuple = responses.find((response) => response[2] === callId);
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
