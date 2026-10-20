import { MAX_AUDIO_BYTES, readBytes, type Transcriber } from "../audio/transcription.ts";
import type { ChannelContextMessage } from "./types.ts";

export interface SlackAudioFile {
	id?: string;
	mimetype?: string;
	name?: string;
	size?: number;
	duration_ms?: number;
	url_private_download?: string;
	url_private?: string;
	transcription?: unknown;
}
export interface SlackAudioMessage {
	ts?: string;
	thread_ts?: string;
	user?: string;
	files?: SlackAudioFile[];
}
export type AudioDownload = (
	file: SlackAudioFile,
	message: SlackAudioMessage,
) => Promise<Uint8Array>;

export function slackAudioDownload(token: string, transport: typeof fetch = fetch): AudioDownload {
	return async (file) => {
		const url = new URL(file.url_private_download ?? file.url_private ?? "");
		if (
			url.protocol !== "https:" ||
			url.hostname !== "files.slack.com" ||
			url.port ||
			url.username ||
			url.password ||
			!url.pathname.startsWith("/files-pri/") ||
			!url.pathname.includes(`-${file.id}/`)
		)
			throw new Error("Invalid Slack audio URL");
		const response = await transport(url, {
			headers: { Authorization: `Bearer ${token}` },
			redirect: "error",
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error("Slack audio unavailable");
		}
		if (
			!(response.headers.get("content-type") ?? "").startsWith("audio/") &&
			!(response.headers.get("content-type") ?? "").startsWith("application/octet-stream")
		) {
			await response.body?.cancel();
			throw new Error("Slack returned non-audio content");
		}
		return readBytes(response, MAX_AUDIO_BYTES);
	};
}
function nativeText(value: unknown, depth = 0): string {
	if (depth > 6) return "";
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map((v) => nativeText(v, depth + 1)).join("\n");
	if (!value || typeof value !== "object") return "";
	const v = value as Record<string, unknown>;
	if (
		v.status === "none" ||
		v.status === "pending" ||
		v.status === "processing" ||
		v.status === "failed"
	)
		return "";
	for (const key of ["lines", "contents", "text"])
		if (v[key] !== undefined) return nativeText(v[key], depth + 1);
	return "";
}
async function clipText(
	file: SlackAudioFile,
	message: SlackAudioMessage,
	download: AudioDownload,
	transcriber?: Transcriber,
): Promise<string> {
	try {
		const native = nativeText(file.transcription).trim();
		if (native) return `[Audio transcript from Slack]\n${native}`;
		if (!transcriber) return "Audio transcript unavailable: no transcription backend configured.";
		if ((file.size ?? 0) > MAX_AUDIO_BYTES || (file.duration_ms ?? 0) > 300_000)
			throw new Error("Clip exceeds limits");
		const result = await transcriber.transcribe({
			bytes: await download(file, message),
			mimeType: file.mimetype ?? "audio/mp4",
			filename: file.name ?? `${file.id}.m4a`,
		});
		return result.text
			? `[Audio transcript via ${result.backend}, model ${result.model}]\n${result.text}`
			: "Audio transcription returned no speech.";
	} catch {
		return "Audio transcript unavailable: file retrieval or transcription failed. Do not assume the recording was understood.";
	}
}
function audioClips(messages: readonly SlackAudioMessage[], targetTs: string) {
	const seen = new Set<string>();
	return [...messages]
		.sort((a, b) => Number(b.ts === targetTs) - Number(a.ts === targetTs))
		.flatMap((message) => (message.files ?? []).map((file) => ({ file, message })))
		.filter(({ file }) => {
			if (
				typeof file.id !== "string" ||
				!/^F[A-Z0-9]+$/.test(file.id) ||
				!file.mimetype?.startsWith("audio/") ||
				seen.has(file.id)
			)
				return false;
			seen.add(file.id);
			return true;
		})
		.slice(0, 4);
}
/** Transcripts are untrusted context; they never become trusted wake messages. */
export async function readSlackAudio(
	messages: readonly SlackAudioMessage[],
	targetTs: string,
	download: AudioDownload,
	transcriber?: Transcriber,
): Promise<ChannelContextMessage[]> {
	const output: ChannelContextMessage[] = [];
	for (const { file, message } of audioClips(messages, targetTs)) {
		const text =
			output.length === 3
				? "Additional audio omitted: at most three clips are read per request."
				: await clipText(file, message, download, transcriber);
		output.push({
			id: `audio:${file.id}`,
			author: message.user ?? "unknown",
			target: message.ts === targetTs,
			text: text.length > 20_000 ? `${text.slice(0, 20_000)}\n[Transcript truncated]` : text,
		});
	}
	return output;
}
