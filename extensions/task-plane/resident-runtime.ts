import { join } from "node:path";
import { atomicWrite } from "./stores.ts";

type Profile = { residentId: string; revision: number; bio: string };
export interface ResidentRuntimeSnapshot {
	readonly version: 1;
	readonly observedAt: number;
	readonly browser: "ready" | "unavailable" | "not-configured";
	readonly profileAppliedRevision: number | null;
}

/** Private runtime configuration, independent of catalog profile identity. */
export class ResidentRuntime {
	readonly #env: NodeJS.ProcessEnv;
	readonly #fetch: typeof fetch;
	#profile: Profile | undefined;
	#appliedRevision: number | null = null;
	#root: string | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#pending: Promise<void> = Promise.resolve();
	#closed = false;

	constructor(env: NodeJS.ProcessEnv = process.env, transport: typeof fetch = fetch) {
		this.#env = env;
		this.#fetch = transport;
	}

	/** Called by the task session's system-prompt hook, never by a channel message. */
	bioForPrompt(): string {
		this.#appliedRevision = this.#profile?.revision ?? null;
		return this.#profile?.bio ?? "";
	}

	async start(root: string): Promise<() => Promise<void>> {
		if (!this.#env.AGENT_BROWSER_CDP_URL && !this.#env.OUTFITTER_RESIDENT_PROFILE_URL)
			return async () => {};
		this.#root = root;
		this.#closed = false;
		await this.refresh();
		const poll = () => {
			if (this.#closed) return;
			this.#timer = setTimeout(() => {
				void this.refresh()
					.catch(() => {})
					.finally(poll);
			}, 30_000);
			this.#timer.unref();
		};
		poll();
		return async () => {
			this.#closed = true;
			clearTimeout(this.#timer);
			await this.#pending;
		};
	}

	refresh(): Promise<void> {
		this.#pending = this.#pending.then(
			() => this.#refresh(),
			() => this.#refresh(),
		);
		return this.#pending;
	}

	async #refresh(): Promise<void> {
		await this.#readProfile().catch(() => {});
		const browser = await this.#browser();
		if (this.#root)
			await atomicWrite(join(this.#root, "resident-runtime.v1.json"), {
				version: 1,
				observedAt: Date.now(),
				browser,
				profileAppliedRevision: this.#appliedRevision,
			} satisfies ResidentRuntimeSnapshot);
	}

	async #readProfile(): Promise<void> {
		const endpoint = this.#env.OUTFITTER_RESIDENT_PROFILE_URL;
		if (!endpoint) return;
		const url = new URL(endpoint);
		if (
			url.protocol !== "https:" ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			url.pathname !== "/resident-profile"
		)
			throw new Error("Invalid resident profile endpoint");
		const token = this.#env.OUTFITTER_RESIDENT_PROFILE_TOKEN;
		const residentId = this.#env.OUTFITTER_RESIDENT_ID;
		if (!token || !residentId) throw new Error("Resident profile credentials missing");
		const response = await this.#fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
			redirect: "error",
			signal: AbortSignal.timeout(5000),
		});
		if (!response.ok) throw new Error("Resident profile unavailable");
		const text = await response.text();
		if (text.length > 32_768) throw new Error("Resident profile too large");
		const profile = JSON.parse(text) as Profile;
		if (
			profile.residentId !== residentId ||
			!Number.isSafeInteger(profile.revision) ||
			profile.revision < 1 ||
			typeof profile.bio !== "string" ||
			profile.bio.length > 8000
		)
			throw new Error("Resident profile mismatch");
		if (this.#profile && profile.revision < this.#profile.revision) return;
		this.#profile = profile;
	}

	async #browser(): Promise<ResidentRuntimeSnapshot["browser"]> {
		const endpoint = this.#env.AGENT_BROWSER_CDP_URL;
		if (!endpoint) return "not-configured";
		try {
			const url = new URL(endpoint);
			if (
				url.protocol !== "http:" ||
				!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
				url.username ||
				url.password ||
				url.search ||
				url.hash
			)
				return "unavailable";
			url.pathname = "/json/version";
			const response = await this.#fetch(url, {
				redirect: "error",
				signal: AbortSignal.timeout(3000),
			});
			if (!response.ok) return "unavailable";
			const value = (await response.json()) as Record<string, unknown>;
			return typeof value.Browser === "string" && typeof value["Protocol-Version"] === "string"
				? "ready"
				: "unavailable";
		} catch {
			return "unavailable";
		}
	}
}
