import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
	createServer as createHttpServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { type AgentEndpoint, type AgentSendInput, validateIdentifier } from "../agent/types.ts";
import {
	parseRelayFrame,
	RELAY_MAX_FRAME_BYTES,
	RELAY_PROTOCOL_VERSION,
	type RelayErrorFrame,
	type RelayServerFrame,
	type RelaySessionQueryRequest,
} from "./protocol.ts";
import { RelayStore } from "./store.ts";
import { ServerWebSocket, websocketAccept } from "./websocket.ts";

export interface RelayCredential {
	readonly token: string;
	readonly principal: string;
	readonly register: readonly string[];
	readonly send: readonly string[];
	readonly list?: readonly string[];
}

export interface RelayServerConfig {
	readonly host: string;
	readonly port: number;
	readonly storePath: string;
	readonly credentials: readonly RelayCredential[];
	readonly tls?: { readonly key: string | Buffer; readonly cert: string | Buffer };
	readonly allowInsecureLoopback?: boolean;
	readonly heartbeatMs?: number;
	readonly maintenanceMs?: number;
	readonly maxConnections?: number;
	readonly maxFramesPerWindow?: number;
	readonly rateWindowMs?: number;
	readonly logger?: (record: Readonly<Record<string, unknown>>) => void;
}

interface AuthenticatedConnection {
	readonly socket: ServerWebSocket;
	readonly credential: RelayCredential;
	readonly endpoint: string;
	lastPongAt: number;
	lastIssuedCursor: number;
}

interface PendingQuery {
	readonly requester: AuthenticatedConnection;
	readonly targetEndpoint: string;
	readonly requestId: string;
	readonly request: RelaySessionQueryRequest;
	readonly timer: ReturnType<typeof setTimeout>;
}

export interface RunningRelay {
	readonly url: string;
	close(): Promise<void>;
}

export async function startRelayServer(config: RelayServerConfig): Promise<RunningRelay> {
	validateServerConfig(config);
	const store = new RelayStore(config.storePath);
	await store.initialize();
	const connections = new Map<string, AuthenticatedConnection>();
	const pendingQueries = new Map<string, PendingQuery>();
	const websockets = new Set<ServerWebSocket>();
	const log = config.logger ?? ((record) => console.error(JSON.stringify(record)));
	const requestHandler = async (
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> => {
		const path = new URL(request.url ?? "/", "http://relay.invalid").pathname;
		if (path === "/healthz") {
			response.writeHead(200, { "content-type": "application/json" });
			response.end('{"status":"ok"}\n');
			return;
		}
		if (path === "/readyz") {
			const ready = await store.ready();
			response.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
			response.end(`${JSON.stringify({ status: ready ? "ready" : "unavailable" })}\n`);
			return;
		}
		response.writeHead(404, { "content-type": "application/json" });
		response.end('{"error":"not_found"}\n');
	};
	const server = config.tls
		? createHttpsServer({ key: config.tls.key, cert: config.tls.cert }, requestHandler)
		: createHttpServer(requestHandler);

	server.on("upgrade", (request, socket, head) => {
		const path = new URL(request.url ?? "/", "http://relay.invalid").pathname;
		const key = request.headers["sec-websocket-key"];
		if (
			path !== "/v1/connect" ||
			typeof key !== "string" ||
			request.headers["sec-websocket-version"] !== "13"
		) {
			socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
			return;
		}
		if (websockets.size >= (config.maxConnections ?? 1_000)) {
			socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
			log({ event: "connection_rejected", code: "connection_limit" });
			return;
		}
		socket.write(
			[
				"HTTP/1.1 101 Switching Protocols",
				"Upgrade: websocket",
				"Connection: Upgrade",
				`Sec-WebSocket-Accept: ${websocketAccept(key)}`,
				"",
				"",
			].join("\r\n"),
		);
		let connection: AuthenticatedConnection | undefined;
		let handling = Promise.resolve();
		let rateWindowStartedAt = Date.now();
		let framesInWindow = 0;
		let websocket: ServerWebSocket;
		websocket = new ServerWebSocket(
			socket,
			head,
			(text) => {
				const now = Date.now();
				if (now - rateWindowStartedAt >= (config.rateWindowMs ?? 60_000)) {
					rateWindowStartedAt = now;
					framesInWindow = 0;
				}
				framesInWindow += 1;
				if (framesInWindow > (config.maxFramesPerWindow ?? 120)) {
					log({
						event: "request_rejected",
						code: "rate_limited",
						...(connection ? { endpoint: connection.endpoint } : {}),
					});
					sendError(websocket, "rate_limited", "request rate limit exceeded");
					websocket.close(1008);
					return;
				}
				handling = handling
					.then(() =>
						handleText(text, websocket, connection, {
							config,
							store,
							connections,
							pendingQueries,
							log,
							setConnection(value) {
								connection = value;
							},
						}),
					)
					.catch(() => {
						sendError(websocket, "invalid_request", "request was rejected");
						websocket.close(1008);
					});
			},
			() => {
				websockets.delete(websocket);
				if (connection) cancelQueriesFor(connection, pendingQueries);
				if (connection && connections.get(connection.endpoint) === connection) {
					connections.delete(connection.endpoint);
					log({ event: "disconnected", endpoint: connection.endpoint });
				}
			},
		);
		websockets.add(websocket);
	});

	const heartbeatMs = config.heartbeatMs ?? 15_000;
	const heartbeat = setInterval(() => {
		const now = Date.now();
		for (const connection of connections.values()) {
			if (now - connection.lastPongAt > heartbeatMs * 2) {
				log({ event: "stale_connection", endpoint: connection.endpoint });
				connection.socket.close(1008);
				continue;
			}
			connection.socket.send({ type: "ping", nonce: String(now) } satisfies RelayServerFrame);
		}
	}, heartbeatMs);
	heartbeat.unref();
	const maintenance = setInterval(
		() => {
			void store.pruneExpired().then(
				(removed) => {
					if (removed > 0) log({ event: "retention_pruned", messages: removed });
				},
				() => log({ event: "maintenance_failed", code: "storage_unavailable" }),
			);
		},
		config.maintenanceMs ?? 60 * 60 * 1_000,
	);
	maintenance.unref();

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(config.port, config.host, () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address() as AddressInfo;
	const scheme = config.tls ? "wss" : "ws";
	return {
		url: `${scheme}://${formatHost(config.host)}:${address.port}/v1/connect`,
		async close() {
			clearInterval(heartbeat);
			clearInterval(maintenance);
			for (const connection of connections.values()) connection.socket.close(1001);
			for (const pending of pendingQueries.values()) clearTimeout(pending.timer);
			pendingQueries.clear();
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
			store.close();
		},
	};
}

interface HandlerContext {
	readonly config: RelayServerConfig;
	readonly store: RelayStore;
	readonly connections: Map<string, AuthenticatedConnection>;
	readonly pendingQueries: Map<string, PendingQuery>;
	readonly log: (record: Readonly<Record<string, unknown>>) => void;
	setConnection(connection: AuthenticatedConnection): void;
}

async function handleText(
	text: string,
	socket: ServerWebSocket,
	connection: AuthenticatedConnection | undefined,
	context: HandlerContext,
): Promise<void> {
	let frame: Record<string, unknown>;
	try {
		frame = parseRelayFrame(text);
	} catch {
		sendError(socket, "invalid_frame", "invalid protocol frame");
		return;
	}
	if (!connection) {
		try {
			await authenticate(frame, socket, context);
		} catch {
			context.log({ event: "authentication_failed" });
			sendError(socket, "authentication_failed", "authentication failed");
			socket.close(1008);
		}
		return;
	}
	try {
		switch (frame.type) {
			case "list":
				handleList(frame, socket, connection, context);
				break;
			case "send":
				await handleSend(frame, socket, connection, context);
				break;
			case "list_conversations":
				handleSessionQuery(frame, connection, context);
				break;
			case "read_history":
				handleSessionQuery(frame, connection, context);
				break;
			case "session_result":
				handleSessionResult(frame, connection, context);
				break;
			case "ack":
				{
					const cursor = requireCursor(frame.cursor);
					if (cursor > connection.lastIssuedCursor) {
						throw new RelayProtocolError(
							"invalid_cursor",
							"cursor was not issued to this connection",
						);
					}
					const acknowledged = await context.store.acknowledge(connection.endpoint, cursor);
					context.log({
						event: "acknowledged",
						endpoint: connection.endpoint,
						cursor: acknowledged,
					});
				}
				break;
			case "pong":
				connection.lastPongAt = Date.now();
				break;
			default:
				sendError(socket, "invalid_frame", "unsupported protocol frame");
		}
	} catch (error) {
		const requestId = typeof frame.requestId === "string" ? frame.requestId : undefined;
		context.log({
			event: "request_rejected",
			endpoint: connection.endpoint,
			code: protocolCode(error),
			...(requestId ? { requestId } : {}),
		});
		sendError(socket, protocolCode(error), safeMessage(error), requestId);
	}
}

async function authenticate(
	frame: Record<string, unknown>,
	socket: ServerWebSocket,
	context: HandlerContext,
): Promise<void> {
	if (
		frame.type !== "authenticate" ||
		frame.version !== RELAY_PROTOCOL_VERSION ||
		typeof frame.token !== "string" ||
		typeof frame.endpoint !== "string" ||
		typeof frame.principal !== "string"
	) {
		sendError(socket, "authentication_required", "authentication failed");
		socket.close(1008);
		return;
	}
	const credential = findCredential(context.config.credentials, frame.token);
	const endpoint = frame.endpoint;
	const authorized =
		credential &&
		credential.principal === frame.principal &&
		credential.register.includes(endpoint);
	if (!credential || !authorized) {
		context.log({ event: "authentication_failed" });
		sendError(socket, "authentication_failed", "authentication failed");
		socket.close(1008);
		return;
	}
	validateIdentifier(endpoint, "endpoint id");
	const requestedCursor = requireCursor(frame.cursor);
	const previous = context.connections.get(endpoint);
	if (previous && requestedCursor !== previous.lastIssuedCursor) {
		sendError(socket, "stale_resume", "registration resume cursor is stale");
		socket.close(1008);
		return;
	}
	const cursor = await context.store.resume(endpoint, requestedCursor);
	if (previous) previous.socket.close(1008);
	const connection: AuthenticatedConnection = {
		socket,
		credential,
		endpoint,
		lastPongAt: Date.now(),
		lastIssuedCursor: cursor,
	};
	context.connections.set(endpoint, connection);
	context.setConnection(connection);
	socket.send({ type: "authenticated", endpoint, cursor } satisfies RelayServerFrame);
	context.log({ event: "authenticated", endpoint, principal: credential.principal, cursor });
	for (const pending of await context.store.pending(endpoint, cursor)) {
		socket.send({
			type: "deliver",
			cursor: pending.cursor,
			message: pending.message,
		} satisfies RelayServerFrame);
		connection.lastIssuedCursor = pending.cursor;
	}
}

function handleList(
	frame: Record<string, unknown>,
	socket: ServerWebSocket,
	connection: AuthenticatedConnection,
	context: HandlerContext,
): void {
	const requestId = requireRequestId(frame.requestId);
	const visible = new Set([
		...connection.credential.register,
		...connection.credential.send,
		...(connection.credential.list ?? []),
	]);
	visible.delete("*");
	const endpoints: AgentEndpoint[] = [...visible].sort().map((id) => ({
		id,
		principal:
			context.config.credentials.find((credential) => credential.register.includes(id))
				?.principal ?? id,
	}));
	socket.send({ type: "endpoints", requestId, endpoints } satisfies RelayServerFrame);
}

async function handleSend(
	frame: Record<string, unknown>,
	socket: ServerWebSocket,
	connection: AuthenticatedConnection,
	context: HandlerContext,
): Promise<void> {
	const requestId = requireRequestId(frame.requestId);
	if (!frame.input || typeof frame.input !== "object" || Array.isArray(frame.input)) {
		throw new Error("invalid send input");
	}
	const input = frame.input as unknown as AgentSendInput;
	if (
		!connection.credential.send.includes("*") &&
		!connection.credential.send.includes(input.recipient)
	) {
		throw new RelayProtocolError("route_forbidden", "route is not authorized");
	}
	const accepted = await context.store.accept(connection.endpoint, input);
	socket.send({
		type: "accepted",
		requestId,
		message: accepted.message,
		state: accepted.state,
		duplicate: accepted.duplicate,
	} satisfies RelayServerFrame);
	context.log({
		event: "message_accepted",
		endpoint: connection.endpoint,
		recipient: accepted.message.recipient,
		messageId: accepted.message.id,
		conversationId: accepted.message.conversationId,
		cursor: accepted.cursor,
		bytes: Buffer.byteLength(accepted.message.body),
		duplicate: accepted.duplicate,
	});
	const recipient = context.connections.get(accepted.message.recipient);
	if (recipient && accepted.queued) {
		recipient.socket.send({
			type: "deliver",
			cursor: accepted.cursor,
			message: accepted.message,
		} satisfies RelayServerFrame);
		recipient.lastIssuedCursor = Math.max(recipient.lastIssuedCursor, accepted.cursor);
	}
}

function handleSessionQuery(
	frame: Record<string, unknown>,
	connection: AuthenticatedConnection,
	context: HandlerContext,
): void {
	const requestId = requireRequestId(frame.requestId);
	if (typeof frame.endpoint !== "string") throw new Error("target endpoint is required");
	const targetEndpoint = validateIdentifier(frame.endpoint, "endpoint id");
	if (!canRouteQuery(connection.credential, targetEndpoint)) {
		throw new RelayProtocolError("route_forbidden", "session query route is not authorized");
	}
	const target = context.connections.get(targetEndpoint);
	if (!target) throw new RelayProtocolError("target_offline", "target agent is not connected");
	const request = parseSessionQueryRequest(frame);
	const queryId = randomUUID();
	const timer = setTimeout(() => {
		const pending = context.pendingQueries.get(queryId);
		if (!pending) return;
		context.pendingQueries.delete(queryId);
		sendError(pending.requester.socket, "query_timeout", "target agent did not answer", requestId);
	}, 10_000);
	timer.unref();
	context.pendingQueries.set(queryId, {
		requester: connection,
		targetEndpoint,
		requestId,
		request,
		timer,
	});
	target.socket.send({
		type: "session_query",
		queryId,
		requesterEndpoint: connection.endpoint,
		request,
	} satisfies RelayServerFrame);
	context.log({
		event: "session_query_routed",
		endpoint: connection.endpoint,
		targetEndpoint,
		queryId,
	});
}

function handleSessionResult(
	frame: Record<string, unknown>,
	connection: AuthenticatedConnection,
	context: HandlerContext,
): void {
	if (typeof frame.queryId !== "string") throw new Error("query id is required");
	const queryId = validateIdentifier(frame.queryId, "query id");
	const pending = context.pendingQueries.get(queryId);
	if (!pending || pending.targetEndpoint !== connection.endpoint) {
		throw new RelayProtocolError("unknown_query", "session query is not pending for this endpoint");
	}
	if (!frame.result || typeof frame.result !== "object" || Array.isArray(frame.result)) {
		throw new Error("invalid session query result");
	}
	if (frameBytes(frame) > RELAY_MAX_FRAME_BYTES) {
		throw new RelayProtocolError(
			"response_too_large",
			"session query response exceeds frame limit",
		);
	}
	const result = frame.result as Record<string, unknown>;
	context.pendingQueries.delete(queryId);
	clearTimeout(pending.timer);
	if (result.type === "error") {
		sendError(
			pending.requester.socket,
			typeof result.code === "string" ? result.code : "query_failed",
			typeof result.message === "string" ? result.message : "target agent rejected query",
			pending.requestId,
		);
		return;
	}
	if (result.type === "conversations" && Array.isArray(result.conversations)) {
		pending.requester.socket.send({
			type: "conversations",
			requestId: pending.requestId,
			conversations: result.conversations,
		} satisfies RelayServerFrame);
		return;
	}
	if (
		result.type === "history" &&
		typeof result.conversationId === "string" &&
		Array.isArray(result.messages) &&
		pending.request.type === "read_history" &&
		result.conversationId === pending.request.conversationId
	) {
		pending.requester.socket.send({
			type: "history",
			requestId: pending.requestId,
			conversationId: result.conversationId,
			messages: result.messages,
		} satisfies RelayServerFrame);
		return;
	}
	throw new Error("invalid session query result");
}

function sendError(
	socket: ServerWebSocket,
	code: string,
	message: string,
	requestId?: string,
): void {
	socket.send({
		type: "error",
		code,
		message,
		...(requestId ? { requestId } : {}),
	} satisfies RelayErrorFrame);
}

function frameBytes(frame: unknown): number {
	return Buffer.byteLength(JSON.stringify(frame));
}

function parseSessionQueryRequest(frame: Record<string, unknown>): RelaySessionQueryRequest {
	const beforeCursor =
		frame.beforeCursor === undefined
			? Number.MAX_SAFE_INTEGER
			: requireInteger(frame.beforeCursor, "session cursor", 1, Number.MAX_SAFE_INTEGER);
	if (frame.type === "list_conversations") {
		return {
			type: "list_conversations",
			limit:
				frame.limit === undefined ? 50 : requireInteger(frame.limit, "conversation limit", 1, 100),
			beforeCursor,
		};
	}
	if (frame.type === "read_history") {
		if (typeof frame.conversationId !== "string") {
			throw new Error("conversation id is required");
		}
		return {
			type: "read_history",
			conversationId: validateIdentifier(frame.conversationId, "conversation id"),
			limit: frame.limit === undefined ? 50 : requireInteger(frame.limit, "history limit", 1, 50),
			beforeCursor,
		};
	}
	throw new Error("unsupported session query");
}

function canRouteQuery(credential: RelayCredential, endpoint: string): boolean {
	return (
		credential.send.includes("*") ||
		credential.send.includes(endpoint) ||
		credential.list?.includes("*") === true ||
		credential.list?.includes(endpoint) === true
	);
}

function cancelQueriesFor(
	connection: AuthenticatedConnection,
	pendingQueries: Map<string, PendingQuery>,
): void {
	for (const [queryId, pending] of pendingQueries) {
		if (pending.requester !== connection && pending.targetEndpoint !== connection.endpoint) {
			continue;
		}
		pendingQueries.delete(queryId);
		clearTimeout(pending.timer);
		if (pending.targetEndpoint === connection.endpoint && pending.requester !== connection) {
			sendError(
				pending.requester.socket,
				"target_disconnected",
				"target agent disconnected",
				pending.requestId,
			);
		}
	}
}

function findCredential(
	credentials: readonly RelayCredential[],
	token: string,
): RelayCredential | undefined {
	const candidate = Buffer.from(token);
	return credentials.find((credential) => {
		const expected = Buffer.from(credential.token);
		return expected.length === candidate.length && timingSafeEqual(expected, candidate);
	});
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: startup validation enumerates independent fail-closed checks
function validateServerConfig(config: RelayServerConfig): void {
	if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65_535) {
		throw new Error("relay port is invalid");
	}
	if (!config.tls) {
		const loopback =
			config.host === "127.0.0.1" || config.host === "::1" || config.host === "localhost";
		if (!loopback || !config.allowInsecureLoopback) {
			throw new Error("TLS is required except for explicitly enabled loopback development");
		}
	}
	requireConfiguredInteger(config.heartbeatMs, "heartbeat interval", 10, 60 * 60 * 1_000);
	requireConfiguredInteger(config.maintenanceMs, "maintenance interval", 100, 24 * 60 * 60 * 1_000);
	requireConfiguredInteger(config.maxConnections, "connection limit", 1, 100_000);
	requireConfiguredInteger(config.maxFramesPerWindow, "frame rate limit", 1, 1_000_000);
	requireConfiguredInteger(config.rateWindowMs, "rate window", 100, 60 * 60 * 1_000);
	const tokens = new Set<string>();
	const endpointOwners = new Map<string, string>();
	for (const credential of config.credentials) {
		if (!credential.token) throw new Error("relay credential token is required");
		if (tokens.has(credential.token)) throw new Error("relay credential tokens must be unique");
		tokens.add(credential.token);
		validateIdentifier(credential.principal, "principal id");
		for (const endpoint of credential.register) {
			validateIdentifier(endpoint, "endpoint id");
			const owner = endpointOwners.get(endpoint);
			if (owner && owner !== credential.principal) {
				throw new Error(`endpoint "${endpoint}" has multiple credential owners`);
			}
			endpointOwners.set(endpoint, credential.principal);
		}
		for (const endpoint of credential.send) {
			if (endpoint !== "*") validateIdentifier(endpoint, "endpoint id");
		}
		for (const endpoint of credential.list ?? []) {
			if (endpoint !== "*") validateIdentifier(endpoint, "endpoint id");
		}
		const visible = [
			...new Set([...credential.register, ...credential.send, ...(credential.list ?? [])]),
		].filter((endpoint) => endpoint !== "*");
		const discoveryProbe = {
			type: "endpoints",
			requestId: "x".repeat(128),
			endpoints: visible.map((id) => ({ id, principal: endpointOwners.get(id) ?? id })),
		};
		if (frameBytes(discoveryProbe) > RELAY_MAX_FRAME_BYTES) {
			throw new Error(`credential for "${credential.principal}" has too many visible endpoints`);
		}
	}
}

function requireConfiguredInteger(
	value: number | undefined,
	label: string,
	minimum: number,
	maximum: number,
): void {
	if (value === undefined) return;
	requireInteger(value, label, minimum, maximum);
}

function requireRequestId(value: unknown): string {
	if (typeof value !== "string") throw new Error("request id is required");
	return validateIdentifier(value, "request id");
}

function requireCursor(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new Error("invalid cursor");
	}
	return value;
}

function requireInteger(value: unknown, label: string, minimum: number, maximum: number): number {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < minimum ||
		value > maximum
	) {
		throw new Error(`invalid ${label}`);
	}
	return value;
}

class RelayProtocolError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

function protocolCode(error: unknown): string {
	return error instanceof RelayProtocolError ? error.code : "invalid_request";
}

function safeMessage(error: unknown): string {
	return error instanceof RelayProtocolError ? error.message : "request was rejected";
}

function formatHost(host: string): string {
	return host.includes(":") ? `[${host}]` : host;
}

export async function configFromEnv(): Promise<RelayServerConfig> {
	const host = process.env.AGENT_RELAY_HOST?.trim() || "127.0.0.1";
	const port = Number(process.env.AGENT_RELAY_PORT ?? "8787");
	const storePath = process.env.AGENT_RELAY_STORE_PATH?.trim();
	const credentialsPath = process.env.AGENT_RELAY_CREDENTIALS_PATH?.trim();
	if (!storePath) throw new Error("AGENT_RELAY_STORE_PATH is required");
	if (!credentialsPath) throw new Error("AGENT_RELAY_CREDENTIALS_PATH is required");
	const credentialsDocument = JSON.parse(await readFile(credentialsPath, "utf8")) as {
		credentials?: RelayCredential[];
	};
	if (!Array.isArray(credentialsDocument.credentials)) {
		throw new Error("relay credentials file must contain a credentials array");
	}
	const keyPath = process.env.AGENT_RELAY_TLS_KEY_PATH?.trim();
	const certPath = process.env.AGENT_RELAY_TLS_CERT_PATH?.trim();
	if (Boolean(keyPath) !== Boolean(certPath)) throw new Error("both relay TLS paths are required");
	const tls =
		keyPath && certPath
			? { key: await readFile(keyPath), cert: await readFile(certPath) }
			: undefined;
	const maxConnections = optionalIntegerEnv("AGENT_RELAY_MAX_CONNECTIONS");
	const maxFramesPerWindow = optionalIntegerEnv("AGENT_RELAY_MAX_FRAMES_PER_WINDOW");
	const rateWindowMs = optionalIntegerEnv("AGENT_RELAY_RATE_WINDOW_MS");
	return {
		host,
		port,
		storePath,
		credentials: credentialsDocument.credentials,
		...(tls ? { tls } : {}),
		allowInsecureLoopback: process.env.AGENT_RELAY_ALLOW_INSECURE === "1",
		...(maxConnections === undefined ? {} : { maxConnections }),
		...(maxFramesPerWindow === undefined ? {} : { maxFramesPerWindow }),
		...(rateWindowMs === undefined ? {} : { rateWindowMs }),
	};
}

function optionalIntegerEnv(name: string): number | undefined {
	const value = process.env[name]?.trim();
	if (!value) return undefined;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be an integer`);
	return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	startRelayServer(await configFromEnv())
		.then((running) => {
			console.error(JSON.stringify({ event: "relay_started", url: running.url }));
		})
		.catch((error) => {
			console.error(JSON.stringify({ event: "relay_failed", error: safeMessage(error) }));
			process.exitCode = 1;
		});
}
