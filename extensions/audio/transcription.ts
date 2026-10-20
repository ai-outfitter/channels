import { readFile } from "node:fs/promises";

export const MAX_AUDIO_BYTES = 25_000_000;
export interface AudioInput {
	bytes: Uint8Array;
	mimeType: string;
	filename: string;
	language?: string;
	signal?: AbortSignal;
}
export interface Transcript {
	text: string;
	backend: string;
	model: string;
}
export interface Transcriber {
	transcribe(input: AudioInput): Promise<Transcript>;
}
export interface TranscriptionConfig {
	api: "openai" | "whisper-cpp";
	baseUrl: string;
	model: string;
	apiKey?: string;
	apiKeyFile?: string;
	timeoutMs?: number;
}

/** Read bounded bytes even when Content-Length is absent or incorrect. */
export async function readBytes(response: Response, maximum: number): Promise<Uint8Array> {
	const reader = response.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > maximum) throw new Error("Audio response exceeds size limit");
			chunks.push(value);
		}
	} catch (error) {
		await reader.cancel().catch(() => {});
		throw error;
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}

/** Explicit selection only: never turn a local failure into a hosted upload. */
export function createTranscriber(
	config: TranscriptionConfig,
	transport: typeof fetch = fetch,
): Transcriber {
	const url = new URL(config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`);
	if (
		!["https:", "http:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new Error("Invalid transcription base URL");
	if (!config.model.trim() || !["openai", "whisper-cpp"].includes(config.api))
		throw new Error("Transcription API and model are required");
	if (config.apiKey && config.apiKeyFile)
		throw new Error("Choose one transcription credential source");
	const timeoutMs = config.timeoutMs ?? 60_000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
		throw new Error("Invalid transcription timeout");
	const endpoint = new URL(config.api === "openai" ? "audio/transcriptions" : "inference", url);
	return {
		async transcribe(input) {
			if (!input.bytes.length || input.bytes.length > MAX_AUDIO_BYTES)
				throw new Error("Invalid audio size");
			const signal = AbortSignal.any([
				AbortSignal.timeout(timeoutMs),
				...(input.signal ? [input.signal] : []),
			]);
			signal.throwIfAborted();
			const key = config.apiKeyFile
				? (await readFile(config.apiKeyFile, "utf8")).trim()
				: config.apiKey;
			const form = new FormData();
			form.set(
				"file",
				new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }),
				`audio-${input.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100)}`,
			);
			if (config.api === "openai") form.set("model", config.model);
			form.set("response_format", "json");
			if (input.language) form.set("language", input.language);
			const response = await postAudio(transport, endpoint, form, signal, key);
			return { text: await transcriptText(response), backend: config.api, model: config.model };
		},
	};
}

async function postAudio(
	transport: typeof fetch,
	endpoint: URL,
	body: FormData,
	signal: AbortSignal,
	key?: string,
): Promise<Response> {
	let response: Response;
	try {
		response = await transport(endpoint, {
			method: "POST",
			body,
			signal,
			redirect: "error",
			headers: key ? { Authorization: `Bearer ${key}` } : {},
		});
	} catch {
		throw new Error(
			signal.aborted ? "Transcription cancelled or timed out" : "Transcription service unavailable",
		);
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`Transcription failed (HTTP ${response.status})`);
	}
	return response;
}

async function transcriptText(response: Response): Promise<string> {
	const bytes = await readBytes(response, 256_000);
	let result: unknown;
	try {
		result = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new Error("Invalid transcription response");
	}
	if (
		!result ||
		typeof result !== "object" ||
		!("text" in result) ||
		typeof result.text !== "string"
	)
		throw new Error("Invalid transcription response");
	return result.text.trim();
}

export function transcriberFromEnv(env: NodeJS.ProcessEnv = process.env): Transcriber | undefined {
	const api = env.TRANSCRIPTION_API;
	if (
		!api &&
		!env.TRANSCRIPTION_BASE_URL &&
		!env.TRANSCRIPTION_MODEL &&
		!env.TRANSCRIPTION_API_KEY &&
		!env.TRANSCRIPTION_API_KEY_FILE
	)
		return undefined;
	if (
		(api !== "openai" && api !== "whisper-cpp") ||
		!env.TRANSCRIPTION_BASE_URL ||
		!env.TRANSCRIPTION_MODEL
	)
		throw new Error("Set TRANSCRIPTION_API, TRANSCRIPTION_BASE_URL and TRANSCRIPTION_MODEL");
	return createTranscriber({
		api,
		baseUrl: env.TRANSCRIPTION_BASE_URL,
		model: env.TRANSCRIPTION_MODEL,
		...(env.TRANSCRIPTION_API_KEY ? { apiKey: env.TRANSCRIPTION_API_KEY } : {}),
		...(env.TRANSCRIPTION_API_KEY_FILE ? { apiKeyFile: env.TRANSCRIPTION_API_KEY_FILE } : {}),
		...(env.TRANSCRIPTION_TIMEOUT_MS ? { timeoutMs: Number(env.TRANSCRIPTION_TIMEOUT_MS) } : {}),
	});
}
