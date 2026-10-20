#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { MAX_AUDIO_BYTES, transcriberFromEnv } from "../extensions/audio/transcription.ts";

try {
	const file = process.argv[2];
	if (!file || process.argv.length !== 3) throw new Error("Usage: outfitter-transcribe AUDIO_FILE");
	const transcriber = transcriberFromEnv();
	if (!transcriber) throw new Error("Configure a transcription backend first");
	if ((await stat(file)).size > MAX_AUDIO_BYTES) throw new Error("Audio exceeds size limit");
	const types: Record<string, string> = {
		".wav": "audio/wav",
		".m4a": "audio/mp4",
		".mp4": "audio/mp4",
		".mp3": "audio/mpeg",
		".webm": "audio/webm",
		".ogg": "audio/ogg",
	};
	const mimeType = types[extname(file).toLowerCase()];
	if (!mimeType) throw new Error("Unsupported audio extension");
	console.log(
		JSON.stringify(
			await transcriber.transcribe({
				bytes: await readFile(file),
				mimeType,
				filename: basename(file),
			}),
		),
	);
} catch (error) {
	console.error(error instanceof Error ? error.message : "Transcription failed");
	process.exitCode = 1;
}
