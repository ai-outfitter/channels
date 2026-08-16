#!/usr/bin/env node
import { reconcileFixedChannelPublication } from "../extensions/channel-reconcile.ts";

const [channel, operationId, state, providerMessageId, ...extra] = process.argv.slice(2);
const delivered = state === "delivered" && providerMessageId && extra.length === 0;
const retryable = state === "retryable" && providerMessageId === undefined && extra.length === 0;
if (!channel || !operationId || (!delivered && !retryable)) {
	console.error(
		"Usage: outfitter-channel-reconcile <channel> <operation_id> delivered <provider_message_id>\n" +
			"   or: outfitter-channel-reconcile <channel> <operation_id> retryable",
	);
	process.exitCode = 2;
} else {
	const storeRoot = process.env.CHANNELS_TASK_STORE_PATH?.trim();
	if (!storeRoot) {
		console.error("CHANNELS_TASK_STORE_PATH is required.");
		process.exitCode = 2;
	} else {
		try {
			const result = await reconcileFixedChannelPublication({
				storeRoot,
				channel,
				operationId,
				resolution: delivered
					? { state: "delivered", providerMessageId }
					: { state: "retryable" },
			});
			console.log(JSON.stringify(result));
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		}
	}
}
