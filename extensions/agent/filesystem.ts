import { createHash, randomUUID } from "node:crypto";
import {
	chmod,
	link,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	rmdir,
	stat,
	unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AgentSessionJournal } from "./journal.ts";
import {
	AGENT_MAX_PENDING_MESSAGES,
	AGENT_PROTOCOL_VERSION,
	type AgentEndpoint,
	type AgentMessageV1,
	type AgentReadResult,
	type AgentRespondResult,
	type AgentSendInput,
	type AgentSendResult,
	type AgentTransport,
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
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 10;

export class FilesystemAgentTransport implements AgentTransport {
	readonly endpoint: AgentEndpoint;
	readonly #root: string;
	readonly #pollMs: number;
	readonly #journal: AgentSessionJournal;
	#initialization: Promise<void> | undefined;
	#closed = false;

	constructor(config: FilesystemAgentConfig, journal = new AgentSessionJournal()) {
		if (!config.root) throw new Error("agent spool path is required");
		const id = validateIdentifier(config.endpointId, "endpoint id");
		this.endpoint = {
			id,
			principal: validateIdentifier(config.principalId ?? id, "principal id"),
		};
		this.#root = config.root;
		this.#pollMs = config.pollMs ?? 250;
		this.#journal = journal;
	}

	async initialize(): Promise<void> {
		if (this.#closed) throw new Error("agent transport is closed");
		this.#initialization ??= (async () => {
			await ensureDirectory(this.#root);
			await ensureDirectory(this.#endpointsRoot());
			await ensureDirectory(this.#inbox(this.endpoint.id));
			const metadata = this.#endpointMetadata(this.endpoint.id);
			await withDirectoryLock(`${metadata}.lock`, async () => {
				const existing = await optionalJson<AgentEndpoint>(metadata);
				if (existing) {
					if (existing.id !== this.endpoint.id || existing.principal !== this.endpoint.principal) {
						throw new Error(`endpoint "${this.endpoint.id}" is already registered`);
					}
					return;
				}
				await atomicJson(metadata, this.endpoint, true);
			});
			await this.#queuedMessages(this.endpoint.id);
		})();
		await this.#initialization;
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
		const recorded = this.#journal.message(id);
		if (recorded) {
			assertSameSend(recorded.message, this.endpoint.id, input);
			return { message: recorded.message, state: recorded.state, duplicate: true };
		}
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
		return withDirectoryLock(join(this.#inbox(recipient), ".queue-lock"), async () => {
			const path = this.#messagePath(recipient, id);
			const existing = await optionalJson<{
				readonly version: 1;
				readonly message: AgentMessageV1;
			}>(path);
			if (existing) {
				const existingMessage = validateMessage(existing.message);
				if (!sameImmutableMessage(existingMessage, message)) {
					throw new Error(`message id "${id}" already exists with different content`);
				}
				const stored = this.#journal.recordMessage(existingMessage, "accepted");
				return { message: stored.message, state: stored.state, duplicate: true };
			}
			const pending = await this.#queuedMessages(recipient);
			if (pending.length >= AGENT_MAX_PENDING_MESSAGES) {
				throw new Error(`recipient queue is full (${AGENT_MAX_PENDING_MESSAGES})`);
			}
			await atomicJson(path, { version: 1, message }, true);
			const stored = this.#journal.recordMessage(message, "accepted");
			return { message: stored.message, state: stored.state, duplicate: false };
		});
	}

	async read(messageId: string): Promise<AgentReadResult> {
		await this.initialize();
		const id = validateIdentifier(messageId, "message id");
		const target = await this.#receive(id);
		if (!target || target.message.recipient !== this.endpoint.id) {
			throw new Error("agent message was not delivered to this endpoint");
		}
		const updated =
			target.state === "accepted" || target.state === "delivered"
				? this.#journal.transition(id, "read")
				: target;
		return { target: updated, messages: this.#journal.context(id) };
	}

	async respond(messageId: string, response: string): Promise<AgentRespondResult> {
		await this.initialize();
		const id = validateIdentifier(messageId, "message id");
		const target = await this.#receive(id);
		if (!target || target.message.recipient !== this.endpoint.id) {
			throw new Error("agent message was not delivered to this endpoint");
		}
		const responseId = stableResponseId(this.endpoint.id, id, validateBody(response));
		if (target.responseId && target.responseId !== responseId) {
			throw new Error("agent message already has a different response");
		}
		const sent = await this.send({
			id: responseId,
			recipient: target.message.sender,
			conversationId: target.message.conversationId,
			body: response,
			replyTo: id,
		});
		const updated =
			target.state === "replied" ? target : this.#journal.transition(id, "replied", responseId);
		return { target: updated, response: sent };
	}

	async subscribe(onMessage: (messageId: string) => void): Promise<() => Promise<void>> {
		await this.initialize();
		const controller = new AbortController();
		const scan = async (): Promise<void> => {
			for (const message of await this.#queuedMessages(this.endpoint.id)) {
				const path = this.#messagePath(this.endpoint.id, message.id);
				const stored = this.#journal.recordMessage(message, "delivered");
				await durableUnlink(path);
				onMessage(stored.message.id);
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

	async #queuedMessages(endpoint: string): Promise<AgentMessageV1[]> {
		const inbox = this.#inbox(endpoint);
		let names: string[];
		try {
			names = await readdir(inbox);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
		const messages: AgentMessageV1[] = [];
		for (const name of names) {
			if (!name.endsWith(".json")) continue;
			try {
				const envelope = await readJson<{ readonly version: 1; readonly message: AgentMessageV1 }>(
					join(inbox, name),
				);
				if (envelope.version !== 1) continue;
				const message = validateMessage(envelope.message);
				if (message.recipient !== endpoint) continue;
				messages.push(message);
			} catch {
				// Atomic writes prevent partial JSON. Ignore corrupt administrator-owned files.
			}
		}
		return messages.sort(
			(a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
		);
	}

	async #receive(messageId: string) {
		const recorded = this.#journal.message(messageId);
		if (recorded) return recorded;
		const path = this.#messagePath(this.endpoint.id, messageId);
		const envelope = await readJson<{ readonly version: 1; readonly message: AgentMessageV1 }>(
			path,
		);
		if (envelope.version !== 1) throw new Error("unsupported agent delivery envelope");
		const message = validateMessage(envelope.message);
		if (message.recipient !== this.endpoint.id) {
			throw new Error("agent message was not delivered to this endpoint");
		}
		const stored = this.#journal.recordMessage(message, "delivered");
		await durableUnlink(path);
		return stored;
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
			// A hard link publishes the already-fsynced temporary inode without
			// overwriting a raced writer and without exposing a partially written
			// final path.
			await link(temporary, path);
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

async function durableUnlink(path: string): Promise<void> {
	try {
		await unlink(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	const directory = await open(dirname(path), "r");
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}

async function withDirectoryLock<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
	const deadline = Date.now() + LOCK_STALE_MS;
	while (true) {
		try {
			await mkdir(lockPath, { mode: DIRECTORY_MODE });
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const info = await stat(lockPath).catch(() => undefined);
			if (info && Date.now() - info.mtimeMs > LOCK_STALE_MS) {
				await rmdir(lockPath).catch(() => {});
				continue;
			}
			if (Date.now() >= deadline) throw new Error(`timed out waiting for lock ${lockPath}`);
			await delay(LOCK_RETRY_MS);
		}
	}
	try {
		return await operation();
	} finally {
		await rmdir(lockPath).catch(() => {});
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

function assertSameSend(message: AgentMessageV1, sender: string, input: AgentSendInput): void {
	if (
		message.sender !== sender ||
		message.recipient !== input.recipient ||
		message.conversationId !== input.conversationId ||
		message.body !== input.body ||
		message.replyTo !== input.replyTo
	) {
		throw new Error(`message id "${message.id}" already exists with different content`);
	}
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
