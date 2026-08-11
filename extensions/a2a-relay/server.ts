import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
	createServer as createHttpServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import {
	type A2aServerConfig,
	configFromEnv as a2aConfigFromEnv,
	type RunningA2aServer,
	startA2aServer,
} from "../a2a/server.ts";
import {
	A2A_MEDIA_TYPE,
	A2A_PROTOCOL_VERSION,
	A2aError,
	type A2aMessage,
	type A2aTaskState,
	isSettled,
	TASK_STATES,
	validateArtifact,
	validateIdentifier,
	validateMessage,
} from "../a2a/types.ts";
import { OriginRouter } from "../origins/router.ts";
import { OriginStore } from "../origins/store.ts";
import type { TaskLocator } from "../origins/types.ts";
import { type A2aRelayDelivery, A2aRelayStore } from "./store.ts";

const MAX_CONNECTOR_BODY_BYTES = 256 * 1024;
const DEFAULT_LEASE_MS = 15 * 60 * 1000;
const WORKER_STATUS_STATES: readonly A2aTaskState[] = [
	"TASK_STATE_WORKING",
	"TASK_STATE_COMPLETED",
	"TASK_STATE_FAILED",
	"TASK_STATE_INPUT_REQUIRED",
	"TASK_STATE_REJECTED",
	"TASK_STATE_AUTH_REQUIRED",
];

export interface A2aRelayWorkerCredential {
	readonly token: string;
	readonly worker: string;
	readonly agentIds: readonly string[];
}

export interface A2aRelayServerConfig {
	readonly agentId: string;
	readonly queuePath: string;
	readonly originStorePath: string;
	readonly a2a: A2aServerConfig;
	readonly connectorHost: string;
	readonly connectorPort: number;
	readonly workerCredentials: readonly A2aRelayWorkerCredential[];
	readonly connectorTls?: { readonly key: string | Buffer; readonly cert: string | Buffer };
	readonly allowInsecureLoopback?: boolean;
	readonly leaseMs?: number;
}

export interface RunningA2aRelayServer {
	readonly a2aUrl: string;
	readonly connectorUrl: string;
	close(): Promise<void>;
}

export async function a2aRelayConfigFromEnv(): Promise<A2aRelayServerConfig> {
	const agentId = process.env.A2A_RELAY_AGENT_ID?.trim();
	if (!agentId) throw new Error("A2A_RELAY_AGENT_ID is required");
	const queuePath = process.env.A2A_RELAY_QUEUE_PATH?.trim();
	if (!queuePath) throw new Error("A2A_RELAY_QUEUE_PATH is required");
	const originStorePath = process.env.A2A_RELAY_ORIGIN_STORE_PATH?.trim();
	if (!originStorePath) throw new Error("A2A_RELAY_ORIGIN_STORE_PATH is required");
	const credentialsPath = process.env.A2A_RELAY_WORKER_CREDENTIALS_PATH?.trim();
	if (!credentialsPath) throw new Error("A2A_RELAY_WORKER_CREDENTIALS_PATH is required");
	const document = JSON.parse(await readFile(credentialsPath, "utf8")) as {
		workerCredentials?: A2aRelayWorkerCredential[];
	};
	if (!Array.isArray(document.workerCredentials)) {
		throw new Error("A2A relay worker credentials file must contain a workerCredentials array");
	}
	const keyPath = process.env.A2A_RELAY_TLS_KEY_PATH?.trim();
	const certPath = process.env.A2A_RELAY_TLS_CERT_PATH?.trim();
	if (Boolean(keyPath) !== Boolean(certPath)) {
		throw new Error("A2A relay connector TLS key and certificate paths must be set together");
	}
	const config: A2aRelayServerConfig = {
		agentId,
		queuePath,
		originStorePath,
		a2a: await a2aConfigFromEnv(),
		connectorHost: process.env.A2A_RELAY_HOST?.trim() || "127.0.0.1",
		connectorPort: Number(process.env.A2A_RELAY_PORT ?? "8789"),
		workerCredentials: document.workerCredentials,
		...(keyPath && certPath
			? { connectorTls: { key: await readFile(keyPath), cert: await readFile(certPath) } }
			: {}),
		allowInsecureLoopback: parseBoolean(process.env.A2A_RELAY_ALLOW_INSECURE_LOOPBACK),
		...(process.env.A2A_RELAY_LEASE_MS ? { leaseMs: Number(process.env.A2A_RELAY_LEASE_MS) } : {}),
	};
	validateConfig(config);
	return config;
}

interface WorkerContext {
	readonly worker: string;
	readonly agentIds: readonly string[];
}

export async function startA2aRelayServer(
	config: A2aRelayServerConfig,
): Promise<RunningA2aRelayServer> {
	validateConfig(config);
	const queue = new A2aRelayStore(config.queuePath);
	const origins = new OriginStore(config.originStorePath);
	await queue.initialize();
	await origins.initialize();
	const router = new OriginRouter(origins, config.a2a.publicUrl);
	let a2a: RunningA2aServer;
	try {
		a2a = await startA2aServer(config.a2a, async (context) => {
			const controller = await router.route(context);
			await queue.enqueue(controller.task.id, config.agentId);
			return undefined;
		});
	} catch (error) {
		queue.close();
		origins.close();
		throw error;
	}
	try {
		for (const controller of await a2a.recoverableTaskControllers()) {
			await queue.enqueue(controller.task.id, config.agentId);
		}
		const connector = await startConnector(config, a2a, queue, origins);
		return {
			a2aUrl: a2a.url,
			connectorUrl: connector.url,
			async close() {
				await connector.close();
				await a2a.close();
				queue.close();
				origins.close();
			},
		};
	} catch (error) {
		await a2a.close();
		queue.close();
		origins.close();
		throw error;
	}
}

async function startConnector(
	config: A2aRelayServerConfig,
	a2a: RunningA2aServer,
	queue: A2aRelayStore,
	origins: OriginStore,
): Promise<{ readonly url: string; close(): Promise<void> }> {
	const leaseMs = config.leaseMs ?? DEFAULT_LEASE_MS;
	const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
		try {
			await handleConnectorRequest(request, response, config, a2a, queue, origins, leaseMs);
		} catch (error) {
			const connectorError = normalizeError(error);
			writeJson(response, connectorError.status, {
				error: { code: connectorError.code, message: connectorError.message },
			});
		}
	};
	const server = config.connectorTls
		? createHttpsServer(
				{ key: config.connectorTls.key, cert: config.connectorTls.cert },
				(req, res) => {
					void handle(req, res);
				},
			)
		: createHttpServer((req, res) => {
				void handle(req, res);
			});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(config.connectorPort, config.connectorHost, () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address() as AddressInfo;
	const scheme = config.connectorTls ? "https" : "http";
	return {
		url: `${scheme}://${formatHost(config.connectorHost)}:${address.port}`,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.closeAllConnections();
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
}

async function handleConnectorRequest(
	request: IncomingMessage,
	response: ServerResponse,
	config: A2aRelayServerConfig,
	a2a: RunningA2aServer,
	queue: A2aRelayStore,
	origins: OriginStore,
	leaseMs: number,
): Promise<void> {
	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
	if (request.method === "GET" && url.pathname === "/healthz") {
		writeJson(response, 200, { status: "ok" });
		return;
	}
	if (url.pathname.startsWith("/v1/trace/")) {
		await handleTrace(request, response, url.pathname, config, origins);
		return;
	}
	const worker = authenticate(request, config.workerCredentials);
	if (request.method === "GET" && url.pathname === "/v1/tasks:claim") {
		await handleClaim(response, queue, a2a, worker, leaseMs);
		return;
	}
	const match = url.pathname.match(
		/^\/v1\/tasks\/([^/:]+)(?::(renew|release|status|artifact|evidence))?$/,
	);
	if (!match) throw new ConnectorError(404, "not_found", "connector route was not found");
	const leaseId = request.headers["x-a2a-relay-lease"];
	if (typeof leaseId !== "string") {
		throw new ConnectorError(401, "lease_required", "x-a2a-relay-lease is required");
	}
	const taskId = validateIdentifier(match[1], "task id");
	await requireLease(queue, taskId, worker.worker, leaseId);
	await handleTaskRequest(
		request,
		response,
		a2a,
		queue,
		worker.worker,
		taskId,
		leaseId,
		match[2],
		leaseMs,
	);
}

async function handleTrace(
	request: IncomingMessage,
	response: ServerResponse,
	path: string,
	config: A2aRelayServerConfig,
	origins: OriginStore,
): Promise<void> {
	const principal = authenticateTrace(request, config.a2a.credentials);
	const allowed = new Set([principal]);
	const activationMatch = path.match(/^\/v1\/trace\/activations\/([^/]+)$/);
	if (request.method === "GET" && activationMatch) {
		const trace = await origins.activationTrace(
			allowed,
			decodePathSegment(activationMatch[1] as string),
		);
		if (!trace) throw new ConnectorError(404, "trace_not_found", "trace was not found");
		writeJson(response, 200, trace);
		return;
	}
	const taskMatch = path.match(/^\/v1\/trace\/tasks\/([^/]+)$/);
	if (request.method === "GET" && taskMatch) {
		const task = traceTask(config, taskMatch[1] as string);
		const trace = await origins.taskTrace(allowed, task);
		if (!trace) throw new ConnectorError(404, "trace_not_found", "trace was not found");
		writeJson(response, 200, trace);
		return;
	}
	const deliveryMatch = path.match(/^\/v1\/trace\/tasks\/([^/]+)\/delivery$/);
	if (request.method === "POST" && deliveryMatch) {
		await handleDeliveryTrace(
			request,
			response,
			config,
			origins,
			allowed,
			deliveryMatch[1] as string,
		);
		return;
	}
	throw new ConnectorError(404, "trace_not_found", "trace was not found");
}

async function handleDeliveryTrace(
	request: IncomingMessage,
	response: ServerResponse,
	config: A2aRelayServerConfig,
	origins: OriginStore,
	allowed: ReadonlySet<string>,
	encodedTaskId: string,
): Promise<void> {
	const task = traceTask(config, encodedTaskId);
	const trace = await origins.taskTrace(allowed, task);
	if (!trace) throw new ConnectorError(404, "trace_not_found", "trace was not found");
	const body = await readJsonBody(request);
	const sourceKind = requiredString(body.sourceKind, "sourceKind");
	const providerEventId = requiredString(body.providerEventId, "providerEventId");
	const matched = trace.origins.find(
		(entry) =>
			entry.activation.sourceKind === sourceKind &&
			entry.activation.providerEventId === providerEventId,
	);
	if (!matched) throw new ConnectorError(404, "trace_not_found", "activation was not found");
	const delivery = await origins.recordDelivery(matched.activation.id, task, {
		state: deliveryState(body.state),
		attemptCount: nonNegativeInteger(body.attemptCount, "attemptCount"),
		...(body.responseId === undefined
			? {}
			: { responseId: requiredString(body.responseId, "responseId") }),
		...(body.errorCode === undefined
			? {}
			: { errorCode: requiredString(body.errorCode, "errorCode") }),
	});
	writeJson(response, 200, delivery);
}

function traceTask(config: A2aRelayServerConfig, encodedTaskId: string): TaskLocator {
	return {
		agentInterface: config.a2a.publicUrl,
		protocolBinding: "HTTP+JSON",
		protocolVersion: A2A_PROTOCOL_VERSION,
		taskId: validateIdentifier(decodePathSegment(encodedTaskId), "task id"),
	};
}

function deliveryState(value: unknown): "pending" | "delivered" | "failed" | "not-applicable" {
	if (
		value === "pending" ||
		value === "delivered" ||
		value === "failed" ||
		value === "not-applicable"
	) {
		return value;
	}
	throw new ConnectorError(400, "invalid_delivery", "native delivery state is invalid");
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 512) {
		throw new ConnectorError(400, "invalid_delivery", `${label} must contain 1-512 characters`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new ConnectorError(400, "invalid_delivery", `${label} must be a non-negative integer`);
	}
	return value as number;
}

function decodePathSegment(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		throw new ConnectorError(400, "invalid_path", "trace path identifier is invalid");
	}
}

async function handleClaim(
	response: ServerResponse,
	queue: A2aRelayStore,
	a2a: RunningA2aServer,
	worker: WorkerContext,
	leaseMs: number,
): Promise<void> {
	const claim = await claimRunnable(queue, a2a, worker, leaseMs);
	if (!claim) {
		response.writeHead(204);
		response.end();
		return;
	}
	writeJson(response, 200, claim);
}

async function handleTaskRequest(
	request: IncomingMessage,
	response: ServerResponse,
	a2a: RunningA2aServer,
	queue: A2aRelayStore,
	worker: string,
	taskId: string,
	leaseId: string,
	action: string | undefined,
	leaseMs: number,
): Promise<void> {
	const route = `${request.method}:${action ?? "read"}`;
	switch (route) {
		case "GET:read":
			return readWorkerTask(response, a2a, queue, worker, taskId, leaseId);
		case "POST:renew":
			return renewWorkerTask(response, queue, worker, taskId, leaseId, leaseMs);
		case "POST:release":
			return releaseWorkerTask(response, a2a, queue, worker, taskId, leaseId);
		case "POST:status":
			return updateWorkerStatus(request, response, a2a, queue, worker, taskId, leaseId);
		case "POST:artifact":
			return addWorkerArtifact(request, response, a2a, taskId);
		case "POST:evidence":
			return addWorkerEvidence(request, response, a2a, taskId);
		default:
			throw new ConnectorError(405, "method_not_allowed", "connector method is not allowed");
	}
}

async function readWorkerTask(
	response: ServerResponse,
	a2a: RunningA2aServer,
	queue: A2aRelayStore,
	worker: string,
	taskId: string,
	leaseId: string,
): Promise<void> {
	const task = await a2a.readTask(taskId);
	if (!task) throw new ConnectorError(404, "task_not_found", "task was not found");
	if (isSettled(task.status.state)) await queue.finish(taskId, worker, leaseId);
	writeJson(response, 200, task);
}

async function renewWorkerTask(
	response: ServerResponse,
	queue: A2aRelayStore,
	worker: string,
	taskId: string,
	leaseId: string,
	leaseMs: number,
): Promise<void> {
	writeJson(response, 200, await queue.renew(taskId, worker, leaseId, leaseMs));
}

async function releaseWorkerTask(
	response: ServerResponse,
	a2a: RunningA2aServer,
	queue: A2aRelayStore,
	worker: string,
	taskId: string,
	leaseId: string,
): Promise<void> {
	const controller = await requireController(a2a, taskId);
	if (!isSettled(controller.task.status.state)) await controller.status("TASK_STATE_SUBMITTED");
	await queue.release(taskId, worker, leaseId);
	writeJson(response, 200, { released: true });
}

async function updateWorkerStatus(
	request: IncomingMessage,
	response: ServerResponse,
	a2a: RunningA2aServer,
	queue: A2aRelayStore,
	worker: string,
	taskId: string,
	leaseId: string,
): Promise<void> {
	const body = await readJsonBody(request);
	const controller = await requireController(a2a, taskId);
	const task = await controller.status(statusState(body), statusMessage(body));
	if (isSettled(task.status.state)) await queue.finish(taskId, worker, leaseId);
	writeJson(response, 200, task);
}

async function addWorkerArtifact(
	request: IncomingMessage,
	response: ServerResponse,
	a2a: RunningA2aServer,
	taskId: string,
): Promise<void> {
	const body = await readJsonBody(request);
	const controller = await requireController(a2a, taskId);
	writeJson(response, 200, await controller.artifact(validateArtifact(body.artifact)));
}

async function addWorkerEvidence(
	request: IncomingMessage,
	response: ServerResponse,
	a2a: RunningA2aServer,
	taskId: string,
): Promise<void> {
	const controller = await requireController(a2a, taskId);
	const body = await readJsonBody(request);
	if (typeof body.reference !== "string") {
		throw new ConnectorError(400, "invalid_evidence", "evidence reference is required");
	}
	writeJson(response, 200, await controller.evidence(body.reference));
}

async function claimRunnable(
	queue: A2aRelayStore,
	a2a: RunningA2aServer,
	worker: WorkerContext,
	leaseMs: number,
): Promise<
	| {
			readonly delivery: A2aRelayDelivery;
			readonly task: NonNullable<Awaited<ReturnType<RunningA2aServer["readTask"]>>>;
	  }
	| undefined
> {
	for (;;) {
		const delivery = await queue.claim(worker.agentIds, worker.worker, leaseMs);
		if (!delivery?.lease) return undefined;
		const task = await a2a.readTask(delivery.taskId);
		if (task && !isSettled(task.status.state)) return { delivery, task };
		await queue.finish(delivery.taskId, worker.worker, delivery.lease.id);
	}
}

async function requireLease(
	queue: A2aRelayStore,
	taskId: string,
	worker: string,
	leaseId: string,
): Promise<void> {
	try {
		await queue.requireLease(taskId, worker, leaseId);
	} catch {
		throw new ConnectorError(409, "invalid_lease", "task lease is invalid or expired");
	}
}

async function requireController(a2a: RunningA2aServer, taskId: string) {
	const controller = await a2a.controllerForTask(taskId);
	if (!controller) throw new ConnectorError(404, "task_not_found", "task was not found");
	return controller;
}

function statusState(body: Record<string, unknown>): A2aTaskState {
	if (typeof body.state !== "string" || !TASK_STATES.includes(body.state as A2aTaskState)) {
		throw new ConnectorError(400, "invalid_status", "state is not a valid A2A task state");
	}
	const state = body.state as A2aTaskState;
	if (!WORKER_STATUS_STATES.includes(state)) {
		throw new ConnectorError(400, "invalid_status", `worker cannot set state ${state}`);
	}
	return state;
}

function statusMessage(body: Record<string, unknown>): A2aMessage | undefined {
	if (body.message === undefined) return undefined;
	try {
		return validateMessage(body.message, "ROLE_AGENT");
	} catch (error) {
		throw new ConnectorError(400, "invalid_status_message", (error as Error).message);
	}
}

function authenticate(
	request: IncomingMessage,
	credentials: readonly A2aRelayWorkerCredential[],
): WorkerContext {
	const header = request.headers.authorization;
	if (!header?.startsWith("Bearer "))
		throw new ConnectorError(401, "unauthenticated", "bearer token required");
	const digest = (value: string): Buffer => createHash("sha256").update(value).digest();
	const supplied = digest(header.slice(7));
	for (const credential of credentials) {
		if (timingSafeEqual(digest(credential.token), supplied)) {
			return { worker: credential.worker, agentIds: credential.agentIds };
		}
	}
	throw new ConnectorError(401, "unauthenticated", "bearer token rejected");
}

function authenticateTrace(
	request: IncomingMessage,
	credentials: A2aServerConfig["credentials"],
): string {
	const header = request.headers.authorization;
	if (!header?.startsWith("Bearer "))
		throw new ConnectorError(401, "unauthenticated", "bearer token required");
	const digest = (value: string): Buffer => createHash("sha256").update(value).digest();
	const supplied = digest(header.slice(7));
	const credential = credentials.find((candidate) =>
		timingSafeEqual(digest(candidate.token), supplied),
	);
	if (!credential) throw new ConnectorError(401, "unauthenticated", "bearer token rejected");
	return credential.principal;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of request) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += bytes.length;
		if (total > MAX_CONNECTOR_BODY_BYTES) {
			throw new ConnectorError(413, "body_too_large", "request body exceeds the limit");
		}
		chunks.push(bytes);
	}
	try {
		const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
		return value as Record<string, unknown>;
	} catch {
		throw new ConnectorError(400, "invalid_json", "request body must be a JSON object");
	}
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
	response.writeHead(status, { "content-type": A2A_MEDIA_TYPE });
	response.end(`${JSON.stringify(value)}\n`);
}

class ConnectorError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

function normalizeError(error: unknown): ConnectorError {
	if (error instanceof ConnectorError) return error;
	if (error instanceof A2aError)
		return new ConnectorError(error.httpStatus, error.reason, error.message);
	return new ConnectorError(500, "internal", "connector request failed");
}

function validateConfig(config: A2aRelayServerConfig): void {
	validateIdentifier(config.agentId, "agent id");
	if (!config.queuePath) throw new Error("A2A relay queuePath is required");
	if (!config.originStorePath) throw new Error("A2A relay originStorePath is required");
	if (
		!Number.isSafeInteger(config.connectorPort) ||
		config.connectorPort < 0 ||
		config.connectorPort > 65_535
	) {
		throw new Error("A2A relay connectorPort must be an integer from 0 through 65535");
	}
	const loopback = ["127.0.0.1", "::1", "localhost"].includes(config.connectorHost);
	if (!config.connectorTls && !(config.allowInsecureLoopback && loopback)) {
		throw new Error("A2A relay connector requires TLS outside explicit loopback development");
	}
	const leaseMs = config.leaseMs ?? DEFAULT_LEASE_MS;
	if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000) {
		throw new Error("A2A relay leaseMs must be an integer of at least 1000");
	}
	validateWorkerCredentials(config.workerCredentials);
}

function validateWorkerCredentials(credentials: readonly A2aRelayWorkerCredential[]): void {
	if (credentials.length === 0) throw new Error("A2A relay worker credentials are required");
	const tokens = new Set<string>();
	const workers = new Set<string>();
	for (const credential of credentials) {
		if (!credential.token) throw new Error("A2A relay worker token is required");
		if (tokens.has(credential.token)) throw new Error("A2A relay worker tokens must be unique");
		tokens.add(credential.token);
		const worker = validateIdentifier(credential.worker, "worker id");
		if (workers.has(worker)) throw new Error("A2A relay worker ids must be unique");
		workers.add(worker);
		if (credential.agentIds.length === 0) throw new Error(`worker "${worker}" must allow an agent`);
		for (const agent of credential.agentIds) validateIdentifier(agent, "agent id");
	}
}

function formatHost(host: string): string {
	return host.includes(":") ? `[${host}]` : host;
}

function parseBoolean(value: string | undefined): boolean {
	return value?.trim().toLowerCase() === "true" || value?.trim() === "1";
}
