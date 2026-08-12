/**
 * Shared stubs for extension tests. Not a `*.test.ts` file, so the runner's
 * `tests/*.test.ts` glob leaves it alone.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TaskEvidence } from "../extensions/evidence/runtime.ts";

export type LifecycleHandler = (event?: { readonly prompt?: string }) => Promise<void> | void;

export interface RegisteredTool {
	readonly name: string;
	execute(toolCallId: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface Wake {
	readonly text: string;
	readonly options: unknown;
}

export interface FakePi {
	readonly handlers: Map<string, LifecycleHandler>;
	readonly tools: Map<string, RegisteredTool>;
	readonly wakes: Wake[];
	readonly pi: ExtensionAPI;
}

/** An ExtensionAPI that records lifecycle handlers, tools, and wakes. */
export function fakePi(): FakePi {
	const handlers = new Map<string, LifecycleHandler>();
	const tools = new Map<string, RegisteredTool>();
	const wakes: Wake[] = [];
	const pi = {
		on(event: string, handler: LifecycleHandler) {
			handlers.set(event, handler);
		},
		registerTool(tool: RegisteredTool) {
			tools.set(tool.name, tool);
		},
		sendUserMessage(text: string, options: unknown) {
			wakes.push({ text, options });
		},
	} as unknown as ExtensionAPI;
	return { handlers, tools, wakes, pi };
}

/** A TaskEvidence that records nothing, for tests that assert other behaviour. */
export const INERT_EVIDENCE = {
	policyDigest: `sha256:${"a".repeat(64)}`,
	async initialize() {},
	async activate() {},
	async beforeTool() {},
	async afterTool() {},
	async finalize() {},
	references() {
		return [];
	},
	async close() {},
} as unknown as TaskEvidence;

/** Poll `condition` on a short interval until it holds, or give up. */
export async function waitFor(condition: () => boolean, attempts = 200): Promise<void> {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		if (condition()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("condition was not met");
}
