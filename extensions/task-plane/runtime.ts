import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { A2aTaskStore } from "../a2a/store.ts";
import { errorMessage } from "../sources/util.ts";
import { ActivationJournal } from "./journal.ts";
import { OriginStore } from "./origins.ts";
import { createTaskPlane, type TaskPlane } from "./plane.ts";
import {
	ActivationEvidenceStore,
	ContextStore,
	OutboundDeliveryStore,
	ReplyAnchorStore,
	SourceCheckpointStore,
} from "./stores.ts";
import type { SourceTaskActivationSink, TaskActivationSink } from "./types.ts";
import { DurableWakeQueue } from "./wake-queue.ts";

export interface RuntimeSource {
	readonly name: string;
	start(sink: SourceTaskActivationSink): Promise<() => Promise<void>>;
}

export interface RuntimeListener {
	start(taskPlane: TaskPlane): Promise<() => Promise<void>>;
}

export interface RuntimeDependencies {
	readonly storePath: string;
	readonly originStorePath?: string;
	readonly agentInterface: string;
	readonly sources: readonly RuntimeSource[];
	/** External A2A is provider configuration: absent means not selected. */
	readonly listener?: RuntimeListener;
	readonly log?: (record: Readonly<Record<string, unknown>>) => void;
}

export interface RunningChannelsRuntime {
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
	await contexts.prune(Date.now(), await tasks.activeContextIds());
	const wakeQueue = new DurableWakeQueue(pi, tasks, journal, log);
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
	// 3-4. The task plane/sink and queue now exist. Hook registration is owned
	// by the caller's single Pi entrypoint before it invokes this start routine.

	const stops: Array<() => Promise<void>> = [];
	const buffered: Array<() => void> = [];
	let intakeOpen = false;
	const guardedSink: TaskActivationSink = {
		accept: async (input) => {
			if (!intakeOpen) throw new Error("channels intake is not ready");
			return taskPlane.accept(input);
		},
		continue: async (input) => {
			if (!intakeOpen) throw new Error("channels intake is not ready");
			return taskPlane.continue(input);
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
	};
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
		if (dependencies.listener) stops.push(await dependencies.listener.start(taskPlane));
		intakeOpen = true;
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
