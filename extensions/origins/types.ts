import { createHash } from "node:crypto";
import type { A2aMessage, A2aPart } from "../a2a/types.ts";

export const OUTFITTER_ORIGIN_EXTENSION_URI =
	"https://github.com/ai-outfitter/channels/a2a-extensions/outfitter-origin/v1" as const;
export const OUTFITTER_ORIGIN_METADATA_KEY = "outfitter-origin/v1" as const;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/;
const KIND_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const LOCATOR_KEY_PATTERN = /^[a-z][a-zA-Z0-9]{0,63}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export interface ChannelActivationInput {
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
}

export interface ChannelActivation extends ChannelActivationInput {
	readonly id: string;
	readonly sourcePrincipal: string;
	readonly recordedAt: string;
}

export type RoutingAction = "ignore" | "create" | "continue" | "split";

export interface RoutingDecision {
	readonly id: string;
	readonly activationId: string;
	readonly action: RoutingAction;
	readonly reasonCode: string;
	readonly decider: {
		readonly kind: "policy" | "agent";
		readonly id: string;
		readonly version: string;
	};
	readonly decidedAt: string;
}

export interface TaskLocator {
	readonly agentInterface: string;
	readonly protocolBinding: "HTTP+JSON";
	readonly protocolVersion: string;
	readonly tenant?: string;
	readonly taskId: string;
}

export interface TaskOrigin {
	readonly id: string;
	readonly activationId: string;
	readonly sourcePrincipal: string;
	readonly relation: "created" | "continued";
	readonly task: TaskLocator;
	readonly recordedAt: string;
}

/** Every state a native delivery can hold; the union below derives from it. */
export const NATIVE_DELIVERY_STATES = ["pending", "delivered", "failed", "not-applicable"] as const;

export type NativeDeliveryStateName = (typeof NATIVE_DELIVERY_STATES)[number];

export function isNativeDeliveryState(value: unknown): value is NativeDeliveryStateName {
	return NATIVE_DELIVERY_STATES.includes(value as NativeDeliveryStateName);
}

export interface NativeDeliveryState {
	readonly task: TaskLocator;
	readonly activationId: string;
	readonly state: NativeDeliveryStateName;
	readonly attemptCount: number;
	readonly updatedAt: string;
	readonly responseId?: string;
	readonly errorCode?: string;
}

export interface ActivationTrace {
	readonly activation: ChannelActivation;
	readonly decision?: RoutingDecision;
	readonly origins: readonly TaskOrigin[];
}

export interface TaskTrace {
	readonly task: TaskLocator;
	readonly origins: readonly {
		readonly activation: ChannelActivation;
		readonly decision?: RoutingDecision;
		readonly origin: TaskOrigin;
		readonly delivery?: NativeDeliveryState;
	}[];
}

export function activationMetadata(input: ChannelActivationInput): Record<string, unknown> {
	return { [OUTFITTER_ORIGIN_METADATA_KEY]: validateActivationInput(input) };
}

export function activationFromMessage(message: A2aMessage): ChannelActivationInput | undefined {
	const value = message.metadata?.[OUTFITTER_ORIGIN_METADATA_KEY];
	if (value === undefined) return undefined;
	if (!message.extensions?.includes(OUTFITTER_ORIGIN_EXTENSION_URI)) {
		throw new Error("source activation metadata requires the outfitter-origin/v1 extension URI");
	}
	const input = validateActivationInput(value);
	if (input.contentDigest !== digestParts(message.parts)) {
		throw new Error("source activation contentDigest does not match the A2A message parts");
	}
	return input;
}

export function digestParts(parts: readonly A2aPart[]): string {
	return `sha256:${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}

export function validateActivationInput(value: unknown): ChannelActivationInput {
	const record = object(value, "source activation");
	const allowed = [
		"sourceKind",
		"providerEventId",
		"nativeLocator",
		"receivedAt",
		"dedupeKey",
		"contentDigest",
		"correlationKey",
		"sourceSummary",
		"nativeUrl",
		"evidenceLocator",
	];
	const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
	if (unknown.length > 0) throw new Error(`source activation has unknown field "${unknown[0]}"`);
	const sourceKind = string(record.sourceKind, "sourceKind", 64);
	if (!KIND_PATTERN.test(sourceKind)) throw new Error("sourceKind is invalid");
	const receivedAt = string(record.receivedAt, "receivedAt", 64);
	if (!Number.isFinite(Date.parse(receivedAt)))
		throw new Error("receivedAt must be an ISO date-time");
	const contentDigest = string(record.contentDigest, "contentDigest", 71);
	if (!DIGEST_PATTERN.test(contentDigest))
		throw new Error("contentDigest must be a SHA-256 digest");
	const nativeLocator = locator(record.nativeLocator);
	const nativeUrl = optionalString(record.nativeUrl, "nativeUrl", 2_048);
	if (nativeUrl && new URL(nativeUrl).protocol !== "https:")
		throw new Error("nativeUrl must use HTTPS");
	return {
		sourceKind,
		providerEventId: identifier(record.providerEventId, "providerEventId"),
		nativeLocator,
		receivedAt: new Date(receivedAt).toISOString(),
		dedupeKey: identifier(record.dedupeKey, "dedupeKey"),
		contentDigest,
		...(record.correlationKey === undefined
			? {}
			: { correlationKey: identifier(record.correlationKey, "correlationKey") }),
		sourceSummary: string(record.sourceSummary, "sourceSummary", 256),
		...(nativeUrl ? { nativeUrl } : {}),
		...(record.evidenceLocator === undefined
			? {}
			: { evidenceLocator: string(record.evidenceLocator, "evidenceLocator", 2_048) }),
	};
}

function locator(value: unknown): Readonly<Record<string, string>> {
	const record = object(value, "nativeLocator");
	const entries = Object.entries(record);
	if (entries.length === 0 || entries.length > 32) {
		throw new Error("nativeLocator must contain 1-32 fields");
	}
	return Object.fromEntries(
		entries.map(([key, item]) => {
			if (!LOCATOR_KEY_PATTERN.test(key)) throw new Error(`nativeLocator key "${key}" is invalid`);
			return [key, string(item, `nativeLocator.${key}`, 1_024)];
		}),
	);
}

function identifier(value: unknown, label: string): string {
	const result = string(value, label, 512);
	if (!ID_PATTERN.test(result)) throw new Error(`${label} is invalid`);
	return result;
}

function optionalString(value: unknown, label: string, maximum: number): string | undefined {
	return value === undefined ? undefined : string(value, label, maximum);
}

function string(value: unknown, label: string, maximum: number): string {
	if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
		throw new Error(`${label} must be a non-empty string of at most ${maximum} characters`);
	}
	return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}
