/**
 * Forgejo/Gitea notifications channel source.
 *
 * Like GitHub, Forgejo has no push transport for notifications, so this source
 * **polls** and emits an event only for *new* threads that match the configured
 * filters. It gates each poll on `GET /notifications/new` — a cheap unread
 * count — and only lists threads when that count is non-zero.
 *
 * The important difference from GitHub: a Forgejo notification thread carries
 * **no `reason` field**. It reports only `{id, unread, updated_at, repository,
 * subject:{type,state,url}}`, so "why am I being told about this" has to be
 * derived by fetching the subject and looking for this account in its
 * `requested_reviewers` or `assignees`. That costs one extra request per *new*
 * thread, never per tick.
 *
 * Filters (env `FORGEJO_NOTIFY_FILTERS`, comma/space list; default
 * `review_requested,assigned_issue,assigned_pr`):
 * - `review_requested` — a pull request review requested from you.
 * - `assigned_issue`   — an issue assigned to you.
 * - `assigned_pr`      — a pull request assigned to you.
 */
import type { ChannelSource } from "./types.ts";
import { errorMessage, parseList, scopedLog, sinceFrom, trimTrailingSlash } from "./util.ts";

const log = scopedLog("forgejo");

export interface ForgejoConfig {
	/** API base, without the trailing `/api/v1`. */
	url: string;
	token: string;
	/** Login this account answers to; resolved from the API when unset. */
	user?: string | undefined;
	filters: Set<string>;
	pollMs: number;
	/** Mark a matched thread read so the account's inbox does not grow forever. */
	markRead: boolean;
}

const DEFAULT_FILTERS = ["review_requested", "assigned_issue", "assigned_pr"];
const DEFAULT_POLL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

export function forgejoConfigFromEnv(): ForgejoConfig | undefined {
	const token = process.env.FORGEJO_TOKEN;
	// FORGEJO_API_URL exists so a deployment can point the poller at an
	// in-cluster address while FORGEJO_URL stays the public one used in links.
	const url = trimTrailingSlash(process.env.FORGEJO_API_URL || process.env.FORGEJO_URL || "");
	if (!token || !url) return undefined;
	const raw = parseList(process.env.FORGEJO_NOTIFY_FILTERS);
	const filters = new Set(raw.length > 0 ? raw : DEFAULT_FILTERS);
	const pollMs = Number(process.env.FORGEJO_NOTIFY_POLL_MS) || DEFAULT_POLL_MS;
	const markRead = process.env.FORGEJO_NOTIFY_MARK_READ === "1";
	return { url, token, user: process.env.FORGEJO_USER, filters, pollMs, markRead };
}

interface Thread {
	id: number;
	unread?: boolean;
	updated_at: string;
	subject?: { type?: string; url?: string; state?: string };
	repository?: { full_name?: string };
}

interface Subject {
	assignees?: ({ login?: string } | null)[] | null;
	requested_reviewers?: ({ login?: string } | null)[] | null;
}

/** The trusted reasons this source can derive; never free text. */
type Reason = "review_requested" | "assigned_pr" | "assigned_issue";

/** An authenticated, abort-aware request against the forge API. */
type Request_ = (url: string, init?: RequestInit) => Promise<Response>;

export function createForgejoSource(cfg: ForgejoConfig): ChannelSource {
	const api = `${cfg.url}/api/v1`;
	const headers = {
		Authorization: `token ${cfg.token}`,
		Accept: "application/json",
	};

	return {
		async start(onEvent) {
			const controller = new AbortController();
			// Keys seen in the previous poll only — `since` already excludes
			// anything older, so this just dedups threads sharing the
			// `since`-boundary second.
			let seen = new Set<string>();
			// Only notify on threads updated after start-up, anchored to the
			// forge's clock (the response Date header), never the local one.
			let since = new Date().toISOString();
			let login = cfg.user;
			let timer: ReturnType<typeof setTimeout> | undefined;

			const request: Request_ = async (url, init) =>
				await fetch(url, {
					...init,
					headers,
					signal: AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
				});
			const get = async (url: string): Promise<Response> => await request(url);

			/** Resolve our own login once; without it nothing can be classified. */
			const resolveLogin = async (): Promise<string | undefined> => {
				if (login) return login;
				const res = await get(`${api}/user`);
				if (res.status !== 200) {
					log(`identity lookup returned HTTP ${res.status}`);
					return undefined;
				}
				const me = (await res.json()) as { login?: string };
				login = me.login;
				if (!login) log("identity lookup returned no login");
				return login;
			};

			const tick = async (): Promise<void> => {
				try {
					const me = await resolveLogin();
					if (!me) return;
					const polled = await pollThreads(api, get, since);
					if (!polled) return;
					seen = await emitNew(
						polled.list,
						seen,
						me,
						cfg,
						api,
						request,
						controller.signal,
						onEvent,
					);
					since = polled.since;
				} catch (err) {
					if (controller.signal.aborted) return;
					log(`poll error: ${errorMessage(err)}`);
				}
			};

			// Self-schedule the next poll only after this one settles, so a slow or
			// hung request can never overlap and race `seen`/`since`.
			const schedule = (): void => {
				timer = setTimeout(async () => {
					await tick();
					if (!controller.signal.aborted) schedule();
				}, cfg.pollMs);
			};
			void (async () => {
				await tick();
				if (!controller.signal.aborted) schedule();
			})();

			return async () => {
				controller.abort();
				if (timer) clearTimeout(timer);
			};
		},
	};
}

/**
 * Fetch the unread threads updated since `since`, gated on a cheap unread count
 * so the list call is skipped entirely when there is nothing new. Returns the
 * threads plus the `since` to use next, or `undefined` when the forge could not
 * be read — in which case `since` must not advance or the missed window is lost.
 */
async function pollThreads(
	api: string,
	get: (url: string) => Promise<Response>,
	since: string,
): Promise<{ list: Thread[]; since: string } | undefined> {
	const probe = await get(`${api}/notifications/new`);
	if (probe.status !== 200) {
		log(`unread probe returned HTTP ${probe.status}`);
		return undefined;
	}
	const { new: unread } = (await probe.json()) as { new?: number };
	if (!unread) return { list: [], since: sinceFrom(probe) };

	const res = await get(
		`${api}/notifications?status-types=unread&since=${encodeURIComponent(since)}`,
	);
	if (res.status !== 200) {
		log(`poll returned HTTP ${res.status}`);
		return undefined;
	}
	return { list: (await res.json()) as Thread[], since: sinceFrom(res) };
}

/**
 * Emit an event for each not-yet-seen thread whose derived reason matches;
 * return the keys seen in this batch (the next poll's dedup set).
 *
 * `summary` is one of our own `Reason` values — deliberately never the issue or
 * pull-request title, which is attacker-controlled text.
 */
async function emitNew(
	list: Thread[],
	seen: Set<string>,
	login: string,
	cfg: ForgejoConfig,
	api: string,
	request: Request_,
	signal: AbortSignal,
	onEvent: (event: { channel: string; summary: string }) => void,
): Promise<Set<string>> {
	const batch = new Set<string>();
	for (const thread of list) {
		const key = `${thread.id}@${thread.updated_at}`;
		batch.add(key);
		if (seen.has(key) || signal.aborted) continue;

		const reason = await classify(thread, login, api, request);
		if (!reason || !cfg.filters.has(reason)) continue;

		onEvent({ channel: "forgejo", summary: reason });
		if (cfg.markRead) await markRead(thread, api, request);
	}
	return batch;
}

/**
 * Derive why this account was notified. Forgejo threads carry no `reason`, so
 * the subject is fetched and inspected; an unreachable or unrecognized subject
 * yields no reason rather than a guess.
 */
async function classify(
	thread: Thread,
	login: string,
	api: string,
	request: Request_,
): Promise<Reason | undefined> {
	const type = thread.subject?.type; // "Pull" | "Issue" | "Commit" | "Repository"
	if (type !== "Pull" && type !== "Issue") return undefined;
	// Re-root the subject onto the configured API base rather than fetching the
	// URL the payload carries. A notification's `subject.url` is absolute and
	// points at the forge's public host; a deployment that reaches the forge on
	// an internal address cannot necessarily reach that one, and the request
	// fails in a way that yields no reason and therefore no wake — every
	// notification silently lost. Only the path is taken from the payload.
	const path = subjectPath(thread.subject?.url);
	if (!path) return undefined;

	const res = await request(`${api}${path}`);
	if (res.status !== 200) {
		log(`subject lookup returned HTTP ${res.status}`);
		return undefined;
	}
	const subject = (await res.json()) as Subject;

	if (type === "Pull" && includesLogin(subject.requested_reviewers, login)) {
		return "review_requested";
	}
	if (includesLogin(subject.assignees, login)) {
		return type === "Pull" ? "assigned_pr" : "assigned_issue";
	}
	return undefined;
}

/**
 * The API path of a notification subject, e.g. `/repos/o/r/issues/3`. Returns
 * undefined when the payload carries no usable path, so an unparseable or
 * hostile value is dropped rather than fetched.
 */
export function subjectPath(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	let pathname: string;
	try {
		pathname = new URL(raw).pathname;
	} catch {
		return undefined;
	}
	const marker = "/api/v1/";
	const at = pathname.indexOf(marker);
	if (at === -1) return undefined;
	return pathname.slice(at + marker.length - 1);
}

function includesLogin(
	users: ({ login?: string } | null)[] | null | undefined,
	login: string,
): boolean {
	return (users ?? []).some((user) => user?.login === login);
}

/** Best-effort: a failed mark-read must not drop the event that was emitted. */
async function markRead(thread: Thread, api: string, request: Request_): Promise<void> {
	// `id` is typed as a number but arrives as unvalidated JSON; a string value
	// would path-traverse out of this endpoint.
	if (!Number.isSafeInteger(thread.id)) {
		log(`ignoring a notification with a non-numeric id`);
		return;
	}
	try {
		const res = await request(`${api}/notifications/threads/${thread.id}?to-status=read`, {
			method: "PATCH",
		});
		if (res.status >= 400) log(`mark-read returned HTTP ${res.status}`);
	} catch (err) {
		log(`mark-read failed: ${errorMessage(err)}`);
	}
}
