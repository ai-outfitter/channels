import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sendFilesystemChannelMessage } from "../extensions/agent/channel-send.ts";
import { FilesystemAgentTransport } from "../extensions/agent/filesystem.ts";

test("outfitter-channel-send deduplicates CronJob sends and survives receiver restart", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-send-cli-"));
	const input = {
		spoolPath: root,
		sender: "scheduler",
		recipient: "resident",
		messageId: "wake-2026-08-15",
		body: "Run the scheduled task.",
	};
	try {
		const first = await sendFilesystemChannelMessage(input);
		const duplicate = await sendFilesystemChannelMessage(input);
		assert.equal(first.duplicate, false);
		assert.equal(duplicate.duplicate, true);

		await assert.rejects(
			sendFilesystemChannelMessage({ ...input, body: "Changed task." }),
			/different content/,
		);
		await assert.rejects(
			sendFilesystemChannelMessage({ ...input, recipient: "other-resident" }),
			/different content/,
		);

		const receiver = new FilesystemAgentTransport({ root, endpointId: "resident" });
		await receiver.initialize();
		const read = await receiver.read("wake-2026-08-15");
		assert.equal(read.target.message.sender, "scheduler");
		assert.equal(read.target.message.body, "Run the scheduled task.");
		assert.equal(read.messages.length, 1);
		await receiver.close();

		const afterReceipt = await sendFilesystemChannelMessage(input);
		assert.equal(afterReceipt.duplicate, true);
		await assert.rejects(
			sendFilesystemChannelMessage({ ...input, body: "Changed after receipt." }),
			/different content/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("packaged outfitter-channel-send runs as JavaScript and derives its principal from sender", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-send-packaged-cli-"));
	try {
		const env: NodeJS.ProcessEnv = {
			...process.env,
			AGENT_SPOOL_PATH: root,
			AGENT_PRINCIPAL_ID: "ambient-principal-must-not-win",
		};
		delete env.NODE_TEST_CONTEXT;
		const args = ["scheduler", "resident", "wake-packaged", "Run the packaged task."];
		const concurrent = await Promise.all([runPackagedSend(args, env), runPackagedSend(args, env)]);
		assert.deepEqual(concurrent.map((stdout) => JSON.parse(stdout).status).sort(), [
			"accepted",
			"duplicate",
		]);

		const sender = new FilesystemAgentTransport({ root, endpointId: "scheduler" });
		await sender.initialize();
		await sender.close();
		const receiver = new FilesystemAgentTransport({ root, endpointId: "resident" });
		await receiver.initialize();
		await receiver.read("wake-packaged");
		await receiver.close();
		assert.equal(JSON.parse(await runPackagedSend(args, env)).status, "duplicate");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("packaged channel commands are executable npm bins", {
	skip: process.platform === "win32",
}, async () => {
	for (const command of ["outfitter-channel-send.js", "outfitter-channel-reconcile.js"]) {
		const commandStat = await stat(join(process.cwd(), "dist/bin", command));
		assert.notEqual(commandStat.mode & 0o111, 0, `${command} must be executable`);
	}
});

async function runPackagedSend(args: readonly string[], env: NodeJS.ProcessEnv): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[join(process.cwd(), "dist/bin/outfitter-channel-send.js"), ...args],
			{ env },
		);
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve(stdout);
			else reject(new Error(stderr || `outfitter-channel-send exited ${code}`));
		});
	});
}
