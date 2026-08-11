import type { A2aExecutorContext, A2aTaskController } from "../a2a/server.ts";
import { A2A_PROTOCOL_VERSION, isTerminal } from "../a2a/types.ts";
import type { OriginStore } from "./store.ts";
import { activationFromMessage, type ChannelActivation, type TaskLocator } from "./types.ts";

const ROUTER_ID = "channels-source-router";
const ROUTER_VERSION = "1";

export interface RoutedTask {
	readonly controller: A2aTaskController;
	readonly activation?: ChannelActivation;
	readonly relation?: "created" | "continued";
}

/** Persists source evidence before selecting a new or correlated A2A Task. */
export class OriginRouter {
	readonly #store: OriginStore;
	readonly #agentInterface: string;

	constructor(store: OriginStore, agentInterface: string) {
		this.#store = store;
		this.#agentInterface = agentInterface;
	}

	async route(context: A2aExecutorContext): Promise<RoutedTask> {
		const input = activationFromMessage(context.message);
		if (!input) return { controller: await context.begin() };
		const activation = await this.#store.recordActivation(context.principal, input);
		const selected = await this.#selectContinuation(context, activation);
		const action = selected ? "continue" : "create";
		await this.#store.recordDecision(activation.id, {
			action,
			reasonCode: selected ? "correlated-nonterminal-task" : "no-correlated-nonterminal-task",
			decider: { kind: "policy", id: ROUTER_ID, version: ROUTER_VERSION },
		});
		const controller = await context.begin(selected?.id);
		await this.#store.recordOrigin(
			activation.id,
			selected ? "continued" : "created",
			this.#locator(controller.task.id),
		);
		return {
			controller,
			activation,
			relation: selected ? "continued" : "created",
		};
	}

	async #selectContinuation(context: A2aExecutorContext, activation: ChannelActivation) {
		if (context.task && !isTerminal(context.task.status.state)) return context.task;
		if (!activation.correlationKey || !context.lookupTask) return undefined;
		const locator = await this.#store.correlatedTask(
			context.principal,
			activation.sourceKind,
			activation.correlationKey,
		);
		if (!locator || locator.agentInterface !== this.#agentInterface) return undefined;
		const task = await context.lookupTask(locator.taskId);
		return task && !isTerminal(task.status.state) ? task : undefined;
	}

	#locator(taskId: string): TaskLocator {
		return {
			agentInterface: this.#agentInterface,
			protocolBinding: "HTTP+JSON",
			protocolVersion: A2A_PROTOCOL_VERSION,
			taskId,
		};
	}
}
