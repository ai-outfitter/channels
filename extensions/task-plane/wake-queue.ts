import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { A2aTaskStore } from "../a2a/store.ts";
import { INTERRUPTED_TASK_STATES, isTerminal } from "../a2a/types.ts";
import { errorMessage } from "../sources/util.ts";
import type { ActivationClaim, ActivationJournal } from "./journal.ts";
import type { TaskTurnRunner } from "./task-sessions.ts";

interface PendingWake {
	readonly claim: ActivationClaim;
	readonly prompt: string;
	attempts: number;
}

const MAX_WAKE_ATTEMPTS = 3;
const WAKE_RETRY_BASE_MS = 10;
export const MAX_WAKE_DELIVERIES = 5;
export const MAX_PENDING_WAKES = 128;

export class DurableWakeQueue {
	readonly #pi: Pick<ExtensionAPI, "sendUserMessage">;
	readonly #tasks: A2aTaskStore;
	readonly #journal: ActivationJournal;
	readonly #log: (record: Readonly<Record<string, unknown>>) => void;
	readonly #recordUnhealthy: (claim: ActivationClaim, error: string) => Promise<void>;
	readonly #taskTurns: TaskTurnRunner | undefined;
	#pending: PendingWake[] = [];
	#offered: PendingWake | undefined;
	#activeTaskId: string | undefined;
	#pumping = false;
	#pumpFailures = 0;
	#retryTimer: ReturnType<typeof setTimeout> | undefined;
	#stopped = false;

	constructor(
		pi: Pick<ExtensionAPI, "sendUserMessage">,
		tasks: A2aTaskStore,
		journal: ActivationJournal,
		log: (record: Readonly<Record<string, unknown>>) => void = () => {},
		recordUnhealthy: (claim: ActivationClaim, error: string) => Promise<void> = async () => {},
		taskTurns?: TaskTurnRunner,
	) {
		this.#pi = pi;
		this.#tasks = tasks;
		this.#journal = journal;
		this.#log = log;
		this.#recordUnhealthy = recordUnhealthy;
		this.#taskTurns = taskTurns;
	}

	async replay(): Promise<void> {
		for (const claim of this.#journal.claims()) {
			if (
				this.#journal.isAccepted(claim.activationId) &&
				!this.#journal.isWakeFailed(claim.activationId)
			) {
				const stored = await this.#tasks.lookup(claim.taskId);
				if (!stored || isTerminal(stored.task.status.state)) {
					await this.#consumeSettled(claim);
					continue;
				}
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
		if (this.#pending.length >= MAX_PENDING_WAKES) {
			const error = `wake queue pending limit ${MAX_PENDING_WAKES} reached`;
			this.#log({
				event: "a2a_wake_overflow",
				taskId: claim.taskId,
				activationId: claim.activationId,
				limit: MAX_PENDING_WAKES,
			});
			void this.#journal
				.append({
					kind: "WAKE_FAILED",
					activationId: claim.activationId,
					attempts: 0,
					error,
					failedAt: new Date().toISOString(),
				})
				.catch((appendError) => {
					this.#log({
						event: "a2a_wake_overflow_evidence_failed",
						taskId: claim.taskId,
						activationId: claim.activationId,
						error: errorMessage(appendError),
					});
				});
			return;
		}
		this.#pending.push({ claim, prompt: taskWakePrompt(claim.taskId), attempts: 0 });
		void this.#pump();
	}

	async beforeAgentStart(prompt: string): Promise<void> {
		const wake = this.#offered;
		// Pi does not necessarily fire this hook for a follow-up drained by an
		// already-running agent loop. Delivery owns the transition and authority;
		// when the hook does fire it only confirms the correlation.
		if (!wake || wake.prompt !== prompt || this.#activeTaskId !== wake.claim.taskId) return;
	}

	#hasLaterAcceptedClaim(claim: ActivationClaim): boolean {
		let found = false;
		for (const candidate of this.#journal.claims()) {
			if (candidate.activationId === claim.activationId) {
				found = true;
				continue;
			}
			if (
				found &&
				candidate.taskId === claim.taskId &&
				this.#journal.isAccepted(candidate.activationId)
			) {
				return true;
			}
		}
		return false;
	}

	agentEnd(): void {
		const wake = this.#offered;
		this.#activeTaskId = undefined;
		this.#offered = undefined;
		// A delivered wake whose turn did not settle the Task is eligible for a
		// bounded re-offer. The pump checks terminal state before enforcing the cap.
		if (wake) this.#pending.unshift(wake);
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
		if (this.#retryTimer) clearTimeout(this.#retryTimer);
		this.#retryTimer = undefined;
		this.#pending = [];
		this.#offered = undefined;
		this.#activeTaskId = undefined;
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: wake delivery and durable retry transitions remain one state machine
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
			const deliveries = this.#journal.wakeDeliveries(wake.claim.activationId);
			if (deliveries >= MAX_WAKE_DELIVERIES) {
				await this.#failDeliveryCap(wake.claim, deliveries);
				return;
			}
			if (!(await this.#grant(wake, stored))) return;
			this.#offered = wake;
			this.#activeTaskId = wake.claim.taskId;
			try {
				if (this.#taskTurns) {
					await this.#taskTurns.run(wake.claim.taskId, wake.prompt);
					await this.#finishTaskTurn(wake);
				} else {
					await Promise.resolve(this.#pi.sendUserMessage(wake.prompt, { deliverAs: "followUp" }));
				}
				this.#pumpFailures = 0;
				this.#log({ event: "agent_woken", taskId: wake.claim.taskId });
			} catch (error) {
				this.#offered = undefined;
				this.#activeTaskId = undefined;
				wake.attempts += 1;
				const message = errorMessage(error);
				this.#log({
					event: "a2a_wake_failed",
					taskId: wake.claim.taskId,
					attempt: wake.attempts,
					error: message,
				});
				if (wake.attempts >= MAX_WAKE_ATTEMPTS) {
					if (this.#taskTurns) {
						await this.#taskTurns.release(wake.claim.taskId);
						await this.#recordUnhealthy(wake.claim, message);
					} else {
						await this.#journal.append({
							kind: "WAKE_FAILED",
							activationId: wake.claim.activationId,
							attempts: wake.attempts,
							error: message,
							failedAt: new Date().toISOString(),
						});
					}
					this.#log({
						event: this.#taskTurns ? "a2a_task_turn_paused" : "a2a_wake_abandoned",
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
			this.#pumpFailures += 1;
			this.#log({
				event: "a2a_wake_pump_failed",
				taskId: wake?.claim.taskId,
				error: errorMessage(error),
			});
			const retryDelayMs = Math.min(WAKE_RETRY_BASE_MS * 2 ** (this.#pumpFailures - 1), 1_000);
			if (!this.#stopped && !this.#retryTimer) {
				this.#retryTimer = setTimeout(() => {
					this.#retryTimer = undefined;
					void this.#pump();
				}, retryDelayMs);
			}
		} finally {
			this.#pumping = false;
			if (!failed && !this.#offered && !this.#activeTaskId && this.#pending.length > 0) {
				this.#pumpFailures = 0;
				void this.#pump();
			}
		}
	}

	async #finishTaskTurn(wake: PendingWake): Promise<void> {
		const stored = await this.#tasks.lookup(wake.claim.taskId);
		this.#activeTaskId = undefined;
		this.#offered = undefined;
		if (stored && isTerminal(stored.task.status.state)) {
			await this.#taskTurns?.release(wake.claim.taskId);
		} else if (stored && !INTERRUPTED_TASK_STATES.includes(stored.task.status.state as never)) {
			this.#pending.unshift(wake);
		}
	}

	#restore(wake: PendingWake): void {
		if (
			this.#stopped ||
			this.#journal.isWakeFailed(wake.claim.activationId) ||
			this.#offered?.claim.activationId === wake.claim.activationId ||
			this.#pending.some((pending) => pending.claim.activationId === wake.claim.activationId)
		) {
			return;
		}
		this.#pending.unshift(wake);
	}

	async #grant(
		wake: PendingWake,
		stored: NonNullable<Awaited<ReturnType<A2aTaskStore["lookup"]>>>,
	): Promise<boolean> {
		try {
			const preservingInterruptedState =
				INTERRUPTED_TASK_STATES.includes(stored.task.status.state as never) &&
				this.#journal.isWoken(wake.claim.activationId) &&
				!this.#hasLaterAcceptedClaim(wake.claim);
			if (!preservingInterruptedState) {
				await this.#tasks.updateStatus(stored.principal, stored.task.id, {
					state: "TASK_STATE_WORKING",
				});
			}
		} catch {
			// Cancellation can win between lookup and transition. Re-read before
			// granting authority; terminal work is consumed without a turn.
			const current = await this.#tasks.lookup(wake.claim.taskId);
			if (!current || isTerminal(current.task.status.state)) {
				await this.#consumeSettled(wake.claim);
				return false;
			}
			throw new Error(`task "${wake.claim.taskId}" could not start`);
		}
		await this.#markConsumed(wake.claim);
		const delivery = this.#journal.wakeDeliveries(wake.claim.activationId) + 1;
		await this.#journal.append({
			kind: "WAKE_DELIVERED",
			activationId: wake.claim.activationId,
			delivery,
			deliveredAt: new Date().toISOString(),
		});
		return true;
	}

	async #failDeliveryCap(claim: ActivationClaim, deliveries: number): Promise<void> {
		const error = `wake delivery cap ${MAX_WAKE_DELIVERIES} reached without Task settlement`;
		await this.#taskTurns?.release(claim.taskId);
		await this.#recordUnhealthy(claim, error);
		await this.#journal.append({
			kind: "WAKE_FAILED",
			activationId: claim.activationId,
			attempts: deliveries,
			error,
			failedAt: new Date().toISOString(),
		});
		this.#log({
			event: "a2a_wake_abandoned",
			taskId: claim.taskId,
			activationId: claim.activationId,
			attempts: deliveries,
			error,
		});
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
