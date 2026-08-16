import { createHash } from "node:crypto";
import { FilesystemAgentTransport } from "./filesystem.ts";

export interface ChannelSendInput {
	spoolPath: string;
	sender: string;
	recipient: string;
	messageId: string;
	body: string;
}

/** Write one atomic, deduplicated filesystem message without a sender session. */
export async function sendFilesystemChannelMessage(input: ChannelSendInput): Promise<{
	duplicate: boolean;
	messageId: string;
}> {
	const transport = new FilesystemAgentTransport({
		root: input.spoolPath,
		endpointId: input.sender,
	});
	try {
		const result = await transport.send({
			id: input.messageId,
			recipient: input.recipient,
			conversationId: scheduledConversationId(input.sender, input.recipient),
			body: input.body,
		});
		return { duplicate: result.duplicate, messageId: result.message.id };
	} finally {
		await transport.close();
	}
}

function scheduledConversationId(sender: string, recipient: string): string {
	const digest = createHash("sha256")
		.update(sender)
		.update("\0")
		.update(recipient)
		.digest("hex")
		.slice(0, 40);
	return `scheduled:${digest}`;
}
