import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { A2aClient } from "./a2a/client.ts";
import type { A2aSendMessageRequest } from "./a2a/types.ts";
import {
	activationMetadata,
	digestParts,
	OUTFITTER_ORIGIN_EXTENSION_URI,
} from "./origins/types.ts";
import type { ChannelEvent, ChannelRespondResult, ChannelWork } from "./sources/types.ts";

const MAX_CONFIG_BYTES = 64 * 1024;
const DEFAULT_RETRY_MS = 2_000;
const MAX_RECEIPTS = 10_000;

interface SourceRouterDocument {
	readonly baseUrl: string;
	readonly token: string;
	readonly traceUrl: string;
	readonly outboxPath: string;
	readonly allowInsecureLoopback?: boolean;
	readonly retryMs?: number;
}

interface OutboxEntry {
	readonly id: string;
	readonly channel: string;
	readonly providerEventId: string;
	readonly locator?: string;
	readonly request: A2aSendMessageRequest;
	readonly taskId?: string;
	readonly delivery?: NativeDeliveryReport;
	readonly deliveryReported?: boolean;
}

interface NativeDeliveryReport {
	readonly sourceKind: string;
	readonly providerEventId: string;
	readonly state: "delivered" | "failed";
	readonly attemptCount: number;
	readonly responseId?: string;
	readonly errorCode?: string;
}

interface DeliveryReporter {
	report(taskId: string, delivery: NativeDeliveryReport): Promise<void>;
}

interface OutboxDocument {
	readonly version: 1;
	readonly entries: readonly OutboxEntry[];
	readonly delivered?: readonly OutboxEntry[];
}

export interface RunningSourceRouter {
	accept(event: ChannelEvent): Promise<boolean>;
	recordDelivery(channel: string, locator: string, result: ChannelRespondResult): Promise<void>;
	close(): Promise<void>;
}

/** Load one deployment-owned route. Native sources never select an agent URL. */
export async function loadSourceRouter(path: string): Promise<RunningSourceRouter> {
	if (!isAbsolute(path)) throw new Error("A2A_SOURCE_ROUTER_FILE must be an absolute path");
	const stat = await import("node:fs/promises").then((fs) => fs.stat(path));
	if (stat.size > MAX_CONFIG_BYTES) throw new Error("A2A source router file is too large");
	const value = JSON.parse(await readFile(path, "utf8")) as SourceRouterDocument;
	if (!value || typeof value !== "object") throw new Error("A2A source router file is invalid");
	if (!isAbsolute(value.outboxPath)) throw new Error("A2A source outbox path must be absolute");
	const retryMs = value.retryMs ?? DEFAULT_RETRY_MS;
	if (!Number.isSafeInteger(retryMs) || retryMs < 1) {
		throw new Error("A2A source router retryMs must be a positive integer");
	}
	return await SourceRouter.start(
		new A2aClient({
			baseUrl: value.baseUrl,
			token: value.token,
			...(value.allowInsecureLoopback === undefined
				? {}
				: { allowInsecureLoopback: value.allowInsecureLoopback }),
		}),
		value.outboxPath,
		retryMs,
		new HttpDeliveryReporter(value.traceUrl, value.token),
	);
}

/** Durable at-least-once bridge from native events to idempotent A2A sends. */
export class SourceRouter implements RunningSourceRouter {
	readonly #client: Pick<A2aClient, "sendMessage">;
	readonly #path: string;
	readonly #retryMs: number;
	readonly #reporter: DeliveryReporter | undefined;
	#entries: OutboxEntry[] = [];
	#delivered: OutboxEntry[] = [];
	#operations: Promise<unknown> = Promise.resolve();
	#draining: Promise<void> | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#closed = false;

	private constructor(
		client: Pick<A2aClient, "sendMessage">,
		path: string,
		retryMs: number,
		reporter?: DeliveryReporter,
	) {
		this.#client = client;
		this.#path = path;
		this.#retryMs = retryMs;
		this.#reporter = reporter;
	}

	static async start(
		client: Pick<A2aClient, "sendMessage">,
		path: string,
		retryMs = DEFAULT_RETRY_MS,
		reporter?: DeliveryReporter,
	): Promise<SourceRouter> {
		const router = new SourceRouter(client, path, retryMs, reporter);
		await router.#initialize();
		router.#schedule(0);
		return router;
	}

	async accept(event: ChannelEvent): Promise<boolean> {
		if (this.#closed) return false;
		if (!event.work) throw new Error(`channel "${event.channel}" did not provide A2A work`);
		const entry = makeEntry(event.channel, event.work);
		await this.#run(async () => {
			const delivered = this.#delivered.find((candidate) => candidate.id === entry.id);
			if (delivered) {
				if (!sameSourceRequest(delivered.request, entry.request)) {
					throw new Error(`source event "${entry.id}" conflicts with its delivery receipt`);
				}
				return;
			}
			const prior = this.#entries.find((candidate) => candidate.id === entry.id);
			if (prior) {
				if (!sameSourceRequest(prior.request, entry.request)) {
					throw new Error(`source event "${entry.id}" conflicts with its queued request`);
				}
				return;
			}
			this.#entries.push(entry);
			await this.#persist();
		});
		this.#schedule(0);
		return true;
	}

	async recordDelivery(
		channel: string,
		locator: string,
		result: ChannelRespondResult,
	): Promise<void> {
		await this.#run(async () => {
			const index = this.#delivered.findLastIndex(
				(entry) => entry.channel === channel && entry.locator === locator && entry.taskId,
			);
			const receipt = this.#delivered[index];
			if (!receipt?.taskId) throw new Error("A2A task receipt was not found for native delivery");
			const attemptCount = (receipt.delivery?.attemptCount ?? 0) + 1;
			const delivery: NativeDeliveryReport = {
				sourceKind: channel,
				providerEventId: receipt.providerEventId,
				state: result.handled ? "delivered" : "failed",
				attemptCount,
				...(result.responseId ? { responseId: result.responseId } : {}),
				...(!result.handled ? { errorCode: "native-handle-failed" } : {}),
			};
			this.#delivered[index] = { ...receipt, delivery, deliveryReported: false };
			await this.#persist();
		});
		this.#schedule(0);
	}

	async close(): Promise<void> {
		this.#closed = true;
		if (this.#timer) clearTimeout(this.#timer);
		await this.#draining?.catch(() => {});
		await this.#operations;
	}

	async #initialize(): Promise<void> {
		await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
		await chmod(dirname(this.#path), 0o700);
		try {
			const value = JSON.parse(await readFile(this.#path, "utf8")) as OutboxDocument;
			if (value.version !== 1 || !Array.isArray(value.entries)) {
				throw new Error("A2A source outbox is invalid");
			}
			this.#entries = [...value.entries];
			this.#delivered = [...(value.delivered ?? [])];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		await this.#persist();
	}

	#schedule(delay: number): void {
		if (this.#closed || this.#timer || this.#draining || !this.#hasWork()) return;
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			this.#draining = this.#drain().finally(() => {
				this.#draining = undefined;
				if (this.#hasWork()) this.#schedule(this.#retryMs);
			});
		}, delay);
		this.#timer.unref();
	}

	async #drain(): Promise<void> {
		while (!this.#closed && this.#entries.length > 0) {
			const entry = this.#entries[0];
			if (!entry) return;
			let taskId: string;
			try {
				const response = await this.#client.sendMessage(entry.request);
				if (!("task" in response)) throw new Error("source route returned no A2A Task");
				taskId = response.task.id;
			} catch {
				return;
			}
			await this.#run(async () => {
				if (this.#entries[0]?.id !== entry.id) return;
				this.#entries.shift();
				this.#delivered.push({ ...entry, taskId });
				if (this.#delivered.length > MAX_RECEIPTS) {
					this.#delivered.splice(0, this.#delivered.length - MAX_RECEIPTS);
				}
				await this.#persist();
			});
		}
		await this.#reportDeliveries();
	}

	async #reportDeliveries(): Promise<void> {
		if (!this.#reporter) return;
		for (const receipt of this.#delivered) {
			if (!receipt.taskId || !receipt.delivery || receipt.deliveryReported) continue;
			try {
				await this.#reporter.report(receipt.taskId, receipt.delivery);
			} catch {
				return;
			}
			await this.#run(async () => {
				const index = this.#delivered.findIndex((entry) => entry.id === receipt.id);
				if (index < 0) return;
				this.#delivered[index] = {
					...this.#delivered[index],
					deliveryReported: true,
				} as OutboxEntry;
				await this.#persist();
			});
		}
	}

	#hasWork(): boolean {
		return (
			this.#entries.length > 0 ||
			Boolean(
				this.#reporter &&
					this.#delivered.some(
						(entry) => entry.taskId && entry.delivery && !entry.deliveryReported,
					),
			)
		);
	}

	async #run<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.#operations.then(operation, operation);
		this.#operations = result;
		return result;
	}

	async #persist(): Promise<void> {
		const temporary = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
		let handle: Awaited<ReturnType<typeof open>> | undefined;
		try {
			handle = await open(temporary, "wx", 0o600);
			await handle.writeFile(
				`${JSON.stringify({ version: 1, entries: this.#entries, delivered: this.#delivered })}\n`,
				"utf8",
			);
			await handle.sync();
			await handle.close();
			handle = undefined;
			await rename(temporary, this.#path);
		} finally {
			await handle?.close().catch(() => {});
			await unlink(temporary).catch(() => {});
		}
	}
}

function makeEntry(sourceKind: string, work: ChannelWork): OutboxEntry {
	const id = hash(`${sourceKind}\0${work.providerEventId}`);
	const input = {
		sourceKind,
		providerEventId: work.providerEventId,
		nativeLocator: work.nativeLocator,
		receivedAt: work.receivedAt,
		dedupeKey: work.dedupeKey,
		contentDigest: digestParts(work.parts),
		...(work.correlationKey ? { correlationKey: work.correlationKey } : {}),
		sourceSummary: work.sourceSummary,
		...(work.nativeUrl ? { nativeUrl: work.nativeUrl } : {}),
	};
	return {
		id,
		channel: sourceKind,
		providerEventId: work.providerEventId,
		...(typeof work.nativeLocator.channelLocator === "string"
			? { locator: work.nativeLocator.channelLocator }
			: {}),
		request: {
			message: {
				messageId: `source-${id}`,
				role: "ROLE_USER",
				parts: work.parts,
				extensions: [OUTFITTER_ORIGIN_EXTENSION_URI],
				metadata: activationMetadata(input),
			},
			configuration: { returnImmediately: true },
		},
	};
}

class HttpDeliveryReporter implements DeliveryReporter {
	readonly #baseUrl: URL;
	readonly #token: string;

	constructor(baseUrl: string, token: string) {
		this.#baseUrl = secureBaseUrl(baseUrl);
		this.#token = token;
	}

	async report(taskId: string, delivery: NativeDeliveryReport): Promise<void> {
		const response = await fetch(
			new URL(`./v1/trace/tasks/${encodeURIComponent(taskId)}/delivery`, this.#baseUrl),
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${this.#token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(delivery),
				signal: AbortSignal.timeout(60_000),
			},
		);
		await response.body?.cancel();
		if (!response.ok) throw new Error(`native delivery trace returned HTTP ${response.status}`);
	}
}

function secureBaseUrl(value: string): URL {
	const url = new URL(value);
	const loopback =
		url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "localhost";
	if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
		throw new Error("A2A traceUrl must use HTTPS outside loopback");
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new Error("A2A traceUrl must not contain credentials, a query, or a fragment");
	}
	url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
	return url;
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 48);
}

function sameSourceRequest(left: A2aSendMessageRequest, right: A2aSendMessageRequest): boolean {
	const normalized = (request: A2aSendMessageRequest) => {
		const metadata = request.message.metadata?.["outfitter-origin/v1"];
		if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return request;
		return {
			...request,
			message: {
				...request.message,
				metadata: {
					...request.message.metadata,
					"outfitter-origin/v1": { ...metadata, receivedAt: undefined },
				},
			},
		};
	};
	return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}
