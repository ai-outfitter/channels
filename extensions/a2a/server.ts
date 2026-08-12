import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isAbsolute, join } from "node:path";
import { acquireProcessLease } from "../durable-file.ts";
import {
	A2aArtifactStore,
	MAX_LARGE_ARTIFACT_BYTES,
	OUTFITTER_ARTIFACT_EXTENSION_URI,
	OUTFITTER_ARTIFACT_METADATA_KEY,
} from "./artifacts.ts";
import { findBearerCredential, parseJson, readBoundedBody } from "./http.ts";
import { A2aTaskStore, trimTask } from "./store.ts";
import {
	A2A_MEDIA_TYPE,
	A2A_PROTOCOL_VERSION,
	A2A_VERSION_HEADER,
	type A2aArtifact,
	A2aError,
	type A2aMessage,
	type A2aSendMessageRequest,
	type A2aSendMessageResponse,
	type A2aStreamResponse,
	type A2aTask,
	type A2aTaskState,
	AGENT_CARD_PATH,
	isSettled,
	isTerminal,
	OUTFITTER_TASK_EXTENSION_URI,
	outfitterTaskMetadata,
	validateIdentifier,
	validateMessage,
} from "./types.ts";

export interface A2aCredential {
	readonly token: string;
	readonly principal: string;
}

export interface A2aServerConfig {
	readonly host: string;
	readonly port: number;
	readonly storePath: string;
	readonly credentials: readonly A2aCredential[];
	readonly agentName: string;
	readonly agentDescription: string;
	/** Absolute public URL of this interface, as advertised on the Agent Card. */
	readonly publicUrl: string;
	readonly agentVersion: string;
	/** Immutable policy bundle selected by deployment, never by message content. */
	readonly policyDigest: string;
	readonly artifactStorePath: string;
	/** Listen for external A2A traffic. Local channel intake does not need a socket. */
	readonly listen?: boolean;
	/** Upper bound for a blocking send before it returns the current snapshot. */
	readonly blockingTimeoutMs?: number;
}

/** Controller handed to the executor once it decides the message is work. */
export interface A2aTaskController {
	readonly task: A2aTask;
	status(state: A2aTaskState, message?: A2aMessage): Promise<A2aTask>;
	artifact(artifact: A2aArtifact): Promise<A2aTask>;
	evidence(reference: string): Promise<A2aTask>;
}

export interface A2aExecutorContext {
	readonly principal: string;
	readonly message: A2aMessage;
	/** Present when the message continues an existing task. */
	readonly task?: A2aTask;
	/**
	 * Mints a new task (or binds the continued one) and returns its
	 * controller. An executor that never calls begin() answers with a direct
	 * Message instead — the server decides nothing; the executor owns the
	 * Message-versus-Task decision.
	 */
	begin(taskId?: string): Promise<A2aTaskController>;
	/** Principal-scoped lookup for a trusted executor routing continuation. */
	lookupTask?(taskId: string): Promise<A2aTask | undefined>;
}

/**
 * Returns the direct-response Message parts when no task was begun, or void
 * after driving a begun task. Task creation grants no authority: the
 * executor is configured at deployment, and nothing in the inbound message
 * selects an agent, tool set, or workflow topology.
 */
export type A2aExecutor = (context: A2aExecutorContext) => Promise<A2aMessage | undefined>;

export interface RunningA2aServer {
	readonly url: string;
	/** Submit trusted local intake without an HTTP loopback or bearer credential. */
	submit(principal: string, request: A2aSendMessageRequest): Promise<A2aSendMessageResponse>;
	close(): Promise<void>;
	/**
	 * Server-side task access for the hosting session's own tools. This
	 * bypasses client authentication deliberately: the resident agent IS the
	 * server, so its tools act as the owner of every task the server holds.
	 */
	readTask(taskId: string): Promise<A2aTask | undefined>;
	controllerForTask(taskId: string): Promise<A2aTaskController | undefined>;
	/** Accepted tasks that need a new task-scoped agent turn after restart. */
	recoverableTaskControllers(): Promise<readonly A2aTaskController[]>;
}

const DEFAULT_BLOCKING_TIMEOUT_MS = 60_000;

type Subscriber = (event: A2aStreamResponse) => void;

export async function startA2aServer(
	config: A2aServerConfig,
	executor: A2aExecutor,
): Promise<RunningA2aServer> {
	validateA2aServerConfig(config);
	const releaseLease = await acquireProcessLease(`${config.storePath}.lock`);
	const store = new A2aTaskStore(config.storePath, (taskId, principal, message) =>
		outfitterTaskMetadata({
			ticketRunId: randomUUID(),
			task: {
				agentInterface: config.publicUrl,
				protocolBinding: "HTTP+JSON",
				protocolVersion: A2A_PROTOCOL_VERSION,
				taskId,
			},
			policyDigest: config.policyDigest,
			evidence: [],
			idempotency: { messageId: message.messageId, scope: principal },
		}),
	);
	const artifacts = new A2aArtifactStore(config.artifactStorePath, config.publicUrl);
	try {
		await artifacts.initialize();
		await store.initialize();
	} catch (error) {
		await releaseLease();
		throw error;
	}
	const subscribers = new Map<string, Set<Subscriber>>();
	const blockingWaits = new Set<() => void>();

	const emit = (taskId: string, event: A2aStreamResponse): void => {
		for (const subscriber of subscribers.get(taskId) ?? []) subscriber(event);
	};

	const subscribe = (taskId: string, subscriber: Subscriber): (() => void) => {
		const set = subscribers.get(taskId) ?? new Set();
		set.add(subscriber);
		subscribers.set(taskId, set);
		return () => {
			set.delete(subscriber);
			if (set.size === 0) subscribers.delete(taskId);
		};
	};

	const controllerFor = (principal: string, initial: A2aTask): A2aTaskController => {
		let current = initial;
		return {
			get task() {
				return current;
			},
			async status(state, message) {
				current = await store.updateStatus(principal, current.id, {
					state,
					...(message ? { message } : {}),
				});
				emit(current.id, {
					statusUpdate: {
						taskId: current.id,
						contextId: current.contextId,
						status: current.status,
					},
				});
				return current;
			},
			async artifact(artifact) {
				current = await store.addArtifact(principal, current.id, artifact);
				emit(current.id, {
					artifactUpdate: { taskId: current.id, contextId: current.contextId, artifact },
				});
				return current;
			},
			async evidence(reference) {
				current = await store.addEvidenceReference(principal, current.id, reference);
				return current;
			},
		};
	};

	interface ExecutionOutcome {
		readonly response: A2aSendMessageResponse;
		readonly taskId?: string;
	}

	/**
	 * Takes the (principal, messageId) key or replays what it already holds.
	 * The claim and the prior-outcome read are one store operation, so two
	 * concurrent sends of the same messageId cannot both proceed to execute.
	 */
	const claimOrReplay = async (
		principal: string,
		message: A2aMessage,
	): Promise<ExecutionOutcome | undefined> => {
		const claim = await store.claimOutcome(principal, message);
		if (claim.kind === "claimed") return undefined;
		if (claim.kind === "inProgress") {
			// Do not wait on the in-flight send: holding the socket turns a
			// duplicate into a second unit of work on the server's clock. The
			// caller retries and gets the recorded outcome.
			throw new A2aError(
				409,
				"DUPLICATE_MESSAGE_IN_PROGRESS",
				`messageId "${message.messageId}" is already being processed; retry to read its outcome`,
			);
		}
		return claim.outcome.kind === "task"
			? {
					response: { task: await store.getTask(principal, claim.outcome.taskId) },
					taskId: claim.outcome.taskId,
				}
			: { response: { message: claim.outcome.message } };
	};

	const loadContinuation = async (
		principal: string,
		message: A2aMessage,
	): Promise<A2aTask | undefined> => {
		if (!message.taskId) return undefined;
		const existing = await store.getTask(principal, message.taskId);
		if (isTerminal(existing.status.state)) {
			throw new A2aError(
				400,
				"UNSUPPORTED_OPERATION",
				`task "${existing.id}" is in terminal state ${existing.status.state} and cannot continue`,
			);
		}
		if (message.contextId && message.contextId !== existing.contextId) {
			throw new A2aError(400, "INVALID_ARGUMENT", "contextId does not match the task's context");
		}
		return existing;
	};

	const executeSend = async (
		principal: string,
		request: A2aSendMessageRequest,
	): Promise<ExecutionOutcome> => {
		const message = validateMessage(request.message, "ROLE_USER");
		const replay = await claimOrReplay(principal, message);
		if (replay) return replay;
		let controller: A2aTaskController | undefined;
		try {
			const existing = await loadContinuation(principal, message);
			const begin = async (selectedTaskId?: string): Promise<A2aTaskController> => {
				if (controller) return controller;
				if (existing && selectedTaskId && selectedTaskId !== existing.id) {
					throw new A2aError(
						400,
						"INVALID_ARGUMENT",
						"executor task selection conflicts with message taskId",
					);
				}
				const bound = await store.bindClaimToTask(
					principal,
					message,
					existing?.id ?? selectedTaskId,
				);
				controller = controllerFor(principal, bound);
				emit(bound.id, { task: bound });
				return controller;
			};
			const context: A2aExecutorContext = {
				principal,
				message,
				...(existing ? { task: existing } : {}),
				begin,
				lookupTask: async (taskId) => store.lookupOwned(principal, taskId),
			};
			const direct = await executor(context);
			if (controller) return recordTaskOutcome(principal, message, controller.task.id);
			if (!direct) {
				throw new A2aError(500, "INTERNAL", "executor returned neither a task nor a message");
			}
			const reply: A2aMessage = {
				...direct,
				messageId: direct.messageId || randomUUID(),
				role: "ROLE_AGENT",
			};
			await store.recordOutcome(principal, message, { kind: "message", message: reply });
			return { response: { message: reply } };
		} catch (error) {
			if (!controller) {
				// Nothing was minted, so there is no outcome to replay. Keeping
				// the claim would 409 every retry of a message that never ran.
				await store.releaseClaim(principal, message.messageId);
				throw error;
			}
			// A task exists. Whatever the error kind, it must not stay
			// non-terminal: an unsettled task is invisible to the retry, which
			// would mint a second one. Settle it, fill in the claim so the retry
			// replays the failure, then let the error reach the client.
			await controller.status("TASK_STATE_FAILED").catch(() => undefined);
			await store.recordOutcome(principal, message, { kind: "task", taskId: controller.task.id });
			throw error;
		}
	};

	const recordTaskOutcome = async (
		principal: string,
		message: A2aMessage,
		taskId: string,
	): Promise<ExecutionOutcome> => {
		await store.recordOutcome(principal, message, { kind: "task", taskId });
		return { response: { task: await store.getTask(principal, taskId) }, taskId };
	};

	const waitUntilSettled = async (principal: string, taskId: string): Promise<A2aTask> => {
		const timeoutMs = config.blockingTimeoutMs ?? DEFAULT_BLOCKING_TIMEOUT_MS;
		const current = await store.getTask(principal, taskId);
		if (isSettled(current.status.state)) return current;
		return new Promise<A2aTask>((resolve) => {
			let done = false;
			let unsubscribe: () => void = () => {};
			const finish = async (): Promise<void> => {
				if (done) return;
				done = true;
				clearTimeout(timer);
				unsubscribe();
				blockingWaits.delete(stop);
				resolve(await store.getTask(principal, taskId).catch(() => current));
			};
			const stop = (): void => void finish();
			const timer = setTimeout(stop, timeoutMs);
			timer.unref();
			blockingWaits.add(stop);
			unsubscribe = subscribe(taskId, (event) => {
				if ("statusUpdate" in event && isSettled(event.statusUpdate.status.state)) {
					stop();
				}
			});
			// An update that landed between the snapshot read and subscribe()
			// would otherwise sleep the full timeout; re-check the durable state.
			void store
				.getTask(principal, taskId)
				.then((task) => {
					if (isSettled(task.status.state)) stop();
				})
				.catch(stop);
		});
	};

	const card = {
		name: config.agentName,
		description: config.agentDescription,
		supportedInterfaces: [
			{
				url: config.publicUrl,
				protocolBinding: "HTTP+JSON",
				protocolVersion: A2A_PROTOCOL_VERSION,
			},
		],
		version: config.agentVersion,
		capabilities: {
			streaming: true,
			pushNotifications: false,
			extensions: [
				{
					uri: OUTFITTER_TASK_EXTENSION_URI,
					description:
						"Ticket Run lineage, scoped task locators, retry/supersession links, and idempotency data for Outfitter-coordinated work.",
					required: false,
				},
				{
					uri: OUTFITTER_ARTIFACT_EXTENSION_URI,
					description:
						"Authenticated content-addressed Artifact URLs with SHA-256 and byte-size metadata.",
					required: false,
				},
			],
		},
		securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "bearer" } } },
		securityRequirements: [{ schemes: { bearer: { list: [] } } }],
		defaultInputModes: [A2A_MEDIA_TYPE, "text/plain"],
		defaultOutputModes: [A2A_MEDIA_TYPE, "text/plain"],
		skills: [],
	};

	const server = createServer((request, response) => {
		handle(request, response).catch((error) => {
			const a2aError =
				error instanceof A2aError ? error : new A2aError(500, "INTERNAL", "internal server error");
			if (!response.headersSent) {
				response.writeHead(a2aError.httpStatus, { "content-type": A2A_MEDIA_TYPE });
			}
			response.end(JSON.stringify(a2aError.body()));
		});
	});

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one route table over the binding's annotated paths
	const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
		const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
		const path = url.pathname;
		if (request.method === "GET" && path === AGENT_CARD_PATH) {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify(card));
			return;
		}
		requireSupportedVersion(request);
		const principal = authenticate(request, config.credentials);
		if (request.method === "POST" && path === "/artifacts") {
			const body = (await readJsonBody(request, MAX_LARGE_ARTIFACT_BYTES * 2)) as {
				raw?: string;
				mediaType?: string;
				filename?: string;
			};
			if (typeof body.raw !== "string" || typeof body.mediaType !== "string") {
				throw new A2aError(400, "INVALID_ARGUMENT", "artifact raw and mediaType are required");
			}
			const bytes = decodeCanonicalBase64(body.raw);
			const reference = await artifacts.put(bytes, body.mediaType, body.filename);
			response.writeHead(201, { "content-type": A2A_MEDIA_TYPE });
			response.end(
				JSON.stringify({
					artifact: {
						artifactId: `artifact-${reference.digest.slice(7, 31)}`,
						parts: [
							{
								url: reference.url,
								mediaType: reference.mediaType,
								...(reference.filename ? { filename: reference.filename } : {}),
								metadata: {
									[OUTFITTER_ARTIFACT_METADATA_KEY]: {
										digest: reference.digest,
										byteSize: reference.byteSize,
									},
								},
							},
						],
						extensions: [OUTFITTER_ARTIFACT_EXTENSION_URI],
					},
				}),
			);
			return;
		}
		const artifactMatch = path.match(/^\/artifacts\/([0-9a-f]{64})$/);
		if (request.method === "GET" && artifactMatch) {
			const bytes = await artifacts.get(artifactMatch[1] as string).catch((error) => {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					throw new A2aError(404, "NOT_FOUND", "artifact not found");
				}
				throw error;
			});
			response.writeHead(200, {
				"content-type": "application/octet-stream",
				"content-length": bytes.byteLength,
				digest: `sha-256=${Buffer.from(artifactMatch[1] as string, "hex").toString("base64")}`,
			});
			response.end(bytes);
			return;
		}
		if (request.method === "POST" && path === "/message:send") {
			const body = (await readJsonBody(request)) as A2aSendMessageRequest;
			const outcome = await executeSend(principal, body);
			const blocking = body.configuration?.returnImmediately !== true;
			const payload =
				blocking && outcome.taskId
					? { task: await waitUntilSettled(principal, outcome.taskId) }
					: outcome.response;
			response.writeHead(200, { "content-type": A2A_MEDIA_TYPE });
			response.end(JSON.stringify(payload));
			return;
		}
		if (request.method === "POST" && path === "/message:stream") {
			const body = (await readJsonBody(request)) as A2aSendMessageRequest;
			// Execute BEFORE the stream opens. Opening first commits a 200 and
			// the SSE content type, so every error — a duplicate payload, an
			// unknown task, an executor failure — became an empty stream that
			// closed, which a client cannot tell apart from success. With the
			// stream opened after, those errors take the normal HTTP error path.
			const outcome = await executeSend(principal, body);
			openEventStream(response);
			const forward = (event: A2aStreamResponse): void => {
				response.write(`data: ${JSON.stringify(event)}\n\n`);
			};
			forward(outcome.response);
			if (!outcome.taskId) {
				response.end();
				return;
			}
			const snapshot = await store.getTask(principal, outcome.taskId);
			if (isSettled(snapshot.status.state)) {
				response.end();
				return;
			}
			const unsubscribe = subscribe(outcome.taskId, (event) => {
				forward(event);
				if ("statusUpdate" in event && isSettled(event.statusUpdate.status.state)) {
					unsubscribe();
					response.end();
				}
			});
			request.on("close", unsubscribe);
			return;
		}
		if (request.method === "GET" && path === "/tasks") {
			const contextId = url.searchParams.get("contextId");
			const status = url.searchParams.get("status") as A2aTaskState | null;
			const statusTimestampAfter = url.searchParams.get("statusTimestampAfter");
			const pageSize = integerParam(url, "pageSize");
			const historyLength = integerParam(url, "historyLength");
			const pageToken = url.searchParams.get("pageToken");
			const page = await store.listTasks(principal, {
				...(contextId === null ? {} : { contextId }),
				...(status === null ? {} : { status }),
				...(statusTimestampAfter === null ? {} : { statusTimestampAfter }),
				...(pageSize === undefined ? {} : { pageSize }),
				...(historyLength === undefined ? {} : { historyLength }),
				...(pageToken === null ? {} : { pageToken }),
				includeArtifacts: url.searchParams.get("includeArtifacts") === "true",
			});
			response.writeHead(200, { "content-type": A2A_MEDIA_TYPE });
			response.end(JSON.stringify(page));
			return;
		}
		const subscribeMatch = path.match(/^\/tasks\/([^/:]+):subscribe$/);
		// The authoritative proto annotation maps SubscribeToTask to GET; the
		// v1.0.1 prose said POST, and upstream a2aproject/A2A#2068 corrects the
		// prose to GET. GET is also the only method a browser-native
		// EventSource can issue.
		if (request.method === "GET" && subscribeMatch) {
			const task = await store.getTask(principal, subscribeMatch[1] as string);
			if (isTerminal(task.status.state)) {
				throw new A2aError(
					400,
					"UNSUPPORTED_OPERATION",
					`task "${task.id}" is in terminal state ${task.status.state}`,
				);
			}
			openEventStream(response);
			const unsubscribe = subscribe(task.id, (event) => {
				response.write(`data: ${JSON.stringify(event)}\n\n`);
				if ("statusUpdate" in event && isTerminal(event.statusUpdate.status.state)) {
					unsubscribe();
					response.end();
				}
			});
			request.on("close", unsubscribe);
			return;
		}
		const cancelMatch = path.match(/^\/tasks\/([^/:]+):cancel$/);
		if (request.method === "POST" && cancelMatch) {
			const task = await store.getTask(principal, cancelMatch[1] as string);
			if (isTerminal(task.status.state)) {
				throw new A2aError(
					400,
					"TASK_NOT_CANCELABLE",
					`task "${task.id}" is already in terminal state ${task.status.state}`,
				);
			}
			const canceled = await store.updateStatus(principal, task.id, {
				state: "TASK_STATE_CANCELED",
			});
			emit(task.id, {
				statusUpdate: { taskId: task.id, contextId: task.contextId, status: canceled.status },
			});
			response.writeHead(200, { "content-type": A2A_MEDIA_TYPE });
			response.end(JSON.stringify(canceled));
			return;
		}
		const taskMatch = path.match(/^\/tasks\/([^/:]+)$/);
		if (request.method === "GET" && taskMatch) {
			const historyLength = integerParam(url, "historyLength");
			const task = await store.getTask(principal, taskMatch[1] as string);
			response.writeHead(200, { "content-type": A2A_MEDIA_TYPE });
			response.end(
				JSON.stringify(historyLength === undefined ? task : trimTask(task, historyLength, true)),
			);
			return;
		}
		if (path.includes("/pushNotificationConfigs")) {
			throw new A2aError(
				501,
				"PUSH_NOTIFICATION_NOT_SUPPORTED",
				"push notifications are not supported; the Agent Card declares pushNotifications: false",
			);
		}
		throw new A2aError(404, "NOT_FOUND", `no route for ${request.method} ${path}`);
	};

	if (config.listen !== false) {
		try {
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(config.port, config.host, () => {
					server.removeListener("error", reject);
					resolve();
				});
			});
		} catch (error) {
			store.close();
			await releaseLease();
			throw error;
		}
	}
	const address = server.address();
	const actualPort = typeof address === "object" && address ? address.port : config.port;
	return {
		url: `http://${config.host}:${actualPort}`,
		submit: async (principal, request) => (await executeSend(principal, request)).response,
		readTask: async (taskId) => (await store.lookup(taskId))?.task,
		controllerForTask: async (taskId) => {
			const stored = await store.lookup(taskId);
			return stored ? controllerFor(stored.principal, stored.task) : undefined;
		},
		recoverableTaskControllers: async () =>
			(await store.listRecoverable()).map((stored) => controllerFor(stored.principal, stored.task)),
		close: async () => {
			for (const stop of blockingWaits) stop();
			blockingWaits.clear();
			store.close();
			if (server.listening)
				await new Promise<void>((resolve, reject) => {
					server.closeAllConnections();
					server.close((error) => (error ? reject(error) : resolve()));
				});
			await releaseLease();
		},
	};
}

/**
 * Fail-closed startup validation, mirroring the relay server's
 * validateServerConfig. Every principal that reaches the store must satisfy
 * the same identifier rule the store applies when it parses its file back:
 * a principal accepted here but rejected on parse records tasks durably and
 * then makes the server permanently unstartable. Tokens must also be unique,
 * or two entries silently collapse onto whichever principal is listed first.
 */
export function validateA2aServerConfig(config: A2aServerConfig): void {
	if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65_535) {
		throw new Error("a2a port is invalid");
	}
	if (!/^sha256:[0-9a-f]{64}$/.test(config.policyDigest)) {
		throw new Error("a2a policyDigest must be a SHA-256 digest");
	}
	if (!config.artifactStorePath.startsWith("/")) {
		throw new Error("a2a artifactStorePath must be absolute");
	}
	const tokens = new Set<string>();
	for (const credential of config.credentials) {
		if (!credential.token) throw new Error("a2a credential token is required");
		if (tokens.has(credential.token)) throw new Error("a2a credential tokens must be unique");
		tokens.add(credential.token);
		validateIdentifier(credential.principal, "principal");
		if (credential.principal.startsWith("source:")) {
			throw new Error('a2a credential principal must not use the reserved "source:" prefix');
		}
	}
}

function requireSupportedVersion(request: IncomingMessage): void {
	const requested = request.headers[A2A_VERSION_HEADER];
	const value = Array.isArray(requested) ? requested[0] : requested;
	if (value !== undefined && value.trim() !== A2A_PROTOCOL_VERSION) {
		throw new A2aError(
			400,
			"VERSION_NOT_SUPPORTED",
			`A2A protocol version "${value}" is not supported; supported versions: ${A2A_PROTOCOL_VERSION}`,
		);
	}
}

function authenticate(request: IncomingMessage, credentials: readonly A2aCredential[]): string {
	const credential = findBearerCredential(request.headers.authorization, credentials);
	if (!credential) {
		throw new A2aError(401, "UNAUTHENTICATED", "a valid bearer token is required");
	}
	return credential.principal;
}

function openEventStream(response: ServerResponse): void {
	response.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});
	response.flushHeaders();
}

function integerParam(url: URL, name: string): number | undefined {
	const raw = url.searchParams.get(name);
	if (raw === null) return undefined;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new A2aError(400, "INVALID_ARGUMENT", `${name} must be a non-negative integer`);
	}
	return value;
}

function decodeCanonicalBase64(value: string): Buffer {
	const bytes = Buffer.from(value, "base64");
	if (bytes.toString("base64") !== value) {
		throw new A2aError(400, "INVALID_ARGUMENT", "artifact raw must be canonical base64");
	}
	return bytes;
}

async function readJsonBody(request: IncomingMessage, maximum = 1024 * 1024): Promise<unknown> {
	const text = await readBoundedBody(
		request,
		maximum,
		() => new A2aError(413, "INVALID_ARGUMENT", "request body too large"),
	);
	return parseJson(text, () => new A2aError(400, "INVALID_ARGUMENT", "request body must be JSON"));
}

export async function configFromEnv(
	defaultPolicyDigest?: string,
	listen = true,
): Promise<A2aServerConfig> {
	const root = defaultTaskPlaneRoot();
	const storePath = process.env.A2A_STORE_PATH?.trim() || join(root, "tasks.json");
	const credentials = await credentialsFromEnv(listen);
	const host = process.env.A2A_HOST?.trim() || "127.0.0.1";
	const port = Number(process.env.A2A_PORT ?? "8788");
	const agentName =
		process.env.A2A_AGENT_NAME?.trim() || process.env.AGENT_NAME?.trim() || "channels-agent";
	const policyDigest = process.env.A2A_POLICY_BUNDLE_DIGEST?.trim() || defaultPolicyDigest;
	if (!policyDigest) throw new Error("A2A_POLICY_BUNDLE_DIGEST is required");
	const artifactStorePath = process.env.A2A_ARTIFACT_STORE_PATH?.trim() || join(root, "artifacts");
	const config: A2aServerConfig = {
		host,
		port,
		storePath,
		credentials,
		agentName,
		agentDescription:
			process.env.A2A_AGENT_DESCRIPTION?.trim() ||
			"Channels-hosted agent reachable over the A2A task plane.",
		publicUrl: process.env.A2A_PUBLIC_URL?.trim() || `http://${host}:${port}`,
		agentVersion: process.env.A2A_AGENT_VERSION?.trim() || "0.0.0",
		policyDigest,
		artifactStorePath,
		listen,
	};
	// Fail here as well as in startA2aServer, so a bad credentials file names
	// itself at load time rather than at listen time.
	validateA2aServerConfig(config);
	return config;
}

/**
 * One deployment layout for every task-plane artifact — tasks, artifacts,
 * origins, evidence. Exported so the extension and the evidence runtime derive
 * their paths from here instead of restating the layout.
 */
export function defaultTaskPlaneRoot(): string {
	const home = process.env.HOME?.trim();
	if (!home || !isAbsolute(home)) throw new Error("HOME must be an absolute path");
	return join(home, ".channels", "task-plane");
}

async function credentialsFromEnv(listen: boolean): Promise<readonly A2aCredential[]> {
	const path = process.env.A2A_CREDENTIALS_PATH?.trim();
	if (!path) {
		if (listen) {
			throw new Error("A2A_CREDENTIALS_PATH is required when the external A2A listener is enabled");
		}
		return [];
	}
	const document = JSON.parse(await readFile(path, "utf8")) as {
		credentials?: A2aCredential[];
	};
	if (!Array.isArray(document.credentials)) {
		throw new Error("a2a credentials file must contain a credentials array");
	}
	return document.credentials;
}
