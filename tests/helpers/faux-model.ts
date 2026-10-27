import { type FauxProviderHandle, fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Pi loads extensions in its own module instance; share one scripted provider.
const shared = globalThis as { __channelsFaux?: FauxProviderHandle };
shared.__channelsFaux ??= fauxProvider({
	provider: "channels-faux",
	api: "channels-faux",
	models: [{ id: "scripted" }],
});
export const faux: FauxProviderHandle = shared.__channelsFaux;

/** Test-only extension: a keyless scripted model provider for real Pi sessions. */
export default function fauxModel(pi: ExtensionAPI): void {
	pi.registerProvider("channels-faux", {
		baseUrl: "http://127.0.0.1:9",
		apiKey: "fixture",
		api: "channels-faux",
		streamSimple: (model, context, options) => faux.provider.streamSimple(model, context, options),
		models: [
			{
				id: "scripted",
				name: "Scripted",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100_000,
				maxTokens: 1_000,
			},
		],
	});
}
