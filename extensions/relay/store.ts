import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import {
	AGENT_MAX_PENDING_MESSAGES,
	AGENT_PROTOCOL_VERSION,
	type AgentMessageV1,
	type AgentSendInput,
	type AgentSendResult,
	validateBody,
	validateIdentifier,
	validateMessage,
} from "../agent/types.ts";

export const RELAY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface RelayStoredMessage {
	readonly cursor: number;
	readonly message: AgentMessageV1;
}

interface RelayStoreData {
	readonly version: 1;
	nextCursor: number;
	messages: RelayStoredMessage[];
	acknowledged: Record<string, number>;
}

export interface RelayAccepted extends AgentSendResult {
	readonly cursor: number;
}

export class RelayStore {
	readonly #path: string;
	#data: RelayStoreData | undefined;
	#operation: Promise<void> = Promise.resolve();

	constructor(path: string) {
		if (!path) throw new Error("relay store path is required");
		this.#path = path;
	}

	async initialize(): Promise<void> {
		if (this.#data) return;
		await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
		try {
			const parsed = JSON.parse(await readFile(this.#path, "utf8")) as RelayStoreData;
			if (parsed.version !== 1 || !Array.isArray(parsed.messages)) {
				throw new Error("unsupported relay store");
			}
			for (const entry of parsed.messages) validateMessage(entry.message);
			this.#data = parsed;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			this.#data = { version: 1, nextCursor: 1, messages: [], acknowledged: {} };
			await this.#persist();
		}
	}

	async accept(sender: string, input: AgentSendInput): Promise<RelayAccepted> {
		return this.#serial(async () => {
			await this.initialize();
			const data = this.#requireData();
			data.messages = data.messages.filter(
				(entry) => Date.parse(entry.message.createdAt) >= Date.now() - RELAY_RETENTION_MS,
			);
			const id = validateIdentifier(input.id ?? randomUUID(), "message id");
			const existing = data.messages.find((entry) => entry.message.id === id);
			if (existing) {
				if (
					existing.message.sender !== sender ||
					existing.message.recipient !== input.recipient ||
					existing.message.conversationId !== input.conversationId ||
					existing.message.body !== input.body ||
					existing.message.replyTo !== input.replyTo
				) {
					throw new Error(`message id "${id}" already exists with different content`);
				}
				return {
					cursor: existing.cursor,
					message: existing.message,
					state: "accepted",
					duplicate: true,
				};
			}
			const recipient = validateIdentifier(input.recipient, "recipient");
			const pending = data.messages.filter(
				(entry) =>
					entry.message.recipient === recipient &&
					entry.cursor > (data.acknowledged[recipient] ?? 0),
			);
			if (pending.length >= AGENT_MAX_PENDING_MESSAGES) {
				throw new Error(`recipient queue is full (${AGENT_MAX_PENDING_MESSAGES})`);
			}
			const message = validateMessage({
				version: AGENT_PROTOCOL_VERSION,
				id,
				conversationId: validateIdentifier(input.conversationId, "conversation id"),
				sender: validateIdentifier(sender, "sender"),
				recipient,
				createdAt: new Date().toISOString(),
				body: validateBody(input.body),
				...(input.replyTo === undefined
					? {}
					: { replyTo: validateIdentifier(input.replyTo, "reply target") }),
			});
			const cursor = data.nextCursor++;
			data.messages.push({ cursor, message });
			await this.#persist();
			return { cursor, message, state: "accepted", duplicate: false };
		});
	}

	async pending(endpoint: string, after: number): Promise<readonly RelayStoredMessage[]> {
		await this.initialize();
		return this.#requireData().messages.filter(
			(entry) => entry.message.recipient === endpoint && entry.cursor > after,
		);
	}

	async history(): Promise<readonly RelayStoredMessage[]> {
		await this.initialize();
		return [...this.#requireData().messages];
	}

	async acknowledge(endpoint: string, cursor: number): Promise<number> {
		return this.#serial(async () => {
			await this.initialize();
			const data = this.#requireData();
			const current = data.acknowledged[endpoint] ?? 0;
			if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("invalid cursor");
			if (cursor <= current) return current;
			const ownsCursor = data.messages.some(
				(entry) => entry.cursor === cursor && entry.message.recipient === endpoint,
			);
			if (!ownsCursor) throw new Error("cursor does not belong to endpoint");
			data.acknowledged[endpoint] = cursor;
			await this.#persist();
			return cursor;
		});
	}

	async ready(): Promise<boolean> {
		try {
			await this.initialize();
			await this.#persist();
			return true;
		} catch {
			return false;
		}
	}

	async #serial<T>(operation: () => Promise<T>): Promise<T> {
		const previous = this.#operation;
		let release = (): void => {};
		this.#operation = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await operation();
		} finally {
			release();
		}
	}

	#requireData(): RelayStoreData {
		if (!this.#data) throw new Error("relay store is not initialized");
		return this.#data;
	}

	async #persist(): Promise<void> {
		const data = this.#requireData();
		const temporary = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
		const file = await open(temporary, "wx", 0o600);
		try {
			await file.writeFile(`${JSON.stringify(data)}\n`);
			await file.sync();
		} finally {
			await file.close();
		}
		try {
			await rename(temporary, this.#path);
			const directory = await open(dirname(this.#path), "r");
			await directory.sync();
			await directory.close();
		} catch (error) {
			await unlink(temporary).catch(() => {});
			throw error;
		}
	}
}
