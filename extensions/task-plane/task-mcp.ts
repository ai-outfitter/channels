// Keep Pi's parser, client, transports and tool pipeline native. Pi1.4 exports
// the extension hooks but not their default delegates; this adapter intentionally
// supports exactly that tested package layout until those helpers are public.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	createCodemodeExtension,
	createMcpExtension,
	createToolSearchExtension,
	type ExtensionAPI,
	getAgentDir,
	type InlineExtension,
	type LoadedMcpConfig,
	type McpExtensionOptions,
	type McpTransportFactory,
} from "@earendil-works/pi-coding-agent";
import { type McpFetch, StreamableHttpTransport } from "@earendil-works/pi-mcp";

export const SUPPORTED_TASK_MCP_PI_VERSION = "1.4.0";
const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
const manifest = JSON.parse(readFileSync(new URL("../package.json", entry), "utf8"));
if (manifest.version !== SUPPORTED_TASK_MCP_PI_VERSION)
	throw new Error(`Task MCP requires Pi ${SUPPORTED_TASK_MCP_PI_VERSION}`);
const config = (await import(new URL("./extensions/mcp/config.js", entry).href)) as {
	loadMcpConfig(options: {
		agentDir: string;
		cwd: string;
		projectTrusted: boolean;
	}): LoadedMcpConfig;
};
const runtime = (await import(new URL("./extensions/mcp/runtime.js", entry).href)) as {
	createDefaultTransport: McpTransportFactory;
	McpOAuthCredentialStore: new (
		backend: unknown,
		lockDir: string,
	) => NonNullable<McpExtensionOptions["credentials"]>;
};
const auth = (await import(new URL("./core/auth-storage.js", entry).href)) as {
	FileAuthStorageBackend: new (path: string) => unknown;
};
if (!config.loadMcpConfig || !runtime.createDefaultTransport || !auth.FileAuthStorageBackend)
	throw new Error("Unsupported Pi native MCP helper layout");

/** A trusted session binding, not model-supplied tool parameters. */
export interface TaskMcpServer {
	readonly name: string;
	readonly url: string;
	readonly applies?: (taskId: string) => boolean;
	/** Must verify active queue ownership AND the actual Task's nonterminal state. */
	readonly hasAuthority?: (taskId: string) => Promise<boolean>;
}
export const TASK_MCP_HEADER = "A2A-Task-Id";
const TASK_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Only the credential-free loopback relay may receive session authority. */
export function taskMcpServer(
	endpoint: string | undefined,
	applies?: (taskId: string) => boolean,
	hasAuthority?: (taskId: string) => Promise<boolean>,
	name = "task",
): TaskMcpServer | undefined {
	if (!endpoint?.trim()) return undefined;
	const url = new URL(endpoint.trim());
	if (
		url.protocol !== "http:" ||
		!["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new Error("CHANNELS_TASK_MCP_URL must be a loopback http URL without credentials");
	return {
		name,
		url: url.href,
		...(applies ? { applies } : {}),
		...(hasAuthority ? { hasAuthority } : {}),
	};
}

function guardedFetch(server: TaskMcpServer, taskId: string): McpFetch {
	const check = async (signal?: AbortSignal | null): Promise<void> => {
		signal?.throwIfAborted();
		if (!(await server.hasAuthority?.(taskId))) throw new Error("Task MCP authority unavailable");
		signal?.throwIfAborted();
	};
	return async (url, init) => {
		await check(init?.signal);
		if (new URL(url).href !== server.url) throw new Error("Task MCP relay changed");
		// No human OAuth or caller Authorization may accompany workload traffic.
		const headers = new Headers(init?.headers);
		headers.delete("authorization");
		headers.set(TASK_MCP_HEADER, taskId);
		const response = await fetch(url, { ...init, headers, redirect: "error" });
		return checkedResponse(response, check, init?.signal);
	};
}

async function checkedResponse(
	response: Response,
	check: (signal?: AbortSignal | null) => Promise<void>,
	signal?: AbortSignal | null,
): Promise<Response> {
	const reader = response.body?.getReader();
	const cancel = (): void => {
		void reader?.cancel().catch(() => {});
	};
	signal?.addEventListener("abort", cancel, { once: true });
	try {
		await check(signal);
		const parts: Uint8Array[] = [];
		let bytes = 0;
		if (reader)
			for (;;) {
				const next = await reader.read();
				await check(signal);
				if (next.done) break;
				bytes += next.value.byteLength;
				if (bytes > MAX_RESPONSE_BYTES) throw new Error("Task MCP response too large");
				parts.push(next.value);
			}
		await check(signal);
		const body = new Uint8Array(bytes);
		let offset = 0;
		for (const part of parts) {
			body.set(part, offset);
			offset += part.byteLength;
		}
		return new Response(response.status === 204 || response.status === 304 ? null : body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	} finally {
		signal?.removeEventListener("abort", cancel);
		await reader?.cancel().catch(() => {});
	}
}

/** Register a native client/catalog per session, preserving other declared servers. */
export function taskSessionMcpExtensions(
	taskId: string,
	server: TaskMcpServer | undefined,
	agentDir = getAgentDir(),
): InlineExtension[] {
	const selected = server && (!server.applies || server.applies(taskId)) ? server : undefined;
	if (selected && !TASK_ID.test(taskId)) throw new Error("Task cannot select a task MCP server");
	const options: McpExtensionOptions = {
		loadConfig: (ctx) => {
			const loaded = config.loadMcpConfig({
				agentDir,
				cwd: ctx.cwd,
				projectTrusted: ctx.isProjectTrusted(),
			});
			// mcp.json normally overrides native registrations. Reserve the task
			// namespace even for non-A2A sessions: configuration cannot impersonate it.
			if (server)
				loaded.servers = loaded.servers.filter(
					(entry) => entry.name.replaceAll("-", "_") !== server.name.replaceAll("-", "_"),
				);
			return loaded;
		},
		credentials: new runtime.McpOAuthCredentialStore(
			new auth.FileAuthStorageBackend(join(agentDir, "mcp-auth.json")),
			agentDir,
		),
		logPath: join(agentDir, "mcp.log"),
		createTransport: (entry, cwd, authProvider) => {
			if (!selected || entry.name !== selected.name)
				return runtime.createDefaultTransport(entry, cwd, authProvider);
			if (
				entry.scope !== "extension" ||
				!("url" in entry.config) ||
				entry.config.url !== selected.url
			)
				throw new Error("Task MCP registration changed");
			return new StreamableHttpTransport({
				url: selected.url,
				headers: { [TASK_MCP_HEADER]: taskId },
				fetch: guardedFetch(selected, taskId),
				openGetStream: false,
			});
		},
	};
	const builtins: InlineExtension[] = [
		{ name: "codemode", factory: createCodemodeExtension(), replaceable: true, builtin: true },
		{ name: "tool-search", factory: createToolSearchExtension(), replaceable: true, builtin: true },
		{ name: "mcp", factory: createMcpExtension(options), replaceable: false, builtin: true },
	] as InlineExtension[];
	if (!selected) return builtins;
	return [
		...builtins,
		{
			name: "task-mcp",
			hidden: true,
			factory: (api: ExtensionAPI) =>
				api.registerMcpServer(selected.name, {
					url: selected.url,
					headers: { [TASK_MCP_HEADER]: taskId },
					exposure: "direct",
				}),
		},
	];
}
