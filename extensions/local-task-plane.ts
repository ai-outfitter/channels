import { createHash } from "node:crypto";
import type { RunningA2aServer } from "./a2a/server.ts";
import type { A2aSendMessageRequest } from "./a2a/types.ts";
import type { OriginStore } from "./origins/store.ts";
import {
	activationMetadata,
	digestParts,
	OUTFITTER_ORIGIN_EXTENSION_URI,
} from "./origins/types.ts";
import type { ChannelEvent, ChannelRespondResult, ChannelWork } from "./sources/types.ts";

export interface LocalTaskPlane {
	accept(event: ChannelEvent): Promise<boolean>;
	recordDelivery(channel: string, locator: string, result: ChannelRespondResult): Promise<void>;
}

let active: LocalTaskPlane | undefined;

export function installLocalTaskPlane(value: LocalTaskPlane): () => void {
	if (active) throw new Error("the local task plane is already installed");
	active = value;
	return () => {
		if (active === value) active = undefined;
	};
}

export function localTaskPlane(): LocalTaskPlane {
	if (!active) throw new Error("the local task plane is not ready");
	return active;
}

export function currentLocalTaskPlane(): LocalTaskPlane | undefined {
	return active;
}

export function createLocalTaskPlane(
	server: RunningA2aServer,
	origins: OriginStore,
): LocalTaskPlane {
	return {
		async accept(event) {
			if (!event.work) throw new Error(`channel "${event.channel}" did not provide task work`);
			const response = await server.submit(
				sourcePrincipal(event.channel),
				sourceRequest(event.channel, event.summary, event.work),
			);
			if (!("task" in response)) throw new Error("local task intake returned no task");
			// A terminal replay is the durable outcome for this provider event.
			// Consume it so one failed item cannot wedge a source cursor for the
			// dedupe retention period. A new provider event gets a new message id.
			return true;
		},
		async recordDelivery(channel, locator, result) {
			const matched = await origins.originForNativeLocator(
				sourcePrincipal(channel),
				channel,
				locator,
			);
			// A native response can come from a legacy wake, a signal-only source,
			// or a source that does not expose a channelLocator. The response has
			// already been posted. Missing trace state must never turn that success
			// into a tool failure that invites a duplicate reply.
			if (!matched) return;
			await origins.recordDelivery(matched.activation.id, matched.origin.task, {
				state: result.replied ? "delivered" : "failed",
				attemptCount: 1,
				...(result.responseId ? { responseId: result.responseId } : {}),
				...(!result.replied && result.warning ? { errorCode: "native-delivery-failed" } : {}),
			});
		},
	};
}

/**
 * The A2A principal a native channel submits under. Intake and delivery both
 * key on it, so it is minted once rather than spelled at each call site.
 */
function sourcePrincipal(channel: string): string {
	return `source:${channel}`;
}

export function sourceRequest(
	sourceKind: string,
	sourceSummary: string,
	work: ChannelWork,
): A2aSendMessageRequest {
	const id = createHash("sha256")
		.update(`${sourceKind}\0${work.providerEventId}`)
		.digest("hex")
		.slice(0, 48);
	const input = {
		sourceKind,
		providerEventId: work.providerEventId,
		nativeLocator: work.nativeLocator,
		receivedAt: work.receivedAt,
		dedupeKey: work.dedupeKey,
		contentDigest: digestParts(work.parts),
		...(work.correlationKey ? { correlationKey: work.correlationKey } : {}),
		sourceSummary,
		...(work.nativeUrl ? { nativeUrl: work.nativeUrl } : {}),
	};
	return {
		message: {
			messageId: `source-${id}`,
			role: "ROLE_USER",
			parts: work.parts,
			extensions: [OUTFITTER_ORIGIN_EXTENSION_URI],
			metadata: activationMetadata(input),
		},
		configuration: { returnImmediately: true },
	};
}
