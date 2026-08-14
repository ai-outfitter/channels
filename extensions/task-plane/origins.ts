import { derivedId } from "./serialize.ts";
import { JsonStore, parseVersion1 } from "./stores.ts";
import type { NativeActivation } from "./types.ts";

interface StoredActivation {
	readonly id: string;
	readonly sourcePrincipal: string;
	readonly sourceKind: string;
	readonly providerEventId: string;
	readonly nativeLocator: Readonly<Record<string, string>>;
	readonly receivedAt: string;
	readonly dedupeKey: string;
	readonly contentDigest: string;
	readonly correlationKey?: string;
	readonly sourceSummary: string;
	readonly nativeUrl?: string;
	readonly evidenceLocator?: string;
	readonly recordedAt: string;
}

interface StoredOrigin {
	readonly id: string;
	readonly activationId: string;
	readonly sourcePrincipal: string;
	readonly relation: "created" | "continued";
	readonly task: {
		readonly agentInterface: string;
		readonly protocolBinding: "HTTP+JSON";
		readonly protocolVersion: "1.0";
		readonly taskId: string;
	};
	readonly recordedAt: string;
}

interface OriginStoreData {
	readonly version: 1;
	activations: Record<string, StoredActivation>;
	decisions: Record<string, unknown>;
	origins: Record<string, StoredOrigin>;
	deliveries: Record<string, unknown>;
}

/**
 * The deployed version-1 origin shape is deliberately retained. New delivery
 * state lives in its own file; these fields stay present so a prior binary can
 * still read every pre-existing origin before the first new acceptance.
 */
export class OriginStore extends JsonStore<OriginStoreData> {
	constructor(path: string) {
		super(path, { version: 1, activations: {}, decisions: {}, origins: {}, deliveries: {} });
	}

	protected parse(value: unknown): OriginStoreData {
		return parseVersion1(value, "origin store", {
			activations: "record",
			decisions: "record",
			origins: "record",
			deliveries: "record",
		});
	}

	async project(
		activationId: string,
		input: NativeActivation,
		taskId: string,
		relation: "created" | "continued",
		agentInterface: string,
	): Promise<void> {
		return this.run(async () => {
			const activation = this.data.activations[activationId];
			if (
				activation &&
				JSON.stringify(projectActivation(input)) !== JSON.stringify(stripStored(activation))
			) {
				throw new Error("activation conflicts with its durable claim");
			}
			this.data.activations[activationId] ??= {
				...projectActivation(input),
				id: activationId,
				sourcePrincipal: input.principal,
				recordedAt: new Date().toISOString(),
			};
			const taskKey = [agentInterface, "HTTP+JSON", "1.0", "", taskId].join("\0");
			const id = derivedId("origin", `${activationId}\0${taskKey}`);
			const prior = this.data.origins[id];
			if (prior && prior.relation !== relation) throw new Error("origin relation conflicts");
			this.data.origins[id] ??= {
				id,
				activationId,
				sourcePrincipal: input.principal,
				relation,
				task: {
					agentInterface,
					protocolBinding: "HTTP+JSON",
					protocolVersion: "1.0",
					taskId,
				},
				recordedAt: new Date().toISOString(),
			};
			await this.persist();
		});
	}
}

function stripStored(value: StoredActivation): Omit<StoredActivation, "id" | "recordedAt"> {
	const { id: _id, recordedAt: _recordedAt, ...input } = value;
	return input;
}

function projectActivation(input: NativeActivation): Omit<StoredActivation, "id" | "recordedAt"> {
	return {
		sourcePrincipal: input.principal,
		sourceKind: input.source,
		providerEventId: input.providerEventId,
		nativeLocator: input.nativeLocator,
		receivedAt: input.receivedAt,
		dedupeKey: input.providerDedupeKey,
		contentDigest: input.contentDigest,
		...(input.conversationKey ? { correlationKey: input.conversationKey } : {}),
		sourceSummary: input.providerEventId,
		...(input.nativeDisplayUrl ? { nativeUrl: input.nativeDisplayUrl } : {}),
		...(input.evidenceLocator ? { evidenceLocator: input.evidenceLocator } : {}),
	};
}
