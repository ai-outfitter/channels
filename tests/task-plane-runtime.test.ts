import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { A2aTaskStore } from "../extensions/a2a/store.ts";
import type { A2aTaskState } from "../extensions/a2a/types.ts";
import { ActivationJournal } from "../extensions/task-plane/journal.ts";
import { OriginStore } from "../extensions/task-plane/origins.ts";
import { createTaskPlane, type TaskPlane } from "../extensions/task-plane/plane.ts";
import { startChannelsRuntime } from "../extensions/task-plane/runtime.ts";
import { derivedId } from "../extensions/task-plane/serialize.ts";
import {
	ActivationEvidenceStore,
	ContextStore,
	OutboundDeliveryStore,
	ReplyAnchorStore,
} from "../extensions/task-plane/stores.ts";
import type { NativeActivation, SourceTaskActivationSink } from "../extensions/task-plane/types.ts";
import { DurableWakeQueue, taskWakePrompt } from "../extensions/task-plane/wake-queue.ts";

const digest = (value: string): string =>
	`sha256:${createHash("sha256").update(value).digest("hex")}`;

function activation(key: string, overrides: Partial<NativeActivation> = {}): NativeActivation {
	return {
		principal: "source:user",
		source: "test",
		providerEventId: `event-${key}`,
		nativeLocator: { itemId: key },
		receivedAt: "2026-08-14T12:00:00.000Z",
		providerDedupeKey: key,
		conversationKey: "conversation-1",
		parts: [{ text: `payload ${key}` }],
		contentDigest: digest(`payload ${key}`),
		...overrides,
	};
}

async function fixture(
	root: string,
	crashAfterStep?: (step: number) => void,
): Promise<{ plane: TaskPlane; tasks: A2aTaskStore; journal: ActivationJournal }> {
	const tasks = new A2aTaskStore(join(root, "tasks.json"));
	const origins = new OriginStore(join(root, "origins.v1.json"));
	const evidence = new ActivationEvidenceStore(join(root, "evidence.v1.json"));
	const contexts = new ContextStore(join(root, "contexts.v1.json"));
	const anchors = new ReplyAnchorStore(join(root, "anchors.v1.json"), tasks);
	const journal = new ActivationJournal(join(root, "activation.v1.jsonl"));
	await Promise.all([
		tasks.initialize(),
		origins.initialize(),
		evidence.initialize(),
		contexts.initialize(),
		anchors.initialize(),
		journal.initialize(),
	]);
	return {
		tasks,
		journal,
		plane: createTaskPlane({
			tasks,
			origins,
			evidence,
			contexts,
			replyAnchors: anchors,
			journal,
			agentInterface: "https://agent.example.test",
			...(crashAfterStep ? { crashAfterStep } : {}),
		}),
	};
}

describe("durable native activation acceptance", () => {
	it("preserves raw locator values without widening principal identifiers", async () => {
		const root = await mkdtemp(join(tmpdir(), "channels-locator-values-"));
		const { plane } = await fixture(root);
		await plane.accept(
			activation("raw-locator", {
				nativeLocator: {
					accountId: "person@example.test",
					url: "https://provider.example/items/one?revision=2",
				},
			}),
		);
		await assert.rejects(
			plane.accept(activation("bad-principal", { principal: "person@example.test" })),
			/principal/,
		);
	});

	for (let crashStep = 1; crashStep <= 10; crashStep += 1) {
		it(`recovers an acceptance interrupted after step ${crashStep}`, async () => {
			const root = await mkdtemp(join(tmpdir(), "channels-crash-"));
			let armed = true;
			const first = await fixture(root, (step) => {
				if (armed && step === crashStep) {
					armed = false;
					throw new Error(`crash after ${step}`);
				}
			});
			await assert.rejects(first.plane.accept(activation("same")), /crash after/);

			const restarted = await fixture(root);
			await restarted.plane.replayIncomplete();
			const accepted = await restarted.plane.accept(activation("same"));
			const stored = await restarted.tasks.getTask("source:user", accepted.taskId);
			assert.equal(stored.contextId, accepted.contextId);
			assert.equal(stored.history?.length, 1);
			assert.equal(restarted.journal.claims().length, 1);
			assert.ok(restarted.journal.isAccepted(accepted.activationId));
		});
	}

	it("quarantines a torn final record and replays the complete claim before it", async () => {
		const root = await mkdtemp(join(tmpdir(), "channels-torn-"));
		let crashed = false;
		const first = await fixture(root, (step) => {
			if (!crashed && step === 4) {
				crashed = true;
				throw new Error("crash after claim flush");
			}
		});
		await assert.rejects(first.plane.accept(activation("torn")));
		const journalPath = join(root, "activation.v1.jsonl");
		await appendFile(journalPath, '{"record":{"kind":"ACCEP');

		const restarted = await fixture(root);
		await restarted.plane.replayIncomplete();
		const accepted = await restarted.plane.accept(activation("torn"));
		assert.equal(
			(await restarted.tasks.getTask("source:user", accepted.taskId)).history?.length,
			1,
		);
		assert.match(await readFile(`${journalPath}.quarantine`, "utf8"), /ACCEP/);
	});

	it("returns original IDs for a duplicate without creating another task", async () => {
		const root = await mkdtemp(join(tmpdir(), "channels-dedupe-"));
		const { plane, tasks } = await fixture(root);
		const first = await plane.accept(activation("dedupe"));
		const duplicate = await plane.accept(activation("dedupe"));
		assert.deepEqual(duplicate, { ...first, disposition: "duplicate" });
		assert.equal((await tasks.listTasks("source:user", { pageSize: 100 })).length, 1);
		await assert.rejects(
			plane.accept(activation("dedupe", { parts: [{ text: "changed" }] })),
			/DUPLICATE_MESSAGE_ID|different activation/,
		);
	});

	it("atomically upserts one context for concurrent first messages", async () => {
		const root = await mkdtemp(join(tmpdir(), "channels-context-"));
		const { plane } = await fixture(root);
		const [left, right] = await Promise.all([
			plane.accept(activation("left")),
			plane.accept(activation("right")),
		]);
		assert.notEqual(left.taskId, right.taskId);
		assert.equal(left.contextId, right.contextId);
	});
});

it("rolls back a failed journal append before retrying the same claim", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-journal-rollback-"));
	const path = join(root, "activation.v1.jsonl");
	const journal = new ActivationJournal(path);
	await journal.initialize();
	const claim = {
		kind: "CLAIM" as const,
		providerKey: "source:user\0test\0rollback",
		activationId: "activation-rollback",
		taskId: randomUUID(),
		input: activation("rollback"),
		contextId: randomUUID(),
		intendedRoute: "created" as const,
		claimedAt: new Date().toISOString(),
	};
	await assert.rejects(
		journal.append(claim, () => {
			throw new Error("simulated partial append");
		}),
		/simulated partial append/,
	);
	assert.equal((await stat(path)).size, 0);
	assert.equal(journal.claimByProviderKey(claim.providerKey), undefined);
	await journal.append(claim);
	const restarted = new ActivationJournal(path);
	await restarted.initialize();
	assert.equal(restarted.claims().length, 1);
	assert.equal(restarted.claimByProviderKey(claim.providerKey)?.activationId, claim.activationId);
});

// B4's directory fsync is verified by inspection. Node's fs API does not expose
// a portable behavioral observation for a directory entry reaching stable storage.

it("preserves byte offsets across interior empty journal lines", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-journal-empty-line-"));
	const path = join(root, "activation.v1.jsonl");
	const first = {
		kind: "CLAIM" as const,
		providerKey: "source:user\0test\0empty-first",
		activationId: "activation-empty-first",
		taskId: randomUUID(),
		input: activation("empty-first"),
		contextId: randomUUID(),
		intendedRoute: "created" as const,
		claimedAt: new Date().toISOString(),
	};
	const accepted = {
		kind: "ACCEPTED" as const,
		activationId: first.activationId,
		acceptedAt: new Date().toISOString(),
	};
	const line = (record: object): string =>
		JSON.stringify({
			record,
			checksum: createHash("sha256").update(JSON.stringify(record)).digest("hex"),
		});
	await writeFile(path, `${line(first)}\n\n${line(accepted)}\n{"record":`);

	const recovered = new ActivationJournal(path);
	await recovered.initialize();
	assert.ok(recovered.isAccepted(first.activationId));
	await recovered.append({
		kind: "WOKEN",
		activationId: first.activationId,
		wokenAt: new Date().toISOString(),
	});
	const restarted = new ActivationJournal(path);
	await restarted.initialize();
	assert.ok(restarted.isWoken(first.activationId));
});

it("persists idempotent in-memory projections again after a failed write", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-idempotent-persist-"));
	const tasksPath = join(root, "tasks.json");
	const tasks = new A2aTaskStore(tasksPath);
	await tasks.initialize();
	const principal = "source:user";
	const taskId = randomUUID();
	const contextId = randomUUID();

	await chmod(root, 0o500);
	await assert.rejects(tasks.createTaskWithId(principal, taskId, contextId));
	await chmod(root, 0o700);
	await tasks.createTaskWithId(principal, taskId, contextId);
	assert.equal((await new A2aTaskStore(tasksPath).getTask(principal, taskId)).id, taskId);

	const message = {
		messageId: "message-idempotent",
		taskId,
		contextId,
		role: "ROLE_USER" as const,
		parts: [{ text: "persist me" }],
	};
	await chmod(root, 0o500);
	await assert.rejects(tasks.appendHistoryIdempotent(principal, taskId, message));
	await chmod(root, 0o700);
	await tasks.appendHistoryIdempotent(principal, taskId, message);
	assert.equal((await new A2aTaskStore(tasksPath).getTask(principal, taskId)).history?.length, 1);

	const evidencePath = join(root, "evidence.json");
	const evidence = new ActivationEvidenceStore(evidencePath);
	await evidence.initialize();
	await chmod(root, 0o500);
	await assert.rejects(evidence.append("activation-idempotent", taskId, activation("evidence")));
	await chmod(root, 0o700);
	await evidence.append("activation-idempotent", taskId, activation("evidence"));
	assert.equal(JSON.parse(await readFile(evidencePath, "utf8")).records.length, 1);

	const anchorsPath = join(root, "anchors.json");
	const anchors = new ReplyAnchorStore(anchorsPath, tasks);
	await anchors.initialize();
	await chmod(root, 0o500);
	await assert.rejects(anchors.record(principal, "test", "response-idempotent", taskId));
	await chmod(root, 0o700);
	await anchors.record(principal, "test", "response-idempotent", taskId);
	assert.equal(
		await new ReplyAnchorStore(anchorsPath, tasks).resolve(
			principal,
			"test",
			"response-idempotent",
		),
		taskId,
	);
});

it("retains a context while any retained terminal Task still references it", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-terminal-context-"));
	const taskId = randomUUID();
	const contextId = randomUUID();
	const old = "2020-01-01T00:00:00.000Z";
	await writeFile(
		join(root, "tasks.json"),
		`${JSON.stringify({
			version: 1,
			tasks: {
				[taskId]: {
					task: {
						id: taskId,
						contextId,
						status: { state: "TASK_STATE_COMPLETED", timestamp: old },
					},
					principal: "source:user",
					updatedAt: new Date().toISOString(),
				},
			},
			dedupe: [],
		})}\n`,
	);
	await writeFile(
		join(root, "contexts.json"),
		`${JSON.stringify({
			version: 1,
			contexts: [
				{
					principal: "source:user",
					source: "test",
					conversationKey: "conversation-retained",
					contextId,
					lastActiveAt: old,
				},
			],
		})}\n`,
	);
	const tasks = new A2aTaskStore(join(root, "tasks.json"));
	const contexts = new ContextStore(join(root, "contexts.json"));
	await contexts.initialize();
	await contexts.prune(Date.now(), await tasks.activeContextIds());
	assert.equal(await contexts.resolve("source:user", "test", "conversation-retained"), contextId);
});

describe("verified continuation", () => {
	async function waitingTask(
		plane: TaskPlane,
		tasks: A2aTaskStore,
		state: Extract<A2aTaskState, "TASK_STATE_INPUT_REQUIRED" | "TASK_STATE_AUTH_REQUIRED">,
		key: string,
	): Promise<string> {
		const accepted = await plane.accept(activation(`base-${key}`));
		await tasks.updateStatus("source:user", accepted.taskId, {
			state,
			message: { messageId: `question-${key}`, role: "ROLE_AGENT", parts: [{ text: "answer?" }] },
		});
		return accepted.taskId;
	}

	for (const state of ["TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED"] as const) {
		it(`continues a ${state} task only through its direct reply anchor`, async () => {
			const root = await mkdtemp(join(tmpdir(), "channels-anchor-"));
			const { plane, tasks } = await fixture(root);
			const taskId = await waitingTask(plane, tasks, state, state);
			await plane.recordReplyAnchor("source:user", "test", "response-1", taskId);
			const result = await plane.continue({
				...activation(`reply-${state}`),
				sourceSupportsReplyAnchors: true,
				directReplyToProviderResponseId: "response-1",
			});
			assert.equal(result.taskId, taskId);
			assert.equal(result.disposition, "continued");
			await tasks.updateStatus("source:user", taskId, { state: "TASK_STATE_WORKING" });
			const duplicate = await plane.continue({
				...activation(`reply-${state}`),
				sourceSupportsReplyAnchors: true,
				directReplyToProviderResponseId: "response-1",
			});
			assert.deepEqual(duplicate, { ...result, disposition: "duplicate" });
		});
	}

	it("creates new tasks whenever any verified-anchor condition is absent", async () => {
		const root = await mkdtemp(join(tmpdir(), "channels-anchor-fail-"));
		const { plane, tasks } = await fixture(root);
		const waiting = await waitingTask(plane, tasks, "TASK_STATE_INPUT_REQUIRED", "six");
		await plane.recordReplyAnchor("source:user", "test", "response-six", waiting);
		const cases = [
			{ sourceSupportsReplyAnchors: false, directReplyToProviderResponseId: "response-six" },
			{ sourceSupportsReplyAnchors: true },
			{ sourceSupportsReplyAnchors: true, directReplyToProviderResponseId: "missing" },
			{
				principal: "source:other",
				sourceSupportsReplyAnchors: true,
				directReplyToProviderResponseId: "response-six",
			},
		] as const;
		for (const [index, values] of cases.entries()) {
			const result = await plane.continue({ ...activation(`failed-${index}`), ...values });
			assert.notEqual(result.taskId, waiting);
			assert.equal(result.disposition, "created");
		}

		const notWaiting = await plane.accept(activation("not-waiting"));
		await plane.recordReplyAnchor("source:user", "test", "response-working", notWaiting.taskId);
		const wrongState = await plane.continue({
			...activation("wrong-state"),
			sourceSupportsReplyAnchors: true,
			directReplyToProviderResponseId: "response-working",
		});
		assert.notEqual(wrongState.taskId, notWaiting.taskId);

		const unanswered = await waitingTask(plane, tasks, "TASK_STATE_INPUT_REQUIRED", "unanswered");
		await tasks.updateStatus("source:user", unanswered, { state: "TASK_STATE_INPUT_REQUIRED" });
		await plane.recordReplyAnchor("source:user", "test", "response-unanswered", unanswered);
		const noQuestion = await plane.continue({
			...activation("no-question"),
			sourceSupportsReplyAnchors: true,
			directReplyToProviderResponseId: "response-unanswered",
		});
		assert.notEqual(noQuestion.taskId, unanswered);
	});

	it("rejects an unauthorized explicit taskId and beginNew never uses a conversation as a task", async () => {
		const root = await mkdtemp(join(tmpdir(), "channels-explicit-"));
		const { plane, tasks } = await fixture(root);
		const original = await plane.accept(activation("begin-context"));
		const context = original.contextId;
		const first = await plane.beginNew("source:user", context);
		const second = await plane.beginNew("source:user", context);
		assert.notEqual(first.id, second.id);
		assert.equal(first.contextId, second.contextId);
		await assert.rejects(
			plane.continue({ ...activation("foreign", { principal: "source:other" }), taskId: first.id }),
			/not found/,
		);
		assert.equal((await tasks.listTasks("source:user", { contextId: context })).length, 3);
	});

	it("rechecks waiting state inside the intake lock and refuses terminal history", async () => {
		const root = await mkdtemp(join(tmpdir(), "channels-continuation-race-"));
		let releaseBlocker = (): void => {};
		const blocker = new Promise<void>((resolve) => {
			releaseBlocker = resolve;
		});
		let block = false;
		const tasks = new A2aTaskStore(join(root, "tasks.json"));
		const origins = new OriginStore(join(root, "origins.json"));
		const evidence = new ActivationEvidenceStore(join(root, "evidence.json"));
		const contexts = new ContextStore(join(root, "contexts.json"));
		const anchors = new ReplyAnchorStore(join(root, "anchors.json"), tasks);
		const journal = new ActivationJournal(join(root, "journal.jsonl"));
		const plane = createTaskPlane({
			tasks,
			origins,
			evidence,
			contexts,
			replyAnchors: anchors,
			journal,
			agentInterface: "https://agent.example.test",
			crashAfterStep: async (step) => {
				if (block && step === 1) await blocker;
			},
		});
		const base = await plane.accept(activation("race-base"));
		await tasks.updateStatus("source:user", base.taskId, {
			state: "TASK_STATE_INPUT_REQUIRED",
			message: { messageId: "race-question", role: "ROLE_AGENT", parts: [{ text: "answer?" }] },
		});
		block = true;
		const holding = plane.accept(activation("race-blocker"));
		await new Promise((resolve) => setImmediate(resolve));
		const continuation = plane.continue({ ...activation("race-reply"), taskId: base.taskId });
		await tasks.updateStatus("source:user", base.taskId, { state: "TASK_STATE_COMPLETED" });
		releaseBlocker();
		await holding;
		await assert.rejects(continuation, /cannot accept supplied input/);
		await assert.rejects(
			tasks.appendHistoryIdempotent("source:user", base.taskId, {
				messageId: "late-message",
				taskId: base.taskId,
				contextId: base.contextId,
				role: "ROLE_USER",
				parts: [{ text: "late" }],
			}),
			/terminal state/,
		);
	});

	it("rejects a reply anchor when the principal does not own its Task", async () => {
		const root = await mkdtemp(join(tmpdir(), "channels-anchor-authority-"));
		const { plane } = await fixture(root);
		const accepted = await plane.accept(activation("anchor-owner"));
		await assert.rejects(
			plane.recordReplyAnchor("source:other", "test", "response-cross-principal", accepted.taskId),
			/not found/,
		);
	});
});

it("rejects invalid intake before journaling and quarantines poisoned replay claims", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-poisoned-claim-"));
	const { plane, journal, tasks } = await fixture(root);
	await assert.rejects(
		plane.accept(activation("invalid-intake", { principal: "user@example.com" })),
		/principal must match/,
	);
	assert.equal(journal.claims().length, 0);

	const poisoned = {
		kind: "CLAIM" as const,
		providerKey: "user@example.com\0test\0poisoned",
		activationId: "activation-poisoned",
		taskId: randomUUID(),
		input: activation("poisoned", { principal: "user@example.com" }),
		contextId: randomUUID(),
		intendedRoute: "created" as const,
		claimedAt: new Date().toISOString(),
	};
	const good = {
		kind: "CLAIM" as const,
		providerKey: "source:user\0test\0replay-good",
		activationId: "activation-replay-good",
		taskId: randomUUID(),
		input: activation("replay-good"),
		contextId: randomUUID(),
		intendedRoute: "created" as const,
		claimedAt: new Date().toISOString(),
	};
	await journal.append(poisoned);
	await journal.append(good);
	await plane.replayIncomplete();
	assert.equal(journal.isQuarantined(poisoned.activationId), true);
	assert.equal(journal.isAccepted(good.activationId), true);
	assert.equal((await tasks.getTask("source:user", good.taskId)).id, good.taskId);
	const evidence = JSON.parse(await readFile(join(root, "evidence.v1.json"), "utf8"));
	assert.ok(
		evidence.records.some(
			(record: { activationId: string; recordType: string }) =>
				record.activationId === poisoned.activationId &&
				record.recordType === "activation.unhealthy",
		),
	);
});

it("offers FIFO wakes only after ACCEPTED is durable and skips canceled queued work", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-wake-"));
	const { plane, tasks, journal } = await fixture(root);
	const prompts: string[] = [];
	const queue = new DurableWakeQueue(
		{
			async sendUserMessage(prompt: string) {
				assert.ok(journal.claims().some((claim) => journal.isAccepted(claim.activationId)));
				prompts.push(prompt);
			},
		},
		tasks,
		journal,
	);
	const one = await plane.accept(activation("wake-1"));
	const two = await plane.accept(activation("wake-2"));
	const claims = journal.claims();
	queue.enqueue(claims[0] as (typeof claims)[number]);
	queue.enqueue(claims[1] as (typeof claims)[number]);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(prompts.length, 1);
	await queue.beforeAgentStart(prompts[0] as string);
	assert.equal(await queue.hasAuthority(one.taskId), true);
	await tasks.updateStatus("source:user", two.taskId, { state: "TASK_STATE_CANCELED" });
	queue.agentEnd();
	for (
		let attempt = 0;
		attempt < 20 && !journal.isWoken(claims[1]?.activationId ?? "");
		attempt += 1
	) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.equal(prompts.length, 1);
	assert.equal(await queue.hasAuthority(two.taskId), false);
	assert.ok(journal.isWoken(claims[1]?.activationId ?? ""));
});

it("re-offers an unclaimed wake after an unrelated agent turn ends", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-wake-mismatch-"));
	const { plane, tasks, journal } = await fixture(root);
	const accepted = await plane.accept(activation("wake-mismatch"));
	const prompts: string[] = [];
	const queue = new DurableWakeQueue(
		{ sendUserMessage: async (prompt: string) => prompts.push(prompt) },
		tasks,
		journal,
	);
	queue.enqueue(journal.claims()[0] as ReturnType<ActivationJournal["claims"]>[number]);
	await new Promise((resolve) => setImmediate(resolve));
	await queue.beforeAgentStart("an unrelated prompt");
	queue.agentEnd();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(prompts.length, 2);
	assert.equal(prompts[0], prompts[1]);
	await queue.beforeAgentStart(prompts[1] as string);
	assert.equal(await queue.hasAuthority(accepted.taskId), true);
});

it("re-offers a wake when starting its agent turn fails", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-wake-start-failure-"));
	const { plane, tasks, journal } = await fixture(root);
	const accepted = await plane.accept(activation("wake-start-failure"));
	const prompts: string[] = [];
	const queue = new DurableWakeQueue(
		{ sendUserMessage: async (prompt: string) => prompts.push(prompt) },
		tasks,
		journal,
	);
	const updateStatus = tasks.updateStatus.bind(tasks);
	let failOnce = true;
	tasks.updateStatus = async (principal, taskId, status) => {
		if (failOnce) {
			failOnce = false;
			throw new Error("simulated tasks write failure");
		}
		return updateStatus(principal, taskId, status);
	};
	queue.enqueue(journal.claims()[0] as ReturnType<ActivationJournal["claims"]>[number]);
	await new Promise((resolve) => setImmediate(resolve));
	await assert.rejects(queue.beforeAgentStart(prompts[0] as string), /could not start/);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(prompts.length, 2);
	await queue.beforeAgentStart(prompts[1] as string);
	assert.equal(await queue.hasAuthority(accepted.taskId), true);
});

it("re-offers a wake when recording its consumption fails", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-wake-consume-failure-"));
	const { plane, tasks, journal } = await fixture(root);
	const accepted = await plane.accept(activation("wake-consume-failure"));
	const prompts: string[] = [];
	const queue = new DurableWakeQueue(
		{ sendUserMessage: async (prompt: string) => prompts.push(prompt) },
		tasks,
		journal,
	);
	const append = journal.append.bind(journal);
	let failOnce = true;
	journal.append = async (record, afterAppend) => {
		if (failOnce && record.kind === "WOKEN") {
			failOnce = false;
			throw new Error("simulated journal failure");
		}
		return append(record, afterAppend);
	};
	queue.enqueue(journal.claims()[0] as ReturnType<ActivationJournal["claims"]>[number]);
	await new Promise((resolve) => setImmediate(resolve));
	await assert.rejects(queue.beforeAgentStart(prompts[0] as string), /simulated journal failure/);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(prompts.length, 2);
	assert.equal(await queue.hasAuthority(accepted.taskId), false);
	await queue.beforeAgentStart(prompts[1] as string);
	assert.equal(await queue.hasAuthority(accepted.taskId), true);
});

it("re-offers exactly once after a crash following WOKEN for a non-terminal Task", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-wake-crash-"));
	const { plane, tasks, journal } = await fixture(root);
	const accepted = await plane.accept(activation("wake-crash"));
	const firstPrompts: string[] = [];
	const firstQueue = new DurableWakeQueue(
		{ sendUserMessage: async (prompt: string) => firstPrompts.push(prompt) },
		tasks,
		journal,
	);
	firstQueue.enqueue(journal.claims()[0] as ReturnType<ActivationJournal["claims"]>[number]);
	await new Promise((resolve) => setImmediate(resolve));
	await firstQueue.beforeAgentStart(firstPrompts[0] as string);
	assert.equal(journal.isWoken(journal.claims()[0]?.activationId ?? ""), true);
	assert.equal(await firstQueue.hasAuthority(accepted.taskId), true);
	firstQueue.stop();

	const recoveredPrompts: string[] = [];
	const recoveredQueue = new DurableWakeQueue(
		{ sendUserMessage: async (prompt: string) => recoveredPrompts.push(prompt) },
		tasks,
		journal,
	);
	await recoveredQueue.replay();
	await recoveredQueue.replay();
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(recoveredPrompts, [taskWakePrompt(accepted.taskId)]);
	recoveredQueue.stop();
});

it("bounds rejecting wake delivery with timer backoff and durable failure evidence", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-wake-reject-"));
	const { plane, tasks, journal } = await fixture(root);
	await plane.accept(activation("wake-reject"));
	let attempts = 0;
	const logs: Readonly<Record<string, unknown>>[] = [];
	const queue = new DurableWakeQueue(
		{
			async sendUserMessage() {
				attempts += 1;
				throw new Error("persistently unavailable");
			},
		},
		tasks,
		journal,
		(record) => logs.push(record),
	);
	let timerFired = false;
	setTimeout(() => {
		timerFired = true;
	}, 5);
	queue.enqueue(journal.claims()[0] as ReturnType<ActivationJournal["claims"]>[number]);
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(timerFired, true);
	assert.equal(attempts, 3);
	assert.equal(journal.isWakeFailed(journal.claims()[0]?.activationId ?? ""), true);
	assert.equal(
		logs.some((record) => record.event === "a2a_wake_abandoned"),
		true,
	);
	queue.agentEnd();
	await new Promise((resolve) => setTimeout(resolve, 25));
	assert.equal(attempts, 3);
	queue.stop();
});

it("contains pump I/O failures and retains the wake for a later trigger", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-wake-pump-failure-"));
	const { plane, tasks, journal } = await fixture(root);
	await plane.accept(activation("wake-pump-failure"));
	const prompts: string[] = [];
	const logs: Readonly<Record<string, unknown>>[] = [];
	const queue = new DurableWakeQueue(
		{ sendUserMessage: async (prompt: string) => prompts.push(prompt) },
		tasks,
		journal,
		(record) => logs.push(record),
	);
	const lookup = tasks.lookup.bind(tasks);
	let failOnce = true;
	tasks.lookup = async (taskId) => {
		if (failOnce) {
			failOnce = false;
			throw new Error("simulated lookup failure");
		}
		return lookup(taskId);
	};
	queue.enqueue(journal.claims()[0] as ReturnType<ActivationJournal["claims"]>[number]);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(prompts.length, 0);
	assert.equal(
		logs.some((record) => record.event === "a2a_wake_pump_failed"),
		true,
	);
	queue.agentEnd();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(prompts.length, 1);
});

it("runtime startup is all-or-nothing and store upgrade preserves Tasks and origins", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-upgrade-"));
	const storePath = join(root, "tasks.v1.json");
	const taskId = randomUUID();
	const contextId = randomUUID();
	const deployedTask = {
		version: 1,
		tasks: {
			[taskId]: {
				task: {
					id: taskId,
					contextId,
					status: { state: "TASK_STATE_COMPLETED", timestamp: "2026-08-01T00:00:00.000Z" },
					artifacts: [],
					history: [],
				},
				principal: "source:user",
				updatedAt: "2026-08-01T00:00:00.000Z",
			},
		},
		dedupe: [],
	};
	const deployedOrigins = {
		version: 1,
		activations: { old: { id: "old", sourcePrincipal: "source:user" } },
		decisions: {},
		origins: { old: { id: "old", activationId: "old" } },
		deliveries: {},
	};
	await writeFile(storePath, `${JSON.stringify(deployedTask)}\n`);
	await writeFile(join(root, "origins.json"), `${JSON.stringify(deployedOrigins)}\n`);
	let stopped = 0;
	await assert.rejects(
		startChannelsRuntime(
			{ sendUserMessage() {} },
			{
				storePath,
				agentInterface: "https://agent.example.test",
				sources: [
					{
						name: "first",
						async start() {
							return async () => {
								stopped += 1;
							};
						},
					},
					{
						name: "broken",
						async start() {
							throw new Error("cannot start");
						},
					},
				],
			},
		),
		/cannot start/,
	);
	assert.equal(stopped, 1);
	const afterTasks = JSON.parse(await readFile(storePath, "utf8"));
	const afterOrigins = JSON.parse(await readFile(join(root, "origins.json"), "utf8"));
	assert.deepEqual(afterTasks.tasks[taskId], deployedTask.tasks[taskId]);
	assert.deepEqual(afterOrigins.origins.old, deployedOrigins.origins.old);

	const newFiles: ReadonlyArray<readonly [string, string]> = [
		["activation-evidence.v1.json", JSON.stringify({ version: 1, records: [] })],
		["contexts.v1.json", JSON.stringify({ version: 1, contexts: [] })],
		["source-checkpoints.v1.json", JSON.stringify({ version: 1, checkpoints: {} })],
		["reply-anchors.v1.json", JSON.stringify({ version: 1, anchors: [] })],
		["outbound-deliveries.v1.json", JSON.stringify({ version: 1, deliveries: {} })],
		["activation-journal.v1.jsonl", ""],
	];
	for (let initialized = 0; initialized <= newFiles.length; initialized += 1) {
		const crashRoot = await mkdtemp(join(tmpdir(), "channels-init-crash-"));
		const crashTasks = join(crashRoot, "tasks.json");
		await writeFile(crashTasks, `${JSON.stringify(deployedTask)}\n`);
		await writeFile(join(crashRoot, "origins.json"), `${JSON.stringify(deployedOrigins)}\n`);
		for (const [name, contents] of newFiles.slice(0, initialized)) {
			await writeFile(join(crashRoot, name), `${contents}${contents ? "\n" : ""}`);
		}
		const restarted = await startChannelsRuntime(
			{ sendUserMessage() {} },
			{
				storePath: crashTasks,
				agentInterface: "https://agent.example.test",
				sources: [],
			},
		);
		await restarted.close();
		const preservedTasks = JSON.parse(await readFile(crashTasks, "utf8"));
		const preservedOrigins = JSON.parse(await readFile(join(crashRoot, "origins.json"), "utf8"));
		assert.deepEqual(preservedTasks.tasks[taskId], deployedTask.tasks[taskId]);
		assert.deepEqual(preservedOrigins.origins.old, deployedOrigins.origins.old);
	}
});

it("does not replay durable wakes until every runtime source has started", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-runtime-ready-"));
	const storePath = join(root, "tasks.json");
	const firstPrompts: string[] = [];
	const first = await startChannelsRuntime(
		{ sendUserMessage: async (prompt: string) => firstPrompts.push(prompt) },
		{ storePath, agentInterface: "https://agent.example.test", sources: [] },
	);
	await first.sink.accept(activation("runtime-replay"));
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(firstPrompts.length, 1);
	await first.close();

	let releaseSource = (): void => {};
	const sourceStarted = new Promise<void>((resolve) => {
		releaseSource = resolve;
	});
	const replayedPrompts: string[] = [];
	const startup = startChannelsRuntime(
		{ sendUserMessage: async (prompt: string) => replayedPrompts.push(prompt) },
		{
			storePath,
			agentInterface: "https://agent.example.test",
			sources: [
				{
					name: "slow",
					async start() {
						await sourceStarted;
						return async () => {};
					},
				},
			],
		},
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(replayedPrompts.length, 0);
	releaseSource();
	const restarted = await startup;
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(replayedPrompts.length, 1);
	await restarted.close();
});

it("closes source intake before rolling back a late startup failure", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-runtime-late-failure-"));
	const replay = DurableWakeQueue.prototype.replay;
	let intakeClosedDuringStop = false;
	DurableWakeQueue.prototype.replay = async () => {
		throw new Error("simulated replay failure");
	};
	try {
		await assert.rejects(
			startChannelsRuntime(
				{ sendUserMessage() {} },
				{
					storePath: join(root, "tasks.json"),
					agentInterface: "https://agent.example.test",
					sources: [
						{
							name: "in-flight",
							async start(sink) {
								return async () => {
									intakeClosedDuringStop = await sink.accept(activation("late-startup-stop")).then(
										() => false,
										(error: unknown) => /intake is not ready/.test(String(error)),
									);
								};
							},
						},
					],
				},
			),
			/simulated replay failure/,
		);
		assert.equal(intakeClosedDuringStop, true);
	} finally {
		DurableWakeQueue.prototype.replay = replay;
	}
});

it("stops every runtime source despite rejection and keeps intake open until sources stop", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-runtime-close-"));
	let sinkDuringStop: SourceTaskActivationSink | undefined;
	const stopped: string[] = [];
	const running = await startChannelsRuntime(
		{ sendUserMessage() {} },
		{
			storePath: join(root, "tasks.json"),
			agentInterface: "https://agent.example.test",
			sources: [
				{
					name: "first",
					async start(sink) {
						sinkDuringStop = sink;
						return async () => {
							stopped.push("first");
							await sink.accept(activation("during-stop"));
							throw new Error("stop failed");
						};
					},
				},
				{
					name: "second",
					async start() {
						return async () => {
							stopped.push("second");
						};
					},
				},
			],
		},
	);
	assert.ok(sinkDuringStop);
	await running.close();
	assert.deepEqual(stopped, ["second", "first"]);
});

it("gives native sources a sink that rejects explicit taskId continuations", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-native-sink-"));
	let nativeSink: SourceTaskActivationSink | undefined;
	const running = await startChannelsRuntime(
		{ sendUserMessage() {} },
		{
			storePath: join(root, "tasks.json"),
			agentInterface: "https://agent.example.test",
			sources: [
				{
					name: "native",
					async start(sink) {
						nativeSink = sink;
						return async () => {};
					},
				},
			],
		},
	);
	assert.ok(nativeSink);
	await assert.rejects(
		nativeSink.continue({ ...activation("native-explicit"), taskId: randomUUID() } as never),
		/native source continuation cannot select/,
	);
	await running.close();
});

it("resolves real journal locators only while the active turn owns their Task", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-real-locator-"));
	const prompts: string[] = [];
	const runtime = await startChannelsRuntime(
		{ sendUserMessage: async (prompt: string) => prompts.push(prompt) },
		{
			storePath: join(root, "tasks.json"),
			agentInterface: "https://agent.example.test",
			sources: [],
		},
	);
	assert.ok(runtime.sourceSink.taskForLocator);
	const locator = "chatto:v1:real-journal-claim";
	const accepted = await runtime.sourceSink.accept(
		activation("real-locator", {
			source: "chatto",
			nativeLocator: { channelLocator: locator },
		}),
	);
	await new Promise((resolve) => setImmediate(resolve));
	await assert.rejects(runtime.sourceSink.taskForLocator("chatto", locator), /not authorized/);
	assert.equal(prompts.length, 1);
	await runtime.wakeQueue.beforeAgentStart(prompts[0] as string);
	assert.equal(await runtime.sourceSink.taskForLocator("chatto", locator), accepted.taskId);
	await assert.rejects(
		runtime.sourceSink.taskForLocator("chatto", "chatto:v1:foreign"),
		/not authorized/,
	);
	runtime.wakeQueue.agentEnd();
	await assert.rejects(runtime.sourceSink.taskForLocator("chatto", locator), /not authorized/);
	await runtime.close();
});

it("persists source evidence that is not attached to a Task", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-source-evidence-"));
	const runtime = await startChannelsRuntime(
		{ sendUserMessage() {} },
		{
			storePath: join(root, "tasks.json"),
			agentInterface: "https://agent.example.test",
			sources: [],
		},
	);
	assert.ok(runtime.sourceSink.recordEvidence);
	await runtime.sourceSink.recordEvidence({
		evidenceId: "evidence-permanent-envelope",
		source: "slack",
		kind: "malformed-envelope",
		detail: { reason: "missing event_id" },
	});
	const stored = JSON.parse(await readFile(join(root, "activation-evidence.v1.json"), "utf8")) as {
		records: Array<Record<string, unknown>>;
	};
	assert.deepEqual(stored.records, [
		{
			evidenceId: "evidence-permanent-envelope",
			source: "slack",
			kind: "malformed-envelope",
			detail: { reason: "missing event_id" },
			recordType: "source.evidence",
			recordedAt: stored.records[0]?.recordedAt,
		},
	]);
	await runtime.close();
});

it("reconciles outbound delivery crashes before retry and fails closed after an ambiguous send", async () => {
	for (const recovery of ["idempotent", "ambiguous"] as const) {
		const root = await mkdtemp(join(tmpdir(), `channels-delivery-${recovery}-`));
		const input = {
			taskId: "task-delivery",
			source: "github",
			operationId: "mark-read:notification-1",
			payloadDigest: digest("read"),
			recovery,
		};
		const deliveryId = derivedId(
			"delivery",
			`${input.taskId}\0${input.source}\0${input.operationId}\0${input.payloadDigest}`,
		);
		const store = new OutboundDeliveryStore(join(root, "outbound-deliveries.v1.json"));
		await store.put({
			...input,
			deliveryId,
			state: "sending",
			updatedAt: new Date().toISOString(),
		});
		const runtime = await startChannelsRuntime(
			{ sendUserMessage() {} },
			{
				storePath: join(root, "tasks.json"),
				agentInterface: "https://agent.example.test",
				sources: [],
			},
		);
		let sends = 0;
		if (recovery === "idempotent") {
			assert.equal(
				await runtime.sourceSink.deliver?.(input, async () => {
					sends += 1;
					return "notification-1";
				}),
				"notification-1",
			);
			assert.equal(
				(await new OutboundDeliveryStore(store.path).get(deliveryId))?.state,
				"delivered",
			);
			assert.equal(sends, 1, "an idempotent mutation is safe to retry after crash-before");
		} else {
			assert.ok(runtime.sourceSink.deliver);
			await assert.rejects(
				runtime.sourceSink.deliver(input, async () => {
					sends += 1;
					return "unexpected";
				}),
				/became ambiguous/,
			);
			assert.equal(
				(await new OutboundDeliveryStore(store.path).get(deliveryId))?.state,
				"ambiguous",
			);
			assert.equal(sends, 0, "crash-after with no recovery method is never retried");
		}
		await runtime.close();
	}
});

it("distinguishes determinate rejection from ambiguous delivery and permits revised text", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-delivery-states-"));
	const runtime = await startChannelsRuntime(
		{ sendUserMessage() {} },
		{
			storePath: join(root, "tasks.json"),
			agentInterface: "https://agent.example.test",
			sources: [],
		},
	);
	assert.ok(runtime.sourceSink.deliver);
	const base = {
		taskId: "task-delivery",
		source: "chatto",
		operationId: "reply:locator",
		recovery: "idempotent" as const,
	};
	const first = { ...base, payloadDigest: digest("first") };
	const firstId = derivedId(
		"delivery",
		`${first.taskId}\0${first.source}\0${first.operationId}\0${first.payloadDigest}`,
	);
	const deliveryStore = new OutboundDeliveryStore(join(root, "outbound-deliveries.v1.json"));
	await deliveryStore.put({
		...first,
		deliveryId: firstId,
		state: "failed",
		updatedAt: new Date().toISOString(),
		error: "rejected",
	});
	let sends = 0;
	assert.equal(
		await runtime.sourceSink.deliver(first, async () => `response-${++sends}`),
		"response-1",
	);
	assert.equal(
		await runtime.sourceSink.deliver(first, async () => `response-${++sends}`),
		"response-1",
	);
	const revised = { ...base, payloadDigest: digest("revised") };
	assert.equal(
		await runtime.sourceSink.deliver(revised, async () => `response-${++sends}`),
		"response-2",
	);
	assert.equal(sends, 2, "true duplicates short-circuit while revised text gets a new operation");

	const rejected = {
		...base,
		operationId: "reply:rejected",
		payloadDigest: digest("provider-rejected"),
		recovery: "ambiguous" as const,
	};
	await assert.rejects(
		runtime.sourceSink.deliver(rejected, async () => {
			throw Object.assign(new Error("invalid request"), { status: 400 });
		}),
		/invalid request/,
	);
	const rejectedId = derivedId(
		"delivery",
		`${rejected.taskId}\0${rejected.source}\0${rejected.operationId}\0${rejected.payloadDigest}`,
	);
	assert.equal(
		(await new OutboundDeliveryStore(deliveryStore.path).get(rejectedId))?.state,
		"failed",
	);
	assert.equal(
		await runtime.sourceSink.deliver(rejected, async () => "accepted-after-rejection"),
		"accepted-after-rejection",
	);

	const ambiguous = {
		...base,
		operationId: "reply:ambiguous",
		payloadDigest: digest("timeout"),
		recovery: "ambiguous" as const,
	};
	await assert.rejects(
		runtime.sourceSink.deliver(ambiguous, async () => {
			throw new Error("client timeout");
		}),
		/client timeout/,
	);
	let retries = 0;
	await assert.rejects(
		runtime.sourceSink.deliver(ambiguous, async () => {
			retries += 1;
			return "duplicate";
		}),
		/ambiguous/,
	);
	assert.equal(retries, 0);
	const ambiguousId = derivedId(
		"delivery",
		`${ambiguous.taskId}\0${ambiguous.source}\0${ambiguous.operationId}\0${ambiguous.payloadDigest}`,
	);
	assert.equal(
		(await new OutboundDeliveryStore(deliveryStore.path).get(ambiguousId))?.state,
		"ambiguous",
	);
	const reworded = { ...ambiguous, payloadDigest: digest("reworded after timeout") };
	assert.equal(
		await runtime.sourceSink.deliver(reworded, async () => "response-reworded"),
		"response-reworded",
		"production ambiguous recovery permits a distinct operation for revised text",
	);
	await runtime.close();
});

it("keeps sources running when the optional A2A listener cannot start", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-listener-isolation-"));
	let sourceStopped = 0;
	const logs: Array<Readonly<Record<string, unknown>>> = [];
	const runtime = await startChannelsRuntime(
		{ sendUserMessage() {} },
		{
			storePath: join(root, "tasks.json"),
			agentInterface: "https://agent.example.test",
			sources: [
				{
					name: "native",
					async start() {
						return async () => {
							sourceStopped += 1;
						};
					},
				},
			],
			listener: {
				async start() {
					throw new Error("address in use");
				},
			},
			log: (record) => logs.push(record),
		},
	);
	assert.equal(runtime.healthy, false);
	assert.equal(sourceStopped, 0);
	await runtime.sink.accept(activation("after-listener-failure"));
	assert.ok(logs.some((record) => record.event === "listener_start_failed"));
	await runtime.close();
	assert.equal(sourceStopped, 1);
});

it("claims A2A inbound work before the queue wakes and grants Task authority", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-a2a-claim-"));
	const prompts: string[] = [];
	const runtime = await startChannelsRuntime(
		{ sendUserMessage: async (prompt: string) => prompts.push(prompt) },
		{
			storePath: join(root, "tasks.json"),
			agentInterface: "https://agent.example.test",
			sources: [],
		},
	);
	try {
		const principal = "a2a:caller";
		const task = await runtime.taskPlane.taskStore.createTask(principal, undefined);
		const message = {
			messageId: "message-a2a",
			taskId: task.id,
			contextId: task.contextId,
			role: "ROLE_USER" as const,
			parts: [{ text: "untrusted inbound work" }],
		};
		await runtime.taskPlane.taskStore.appendHistory(principal, task.id, message);
		const accepted = await runtime.sink.claim(
			{
				principal,
				source: "a2a",
				providerEventId: message.messageId,
				nativeLocator: { messageId: message.messageId },
				receivedAt: "2026-08-15T12:00:00.000Z",
				providerDedupeKey: message.messageId,
				conversationKey: task.contextId,
				parts: message.parts,
				contentDigest: digest(message.parts[0]?.text ?? ""),
			},
			task.id,
		);
		for (let attempt = 0; prompts.length === 0 && attempt < 100; attempt += 1) {
			await new Promise((resolve) => setImmediate(resolve));
		}
		assert.equal(accepted.taskId, task.id);
		assert.deepEqual(prompts, [taskWakePrompt(task.id)]);
		const journal = await readFile(join(root, "activation-journal.v1.jsonl"), "utf8");
		assert.match(journal, /"kind":"CLAIM"/);
		assert.match(journal, /"source":"a2a"/);
		assert.equal(await runtime.wakeQueue.hasAuthority(task.id), false);
		await runtime.wakeQueue.beforeAgentStart(prompts[0] ?? "");
		assert.equal(await runtime.wakeQueue.hasAuthority(task.id), true);
	} finally {
		await runtime.close();
	}
});

it("publishes one stateless Pi entrypoint that reloads with Jiti moduleCache disabled", async () => {
	const manifest = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
	assert.deepEqual(manifest.pi.extensions, ["./extensions/runtime-extension.ts"]);
	assert.doesNotMatch(
		await readFile(join(process.cwd(), "extensions", "a2a-extension.ts"), "utf8"),
		/export default function a2aServerExtension/,
		"the retired standalone server must not remain callable without the shared task store",
	);
	const { createJiti } = (await import(
		join(
			process.cwd(),
			"node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs",
		)
	)) as {
		createJiti: (
			url: string | URL,
			options: { moduleCache: boolean },
		) => { import<T>(path: string): Promise<T> };
	};
	const jiti = createJiti(import.meta.url, { moduleCache: false });
	const first = await jiti.import<{ default: unknown }>(
		join(process.cwd(), "extensions/runtime-extension.ts"),
	);
	const second = await jiti.import<{ default: unknown }>(
		join(process.cwd(), "extensions/runtime-extension.ts"),
	);
	assert.equal(typeof first.default, "function");
	assert.equal(typeof second.default, "function");
});
