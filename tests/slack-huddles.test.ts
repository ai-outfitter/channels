import assert from "node:assert/strict";
import { it } from "node:test";
import { readSlackHuddles } from "../extensions/sources/slack-huddles.ts";

it("reads only huddle transcript files referenced by channel context and bounds their content", async () => {
	const calls: string[] = [];
	const messages = await readSlackHuddles(
		[
			{ id: "FORDINARY" },
			{ id: "FCANVAS", huddle_transcript_file_id: "FTRANSCRIPT" },
			{ id: "FCANVAS", huddle_transcript_file_id: "FTRANSCRIPT" },
		],
		async (id) => {
			calls.push(id);
			return {
				ok: true,
				file: {
					id,
					huddle_transcription: {
						lines: [
							{ contents: "Discussed deployment." },
							{ contents: "Next step: review evidence." },
						],
					},
					metadata: { secret: "excluded" },
				},
			};
		},
	);
	assert.deepEqual(calls, ["FTRANSCRIPT"]);
	assert.deepEqual(messages, [
		{
			id: "huddle:FTRANSCRIPT",
			author: "Slack huddle transcript",
			text: "Discussed deployment.\nNext step: review evidence.",
			target: false,
		},
	]);
	const bounded = await readSlackHuddles([{ id: "FLONG", is_huddle_canvas: true }], async (id) => ({
		ok: true,
		file: { id, plain_text: "x".repeat(30000) },
	}));
	assert.match(bounded[0]?.text ?? "", /\[Transcript truncated\]$/);
});
it("reports unavailable transcripts explicitly rather than inferring them from huddle metadata", async () => {
	const messages = await readSlackHuddles(
		[{ id: "FHIDDEN", is_huddle_canvas: true }],
		async () => ({ ok: false, error: "missing_scope" }),
	);
	assert.match(messages[0]?.text ?? "", /unavailable/);
	assert.deepEqual(
		await readSlackHuddles([{ id: "FOTHER" }], async () => assert.fail("ordinary file fetched")),
		[],
	);
});
