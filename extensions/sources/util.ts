/**
 * Small shared helpers for the channel extension and its sources — the bits that
 * were otherwise re-typed once per source (scoped logger, env-list parsing, and
 * the run/reconnect supervisor).
 */
import { setTimeout as delay } from "node:timers/promises";

/** A `console.error` logger tagged with a `[channels:<scope>]` prefix. */
export function scopedLog(scope: string): (msg: string) => void {
	const prefix = `[channels${scope ? `:${scope}` : ""}]`;
	return (msg: string) => console.error(`${prefix} ${msg}`);
}

/** Parse a comma/space-separated env list (e.g. `jmap, signal`) into tokens. */
export function parseList(raw: string | undefined): string[] {
	return raw ? raw.split(/[\s,]+/).filter(Boolean) : [];
}

/** How long a source waits before re-establishing a dropped push connection. */
export const RECONNECT_DELAY_MS = 5000;

/**
 * Run a push connection and keep it alive: call `attempt`, and whenever it
 * returns or throws, wait `delayMs` and run it again — until the returned stop
 * handle is invoked. `attempt` is handed an `AbortSignal` that fires on stop;
 * it must tear its connection down when the signal aborts. `attempt` may also
 * abort a *derived* controller to force its own early reconnect (e.g. an idle
 * timeout) without stopping the supervisor.
 *
 * The stop handle is idempotent, cancels an in-flight backoff, and — via the
 * signal — the live attempt, so no timer or connection outlives it.
 */
export function supervise(
	attempt: (signal: AbortSignal) => Promise<void>,
	log: (msg: string) => void,
	delayMs: number = RECONNECT_DELAY_MS,
): () => Promise<void> {
	const controller = new AbortController();
	const { signal } = controller;

	const loop = async (): Promise<void> => {
		while (!signal.aborted) {
			if (!(await runOnce(attempt, signal, log))) return;
			if (signal.aborted || !(await backoff(delayMs, signal))) return;
		}
	};
	void loop();

	return async () => controller.abort();
}

/** Run one attempt; return `false` only when the supervisor was stopped. */
async function runOnce(
	attempt: (signal: AbortSignal) => Promise<void>,
	signal: AbortSignal,
	log: (msg: string) => void,
): Promise<boolean> {
	try {
		await attempt(signal);
	} catch (err) {
		if (signal.aborted) return false;
		log(`${(err as Error).message}; reconnecting`);
	}
	return true;
}

/** Wait `ms`, or return `false` immediately if the signal aborts during it. */
async function backoff(ms: number, signal: AbortSignal): Promise<boolean> {
	try {
		await delay(ms, undefined, { signal });
		return true;
	} catch {
		return false;
	}
}
