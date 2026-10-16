import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { ResidentRuntime } from "../extensions/task-plane/resident-runtime.ts";

it("reports a verified loopback browser and acknowledges only a profile used in a prompt", async () => {
	const root = await mkdtemp(join(tmpdir(), "resident-runtime-"));
	let revision = 1;
	let profileResident = "example-resident";
	const runtime = new ResidentRuntime(
		{
			AGENT_BROWSER_CDP_URL: "http://127.0.0.1:9222",
			OUTFITTER_RESIDENT_PROFILE_URL: "https://profiles.example/resident-profile",
			OUTFITTER_RESIDENT_PROFILE_TOKEN: "private-token",
			OUTFITTER_RESIDENT_ID: "example-resident",
		},
		async (input, init) => {
			const url = new URL(String(input));
			if (url.hostname === "profiles.example") {
				assert.equal(new Headers(init?.headers).get("authorization"), "Bearer private-token");
				return Response.json({
					residentId: profileResident,
					revision,
					bio: `Example bio ${revision}`,
				});
			}
			assert.equal(url.href, "http://127.0.0.1:9222/json/version");
			assert.equal(new Headers(init?.headers).get("authorization"), null);
			return Response.json({ Browser: "Chrome/example", "Protocol-Version": "1.3" });
		},
	);
	const stop = await runtime.start(root);
	try {
		const snapshot = async () =>
			JSON.parse(await readFile(join(root, "resident-runtime.v1.json"), "utf8"));
		assert.equal((await snapshot()).browser, "ready");
		assert.equal((await snapshot()).profileAppliedRevision, null);
		assert.equal(runtime.bioForPrompt(), "Example bio 1");
		await runtime.refresh();
		assert.equal((await snapshot()).profileAppliedRevision, 1);
		revision = 2;
		await runtime.refresh();
		assert.equal((await snapshot()).profileAppliedRevision, 1);
		assert.equal(runtime.bioForPrompt(), "Example bio 2");
		profileResident = "other-resident";
		revision = 3;
		await runtime.refresh();
		assert.equal(runtime.bioForPrompt(), "Example bio 2");
		const serialized = await readFile(join(root, "resident-runtime.v1.json"), "utf8");
		assert.doesNotMatch(serialized, /private-token|Example bio|profiles.example/);
	} finally {
		await stop();
		await rm(root, { recursive: true, force: true });
	}
});

it("never probes a remote browser address and rejects profile redirects", async () => {
	const root = await mkdtemp(join(tmpdir(), "resident-runtime-scope-"));
	let calls = 0;
	const runtime = new ResidentRuntime(
		{
			AGENT_BROWSER_CDP_URL: "http://remote.example:9222",
			OUTFITTER_RESIDENT_PROFILE_URL: "http://profiles.example/resident-profile",
		},
		async () => {
			calls++;
			throw new Error("unexpected request");
		},
	);
	const stop = await runtime.start(root);
	try {
		assert.equal(calls, 0);
		assert.equal(runtime.bioForPrompt(), "");
		const snapshot = JSON.parse(await readFile(join(root, "resident-runtime.v1.json"), "utf8"));
		assert.equal(snapshot.browser, "unavailable");
	} finally {
		await stop();
		await rm(root, { recursive: true, force: true });
	}
});
