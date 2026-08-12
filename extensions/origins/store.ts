import { createHash } from "node:crypto";
import { chmod, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isTimestamp } from "../a2a/types.ts";
import { writeFileAtomically } from "../durable-file.ts";
import type {
	ActivationTrace,
	ChannelActivation,
	ChannelActivationInput,
	NativeDeliveryState,
	RoutingDecision,
	TaskLocator,
	TaskOrigin,
	TaskTrace,
} from "./types.ts";
import { isNativeDeliveryState, validateActivationInput } from "./types.ts";

interface OriginStoreData {
	readonly version: 1;
	activations: Record<string, ChannelActivation>;
	decisions: Record<string, RoutingDecision>;
	origins: Record<string, TaskOrigin>;
	deliveries: Record<string, NativeDeliveryState>;
}

export interface RoutingDecisionInput {
	readonly action: RoutingDecision["action"];
	readonly reasonCode: string;
	readonly decider: RoutingDecision["decider"];
}

export interface NativeDeliveryInput {
	readonly state: NativeDeliveryState["state"];
	readonly attemptCount: number;
	readonly responseId?: string;
	readonly errorCode?: string;
}

/** Durable source-to-task graph. Activation records are immutable. */
export class OriginStore {
	readonly #path: string;
	#data: OriginStoreData = {
		version: 1,
		activations: {},
		decisions: {},
		origins: {},
		deliveries: {},
	};
	#initialized: Promise<void> | undefined;
	#operations: Promise<unknown> = Promise.resolve();
	#closed = false;

	constructor(path: string) {
		if (!path) throw new Error("origin store path is required");
		this.#path = path;
	}

	async initialize(): Promise<void> {
		if (this.#closed) throw new Error("origin store is closed");
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

	async recordActivation(
		sourcePrincipal: string,
		input: ChannelActivationInput,
	): Promise<ChannelActivation> {
		return this.#run(async () => {
			const validated = validateActivationInput(input);
			const id = activationId(sourcePrincipal, validated.sourceKind, validated.providerEventId);
			const prior = this.#data.activations[id];
			if (prior) {
				if (!sameActivation(prior, sourcePrincipal, validated)) {
					throw new Error(
						`source event "${validated.providerEventId}" conflicts with its activation`,
					);
				}
				return prior;
			}
			const activation: ChannelActivation = {
				...validated,
				id,
				sourcePrincipal,
				recordedAt: new Date().toISOString(),
			};
			this.#data.activations[id] = activation;
			await this.#persist();
			return activation;
		});
	}

	async recordDecision(
		activationId: string,
		input: RoutingDecisionInput,
	): Promise<RoutingDecision> {
		return this.#run(async () => {
			if (!this.#data.activations[activationId]) throw new Error("activation was not found");
			validateDecisionInput(input);
			const prior = this.#data.decisions[activationId];
			if (prior) {
				if (
					prior.action !== input.action ||
					prior.reasonCode !== input.reasonCode ||
					JSON.stringify(prior.decider) !== JSON.stringify(input.decider)
				) {
					throw new Error(`activation "${activationId}" already has another routing decision`);
				}
				return prior;
			}
			const decision: RoutingDecision = {
				id: `decision-${activationId.slice("activation-".length)}`,
				activationId,
				...input,
				decidedAt: new Date().toISOString(),
			};
			this.#data.decisions[activationId] = decision;
			await this.#persist();
			return decision;
		});
	}

	async recordOrigin(
		activationId: string,
		relation: TaskOrigin["relation"],
		task: TaskLocator,
	): Promise<TaskOrigin> {
		return this.#run(async () => {
			const activation = this.#data.activations[activationId];
			if (!activation) throw new Error("activation was not found");
			validateTaskLocator(task);
			const id = originId(activationId, task);
			const prior = this.#data.origins[id];
			if (prior) {
				if (prior.relation !== relation) throw new Error(`origin "${id}" has another relation`);
				return prior;
			}
			const origin: TaskOrigin = {
				id,
				activationId,
				sourcePrincipal: activation.sourcePrincipal,
				relation,
				task,
				recordedAt: new Date().toISOString(),
			};
			this.#data.origins[id] = origin;
			await this.#persist();
			return origin;
		});
	}

	async recordDelivery(
		activationId: string,
		task: TaskLocator,
		input: NativeDeliveryInput,
	): Promise<NativeDeliveryState> {
		return this.#run(async () => {
			if (!this.#data.activations[activationId]) throw new Error("activation was not found");
			validateTaskLocator(task);
			validateDeliveryInput(input);
			const key = deliveryKey(activationId, task);
			const prior = this.#data.deliveries[key];
			if (prior && input.attemptCount < prior.attemptCount) {
				throw new Error("native delivery attemptCount cannot decrease");
			}
			const delivery: NativeDeliveryState = {
				task,
				activationId,
				...input,
				updatedAt: new Date().toISOString(),
			};
			this.#data.deliveries[key] = delivery;
			await this.#persist();
			return delivery;
		});
	}

	async correlatedTask(
		sourcePrincipal: string,
		sourceKind: string,
		correlationKey: string,
	): Promise<TaskLocator | undefined> {
		return this.#run(
			async () =>
				Object.values(this.#data.origins)
					.filter((origin) => origin.sourcePrincipal === sourcePrincipal)
					.filter((origin) => {
						const activation = this.#data.activations[origin.activationId];
						return (
							activation?.sourceKind === sourceKind && activation.correlationKey === correlationKey
						);
					})
					.sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))[0]?.task,
		);
	}

	async originForNativeLocator(
		sourcePrincipal: string,
		sourceKind: string,
		channelLocator: string,
	): Promise<{ readonly activation: ChannelActivation; readonly origin: TaskOrigin } | undefined> {
		return this.#run(async () => {
			const activation = Object.values(this.#data.activations)
				.filter((candidate) => candidate.sourcePrincipal === sourcePrincipal)
				.filter((candidate) => candidate.sourceKind === sourceKind)
				.filter((candidate) => candidate.nativeLocator.channelLocator === channelLocator)
				.sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))[0];
			if (!activation) return undefined;
			const origin = Object.values(this.#data.origins)
				.filter((candidate) => candidate.activationId === activation.id)
				.sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))[0];
			return origin ? { activation, origin } : undefined;
		});
	}

	async activationTrace(
		allowedPrincipals: ReadonlySet<string>,
		activationId: string,
	): Promise<ActivationTrace | undefined> {
		return this.#run(async () => {
			const activation = this.#data.activations[activationId];
			if (!activation || !allowedPrincipals.has(activation.sourcePrincipal)) return undefined;
			return {
				activation,
				...(this.#data.decisions[activationId]
					? { decision: this.#data.decisions[activationId] }
					: {}),
				origins: Object.values(this.#data.origins).filter(
					(origin) => origin.activationId === activationId,
				),
			};
		});
	}

	async taskTrace(
		allowedPrincipals: ReadonlySet<string>,
		task: TaskLocator,
	): Promise<TaskTrace | undefined> {
		return this.#run(async () => {
			const origins = Object.values(this.#data.origins).filter(
				(origin) =>
					taskKey(origin.task) === taskKey(task) && allowedPrincipals.has(origin.sourcePrincipal),
			);
			if (origins.length === 0) return undefined;
			return {
				task,
				origins: origins.map((origin) => ({
					activation: this.#data.activations[origin.activationId] as ChannelActivation,
					...(this.#data.decisions[origin.activationId]
						? { decision: this.#data.decisions[origin.activationId] }
						: {}),
					origin,
					...(this.#data.deliveries[deliveryKey(origin.activationId, task)]
						? { delivery: this.#data.deliveries[deliveryKey(origin.activationId, task)] }
						: {}),
				})),
			};
		});
	}

	close(): void {
		this.#closed = true;
	}

	async #run<T>(operation: () => Promise<T>): Promise<T> {
		await this.initialize();
		const result = this.#operations.then(operation, operation);
		this.#operations = result;
		return result;
	}

	async #persist(): Promise<void> {
		await writeFileAtomically(this.#path, `${JSON.stringify(this.#data)}\n`);
	}
}

function activationId(principal: string, sourceKind: string, providerEventId: string): string {
	return `activation-${hash(`${principal}\0${sourceKind}\0${providerEventId}`).slice(0, 40)}`;
}

function originId(activationId: string, task: TaskLocator): string {
	return `origin-${hash(`${activationId}\0${taskKey(task)}`).slice(0, 40)}`;
}

function taskKey(task: TaskLocator): string {
	return `${task.agentInterface}\0${task.protocolBinding}\0${task.protocolVersion}\0${task.tenant ?? ""}\0${task.taskId}`;
}

function deliveryKey(activationId: string, task: TaskLocator): string {
	return `${activationId}\0${taskKey(task)}`;
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function sameActivation(
	prior: ChannelActivation,
	principal: string,
	input: ChannelActivationInput,
): boolean {
	const {
		id: _id,
		sourcePrincipal: _sourcePrincipal,
		recordedAt: _recordedAt,
		...priorInput
	} = prior;
	return (
		prior.sourcePrincipal === principal && JSON.stringify(priorInput) === JSON.stringify(input)
	);
}

function validateDecisionInput(input: RoutingDecisionInput): void {
	if (!["ignore", "create", "continue", "split"].includes(input.action)) {
		throw new Error("routing action is invalid");
	}
	for (const [label, value] of [
		["reasonCode", input.reasonCode],
		["decider.id", input.decider.id],
		["decider.version", input.decider.version],
	] as const) {
		if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error(`${label} is invalid`);
	}
	if (input.decider.kind !== "policy" && input.decider.kind !== "agent") {
		throw new Error("routing decider kind is invalid");
	}
}

function validateTaskLocator(task: TaskLocator): void {
	const url = new URL(task.agentInterface);
	if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
		throw new Error("task agentInterface must use HTTPS outside loopback");
	}
	if (task.protocolBinding !== "HTTP+JSON") throw new Error("task protocol binding is invalid");
	if (!/^\d+\.\d+$/.test(task.protocolVersion)) throw new Error("task protocol version is invalid");
	if (!task.taskId) throw new Error("task id is required");
}

function validateDeliveryInput(input: NativeDeliveryInput): void {
	if (!isNativeDeliveryState(input.state)) throw new Error("native delivery state is invalid");
	if (!Number.isSafeInteger(input.attemptCount) || input.attemptCount < 0) {
		throw new Error("native delivery attemptCount must be a non-negative integer");
	}
	for (const [label, value] of [
		["responseId", input.responseId],
		["errorCode", input.errorCode],
	] as const) {
		if (value !== undefined && (value.length === 0 || value.length > 512)) {
			throw new Error(`${label} must contain 1-512 characters`);
		}
	}
}

function parseStore(value: unknown): OriginStoreData {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("invalid origin store");
	const record = value as Partial<OriginStoreData>;
	if (
		record.version !== 1 ||
		!record.activations ||
		!record.decisions ||
		!record.origins ||
		!record.deliveries
	) {
		throw new Error("unsupported origin store version");
	}
	for (const activation of Object.values(record.activations)) {
		validateStoredActivation(activation);
	}
	for (const [activationId, decision] of Object.entries(record.decisions)) {
		validateStoredDecision(activationId, decision, record.activations);
	}
	for (const [id, origin] of Object.entries(record.origins)) {
		validateStoredOrigin(id, origin, record.activations);
	}
	for (const [key, delivery] of Object.entries(record.deliveries)) {
		validateStoredDelivery(key, delivery, record.activations);
	}
	return record as OriginStoreData;
}

function validateStoredActivation(activation: ChannelActivation): void {
	const { id, sourcePrincipal, recordedAt, ...input } = activation;
	const validated = validateActivationInput(input);
	if (
		!id ||
		!sourcePrincipal ||
		!isTimestamp(recordedAt) ||
		id !== activationId(sourcePrincipal, validated.sourceKind, validated.providerEventId)
	) {
		throw new Error("invalid stored activation");
	}
}

function validateStoredDecision(
	activationId: string,
	decision: RoutingDecision,
	activations: Readonly<Record<string, ChannelActivation>>,
): void {
	validateDecisionInput(decision);
	if (
		decision.activationId !== activationId ||
		!activations[activationId] ||
		!decision.id ||
		!isTimestamp(decision.decidedAt)
	) {
		throw new Error("invalid stored routing decision");
	}
}

function validateStoredOrigin(
	id: string,
	origin: TaskOrigin,
	activations: Readonly<Record<string, ChannelActivation>>,
): void {
	validateTaskLocator(origin.task);
	const activation = activations[origin.activationId];
	if (
		origin.id !== id ||
		id !== originId(origin.activationId, origin.task) ||
		!activation ||
		origin.sourcePrincipal !== activation.sourcePrincipal ||
		(origin.relation !== "created" && origin.relation !== "continued") ||
		!isTimestamp(origin.recordedAt)
	) {
		throw new Error("invalid stored task origin");
	}
}

function validateStoredDelivery(
	key: string,
	delivery: NativeDeliveryState,
	activations: Readonly<Record<string, ChannelActivation>>,
): void {
	validateTaskLocator(delivery.task);
	if (
		key !== deliveryKey(delivery.activationId, delivery.task) ||
		!activations[delivery.activationId] ||
		!isNativeDeliveryState(delivery.state) ||
		!Number.isSafeInteger(delivery.attemptCount) ||
		delivery.attemptCount < 0 ||
		!isTimestamp(delivery.updatedAt)
	) {
		throw new Error("invalid stored native delivery state");
	}
}
