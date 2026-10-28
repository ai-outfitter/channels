import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	type FauxResponseFactory,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { SUPPORTED_TASK_MCP_PI_VERSION } from "../extensions/task-plane/task-mcp.ts";
import {
	TASK_MCP_HEADER,
	TaskSessionHost,
	taskMcpServer,
	taskSessionMcpExtensions,
} from "../extensions/task-plane/task-sessions.ts";
import { faux } from "./helpers/faux-model.ts";

type Seen = { method: string; task: string | undefined; authorization: string | undefined };

/** A standard streamable HTTP MCP server (stateless JSON responses) that answers
 * with the task identity it received. Authority is the server's decision. */
async function mcpServer(revoked: Set<string>) {
	const seen: Seen[] = [];
	const hold = new Map<string, () => Promise<void>>();
	const streamHold = new Map<string, () => Promise<void>>();
	const payload = new Map<string, string>();
	const server = createServer(async (req: IncomingMessage, res) => {
		if (req.method !== "POST") {
			res.writeHead(405).end();
			return;
		}
		const message = await incomingMessage(req);
		const task = req.headers[TASK_MCP_HEADER.toLowerCase()] as string | undefined;
		seen.push({ method: message.method, task, authorization: req.headers.authorization });
		if (message.id === undefined) {
			res.writeHead(202).end();
			return;
		}
		if (revokedTask(revoked, task)) {
			res.writeHead(403, { "Content-Type": "text/plain" }).end("Task authority revoked");
			return;
		}
		const reply = (result: unknown): void => {
			res
				.writeHead(200, { "Content-Type": "application/json" })
				.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
		};
		if (message.method === "initialize")
			return reply({
				protocolVersion: message.params.protocolVersion,
				capabilities: { tools: {} },
				serverInfo: { name: "fixture", version: "1.0.0" },
			});
		if (message.method === "tools/list")
			return reply({
				tools: [
					{
						name: "whoami",
						description: "The verified caller",
						inputSchema: { type: "object", properties: {} },
					},
				],
			});
		if (message.method === "tools/call") {
			await hold.get(taskKey(task))?.();
			return streamReply(
				res,
				message.id,
				payload.get(taskKey(task)) ?? `task:${task}`,
				streamHold.get(taskKey(task)),
			);
		}
		res.writeHead(200, { "Content-Type": "application/json" }).end(
			JSON.stringify({
				jsonrpc: "2.0",
				id: message.id,
				error: { code: -32601, message: "Not found" },
			}),
		);
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const { port } = server.address() as { port: number };
	return { seen, hold, streamHold, payload, url: `http://127.0.0.1:${port}/mcp`, server };
}

async function incomingMessage(req: IncomingMessage) {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function taskKey(task: string | undefined) {
	return task ?? "";
}

function revokedTask(revoked: Set<string>, task: string | undefined) {
	return task !== undefined && revoked.has(task);
}

async function streamReply(
	res: import("node:http").ServerResponse,
	id: unknown,
	text: string,
	hold?: () => Promise<void>,
) {
	const body = JSON.stringify({
		jsonrpc: "2.0",
		id,
		result: { content: [{ type: "text", text }] },
	});
	res.writeHead(200, { "Content-Type": "application/json" });
	if (!hold) {
		res.end(body);
		return;
	}
	res.write(body.slice(0, 12));
	await hold();
	res.end(body.slice(12));
}

type Turn = { tools: string[]; result?: string; isError?: boolean };
const toolNames = [
	"mcp__task__whoami",
	"mcp__generic__whoami",
	"mcp__other__whoami",
	"list_app_actions",
	"call_app_action",
];
/** Tool names Pi declared to the model (carried by the transcript's system messages). */
const declared = (messages: readonly { role: string }[]) => {
	const system = JSON.stringify(messages.filter((message) => message.role === "system"));
	return toolNames.filter((name) => system.includes(`"${name}"`));
};

function script(turns: Map<string, Turn[]>): FauxResponseFactory {
	// Scripted model: call the server's tool once per prompt, then report its result.
	return (context) => {
		const messages = context.messages;
		const prompt = [...messages].reverse().find((m) => m.role === "user");
		const content = prompt?.content;
		const key =
			typeof content === "string"
				? content
				: ((content?.[0] as { text?: string } | undefined)?.text ?? "");
		const last = messages.at(-1);
		if (last?.role === "toolResult") {
			const text = last.content.map((part) => ("text" in part ? part.text : "")).join("");
			turns.get(key)?.push({
				tools: declared(messages),
				result: text,
				isError: last.isError,
			});
			return fauxAssistantMessage("done");
		}
		const names = declared(messages);
		if (!turns.has(key)) turns.set(key, []);
		if (!names.includes("mcp__task__whoami")) {
			turns.get(key)?.push({ tools: names });
			return fauxAssistantMessage("no task server");
		}
		return fauxAssistantMessage(fauxToolCall("mcp__task__whoami", {}));
	};
}

test("isolated Task sessions use Pi's native MCP client with their own trusted Task identity", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-task-mcp-"));
	const revoked = new Set<string>();
	const { seen, url, server } = await mcpServer(revoked);
	// The resident's ordinary mcp.json servers stay available in Task sessions.
	const generic = await mcpServer(new Set());
	const shadow = await mcpServer(new Set());
	const other = await mcpServer(new Set());
	await mkdir(join(root, "agent"), { recursive: true });
	// The explicitly selected directory works without process-global environment changes.

	await writeFile(
		join(root, "agent", "mcp.json"),
		JSON.stringify({
			mcpServers: {
				generic: {
					url: generic.url,
					exposure: "direct",
					headers: { Authorization: "Bearer generic-fixture" },
				},
				task: {
					url: shadow.url,
					exposure: "direct",
					headers: { Authorization: "Bearer forbidden-owner-token" },
				},
			},
		}),
	);
	await mkdir(join(root, ".pi"), { recursive: true });
	await writeFile(
		join(root, ".pi", "mcp.json"),
		JSON.stringify({ mcpServers: { task: { url: shadow.url, exposure: "direct" } } }),
	);
	await writeFile(
		join(root, "agent", "mcp-auth.json"),
		JSON.stringify({
			[`mcp__task|${url}`]: {
				serverUrl: url,
				tokens: { access_token: "cached-human-token", token_type: "Bearer" },
				tokensExpireAt: Date.now() + 3600000,
			},
		}),
	);
	const turns = new Map<string, Turn[]>();
	const step = script(turns);
	faux.setResponses(Array.from({ length: 40 }, () => step));
	const hostOptions = {
		cwd: root,
		projectTrusted: true,
		agentDir: join(root, "agent"),
		sessionDir: join(root, "sessions"),
		customTools: [],
		additionalExtensionPaths: [new URL("./helpers/faux-model.ts", import.meta.url).pathname],
		excludedExtensionRoot: join(root, "not-channels"),
		model: () => faux.getModel() as never,
		taskMcp: taskMcpServer(
			url,
			(taskId) => taskId.startsWith("a2a-"),
			async () => true,
		),
	};
	const host = new TaskSessionHost(hostOptions);
	const otherDir = join(root, "other-agent");
	await mkdir(otherDir, { recursive: true });
	await writeFile(
		join(otherDir, "mcp.json"),
		JSON.stringify({ mcpServers: { other: { url: other.url, exposure: "direct" } } }),
	);
	const otherHost = new TaskSessionHost({
		...hostOptions,
		agentDir: otherDir,
		sessionDir: join(root, "other-sessions"),
	});
	try {
		// Two concurrent tasks in one resident process: no shared env or config file.
		await Promise.all([host.run("a2a-alpha", "alpha"), otherHost.run("a2a-beta", "beta")]);
		assert.equal(turns.get("alpha")?.at(-1)?.result, "task:a2a-alpha");
		assert.equal(turns.get("beta")?.at(-1)?.result, "task:a2a-beta");
		for (const task of ["a2a-alpha", "a2a-beta"]) {
			const methods = seen.filter((entry) => entry.task === task).map((entry) => entry.method);
			for (const method of ["initialize", "notifications/initialized", "tools/list", "tools/call"])
				assert.ok(methods.includes(method), `${task} sent ${method}`);
		}
		assert.ok(seen.every((entry) => entry.task === "a2a-alpha" || entry.task === "a2a-beta"));
		assert.ok(
			seen.every((entry) => entry.authorization === undefined),
			"the relay, not Pi, supplies credentials",
		);
		const alphaTools = turns.get("alpha")?.at(-1)?.tools ?? [];
		assert.ok(alphaTools.includes("mcp__task__whoami"));
		assert.ok(alphaTools.includes("mcp__generic__whoami"));
		assert.ok(!alphaTools.includes("mcp__other__whoami"));
		const betaTools = turns.get("beta")?.at(-1)?.tools ?? [];
		assert.ok(betaTools.includes("mcp__other__whoami"));
		assert.ok(!betaTools.includes("mcp__generic__whoami"));
		assert.ok(!alphaTools.some((name) => ["list_app_actions", "call_app_action"].includes(name)));
		assert.ok(
			generic.seen.some((entry) => entry.method === "tools/list" && entry.task === undefined),
			"configured servers connect natively without the Task header",
		);

		assert.equal(
			shadow.seen.length,
			0,
			"selected/global and trusted project config cannot shadow the Task server",
		);
		assert.ok(
			generic.seen.every((entry) => entry.authorization === "Bearer generic-fixture"),
			"other declared server authentication is preserved",
		);

		// The server's decision is authoritative on every request.
		revoked.add("a2a-beta");
		await otherHost.run("a2a-beta", "beta");
		assert.equal(turns.get("beta")?.at(-1)?.isError, true);

		// A released session reconnects with the same Task identity when reopened.
		const initialized = seen.filter(
			(e) => e.task === "a2a-alpha" && e.method === "initialize",
		).length;
		await host.release("a2a-alpha");
		await host.run("a2a-alpha", "alpha");
		assert.ok(
			seen.filter((e) => e.task === "a2a-alpha" && e.method === "initialize").length > initialized,
		);
		assert.equal(turns.get("alpha")?.at(-1)?.result, "task:a2a-alpha");

		// Tasks the server never dispatched (channel sources) get no task server.
		const before = seen.length;
		await host.run("slack-gamma", "gamma");
		assert.equal(seen.length, before);
		assert.ok(!(turns.get("gamma")?.at(-1)?.tools ?? []).includes("mcp__task__whoami"));
	} finally {
		await Promise.all([host.close(), otherHost.close()]);
		for (const open of [server, generic.server, shadow.server, other.server]) {
			open.closeAllConnections();
			await new Promise<void>((resolve) => open.close(() => resolve()));
		}
		await rm(root, { recursive: true, force: true });
	}
});

test("task MCP configuration accepts only a credential-free loopback relay and literal Task IDs", () => {
	assert.equal(SUPPORTED_TASK_MCP_PI_VERSION, "1.4.0");
	assert.equal(taskMcpServer(undefined), undefined);
	assert.equal(taskMcpServer("http://127.0.0.1:4141/mcp")?.url, "http://127.0.0.1:4141/mcp");
	for (const bad of [
		"https://platform.example/mcp",
		"http://user:pass@127.0.0.1:4141/mcp",
		"http://127.0.0.1:4141/mcp?task=x",
		"http://127.0.0.1:4141/mcp#x",
	])
		assert.throws(() => taskMcpServer(bad), /loopback/);
	const server = taskMcpServer("http://127.0.0.1:4141/mcp");
	for (const taskId of [`$${"{HOME}"}`, "!id", "a b"])
		assert.throws(() => taskSessionMcpExtensions(taskId, server), /cannot select/);
	assert.equal(taskSessionMcpExtensions("task-1", server).length, 4);
	assert.equal(taskSessionMcpExtensions("task-1", undefined).length, 3);
});

async function guardedHarness() {
	const root = await mkdtemp(join(tmpdir(), "channels-mcp-guard-"));
	await mkdir(join(root, "agent"), { recursive: true });
	const remote = await mcpServer(new Set());
	const active = new Set(["task-alpha", "task-beta"]);
	const terminal = new Set<string>();
	const turns = new Map<string, Turn[]>();
	faux.setResponses(Array.from({ length: 80 }, () => script(turns)));
	const host = new TaskSessionHost({
		cwd: root,
		agentDir: join(root, "agent"),
		sessionDir: join(root, "sessions"),
		customTools: [],
		additionalExtensionPaths: [new URL("./helpers/faux-model.ts", import.meta.url).pathname],
		excludedExtensionRoot: join(root, "not-channels"),
		model: () => faux.getModel() as never,
		taskMcp: taskMcpServer(
			remote.url,
			() => true,
			async (taskId) => active.has(taskId) && !terminal.has(taskId),
		),
	});
	return {
		...remote,
		host,
		active,
		terminal,
		turns,
		root,
		async close() {
			await host.close();
			remote.server.closeAllConnections();
			await new Promise<void>((resolve) => remote.server.close(() => resolve()));
			await rm(root, { recursive: true, force: true });
		},
	};
}

function deferred() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function entered(promise: Promise<void>) {
	const deadline = AbortSignal.timeout(5000);
	await Promise.race([
		promise,
		new Promise<void>((_, reject) =>
			deadline.addEventListener("abort", () => reject(new Error("MCP call did not arrive")), {
				once: true,
			}),
		),
	]);
}

test("cached native Task connections deny inactive turns and reject terminal results before model exposure", async () => {
	const f = await guardedHarness();
	const arrived = deferred(),
		finish = deferred();
	try {
		await f.host.run("task-alpha", "warmup");
		f.active.delete("task-alpha");
		const before = f.seen.length;
		await f.host.run("task-alpha", "inactive");
		assert.equal(
			f.seen.length,
			before,
			"an idle task cannot send through its cached native client",
		);
		assert.equal(f.turns.get("inactive")?.at(-1)?.isError, true);
		f.active.add("task-alpha");
		f.streamHold.set("task-alpha", async () => {
			arrived.resolve();
			await finish.promise;
		});
		const pending = f.host.run("task-alpha", "terminal-during-call");
		await entered(arrived.promise);
		f.terminal.add("task-alpha");
		finish.resolve();
		await pending;
		const output = f.turns.get("terminal-during-call")?.at(-1);
		assert.equal(output?.isError, true);
		assert.ok(
			!output?.result?.includes("task:task-alpha"),
			"a response after terminal state never reaches the model",
		);
		await f.host.release("task-alpha");
		const beforeReopen = f.seen.length;
		await f.host.run("task-alpha", "terminal-reopened");
		assert.equal(
			f.seen.length,
			beforeReopen,
			"terminal reopened sessions cannot initialize or call",
		);
		assert.ok(!f.turns.get("terminal-reopened")?.at(-1)?.result?.includes("task:task-alpha"));
	} finally {
		finish.resolve();
		await f.close();
	}
});

test("native Task cancellation closes a blocked request while another Task's connection remains usable", async () => {
	const f = await guardedHarness();
	const arrived = deferred(),
		finish = deferred();
	try {
		await Promise.all([
			f.host.run("task-alpha", "alpha-start"),
			f.host.run("task-beta", "beta-start"),
		]);
		f.hold.set("task-alpha", async () => {
			arrived.resolve();
			await finish.promise;
		});
		const pending = f.host.run("task-alpha", "cancel-alpha").catch(() => {});
		await entered(arrived.promise);
		f.active.delete("task-alpha");
		await f.host.release("task-alpha");
		finish.resolve();
		await pending;
		await f.host.run("task-beta", "beta-survives");
		assert.equal(f.turns.get("beta-survives")?.at(-1)?.result, "task:task-beta");
		assert.ok(!f.turns.get("cancel-alpha")?.at(-1)?.result?.includes("task:task-alpha"));
	} finally {
		finish.resolve();
		await f.close();
	}
});

test("native Task responses are bounded and missing local authority fails closed", async () => {
	const f = await guardedHarness();
	try {
		await f.host.run("task-alpha", "warmup-bounds");
		f.payload.set("task-alpha", `sensitive:${"x".repeat(2 * 1024 * 1024)}`);
		await f.host.run("task-alpha", "oversized");
		assert.equal(f.turns.get("oversized")?.at(-1)?.isError, true);
		assert.ok(!f.turns.get("oversized")?.at(-1)?.result?.includes("sensitive:"));
		f.active.delete("task-alpha");
		const count = f.seen.length;
		await f.host.release("task-alpha");
		await f.host.run("task-alpha", "no-authority");
		assert.equal(f.seen.length, count);
	} finally {
		await f.close();
	}
});
