import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defaultTaskPlaneRoot } from "../a2a/server.ts";
import type { A2aMessage, A2aTask } from "../a2a/types.ts";
import { taskMetadataFromTask } from "../a2a/types.ts";
import { DevelopmentEvidenceStore } from "./store.ts";
import type {
	EvidenceActor,
	EvidenceManifest,
	EvidencePolicyBundle,
	EvidenceRecord,
	EvidenceRunIdentity,
} from "./types.ts";

export interface EvidenceRuntimeConfig {
	readonly rootPath: string;
	readonly actor: EvidenceActor;
	readonly policy: EvidencePolicyBundle;
}

interface ActiveAction {
	readonly actionId: string;
	readonly decision: EvidenceRecord;
}

export interface TaskEvidence {
	readonly policyDigest: string;
	initialize(): Promise<void>;
	activate(task: A2aTask, message?: A2aMessage): Promise<EvidenceRunIdentity>;
	beforeTool(taskId: string, toolCallId: string, toolName: string, input: unknown): Promise<void>;
	afterTool(taskId: string, toolCallId: string, toolName: string, result: unknown): Promise<void>;
	finalize(taskId: string, artifact: unknown): Promise<EvidenceManifest>;
	references(taskId: string): readonly string[];
	close(): Promise<void>;
}

export class TaskEvidenceRuntime implements TaskEvidence {
	readonly #store: DevelopmentEvidenceStore;
	readonly #policy: EvidencePolicyBundle;
	readonly #runs = new Map<string, EvidenceRunIdentity>();
	readonly #actions = new Map<string, ActiveAction>();
	readonly #failures = new Map<string, Error>();
	readonly #references = new Map<string, string[]>();

	constructor(config: EvidenceRuntimeConfig) {
		this.#store = new DevelopmentEvidenceStore(config.rootPath, config.actor, config.policy);
		this.#policy = config.policy;
	}

	get policyDigest(): string {
		return this.#store.policyDigest;
	}

	async initialize(): Promise<void> {
		await this.#store.initialize();
	}

	async activate(task: A2aTask, message?: A2aMessage): Promise<EvidenceRunIdentity> {
		const metadata = taskMetadataFromTask(task);
		if (metadata.policyDigest !== this.policyDigest) {
			throw new Error("task policy digest does not match the evidence sink policy");
		}
		const run: EvidenceRunIdentity = {
			ticketRunId: metadata.ticketRunId,
			task: metadata.task,
			attemptId: randomUUID(),
			turnId: randomUUID(),
		};
		const request = await this.#store.putPayload(
			message ?? { recoveredTaskId: task.id, state: task.status.state },
		);
		const activation = await this.#store.append({
			recordType: "task.activation",
			run,
			request,
			metadata: { recovered: message === undefined },
		});
		this.#references.set(task.id, [activation.recordId]);
		this.#runs.set(task.id, run);
		return run;
	}

	async beforeTool(
		taskId: string,
		toolCallId: string,
		toolName: string,
		input: unknown,
	): Promise<void> {
		const run = this.#requireRun(taskId);
		if (!toolAllowed(this.#policy.allowedTools, toolName)) {
			throw new Error(`policy does not allow tool "${toolName}"`);
		}
		try {
			const request = await this.#store.putPayload({ toolName, input });
			const decision = await this.#store.append({
				recordType: "policy.decision",
				run,
				actionId: toolCallId,
				request,
				metadata: { decision: "allow", toolName },
			});
			await this.#store.append({
				recordType: "tool.call",
				run,
				actionId: toolCallId,
				request,
				decisionRecordId: decision.recordId,
				parentRecordIds: [decision.recordId],
			});
			this.#actions.set(`${taskId}:${toolCallId}`, { actionId: toolCallId, decision });
		} catch (error) {
			this.#failures.set(taskId, error as Error);
			throw error;
		}
	}

	async afterTool(
		taskId: string,
		toolCallId: string,
		toolName: string,
		result: unknown,
	): Promise<void> {
		const run = this.#requireRun(taskId);
		const action = this.#actions.get(`${taskId}:${toolCallId}`);
		if (!action) throw new Error(`tool result has no captured request for ${toolCallId}`);
		try {
			const response = await this.#store.putPayload({ toolName, result });
			await this.#store.append({
				recordType: "tool.result",
				run,
				actionId: action.actionId,
				response,
				decisionRecordId: action.decision.recordId,
				parentRecordIds: [action.decision.recordId],
			});
			this.#actions.delete(`${taskId}:${toolCallId}`);
		} catch (error) {
			this.#failures.set(taskId, error as Error);
			throw error;
		}
	}

	async finalize(taskId: string, artifact: unknown): Promise<EvidenceManifest> {
		const failure = this.#failures.get(taskId);
		if (failure) throw new Error(`required evidence capture failed: ${failure.message}`);
		const run = this.#requireRun(taskId);
		const response = await this.#store.putPayload(artifact);
		const artifactRecord = await this.#store.append({
			recordType: "artifact.created",
			run,
			response,
		});
		const manifest = await this.#store.finalize(run);
		this.#references.set(taskId, [
			...(this.#references.get(taskId) ?? []),
			artifactRecord.recordId,
			manifest.record.recordId,
		]);
		return manifest;
	}

	references(taskId: string): readonly string[] {
		return [...(this.#references.get(taskId) ?? [])];
	}

	async close(): Promise<void> {
		await this.#store.close();
	}

	#requireRun(taskId: string): EvidenceRunIdentity {
		const run = this.#runs.get(taskId);
		if (!run) throw new Error(`task ${taskId} has no active evidence run`);
		return run;
	}
}

/** The evidence ledger and task a tool call should be recorded against, if any. */
export interface EvidenceCapture {
	readonly evidence: TaskEvidence;
	readonly taskId: string;
}

/**
 * Record every tool call and result of the active task in its evidence ledger.
 * A capture failure blocks the call rather than letting the task proceed with an
 * incomplete manifest. Only settlement tools are exempt because they close the
 * task whose ledger is being captured. Outbound A2A tools remain policy-gated
 * and recorded.
 */
export function registerEvidenceHooks(
	pi: ExtensionAPI,
	capture: () => EvidenceCapture | undefined,
): void {
	const settlementTools = new Set([
		"a2a_read_task",
		"a2a_complete_task",
		"a2a_require_input",
		"a2a_relay_read_task",
		"a2a_relay_complete_task",
		"a2a_relay_require_input",
	]);
	pi.on("tool_call", async (event) => {
		const active = capture();
		if (!active || settlementTools.has(event.toolName)) return;
		try {
			await active.evidence.beforeTool(
				active.taskId,
				event.toolCallId,
				event.toolName,
				event.input,
			);
			return undefined;
		} catch (error) {
			return {
				block: true,
				reason: `Required evidence capture failed: ${(error as Error).message}`,
			};
		}
	});

	pi.on("tool_result", async (event) => {
		const active = capture();
		if (!active || settlementTools.has(event.toolName)) return;
		try {
			await active.evidence.afterTool(active.taskId, event.toolCallId, event.toolName, {
				content: event.content,
				details: event.details,
				isError: event.isError,
			});
			return undefined;
		} catch (error) {
			return {
				isError: true,
				content: [
					{ type: "text", text: `Required evidence capture failed: ${(error as Error).message}` },
				],
			};
		}
	});
}

export async function loadEvidenceRuntime(path: string): Promise<TaskEvidenceRuntime> {
	if (!isAbsolute(path)) throw new Error("A2A_EVIDENCE_CONFIG_PATH must be absolute");
	const value = JSON.parse(await readFile(path, "utf8")) as Partial<EvidenceRuntimeConfig>;
	if (typeof value.rootPath !== "string" || !value.actor || !value.policy) {
		throw new Error("evidence config must contain rootPath, actor, and policy");
	}
	const runtime = new TaskEvidenceRuntime({
		rootPath: value.rootPath,
		actor: value.actor,
		policy: value.policy,
	});
	await runtime.initialize();
	return runtime;
}

/** Default policy for a read-and-reply resident channel agent. */
export async function defaultEvidenceRuntime(): Promise<TaskEvidenceRuntime> {
	const agent = process.env.AGENT_NAME?.trim() || "channels-agent";
	const principal = process.env.AGENT_PRINCIPAL_ID?.trim() || `agent:${agent}`;
	const runtime = new TaskEvidenceRuntime({
		rootPath: join(defaultTaskPlaneRoot(), "evidence"),
		actor: { principal, workloadIdentity: `resident:${agent}` },
		policy: {
			captureProfile: "channels-resident-channel-v1",
			capture: {
				"task.activation": "required",
				"policy.decision": "optional",
				"tool.call": "optional",
				"tool.result": "optional",
				"artifact.created": "required",
			},
			allowedTools: ["channel_read", "channel_respond", "mcp", "mcp__*"],
		},
	});
	await runtime.initialize();
	return runtime;
}

function toolAllowed(patterns: readonly string[], toolName: string): boolean {
	return patterns.some((pattern) =>
		pattern.endsWith("__*") ? toolName.startsWith(pattern.slice(0, -1)) : pattern === toolName,
	);
}
