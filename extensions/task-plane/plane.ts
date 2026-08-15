import { randomUUID } from "node:crypto";
import type { A2aTaskStore } from "../a2a/store.ts";
import {
	A2aError,
	type A2aMessage,
	INTERRUPTED_TASK_STATES,
	validateIdentifier,
} from "../a2a/types.ts";
import { errorMessage } from "../sources/util.ts";
import type { ActivationClaim, ActivationJournal } from "./journal.ts";
import type { OriginStore } from "./origins.ts";
import { derivedId, serialize, sha256Hex } from "./serialize.ts";
import type { ActivationEvidenceStore, ContextStore, ReplyAnchorStore } from "./stores.ts";
import type {
	ActivationAcceptance,
	NativeActivation,
	NativeContinuation,
	TaskActivationSink,
} from "./types.ts";

export interface TaskPlaneDependencies {
	readonly tasks: A2aTaskStore;
	readonly origins: OriginStore;
	readonly evidence: ActivationEvidenceStore;
	readonly contexts: ContextStore;
	readonly replyAnchors: ReplyAnchorStore;
	readonly journal: ActivationJournal;
	readonly agentInterface: string;
	readonly accepted?: (claim: ActivationClaim) => void;
	readonly crashAfterStep?: (step: number, claim?: ActivationClaim) => void | Promise<void>;
}

export interface TaskPlane extends TaskActivationSink {
	readonly taskStore: A2aTaskStore;
	beginNew(principal: string, contextId: string): ReturnType<A2aTaskStore["beginNew"]>;
	replayIncomplete(): Promise<void>;
	recordReplyAnchor(
		principal: string,
		source: string,
		providerResponseId: string,
		taskId: string,
	): Promise<void>;
}

export function createTaskPlane(dependencies: TaskPlaneDependencies): TaskPlane {
	let intake: Promise<unknown> = Promise.resolve();

	const locked = async <T>(operation: () => Promise<T>): Promise<T> => {
		const result = serialize(intake, operation);
		intake = result;
		return result;
	};

	const crash = async (step: number, claim?: ActivationClaim): Promise<void> => {
		await dependencies.crashAfterStep?.(step, claim);
	};

	const project = async (claim: ActivationClaim): Promise<void> => {
		const relation = claim.intendedRoute;
		if (!claim.taskAlreadyPersisted) {
			if (relation === "created") {
				await dependencies.tasks.createTaskWithId(
					claim.input.principal,
					claim.taskId,
					claim.contextId,
				);
			}
			await dependencies.tasks.appendHistoryIdempotent(
				claim.input.principal,
				claim.taskId,
				messageFor(claim),
			);
		}
		await crash(5, claim);
		await dependencies.origins.project(
			claim.activationId,
			claim.input,
			claim.taskId,
			relation,
			dependencies.agentInterface,
		);
		await crash(6, claim);
		// The checksummed claim is the activation/dedupe projection. Re-reading it
		// here deliberately validates that replay still points at the same IDs.
		const durable = dependencies.journal.claimByActivationId(claim.activationId);
		if (!durable || durable.taskId !== claim.taskId) throw new Error("activation claim was lost");
		await crash(7, claim);
		await dependencies.evidence.append(claim.activationId, claim.taskId, claim.input);
		await crash(8, claim);
		if (!dependencies.journal.isAccepted(claim.activationId)) {
			await dependencies.journal.append({
				kind: "ACCEPTED",
				activationId: claim.activationId,
				acceptedAt: new Date().toISOString(),
			});
		}
		await crash(9, claim);
	};

	const submit = async (
		input: NativeActivation,
		selectTask?: () => Promise<string | undefined>,
		taskAlreadyPersisted = false,
	): Promise<ActivationAcceptance> =>
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keeps the reviewed eleven acceptance boundaries visibly in one serialized transaction
		locked(async () => {
			validateActivation(input);
			await crash(1);
			const providerKey = scopedProviderKey(input);
			const prior = dependencies.journal.claimByProviderKey(providerKey);
			let claim: ActivationClaim;
			let disposition: ActivationAcceptance["disposition"];
			if (prior) {
				if (digestInput(prior.input) !== digestInput(input)) {
					throw new A2aError(
						409,
						"DUPLICATE_MESSAGE_ID",
						"provider dedupe key was reused with a different activation",
					);
				}
				if (!dependencies.journal.isAccepted(prior.activationId)) await project(prior);
				claim = prior;
				disposition = "duplicate";
			} else {
				const selectedTaskId = await selectTask?.();
				const contextId = selectedTaskId
					? (await dependencies.tasks.getTask(input.principal, selectedTaskId)).contextId
					: await dependencies.contexts.resolve(
							input.principal,
							input.source,
							input.conversationKey,
							new Date(input.receivedAt),
						);
				await crash(2);
				claim = {
					kind: "CLAIM",
					providerKey,
					activationId: derivedId("activation", providerKey),
					taskId: selectedTaskId ?? randomUUID(),
					input: structuredClone(input),
					contextId,
					intendedRoute: selectedTaskId ? "continued" : "created",
					...(taskAlreadyPersisted ? { taskAlreadyPersisted: true } : {}),
					claimedAt: new Date().toISOString(),
				};
				await dependencies.journal.append(claim, () => crash(3, claim));
				// append() fsyncs before resolving: step 4 is an explicit observable
				// boundary even though it shares the journal operation with step 3.
				await crash(4, claim);
				await project(claim);
				disposition = selectedTaskId ? "continued" : "created";
			}
			await crash(10, claim);
			queueMicrotask(() => dependencies.accepted?.(claim));
			return {
				activationId: claim.activationId,
				taskId: claim.taskId,
				contextId: claim.contextId,
				disposition,
			};
		});

	const plane: TaskPlane = {
		taskStore: dependencies.tasks,
		accept: (input) => submit(input),
		async continue(input: NativeContinuation) {
			if (input.taskId) {
				return submit(input, async () => {
					const task = await dependencies.tasks.getTask(input.principal, input.taskId as string);
					if (!canAcceptInput(task.status.state, task.status.message)) {
						throw new A2aError(400, "UNSUPPORTED_OPERATION", "task cannot accept supplied input");
					}
					return input.taskId;
				});
			}
			if (input.sourceSupportsReplyAnchors && input.directReplyToProviderResponseId) {
				return submit(input, async () => {
					const taskId = await dependencies.replyAnchors.resolve(
						input.principal,
						input.source,
						input.directReplyToProviderResponseId as string,
					);
					if (taskId) {
						const task = await dependencies.tasks
							.getTask(input.principal, taskId)
							.catch(() => undefined);
						if (task && canAcceptInput(task.status.state, task.status.message)) return taskId;
					}
					return undefined;
				});
			}
			return submit(input);
		},
		claim: (input, taskId) =>
			submit(
				input,
				async () => {
					const task = await dependencies.tasks.getTask(input.principal, taskId);
					if (
						task.status.state !== "TASK_STATE_SUBMITTED" &&
						!canAcceptInput(task.status.state, task.status.message)
					) {
						throw new A2aError(400, "UNSUPPORTED_OPERATION", "task cannot accept supplied input");
					}
					return taskId;
				},
				true,
			),
		beginNew: (principal, contextId) => dependencies.tasks.beginNew(principal, contextId),
		async replayIncomplete() {
			await locked(async () => {
				for (const claim of dependencies.journal.claims()) {
					if (
						dependencies.journal.isAccepted(claim.activationId) ||
						dependencies.journal.isQuarantined(claim.activationId)
					) {
						continue;
					}
					try {
						validateActivation(claim.input);
						await project(claim);
					} catch (error) {
						const message = errorMessage(error);
						await dependencies.evidence.appendUnhealthy(
							claim.activationId,
							claim.taskId,
							claim.input.source,
							message,
						);
						await dependencies.journal.append({
							kind: "QUARANTINED",
							activationId: claim.activationId,
							error: message,
							quarantinedAt: new Date().toISOString(),
						});
					}
				}
			});
		},
		recordReplyAnchor: (principal, source, providerResponseId, taskId) =>
			dependencies.replyAnchors.record(principal, source, providerResponseId, taskId),
	};
	return plane;
}

function canAcceptInput(state: string, unanswered: A2aMessage | undefined): boolean {
	return INTERRUPTED_TASK_STATES.includes(state as never) && unanswered !== undefined;
}

function messageFor(claim: ActivationClaim): A2aMessage {
	return {
		messageId: claim.input.providerEventId,
		taskId: claim.taskId,
		contextId: claim.contextId,
		role: "ROLE_USER",
		parts: claim.input.parts,
	};
}

function scopedProviderKey(input: NativeActivation): string {
	return `${input.principal}\0${input.source}\0${input.providerDedupeKey}`;
}

function digestInput(input: NativeActivation): string {
	const { receivedAt: _receivedAt, ...providerPayload } = input;
	return sha256Hex(JSON.stringify(providerPayload));
}

function validateActivation(input: NativeActivation): void {
	for (const [label, value] of [
		["principal", input.principal],
		["source", input.source],
		["providerEventId", input.providerEventId],
		["providerDedupeKey", input.providerDedupeKey],
	] as const) {
		validateIdentifier(value, label);
	}
	if (input.conversationKey !== undefined)
		validateIdentifier(input.conversationKey, "conversationKey");
	if ("taskId" in input && input.taskId !== undefined) validateIdentifier(input.taskId, "taskId");
	if (
		"directReplyToProviderResponseId" in input &&
		input.directReplyToProviderResponseId !== undefined
	) {
		validateIdentifier(input.directReplyToProviderResponseId, "directReplyToProviderResponseId");
	}
	if (!Number.isFinite(Date.parse(input.receivedAt))) throw new Error("receivedAt is invalid");
	if (!/^sha256:[0-9a-f]{64}$/.test(input.contentDigest)) {
		throw new Error("contentDigest must be a SHA-256 digest");
	}
	const locatorFields = Object.entries(input.nativeLocator);
	if (locatorFields.length === 0) throw new Error("nativeLocator is required");
	for (const [field, value] of locatorFields) {
		validateIdentifier(field, "nativeLocator field");
		if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
			throw new Error(
				`nativeLocator.${field} must be a non-empty string of at most 4096 characters`,
			);
		}
	}
	if (input.parts.length === 0) throw new Error("activation parts are required");
}
