import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type FauxResponseFactory, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { taskSystemContext } from "../extensions/task-plane/system-context.ts";
import { TaskSessionHost } from "../extensions/task-plane/task-sessions.ts";
import { faux } from "./helpers/faux-model.ts";

const envelope = (systemContext: unknown) => ({
	text: JSON.stringify({ kind: "outfitter.resident-task/v1", systemContext }),
});

test("only one explicit bounded context in a task envelope becomes system facts", () => {
	assert.equal(taskSystemContext([{ text: "# arbitrary instructions" }]), undefined);
	assert.equal(
		taskSystemContext([{ text: JSON.stringify({ systemContext: "wrong envelope" }) }]),
		undefined,
	);
	assert.equal(
		taskSystemContext([envelope("# Organization\nStored charter.")]),
		"# Organization\nStored charter.",
	);
	assert.throws(() => taskSystemContext([envelope({ bad: true })]), /Invalid/);
	assert.throws(() => taskSystemContext([envelope("🙂".repeat(16000))]), /Invalid/);
	assert.throws(() => taskSystemContext([envelope("a"), envelope("b")]), /Ambiguous/);
});

test("real Pi inference receives graph in its system prompt, keeps profile/bio, and restores facts without crossing Tasks", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-system-context-"));
	const seen: Array<{ system: string; user: string }> = [];
	const step: FauxResponseFactory = (context) => {
		seen.push({
			system: JSON.stringify(context.messages.filter((message) => message.role === "system")),
			user: JSON.stringify(context.messages.filter((message) => message.role !== "system")),
		});
		return fauxAssistantMessage("context verified");
	};
	faux.setResponses(Array.from({ length: 8 }, () => step));
	const options = {
		cwd: root,
		agentDir: join(root, "agent"),
		sessionDir: join(root, "sessions"),
		customTools: [],
		additionalExtensionPaths: [new URL("./helpers/faux-model.ts", import.meta.url).pathname],
		excludedExtensionRoot: join(root, "not-channels"),
		promptSources: {
			systemPrompt: "Authored resident instructions.",
			appendSystemPrompt: ["Authored profile appendix."],
		},
		residentBio: () => "Resident biography.",
		model: () => faux.getModel() as never,
	};
	const markdown =
		"# Organization: Synthetic\n## Charter\nStored purpose.\n## Quarterly roadmap\nStored why.\n";
	let host = new TaskSessionHost(options);
	try {
		await host.run("roadmap", "Review the assigned roadmap.", markdown);
		await host.run("roadmap", "Second turn on the same task.", markdown);
		await host.run("unrelated", "Other task.");
		await host.close();
		host = new TaskSessionHost(options);
		await host.run("roadmap", "Continue after restart.");
		assert.equal(seen.length, 4);
		for (const index of [0, 1, 3]) {
			assert.ok(seen[index]?.system.includes(JSON.stringify(markdown).slice(1, -1)));
			assert.ok(seen[index]?.system.includes("Authored resident instructions."));
			assert.ok(seen[index]?.system.includes("Authored profile appendix."));
			assert.ok(seen[index]?.system.includes("Resident biography."));
			assert.ok(!seen[index]?.user.includes(markdown));
		}
		assert.equal(seen[1]?.system.split("Wiki graph context").length, 2);
		assert.ok(!seen[2]?.system.includes(JSON.stringify(markdown).slice(1, -1)));
		await host.release("roadmap");
		await assert.rejects(host.run("roadmap", "Retry", "Different facts"), /context changed/);
	} finally {
		await host.close();
		await rm(root, { recursive: true, force: true });
	}
});
