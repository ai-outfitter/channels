import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AgentChannelActions } from "./sources/agent.ts";

export type AgentActionsResolver = () => Promise<AgentChannelActions>;

export function registerAgentTools(pi: ExtensionAPI, resolve: AgentActionsResolver): void {
	pi.registerTool({
		name: "agent_list",
		label: "List agent endpoints",
		description: "List agent endpoints visible to this authenticated agent channel principal.",
		parameters: Type.Object({}),
		async execute() {
			const endpoints = await (await resolve()).list();
			return {
				content: [
					{
						type: "text",
						text:
							endpoints.length === 0
								? "No agent endpoints are visible."
								: endpoints.map((endpoint) => `${endpoint.id} (${endpoint.principal})`).join("\n"),
					},
				],
				details: { endpoints },
			};
		},
	});

	pi.registerTool({
		name: "agent_send",
		label: "Send agent message",
		description:
			"Durably send an untrusted chat message to an agent endpoint. Reuse id for safe retries.",
		promptGuidelines: [
			"Use agent_list when the exact recipient endpoint is not already known.",
			"Reuse the same id when retrying an uncertain send.",
		],
		parameters: Type.Object({
			recipient: Type.String({ minLength: 1, maxLength: 128 }),
			conversationId: Type.String({ minLength: 1, maxLength: 128 }),
			body: Type.String({ minLength: 1, maxLength: 40_000 }),
			id: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
			replyTo: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
		}),
		async execute(_toolCallId, params) {
			const result = await (await resolve()).send({
				recipient: params.recipient,
				conversationId: params.conversationId,
				body: params.body,
				...(params.id === undefined ? {} : { id: params.id }),
				...(params.replyTo === undefined ? {} : { replyTo: params.replyTo }),
			});
			return {
				content: [
					{
						type: "text",
						text: result.duplicate
							? `Agent message ${result.message.id} was already ${result.state}.`
							: `Agent message ${result.message.id} was accepted.`,
					},
				],
				details: result,
			};
		},
	});
}
