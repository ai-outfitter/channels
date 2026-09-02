import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { A2aTaskStore } from "../a2a/store.ts";
import { isTerminal } from "../a2a/types.ts";
import { errorMessage } from "../sources/util.ts";
import { type ActivationClaim, ActivationJournal } from "./journal.ts";
import { OriginStore } from "./origins.ts";
import { createTaskPlane, type TaskPlane } from "./plane.ts";
import { derivedId } from "./serialize.ts";
import {
	ActivationEvidenceStore,
	ContextStore,
	OutboundDeliveryStore,
	ReplyAnchorStore,
	SourceCheckpointStore,
} from "./stores.ts";
import type { TaskTurnRunner } from "./task-sessions.ts";
import type { SourceTaskActivationSink, TaskActivationSink } from "./types.ts";
import { DurableWakeQueue } from "./wake-queue.ts";

export interface RuntimeSource {
	readonly name: string;
	start(sink: SourceTaskActivationSink): Promise<() => Promise<void>>;
}

export interface RuntimeListener {
	start(taskPlane: TaskPlane, sink: TaskActivationSink): Promise<() => Promise<void>>;
}

export interface RuntimeDependencies {
	readonly storePath: string;
	readonly originStorePath?: string;
	readonly agentInterface: string;
	readonly sources: readonly RuntimeSource[];
	/** External A2A is provider configuration: absent means not selected. */
	readonly listener?: RuntimeListener;
	readonly taskTurnRunner?: TaskTurnRunner;
	readonly taskPlaneReady?: (
		taskPlane: TaskPlane,
		wakeQueue: DurableWakeQueue,
		sourceSink: SourceTaskActivationSink,
	) => void;
	readonly log?: (record: Readonly<Record<string, unknown>>) => void;
}

export interface RunningChannelsRuntime {
	readonly healthy: boolean;
	readonly taskPlane: TaskPlane;
	/** Trusted callers may select an explicit taskId through this interface. */
	readonly sink: TaskActivationSink;
	/** Native sources receive this interface, which rejects explicit taskId input. */
	readonly sourceSink: SourceTaskActivationSink;
	readonly wakeQueue: DurableWakeQueue;
	close(): Promise<void>;
}

/** One lifecycle owner for every task-plane store and intake source. */
export async function startChannelsRuntime(
	pi: Pick<ExtensionAPI, "sendUserMessage">,
	dependencies: RuntimeDependencies,
): Promise<RunningChannelsRuntime> {
	const log = dependencies.log ?? (() => {});
	const root = dirname(dependencies.storePath);
	// 1. Open every selected store. The deployed Task and origin filenames and
	// version-1 documents remain untouched; all new state has its own file.
	const tasks = new A2aTaskStore(dependencies.storePath);
	const origins = new OriginStore(dependencies.originStorePath ?? join(root, "origins.json"));
	const evidence = new ActivationEvidenceStore(join(root, "activation-evidence.v1.json"));
	const contexts = new ContextStore(join(root, "contexts.v1.json"));
	const checkpoints = new SourceCheckpointStore(join(root, "source-checkpoints.v1.json"));
	const replyAnchors = new ReplyAnchorStore(join(root, "reply-anchors.v1.json"), tasks);
	const deliveries = new OutboundDeliveryStore(join(root, "outbound-deliveries.v1.json"));
	const journal = new ActivationJournal(join(root, "activation-journal.v1.jsonl"));
	// Every store owns a distinct file, so opening them concurrently costs one
	// fsync round trip at startup instead of eight.
	await Promise.all([
		tasks.initialize(),
		origins.initialize(),
		evidence.initialize(),
		contexts.initialize(),
		checkpoints.initialize(),
		replyAnchors.initialize(),
		deliveries.initialize(),
		journal.initialize(),
	]);
	const wakeQueue = new DurableWakeQueue(
		pi,
		tasks,
		journal,
		log,
		(claim, error) =>
			evidence.appendUnhealthy(claim.activationId, claim.taskId, claim.input.source, error),
		dependencies.taskTurnRunner,
	);
	const taskPlane = createTaskPlane({
		tasks,
		origins,
		evidence,
		contexts,
		replyAnchors,
		journal,
		agentInterface: dependencies.agentInterface,
		accepted: (claim) => wakeQueue.enqueue(claim),
	});
	// 2. Repair projections before the sink is exposed to any source.
	await taskPlane.replayIncomplete();
	const retainedTaskIds = await tasks.retainedTaskIds();
	await Promise.all([
		journal.compact(Date.now(), retainedTaskIds),
		contexts.prune(Date.now(), await tasks.activeContextIds()),
		evidence.prune(Date.now(), retainedTaskIds),
		replyAnchors.prune(Date.now(), retainedTaskIds),
		deliveries.prune(Date.now(), retainedTaskIds),
	]);
	// 3-4. The task plane/sink and queue now exist. Hook registration is owned
	// by the caller's single Pi entrypoint before it invokes this start routine.

	const stops: Array<() => Promise<void>> = [];
	const buffered: Array<() => void> = [];
	let intakeOpen = false;
	let listenerHealthy = true;
	const deliveryOperations = new Map<string, Promise<string | undefined>>();
	const guardedSink: TaskActivationSink = {
		accept: async (input) => {
			if (!intakeOpen) throw new Error("channels intake is not ready");
			return taskPlane.accept(input);
		},
		continue: async (input) => {
			if (!intakeOpen) throw new Error("channels intake is not ready");
			return taskPlane.continue(input);
		},
		claim: async (input, taskId) => {
			if (!intakeOpen) throw new Error("channels intake is not ready");
			return taskPlane.claim(input, taskId);
		},
	};
	const sourceSink: SourceTaskActivationSink = {
		accept: guardedSink.accept,
		continue: async (input) => {
			if (Object.hasOwn(input, "taskId")) {
				throw new Error("native source continuation cannot select an explicit taskId");
			}
			return guardedSink.continue(input);
		},
		checkpoint: (principal, source) => checkpoints.get(principal, source),
		advanceCheckpoint: (principal, source, checkpoint) =>
			checkpoints.advance(principal, source, checkpoint),
		async taskForLocator(source, locator) {
			let claim: ActivationClaim | undefined;
			const claims = journal.claims();
			for (let index = claims.length - 1; index >= 0; index -= 1) {
				const candidate = claims[index];
				if (
					candidate?.input.source === source &&
					candidate.input.nativeLocator.channelLocator === locator
				) {
					claim = candidate;
					break;
				}
			}
			if (!claim || !(await wakeQueue.hasAuthority(claim.taskId))) {
				throw new Error("channel locator is not authorized for the active Task");
			}
			return claim.taskId;
		},
		async taskIsTerminal(taskId) {
			const stored = await tasks.lookup(taskId);
			if (!stored) throw new Error(`task "${taskId}" was not found`);
			return isTerminal(stored.task.status.state);
		},
		recordEvidence: (input) => evidence.appendSource(input),
		async deliver(input, send, reconcile) {
			const deliveryId = derivedId(
				"delivery",
				input.payloadPolicy === "fixed"
					? `${input.taskId}\0${input.source}\0${input.operationId}`
					: `${input.taskId}\0${input.source}\0${input.operationId}\0${input.payloadDigest}`,
			);
			// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keep every durable delivery transition visible in one state machine
			const run = async (): Promise<string | undefined> => {
				let delivery = await deliveries.get(deliveryId);
				if (delivery && delivery.payloadDigest !== input.payloadDigest) {
					throw new Error("operation id already exists with different content");
				}
				if (delivery?.state === "delivered") return delivery.providerResponseId;
				if (delivery?.state === "ambiguous") {
					log({
						event: "channels_unhealthy",
						source: input.source,
						taskId: input.taskId,
						deliveryId,
					});
					throw new Error("outbound delivery is ambiguous");
				}
				if (delivery?.state === "sending") {
					if (delivery.recovery === "lookup" && reconcile) {
						const recovered = await reconcile();
						if (recovered) {
							await deliveries.put({
								...delivery,
								state: "delivered",
								providerResponseId: recovered,
								updatedAt: new Date().toISOString(),
							});
							return recovered;
						}
					} else if (delivery.recovery === "ambiguous" || delivery.recovery === "lookup") {
						const message =
							delivery.recovery === "lookup"
								? "provider lookup recovery is unavailable after restart"
								: "provider result could not be reconciled after restart";
						await deliveries.put({
							...delivery,
							state: "ambiguous",
							updatedAt: new Date().toISOString(),
							error: message,
						});
						await evidence.appendUnhealthy(deliveryId, input.taskId, input.source, message);
						log({
							event: "channels_unhealthy",
							source: input.source,
							taskId: input.taskId,
							deliveryId,
							error: message,
						});
						throw new Error("outbound delivery became ambiguous after restart");
					}
				}
				delivery ??= {
					...input,
					deliveryId,
					state: "prepared",
					updatedAt: new Date().toISOString(),
				};
				await deliveries.put({
					...delivery,
					state: "sending",
					updatedAt: new Date().toISOString(),
				});
				try {
					const providerResponseId = await send();
					await deliveries.put({
						...delivery,
						state: "delivered",
						...(providerResponseId ? { providerResponseId } : {}),
						updatedAt: new Date().toISOString(),
					});
					return providerResponseId;
				} catch (error) {
					const determinate = isDeterminateProviderRejection(error);
					const ambiguous = input.recovery === "ambiguous" && !determinate;
					const indeterminateLookup = input.recovery === "lookup" && !determinate;
					await deliveries.put({
						...delivery,
						state: indeterminateLookup ? "sending" : ambiguous ? "ambiguous" : "failed",
						updatedAt: new Date().toISOString(),
						error: errorMessage(error),
					});
					if (ambiguous) {
						await evidence.appendUnhealthy(
							deliveryId,
							input.taskId,
							input.source,
							errorMessage(error),
						);
						log({
							event: "channels_unhealthy",
							source: input.source,
							taskId: input.taskId,
							deliveryId,
							error: errorMessage(error),
						});
					}
					throw error;
				}
			};
			const prior = deliveryOperations.get(deliveryId) ?? Promise.resolve(undefined);
			const operation = prior.then(run, run);
			deliveryOperations.set(deliveryId, operation);
			try {
				return await operation;
			} finally {
				if (deliveryOperations.get(deliveryId) === operation) deliveryOperations.delete(deliveryId);
			}
		},
	};
	dependencies.taskPlaneReady?.(taskPlane, wakeQueue, sourceSink);
	try {
		// 5. Sources start with a closed intake gate. Even if one source invokes
		// its sink during start, no activation can enter until every start wins.
		const sourceResults = await Promise.allSettled(
			dependencies.sources.map(async (source) => ({
				source,
				stop: await source.start(sourceSink),
			})),
		);
		for (const [index, result] of sourceResults.entries()) {
			if (result.status === "fulfilled") {
				stops.push(result.value.stop);
				buffered.push(() => log({ event: "source_started", source: result.value.source.name }));
			} else {
				log({
					event: "source_start_failed",
					source: dependencies.sources[index]?.name,
					error: errorMessage(result.reason),
				});
			}
		}
		const failed = sourceResults.find((result) => result.status === "rejected");
		if (failed?.status === "rejected") throw failed.reason;
		// 6. External A2A is provider configuration, not local-plane config.
		// Open guarded intake before the listener binds so a request accepted as
		// soon as listen() resolves cannot race a closed sink.
		intakeOpen = true;
		if (dependencies.listener) {
			try {
				stops.push(await dependencies.listener.start(taskPlane, guardedSink));
			} catch (error) {
				listenerHealthy = false;
				log({ event: "listener_start_failed", error: errorMessage(error) });
				log({ event: "channels_unhealthy", error: errorMessage(error) });
			}
		}
		for (const report of buffered) report();
		// Pending durable wakes are not offered until the complete runtime has
		// started and intake is ready. A failed startup therefore offers none.
		await wakeQueue.replay();
		// 7. Readiness spans the whole composition, so the caller's entrypoint
		// declares it once every extension it owns has registered.
	} catch (error) {
		intakeOpen = false;
		for (const stop of stops.reverse()) await stop().catch(() => {});
		log({ event: "channels_unhealthy", error: errorMessage(error) });
		throw error;
	}

	return {
		healthy: listenerHealthy,
		taskPlane,
		sink: guardedSink,
		sourceSink,
		wakeQueue,
		async close() {
			// Preserve startup order at the boundary: sources stop accepting native
			// events before the plane closes intake underneath an in-flight callback.
			for (const stop of stops.reverse()) await stop().catch(() => {});
			intakeOpen = false;
			wakeQueue.stop();
		},
	};
}

/** A provider response that definitively refused the operation is safe to retry. */
function isDeterminateProviderRejection(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const value = error as {
		status?: unknown;
		statusCode?: unknown;
		code?: unknown;
		response?: { status?: unknown };
		data?: { error?: unknown };
	};
	const status = [value.status, value.statusCode, value.response?.status].find(
		(candidate): candidate is number => typeof candidate === "number",
	);
	if (status !== undefined) return status >= 400 && status < 500;
	// Connect codes that mean the server reached a definite policy/domain
	// decision. Deadline, canceled, unknown, internal, unavailable, and data-loss
	// do not prove whether the provider committed the operation.
	if (typeof value.code === "number")
		return [3, 5, 6, 7, 8, 9, 10, 11, 12, 16].includes(value.code);
	// Slack's platform error is an HTTP 200 response with a provider error code.
	return value.code === "slack_webapi_platform_error" && typeof value.data?.error === "string";
}
