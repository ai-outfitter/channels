/**
 * GitHub notifications channel source.
 *
 * GitHub has no push transport for notifications, so this source **polls**
 * `GET /notifications` on an interval and emits an event only for *new* threads
 * that match the configured filters. It still funnels into the shared queue and
 * wakes the model only when a matching notification appears — not every tick.
 *
 * Filters (env `GITHUB_NOTIFY_FILTERS`, comma/space list; default
 * `review_requested,assigned_issue`):
 * - `review_requested` — a PR review requested from you.
 * - `assigned_issue`   — an issue assigned to you.
 * - `assigned_pr`      — a PR assigned to you.
 * - `mention`          — you were @-mentioned.
 */
import type { ChannelSource } from "./types.ts";
import { parseList, scopedLog } from "./util.ts";

const log = scopedLog("github");

export interface GithubConfig {
	token: string;
	filters: Set<string>;
	pollMs: number;
}

const DEFAULT_FILTERS = ["review_requested", "assigned_issue"];
const DEFAULT_POLL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

export function githubConfigFromEnv(): GithubConfig | undefined {
	const token = process.env.GITHUB_TOKEN;
	if (!token) return undefined;
	const raw = parseList(process.env.GITHUB_NOTIFY_FILTERS);
	const filters = new Set(raw.length > 0 ? raw : DEFAULT_FILTERS);
	const pollMs = Number(process.env.GITHUB_NOTIFY_POLL_MS) || DEFAULT_POLL_MS;
	return { token, filters, pollMs };
}

interface Notification {
	id: string;
	reason: string;
	updated_at: string;
	subject?: { title?: string; type?: string };
	repository?: { full_name?: string };
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
			// Keys seen in the previous poll only — `since` already excludes anything
			// older, so this just dedups threads sharing the `since`-boundary second.
			let seen = new Set<string>();
			// Only notify on threads updated after start-up. Anchored to GitHub's
			// clock (the response Date header), never the local one.
			let since = new Date().toISOString();
			let timer: ReturnType<typeof setTimeout> | undefined;

			const tick = async (): Promise<void> => {
				try {
					const res = await fetch(
						`https://api.github.com/notifications?all=false&since=${encodeURIComponent(since)}`,
						{
							headers,
							signal: AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
						},
					);
					if (res.status !== 200) {
						log(`poll returned HTTP ${res.status}`);
						return;
					}
					const list = (await res.json()) as Notification[];
					seen = emitNew(list, seen, cfg.filters, controller.signal, onEvent);
					since = sinceFrom(res);
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
 * Emit an event for each not-yet-seen, matching notification; return the keys
 * seen in this batch (the next poll's dedup set). `summary` stays trusted —
 * `reason` is a fixed GitHub enum, never the attacker-controlled issue/PR title.
 */
function emitNew(
	list: Notification[],
	seen: Set<string>,
	filters: Set<string>,
	signal: AbortSignal,
	onEvent: (event: { channel: string; summary: string }) => void,
): Set<string> {
	const batch = new Set<string>();
	for (const n of list) {
		const key = `${n.id}@${n.updated_at}`;
		batch.add(key);
		if (!seen.has(key) && !signal.aborted && matches(n, filters)) {
			onEvent({ channel: "github", summary: n.reason });
		}
	}
	return batch;
}

/** Anchor `since` to GitHub's clock (response Date), falling back to local. */
function sinceFrom(res: Response): string {
	const date = res.headers.get("date");
	return date ? new Date(date).toISOString() : new Date().toISOString();
}

function matches(n: Notification, filters: Set<string>): boolean {
	const type = n.subject?.type; // "PullRequest" | "Issue"
	if (filters.has("review_requested") && n.reason === "review_requested") return true;
	if (filters.has("assigned_issue") && n.reason === "assign" && type === "Issue") return true;
	if (filters.has("assigned_pr") && n.reason === "assign" && type === "PullRequest") return true;
	if (filters.has("mention") && n.reason === "mention") return true;
	return false;
}
