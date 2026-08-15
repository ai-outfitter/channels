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
import {
	contentDigest,
	permanentIntakeFailure,
	sourceIdentifier,
} from "../task-plane/source-activation.ts";
import type { NativeActivation, SourceTaskActivationSink } from "../task-plane/types.ts";
import type { ChannelSource } from "./types.ts";
import { errorMessage, RECONNECT_DELAY_MS, retryDelay, scopedLog, supervise } from "./util.ts";

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

export function createSignalSource(
	cfg: SignalConfig,
	taskSink: SourceTaskActivationSink,
	spawnImpl: typeof spawn = spawn,
	retryMs: number = RECONNECT_DELAY_MS,
): ChannelSource {
	const args = ["--config", cfg.configDir, "-a", cfg.number, "-o", "json", "jsonRpc"];
	const principal = sourceIdentifier("signal", cfg.number);
	return {
		async start() {
			return supervise(
				(signal) => runCli(args, signal, principal, taskSink, spawnImpl, retryMs),
				log,
				retryMs,
			);
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
	principal: string,
	taskSink: SourceTaskActivationSink,
	spawnImpl: typeof spawn,
	retryMs: number,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const child = spawnImpl("signal-cli", args, { stdio: ["ignore", "pipe", "pipe"] });
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

		let intake = Promise.resolve();
		rl.on("line", (line) => {
			if (signal.aborted) return;
			rl.pause();
			const next = intake
				.then(async () => {
					const activation = signalActivation(line, principal);
					if (!activation) return;
					while (!signal.aborted) {
						try {
							await taskSink.accept(activation);
							return;
						} catch (error) {
							const permanent = permanentIntakeFailure(error);
							if (permanent) {
								await taskSink.recordEvidence?.({
									evidenceId: sourceIdentifier(
										"evidence",
										`${principal}\0${activation.providerEventId}`,
									),
									source: "signal",
									kind: permanent.kind,
									detail: { providerEventId: activation.providerEventId },
								});
								return;
							}
							log(`intake failed: ${errorMessage(error)}`);
							await retryDelay(retryMs, signal);
						}
					}
				})
				.catch((error) => {
					log(`intake failed: ${errorMessage(error)}`);
					child.kill();
				});
			let settled: Promise<void>;
			settled = next.finally(() => {
				if (intake === settled && !signal.aborted) rl.resume();
			});
			intake = settled;
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
			void intake.then(() => {
				if (signal.aborted) resolve();
				else reject(new Error(`signal-cli exited (${code})`));
			});
		});
	});
}

/**
 * A JSON-RPC `receive` notification carrying any data message means new work —
 * text, attachment, sticker, or reaction all live under `dataMessage`, while
 * receipts and typing indicators do not, so they're correctly ignored.
 */
export function signalActivation(line: string, principal: string): NativeActivation | undefined {
	try {
		const msg = JSON.parse(line) as {
			method?: string;
			params?: {
				envelope?: {
					source?: string;
					sourceNumber?: string;
					sourceUuid?: string;
					timestamp?: number;
					dataMessage?: { timestamp?: number; [key: string]: unknown };
				};
			};
		};
		const envelope = msg.params?.envelope;
		if (msg.method !== "receive" || !envelope?.dataMessage) return undefined;
		const sender = envelope.sourceUuid ?? envelope.sourceNumber ?? envelope.source;
		const timestamp = envelope.dataMessage.timestamp ?? envelope.timestamp;
		if (!sender || !Number.isSafeInteger(timestamp) || (timestamp ?? 0) <= 0) return undefined;
		const identity = `${sender}\0${timestamp}`;
		const locator = sourceIdentifier("signal-message", identity);
		return {
			principal,
			source: "signal",
			providerEventId: sourceIdentifier("event", identity),
			providerDedupeKey: sourceIdentifier("event", identity),
			nativeLocator: { sender, timestamp: String(timestamp), signalLocator: locator },
			receivedAt: new Date(timestamp as number).toISOString(),
			conversationKey: sourceIdentifier("conversation", sender),
			// The receive notification is the durable inbox record. Signal cannot
			// fetch it again after stdout has advanced, so the complete untrusted
			// envelope belongs in Task history and never in the wake prompt.
			parts: [{ data: { signalEnvelope: envelope } }],
			contentDigest: contentDigest(envelope),
		};
	} catch {
		return undefined;
	}
}
