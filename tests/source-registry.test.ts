import assert from "node:assert/strict";
import test from "node:test";
import channelEventsExtension, {
	createSourceRegistry,
	type SourceModuleEvaluator,
} from "../extensions/index.ts";
import type { AgentChannelActions } from "../extensions/sources/agent.ts";
import type { ChannelSource } from "../extensions/sources/types.ts";
import type { SourceTaskActivationSink } from "../extensions/task-plane/types.ts";

interface CapturedTool {
	readonly name: string;
	execute(toolCallId: string, params: Record<string, string>): Promise<unknown>;
}

type CapturedHandler = (event?: unknown, context?: unknown) => Promise<void> | void;

test("concurrent agent registry paths evaluate the source module once", async () => {
	const priorSelection = process.env.OUTFITTER_CHANNELS;
	const priorEndpoint = process.env.AGENT_ENDPOINT_ID;
	const priorSpool = process.env.AGENT_SPOOL_PATH;
	const handlers = new Map<string, CapturedHandler>();
	const tools = new Map<string, CapturedTool>();
	let evaluations = 0;

	const source: ChannelSource = {
		async start() {
			return async () => {};
		},
	};
	const actions: AgentChannelActions = {
		async read(locator) {
			return { channel: "agent", locator, handled: false, messages: [] };
		},
		async respond(locator) {
			return { channel: "agent", locator, replied: true, handled: true };
		},
		async list() {
			return [];
		},
		async send() {
			throw new Error("unused");
		},
	};
	const fakeAgentModule = {
		agentConfigFromEnv: () => ({
			endpointId: "resident",
			principalId: "resident",
			spoolPath: "/tmp",
		}),
		createAgentSource: () => source,
		createAgentActions: () => actions,
		createAgentStreamForwarder: () => Object.assign(() => {}, { stop() {} }),
	};
	const evaluate = (async (specifier: string) => {
		assert.equal(specifier, "./sources/agent.ts");
		evaluations += 1;
		// Keep the first evaluation pending while every registry path asks for it.
		await new Promise((resolve) => setImmediate(resolve));
		return fakeAgentModule;
	}) as SourceModuleEvaluator;

	try {
		process.env.OUTFITTER_CHANNELS = "agent";
		process.env.AGENT_ENDPOINT_ID = "resident";
		process.env.AGENT_SPOOL_PATH = "/tmp";
		channelEventsExtension(
			{
				on(event: string, handler: CapturedHandler) {
					handlers.set(event, handler);
				},
				registerTool(tool: CapturedTool) {
					tools.set(tool.name, tool);
				},
				appendEntry() {},
			} as never,
			unusedTaskSink,
			createSourceRegistry(evaluate),
		);

		const startup = handlers.get("session_start");
		const messageUpdate = handlers.get("message_update");
		const channelRead = tools.get("channel_read");
		const agentList = tools.get("agent_list");
		assert.ok(startup);
		assert.ok(messageUpdate);
		assert.ok(channelRead);
		assert.ok(agentList);

		await Promise.all(
			Array.from({ length: 25 }, async (_, iteration) => {
				const locator = `agent:v1:message-${iteration}`;
				const pending = [
					startup(),
					channelRead.execute(`read-${iteration}`, { locator }),
					agentList.execute(`list-${iteration}`, {}),
				];
				messageUpdate({ type: "text_delta", delta: "preview" });
				await Promise.all(pending);
			}),
		);

		assert.equal(evaluations, 1);
	} finally {
		restoreEnv("OUTFITTER_CHANNELS", priorSelection);
		restoreEnv("AGENT_ENDPOINT_ID", priorEndpoint);
		restoreEnv("AGENT_SPOOL_PATH", priorSpool);
	}
});

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

function unusedTaskSink(): SourceTaskActivationSink {
	return {
		async accept() {
			throw new Error("unused");
		},
		async continue() {
			throw new Error("unused");
		},
	};
}
