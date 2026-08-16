#!/usr/bin/env node
import { sendFilesystemChannelMessage } from "../extensions/agent/channel-send.ts";

const [sender, recipient, messageId, body, ...extra] = process.argv.slice(2);
if (!sender || !recipient || !messageId || body === undefined || extra.length > 0) {
	console.error("Usage: outfitter-channel-send <sender> <recipient> <message_id> <body>");
	process.exitCode = 2;
} else {
	const spoolPath = process.env.AGENT_SPOOL_PATH?.trim();
	if (!spoolPath) {
		console.error("AGENT_SPOOL_PATH is required.");
		process.exitCode = 2;
	} else {
		try {
			const result = await sendFilesystemChannelMessage({
				spoolPath,
				sender,
				recipient,
				messageId,
				body,
			});
			console.log(
				JSON.stringify({
					status: result.duplicate ? "duplicate" : "accepted",
					message_id: result.messageId,
				}),
			);
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		}
	}
}
