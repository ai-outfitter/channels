import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
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
		if (!this.#policy.allowedTools.includes(toolName)) {
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
