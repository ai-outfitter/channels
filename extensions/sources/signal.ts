/**
 * Signal push channel source.
 *
 * Spawns `signal-cli … jsonRpc`, which auto-receives and emits a JSON-RPC
 * `receive` notification (one JSON object per line) as each message arrives. We
 * consume only the **notification** (a trusted "new message" ping) — the
 * `signal-responder` skill does the actual receive/reply via `signal-cli`.
 *
 * A dissimilar transport from the JMAP SSE source (child-process JSON-RPC vs.
 * HTTP EventSource), which is the point: both collapse to `onEvent` + a stop,
 * and both run under the shared `supervise` restart loop.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ChannelSource } from "./types.ts";
import { scopedLog, supervise } from "./util.ts";

const log = scopedLog("signal");

export interface SignalConfig {
	number: string;
	configDir: string;
}

/** Build config from the signal-responder skill's env, or undefined if unset. */
export function signalConfigFromEnv(): SignalConfig | undefined {
	const number = process.env.SIGNAL_NUMBER;
	const configDir = process.env.SIGNAL_CLI_CONFIG;
	if (!number || !configDir) return undefined;
	return { number, configDir };
}

export function createSignalSource(cfg: SignalConfig): ChannelSource {
	const args = ["--config", cfg.configDir, "-a", cfg.number, "-o", "json", "jsonRpc"];
	return {
		async start(onEvent) {
			return supervise((signal) => runCli(args, signal, onEvent), log);
		},
	};
}

/**
 * Run one `signal-cli … jsonRpc` process. Resolves when `signal`s abort tears it
 * down (clean stop), rejects when the process fails to spawn or exits on its own
 * (so the supervisor reconnects). A spawn failure (e.g. `signal-cli` not on
 * PATH) arrives as an `error` event — without this handler it would be an
 * uncaught exception that crashes the whole agent.
 */
function runCli(
	args: string[],
	signal: AbortSignal,
	onEvent: (event: { channel: string; summary: string }) => void,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const child = spawn("signal-cli", args, { stdio: ["ignore", "pipe", "pipe"] });
		const { stdout, stderr } = child;
		if (!stdout || !stderr) {
			reject(new Error("signal-cli spawned without stdio pipes"));
			return;
		}

		const rl = createInterface({ input: stdout });
		const onAbort = () => child.kill();
		const cleanup = () => {
			signal.removeEventListener("abort", onAbort);
			rl.close();
		};

		if (signal.aborted) child.kill();
		else signal.addEventListener("abort", onAbort, { once: true });

		rl.on("line", (line) => {
			if (!signal.aborted && isIncomingMessage(line)) {
				onEvent({ channel: "signal", summary: "new message" });
			}
		});
		stderr.on("data", (b: Buffer) => {
			const s = b.toString().trim();
			if (s) log(s);
		});
		child.on("error", (err) => {
			cleanup();
			reject(err);
		});
		child.on("exit", (code) => {
			cleanup();
			if (signal.aborted) resolve();
			else reject(new Error(`signal-cli exited (${code})`));
		});
	});
}

/**
 * A JSON-RPC `receive` notification carrying any data message means new work —
 * text, attachment, sticker, or reaction all live under `dataMessage`, while
 * receipts and typing indicators do not, so they're correctly ignored.
 */
function isIncomingMessage(line: string): boolean {
	try {
		const msg = JSON.parse(line) as {
			method?: string;
			params?: { envelope?: { dataMessage?: unknown } };
		};
		return msg.method === "receive" && msg.params?.envelope?.dataMessage != null;
	} catch {
		return false;
	}
}
