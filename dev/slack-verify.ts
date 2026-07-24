import { pathToFileURL } from "node:url";
import { WebClient } from "@slack/web-api";
import { parseSlackChannelIds } from "../extensions/sources/slack-config.ts";
import {
	redactedSlackError,
	runSlackPreflight,
	type SlackDevConfig,
	slackDevConfig,
} from "./slack-preflight.ts";

const DEFAULT_MARKER = "[channels-local-smoke]";
const DEFAULT_DONE_EMOJI = "white_check_mark";

interface SlackVerifyMessage {
	ts?: string;
	thread_ts?: string;
	text?: string;
	user?: string;
	bot_id?: string;
	reactions?: Array<{ name?: string; users?: string[] }>;
}

export interface SlackVerifyClient {
	auth: {
		test(): Promise<{ ok?: boolean; user_id?: string; error?: string }>;
	};
	conversations: {
		history(input: {
			channel: string;
			limit: number;
		}): Promise<{ ok?: boolean; error?: string; messages?: SlackVerifyMessage[] }>;
		replies(input: {
			channel: string;
			ts: string;
			limit: number;
		}): Promise<{ ok?: boolean; error?: string; messages?: SlackVerifyMessage[] }>;
	};
}

export interface SlackRoundTripEvidence {
	channelId: string;
	mentionTs: string;
	threadTs: string;
	botReplyTs: string;
	handledReaction: string;
}

export async function verifySlackRoundTrip(
	config: SlackDevConfig,
	client: SlackVerifyClient = new WebClient(config.botToken) as unknown as SlackVerifyClient,
	marker: string = process.env.SLACK_VERIFY_MARKER?.trim() || DEFAULT_MARKER,
	doneEmoji: string = process.env.LINK_SLACK_DONE_EMOJI?.trim() || DEFAULT_DONE_EMOJI,
): Promise<SlackRoundTripEvidence> {
	const { botUserId } = await runSlackPreflight(config, client);
	const located = await latestMarkedMention(config.channelIds, client, botUserId, marker);
	if (!located) {
		throw new Error(`no human mention containing ${JSON.stringify(marker)} was found`);
	}

	const threadTs = located.message.thread_ts ?? located.message.ts;
	if (!threadTs || !located.message.ts) throw new Error("located Slack mention has no timestamp");
	const replies = await client.conversations.replies({
		channel: located.channelId,
		ts: threadTs,
		limit: 100,
	});
	if (!replies.ok) {
		throw new Error(`Slack could not read the mention thread: ${replies.error ?? "unknown error"}`);
	}
	const botReplies = (replies.messages ?? []).filter(
		(message) =>
			message.user === botUserId &&
			message.ts !== located.message.ts &&
			Number(message.ts) > Number(located.message.ts),
	);
	if (botReplies.length !== 1 || !botReplies[0]?.ts) {
		throw new Error(`expected exactly one bot reply after the mention; found ${botReplies.length}`);
	}

	const handled = located.message.reactions?.some(
		(reaction) => reaction.name === doneEmoji && reaction.users?.includes(botUserId),
	);
	if (!handled) throw new Error(`the bot has not added the ${doneEmoji} handled reaction`);

	return {
		channelId: located.channelId,
		mentionTs: located.message.ts,
		threadTs,
		botReplyTs: botReplies[0].ts,
		handledReaction: doneEmoji,
	};
}

async function latestMarkedMention(
	channelIds: readonly string[],
	client: SlackVerifyClient,
	botUserId: string,
	marker: string,
): Promise<{ channelId: string; message: SlackVerifyMessage } | undefined> {
	let latest: { channelId: string; message: SlackVerifyMessage } | undefined;
	for (const channelId of channelIds) {
		const history = await client.conversations.history({ channel: channelId, limit: 100 });
		if (!history.ok) {
			throw new Error(
				`Slack bot cannot read allowlisted channel ${channelId}: ${history.error ?? "unknown error"}`,
			);
		}
		for (const message of history.messages ?? []) {
			if (
				!message.bot_id &&
				message.user !== botUserId &&
				message.text?.includes(`<@${botUserId}>`) &&
				message.text.includes(marker) &&
				message.ts &&
				(!latest?.message.ts || Number(message.ts) > Number(latest.message.ts))
			) {
				latest = { channelId, message };
			}
		}
	}
	return latest;
}

async function main(): Promise<void> {
	const config = slackDevConfig();
	const verificationIds =
		config.channelIds.length > 0
			? config.channelIds
			: [...parseSlackChannelIds(process.env.SLACK_VERIFY_CHANNEL_IDS)];
	if (verificationIds.length === 0) {
		throw new Error(
			"SLACK_VERIFY_CHANNEL_IDS must name the test channel when SLACK_CHANNEL_IDS uses joined",
		);
	}
	const evidence = await verifySlackRoundTrip({ ...config, channelIds: verificationIds });
	console.log("Slack local round trip verified:");
	console.log(`  channel: ${evidence.channelId}`);
	console.log(`  mention: ${evidence.mentionTs}`);
	console.log(`  thread:  ${evidence.threadTs}`);
	console.log(`  reply:   ${evidence.botReplyTs}`);
	console.log(`  handled: ${evidence.handledReaction}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(`Slack verification failed: ${redactedSlackError(error)}`);
		process.exitCode = 1;
	});
}
