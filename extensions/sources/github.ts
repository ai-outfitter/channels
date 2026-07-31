/**
 * GitHub notifications channel source.
 *
 * GitHub has no push transport for notifications, so this source **polls**
 * `GET /notifications` on an interval and emits an event only for *new* threads
 * that match the configured filters. It still funnels into the shared queue and
 * wakes the model only when a matching notification appears — not every tick.
 *
 * Filters (env `GITHUB_NOTIFY_FILTERS`, comma/space list; default
 * `review_requested,assigned_issue,assigned_pr,author`):
 * - `review_requested` — a PR review requested from you.
 * - `assigned_issue`   — an issue assigned to you.
 * - `assigned_pr`      — a PR assigned to you.
 * - `author`           — activity on a thread you opened. This is what wakes a
 *                        PR author when someone reviews their own pull request.
 * - `mention`          — you were @-mentioned.
 * - every other GitHub notification reason, by its own name: `comment`,
 *   `subscribed`, `state_change`, `ci_activity`, `team_mention`, `manual`,
 *   `approval_requested`, `invitation`, `security_alert`,
 *   `security_advisory_credit`, `member_feature_requested`.
 *
 * `assign` is not a filter name. GitHub sends it for both issues and pull
 * requests, so this source splits it into `assigned_issue` and `assigned_pr`.
 *
 * Security invariant: every request URL is built from the configured API base.
 * A URL taken from a notification payload is **never** fetched. A payload URL
 * points at the public host, which from inside a network that reaches the forge
 * privately may be unreachable or firewalled — dereferencing it turns every
 * wake into a silent no-op.
 */
import type { ChannelSource } from "./types.ts";
import { errorMessage, parseList, scopedLog, sinceFrom, trimTrailingSlash } from "./util.ts";

const log = scopedLog("github");

export interface GithubConfig {
	token: string;
	api: string;
	filters: Set<string>;
	pollMs: number;
	markRead: boolean;
}

const DEFAULT_FILTERS = ["review_requested", "assigned_issue", "assigned_pr", "author"];
const DEFAULT_POLL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Every filter name this source can ever match: GitHub's own notification
 * reasons, minus `assign` — which is split by subject type — plus the two names
 * that split produces. `classify` returns only a value from this set, so a name
 * outside it is unmatchable rather than merely unusual.
 */
const KNOWN_FILTERS = new Set([
	"assigned_issue",
	"assigned_pr",
	"approval_requested",
	"author",
	"ci_activity",
	"comment",
	"invitation",
	"manual",
	"member_feature_requested",
	"mention",
	"review_requested",
	"security_advisory_credit",
	"security_alert",
	"state_change",
	"subscribed",
	"team_mention",
]);

/** Derive the REST base: github.com uses api.github.com, GHES uses /api/v3. */
function apiFromEnv(): string {
	const explicit = process.env.GITHUB_NOTIFY_API_URL || process.env.GITHUB_API_URL;
	if (explicit) return trimTrailingSlash(explicit);
	const server = trimTrailingSlash(process.env.GITHUB_SERVER_URL || "https://github.com");
	return /^https?:\/\/(www\.)?github\.com$/.test(server)
		? "https://api.github.com"
		: `${server}/api/v3`;
}

export function githubConfigFromEnv(): GithubConfig | undefined {
	// A dedicated poller token is separable from the token the agent's `gh` uses:
	// listing notifications requires a classic PAT, while repository work should
	// use the narrowest credential available.
	const token = process.env.GITHUB_NOTIFY_TOKEN || process.env.GITHUB_TOKEN;
	if (!token) return undefined;
	const raw = parseList(process.env.GITHUB_NOTIFY_FILTERS);
	const filters = new Set(raw.length > 0 ? raw : DEFAULT_FILTERS);
	// An unmatchable name is left in the set — nothing needs removing, because
	// `classify` never returns one — but it is called out, since the symptom is
	// otherwise a source that starts cleanly and never wakes.
	for (const name of filters) {
		if (name === "assign") {
			log(`filter "assign" never matches; use "assigned_issue" or "assigned_pr"`);
		} else if (!KNOWN_FILTERS.has(name)) {
			log(`filter "${name}" is not a GitHub notification reason; it will never match`);
		}
	}
	const pollMs = Number(process.env.GITHUB_NOTIFY_POLL_MS) || DEFAULT_POLL_MS;
	// Off by default, and it must stay that way wherever the agent reads its own
	// notifications: marking a thread read in the same poll that emits the wake
	// deletes the evidence the woken agent is about to go looking for, and it
	// reports that it has no work. The agent marks a thread read after acting.
	const markRead = process.env.GITHUB_NOTIFY_MARK_READ === "1";
	return { token, api: apiFromEnv(), filters, pollMs, markRead };
}

interface Notification {
	id: string;
	reason: string;
	updated_at: string;
	// `subject.url` is deliberately absent: see the security invariant above.
	subject?: { title?: string; type?: string };
	repository?: { full_name?: string };
}

/** Per-request extras, merged onto the source's auth headers. */
interface RequestOptions {
	method?: string;
	headers?: Record<string, string>;
}
/** An authenticated request against the configured API base. */
type Request_ = (path: string, options?: RequestOptions) => Promise<Response>;

/** Raise the configured floor to whatever pace GitHub asks for. */
export function nextIntervalMs(floorMs: number, res: Response): number {
	const asked = Number(res.headers.get("x-poll-interval") ?? 0) * 1000;
	return Number.isFinite(asked) && asked > floorMs ? asked : floorMs;
}

export function createGithubSource(cfg: GithubConfig): ChannelSource {
	const headers = {
		Authorization: `Bearer ${cfg.token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};

	return {
		async start(onEvent) {
			const controller = new AbortController();
			let timer: ReturnType<typeof setTimeout> | undefined;

			// Per-request headers merge *onto* the auth headers rather than being
			// replaced by them. Spreading an init object and then assigning `headers`
			// silently discards the caller's, which is how a conditional request can
			// look correct and never be sent.
			const request: Request_ = async (path, options) =>
				await fetch(`${cfg.api}${path}`, {
					method: options?.method ?? "GET",
					headers: { ...headers, ...options?.headers },
					signal: AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
				});

			const state: PollState = {
				// Keys seen in the previous poll only — `since` already excludes anything
				// older, so this just dedups threads sharing the `since`-boundary second.
				seen: new Set<string>(),
				// Only notify on threads updated after start-up. Anchored to GitHub's
				// clock (the response Date header), never the local one.
				since: new Date().toISOString(),
				intervalMs: cfg.pollMs,
			};
			const tick = async (): Promise<void> => {
				try {
					await pollOnce({ cfg, signal: controller.signal, onEvent, request }, state);
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
				}, state.intervalMs);
			};
			// Diagnostics must not gate the first poll: a hung /user would delay the
			// first wake by the request timeout.
			void announceIdentity(cfg, request);
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

/** Everything one poll carries over to the next. */
interface PollState {
	seen: Set<string>;
	since: string;
	lastModified?: string | undefined;
	intervalMs: number;
}

/** Everything one poll needs that does not change between polls. */
interface PollDeps {
	cfg: GithubConfig;
	signal: AbortSignal;
	onEvent: (event: { channel: string; summary: string }) => void;
	request: Request_;
}

/** One poll: fetch, pace, emit. Mutates `state` in place. */
async function pollOnce(deps: PollDeps, state: PollState): Promise<void> {
	const { cfg, request } = deps;
	// A 304 costs no rate limit, so ask for one whenever we have a cursor.
	const conditional = state.lastModified
		? { headers: { "If-Modified-Since": state.lastModified } }
		: undefined;
	const res = await request(
		`/notifications?all=false&since=${encodeURIComponent(state.since)}`,
		conditional,
	);
	const interval = nextIntervalMs(cfg.pollMs, res);
	if (interval !== state.intervalMs) {
		// Log on change rather than once: a later change is what an operator
		// debugging pacing needs to see, and a latch would hide it.
		log(`poll interval is now ${interval}ms (configured floor ${cfg.pollMs}ms)`);
		state.intervalMs = interval;
	}
	// 304 means nothing changed.
	if (res.status === 304) return;
	if (res.status !== 200) {
		// Leave `since` where it is so the window is not lost.
		log(`poll returned HTTP ${res.status}`);
		return;
	}
	state.lastModified = res.headers.get("last-modified") ?? state.lastModified;
	const list = (await res.json()) as Notification[];
	state.seen = await emitNew(list, state.seen, deps);
	state.since = sinceFrom(res);
}

/**
 * Say who we are and how we are configured, once, at start-up. A wrong, expired,
 * or wrong-type token otherwise produces a 401 every interval that nobody reads,
 * and an agent that is simply never woken. An identity lookup that fails must not
 * stop the poller: GitHub supplies the reason, so this source never needs a login.
 */
async function announceIdentity(cfg: GithubConfig, request: Request_): Promise<void> {
	const who = await request("/user")
		.then(async (res) =>
			res.status === 200 ? ((await res.json()) as { login?: string }).login : undefined,
		)
		.catch(() => undefined);
	log(
		`watching notifications as ${who ?? "unknown (identity check failed)"}; ` +
			`filters=[${[...cfg.filters].join(",")}] interval=${cfg.pollMs}ms ` +
			`api=${cfg.api} markRead=${cfg.markRead}`,
	);
}

/**
 * Emit an event for each not-yet-seen, matching notification; return the keys
 * seen in this batch (the next poll's dedup set). `summary` stays trusted — it
 * is a `Reason` this source chose, never the attacker-controlled issue/PR title.
 */
async function emitNew(
	list: Notification[],
	seen: Set<string>,
	deps: PollDeps,
): Promise<Set<string>> {
	const { cfg, signal, onEvent, request } = deps;
	const batch = new Set<string>();
	const handled: Notification[] = [];
	for (const n of list) {
		const key = `${n.id}@${n.updated_at}`;
		batch.add(key);
		if (seen.has(key) || signal.aborted) continue;
		const reason = classify(n);
		if (!reason || !cfg.filters.has(reason)) continue;
		onEvent({ channel: "github", summary: reason });
		handled.push(n);
	}
	// Drain serially. One poll can return up to 50 threads, and GitHub's
	// secondary rate limit rejects concurrent writes to the same endpoint — a
	// burst of unawaited PATCHes 403s, loses every mark, and re-fetches the same
	// threads next poll. The poll loop is already serialised, so waiting is free.
	if (cfg.markRead) {
		for (const n of handled) await markRead(n, request);
	}
	return batch;
}

/** Best-effort: a failed mark-read must not drop the event already emitted. */
async function markRead(n: Notification, request: Request_): Promise<void> {
	try {
		const res = await request(`/notifications/threads/${n.id}`, { method: "PATCH" });
		if (res.status >= 400) log(`mark-read returned HTTP ${res.status}`);
	} catch (err) {
		log(`mark-read failed: ${errorMessage(err)}`);
	}
}

/**
 * Derive why this account was notified, in the vocabulary the operator
 * configured and the agent reads. GitHub supplies a `reason` already, so unlike
 * a forge that omits it, no extra request is needed — but the names still have
 * to be normalised: GitHub sends one `assign` reason for both issues and pull
 * requests, and every forge source must emit the same word for the same event.
 */
function classify(n: Notification): string | undefined {
	if (n.reason !== "assign") return n.reason;
	const type = n.subject?.type; // "PullRequest" | "Issue"
	if (type === "Issue") return "assigned_issue";
	if (type === "PullRequest") return "assigned_pr";
	return undefined;
}
