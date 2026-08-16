import { join } from "node:path";
import { CHANNEL_OPERATION_ID } from "./sources/types.ts";
import { derivedId } from "./task-plane/serialize.ts";
import { sourceIdentifier } from "./task-plane/source-activation.ts";
import { OutboundDeliveryStore } from "./task-plane/stores.ts";

const CHANNEL = /^[a-z][a-z0-9-]{0,63}$/;
const PROVIDER_MESSAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

export interface FixedPublicationReconciliationInput {
	readonly storeRoot: string;
	readonly channel: string;
	readonly operationId: string;
	readonly resolution:
		| { readonly state: "delivered"; readonly providerMessageId: string }
		| { readonly state: "retryable" };
}

/** Resolve one operator-confirmed fixed publication outcome without posting. */
export async function reconcileFixedChannelPublication(
	input: FixedPublicationReconciliationInput,
): Promise<{ readonly state: "delivered" | "retryable"; readonly providerMessageId?: string }> {
	if (!input.storeRoot.trim()) throw new Error("task-plane store root is required");
	if (!CHANNEL.test(input.channel)) throw new Error("invalid channel name");
	if (!CHANNEL_OPERATION_ID.test(input.operationId)) throw new Error("invalid operation id");
	if (
		input.resolution.state === "delivered" &&
		!PROVIDER_MESSAGE_ID.test(input.resolution.providerMessageId)
	) {
		throw new Error("invalid provider message id");
	}
	const taskId = sourceIdentifier("publication", input.channel);
	const deliveryId = derivedId("delivery", `${taskId}\0${input.channel}\0${input.operationId}`);
	const store = new OutboundDeliveryStore(join(input.storeRoot, "outbound-deliveries.v1.json"));
	await store.initialize();
	const delivery = await store.reconcileFixed(
		deliveryId,
		input.resolution.state === "delivered"
			? {
					state: "delivered",
					providerResponseId: input.resolution.providerMessageId,
				}
			: { state: "retryable" },
	);
	if (delivery.state !== "delivered") return { state: "retryable" };
	if (!delivery.providerResponseId)
		throw new Error("delivered publication has no provider message id");
	return { state: "delivered", providerMessageId: delivery.providerResponseId };
}
