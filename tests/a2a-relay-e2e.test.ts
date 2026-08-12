import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { A2aClient } from "../extensions/a2a/client.ts";
import { A2aRelayClient } from "../extensions/a2a-relay/client.ts";
import { startA2aRelayServer } from "../extensions/a2a-relay/server.ts";
import a2aRelayExtension from "../extensions/a2a-relay-extension.ts";
import { fakePi, INERT_EVIDENCE, type RegisteredTool, waitFor } from "./helpers.ts";

const EVIDENCE = INERT_EVIDENCE;

test("public A2A work completes through one private relay-backed Pi turn", async () => {
	const directory = await mkdtemp(join(tmpdir(), "a2a-relay-e2e-"));
	const server = await startA2aRelayServer({
		agentId: "resident-a",
		queuePath: join(directory, "queue.json"),
		originStorePath: join(directory, "origins.json"),
		a2a: {
			host: "127.0.0.1",
			port: 0,
			storePath: join(directory, "tasks.json"),
			artifactStorePath: join(directory, "artifacts"),
			credentials: [{ token: "caller-token", principal: "caller-a" }],
			agentName: "resident-a",
			agentDescription: "relay-backed agent",
			publicUrl: "https://relay.example/agents/resident-a",
			agentVersion: "0.0.1",
			policyDigest: `sha256:${"a".repeat(64)}`,
		},
		connectorHost: "127.0.0.1",
		connectorPort: 0,
		workerCredentials: [{ token: "worker-token", worker: "worker-a", agentIds: ["resident-a"] }],
		allowInsecureLoopback: true,
		leaseMs: 60_000,
	});
	try {
		const caller = new A2aClient({
			baseUrl: server.a2aUrl,
			token: "caller-token",
			allowInsecureLoopback: true,
		});
		const worker = new A2aRelayClient({
			baseUrl: server.connectorUrl,
			token: "worker-token",
			allowInsecureLoopback: true,
		});
		const { handlers, tools, wakes, pi } = fakePi();
		a2aRelayExtension(pi, {
			configPath: () => "/run/secrets/relay.json",
			loadConfig: async () => ({ client: worker, pollMs: 5, evidence: EVIDENCE }),
			log: () => {},
		});
		await handlers.get("session_start")?.();
		const sent = await caller.sendMessage({
			message: {
				messageId: "relay-e2e-message",
				role: "ROLE_USER",
				parts: [{ text: "private relay task body" }],
			},
			configuration: { returnImmediately: true },
		});
		assert.ok("task" in sent);
		await waitFor(() => wakes.length === 1);
		assert.doesNotMatch(wakes[0]?.text as string, /private relay task body/);
		await handlers.get("before_agent_start")?.({ prompt: wakes[0]?.text as string });
		const read = (await (tools.get("a2a_relay_read_task") as RegisteredTool).execute("read", {
			taskId: sent.task.id,
		})) as { content: [{ text: string }] };
		assert.match(read.content[0].text, /private relay task body/);
		await (tools.get("a2a_relay_complete_task") as RegisteredTool).execute("complete", {
			taskId: sent.task.id,
			response: "relay result",
			outcome: "completed",
		});
		await handlers.get("agent_end")?.();
		const completed = await caller.getTask(sent.task.id);
		assert.equal(completed.status.state, "TASK_STATE_COMPLETED");
		assert.equal(completed.artifacts?.[0]?.parts[0]?.text, "relay result");
		await handlers.get("session_shutdown")?.();
	} finally {
		await server.close();
		await rm(directory, { recursive: true, force: true });
	}
});
