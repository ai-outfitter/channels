import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TASK_RETENTION_MS } from "../extensions/a2a/store.ts";
import { registerChannelPublishTool } from "../extensions/channel-tools.ts";
import {
	type ChattoConfig,
	type ChattoPublishApi,
	createChattoPublisher,
} from "../extensions/sources/chatto.ts";
import type { RunningChannelsRuntime } from "../extensions/task-plane/runtime.ts";
import { startChannelsRuntime } from "../extensions/task-plane/runtime.ts";

const config: ChattoConfig = {
	baseUrl: "https://chat.example.test",
	token: "token",
	roomIds: new Set(["allowed-room", "second-room"]),
};

async function start(root: string): Promise<RunningChannelsRuntime> {
	return startChannelsRuntime(
		{ sendUserMessage() {} },
		{
			storePath: join(root, "tasks.json"),
			agentInterface: "https://agent.example.test",
			sources: [],
		},
	);
}

test("channel_publish exposes the channel-neutral contract", async () => {
	let registered:
		| {
				name: string;
				parameters: { properties: Record<string, unknown> };
				execute(id: string, params: Record<string, string>): Promise<unknown>;
		  }
		| undefined;
	registerChannelPublishTool(
		{
			registerTool(tool: unknown) {
				registered = tool as typeof registered;
			},
		} as unknown as ExtensionAPI,
		async (channel) => ({
			async publish(input) {
				return {
					channel,
					target: input.target,
					operationId: input.operationId,
					providerMessageId: "provider-1",
				};
			},
		}),
	);
	assert.equal(registered?.name, "channel_publish");
	assert.deepEqual(Object.keys(registered?.parameters.properties ?? {}), [
		"channel",
		"target",
		"operation_id",
		"content",
	]);
	const result = (await registered?.execute("call-1", {
		channel: "chatto",
		target: "allowed-room",
		operation_id: "publish-1",
		content: "hello",
	})) as { details: { providerMessageId: string } };
	assert.equal(result.details.providerMessageId, "provider-1");
});

test("Chatto publication enforces CHATTO_ROOM_IDS", async () => {
	let sends = 0;
	const publisher = createChattoPublisher(
		config,
		{
			async createRoomMessage() {
				sends += 1;
				return "unexpected";
			},
		},
		{
			async accept() {
				throw new Error("unused");
			},
			async continue() {
				throw new Error("unused");
			},
			async deliver(_input, send) {
				return send();
			},
		},
	);
	await assert.rejects(
		publisher.publish({ target: "other-room", operationId: "publish-1", content: "no" }),
		/outside CHATTO_ROOM_IDS/,
	);
	assert.equal(sends, 0);
});

test("Chatto publication deduplicates, rejects changed content, and recovers after restart", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-publish-restart-"));
	try {
		let sends = 0;
		const api: ChattoPublishApi = {
			async createRoomMessage() {
				sends += 1;
				return "chatto-message-1";
			},
		};
		let runtime = await start(root);
		let publisher = createChattoPublisher(config, api, runtime.sourceSink);
		const input = { target: "allowed-room", operationId: "publish-1", content: "hello" };
		assert.equal((await publisher.publish(input)).providerMessageId, "chatto-message-1");
		assert.equal((await publisher.publish(input)).providerMessageId, "chatto-message-1");
		assert.equal(sends, 1);
		await assert.rejects(publisher.publish({ ...input, content: "changed" }), /different content/);
		await assert.rejects(
			publisher.publish({ ...input, target: "second-room" }),
			/different content/,
		);
		assert.equal(sends, 1);
		await runtime.close();
		await backdateDeliveries(root);

		runtime = await start(root);
		publisher = createChattoPublisher(config, api, runtime.sourceSink);
		assert.equal((await publisher.publish(input)).providerMessageId, "chatto-message-1");
		assert.equal(sends, 1);
		await assert.rejects(
			publisher.publish({ ...input, content: "changed later" }),
			/different content/,
		);
		await runtime.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("Chatto publication retries a confirmed rejection", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-publish-confirmed-"));
	try {
		const runtime = await start(root);
		let attempts = 0;
		const publisher = createChattoPublisher(
			config,
			{
				async createRoomMessage() {
					attempts += 1;
					if (attempts === 1) throw Object.assign(new Error("invalid request"), { status: 400 });
					return "chatto-message-retry";
				},
			},
			runtime.sourceSink,
		);
		const input = { target: "allowed-room", operationId: "publish-retry", content: "hello" };
		await assert.rejects(publisher.publish(input), /invalid request/);
		assert.equal((await publisher.publish(input)).providerMessageId, "chatto-message-retry");
		assert.equal(attempts, 2);
		await runtime.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("Chatto publication stops retry after an ambiguous failure and restart", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-publish-ambiguous-"));
	try {
		let attempts = 0;
		const api: ChattoPublishApi = {
			async createRoomMessage() {
				attempts += 1;
				throw new Error("connection closed after request");
			},
		};
		const input = {
			target: "allowed-room",
			operationId: "publish-ambiguous",
			content: "hello",
		};
		let runtime = await start(root);
		let publisher = createChattoPublisher(config, api, runtime.sourceSink);
		await assert.rejects(publisher.publish(input), /connection closed/);
		await assert.rejects(publisher.publish(input), /ambiguous/);
		assert.equal(attempts, 1);
		await runtime.close();
		await backdateDeliveries(root);

		runtime = await start(root);
		publisher = createChattoPublisher(config, api, runtime.sourceSink);
		await assert.rejects(publisher.publish(input), /ambiguous/);
		assert.equal(attempts, 1);
		await runtime.close();

		const reconciled = runReconcileCli(root, [
			"chatto",
			input.operationId,
			"delivered",
			"chatto-message-reconciled",
		]);
		assert.match(reconciled, /"state":"delivered"/);

		runtime = await start(root);
		publisher = createChattoPublisher(config, api, runtime.sourceSink);
		assert.equal((await publisher.publish(input)).providerMessageId, "chatto-message-reconciled");
		assert.equal(attempts, 1);
		await runtime.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("operator reconciliation makes a confirmed-absent Chatto publication retryable", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-publish-reconcile-retry-"));
	try {
		let attempts = 0;
		const api: ChattoPublishApi = {
			async createRoomMessage() {
				attempts += 1;
				if (attempts === 1) throw new Error("connection closed after request");
				return "chatto-message-after-reconciliation";
			},
		};
		const input = {
			target: "allowed-room",
			operationId: "daily:2026-08-16",
			content: "hello",
		};
		let runtime = await start(root);
		let publisher = createChattoPublisher(config, api, runtime.sourceSink);
		await assert.rejects(publisher.publish(input), /connection closed/);
		await runtime.close();

		const reconciled = runReconcileCli(root, ["chatto", input.operationId, "retryable"]);
		assert.match(reconciled, /"state":"retryable"/);

		runtime = await start(root);
		publisher = createChattoPublisher(config, api, runtime.sourceSink);
		assert.equal(
			(await publisher.publish(input)).providerMessageId,
			"chatto-message-after-reconciliation",
		);
		assert.equal(attempts, 2);
		await runtime.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

async function backdateDeliveries(root: string): Promise<void> {
	const path = join(root, "outbound-deliveries.v1.json");
	const document = JSON.parse(await readFile(path, "utf8")) as {
		deliveries: Record<string, { updatedAt: string }>;
	};
	const old = new Date(Date.now() - TASK_RETENTION_MS - 60_000).toISOString();
	for (const delivery of Object.values(document.deliveries)) delivery.updatedAt = old;
	await writeFile(path, `${JSON.stringify(document)}\n`);
}

function runReconcileCli(root: string, args: readonly string[]): string {
	const env: NodeJS.ProcessEnv = { ...process.env, CHANNELS_TASK_STORE_PATH: root };
	delete env.NODE_TEST_CONTEXT;
	const result = spawnSync(
		process.execPath,
		[join(process.cwd(), "dist/bin/outfitter-channel-reconcile.js"), ...args],
		{ env, encoding: "utf8" },
	);
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr);
	return result.stdout;
}
