/** Shared Slack webhook inbox. Identities and signing keys are private deployment data. */
export interface SlackInboxBinding {
	tenantId: string;
	bindingId: string;
	workspaceId: string;
	appId: string;
	signingSecret: string;
	deliveryToken: string;
	channelIds: string[];
}
interface Statement {
	bind(...values: (string | number)[]): Statement;
	run(): Promise<unknown>;
	all<T>(): Promise<{ results: T[] }>;
}
export interface SlackInboxEnv {
	DB: { prepare(sql: string): Statement };
	SLACK_INBOX_BINDINGS: string;
}

import { PayloadTooLarge, readBody } from "./body.ts";

const encoder = new TextEncoder();
async function equalSecret(actual: string, expected: string): Promise<boolean> {
	const digest = (value: string) => crypto.subtle.digest("SHA-256", encoder.encode(value));
	const [a, b] = await Promise.all([digest(actual), digest(expected)]);
	let difference = 0;
	const left = new Uint8Array(a),
		right = new Uint8Array(b);
	for (let index = 0; index < left.length; index++)
		difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
	return difference === 0;
}
function bindings(env: SlackInboxEnv): SlackInboxBinding[] {
	const values: unknown = JSON.parse(env.SLACK_INBOX_BINDINGS);
	if (!Array.isArray(values) || values.length > 100)
		throw new Error("Invalid Slack inbox configuration");
	const keys = new Set<string>();
	const tokens = new Set<string>();
	for (const value of values) {
		for (const key of [
			"tenantId",
			"bindingId",
			"workspaceId",
			"appId",
			"signingSecret",
			"deliveryToken",
		]) {
			if (typeof value?.[key] !== "string" || !value[key].trim())
				throw new Error("Missing Slack inbox binding");
		}
		if (
			!Array.isArray(value.channelIds) ||
			value.channelIds.some((id: unknown) => typeof id !== "string" || !/^[CG][A-Z0-9]+$/.test(id))
		)
			throw new Error("Invalid channel restriction");
		const key = `${value.workspaceId}:${value.appId}`;
		if (keys.has(key) || tokens.has(value.deliveryToken))
			throw new Error("Ambiguous Slack inbox binding");
		keys.add(key);
		tokens.add(value.deliveryToken);
	}
	return values;
}

function isMention(body: {
	type?: unknown;
	event?: {
		type?: unknown;
		bot_id?: unknown;
		subtype?: unknown;
		user?: unknown;
		channel?: unknown;
		ts?: unknown;
	};
}): boolean {
	const event = body.event;
	return (
		body.type === "event_callback" &&
		event?.type === "app_mention" &&
		!event.bot_id &&
		!event.subtype &&
		typeof event.user === "string" &&
		typeof event.channel === "string" &&
		typeof event.ts === "string"
	);
}

async function verifySignature(
	request: Request,
	raw: string,
	timestamp: string,
	body: { api_app_id?: unknown; team_id?: unknown },
	configured: SlackInboxBinding[],
): Promise<SlackInboxBinding | undefined> {
	const candidates = body.api_app_id
		? configured.filter(
				(binding) =>
					binding.appId === body.api_app_id &&
					(!body.team_id || binding.workspaceId === body.team_id),
			)
		: configured;
	let bound: SlackInboxBinding | undefined;
	for (const candidate of candidates) {
		const key = await crypto.subtle.importKey(
			"raw",
			encoder.encode(candidate.signingSecret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		const signature = new Uint8Array(
			await crypto.subtle.sign("HMAC", key, encoder.encode(`v0:${timestamp}:${raw}`)),
		);
		const expected = `v0=${Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
		if (await equalSecret(request.headers.get("x-slack-signature") ?? "", expected)) {
			bound = candidate;
			break;
		}
	}
	return bound;
}

function projectEnvelope(
	body: { type: unknown; api_app_id: unknown; team_id: unknown; event_id: unknown },
	event: Record<string, unknown>,
): string {
	return JSON.stringify({
		type: body.type,
		api_app_id: body.api_app_id,
		team_id: body.team_id,
		event_id: body.event_id,
		event: {
			type: event.type,
			user: event.user,
			channel: event.channel,
			ts: event.ts,
			...(typeof event.thread_ts === "string" ? { thread_ts: event.thread_ts } : {}),
			text: typeof event.text === "string" ? event.text : "",
		},
	});
}

function validEnvelope(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const body = value as Record<string, unknown>;
	return Boolean(body.api_app_id) || body.type === "url_verification";
}

async function receive(
	request: Request,
	env: SlackInboxEnv,
	configured: SlackInboxBinding[],
): Promise<Response> {
	const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
	if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300)
		return new Response("Unauthorized", { status: 401 });
	const raw = await readBody(request);
	const body = JSON.parse(raw);
	if (!validEnvelope(body)) return new Response("Invalid event", { status: 400 });
	const bound = await verifySignature(request, raw, timestamp, body, configured);
	if (!bound) return new Response("Unauthorized", { status: 401 });
	if (body.type === "url_verification" && typeof body.challenge === "string")
		return Response.json({ challenge: body.challenge });
	if (body.team_id !== bound.workspaceId || body.api_app_id !== bound.appId)
		return new Response("Workspace mismatch", { status: 403 });
	const event = body.event;
	if (!isMention(body)) return new Response("Ignored");
	if (bound.channelIds.length && !bound.channelIds.includes(event.channel))
		return new Response("Ignored");
	if (typeof body.event_id !== "string" || body.event_id.length > 128)
		return new Response("Invalid event", { status: 400 });
	await env.DB.prepare(
		"INSERT INTO slack_inbox_events (tenantId,bindingId,eventId,body,createdAt) VALUES (?,?,?,?,?) ON CONFLICT(tenantId,bindingId,eventId) DO NOTHING",
	)
		.bind(bound.tenantId, bound.bindingId, body.event_id, projectEnvelope(body, event), Date.now())
		.run();
	return new Response("Accepted");
}
async function binding(
	request: Request,
	configured: SlackInboxBinding[],
): Promise<SlackInboxBinding | undefined> {
	for (const binding of configured)
		if (
			await equalSecret(
				request.headers.get("authorization") ?? "",
				`Bearer ${binding.deliveryToken}`,
			)
		)
			return binding;
	return undefined;
}
async function deliver(
	request: Request,
	env: SlackInboxEnv,
	configured: SlackInboxBinding[],
): Promise<Response> {
	const bound = await binding(request, configured);
	if (!bound) return new Response("Unauthorized", { status: 401 });
	if (request.method === "GET" && new URL(request.url).pathname === "/events") {
		const channelFilter = bound.channelIds.length
			? ` AND json_extract(body,'$.event.channel') IN (${bound.channelIds.map(() => "?").join(",")})`
			: "";
		const rows = await env.DB.prepare(
			`SELECT eventId,body FROM slack_inbox_events WHERE tenantId=? AND bindingId=? AND acknowledgedAt IS NULL AND createdAt >= ? AND json_extract(body,'$.team_id')=? AND json_extract(body,'$.api_app_id')=?${channelFilter} ORDER BY createdAt,eventId LIMIT 20`,
		)
			.bind(
				bound.tenantId,
				bound.bindingId,
				Date.now() - 86_400_000,
				bound.workspaceId,
				bound.appId,
				...bound.channelIds,
			)
			.all<{ eventId: string; body: string }>();
		return Response.json(
			{
				bindingId: bound.bindingId,
				workspaceId: bound.workspaceId,
				events: rows.results.map((row) => ({ eventId: row.eventId, body: JSON.parse(row.body) })),
			},
			{ headers: { "cache-control": "no-store" } },
		);
	}
	if (request.method === "POST" && new URL(request.url).pathname === "/events/ack") {
		const body = JSON.parse(await readBody(request));
		if (!body || typeof body !== "object" || Array.isArray(body))
			return new Response("Invalid acknowledgement", { status: 400 });
		if (
			!Array.isArray(body.eventIds) ||
			body.eventIds.length > 20 ||
			body.eventIds.some((id: unknown) => typeof id !== "string" || id.length > 128)
		)
			return new Response("Invalid acknowledgement", { status: 400 });
		for (const id of body.eventIds)
			await env.DB.prepare(
				"UPDATE slack_inbox_events SET acknowledgedAt=?, body='{}' WHERE tenantId=? AND bindingId=? AND eventId=? AND json_extract(body,'$.team_id')=? AND json_extract(body,'$.api_app_id')=?",
			)
				.bind(Date.now(), bound.tenantId, bound.bindingId, id, bound.workspaceId, bound.appId)
				.run();
		return new Response("Acknowledged");
	}
	return new Response("Not found", { status: 404 });
}
export async function handleSlackInbox(request: Request, env: SlackInboxEnv): Promise<Response> {
	try {
		const path = new URL(request.url).pathname;
		let configured: SlackInboxBinding[];
		try {
			configured = bindings(env);
		} catch {
			return new Response("Inbox configuration unavailable", { status: 503 });
		}
		if (path === "/health" && request.method === "GET") return Response.json({ ok: true });
		if (path === "/slack/events" && request.method === "POST")
			return await receive(request, env, configured);
		if (path === "/events" || path === "/events/ack")
			return await deliver(request, env, configured);
		return new Response("Not found", { status: 404 });
	} catch (error) {
		if (error instanceof PayloadTooLarge) return new Response("Request too large", { status: 413 });
		if (error instanceof SyntaxError) return new Response("Invalid request", { status: 400 });
		return new Response("Inbox unavailable", { status: 503 });
	}
}
export default {
	fetch: handleSlackInbox,
	async scheduled(_event: unknown, env: SlackInboxEnv) {
		await env.DB.prepare(
			"UPDATE slack_inbox_events SET body='{}', acknowledgedAt=? WHERE createdAt < ? AND acknowledgedAt IS NULL",
		)
			.bind(Date.now(), Date.now() - 86_400_000)
			.run();
		await env.DB.prepare("DELETE FROM slack_inbox_events WHERE createdAt < ?")
			.bind(Date.now() - 30 * 86_400_000)
			.run();
	},
};
