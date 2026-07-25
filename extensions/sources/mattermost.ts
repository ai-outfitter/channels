/**
 * Mattermost bot mention source and exact-item actions.
 *
 * Mattermost tailors the `posted` WebSocket event per recipient: `data.mentions`
 * is a JSON-encoded array containing the connected user ID when that post
 * mentions them. The wake retains only post/channel IDs; message bodies enter
 * the session later through channel_read.
 */
import { WebSocket } from "undici";
import type {
	ChannelActions,
	ChannelContextMessage,
	ChannelEvent,
	ChannelReadResult,
	ChannelRespondResult,
	ChannelSource,
} from "./types.ts";
import { parseList, RECONNECT_DELAY_MS, scopedLog, supervise } from "./util.ts";

const log = scopedLog("mattermost");
const STRUCTURAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_CONTEXT = 10;
const DONE_EMOJI = "white_check_mark";

export interface MattermostConfig {
	baseUrl: string;
	token: string;
	/** Empty means every channel visible to the bot account. */
	channelIds: Set<string>;
}

interface MattermostLocator {
	channelId: string;
	postId: string;
	rootId?: string;
}

export interface MattermostPost {
	id: string;
	channel_id: string;
	user_id: string;
	message: string;
	root_id?: string;
	create_at?: number;
}

interface MattermostPostList {
	order: string[];
	posts: Record<string, MattermostPost>;
}

interface MattermostReaction {
	user_id: string;
	post_id: string;
	emoji_name: string;
}

export interface MattermostApi {
	me(): Promise<{ id: string }>;
	getPost(postId: string): Promise<MattermostPost>;
	getChannelContext(channelId: string, postId: string): Promise<MattermostPost[]>;
	getThreadContext(rootId: string, postId: string): Promise<MattermostPost[]>;
	getReactions(postId: string): Promise<MattermostReaction[]>;
	createPost(input: {
		channel_id: string;
		message: string;
		root_id: string;
	}): Promise<MattermostPost>;
	addReaction(reaction: MattermostReaction): Promise<void>;
}

interface SocketEvent {
	data?: unknown;
	code?: number;
}

export interface MattermostSocket {
	addEventListener(type: string, listener: (event: SocketEvent) => void): void;
	removeEventListener(type: string, listener: (event: SocketEvent) => void): void;
	send(data: string): void;
	close(code?: number, reason?: string): void;
}

export type MattermostSocketFactory = (url: string) => MattermostSocket;

const defaultSocketFactory: MattermostSocketFactory = (url) =>
	new WebSocket(url) as unknown as MattermostSocket;

export function mattermostConfigFromEnv(): MattermostConfig | undefined {
	const rawBaseUrl = process.env.MATTERMOST_BASE_URL?.trim();
	const token = process.env.MATTERMOST_BOT_TOKEN?.trim();
	if (!rawBaseUrl || !token) return undefined;
	const baseUrl = parseBaseUrl(rawBaseUrl, "MATTERMOST_BASE_URL");
	const channelIds = parseStructuralIds(
		"MATTERMOST_CHANNEL_IDS",
		process.env.MATTERMOST_CHANNEL_IDS,
	);
	return { baseUrl, token, channelIds };
}

export function createMattermostActions(
	cfg: MattermostConfig,
	api: MattermostApi = createMattermostApi(cfg),
): ChannelActions {
	let botId: Promise<string> | undefined;
	const getBotId = (): Promise<string> => {
		botId ??= api
			.me()
			.then((user) => {
				if (!STRUCTURAL_ID.test(user.id)) throw new Error("Mattermost returned an invalid bot id");
				return user.id;
			})
			.catch((error) => {
				botId = undefined;
				throw error;
			});
		return botId;
	};

	return {
		async read(locator): Promise<ChannelReadResult> {
			const decoded = decodeMattermostLocator(locator);
			const [target, reactions, rawContext, ownId] = await Promise.all([
				api.getPost(decoded.postId),
				api.getReactions(decoded.postId),
				decoded.rootId
					? api.getThreadContext(decoded.rootId, decoded.postId)
					: api.getChannelContext(decoded.channelId, decoded.postId),
				getBotId(),
			]);
			assertMatchingPost(target, decoded);
			const context = boundedPosts(rawContext, target, decoded.rootId);
			return {
				channel: "mattermost",
				locator,
				handled: reactions.some(
					(reaction) =>
						reaction.user_id === ownId &&
						reaction.post_id === decoded.postId &&
						reaction.emoji_name === DONE_EMOJI,
				),
				messages: context.map((post) => contextMessage(post, decoded.postId)),
			};
		},

		async respond(locator, response): Promise<ChannelRespondResult> {
			const decoded = decodeMattermostLocator(locator);
			const ownId = await getBotId();
			const posted = await api.createPost({
				channel_id: decoded.channelId,
				message: response,
				root_id: decoded.rootId ?? decoded.postId,
			});
			if (!STRUCTURAL_ID.test(posted.id))
				throw new Error("Mattermost returned no response post id");
			const replied = {
				channel: "mattermost",
				locator,
				replied: true,
				responseId: posted.id,
			} as const;
			try {
				await api.addReaction({
					user_id: ownId,
					post_id: decoded.postId,
					emoji_name: DONE_EMOJI,
				});
				return { ...replied, handled: true };
			} catch (error) {
				if (isAlreadyReacted(error)) return { ...replied, handled: true };
				return {
					...replied,
					handled: false,
					warning: `Adding the handled reaction failed: ${errorMessage(error)}`,
				};
			}
		},
	};
}

export function createMattermostSource(
	cfg: MattermostConfig,
	socketFactory: MattermostSocketFactory = defaultSocketFactory,
	retryMs: number = RECONNECT_DELAY_MS,
	api: MattermostApi = createMattermostApi(cfg),
): ChannelSource {
	return {
		async start(onEvent) {
			return supervise(
				async (signal) => {
					const user = await api.me();
					if (!STRUCTURAL_ID.test(user.id)) {
						throw new Error("Mattermost returned an invalid bot id");
					}
					await runMattermostAttempt(cfg, socketFactory, signal, user.id, onEvent);
				},
				log,
				retryMs,
			);
		},
	};
}

export function mattermostMentionEvent(
	raw: unknown,
	botId: string,
	channelIds: ReadonlySet<string>,
): ChannelEvent | undefined {
	if (!isRecord(raw) || raw.event !== "posted" || !isRecord(raw.data)) return undefined;
	const mentions = parseMentions(raw.data.mentions);
	if (!mentions?.includes(botId) || typeof raw.data.post !== "string") return undefined;
	let post: unknown;
	try {
		post = JSON.parse(raw.data.post);
	} catch {
		return undefined;
	}
	if (!isRecord(post)) return undefined;
	const postId = post.id;
	const channelId = post.channel_id;
	const userId = post.user_id;
	const rootId = post.root_id;
	if (
		typeof postId !== "string" ||
		!STRUCTURAL_ID.test(postId) ||
		typeof channelId !== "string" ||
		!STRUCTURAL_ID.test(channelId) ||
		typeof userId !== "string" ||
		!STRUCTURAL_ID.test(userId) ||
		userId === botId ||
		(channelIds.size > 0 && !channelIds.has(channelId)) ||
		(rootId !== undefined &&
			(typeof rootId !== "string" || (rootId !== "" && !STRUCTURAL_ID.test(rootId))))
	) {
		return undefined;
	}
	return {
		channel: "mattermost",
		summary: "new mention",
		locator: {
			key: encodeMattermostLocator({
				channelId,
				postId,
				...(typeof rootId === "string" && rootId ? { rootId } : {}),
			}),
		},
	};
}

async function runMattermostAttempt(
	cfg: MattermostConfig,
	socketFactory: MattermostSocketFactory,
	signal: AbortSignal,
	botId: string,
	onEvent: (event: ChannelEvent) => void,
): Promise<void> {
	const socket = socketFactory(websocketUrl(cfg.baseUrl));
	await new Promise<void>((resolve, reject) => {
		let settled = false;
		let authenticated = false;
		const finish = (error?: Error): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", abort);
			socket.removeEventListener("open", open);
			socket.removeEventListener("message", message);
			socket.removeEventListener("close", close);
			socket.removeEventListener("error", socketError);
			if (error) reject(error);
			else resolve();
		};
		const abort = (): void => {
			socket.close(1000, "shutdown");
			finish();
		};
		const open = (): void => {
			socket.send(
				JSON.stringify({
					seq: 1,
					action: "authentication_challenge",
					data: { token: cfg.token },
				}),
			);
		};
		const message = (event: SocketEvent): void => {
			void socketText(event.data)
				.then((text) => JSON.parse(text) as unknown)
				.then((frame) => {
					if (!authenticated) {
						authenticated = assertMattermostAuthentication(frame);
						return;
					}
					const mention = mattermostMentionEvent(frame, botId, cfg.channelIds);
					if (mention) onEvent(mention);
				})
				.catch((error) => {
					socket.close(4002, "invalid frame");
					finish(error instanceof Error ? error : new Error(String(error)));
				});
		};
		const close = (event: SocketEvent): void => {
			if (signal.aborted || event.code === 1000) finish();
			else finish(new Error(`Mattermost WebSocket closed (${event.code ?? "unknown"})`));
		};
		const socketError = (): void => finish(new Error("Mattermost WebSocket failed"));

		signal.addEventListener("abort", abort, { once: true });
		socket.addEventListener("open", open);
		socket.addEventListener("message", message);
		socket.addEventListener("close", close);
		socket.addEventListener("error", socketError);
		if (signal.aborted) abort();
	});
}

function createMattermostApi(
	cfg: MattermostConfig,
	fetchImpl: typeof fetch = fetch,
): MattermostApi {
	const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
		const response = await fetchImpl(`${cfg.baseUrl}/api/v4${path}`, {
			...init,
			headers: {
				accept: "application/json",
				authorization: `Bearer ${cfg.token}`,
				...(init?.body ? { "content-type": "application/json" } : {}),
				...init?.headers,
			},
		});
		const body = await response.text();
		if (!response.ok) {
			throw new MattermostHttpError(response.status, body || response.statusText);
		}
		return (body ? JSON.parse(body) : {}) as T;
	};
	const posts = (list: MattermostPostList): MattermostPost[] =>
		list.order.flatMap((id) => (list.posts[id] ? [list.posts[id]] : []));
	return {
		me: () => request("/users/me"),
		getPost: (postId) => request(`/posts/${encodeURIComponent(postId)}`),
		async getChannelContext(channelId, postId) {
			const list = await request<MattermostPostList>(
				`/channels/${encodeURIComponent(channelId)}/posts?before=${encodeURIComponent(postId)}&per_page=${MAX_CONTEXT - 1}`,
			);
			return posts(list).reverse();
		},
		async getThreadContext(rootId, postId) {
			const list = await request<MattermostPostList>(
				`/posts/${encodeURIComponent(rootId)}/thread?perPage=${MAX_CONTEXT}&fromPost=${encodeURIComponent(postId)}&direction=up`,
			);
			return posts(list);
		},
		getReactions: (postId) => request(`/posts/${encodeURIComponent(postId)}/reactions`),
		createPost: (input) => request("/posts", { method: "POST", body: JSON.stringify(input) }),
		async addReaction(reaction) {
			await request("/reactions", {
				method: "POST",
				body: JSON.stringify(reaction),
			});
		},
	};
}

class MattermostHttpError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

function assertMattermostAuthentication(frame: unknown): boolean {
	if (!isRecord(frame) || frame.seq_reply !== 1) return false;
	if (frame.status === "OK") return true;
	const message =
		isRecord(frame.error) && typeof frame.error.message === "string"
			? frame.error.message
			: "authentication failed";
	throw new Error(`Mattermost WebSocket authentication failed: ${message}`);
}

function boundedPosts(
	rawContext: MattermostPost[],
	target: MattermostPost,
	rootId: string | undefined,
): MattermostPost[] {
	const unique = new Map(rawContext.map((post) => [post.id, post]));
	unique.set(target.id, target);
	const ordered = [...unique.values()].sort(
		(left, right) => (left.create_at ?? 0) - (right.create_at ?? 0),
	);
	const targetIndex = ordered.findIndex((post) => post.id === target.id);
	const throughTarget = ordered.slice(0, targetIndex + 1).slice(-MAX_CONTEXT);
	if (!rootId || throughTarget.some((post) => post.id === rootId)) return throughTarget;
	const root = ordered.find((post) => post.id === rootId);
	return root ? [root, ...throughTarget.slice(-(MAX_CONTEXT - 1))] : throughTarget;
}

function contextMessage(post: MattermostPost, targetId: string): ChannelContextMessage {
	return {
		id: post.id,
		author: post.user_id,
		text: post.message,
		target: post.id === targetId,
	};
}

function assertMatchingPost(post: MattermostPost, locator: MattermostLocator): void {
	if (
		post.id !== locator.postId ||
		post.channel_id !== locator.channelId ||
		(post.root_id || undefined) !== locator.rootId
	) {
		throw new Error("Mattermost post does not match the channel locator");
	}
}

function encodeMattermostLocator(locator: MattermostLocator): string {
	const payload = {
		c: locator.channelId,
		p: locator.postId,
		...(locator.rootId ? { r: locator.rootId } : {}),
	};
	return `mattermost:v1:${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

function decodeMattermostLocator(locator: string): MattermostLocator {
	const [channel, version, encoded, extra] = locator.split(":");
	if (
		channel !== "mattermost" ||
		version !== "v1" ||
		extra !== undefined ||
		!encoded ||
		encoded.length > 768 ||
		!/^[A-Za-z0-9_-]+$/.test(encoded)
	) {
		throw new Error("invalid Mattermost channel locator");
	}
	let value: unknown;
	try {
		const bytes = Buffer.from(encoded, "base64url");
		if (bytes.toString("base64url") !== encoded) throw new Error();
		value = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error("invalid Mattermost channel locator");
	}
	if (!isRecord(value)) throw new Error("invalid Mattermost channel locator");
	const channelId = value.c;
	const postId = value.p;
	const rootId = value.r;
	if (
		typeof channelId !== "string" ||
		!STRUCTURAL_ID.test(channelId) ||
		typeof postId !== "string" ||
		!STRUCTURAL_ID.test(postId) ||
		(rootId !== undefined && (typeof rootId !== "string" || !STRUCTURAL_ID.test(rootId)))
	) {
		throw new Error("invalid Mattermost channel locator");
	}
	return { channelId, postId, ...(rootId ? { rootId } : {}) };
}

function parseMentions(raw: unknown): string[] | undefined {
	if (typeof raw !== "string") return undefined;
	try {
		const value: unknown = JSON.parse(raw);
		if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
			return undefined;
		}
		return value;
	} catch {
		return undefined;
	}
}

function parseBaseUrl(raw: string, name: string): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`${name} must be an absolute HTTP(S) URL`);
	}
	if (
		(url.protocol !== "https:" && url.protocol !== "http:") ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new Error(`${name} must be an HTTP(S) origin without credentials or query`);
	}
	url.pathname = url.pathname.replace(/\/+$/, "");
	return url.toString().replace(/\/$/, "");
}

function parseStructuralIds(name: string, raw: string | undefined): Set<string> {
	const values = parseList(raw);
	for (const value of values) {
		if (!STRUCTURAL_ID.test(value)) throw new Error(`${name} contains an invalid id: ${value}`);
	}
	return new Set(values);
}

function websocketUrl(baseUrl: string): string {
	const url = new URL(baseUrl);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/v4/websocket`;
	return url.toString();
}

async function socketText(data: unknown): Promise<string> {
	if (typeof data === "string") return data;
	if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
	if (data instanceof Uint8Array) return Buffer.from(data).toString("utf8");
	if (
		typeof data === "object" &&
		data !== null &&
		"text" in data &&
		typeof data.text === "function"
	) {
		return await data.text();
	}
	throw new Error("Mattermost WebSocket delivered an unsupported frame");
}

function isAlreadyReacted(error: unknown): boolean {
	return (
		error instanceof MattermostHttpError &&
		error.status === 400 &&
		/already|exists|duplicate/i.test(error.message)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
