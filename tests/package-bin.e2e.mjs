import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
if (process.platform === "win32") {
	console.log("Skipping POSIX package-mode E2E on Windows.");
	process.exit(0);
}

const root = await mkdtemp(join(tmpdir(), "channels-package-bin-"));
const consumer = join(root, "consumer");
const npm = "npm";

try {
	const { stdout: packOutput } = await execFileAsync(
		npm,
		["pack", "--silent", "--pack-destination", root],
		{ cwd: process.cwd() },
	);
	const tarballName = packOutput.trim().split(/\r?\n/).at(-1);
	assert.ok(tarballName, "npm pack must return a tarball name");
	const tarball = join(root, tarballName);

	await execFileAsync(
		npm,
		[
			"install",
			"--prefix",
			consumer,
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			"--no-package-lock",
			"--omit=peer",
			tarball,
		],
		{ cwd: root },
	);

	const binRoot = join(consumer, "node_modules", ".bin");
	const spoolPath = join(root, "spool");
	const { stdout: sendOutput } = await execFileAsync(
		join(binRoot, "outfitter-channel-send"),
		["scheduler", "resident", "package-e2e", "Run the packaged task."],
		{ env: { ...process.env, AGENT_SPOOL_PATH: spoolPath } },
	);
	assert.equal(JSON.parse(sendOutput).status, "accepted");

	await assert.rejects(
		execFileAsync(join(binRoot, "outfitter-channel-reconcile"), []),
		(error) => error.code === 2 && error.stderr.includes("Usage: outfitter-channel-reconcile"),
	);
} finally {
	await rm(root, { recursive: true, force: true });
}
