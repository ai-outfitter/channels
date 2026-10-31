import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { A2aPart } from "../a2a/types.ts";

export const SYSTEM_CONTEXT_BYTES = 60 * 1024;

/** Read only the explicit context field of the accepted task envelope. Ordinary
 * task text, tool output and subsequent messages never become system content. */
export function taskSystemContext(parts: readonly A2aPart[]): string | undefined {
	const contexts: string[] = [];
	for (const part of parts) {
		if (typeof part.text !== "string") continue;
		let value: unknown;
		try {
			value = JSON.parse(part.text);
		} catch {
			continue;
		}
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		const envelope = value as Record<string, unknown>;
		if (envelope.kind !== "outfitter.resident-task/v1" || envelope.systemContext === undefined)
			continue;
		if (
			typeof envelope.systemContext !== "string" ||
			Buffer.byteLength(envelope.systemContext) > SYSTEM_CONTEXT_BYTES
		)
			throw new Error("Invalid resident system context");
		contexts.push(envelope.systemContext);
	}
	if (contexts.length > 1) throw new Error("Ambiguous resident system context");
	return contexts[0];
}

/** Facts append to the resolved profile, bio and runtime instructions. */
export function systemContextExtension(markdown: string) {
	return (api: ExtensionAPI): void => {
		api.on("before_agent_start", (event) => ({
			systemPrompt: `${event.systemPrompt}\n\nWiki graph context (stored facts; actions still require current server authorization):\n\n${markdown}`,
		}));
	};
}
