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
 * - `comment`, `subscribed`, `state_change`, `ci_activity` — as named.
 *
 * Security invariant: every request URL is built from the configured API base.
 * A URL taken from a notification payload is **never** fetched. A payload URL
 * points at the public host, which from inside a network that reaches the forge
 * privately may be unreachable or firewalled — dereferencing it turns every
 * wake into a silent no-op.
 */
import type { ChannelSource } from "./types.ts";
import { parseList, scopedLog } from "./util.ts";

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
/** Reasons this source understands. Anything else is ignored. */
const KNOWN_FILTERS = new Set([
	...DEFAULT_FILTERS,
	"mention",
	"comment",
	"subscribed",
	"state_change",
	"ci_activity",
]);
/**
 * Poll unconditionally every Nth tick. Conditional requests are an optimisation;
 * if `If-Modified-Since` ever interacts badly with the moving `since` window, an
 * unconditional sweep bounds the damage to a few intervals of delay instead of a
 * permanent silent stall.
 */
const UNCONDITIONAL_EVERY = 10;

/** Derive the REST base: github.com uses api.github.com, GHES uses /api/v3. */
function apiFromEnv(): string {
	const explicit = process.env.GITHUB_API_URL?.replace(/\/+$/, "");
	if (explicit) return explicit;
	const server = (process.env.GITHUB_SERVER_URL || "https://github.com").replace(/\/+$/, "");
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
	for (const name of filters) {
		// A typo here yields a source that starts cleanly and never wakes.
		if (!KNOWN_FILTERS.has(name)) log(`ignoring unknown filter "${name}"`);
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

			const request = async (path: string, init?: RequestInit): Promise<Response> =>
				await fetch(`${cfg.api}${path}`, {
					...init,
					headers,
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
				announcedInterval: false,
				ticks: 0,
			};
			const tick = async (): Promise<void> => {
				try {
					await pollOnce(cfg, state, headers, controller.signal, onEvent, request);
				} catch (err) {
					if (controller.signal.aborted) return;
					log(`poll error: ${(err as Error).message}`);
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
			void (async () => {
				await announceIdentity(cfg, request);
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
	announcedInterval: boolean;
	ticks: number;
}

/** One poll: fetch, pace, emit. Mutates `state` in place. */
async function pollOnce(
	cfg: GithubConfig,
	state: PollState,
	headers: Record<string, string>,
	signal: AbortSignal,
	onEvent: (event: { channel: string; summary: string }) => void,
	request: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<void> {
	// Conditional requests are free (a 304 costs no rate limit), but every
	// failure here is silent, so drop the header periodically to self-heal.
	const conditional =
		state.lastModified && state.ticks % UNCONDITIONAL_EVERY !== 0
			? { headers: { ...headers, "If-Modified-Since": state.lastModified } }
			: undefined;
	state.ticks += 1;
	const res = await request(
		`/notifications?all=false&since=${encodeURIComponent(state.since)}`,
		conditional,
	);
	state.intervalMs = nextIntervalMs(cfg.pollMs, res);
	if (!state.announcedInterval && state.intervalMs > cfg.pollMs) {
		state.announcedInterval = true;
		log(`GitHub asked for a ${state.intervalMs}ms poll interval; using it over ${cfg.pollMs}ms`);
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
	state.seen = emitNew(list, state.seen, cfg, signal, onEvent, request);
	state.since = sinceFrom(res);
}

/**
 * Say who we are and how we are configured, once, at start-up. A wrong, expired,
 * or wrong-type token otherwise produces a 401 every interval that nobody reads,
 * and an agent that is simply never woken. An identity lookup that fails must not
 * stop the poller: GitHub supplies the reason, so this source never needs a login.
 */
async function announceIdentity(
	cfg: GithubConfig,
	request: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<void> {
	const settings = `filters=[${[...cfg.filters].join(",")}] interval=${cfg.pollMs}ms api=${cfg.api} markRead=${cfg.markRead}`;
	try {
		const res = await request("/user");
		if (res.status !== 200) {
			log(`identity check returned HTTP ${res.status}; polling anyway — ${settings}`);
			return;
		}
		const user = (await res.json()) as { login?: string };
		log(`watching notifications as ${user.login ?? "unknown"}; ${settings}`);
	} catch (err) {
		log(`identity check failed: ${(err as Error).message}; polling anyway — ${settings}`);
	}
}

/**
 * Emit an event for each not-yet-seen, matching notification; return the keys
 * seen in this batch (the next poll's dedup set). `summary` stays trusted —
 * `reason` is a fixed GitHub enum, never the attacker-controlled issue/PR title.
 */
function emitNew(
	list: Notification[],
	seen: Set<string>,
	cfg: GithubConfig,
	signal: AbortSignal,
	onEvent: (event: { channel: string; summary: string }) => void,
	request: (path: string, init?: RequestInit) => Promise<Response>,
): Set<string> {
	const batch = new Set<string>();
	for (const n of list) {
		const key = `${n.id}@${n.updated_at}`;
		batch.add(key);
		if (!seen.has(key) && !signal.aborted && matches(n, cfg.filters)) {
			onEvent({ channel: "github", summary: n.reason });
			if (cfg.markRead) void markRead(n, request);
		}
	}
	return batch;
}

/** Best-effort: a failed mark-read must not drop the event already emitted. */
async function markRead(
	n: Notification,
	request: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<void> {
	try {
		const res = await request(`/notifications/threads/${n.id}`, { method: "PATCH" });
		if (res.status >= 400) log(`mark-read returned HTTP ${res.status}`);
	} catch (err) {
		log(`mark-read failed: ${(err as Error).message}`);
	}
}

/** Anchor `since` to GitHub's clock (response Date), falling back to local. */
function sinceFrom(res: Response): string {
	const date = res.headers.get("date");
	return date ? new Date(date).toISOString() : new Date().toISOString();
}

/**
 * A filter name matches its reason of the same name. `assign` is the exception:
 * GitHub uses one reason for issues and pull requests, split here on subject type.
 */
function matches(n: Notification, filters: Set<string>): boolean {
	if (n.reason === "assign") {
		const type = n.subject?.type; // "PullRequest" | "Issue"
		if (type === "Issue") return filters.has("assigned_issue");
		if (type === "PullRequest") return filters.has("assigned_pr");
		return false;
	}
	return filters.has(n.reason);
}
