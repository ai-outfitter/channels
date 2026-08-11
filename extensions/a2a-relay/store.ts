import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { validateIdentifier } from "../a2a/types.ts";

const MAX_PENDING_PER_AGENT = 10_000;

export interface A2aRelayLease {
	readonly id: string;
	readonly worker: string;
	readonly expiresAt: string;
}

export interface A2aRelayDelivery {
	readonly taskId: string;
	readonly agentId: string;
	readonly queuedAt: string;
	readonly lease?: A2aRelayLease;
}

interface A2aRelayStoreData {
	readonly version: 1;
	deliveries: Record<string, A2aRelayDelivery>;
}

/** Durable, leased, body-free delivery queue for relay-owned A2A tasks. */
export class A2aRelayStore {
	readonly #path: string;
	#data: A2aRelayStoreData = { version: 1, deliveries: {} };
	#initialized: Promise<void> | undefined;
	#operations: Promise<unknown> = Promise.resolve();
	#closed = false;

	constructor(path: string) {
		if (!path) throw new Error("A2A relay store path is required");
		this.#path = path;
	}

	async initialize(): Promise<void> {
		if (this.#closed) throw new Error("A2A relay store is closed");
		if (!this.#initialized) {
			this.#initialized = (async () => {
				await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
				await chmod(dirname(this.#path), 0o700);
				try {
					this.#data = parseStore(JSON.parse(await readFile(this.#path, "utf8")) as unknown);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				await this.#persist();
			})();
		}
		await this.#initialized;
	}

	async enqueue(taskId: string, agentId: string): Promise<A2aRelayDelivery> {
		return this.#run(async () => {
			const task = validateIdentifier(taskId, "task id");
			const agent = validateIdentifier(agentId, "agent id");
			const prior = this.#data.deliveries[task];
			if (prior) {
				if (prior.agentId !== agent) throw new Error(`task "${task}" is queued for another agent`);
				return prior;
			}
			const count = Object.values(this.#data.deliveries).filter(
				(delivery) => delivery.agentId === agent,
			).length;
			if (count >= MAX_PENDING_PER_AGENT) {
				throw new Error(`A2A relay queue for agent "${agent}" is full`);
			}
			const delivery: A2aRelayDelivery = {
				taskId: task,
				agentId: agent,
				queuedAt: new Date().toISOString(),
			};
			this.#data.deliveries[task] = delivery;
			await this.#persist();
			return delivery;
		});
	}

	async claim(
		agentIds: readonly string[],
		worker: string,
		leaseMs: number,
		now = Date.now(),
	): Promise<A2aRelayDelivery | undefined> {
		return this.#run(async () => {
			const allowed = new Set(agentIds.map((id) => validateIdentifier(id, "agent id")));
			const workerId = validateIdentifier(worker, "worker id");
			const delivery = Object.values(this.#data.deliveries)
				.filter((candidate) => allowed.has(candidate.agentId))
				.filter((candidate) => !candidate.lease || Date.parse(candidate.lease.expiresAt) <= now)
				.sort(
					(left, right) =>
						left.queuedAt.localeCompare(right.queuedAt) || left.taskId.localeCompare(right.taskId),
				)[0];
			if (!delivery) return undefined;
			const claimed: A2aRelayDelivery = {
				...delivery,
				lease: {
					id: randomUUID(),
					worker: workerId,
					expiresAt: new Date(now + leaseMs).toISOString(),
				},
			};
			this.#data.deliveries[claimed.taskId] = claimed;
			await this.#persist();
			return claimed;
		});
	}

	async requireLease(taskId: string, worker: string, leaseId: string): Promise<A2aRelayDelivery> {
		return this.#run(async () => this.#requireCurrentLease(taskId, worker, leaseId));
	}

	async renew(
		taskId: string,
		worker: string,
		leaseId: string,
		leaseMs: number,
	): Promise<A2aRelayDelivery> {
		return this.#run(async () => {
			const delivery = this.#requireCurrentLease(taskId, worker, leaseId);
			const renewed: A2aRelayDelivery = {
				...delivery,
				lease: { ...delivery.lease, expiresAt: new Date(Date.now() + leaseMs).toISOString() },
			};
			this.#data.deliveries[delivery.taskId] = renewed;
			await this.#persist();
			return renewed;
		});
	}

	async release(taskId: string, worker: string, leaseId: string): Promise<void> {
		return this.#run(async () => {
			const delivery = this.#requireCurrentLease(taskId, worker, leaseId);
			this.#data.deliveries[delivery.taskId] = {
				taskId: delivery.taskId,
				agentId: delivery.agentId,
				queuedAt: delivery.queuedAt,
			};
			await this.#persist();
		});
	}

	async finish(taskId: string, worker: string, leaseId: string): Promise<void> {
		return this.#run(async () => {
			const delivery = this.#requireCurrentLease(taskId, worker, leaseId);
			delete this.#data.deliveries[delivery.taskId];
			await this.#persist();
		});
	}

	async pending(): Promise<readonly A2aRelayDelivery[]> {
		return this.#run(async () => Object.values(this.#data.deliveries));
	}

	close(): void {
		this.#closed = true;
	}

	#requireCurrentLease(
		taskId: string,
		worker: string,
		leaseId: string,
	): A2aRelayDelivery & {
		readonly lease: A2aRelayLease;
	} {
		const delivery = this.#data.deliveries[validateIdentifier(taskId, "task id")];
		if (
			!delivery?.lease ||
			delivery.lease.worker !== validateIdentifier(worker, "worker id") ||
			delivery.lease.id !== validateIdentifier(leaseId, "lease id") ||
			Date.parse(delivery.lease.expiresAt) <= Date.now()
		) {
			throw new Error("task lease is missing, expired, or owned by another worker");
		}
		return delivery as A2aRelayDelivery & { readonly lease: A2aRelayLease };
	}

	async #run<T>(operation: () => Promise<T>): Promise<T> {
		await this.initialize();
		const result = this.#operations.then(operation, operation);
		this.#operations = result;
		return result;
	}

	async #persist(): Promise<void> {
		const temporary = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
		let handle: Awaited<ReturnType<typeof open>> | undefined;
		try {
			handle = await open(temporary, "wx", 0o600);
			await handle.writeFile(`${JSON.stringify(this.#data)}\n`, "utf8");
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

function parseStore(value: unknown): A2aRelayStoreData {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("invalid A2A relay store");
	}
	const record = value as Partial<A2aRelayStoreData>;
	if (record.version !== 1 || !record.deliveries || typeof record.deliveries !== "object") {
		throw new Error("unsupported A2A relay store version");
	}
	const deliveries: Record<string, A2aRelayDelivery> = {};
	for (const [taskId, raw] of Object.entries(record.deliveries)) {
		deliveries[taskId] = parseDelivery(taskId, raw);
	}
	return { version: 1, deliveries };
}

function parseDelivery(taskId: string, value: unknown): A2aRelayDelivery {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("invalid A2A relay delivery");
	}
	const record = value as Partial<A2aRelayDelivery>;
	if (
		record.taskId !== taskId ||
		typeof record.agentId !== "string" ||
		!validDate(record.queuedAt)
	) {
		throw new Error("invalid A2A relay delivery");
	}
	validateIdentifier(record.taskId, "task id");
	validateIdentifier(record.agentId, "agent id");
	return {
		taskId: record.taskId,
		agentId: record.agentId,
		queuedAt: record.queuedAt,
		...(record.lease === undefined ? {} : { lease: parseLease(record.lease) }),
	};
}

function parseLease(value: unknown): A2aRelayLease {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("invalid A2A relay lease");
	}
	const record = value as Partial<A2aRelayLease>;
	if (
		typeof record.id !== "string" ||
		typeof record.worker !== "string" ||
		!validDate(record.expiresAt)
	) {
		throw new Error("invalid A2A relay lease");
	}
	return {
		id: validateIdentifier(record.id, "lease id"),
		worker: validateIdentifier(record.worker, "worker id"),
		expiresAt: record.expiresAt,
	};
}

function validDate(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}
