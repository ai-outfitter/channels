import { timingSafeEqual } from "node:crypto";
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
	RELAY_PROTOCOL_VERSION,
	type RelayConversationSummary,
	type RelayErrorFrame,
	type RelayServerFrame,
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
	readonly logger?: (record: Readonly<Record<string, unknown>>) => void;
}

interface AuthenticatedConnection {
	readonly socket: ServerWebSocket;
	readonly credential: RelayCredential;
	readonly endpoint: string;
	lastPongAt: number;
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
		const websocket = new ServerWebSocket(
			socket,
			head,
			(text) => {
				void handleText(text, websocket, connection, {
					config,
					store,
					connections,
					log,
					setConnection(value) {
						connection = value;
					},
				});
			},
			() => {
				if (connection && connections.get(connection.endpoint) === connection) {
					connections.delete(connection.endpoint);
					log({ event: "disconnected", endpoint: connection.endpoint });
				}
			},
		);
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
			for (const connection of connections.values()) connection.socket.close(1001);
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
		},
	};
}

interface HandlerContext {
	readonly config: RelayServerConfig;
	readonly store: RelayStore;
	readonly connections: Map<string, AuthenticatedConnection>;
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
		await authenticate(frame, socket, context);
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
				await handleListConversations(frame, socket, connection, context);
				break;
			case "read_history":
				await handleReadHistory(frame, socket, connection, context);
				break;
			case "ack":
				await context.store.acknowledge(connection.endpoint, requireCursor(frame.cursor));
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
	const cursor = requireCursor(frame.cursor);
	const previous = context.connections.get(endpoint);
	if (previous) previous.socket.close(1008);
	const connection: AuthenticatedConnection = {
		socket,
		credential,
		endpoint,
		lastPongAt: Date.now(),
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
		state: "accepted",
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
	recipient?.socket.send({
		type: "deliver",
		cursor: accepted.cursor,
		message: accepted.message,
	} satisfies RelayServerFrame);
}

async function handleListConversations(
	frame: Record<string, unknown>,
	socket: ServerWebSocket,
	connection: AuthenticatedConnection,
	context: HandlerContext,
): Promise<void> {
	const requestId = requireRequestId(frame.requestId);
	const allowed = authorizedMessages(await context.store.history(), connection.credential);
	const summaries = new Map<string, RelayConversationSummary>();
	for (const entry of allowed) {
		const previous = summaries.get(entry.message.conversationId);
		const participants = new Set(previous?.participants ?? []);
		participants.add(entry.message.sender);
		participants.add(entry.message.recipient);
		summaries.set(entry.message.conversationId, {
			id: entry.message.conversationId,
			updatedAt:
				!previous || entry.message.createdAt > previous.updatedAt
					? entry.message.createdAt
					: previous.updatedAt,
			participants: [...participants].sort(),
		});
	}
	socket.send({
		type: "conversations",
		requestId,
		conversations: [...summaries.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
	} satisfies RelayServerFrame);
}

async function handleReadHistory(
	frame: Record<string, unknown>,
	socket: ServerWebSocket,
	connection: AuthenticatedConnection,
	context: HandlerContext,
): Promise<void> {
	const requestId = requireRequestId(frame.requestId);
	if (typeof frame.conversationId !== "string") throw new Error("conversation id is required");
	const conversationId = validateIdentifier(frame.conversationId, "conversation id");
	const limit =
		frame.limit === undefined ? 50 : requireInteger(frame.limit, "history limit", 1, 50);
	const beforeCursor =
		frame.beforeCursor === undefined
			? Number.MAX_SAFE_INTEGER
			: requireInteger(frame.beforeCursor, "history cursor", 1, Number.MAX_SAFE_INTEGER);
	const messages = authorizedMessages(await context.store.history(), connection.credential)
		.filter(
			(entry) => entry.message.conversationId === conversationId && entry.cursor < beforeCursor,
		)
		.slice(-limit);
	socket.send({
		type: "history",
		requestId,
		conversationId,
		messages,
	} satisfies RelayServerFrame);
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

function authorizedMessages(
	messages: Awaited<ReturnType<RelayStore["history"]>>,
	credential: RelayCredential,
): Awaited<ReturnType<RelayStore["history"]>> {
	const owned = new Set(credential.register);
	const visible = new Set([...credential.register, ...credential.send, ...(credential.list ?? [])]);
	const wildcard = visible.has("*");
	return messages.filter(
		(entry) =>
			(owned.has(entry.message.sender) && (wildcard || visible.has(entry.message.recipient))) ||
			(owned.has(entry.message.recipient) && (wildcard || visible.has(entry.message.sender))),
	);
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
	for (const credential of config.credentials) {
		if (!credential.token) throw new Error("relay credential token is required");
		validateIdentifier(credential.principal, "principal id");
		for (const endpoint of credential.register) validateIdentifier(endpoint, "endpoint id");
		for (const endpoint of credential.send) {
			if (endpoint !== "*") validateIdentifier(endpoint, "endpoint id");
		}
	}
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

async function configFromEnv(): Promise<RelayServerConfig> {
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
	return {
		host,
		port,
		storePath,
		credentials: credentialsDocument.credentials,
		...(tls ? { tls } : {}),
		allowInsecureLoopback: process.env.AGENT_RELAY_ALLOW_INSECURE === "1",
	};
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
