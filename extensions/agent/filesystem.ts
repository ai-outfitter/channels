import { createHash, randomUUID } from "node:crypto";
import {
	chmod,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
	AGENT_MAX_CONTEXT_BYTES,
	AGENT_MAX_CONTEXT_MESSAGES,
	AGENT_MAX_PENDING_MESSAGES,
	AGENT_PROTOCOL_VERSION,
	type AgentEndpoint,
	type AgentMessageV1,
	type AgentReadResult,
	type AgentRespondResult,
	type AgentSendInput,
	type AgentSendResult,
	type AgentTransport,
	advanceState,
	compareMessages,
	type StoredAgentMessage,
	validateBody,
	validateIdentifier,
	validateMessage,
} from "./types.ts";

export interface FilesystemAgentConfig {
	readonly root: string;
	readonly endpointId: string;
	readonly principalId?: string;
	readonly pollMs?: number;
}

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

export class FilesystemAgentTransport implements AgentTransport {
	readonly endpoint: AgentEndpoint;
	readonly #root: string;
	readonly #pollMs: number;
	#closed = false;

	constructor(config: FilesystemAgentConfig) {
		if (!config.root) throw new Error("agent spool path is required");
		const id = validateIdentifier(config.endpointId, "endpoint id");
		this.endpoint = {
			id,
			principal: validateIdentifier(config.principalId ?? id, "principal id"),
		};
		this.#root = config.root;
		this.#pollMs = config.pollMs ?? 250;
	}

	async initialize(): Promise<void> {
		await ensureDirectory(this.#root);
		await ensureDirectory(this.#endpointsRoot());
		await ensureDirectory(this.#inbox(this.endpoint.id));
		await atomicJson(this.#endpointMetadata(this.endpoint.id), this.endpoint);
	}

	async list(): Promise<readonly AgentEndpoint[]> {
		await this.initialize();
		const entries = await readdir(this.#endpointsRoot(), { withFileTypes: true });
		const endpoints: AgentEndpoint[] = [];
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			try {
				const parsed = await readJson<AgentEndpoint>(this.#endpointMetadata(entry.name));
				validateIdentifier(parsed.id, "endpoint id");
				validateIdentifier(parsed.principal, "principal id");
				endpoints.push(parsed);
			} catch {
				// A partially provisioned endpoint is not discoverable.
			}
		}
		return endpoints.sort((a, b) => a.id.localeCompare(b.id));
	}

	async send(input: AgentSendInput): Promise<AgentSendResult> {
		await this.initialize();
		const recipient = validateIdentifier(input.recipient, "recipient");
		const id = validateIdentifier(input.id ?? randomUUID(), "message id");
		const message = validateMessage({
			version: AGENT_PROTOCOL_VERSION,
			id,
			conversationId: validateIdentifier(input.conversationId, "conversation id"),
			sender: this.endpoint.id,
			recipient,
			createdAt: new Date().toISOString(),
			body: validateBody(input.body),
			...(input.replyTo === undefined
				? {}
				: { replyTo: validateIdentifier(input.replyTo, "reply target") }),
		});
		await ensureDirectory(this.#inbox(recipient));
		const path = this.#messagePath(recipient, id);
		const existing = await optionalJson<StoredAgentMessage>(path);
		if (existing) {
			if (!sameImmutableMessage(existing.message, message)) {
				throw new Error(`message id "${id}" already exists with different content`);
			}
			return { message: existing.message, state: existing.state, duplicate: true };
		}
		const pending = await this.#storedMessages(recipient);
		if (
			pending.filter((item) => item.state !== "handled" && item.state !== "replied").length >=
			AGENT_MAX_PENDING_MESSAGES
		) {
			throw new Error(`recipient queue is full (${AGENT_MAX_PENDING_MESSAGES})`);
		}
		const stored: StoredAgentMessage = {
			message,
			state: "accepted",
			updatedAt: new Date().toISOString(),
		};
		try {
			await atomicJson(path, stored, true);
			return { message, state: "accepted", duplicate: false };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const raced = await readJson<StoredAgentMessage>(path);
			if (!sameImmutableMessage(raced.message, message)) {
				throw new Error(`message id "${id}" already exists with different content`);
			}
			return { message: raced.message, state: raced.state, duplicate: true };
		}
	}

	async read(messageId: string): Promise<AgentReadResult> {
		await this.initialize();
		const id = validateIdentifier(messageId, "message id");
		const targetPath = this.#messagePath(this.endpoint.id, id);
		const target = await readJson<StoredAgentMessage>(targetPath);
		validateMessage(target.message);
		const updated = await this.#update(targetPath, target, "read");
		const conversation = (await this.#storedMessages(this.endpoint.id))
			.filter((entry) => entry.message.conversationId === target.message.conversationId)
			.sort(compareMessages);
		return { target: updated, messages: boundedContext(conversation, id) };
	}

	async respond(messageId: string, response: string): Promise<AgentRespondResult> {
		await this.initialize();
		const id = validateIdentifier(messageId, "message id");
		const targetPath = this.#messagePath(this.endpoint.id, id);
		const target = await readJson<StoredAgentMessage>(targetPath);
		validateMessage(target.message);
		const responseId = stableResponseId(this.endpoint.id, id, validateBody(response));
		const sent = await this.send({
			id: responseId,
			recipient: target.message.sender,
			conversationId: target.message.conversationId,
			body: response,
			replyTo: id,
		});
		const updated = await this.#update(targetPath, target, "replied", responseId);
		return { target: updated, response: sent };
	}

	async subscribe(onMessage: (messageId: string) => void): Promise<() => Promise<void>> {
		await this.initialize();
		const seen = new Set<string>();
		const controller = new AbortController();
		const scan = async (): Promise<void> => {
			for (const item of await this.#storedMessages(this.endpoint.id)) {
				if (item.state === "handled" || item.state === "replied" || seen.has(item.message.id)) {
					continue;
				}
				seen.add(item.message.id);
				const path = this.#messagePath(this.endpoint.id, item.message.id);
				await this.#update(path, item, "delivered");
				onMessage(item.message.id);
			}
		};
		await scan();
		const running = (async () => {
			while (!controller.signal.aborted && !this.#closed) {
				try {
					await delay(this.#pollMs, undefined, { signal: controller.signal });
					await scan();
				} catch (error) {
					if (!controller.signal.aborted) throw error;
				}
			}
		})();
		return async () => {
			controller.abort();
			await running.catch(() => {});
		};
	}

	async close(): Promise<void> {
		this.#closed = true;
	}

	async #storedMessages(endpoint: string): Promise<StoredAgentMessage[]> {
		const inbox = this.#inbox(endpoint);
		let names: string[];
		try {
			names = await readdir(inbox);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
		const messages: StoredAgentMessage[] = [];
		for (const name of names) {
			if (!name.endsWith(".json")) continue;
			try {
				const stored = await readJson<StoredAgentMessage>(join(inbox, name));
				validateMessage(stored.message);
				messages.push(stored);
			} catch {
				// Atomic writes prevent partial JSON. Ignore corrupt administrator-owned files.
			}
		}
		return messages;
	}

	async #update(
		path: string,
		current: StoredAgentMessage,
		state: StoredAgentMessage["state"],
		responseId?: string,
	): Promise<StoredAgentMessage> {
		const latest = (await optionalJson<StoredAgentMessage>(path)) ?? current;
		const chosenResponseId = latest.responseId ?? responseId;
		const updated: StoredAgentMessage = {
			message: latest.message,
			state: advanceState(latest.state, state),
			updatedAt: new Date().toISOString(),
			...(chosenResponseId ? { responseId: chosenResponseId } : {}),
		};
		await atomicJson(path, updated);
		return updated;
	}

	#endpointsRoot(): string {
		return join(this.#root, "endpoints");
	}

	#inbox(endpoint: string): string {
		return join(this.#endpointsRoot(), encodeURIComponent(endpoint), "messages");
	}

	#endpointMetadata(endpoint: string): string {
		return join(this.#endpointsRoot(), encodeURIComponent(endpoint), "endpoint.json");
	}

	#messagePath(endpoint: string, id: string): string {
		return join(this.#inbox(endpoint), `${encodeURIComponent(id)}.json`);
	}
}

async function ensureDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: DIRECTORY_MODE });
	await stat(path).then((info) => {
		if (!info.isDirectory()) throw new Error(`${path} is not a directory`);
	});
	await chmod(path, DIRECTORY_MODE);
}

async function atomicJson(path: string, value: unknown, exclusive = false): Promise<void> {
	await ensureDirectory(dirname(path));
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	const content = `${JSON.stringify(value)}\n`;
	const handle = await open(temporary, "wx", FILE_MODE);
	try {
		await handle.writeFile(content);
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		if (exclusive) {
			await writeFile(path, content, { flag: "wx", mode: FILE_MODE });
			const final = await open(path, "r");
			await final.sync();
			await final.close();
			await unlink(temporary);
		} else {
			await rename(temporary, path);
		}
		const directory = await open(dirname(path), "r");
		await directory.sync();
		await directory.close();
	} catch (error) {
		await unlink(temporary).catch(() => {});
		throw error;
	}
}

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, "utf8")) as T;
}

async function optionalJson<T>(path: string): Promise<T | undefined> {
	try {
		return await readJson<T>(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function sameImmutableMessage(a: AgentMessageV1, b: AgentMessageV1): boolean {
	return (
		a.version === b.version &&
		a.id === b.id &&
		a.conversationId === b.conversationId &&
		a.sender === b.sender &&
		a.recipient === b.recipient &&
		a.body === b.body &&
		a.replyTo === b.replyTo
	);
}

function boundedContext(
	messages: readonly StoredAgentMessage[],
	targetId: string,
): readonly StoredAgentMessage[] {
	const targetIndex = messages.findIndex((item) => item.message.id === targetId);
	const start = Math.max(0, targetIndex - AGENT_MAX_CONTEXT_MESSAGES + 1);
	const selected: StoredAgentMessage[] = [];
	let bytes = 0;
	for (let index = targetIndex; index >= start; index -= 1) {
		const item = messages[index];
		if (!item) continue;
		const size = Buffer.byteLength(item.message.body);
		if (selected.length > 0 && bytes + size > AGENT_MAX_CONTEXT_BYTES) break;
		selected.unshift(item);
		bytes += size;
	}
	return selected;
}

function stableResponseId(endpoint: string, messageId: string, response: string): string {
	return `reply-${createHash("sha256")
		.update(endpoint)
		.update("\0")
		.update(messageId)
		.update("\0")
		.update(response)
		.digest("hex")
		.slice(0, 32)}`;
}
