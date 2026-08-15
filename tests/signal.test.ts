import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createSignalSource, signalActivation } from "../extensions/sources/signal.ts";
import type {
	NativeActivation,
	SourceEvidenceInput,
	SourceTaskActivationSink,
} from "../extensions/task-plane/types.ts";

const line = JSON.stringify({
	method: "receive",
	params: {
		envelope: {
			sourceUuid: "sender-uuid",
			timestamp: 1_786_800_000_000,
			dataMessage: { timestamp: 1_786_800_000_000, message: "untrusted work" },
		},
	},
});

test("Signal turns an exact receive notification into a durable Task payload", () => {
	const activation = signalActivation(line, "signal:principal");
	assert.ok(activation);
	assert.equal(activation.source, "signal");
	assert.equal(activation.nativeLocator.sender, "sender-uuid");
	assert.equal(activation.nativeLocator.timestamp, "1786800000000");
	assert.match(activation.providerEventId, /^event:[a-f0-9]{40}$/);
	assert.match(JSON.stringify(activation.parts), /untrusted work/);
	assert.doesNotMatch(JSON.stringify(activation.nativeLocator), /untrusted work/);
});

test("Signal retains task-intake failures instead of throwing from readline", async () => {
	const children: FakeChild[] = [];
	const spawn = (() => {
		const child = new FakeChild();
		children.push(child);
		return child as unknown as ChildProcess;
	}) as typeof import("node:child_process").spawn;
	let attempts = 0;
	const sink: SourceTaskActivationSink = {
		async accept(_input: NativeActivation) {
			attempts += 1;
			if (attempts === 1) throw new Error("task store unavailable");
			return { activationId: "a", taskId: "t", contextId: "c", disposition: "created" };
		},
		async continue() {
			throw new Error("unused");
		},
	};
	const stop = await createSignalSource(
		{ number: "+15555550100", configDir: "/tmp/signal-test" },
		sink,
		spawn,
		0,
	).start(() => {
		throw new Error("legacy onEvent must not be used");
	});
	try {
		children[0]?.stdout.write(`${line}\n`);
		await waitFor(() => attempts === 2);
		assert.equal(children.length, 1);
	} finally {
		await stop();
	}
});

test("Signal pauses stdout while one durable acceptance is in flight", async () => {
	const child = new FakeChild();
	const spawn = (() =>
		child as unknown as ChildProcess) as typeof import("node:child_process").spawn;
	let accepted = 0;
	let release = (): void => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	const sink: SourceTaskActivationSink = {
		async accept() {
			accepted += 1;
			if (accepted === 1) await blocked;
			return { activationId: "a", taskId: "t", contextId: "c", disposition: "created" };
		},
		async continue() {
			throw new Error("unused");
		},
	};
	const stop = await createSignalSource(
		{ number: "+15555550100", configDir: "/tmp/signal-test" },
		sink,
		spawn,
		0,
	).start(() => {});
	try {
		child.stdout.write(`${line}\n`);
		await waitFor(() => accepted === 1);
		assert.equal(child.stdout.isPaused(), true);
		const next = JSON.parse(line) as {
			params: { envelope: { timestamp: number; dataMessage: { timestamp: number } } };
		};
		next.params.envelope.timestamp += 1;
		next.params.envelope.dataMessage.timestamp += 1;
		child.stdout.write(`${JSON.stringify(next)}\n`);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(accepted, 1);
		release();
		await waitFor(() => accepted === 2);
	} finally {
		await stop();
	}
});

test("Signal records a permanent invalid activation and processes the line behind it", async () => {
	const children: FakeChild[] = [];
	const spawn = (() => {
		const child = new FakeChild();
		children.push(child);
		return child as unknown as ChildProcess;
	}) as typeof import("node:child_process").spawn;
	const accepted: string[] = [];
	const evidence: SourceEvidenceInput[] = [];
	const sink: SourceTaskActivationSink = {
		async accept(input) {
			const timestamp = input.nativeLocator.timestamp as string;
			if (timestamp === "1786800000000") {
				throw new Error(
					"nativeLocator.sender must be a non-empty string of at most 4096 characters",
				);
			}
			accepted.push(timestamp);
			return { activationId: "a", taskId: "t", contextId: "c", disposition: "created" };
		},
		async continue() {
			throw new Error("unused");
		},
		async recordEvidence(input) {
			evidence.push(input);
		},
	};
	const stop = await createSignalSource(
		{ number: "+15555550100", configDir: "/tmp/signal-test" },
		sink,
		spawn,
		0,
	).start(() => {
		throw new Error("legacy onEvent must not be used");
	});
	try {
		const next = JSON.parse(line) as {
			params: { envelope: { timestamp: number; dataMessage: { timestamp: number } } };
		};
		next.params.envelope.timestamp += 1;
		next.params.envelope.dataMessage.timestamp += 1;
		children[0]?.stdout.write(`${line}\n${JSON.stringify(next)}\n`);
		await waitFor(() => accepted.length === 1);
		assert.deepEqual(accepted, ["1786800000001"]);
		assert.equal(evidence.length, 1);
		assert.equal(evidence[0]?.kind, "permanent-invalid-activation");
		assert.match(evidence[0]?.detail?.providerEventId ?? "", /^event:[a-f0-9]{40}$/);
	} finally {
		await stop();
	}
});

class FakeChild extends EventEmitter {
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	kill(): boolean {
		setImmediate(() => this.emit("exit", 0));
		return true;
	}
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("timed out");
}
