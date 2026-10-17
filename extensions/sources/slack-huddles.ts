import type { ChannelContextMessage } from "./types.ts";

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
function transcriptText(value: unknown, depth = 0): string {
	if (depth > 6) return "";
	if (typeof value === "string") return value;
	if (Array.isArray(value))
		return value
			.map((item) => transcriptText(item, depth + 1))
			.filter(Boolean)
			.join("\n");
	const object = record(value);
	if (!object) return "";
	for (const key of ["lines", "contents", "text", "blocks", "elements"]) {
		if (object[key] !== undefined) return transcriptText(object[key], depth + 1);
	}
	return "";
}

function huddleIds(files: readonly unknown[]): string[] {
	const seen = new Set<string>();
	for (const value of files) {
		const file = record(value);
		if (
			!file ||
			!(
				file.huddle_transcript_file_id ||
				file.huddle_transcription ||
				file.is_huddle_canvas === true
			)
		)
			continue;
		const id = file.huddle_transcript_file_id ?? file.id;
		if (typeof id === "string" && /^F[A-Z0-9]+$/.test(id) && seen.size < 3) seen.add(id);
	}
	return [...seen];
}
async function readTranscript(id: string, load: (id: string) => Promise<unknown>): Promise<string> {
	try {
		const response = record(await load(id));
		const loaded = record(response?.file);
		if (response?.ok === true && loaded?.id === id) {
			const content = transcriptText(
				loaded.huddle_transcription ?? loaded.transcription ?? loaded.plain_text,
			);
			if (content.trim())
				return content.length > 20_000
					? `${content.slice(0, 20_000)}\n[Transcript truncated]`
					: content;
		}
	} catch {
		/* Permission and plan limitations remain explicit context. */
	}
	return "Huddle transcript unavailable: Slack did not return accessible transcript text.";
}
/** Only huddle files already referenced by readable channel messages are fetched. */
export async function readSlackHuddles(
	files: readonly unknown[],
	load: (id: string) => Promise<unknown>,
): Promise<ChannelContextMessage[]> {
	return Promise.all(
		huddleIds(files).map(async (id) => ({
			id: `huddle:${id}`,
			author: "Slack huddle transcript",
			text: await readTranscript(id, load),
			target: false,
		})),
	);
}
