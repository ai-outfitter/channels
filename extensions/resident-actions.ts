import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** Credentials stay in the pod's identity relay. This client speaks only to
 * loopback; task/run/member authority is independently checked by the platform. */
export function residentActionClient(endpoint: string, fetchImpl: typeof fetch = fetch) {
	const url = new URL(endpoint);
	if (
		url.protocol !== "http:" ||
		!["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/v1/resident-actions"
	)
		throw new Error("Resident actions require the loopback identity relay");
	return async (input: unknown, signal?: AbortSignal): Promise<unknown> => {
		const response = await fetchImpl(url, {
			method: "POST",
			redirect: "manual",
			signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(70_000)]),
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		});
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error(`Resident action refused (${response.status})`);
		}
		return readActionResponse(response);
	};
}

async function readActionResponse(response: Response): Promise<unknown> {
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	const reader = response.body?.getReader();
	if (reader)
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				bytes += value.byteLength;
				if (bytes > 1024 * 1024) throw new Error("Resident action response too large");
				chunks.push(value);
			}
		} finally {
			await reader.cancel().catch(() => {});
		}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
	} catch {
		throw new Error("Invalid resident action response");
	}
}

export function registerResidentActionTools(
	pi: ExtensionAPI,
	authorizeTask: (taskId: string) => Promise<boolean>,
	endpoint = process.env.OUTFITTER_RESIDENT_ACTIONS_URL,
	fetchImpl: typeof fetch = fetch,
): void {
	if (!endpoint) return;
	const invoke = residentActionClient(endpoint, fetchImpl);
	const task = {
		taskId: Type.String({ minLength: 1, maxLength: 2048 }),
		attemptId: Type.String({ format: "uuid" }),
		targetId: Type.String({ minLength: 1, maxLength: 128 }),
	};
	const authorize = async (taskId: string) => {
		if (!(await authorizeTask(taskId)))
			throw new Error("A2A task is not authorized for the active turn");
	};
	const result = (value: unknown) => ({
		content: [{ type: "text" as const, text: JSON.stringify(value) }],
		details: value,
	});
	pi.registerTool({
		name: "list_app_actions",
		label: "Discover app actions",
		description:
			"Discover app actions for the active A2A task's approved organization. Use attemptId and targetId from its execution context. Read organizational goals, governance and current work before submission.",
		parameters: Type.Object(task, { additionalProperties: false }),
		async execute(_id, input, signal) {
			await authorize(input.taskId);
			const value = await invoke({ ...input, operation: "list" }, signal);
			await authorize(input.taskId);
			return result(value);
		},
	});
	pi.registerTool({
		name: "call_app_action",
		label: "Invoke app action",
		description:
			"Invoke a discovered app action for the active A2A task. Current approved task, member role and package permissions are enforced. Retain the documented request ID when retrying a write.",
		parameters: Type.Object(
			{
				...task,
				installationId: Type.String({ minLength: 1, maxLength: 128 }),
				action: Type.String({ minLength: 3, maxLength: 64 }),
				input: Type.Record(Type.String(), Type.Unknown()),
			},
			{ additionalProperties: false },
		),
		async execute(_id, input, signal) {
			await authorize(input.taskId);
			const serialized = { ...input, operation: "call" };
			if (Buffer.byteLength(JSON.stringify(serialized)) > 256 * 1024)
				throw new Error("Resident action request too large");
			const value = await invoke(serialized, signal);
			await authorize(input.taskId);
			return result(value);
		},
	});
}
