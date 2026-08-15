/**
 * GitHub notifications channel source. Task-plane acknowledgment and exact-item
 * processing follow docs/a2a-source-conformance.md#migration-note-github-acknowledgment.
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

import { contentDigest, sourceIdentifier } from "../task-plane/source-activation.ts";
import type { SourceTaskActivationSink } from "../task-plane/types.ts";
import type { ChannelSource } from "./types.ts";
import {
	errorMessage,
	parseList,
	RECONNECT_DELAY_MS,
	scopedLog,
	sinceFrom,
	supervise,
	trimTrailingSlash,
} from "./util.ts";

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
	// Retained in the config shape for source API compatibility. Task-plane intake
	// owns mark-read-after-acceptance; this retired variable is ignored.
	const markRead = process.env.GITHUB_NOTIFY_MARK_READ === "1";
	return { token, api: apiFromEnv(), filters, pollMs, markRead };
}

interface Notification {
	id: string;
	reason: string;
	updated_at: string;
	// Parsed only as an identifier; it is never fetched (see the invariant above).
	subject?: { title?: string; type?: string; url?: string };
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

export function createGithubSource(
	cfg: GithubConfig,
	taskSink: SourceTaskActivationSink,
): ChannelSource {
	const headers = {
		Authorization: `Bearer ${cfg.token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};

	return {
		async start() {
			if (process.env.GITHUB_NOTIFY_MARK_READ !== undefined) {
				log(
					"GITHUB_NOTIFY_MARK_READ is retired and ignored; see docs/a2a-source-conformance.md#migration-note-github-acknowledgment",
				);
			}
			return supervise(
				async (signal) => {
					// Per-request headers merge *onto* the auth headers rather than being
					// replaced by them. Spreading an init object and then assigning `headers`
					// silently discards the caller's, which is how a conditional request can
					// look correct and never be sent.
					const request: Request_ = async (path, options) =>
						await fetch(`${cfg.api}${path}`, {
							method: options?.method ?? "GET",
							headers: { ...headers, ...options?.headers },
							signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
						});

					const identity = await authenticatedIdentity(request);
					const principal = sourceIdentifier("github", `${cfg.api}\0${identity.id}`);
					const checkpoint = taskSink.checkpoint
						? await taskSink.checkpoint<GithubCheckpoint>(principal, "github")
						: undefined;
					const state: PollState = {
						// Keys seen in the previous poll only — `since` already excludes anything
						// older, so this just dedups threads sharing the `since`-boundary second.
						seen: new Set(checkpoint?.seen ?? []),
						// Only notify on threads updated after start-up. The first window opens
						// on the local clock; every window after it is anchored to GitHub's
						// (the response Date header), so drift cannot compound.
						// A restart reopens the persisted poll window. Provider-event dedupe
						// returns prior Tasks for revisions accepted before the crash.
						since: checkpoint?.pollWindow ?? checkpoint?.since ?? new Date().toISOString(),
						lastModified: checkpoint?.lastModified,
						intervalMs: cfg.pollMs,
					};
					const tick = async (): Promise<void> => {
						try {
							await pollOnce({ cfg, signal, request, taskSink, principal }, state);
						} catch (err) {
							if (signal.aborted) return;
							log(`poll error: ${errorMessage(err)}`);
						}
					};

					// Self-schedule the next poll only after this one settles, so a slow or
					// hung request can never overlap and race `seen`/`since`.
					let timer: ReturnType<typeof setTimeout> | undefined;
					await new Promise<void>((resolve) => {
						const stop = (): void => {
							if (timer) clearTimeout(timer);
							signal.removeEventListener("abort", stop);
							resolve();
						};
						const schedule = (): void => {
							timer = setTimeout(async () => {
								await tick();
								if (!signal.aborted) schedule();
							}, state.intervalMs);
						};
						signal.addEventListener("abort", stop, { once: true });
						announceIdentity(cfg, identity.login);
						void tick().then(() => {
							if (!signal.aborted) schedule();
						});
						if (signal.aborted) stop();
					});
				},
				log,
				Math.min(cfg.pollMs, RECONNECT_DELAY_MS),
			);
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

interface GithubCheckpoint {
	readonly pollWindow: string;
	readonly since: string;
	readonly lastModified?: string;
	readonly seen: readonly string[];
}

/** Everything one poll needs that does not change between polls. */
interface PollDeps {
	cfg: GithubConfig;
	signal: AbortSignal;
	request: Request_;
	taskSink: SourceTaskActivationSink;
	principal: string;
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
	const nextLastModified = res.headers.get("last-modified") ?? state.lastModified;
	const list = (await res.json()) as Notification[];
	const emitted = await emitNew(list, state.seen, deps);
	if (!emitted.complete) return;
	const nextSeen = emitted.seen;
	const nextSince = sinceFrom(res);
	await deps.taskSink.advanceCheckpoint?.(deps.principal, "github", {
		pollWindow: state.since,
		since: nextSince,
		...(nextLastModified ? { lastModified: nextLastModified } : {}),
		seen: [...nextSeen],
	} satisfies GithubCheckpoint);
	state.seen = nextSeen;
	state.since = nextSince;
	state.lastModified = nextLastModified;
}

/** Resolve a credential-free account identity before opening its checkpoint. */
async function authenticatedIdentity(request: Request_): Promise<{ login: string; id: number }> {
	const res = await request("/user");
	if (res.status !== 200) throw new Error(`identity lookup returned HTTP ${res.status}`);
	const identity = (await res.json()) as { login?: string; id?: number };
	if (!identity.login) throw new Error("identity lookup returned no login");
	if (!Number.isSafeInteger(identity.id))
		throw new Error("identity lookup returned no numeric account id");
	return { login: identity.login, id: identity.id as number };
}

function announceIdentity(cfg: GithubConfig, who: string): void {
	log(
		`watching notifications as ${who}; ` +
			`filters=[${[...cfg.filters].join(",")}] interval=${cfg.pollMs}ms ` +
			`api=${cfg.api} acknowledgment=after-acceptance`,
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
): Promise<{ seen: Set<string>; complete: boolean }> {
	const { cfg, signal, request, taskSink, principal } = deps;
	const batch = new Set<string>();
	let complete = true;
	for (const n of list) {
		const key = `${n.id}@${n.updated_at}`;
		if (signal.aborted) return { seen: batch, complete: false };
		if (seen.has(key)) {
			batch.add(key);
			continue;
		}
		const reason = classify(n);
		if (!reason || !cfg.filters.has(reason)) {
			batch.add(key);
			continue;
		}
		try {
			const locator = notificationLocator(n, cfg.api, reason);
			const acceptance = await taskSink.accept({
				principal,
				source: "github",
				providerEventId: sourceIdentifier("event", key),
				providerDedupeKey: sourceIdentifier("event", key),
				nativeLocator: locator,
				receivedAt: new Date().toISOString(),
				conversationKey: sourceIdentifier(
					"conversation",
					`${locator.repository}\0${locator.subjectKind}\0${locator.number}`,
				),
				nativeDisplayUrl: locator.displayUrl,
				parts: [
					{
						data: {
							owner: locator.owner,
							repository: locator.repository,
							subjectKind: locator.subjectKind,
							number: locator.number,
							notificationId: n.id,
							reason,
							revision: n.updated_at,
						},
					},
				],
				contentDigest: contentDigest({ id: n.id, revision: n.updated_at, locator }),
			});
			await deliverMarkRead(taskSink, acceptance.taskId, n, request);
			batch.add(key);
		} catch (error) {
			if (error instanceof PermanentNotificationError) {
				log(`skipping notification ${n.id}: ${errorMessage(error)}`);
				batch.add(key);
			} else {
				complete = false;
				log(`notification ${n.id} will be retried: ${errorMessage(error)}`);
			}
		}
	}
	return { seen: batch, complete };
}

async function deliverMarkRead(
	taskSink: SourceTaskActivationSink,
	taskId: string,
	notification: Notification,
	request: Request_,
): Promise<void> {
	if (!taskSink.deliver) throw new Error("GitHub task delivery is not configured");
	await taskSink.deliver(
		{
			taskId,
			source: "github",
			operationId: `mark-read:${notification.id}@${notification.updated_at}`,
			payloadDigest: contentDigest({ notificationId: notification.id, read: true }),
			recovery: "idempotent",
		},
		async () => {
			await markRead(notification, request);
			return notification.id;
		},
	);
}

/** Exact acknowledgment after durable acceptance; failure preserves the checkpoint. */
async function markRead(n: Notification, request: Request_): Promise<void> {
	const res = await request(`/notifications/threads/${n.id}`, { method: "PATCH" });
	if (res.status >= 400) {
		const message = `mark-read returned HTTP ${res.status}`;
		if (res.status < 500 && res.status !== 408 && res.status !== 429)
			throw new PermanentNotificationError(message);
		throw new Error(message);
	}
}

class PermanentNotificationError extends Error {}

function notificationLocator(
	n: Notification,
	api: string,
	reason: string,
): Record<string, string> & {
	owner: string;
	repository: string;
	subjectKind: string;
	number: string;
	displayUrl: string;
} {
	const repository = n.repository?.full_name;
	const match = repository?.match(/^([^/]+)\/([^/]+)$/);
	const number = n.subject?.url?.match(/\/(?:issues|pulls)\/(\d+)$/)?.[1];
	if (!match || !number || !n.subject?.type)
		throw new PermanentNotificationError("GitHub notification has no exact subject identity");
	const host = api
		.replace(/^https:\/\/api\.github\.com$/, "https://github.com")
		.replace(/\/api\/v3$/, "");
	const kind = n.subject.type === "PullRequest" ? "pull" : "issues";
	return {
		owner: match[1] as string,
		repository: repository as string,
		subjectKind: n.subject.type,
		number,
		notificationId: n.id,
		reason,
		revision: n.updated_at,
		displayUrl: `${host}/${repository}/${kind}/${number}`,
	};
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
