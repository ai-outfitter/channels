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

/**
 * The message of a thrown value. `(err as Error).message` yields `undefined`
 * when something rejects with a string, which is when the log matters most.
 */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Normalise a configured base URL so a caller can concatenate a path onto it. */
export function trimTrailingSlash(raw: string): string {
	return raw.replace(/\/+$/, "");
}

/**
 * Anchor a polling cursor to the server's clock (the response `Date` header),
 * never the local one. A source whose host clock drifts would otherwise skip or
 * repeat a window on every poll.
 */
export function sinceFrom(res: Response): string {
	const date = res.headers.get("date");
	return date ? new Date(date).toISOString() : new Date().toISOString();
}

/** How long a source waits before re-establishing a dropped push connection. */
export const RECONNECT_DELAY_MS = 5000;
/** Maximum time shutdown waits for a source attempt to honor its abort signal. */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Wait before retrying one retained source item, returning early on shutdown. */
export async function retryDelay(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return;
	await new Promise<void>((resolve) => {
		const timer = setTimeout(done, ms);
		const abort = (): void => done();
		function done(): void {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			resolve();
		}
		signal.addEventListener("abort", abort, { once: true });
	});
}

/**
 * Run a push connection and keep it alive: call `attempt`, and whenever it
 * returns or throws, wait `delayMs` and run it again — until the returned stop
 * handle is invoked. `attempt` is handed an `AbortSignal` that fires on stop;
 * it must tear its connection down when the signal aborts. `attempt` may also
 * abort a *derived* controller to force its own early reconnect (e.g. an idle
 * timeout) without stopping the supervisor.
 *
 * The stop handle is idempotent, cancels an in-flight backoff, and — via the
 * signal — the live attempt. It waits for teardown up to `shutdownTimeoutMs`,
 * then logs and returns so a broken source cannot block session shutdown.
 */
export function supervise(
	attempt: (signal: AbortSignal) => Promise<void>,
	log: (msg: string) => void,
	delayMs: number = RECONNECT_DELAY_MS,
	shutdownTimeoutMs: number = SHUTDOWN_TIMEOUT_MS,
): () => Promise<void> {
	const controller = new AbortController();
	const { signal } = controller;

	const loop = async (): Promise<void> => {
		while (!signal.aborted) {
			if (!(await runOnce(attempt, signal, log))) return;
			if (signal.aborted || !(await backoff(delayMs, signal))) return;
		}
	};
	const running = loop();

	return async () => {
		controller.abort();
		const timer = new AbortController();
		try {
			await Promise.race([
				running,
				delay(shutdownTimeoutMs, undefined, {
					signal: timer.signal,
				}).then(() => {
					log(`source shutdown timed out after ${shutdownTimeoutMs}ms`);
				}),
			]);
		} finally {
			timer.abort();
		}
	};
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
