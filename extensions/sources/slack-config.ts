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

/** Compare Slack decimal timestamps without losing fractional precision. */
export function compareSlackTimestamps(left: string, right: string): number {
	const leftParts = timestampParts(left);
	const rightParts = timestampParts(right);
	if (!leftParts || !rightParts) return left.localeCompare(right);

	const seconds =
		leftParts.seconds.length - rightParts.seconds.length ||
		leftParts.seconds.localeCompare(rightParts.seconds);
	if (seconds !== 0) return seconds;

	const width = Math.max(leftParts.fraction.length, rightParts.fraction.length);
	return leftParts.fraction
		.padEnd(width, "0")
		.localeCompare(rightParts.fraction.padEnd(width, "0"));
}

function timestampParts(value: string): { seconds: string; fraction: string } | undefined {
	const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
	if (!match?.[1]) return undefined;
	return { seconds: match[1], fraction: match[2] ?? "" };
}
