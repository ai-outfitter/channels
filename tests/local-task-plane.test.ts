import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configFromEnv, startA2aServer } from "../extensions/a2a/server.ts";
import { createLocalTaskPlane, sourceRequest } from "../extensions/local-task-plane.ts";
import { OriginRouter } from "../extensions/origins/router.ts";
import { OriginStore } from "../extensions/origins/store.ts";

const POLICY_DIGEST = `sha256:${"a".repeat(64)}`;

test("the resident task plane derives local defaults from generic Operator inputs", async () => {
	const directory = await mkdtemp(join(tmpdir(), "channels-local-config-"));
	const previous = { ...process.env };
	try {
		process.env.HOME = directory;
		process.env.AGENT_NAME = "nonprod-bot";
		delete process.env.A2A_SERVER;
		delete process.env.A2A_STORE_PATH;
		delete process.env.A2A_CREDENTIALS_PATH;
		delete process.env.A2A_ARTIFACT_STORE_PATH;
		delete process.env.A2A_POLICY_BUNDLE_DIGEST;
		const config = await configFromEnv(POLICY_DIGEST, false);
		assert.equal(config.listen, false);
		assert.deepEqual(config.credentials, []);
		assert.equal(config.agentName, "nonprod-bot");
		assert.equal(config.publicUrl, "http://127.0.0.1:8788");
		assert.equal(config.storePath, join(directory, ".channels", "task-plane", "tasks.json"));
		assert.equal(config.artifactStorePath, join(directory, ".channels", "task-plane", "artifacts"));
	} finally {
		process.env = previous;
	}
});

test("local source intake persists, deduplicates, and records native delivery without HTTP", async () => {
	const directory = await mkdtemp(join(tmpdir(), "channels-local-plane-"));
	const origins = new OriginStore(join(directory, "origins.json"));
	await origins.initialize();
	let executions = 0;
	const server = await startA2aServer(
		{
			host: "127.0.0.1",
			port: 8788,
			storePath: join(directory, "tasks.json"),
			artifactStorePath: join(directory, "artifacts"),
			credentials: [],
			agentName: "nonprod-bot",
			agentDescription: "test",
			publicUrl: "http://127.0.0.1:8788",
			agentVersion: "test",
			policyDigest: POLICY_DIGEST,
			listen: false,
		},
		async (context) => {
			executions += 1;
			await new OriginRouter(origins, "http://127.0.0.1:8788").route(context);
			return undefined;
		},
	);
	const work = {
		providerEventId: "Ev123",
		nativeLocator: { channelLocator: "slack:v1:opaque", channelId: "C1", messageTs: "1.2" },
		receivedAt: "2026-08-12T12:00:00.000Z",
		dedupeKey: "slack:C1:1.2",
		correlationKey: "slack:C1:1.2",
		parts: [{ text: "please inspect this" }],
	};
	const event = { channel: "slack", summary: "new mention", work };
	const plane = createLocalTaskPlane(server, origins);
	assert.equal(await plane.accept(event), true);
	assert.equal(await plane.accept(event), true);
	assert.equal(executions, 1);

	const replay = await server.submit("source:slack", sourceRequest("slack", "new mention", work));
	assert.ok("task" in replay);
	await plane.recordDelivery("slack", "slack:v1:opaque", {
		channel: "slack",
		locator: "slack:v1:opaque",
		replied: true,
		handled: true,
		responseId: "1.3",
	});
	const trace = await origins.taskTrace(new Set(["source:slack"]), {
		agentInterface: "http://127.0.0.1:8788",
		protocolBinding: "HTTP+JSON",
		protocolVersion: "1.0",
		taskId: replay.task.id,
	});
	assert.equal(trace?.origins.length, 1);
	assert.equal(trace?.origins[0]?.delivery?.state, "delivered");
	assert.equal(trace?.origins[0]?.delivery?.responseId, "1.3");
	await plane.recordDelivery("github", "github:v1:untraced", {
		channel: "github",
		locator: "github:v1:untraced",
		replied: true,
		handled: true,
	});
	await server.close();
	origins.close();
});

test("one process owns a local task store at a time", async () => {
	const directory = await mkdtemp(join(tmpdir(), "channels-local-lease-"));
	const config = {
		host: "127.0.0.1",
		port: 8788,
		storePath: join(directory, "tasks.json"),
		artifactStorePath: join(directory, "artifacts"),
		credentials: [],
		agentName: "resident",
		agentDescription: "test",
		publicUrl: "http://127.0.0.1:8788",
		agentVersion: "test",
		policyDigest: POLICY_DIGEST,
		listen: false,
	} as const;
	const executor = async () => ({
		messageId: "reply",
		role: "ROLE_AGENT" as const,
		parts: [{ text: "ok" }],
	});
	const first = await startA2aServer(config, executor);
	await assert.rejects(startA2aServer(config, executor), /already in use/);
	await first.close();
	const restarted = await startA2aServer(config, executor);
	await restarted.close();
});

test("concurrent stale-lease recovery elects only one writer", async () => {
	const directory = await mkdtemp(join(tmpdir(), "channels-stale-lease-"));
	const config = {
		host: "127.0.0.1",
		port: 8788,
		storePath: join(directory, "tasks.json"),
		artifactStorePath: join(directory, "artifacts"),
		credentials: [],
		agentName: "resident",
		agentDescription: "test",
		publicUrl: "http://127.0.0.1:8788",
		agentVersion: "test",
		policyDigest: POLICY_DIGEST,
		listen: false,
	} as const;
	await writeFile(
		`${config.storePath}.lock`,
		JSON.stringify({ host: hostname(), pid: 2_000_000_000 }),
	);
	const executor = async () => ({
		messageId: "reply",
		role: "ROLE_AGENT" as const,
		parts: [{ text: "ok" }],
	});
	const attempts = await Promise.allSettled([
		startA2aServer(config, executor),
		startA2aServer(config, executor),
	]);
	const running = attempts.filter(
		(result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof startA2aServer>>> =>
			result.status === "fulfilled",
	);
	assert.equal(running.length, 1);
	assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);
	await running[0]?.value.close();
});

test("a failed terminal replay is consumed instead of wedging the source cursor", async () => {
	const directory = await mkdtemp(join(tmpdir(), "channels-terminal-replay-"));
	const origins = new OriginStore(join(directory, "origins.json"));
	await origins.initialize();
	const server = await startA2aServer(
		{
			host: "127.0.0.1",
			port: 8788,
			storePath: join(directory, "tasks.json"),
			artifactStorePath: join(directory, "artifacts"),
			credentials: [],
			agentName: "resident",
			agentDescription: "test",
			publicUrl: "http://127.0.0.1:8788",
			agentVersion: "test",
			policyDigest: POLICY_DIGEST,
			listen: false,
		},
		async (context) => {
			const controller = await context.begin();
			await controller.status("TASK_STATE_FAILED");
			return undefined;
		},
	);
	const plane = createLocalTaskPlane(server, origins);
	const event = {
		channel: "github",
		summary: "assignment",
		work: {
			providerEventId: "notification-1",
			nativeLocator: { threadId: "1" },
			receivedAt: "2026-08-12T12:00:00.000Z",
			dedupeKey: "github:1",
			parts: [{ text: "work" }],
		},
	};
	assert.equal(await plane.accept(event), true);
	assert.equal(await plane.accept(event), true);
	await server.close();
	origins.close();
});
