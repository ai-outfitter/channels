import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createTranscriber,
	MAX_AUDIO_BYTES,
	readBytes,
	transcriberFromEnv,
} from "../extensions/audio/transcription.ts";

const input = { bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/wav", filename: "clip.wav" };
test("OpenAI and whisper.cpp use the same contract with their actual multipart protocols", async () => {
	for (const api of ["openai", "whisper-cpp"] as const) {
		const transcriber = createTranscriber(
			{
				api,
				baseUrl: "https://speech.example.test/v1",
				model: "configured-model",
				apiKey: "synthetic-key",
			},
			async (url, init) => {
				assert.equal(
					String(url),
					`https://speech.example.test/v1/${api === "openai" ? "audio/transcriptions" : "inference"}`,
				);
				assert.equal(init?.redirect, "error");
				assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-key");
				const form = init?.body as FormData;
				assert.equal(form.get("model"), api === "openai" ? "configured-model" : null);
				assert.equal(form.get("response_format"), "json");
				assert.equal(form.get("language"), "en");
				const file = form.get("file") as File;
				assert.equal(file.name, "audio-clip.wav");
				assert.deepEqual(new Uint8Array(await file.arrayBuffer()), input.bytes);
				return Response.json({ text: " understood " });
			},
		);
		assert.deepEqual(await transcriber.transcribe({ ...input, language: "en" }), {
			text: "understood",
			backend: api,
			model: "configured-model",
		});
	}
});
test("transcription is opt-in; malformed config does not select or fall back to a hosted provider", () => {
	assert.equal(transcriberFromEnv({ OPENAI_API_KEY: "unrelated" }), undefined);
	assert.throws(() => transcriberFromEnv({ TRANSCRIPTION_API: "openai" }), /Set TRANSCRIPTION/);
	for (const baseUrl of [
		"file:///tmp/audio",
		"https://user:secret@example.test",
		"https://example.test/?secret=1",
	]) {
		assert.throws(
			() => createTranscriber({ api: "openai", baseUrl, model: "test" }),
			/Invalid transcription/,
		);
	}
});
test("bounded, redacted failures never retry another provider", async () => {
	let calls = 0;
	const config = {
		api: "openai" as const,
		baseUrl: "https://speech.example.test/v1",
		model: "test",
	};
	const provider = createTranscriber(config, async () => {
		calls++;
		return new Response("private provider message synthetic-secret", { status: 401 });
	});
	await assert.rejects(provider.transcribe(input), { message: "Transcription failed (HTTP 401)" });
	assert.equal(calls, 1);
	await assert.rejects(
		provider.transcribe({ ...input, bytes: new Uint8Array(MAX_AUDIO_BYTES + 1) }),
		/Invalid audio size/,
	);
	assert.equal(calls, 1);
	await assert.rejects(
		createTranscriber(config, async () => Response.json({ error: "private" })).transcribe(input),
		/Invalid transcription response/,
	);
	await assert.rejects(
		createTranscriber(config, async () => new Response("x".repeat(256_001))).transcribe(input),
		/size limit/,
	);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(provider.transcribe({ ...input, signal: controller.signal }));
	assert.equal(calls, 1);
});
test("mounted inference credentials are reread after rotation", async () => {
	const dir = await mkdtemp(join(tmpdir(), "transcription-"));
	try {
		const file = join(dir, "apiKey");
		const keys: string[] = [];
		const provider = createTranscriber(
			{ api: "openai", baseUrl: "https://speech.example.test/v1", model: "test", apiKeyFile: file },
			async (_url, init) => {
				keys.push(new Headers(init?.headers).get("authorization") ?? "");
				return Response.json({ text: "hello" });
			},
		);
		await writeFile(file, "first");
		await provider.transcribe(input);
		await writeFile(file, "second");
		await provider.transcribe(input);
		assert.deepEqual(keys, ["Bearer first", "Bearer second"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
test("byte reader cancels a chunked response at the bound", async () => {
	let cancelled = false;
	const body = new ReadableStream({
		pull(c) {
			c.enqueue(new Uint8Array(4));
		},
		cancel() {
			cancelled = true;
		},
	});
	await assert.rejects(readBytes(new Response(body), 3), /size limit/);
	assert.equal(cancelled, true);
});
