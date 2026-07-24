import { parseList } from "./util.ts";

const CHANNEL_ID = /^[A-Z][A-Z0-9]{1,}$/;
const JOINED = "joined";

/**
 * Parse Slack's channel boundary.
 *
 * Omitted or `joined` means every conversation the bot has joined. Explicit
 * channel IDs narrow that set further. Mixing `joined` with IDs is rejected so
 * a typo cannot silently widen access.
 */
export function parseSlackChannelIds(raw: string | undefined): Set<string> {
	const values = parseList(raw);
	if (values.length === 0 || (values.length === 1 && values[0]?.toLowerCase() === JOINED)) {
		return new Set();
	}
	if (values.some((value) => value.toLowerCase() === JOINED)) {
		throw new Error("SLACK_CHANNEL_IDS cannot mix joined with explicit channel IDs");
	}
	for (const channelId of values) {
		if (!CHANNEL_ID.test(channelId)) {
			throw new Error(`SLACK_CHANNEL_IDS contains an invalid channel id: ${channelId}`);
		}
	}
	return new Set(values);
}
