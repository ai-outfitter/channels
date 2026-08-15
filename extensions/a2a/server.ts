import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
	/** Upper bound for a blocking send before it returns the current snapshot. */
	readonly blockingTimeoutMs?: number;
}

/** Controller handed to the executor once it decides the message is work. */
export interface A2aTaskController {
	readonly task: A2aTask;
	status(state: A2aTaskState, message?: A2aMessage): Promise<A2aTask>;
	artifact(artifact: A2aArtifact): Promise<A2aTask>;
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
	begin(): Promise<A2aTaskController>;
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
	close(): Promise<void>;
	/**
	 * Server-side task access for the hosting session's own tools. This
	 * bypasses client authentication deliberately: the resident agent IS the
	 * server, so its tools act as the owner of every task the server holds.
	 */
	readTask(taskId: string): Promise<A2aTask | undefined>;
	controllerForTask(taskId: string): Promise<A2aTaskController | undefined>;
}

const DEFAULT_BLOCKING_TIMEOUT_MS = 60_000;

type Subscriber = (event: A2aStreamResponse) => void;

export async function startA2aServer(
	config: A2aServerConfig,
	executor: A2aExecutor,
	sharedStore?: A2aTaskStore,
): Promise<RunningA2aServer> {
	const store = sharedStore ?? new A2aTaskStore(config.storePath);
	await store.initialize();
	const subscribers = new Map<string, Set<Subscriber>>();

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
		};
	};

	interface ExecutionOutcome {
		readonly response: A2aSendMessageResponse;
		readonly taskId?: string;
	}

	const replayPrior = async (
		principal: string,
		message: A2aMessage,
	): Promise<ExecutionOutcome | undefined> => {
		const prior = await store.priorOutcome(principal, message);
		if (!prior) return undefined;
		return prior.kind === "task"
			? { response: { task: await store.getTask(principal, prior.taskId) }, taskId: prior.taskId }
			: { response: { message: prior.message } };
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
		return store.appendHistory(principal, existing.id, message);
	};

	const mintTask = async (principal: string, message: A2aMessage): Promise<A2aTask> => {
		const task = await store.createTask(principal, message.contextId);
		return store.appendHistory(principal, task.id, {
			...message,
			taskId: task.id,
			contextId: task.contextId,
		});
	};

	const executeSend = async (
		principal: string,
		request: A2aSendMessageRequest,
	): Promise<ExecutionOutcome> => {
		const message = validateMessage(request.message, "ROLE_USER");
		const replay = await replayPrior(principal, message);
		if (replay) return replay;
		const existing = await loadContinuation(principal, message);
		let controller: A2aTaskController | undefined;
		const begin = async (): Promise<A2aTaskController> => {
			if (controller) return controller;
			const bound = existing ?? (await mintTask(principal, message));
			controller = controllerFor(principal, bound);
			emit(bound.id, { task: bound });
			return controller;
		};
		const context: A2aExecutorContext = {
			principal,
			message,
			...(existing ? { task: existing } : {}),
			begin,
		};
		try {
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
			if (!controller || error instanceof A2aError) throw error;
			const failed = await controller
				.status("TASK_STATE_FAILED")
				.catch(() => controller?.task as A2aTask);
			return recordTaskOutcome(principal, message, failed.id);
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
			let unsubscribe: () => void = () => {};
			const timer = setTimeout(async () => {
				unsubscribe();
				resolve(await store.getTask(principal, taskId));
			}, timeoutMs);
			const settleNow = (): void => {
				clearTimeout(timer);
				unsubscribe();
				store.getTask(principal, taskId).then(resolve);
			};
			unsubscribe = subscribe(taskId, (event) => {
				if ("statusUpdate" in event && isSettled(event.statusUpdate.status.state)) {
					settleNow();
				}
			});
			// An update that landed between the snapshot read and subscribe()
			// would otherwise sleep the full timeout; re-check the durable state.
			store.getTask(principal, taskId).then((task) => {
				if (isSettled(task.status.state)) settleNow();
			});
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
			openEventStream(response);
			const forward = (event: A2aStreamResponse): void => {
				response.write(`data: ${JSON.stringify(event)}\n\n`);
			};
			const outcome = await executeSend(principal, body);
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
			const tasks = await store.listTasks(principal, {
				...(contextId === null ? {} : { contextId }),
				...(status === null ? {} : { status }),
				...(statusTimestampAfter === null ? {} : { statusTimestampAfter }),
				...(pageSize === undefined ? {} : { pageSize }),
				...(historyLength === undefined ? {} : { historyLength }),
				includeArtifacts: url.searchParams.get("includeArtifacts") === "true",
			});
			response.writeHead(200, { "content-type": A2A_MEDIA_TYPE });
			response.end(JSON.stringify({ tasks, nextPageToken: "" }));
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

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(config.port, config.host, () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
	const address = server.address();
	const actualPort = typeof address === "object" && address ? address.port : config.port;
	return {
		url: `http://${config.host}:${actualPort}`,
		readTask: async (taskId) => (await store.lookup(taskId))?.task,
		controllerForTask: async (taskId) => {
			const stored = await store.lookup(taskId);
			return stored ? controllerFor(stored.principal, stored.task) : undefined;
		},
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.closeAllConnections();
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
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
	const header = request.headers.authorization ?? "";
	const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
	const credential = token && credentials.find((entry) => entry.token === token);
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

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		size += (chunk as Buffer).length;
		if (size > 1024 * 1024) throw new A2aError(413, "INVALID_ARGUMENT", "request body too large");
		chunks.push(chunk as Buffer);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new A2aError(400, "INVALID_ARGUMENT", "request body must be JSON");
	}
}

export async function configFromEnv(): Promise<A2aServerConfig> {
	// The task plane's whole config surface is A2A_*; absent configuration
	// means the extension stays inert. The composed runtime injects its shared
	// Task store, so the legacy path is retained only as compatibility metadata.
	const storePath = process.env.A2A_STORE_PATH?.trim() ?? "";
	const credentialsPath = process.env.A2A_CREDENTIALS_PATH?.trim();
	if (!credentialsPath) throw new Error("A2A_CREDENTIALS_PATH is required");
	const credentialsDocument = JSON.parse(await readFile(credentialsPath, "utf8")) as {
		credentials?: A2aCredential[];
	};
	if (!Array.isArray(credentialsDocument.credentials)) {
		throw new Error("a2a credentials file must contain a credentials array");
	}
	const host = process.env.A2A_HOST?.trim() || "127.0.0.1";
	const port = Number(process.env.A2A_PORT ?? "8788");
	return {
		host,
		port,
		storePath,
		credentials: credentialsDocument.credentials,
		agentName: process.env.A2A_AGENT_NAME?.trim() || "channels-agent",
		agentDescription:
			process.env.A2A_AGENT_DESCRIPTION?.trim() ||
			"Channels-hosted agent reachable over the A2A task plane.",
		publicUrl: process.env.A2A_PUBLIC_URL?.trim() || `http://${host}:${port}`,
		agentVersion: process.env.A2A_AGENT_VERSION?.trim() || "0.0.0",
	};
}
