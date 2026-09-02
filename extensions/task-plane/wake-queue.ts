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
	turnComplete: boolean;
	deliveryPending: boolean;
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
	#pumpPromise: Promise<void> | undefined;
	#currentWake: PendingWake | undefined;
	#stopPromise: Promise<void> | undefined;
	#pumpFailures = 0;
	#retryTimer: ReturnType<typeof setTimeout> | undefined;
	readonly #retired = new Set<string>();
	readonly #canceledTaskIds = new Set<string>();
	readonly #retainedTaskIds = new Set<string>();
	readonly #taskReleases = new Map<string, Promise<void>>();
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
		const newestClaims: ActivationClaim[] = [];
		const seenTaskIds = new Set<string>();
		for (const claim of this.#journal.claims().toReversed()) {
			if (seenTaskIds.has(claim.taskId) || !this.#journal.isAccepted(claim.activationId)) {
				continue;
			}
			seenTaskIds.add(claim.taskId);
			if (this.#journal.isWakeFailed(claim.activationId)) continue;
			newestClaims.unshift(claim);
		}
		for (const claim of newestClaims) {
			const stored = await this.#tasks.lookup(claim.taskId);
			if (!stored || isTerminal(stored.task.status.state)) {
				await this.#consumeSettled(claim);
				continue;
			}
			if (
				INTERRUPTED_TASK_STATES.includes(stored.task.status.state as never) &&
				this.#journal.isWoken(claim.activationId)
			) {
				continue;
			}
			this.#enqueue(claim, true);
		}
	}

	enqueue(claim: ActivationClaim): void {
		this.#enqueue(claim, false);
	}

	#enqueue(claim: ActivationClaim, recovering: boolean): void {
		if (
			this.#stopped ||
			this.#journal.isWakeFailed(claim.activationId) ||
			this.#retired.has(claim.activationId) ||
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
		this.#pending.push({
			claim,
			prompt: taskWakePrompt(claim.taskId),
			attempts: 0,
			turnComplete: false,
			deliveryPending: false,
		});
		this.#schedulePump();
	}

	async beforeAgentStart(prompt: string): Promise<void> {
		const wake = this.#offered;
		// Pi does not necessarily fire this hook for a follow-up drained by an
		// already-running agent loop. Delivery owns the transition and authority;
		// when the hook does fire it only confirms the correlation.
		if (!wake || wake.prompt !== prompt || this.#activeTaskId !== wake.claim.taskId) return;
	}

	agentEnd(): void {
		const wake = this.#offered;
		this.#activeTaskId = undefined;
		this.#offered = undefined;
		// A delivered wake whose turn did not settle the Task is eligible for a
		// bounded re-offer. The pump checks terminal state before enforcing the cap.
		if (wake) this.#pending.unshift(wake);
		this.#schedulePump();
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

	async cancelTask(taskId: string): Promise<void> {
		this.#pending = this.#pending.filter((wake) => wake.claim.taskId !== taskId);
		const currentWake = this.#currentWake?.claim.taskId === taskId ? this.#currentWake : undefined;
		const canceledActivationIds = new Set<string>();
		if (currentWake) {
			this.#canceledTaskIds.add(taskId);
			this.#retired.add(currentWake.claim.activationId);
			canceledActivationIds.add(currentWake.claim.activationId);
		}
		if (this.#offered?.claim.taskId === taskId) {
			this.#retired.add(this.#offered.claim.activationId);
			canceledActivationIds.add(this.#offered.claim.activationId);
			this.#offered = undefined;
		}
		if (this.#activeTaskId === taskId) this.#activeTaskId = undefined;
		const pump = currentWake ? this.#pumpPromise : undefined;
		await this.#releaseTask(taskId).catch((error) => {
			this.#log({ event: "a2a_task_cancel_release_failed", taskId, error: errorMessage(error) });
		});
		await pump?.catch(() => {});
		this.#canceledTaskIds.delete(taskId);
		for (const activationId of canceledActivationIds) this.#retired.delete(activationId);
		this.#schedulePump();
	}

	stop(): Promise<void> {
		if (this.#stopPromise) return this.#stopPromise;
		this.#stopped = true;
		if (this.#retryTimer) clearTimeout(this.#retryTimer);
		this.#retryTimer = undefined;
		this.#pending = [];
		this.#offered = undefined;
		this.#activeTaskId = undefined;
		this.#retired.clear();
		this.#canceledTaskIds.clear();
		const pump = this.#pumpPromise;
		const retainedTaskIds = [...this.#retainedTaskIds];
		this.#stopPromise = (async () => {
			await Promise.all(retainedTaskIds.map((taskId) => this.#releaseTask(taskId).catch(() => {})));
			await pump?.catch(() => {});
		})();
		return this.#stopPromise;
	}

	#schedulePump(): void {
		if (this.#pumpPromise) return;
		const pump = this.#pump();
		this.#pumpPromise = pump;
		void pump.finally(() => {
			if (this.#pumpPromise === pump) this.#pumpPromise = undefined;
			if (
				!this.#stopped &&
				!this.#retryTimer &&
				!this.#offered &&
				!this.#activeTaskId &&
				this.#pending.length > 0
			) {
				this.#schedulePump();
			}
		});
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
			this.#currentWake = wake;
			const stored = await this.#tasks.lookup(wake.claim.taskId);
			if (this.#stopped) return;
			if (wake.turnComplete) {
				if (wake.deliveryPending) {
					await this.#markDelivered(wake.claim);
					wake.deliveryPending = false;
				}
				await this.#finishTaskTurn(wake);
				this.#pumpFailures = 0;
				return;
			}
			if (!stored || isTerminal(stored.task.status.state)) {
				// The finally block below re-pumps, so consume without recursing.
				await this.#consumeSettled(wake.claim);
				return;
			}
			const deliveries = this.#journal.wakeDeliveries(wake.claim.activationId);
			if (deliveries >= MAX_WAKE_DELIVERIES) {
				await this.#failDeliveryCap(wake.claim, deliveries);
				return;
			}
			if (!(await this.#grant(wake, stored))) return;
			if (this.#stopped) return;
			if (this.#canceledTaskIds.has(wake.claim.taskId)) {
				await this.#consumeSettled(wake.claim);
				return;
			}
			this.#offered = wake;
			this.#activeTaskId = wake.claim.taskId;
			if (this.#taskTurns) {
				this.#retainedTaskIds.add(wake.claim.taskId);
				try {
					await this.#taskTurns.run(wake.claim.taskId, wake.prompt);
				} catch (error) {
					if (this.#stopped) return;
					await this.#handleTaskTurnFailure(wake, error);
					return;
				}
				if (this.#stopped) return;
				wake.turnComplete = true;
				wake.deliveryPending = true;
				wake.attempts = 0;
				await this.#markDelivered(wake.claim);
				wake.deliveryPending = false;
				await this.#finishTaskTurn(wake);
				this.#pumpFailures = 0;
				this.#log({ event: "agent_woken", taskId: wake.claim.taskId });
			} else {
				if (this.#stopped) return;
				try {
					await Promise.resolve(this.#pi.sendUserMessage(wake.prompt, { deliverAs: "followUp" }));
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
			}
		} catch (error) {
			failed = true;
			if (wake?.turnComplete) {
				this.#offered = undefined;
				this.#activeTaskId = undefined;
			}
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
					this.#schedulePump();
				}, retryDelayMs);
			}
		} finally {
			if (this.#currentWake === wake) this.#currentWake = undefined;
			this.#pumping = false;
			if (!failed) this.#pumpFailures = 0;
		}
	}

	async #finishTaskTurn(wake: PendingWake): Promise<void> {
		const stored = await this.#tasks.lookup(wake.claim.taskId);
		this.#activeTaskId = undefined;
		this.#offered = undefined;
		if (this.#stopped) return;
		if (
			!stored ||
			isTerminal(stored.task.status.state) ||
			INTERRUPTED_TASK_STATES.includes(stored.task.status.state as never)
		) {
			this.#canceledTaskIds.delete(wake.claim.taskId);
			await this.#releaseTask(wake.claim.taskId);
		} else {
			wake.turnComplete = false;
			this.#pending.unshift(wake);
		}
	}

	async #handleTaskTurnFailure(wake: PendingWake, error: unknown): Promise<void> {
		wake.attempts += 1;
		const message = errorMessage(error);
		this.#log({
			event: "a2a_wake_failed",
			taskId: wake.claim.taskId,
			attempt: wake.attempts,
			error: message,
		});
		let stored: Awaited<ReturnType<A2aTaskStore["lookup"]>>;
		try {
			stored = await this.#tasks.lookup(wake.claim.taskId);
		} catch (lookupError) {
			// The turn may have changed durable Task state before rejecting. Reconcile
			// that state before deciding whether another inference attempt is safe.
			wake.turnComplete = true;
			this.#offered = undefined;
			this.#activeTaskId = undefined;
			throw lookupError;
		}
		if (this.#stopped) {
			this.#offered = undefined;
			this.#activeTaskId = undefined;
			return;
		}
		if (
			!stored ||
			isTerminal(stored.task.status.state) ||
			INTERRUPTED_TASK_STATES.includes(stored.task.status.state as never)
		) {
			this.#offered = undefined;
			this.#activeTaskId = undefined;
			this.#canceledTaskIds.delete(wake.claim.taskId);
			await this.#releaseTask(wake.claim.taskId);
			this.#log({
				event: "a2a_task_turn_settled_after_failure",
				taskId: wake.claim.taskId,
				state: stored?.task.status.state,
				error: message,
			});
			return;
		}
		this.#offered = undefined;
		this.#activeTaskId = undefined;
		if (wake.attempts < MAX_WAKE_ATTEMPTS) {
			this.#pending.unshift(wake);
			const retryDelayMs = WAKE_RETRY_BASE_MS * 2 ** (wake.attempts - 1);
			await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
			return;
		}

		this.#retired.add(wake.claim.activationId);
		await this.#releaseTask(wake.claim.taskId).catch((releaseError) => {
			this.#log({
				event: "a2a_task_turn_release_failed",
				taskId: wake.claim.taskId,
				error: errorMessage(releaseError),
			});
		});
		await this.#recordUnhealthy(wake.claim, message).catch((evidenceError) => {
			this.#log({
				event: "a2a_task_turn_evidence_failed",
				taskId: wake.claim.taskId,
				error: errorMessage(evidenceError),
			});
		});
		this.#log({
			event: "a2a_task_turn_paused",
			taskId: wake.claim.taskId,
			attempts: wake.attempts,
			error: message,
		});
		// The wake is fully out of the queue now. Keep this tombstone only while
		// failure handling can still unwind into #restore; otherwise every failed
		// activation would remain resident until shutdown.
		this.#retired.delete(wake.claim.activationId);
	}

	#restore(wake: PendingWake): void {
		if (
			this.#stopped ||
			this.#journal.isWakeFailed(wake.claim.activationId) ||
			this.#retired.has(wake.claim.activationId) ||
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
			await this.#tasks.updateStatus(stored.principal, stored.task.id, {
				state: "TASK_STATE_WORKING",
			});
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
		if (!this.#taskTurns) await this.#markDelivered(wake.claim);
		return true;
	}

	async #markDelivered(claim: ActivationClaim): Promise<void> {
		const delivery = this.#journal.wakeDeliveries(claim.activationId) + 1;
		await this.#journal.append({
			kind: "WAKE_DELIVERED",
			activationId: claim.activationId,
			delivery,
			deliveredAt: new Date().toISOString(),
		});
	}

	async #failDeliveryCap(claim: ActivationClaim, deliveries: number): Promise<void> {
		const error = `wake delivery cap ${MAX_WAKE_DELIVERIES} reached without Task settlement`;
		this.#retired.add(claim.activationId);
		await this.#releaseTask(claim.taskId).catch((releaseError) => {
			this.#log({
				event: "a2a_task_turn_release_failed",
				taskId: claim.taskId,
				error: errorMessage(releaseError),
			});
		});
		await this.#recordUnhealthy(claim, error).catch((evidenceError) => {
			this.#log({
				event: "a2a_task_turn_evidence_failed",
				taskId: claim.taskId,
				error: errorMessage(evidenceError),
			});
		});
		try {
			await this.#journal.append({
				kind: "WAKE_FAILED",
				activationId: claim.activationId,
				attempts: deliveries,
				error,
				failedAt: new Date().toISOString(),
			});
		} catch (journalError) {
			this.#log({
				event: "a2a_wake_failure_evidence_failed",
				taskId: claim.taskId,
				error: errorMessage(journalError),
			});
			this.#retired.delete(claim.activationId);
			throw journalError;
		}
		this.#log({
			event: "a2a_wake_abandoned",
			taskId: claim.taskId,
			activationId: claim.activationId,
			attempts: deliveries,
			error,
		});
		// Durable WAKE_FAILED state rejects future admission, so the in-memory
		// tombstone is redundant once this pump has finished handling the wake.
		this.#retired.delete(claim.activationId);
	}

	/** Retire a wake whose Task is gone or terminal, then look for the next one. */
	async #consumeSettled(claim: ActivationClaim): Promise<void> {
		this.#canceledTaskIds.delete(claim.taskId);
		await this.#releaseTask(claim.taskId);
		await this.#markConsumed(claim);
		this.#schedulePump();
	}

	async #releaseTask(taskId: string): Promise<void> {
		if (!this.#retainedTaskIds.has(taskId)) return;
		let release = this.#taskReleases.get(taskId);
		if (!release) {
			release = (async () => {
				await this.#taskTurns?.release(taskId);
				this.#retainedTaskIds.delete(taskId);
			})();
			this.#taskReleases.set(taskId, release);
		}
		try {
			await release;
		} finally {
			if (this.#taskReleases.get(taskId) === release) this.#taskReleases.delete(taskId);
		}
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
