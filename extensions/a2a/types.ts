/**
 * A2A v1.0.1 data model for the Channels task plane (HTTP+JSON binding).
 *
 * Derived from the pinned authoritative Protocol Buffer model
 * `specification/a2a.proto` at a2aproject/A2A tag `v1.0.1`, commit
 * `3303592588e388e62e0f69f701af531d2f4e3991` (vendored at
 * `extensions/vendor/a2a/a2a.proto`, SHA-256
 * `e195bf96ab630c69797851970203e1b2b6b19528f2e9803b7d904b91a5104016`).
 * Wire names follow ProtoJSON: camelCase fields, proto enum value names.
 * A protocol upgrade past v1.0.1 is an explicit compatibility change.
 */

export const A2A_PROTOCOL_VERSION = "1.0" as const;
export const A2A_MEDIA_TYPE = "application/a2a+json" as const;
export const A2A_VERSION_HEADER = "a2a-version" as const;
export const AGENT_CARD_PATH = "/.well-known/agent-card.json" as const;

/**
 * The Outfitter task extension: the typed metadata A2A itself does not define
 * — cross-server Ticket Run lineage, the fully scoped task locator, retry and
 * supersession links, policy identity, and idempotency data. Flexible
 * metadata without a versioned schema must not become a wire contract, so the
 * schema ships versioned at `docs/extensions/outfitter-task.v1.schema.json`.
 */
export const OUTFITTER_TASK_EXTENSION_URI =
	"https://github.com/ai-outfitter/channels/a2a-extensions/outfitter-task/v1" as const;
export const OUTFITTER_TASK_METADATA_KEY = "outfitter-task/v1" as const;

export interface OutfitterTaskLocator {
	readonly agentInterface: string;
	readonly protocolBinding: "HTTP+JSON";
	readonly protocolVersion: "1.0";
	readonly tenant?: string;
	readonly taskId: string;
}

export interface OutfitterTaskMetadata {
	readonly ticketRunId: string;
	readonly task: OutfitterTaskLocator;
	readonly parent?: OutfitterTaskLocator;
	readonly retryOf?: OutfitterTaskLocator;
	readonly supersedes?: OutfitterTaskLocator;
	readonly policyDigest: string;
	readonly evidence: readonly string[];
	readonly idempotency: { readonly messageId: string; readonly scope: string };
}

export function outfitterTaskMetadata(value: OutfitterTaskMetadata): Record<string, unknown> {
	return { [OUTFITTER_TASK_METADATA_KEY]: validateOutfitterTaskMetadata(value) };
}

export function taskMetadataFromTask(task: A2aTask): OutfitterTaskMetadata {
	return validateOutfitterTaskMetadata(task.metadata?.[OUTFITTER_TASK_METADATA_KEY]);
}

export function validateOutfitterTaskMetadata(value: unknown): OutfitterTaskMetadata {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("outfitter-task/v1 metadata must be an object");
	}
	const record = value as Record<string, unknown>;
	const allowed = [
		"ticketRunId",
		"task",
		"parent",
		"retryOf",
		"supersedes",
		"policyDigest",
		"evidence",
		"idempotency",
	];
	const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
	if (unknown.length > 0) throw new Error(`outfitter-task/v1 has unknown field "${unknown[0]}"`);
	if (typeof record.ticketRunId !== "string" || record.ticketRunId.length === 0) {
		throw new Error("outfitter-task/v1 ticketRunId is required");
	}
	if (
		typeof record.policyDigest !== "string" ||
		!/^sha256:[0-9a-f]{64}$/.test(record.policyDigest)
	) {
		throw new Error("outfitter-task/v1 policyDigest is invalid");
	}
	if (!Array.isArray(record.evidence) || record.evidence.some((item) => typeof item !== "string")) {
		throw new Error("outfitter-task/v1 evidence is invalid");
	}
	const idempotency = record.idempotency as Record<string, unknown> | undefined;
	if (
		!idempotency ||
		typeof idempotency.messageId !== "string" ||
		typeof idempotency.scope !== "string"
	) {
		throw new Error("outfitter-task/v1 idempotency is invalid");
	}
	return {
		ticketRunId: record.ticketRunId,
		task: validateTaskLocator(record.task),
		...(record.parent ? { parent: validateTaskLocator(record.parent) } : {}),
		...(record.retryOf ? { retryOf: validateTaskLocator(record.retryOf) } : {}),
		...(record.supersedes ? { supersedes: validateTaskLocator(record.supersedes) } : {}),
		policyDigest: record.policyDigest,
		evidence: record.evidence as string[],
		idempotency: { messageId: idempotency.messageId, scope: idempotency.scope },
	};
}

function validateTaskLocator(value: unknown): OutfitterTaskLocator {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("outfitter task locator must be an object");
	}
	const locator = value as Record<string, unknown>;
	if (
		typeof locator.agentInterface !== "string" ||
		locator.protocolBinding !== "HTTP+JSON" ||
		locator.protocolVersion !== A2A_PROTOCOL_VERSION ||
		typeof locator.taskId !== "string"
	) {
		throw new Error("outfitter task locator is invalid");
	}
	new URL(locator.agentInterface);
	return {
		agentInterface: locator.agentInterface,
		protocolBinding: "HTTP+JSON",
		protocolVersion: A2A_PROTOCOL_VERSION,
		...(typeof locator.tenant === "string" ? { tenant: locator.tenant } : {}),
		taskId: locator.taskId,
	};
}

export const TASK_STATES = [
	"TASK_STATE_UNSPECIFIED",
	"TASK_STATE_SUBMITTED",
	"TASK_STATE_WORKING",
	"TASK_STATE_COMPLETED",
	"TASK_STATE_FAILED",
	"TASK_STATE_CANCELED",
	"TASK_STATE_INPUT_REQUIRED",
	"TASK_STATE_REJECTED",
	"TASK_STATE_AUTH_REQUIRED",
] as const;

export type A2aTaskState = (typeof TASK_STATES)[number];

/** Terminal states: the task will never change again. Subscribe rejects these. */
export const TERMINAL_TASK_STATES: readonly A2aTaskState[] = [
	"TASK_STATE_COMPLETED",
	"TASK_STATE_FAILED",
	"TASK_STATE_CANCELED",
	"TASK_STATE_REJECTED",
];

/**
 * Interrupted states: the task is paused on the caller. A blocking send
 * returns on these as well as on terminal states, and they remain
 * subscribable and continuable.
 */
export const INTERRUPTED_TASK_STATES: readonly A2aTaskState[] = [
	"TASK_STATE_INPUT_REQUIRED",
	"TASK_STATE_AUTH_REQUIRED",
];

export function isTerminal(state: A2aTaskState): boolean {
	return TERMINAL_TASK_STATES.includes(state);
}

export function isSettled(state: A2aTaskState): boolean {
	return isTerminal(state) || INTERRUPTED_TASK_STATES.includes(state);
}

export type A2aRole = "ROLE_UNSPECIFIED" | "ROLE_USER" | "ROLE_AGENT";

/** ProtoJSON `Part` oneof: exactly one of text / raw / url / data. */
export interface A2aPart {
	readonly text?: string;
	/** base64 in JSON serialization */
	readonly raw?: string;
	readonly url?: string;
	readonly data?: unknown;
	readonly metadata?: Record<string, unknown>;
	readonly filename?: string;
	readonly mediaType?: string;
}

export interface A2aMessage {
	readonly messageId: string;
	readonly contextId?: string;
	readonly taskId?: string;
	readonly role: A2aRole;
	readonly parts: readonly A2aPart[];
	readonly metadata?: Record<string, unknown>;
	readonly extensions?: readonly string[];
	readonly referenceTaskIds?: readonly string[];
}

export interface A2aArtifact {
	readonly artifactId: string;
	readonly name?: string;
	readonly description?: string;
	readonly parts: readonly A2aPart[];
	readonly metadata?: Record<string, unknown>;
	readonly extensions?: readonly string[];
}

export interface A2aTaskStatus {
	readonly state: A2aTaskState;
	readonly message?: A2aMessage;
	/** ISO 8601 */
	readonly timestamp?: string;
}

export interface A2aTask {
	readonly id: string;
	readonly contextId: string;
	readonly status: A2aTaskStatus;
	readonly artifacts?: readonly A2aArtifact[];
	readonly history?: readonly A2aMessage[];
	readonly metadata?: Record<string, unknown>;
}

export interface A2aSendMessageConfiguration {
	readonly acceptedOutputModes?: readonly string[];
	readonly historyLength?: number;
	/**
	 * ProtoJSON `return_immediately`: true returns after task creation; false
	 * (default) blocks until the task settles (terminal or interrupted).
	 */
	readonly returnImmediately?: boolean;
}

export interface A2aSendMessageRequest {
	readonly tenant?: string;
	readonly message: A2aMessage;
	readonly configuration?: A2aSendMessageConfiguration;
	readonly metadata?: Record<string, unknown>;
}

/** `SendMessageResponse` oneof payload. */
export type A2aSendMessageResponse = { readonly task: A2aTask } | { readonly message: A2aMessage };

export interface A2aTaskStatusUpdateEvent {
	readonly taskId: string;
	readonly contextId: string;
	readonly status: A2aTaskStatus;
	readonly metadata?: Record<string, unknown>;
}

export interface A2aTaskArtifactUpdateEvent {
	readonly taskId: string;
	readonly contextId: string;
	readonly artifact: A2aArtifact;
	readonly append?: boolean;
	readonly lastChunk?: boolean;
	readonly metadata?: Record<string, unknown>;
}

/** `StreamResponse` oneof payload, one JSON object per SSE `data:` line. */
export type A2aStreamResponse =
	| { readonly task: A2aTask }
	| { readonly message: A2aMessage }
	| { readonly statusUpdate: A2aTaskStatusUpdateEvent }
	| { readonly artifactUpdate: A2aTaskArtifactUpdateEvent };

/**
 * HTTP error body per binding §11.6: google.rpc.Status JSON with a
 * google.rpc.ErrorInfo detail carrying the A2A reason. (§6.4 shows
 * problem+json for the version error; §11.6 is the normative HTTP+JSON error
 * model, so this implementation uses it uniformly and records the divergence
 * in docs/a2a-task-plane.md.)
 */
export interface A2aErrorBody {
	readonly code: number;
	readonly message: string;
	readonly details: readonly [
		{
			readonly "@type": "type.googleapis.com/google.rpc.ErrorInfo";
			readonly reason: string;
			readonly domain: "a2a-protocol.org";
		},
	];
}

export class A2aError extends Error {
	readonly httpStatus: number;
	readonly reason: string;

	constructor(httpStatus: number, reason: string, message: string) {
		super(message);
		this.httpStatus = httpStatus;
		this.reason = reason;
	}

	body(): A2aErrorBody {
		return {
			code: this.httpStatus,
			message: this.message,
			details: [
				{
					"@type": "type.googleapis.com/google.rpc.ErrorInfo",
					reason: this.reason,
					domain: "a2a-protocol.org",
				},
			],
		};
	}
}

export const MAX_MESSAGE_BYTES = 256 * 1024;
export const MAX_HISTORY_MESSAGES = 200;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function validateIdentifier(value: unknown, label: string): string {
	if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
		throw new A2aError(400, "INVALID_ARGUMENT", `${label} must match ${IDENTIFIER_PATTERN}`);
	}
	return value;
}

/** Shared guard for stored timestamps: a string every store can round-trip through `Date`. */
export function isTimestamp(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validatePart(value: unknown): A2aPart {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new A2aError(400, "INVALID_ARGUMENT", "part must be an object");
	}
	const part = value as A2aPart;
	const contentKeys = (["text", "raw", "url", "data"] as const).filter(
		(key) => part[key] !== undefined,
	);
	if (contentKeys.length !== 1) {
		throw new A2aError(400, "INVALID_ARGUMENT", "part must set exactly one of text/raw/url/data");
	}
	for (const key of ["text", "raw", "url"] as const) {
		if (part[key] !== undefined && typeof part[key] !== "string") {
			throw new A2aError(400, "INVALID_ARGUMENT", `part ${key} must be a string`);
		}
	}
	return part;
}

export function validateArtifact(value: unknown): A2aArtifact {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new A2aError(400, "INVALID_ARGUMENT", "artifact must be an object");
	}
	const artifact = value as A2aArtifact;
	validateIdentifier(artifact.artifactId, "artifactId");
	if (!Array.isArray(artifact.parts) || artifact.parts.length === 0) {
		throw new A2aError(400, "INVALID_ARGUMENT", "artifact must carry at least one part");
	}
	for (const part of artifact.parts) validatePart(part);
	if (Buffer.byteLength(JSON.stringify(artifact)) > MAX_MESSAGE_BYTES) {
		throw new A2aError(400, "INVALID_ARGUMENT", `artifact exceeds ${MAX_MESSAGE_BYTES} bytes`);
	}
	return artifact;
}

export function validateMessage(value: unknown, role?: A2aRole): A2aMessage {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new A2aError(400, "INVALID_ARGUMENT", "message must be an object");
	}
	const message = value as A2aMessage;
	validateIdentifier(message.messageId, "messageId");
	if (message.contextId !== undefined) validateIdentifier(message.contextId, "contextId");
	if (message.taskId !== undefined) validateIdentifier(message.taskId, "taskId");
	if (role && message.role !== role) {
		throw new A2aError(400, "INVALID_ARGUMENT", `message role must be ${role}`);
	}
	if (!Array.isArray(message.parts) || message.parts.length === 0) {
		throw new A2aError(400, "INVALID_ARGUMENT", "message must carry at least one part");
	}
	for (const part of message.parts) validatePart(part);
	if (message.referenceTaskIds !== undefined) {
		if (!Array.isArray(message.referenceTaskIds)) {
			throw new A2aError(400, "INVALID_ARGUMENT", "referenceTaskIds must be an array");
		}
		for (const id of message.referenceTaskIds) validateIdentifier(id, "referenceTaskIds entry");
	}
	if (Buffer.byteLength(JSON.stringify(message)) > MAX_MESSAGE_BYTES) {
		throw new A2aError(400, "INVALID_ARGUMENT", `message exceeds ${MAX_MESSAGE_BYTES} bytes`);
	}
	return message;
}
