import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { WebClient } from "@slack/web-api";
import { parseSlackChannelIds } from "../extensions/sources/slack-config.ts";

export interface SlackDevConfig {
	appToken: string;
	botToken: string;
	channelIds: readonly string[];
}

export interface SlackPreflightClient {
	auth: {
		test(): Promise<{ ok?: boolean; user_id?: string; error?: string }>;
	};
	conversations: {
		history(input: { channel: string; limit: number }): Promise<{ ok?: boolean; error?: string }>;
	};
}

export function slackDevConfig(env: NodeJS.ProcessEnv = process.env): SlackDevConfig {
	const appToken = env.SLACK_APP_TOKEN?.trim();
	const botToken = env.SLACK_BOT_TOKEN?.trim();
	const channelIds = [...parseSlackChannelIds(env.SLACK_CHANNEL_IDS)];

	if (!appToken?.startsWith("xapp-")) {
		throw new Error("SLACK_APP_TOKEN must be an xapp- Socket Mode token");
	}
	if (!botToken?.startsWith("xoxb-")) {
		throw new Error("SLACK_BOT_TOKEN must be an xoxb- bot token");
	}
	return { appToken, botToken, channelIds };
}

export async function runSlackPreflight(
	config: SlackDevConfig,
	client: SlackPreflightClient = new WebClient(config.botToken),
): Promise<{ botUserId: string }> {
	const identity = await client.auth.test();
	if (!identity.ok || !identity.user_id) {
		throw new Error(`Slack bot authentication failed: ${identity.error ?? "unknown error"}`);
	}

	for (const channelId of config.channelIds) {
		const history = await client.conversations.history({ channel: channelId, limit: 1 });
		if (!history.ok) {
			throw new Error(
				`Slack bot cannot read allowlisted channel ${channelId}: ${history.error ?? "unknown error"}`,
			);
		}
	}
	return { botUserId: identity.user_id };
}

async function main(): Promise<void> {
	const config = slackDevConfig();
	const client = new WebClient(config.botToken);
	const deadline = Date.now() + Number(process.env.SLACK_JOIN_TIMEOUT_MS || 120_000);
	let waitingForInvite = false;
	let result: { botUserId: string };
	for (;;) {
		try {
			result = await runSlackPreflight(config, client);
			break;
		} catch (error) {
			if (slackErrorCode(error) !== "not_in_channel" || Date.now() >= deadline) throw error;
			if (!waitingForInvite) {
				console.log(
					`Waiting for the bot to join allowlisted channel(s): ${config.channelIds.join(", ")}`,
				);
				console.log("Invite it in Slack; preflight will retry without restarting slack run.");
				waitingForInvite = true;
			}
			await delay(2_000);
		}
	}
	console.log(`Slack bot ${result.botUserId} authenticated.`);
	if (config.channelIds.length > 0) {
		console.log(`Verified read access to: ${config.channelIds.join(", ")}`);
	} else {
		console.log("Listening for mentions in every channel the bot has joined.");
	}
	console.log("The Socket Mode app token will be verified when the resident connection starts.");
}

function slackErrorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object") return undefined;
	return (error as { data?: { error?: string } }).data?.error;
}

export function redactedSlackError(error: unknown, env: NodeJS.ProcessEnv = process.env): string {
	let message = error instanceof Error ? error.message : String(error);
	for (const token of [env.SLACK_APP_TOKEN, env.SLACK_BOT_TOKEN]) {
		if (token) message = message.replaceAll(token, "[REDACTED]");
	}
	return message;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(`Slack preflight failed: ${redactedSlackError(error)}`);
		process.exitCode = 1;
	});
}
