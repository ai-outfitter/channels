import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { A2aTaskStore } from "../a2a/store.ts";
import { isTerminal } from "../a2a/types.ts";
import { errorMessage } from "../sources/util.ts";
import type { ActivationClaim, ActivationJournal } from "./journal.ts";

interface PendingWake {
	readonly claim: ActivationClaim;
	readonly prompt: string;
	attempts: number;
}

const MAX_WAKE_ATTEMPTS = 3;
const WAKE_RETRY_BASE_MS = 10;

export class DurableWakeQueue {
	readonly #pi: Pick<ExtensionAPI, "sendUserMessage">;
	readonly #tasks: A2aTaskStore;
	readonly #journal: ActivationJournal;
	readonly #log: (record: Readonly<Record<string, unknown>>) => void;
	#pending: PendingWake[] = [];
	#offered: PendingWake | undefined;
	#activeTaskId: string | undefined;
	#pumping = false;
	#stopped = false;

	constructor(
		pi: Pick<ExtensionAPI, "sendUserMessage">,
		tasks: A2aTaskStore,
		journal: ActivationJournal,
		log: (record: Readonly<Record<string, unknown>>) => void = () => {},
	) {
		this.#pi = pi;
		this.#tasks = tasks;
		this.#journal = journal;
		this.#log = log;
	}

	async replay(): Promise<void> {
		for (const claim of this.#journal.claims()) {
			if (
				this.#journal.isAccepted(claim.activationId) &&
				!this.#journal.isWakeFailed(claim.activationId)
			) {
				this.#enqueue(claim, true);
			}
		}
	}

	enqueue(claim: ActivationClaim): void {
		this.#enqueue(claim, false);
	}

	#enqueue(claim: ActivationClaim, recovering: boolean): void {
		if (
			this.#stopped ||
			this.#journal.isWakeFailed(claim.activationId) ||
			(!recovering && this.#journal.isWoken(claim.activationId)) ||
			this.#pending.some((wake) => wake.claim.activationId === claim.activationId) ||
			this.#offered?.claim.activationId === claim.activationId
		) {
			return;
		}
		this.#pending.push({ claim, prompt: taskWakePrompt(claim.taskId), attempts: 0 });
		void this.#pump();
	}

	async beforeAgentStart(prompt: string): Promise<void> {
		const wake = this.#offered;
		if (!wake || wake.prompt !== prompt) return;
		this.#offered = undefined;
		try {
			const stored = await this.#tasks.lookup(wake.claim.taskId);
			if (!stored || isTerminal(stored.task.status.state)) {
				await this.#consumeSettled(wake.claim);
				return;
			}
			try {
				await this.#tasks.updateStatus(stored.principal, stored.task.id, {
					state: "TASK_STATE_WORKING",
				});
			} catch {
				// Cancellation can win between lookup and transition. Re-read before
				// granting authority; terminal work is consumed without a turn.
				const current = await this.#tasks.lookup(wake.claim.taskId);
				if (!current || isTerminal(current.task.status.state)) {
					await this.#consumeSettled(wake.claim);
					return;
				}
				throw new Error(`task "${wake.claim.taskId}" could not start`);
			}
			await this.#markConsumed(wake.claim);
			this.#activeTaskId = wake.claim.taskId;
		} catch (error) {
			this.#restore(wake);
			void this.#pump();
			throw error;
		}
	}

	agentEnd(): void {
		this.#activeTaskId = undefined;
		// A follow-up can be accepted by Pi while another turn streams without a
		// matching before_agent_start callback. Do not let that stale correlation
		// wedge every later wake: put the unclaimed offer back and try it again.
		if (this.#offered) {
			this.#pending.unshift(this.#offered);
			this.#offered = undefined;
		}
		void this.#pump();
	}

	async hasAuthority(taskId: string): Promise<boolean> {
		if (this.#activeTaskId !== taskId) return false;
		const stored = await this.#tasks.lookup(taskId);
		if (!stored || isTerminal(stored.task.status.state)) {
			this.#activeTaskId = undefined;
			return false;
		}
		return true;
	}

	sourceForTask(taskId: string): string | undefined {
		return this.#journal.claims().find((claim) => claim.taskId === taskId)?.input.source;
	}

	stop(): void {
		this.#stopped = true;
		this.#pending = [];
		this.#offered = undefined;
		this.#activeTaskId = undefined;
	}

	async #pump(): Promise<void> {
		if (this.#pumping || this.#stopped || this.#offered || this.#activeTaskId) return;
		this.#pumping = true;
		let wake: PendingWake | undefined;
		let failed = false;
		try {
			wake = this.#pending.shift();
			if (!wake) return;
			const stored = await this.#tasks.lookup(wake.claim.taskId);
			if (!stored || isTerminal(stored.task.status.state)) {
				// The finally block below re-pumps, so consume without recursing.
				await this.#markConsumed(wake.claim);
				return;
			}
			this.#offered = wake;
			try {
				await this.#pi.sendUserMessage(wake.prompt, { deliverAs: "followUp" });
				this.#log({ event: "agent_woken", taskId: wake.claim.taskId });
			} catch (error) {
				this.#offered = undefined;
				wake.attempts += 1;
				const message = errorMessage(error);
				this.#log({
					event: "a2a_wake_failed",
					taskId: wake.claim.taskId,
					attempt: wake.attempts,
					error: message,
				});
				if (wake.attempts >= MAX_WAKE_ATTEMPTS) {
					await this.#journal.append({
						kind: "WAKE_FAILED",
						activationId: wake.claim.activationId,
						attempts: wake.attempts,
						error: message,
						failedAt: new Date().toISOString(),
					});
					this.#log({
						event: "a2a_wake_abandoned",
						taskId: wake.claim.taskId,
						attempts: wake.attempts,
						error: message,
					});
				} else {
					this.#pending.unshift(wake);
					const retryDelayMs = WAKE_RETRY_BASE_MS * 2 ** (wake.attempts - 1);
					await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
				}
			}
		} catch (error) {
			failed = true;
			if (wake) this.#restore(wake);
			this.#log({
				event: "a2a_wake_pump_failed",
				taskId: wake?.claim.taskId,
				error: errorMessage(error),
			});
		} finally {
			this.#pumping = false;
			if (!failed && !this.#offered && !this.#activeTaskId && this.#pending.length > 0) {
				void this.#pump();
			}
		}
	}

	#restore(wake: PendingWake): void {
		if (
			this.#stopped ||
			this.#journal.isWakeFailed(wake.claim.activationId) ||
			this.#journal.isWoken(wake.claim.activationId) ||
			this.#offered?.claim.activationId === wake.claim.activationId ||
			this.#pending.some((pending) => pending.claim.activationId === wake.claim.activationId)
		) {
			return;
		}
		this.#pending.unshift(wake);
	}

	/** Retire a wake whose Task is gone or terminal, then look for the next one. */
	async #consumeSettled(claim: ActivationClaim): Promise<void> {
		await this.#markConsumed(claim);
		void this.#pump();
	}

	async #markConsumed(claim: ActivationClaim): Promise<void> {
		if (this.#journal.isWoken(claim.activationId)) return;
		await this.#journal.append({
			kind: "WOKEN",
			activationId: claim.activationId,
			wokenAt: new Date().toISOString(),
		});
	}
}

/** The single body-free wake text every A2A task path sends. */
export function taskWakePrompt(taskId: string): string {
	return `[channels] a2a task ${taskId} awaits. Read it with a2a_read_task, then settle it with a2a_complete_task or a2a_require_input.`;
}
