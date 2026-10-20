import assert from "node:assert/strict";
import test from "node:test";
import { readSlackAudio, slackAudioDownload } from "../extensions/sources/slack-audio.ts";

const clip = {
	id: "F123456789",
	mimetype: "audio/mp4",
	name: "clip.m4a",
	transcription: { status: "none" },
};
const message = { ts: "100.001", user: "U123", files: [clip] };
test("the exact mentioned clip becomes attributed untrusted context via the selected provider", async () => {
	const output = await readSlackAudio(
		[message],
		message.ts,
		async (file, source) => {
			assert.equal(file.id, clip.id);
			assert.equal(source.ts, message.ts);
			return new Uint8Array([1]);
		},
		{
			transcribe: async (input) => {
				assert.equal(input.filename, "clip.m4a");
				return { text: "Please check the issue", backend: "openai", model: "test" };
			},
		},
	);
	assert.deepEqual(output, [
		{
			id: `audio:${clip.id}`,
			author: "U123",
			target: true,
			text: "[Audio transcript via openai, model test]\nPlease check the issue",
		},
	]);
});
test("native transcript avoids audio upload and missing backend is explicit", async () => {
	const native = {
		...message,
		files: [
			{ ...clip, transcription: { status: "complete", lines: [{ contents: "Native words" }] } },
		],
	};
	const never = async () => {
		throw new Error("must not download");
	};
	assert.match((await readSlackAudio([native], message.ts, never))[0]?.text ?? "", /Native words/);
	assert.match(
		(await readSlackAudio([message], message.ts, never))[0]?.text ?? "",
		/no transcription backend/,
	);
});
test("duplicate clips are read once and private provider errors do not reach context", async () => {
	let calls = 0;
	const output = await readSlackAudio(
		[message, message],
		message.ts,
		async () => {
			calls++;
			throw new Error("secret URL");
		},
		{ transcribe: async () => assert.fail() },
	);
	assert.equal(calls, 1);
	assert.equal(output.length, 1);
	assert.match(output[0]?.text ?? "", /unavailable/);
	assert.doesNotMatch(output[0]?.text ?? "", /secret/);
});
test("Slack credentials go only to the canonical file host and redirects are rejected", async () => {
	let calls = 0;
	const download = slackAudioDownload("synthetic-token", async (_url, init) => {
		calls++;
		assert.equal(init?.redirect, "error");
		assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-token");
		return new Response(new Uint8Array([1]), { headers: { "Content-Type": "audio/mp4" } });
	});
	await assert.rejects(
		download({ ...clip, url_private: "https://evil.example/files-pri/T-F123456789/file" }, message),
		/Invalid Slack/,
	);
	assert.equal(calls, 0);
	assert.deepEqual(
		await download(
			{ ...clip, url_private: "https://files.slack.com/files-pri/T-F123456789/file" },
			message,
		),
		new Uint8Array([1]),
	);
});

test("Slack channel_read includes the transcript instead of silently reading only mention text", async () => {
	const { createSlackActions, mentionEvent } = await import("../extensions/sources/slack.ts");
	const web = {
		auth: { test: async () => ({ ok: true, user_id: "UBOT" }) },
		conversations: {
			history: async () => ({ ok: true, messages: [{ ...message, text: "<@UBOT>" }] }),
		},
	};
	const actions = createSlackActions(
		{
			botToken: "synthetic",
			doneEmoji: "white_check_mark",
			downloadAudio: async () => new Uint8Array([1]),
			transcriber: {
				transcribe: async () => ({
					text: "Check the issue",
					backend: "whisper-cpp",
					model: "test",
				}),
			},
		},
		web as unknown as import("@slack/web-api").WebClient,
		{} as import("../extensions/task-plane/types.ts").SourceTaskActivationSink,
	);
	const event = mentionEvent({ type: "app_mention", channel: "C123", ts: message.ts }, new Set());
	assert.ok(event?.locator);
	const result = await actions.read(event.locator.key);
	assert.equal(result.messages.length, 2);
	assert.equal(result.messages[1]?.target, true);
	assert.match(result.messages[1]?.text ?? "", /Check the issue/);
});
