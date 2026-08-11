import assert from "node:assert/strict";
import { mkdtemp, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { outfitterTaskMetadata } from "../extensions/a2a/types.ts";
import { TaskEvidenceRuntime } from "../extensions/evidence/runtime.ts";
import { DevelopmentEvidenceStore } from "../extensions/evidence/store.ts";
import type { EvidencePolicyBundle, EvidenceRunIdentity } from "../extensions/evidence/types.ts";

const policy: EvidencePolicyBundle = {
	captureProfile: "development-read",
	allowedTools: ["read"],
	capture: {
		"task.activation": "required",
		"policy.decision": "required",
		"tool.call": "required",
		"tool.result": "required",
		"artifact.created": "required",
	},
};

const run: EvidenceRunIdentity = {
	ticketRunId: "ticket-1",
	task: {
		agentInterface: "https://agent.example/a2a",
		protocolBinding: "HTTP+JSON",
		protocolVersion: "1.0",
		taskId: "task-1",
	},
	attemptId: "attempt-1",
	turnId: "turn-1",
};

function create(root: string): DevelopmentEvidenceStore {
	return new DevelopmentEvidenceStore(
		root,
		{ principal: "agent:test", workloadIdentity: "spiffe://test/agent" },
		policy,
	);
}

test("the development evidence sink verifies a complete content-addressed run", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-evidence-"));
	const store = create(root);
	const activation = await store.putPayload({ locator: "slack:v1:abc" });
	await store.append({ recordType: "task.activation", run, request: activation });
	const decision = await store.append({
		recordType: "policy.decision",
		run,
		metadata: { decision: "allow", tool: "read" },
	});
	const request = await store.putPayload({ path: "README.md" });
	await store.append({
		recordType: "tool.call",
		run,
		actionId: "action-1",
		request,
		decisionRecordId: decision.recordId,
	});
	const response = await store.putPayload({ text: "contents" });
	await store.append({ recordType: "tool.result", run, actionId: "action-1", response });
	await store.append({ recordType: "artifact.created", run, response });
	const manifest = await store.finalize(run);
	assert.equal(manifest.record.recordType, "run.manifest");
	assert.equal(manifest.record.capture.missing.length, 0);
	assert.match(store.policyDigest, /^sha256:[0-9a-f]{64}$/);
	await store.close();
	assert.equal((await create(root).records(run)).length, 6);
});

test("required evidence and missing payloads fail closed", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-evidence-"));
	const store = create(root);
	const activation = await store.putPayload({ locator: "github:v1:abc" });
	await store.append({ recordType: "task.activation", run, request: activation });
	await assert.rejects(store.finalize(run), /required evidence is missing/);
	for (const type of ["policy.decision", "tool.call", "tool.result", "artifact.created"] as const) {
		await store.append({
			recordType: type,
			run,
			...(type === "tool.result" ? { response: activation } : {}),
		});
	}
	await unlink(join(root, activation.locator));
	await assert.rejects(store.finalize(run), /ENOENT/);
	const ledger = JSON.parse(await readFile(join(root, "ledger.json"), "utf8"));
	assert.equal(
		ledger.records.some((record: { recordType: string }) => record.recordType === "run.manifest"),
		false,
	);
});

test("the evidence store rejects record types forbidden by policy", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-evidence-forbidden-"));
	const store = new DevelopmentEvidenceStore(
		root,
		{ principal: "agent:test", workloadIdentity: "spiffe://test/agent" },
		{
			...policy,
			capture: { ...policy.capture, "tool.call": "forbidden" },
		},
	);
	await assert.rejects(
		store.append({ recordType: "tool.call", run, actionId: "forbidden-call" }),
		/evidence policy forbids tool\.call/,
	);
	assert.deepEqual(await store.records(run), []);
});

test("the task runtime captures policy, tool request, result, and final artifact", async () => {
	const root = await mkdtemp(join(tmpdir(), "channels-evidence-runtime-"));
	const runtime = new TaskEvidenceRuntime({
		rootPath: root,
		actor: { principal: "agent:test", workloadIdentity: "spiffe://test/agent" },
		policy,
	});
	const task = {
		id: "task-runtime",
		contextId: "context-runtime",
		status: { state: "TASK_STATE_SUBMITTED" as const },
		metadata: outfitterTaskMetadata({
			ticketRunId: "ticket-runtime",
			task: {
				agentInterface: "https://agent.example/a2a",
				protocolBinding: "HTTP+JSON",
				protocolVersion: "1.0",
				taskId: "task-runtime",
			},
			policyDigest: runtime.policyDigest,
			evidence: [],
			idempotency: { messageId: "message-runtime", scope: "caller" },
		}),
	};
	await runtime.activate(task, {
		messageId: "message-runtime",
		role: "ROLE_USER",
		parts: [{ text: "read it" }],
	});
	await runtime.beforeTool(task.id, "call-1", "read", { path: "README.md" });
	await runtime.afterTool(task.id, "call-1", "read", { content: "ok" });
	const manifest = await runtime.finalize(task.id, { text: "done" });
	assert.equal(manifest.record.capture.missing.length, 0);
	await assert.rejects(
		runtime.beforeTool(task.id, "call-2", "bash", { command: "true" }),
		/policy does not allow tool/,
	);
});
