import assert from "node:assert/strict";
import test from "node:test";
import {
	createJmapActions,
	decodeJmapLocator,
	encodeJmapLocator,
	type JmapApi,
	type JmapEmail,
} from "../extensions/sources/jmap.ts";
import type {
	OutboundDeliveryInput,
	SourceTaskActivationSink,
} from "../extensions/task-plane/types.ts";

const config = { baseUrl: "https://jmap.example", user: "agent@example.com", pass: "pass" };
const located = { accountId: "account/one", emailId: "email:42", threadId: "thread one" };
const locator = encodeJmapLocator(located);
const original: JmapEmail = {
	id: located.emailId,
	threadId: located.threadId,
	subject: "Deployment question",
	from: [{ name: "Ada", email: "ada@example.net" }],
	replyTo: [{ name: "Grace", email: "grace@example.net" }],
	to: [{ email: "agent@example.com" }],
	receivedAt: "2026-08-15T12:00:00Z",
	messageId: ["original@example.net"],
	references: ["root@example.net"],
	textBody: [{ partId: "plain" }],
	bodyValues: { plain: { value: "Can you check production?" } },
};

test("JMAP locator round-trips opaque exact-item identity", () => {
	assert.deepEqual(decodeJmapLocator(locator), located);
	assert.match(locator, /^jmap:v1:[A-Za-z0-9_-]+$/);
	assert.doesNotMatch(locator, /account\/one|email:42|thread one/);
	assert.throws(() => decodeJmapLocator(`${locator}:extra`), /invalid JMAP channel locator/);
});

test("JMAP read fetches and returns exactly the located email", async () => {
	const gets: Array<typeof located> = [];
	const api: JmapApi = {
		async getEmail(item) {
			gets.push(item as typeof located);
			return original;
		},
		async sendReply() {
			throw new Error("unused");
		},
		async findReply() {
			throw new Error("unused");
		},
	};
	const actions = createJmapActions(config, api, sink());
	const result = await actions.read(locator);

	assert.deepEqual(gets, [located]);
	assert.equal(result.messages.length, 1);
	assert.deepEqual(result.messages[0], {
		id: located.emailId,
		author: "Ada <ada@example.net>",
		text: [
			"Subject: Deployment question",
			"From: Ada <ada@example.net>",
			"To: agent@example.com",
			"Date: 2026-08-15T12:00:00Z",
			"",
			"Can you check production?",
		].join("\n"),
		target: true,
	});
});

test("JMAP respond records one lookup-recoverable delivery and preserves reply identity", async () => {
	const sends: Array<{
		item: typeof located;
		text: string;
		deliveryId: string;
		original: JmapEmail;
	}> = [];
	const deliveries: OutboundDeliveryInput[] = [];
	const api: JmapApi = {
		async getEmail() {
			return original;
		},
		async sendReply(item, email, text, deliveryId) {
			sends.push({ item: item as typeof located, original: email, text, deliveryId });
			return "submission-1";
		},
		async findReply() {
			return undefined;
		},
	};
	const actions = createJmapActions(
		config,
		api,
		sink({
			async deliver(input, send) {
				deliveries.push(input);
				return send();
			},
		}),
	);

	assert.deepEqual(await actions.respond(locator, "Production is healthy."), {
		channel: "jmap",
		locator,
		replied: true,
		handled: true,
		responseId: "submission-1",
	});
	assert.equal(sends.length, 1);
	assert.deepEqual(sends[0]?.item, located);
	assert.equal(sends[0]?.original, original);
	assert.equal(sends[0]?.text, "Production is healthy.");
	assert.match(sends[0]?.deliveryId ?? "", /^delivery-[a-f0-9]{40}$/);
	assert.deepEqual(deliveries, [
		{
			taskId: "task-1",
			source: "jmap",
			operationId: `reply:${locator}`,
			payloadDigest: deliveries[0]?.payloadDigest,
			recovery: "lookup",
		},
	]);
});

test("JMAP HTTP reply submits one correctly threaded response", async () => {
	const originalFetch = globalThis.fetch;
	const submissionCapability = "urn:ietf:params:jmap:submission";
	let submissionRequest:
		| { methodCalls: Array<[string, Record<string, unknown>, string]> }
		| undefined;
	let emailGetRequest: Record<string, unknown> | undefined;
	let emailGetCalls = 0;
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the protocol fake keeps capability rejection and each response beside the request it validates
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith("/.well-known/jmap")) {
			const response = Response.json({
				apiUrl: "https://jmap.example/api/{accountId}",
				eventSourceUrl: "https://jmap.example/events?types={types}",
				primaryAccounts: { "urn:ietf:params:jmap:mail": located.accountId },
			});
			Object.defineProperty(response, "url", { value: url });
			return response;
		}
		const request = JSON.parse(String(init?.body)) as {
			using: string[];
			methodCalls: Array<[string, Record<string, unknown>, string]>;
		};
		const missingSubmission = request.methodCalls.find(
			([method]) =>
				(method.startsWith("Identity/") || method.startsWith("EmailSubmission/")) &&
				!request.using.includes(submissionCapability),
		);
		if (missingSubmission) {
			return Response.json({
				methodResponses: [
					[
						"error",
						{ type: "unknownMethod", description: "capability is missing from using" },
						missingSubmission[2],
					],
				],
			});
		}
		if (request.methodCalls.length === 2) {
			submissionRequest = request;
			const submissionCreationId = Object.keys(
				(request.methodCalls[1]?.[1].create ?? {}) as Record<string, unknown>,
			)[0];
			assert.ok(submissionCreationId);
			const emailCreationId = Object.keys(
				(request.methodCalls[0]?.[1].create ?? {}) as Record<string, unknown>,
			)[0];
			assert.ok(emailCreationId);
			return Response.json({
				methodResponses: [
					["Email/set", { created: { [emailCreationId]: { id: "reply-email-1" } } }, "email"],
					[
						"EmailSubmission/set",
						{ created: { [submissionCreationId]: { id: "submission-http-1" } } },
						"submission",
					],
				],
			});
		}
		const [method, _args, callId] = request.methodCalls[0] ?? [];
		if (method === "Email/get") {
			assert.ok(_args);
			emailGetCalls += 1;
			emailGetRequest = _args;
			const requestedId = (_args.ids as string[])[0];
			return Response.json({
				methodResponses: [[method, { list: [{ ...original, id: requestedId }] }, callId]],
			});
		}
		if (method === "Identity/get") {
			return Response.json({
				methodResponses: [
					[method, { list: [{ id: "identity-1", email: "agent@example.com" }] }, callId],
				],
			});
		}
		if (method === "Mailbox/get") {
			return Response.json({
				methodResponses: [
					[
						method,
						{
							list: [
								{ id: "drafts", role: "drafts" },
								{ id: "sent", role: "sent" },
							],
						},
						callId,
					],
				],
			});
		}
		if (method === "Email/query") {
			return Response.json({ methodResponses: [[method, { ids: [] }, callId]] });
		}
		throw new Error(`unexpected JMAP method ${method}`);
	}) as typeof fetch;
	try {
		const actions = createJmapActions(
			config,
			undefined,
			sink({
				async taskForLocator() {
					return "task-1";
				},
				async deliver(_input, send) {
					return send();
				},
			}),
		);
		const result = await actions.respond(locator, "Production is healthy.");
		assert.equal(result.responseId, "reply-email-1");
		const forgedLocator = encodeJmapLocator({
			accountId: "account/two",
			emailId: "email:forged",
		});
		await assert.rejects(
			actions.read(forgedLocator),
			/JMAP channel locator is outside the configured mail account/,
		);
		assert.equal(emailGetCalls, 1, "a forged account locator must not reach Email/get");
	} finally {
		globalThis.fetch = originalFetch;
	}

	assert.ok(submissionRequest);
	assert.ok(emailGetRequest);
	assert.ok((emailGetRequest.properties as string[]).includes("replyTo"));
	assert.equal(emailGetRequest.maxBodyValueBytes, 64_000);
	assert.deepEqual(
		submissionRequest.methodCalls.map(([method]) => method),
		["Email/set", "EmailSubmission/set"],
	);
	const emailCreate = submissionRequest.methodCalls[0]?.[1].create as Record<
		string,
		Record<string, unknown>
	>;
	const creationId = Object.keys(emailCreate)[0];
	assert.ok(creationId);
	const deliveryId = emailCreate[creationId]?.["header:X-AI-Outfitter-Delivery-ID:asText"];
	assert.match(String(deliveryId), /^delivery-[a-f0-9]{40}$/);
	assert.deepEqual(emailCreate[creationId], {
		mailboxIds: { drafts: true },
		keywords: { $draft: true },
		from: [{ email: "agent@example.com" }],
		to: [{ name: "Grace", email: "grace@example.net" }],
		subject: "Re: Deployment question",
		"header:In-Reply-To:asMessageIds": ["original@example.net"],
		"header:References:asMessageIds": ["root@example.net", "original@example.net"],
		"header:X-AI-Outfitter-Delivery-ID:asText": deliveryId,
		bodyStructure: { type: "text/plain", partId: "body" },
		bodyValues: { body: { value: "Production is healthy." } },
	});
	const submissionCreate = submissionRequest.methodCalls[1]?.[1].create as Record<
		string,
		Record<string, unknown>
	>;
	const submissionCreationId = Object.keys(submissionCreate)[0];
	assert.ok(submissionCreationId);
	assert.notEqual(submissionCreationId, creationId);
	assert.deepEqual(submissionCreate[submissionCreationId], {
		identityId: "identity-1",
		emailId: `#${creationId}`,
	});
});

test("JMAP retry does not reconcile an unsent draft and resubmits that exact draft", async () => {
	const originalFetch = globalThis.fetch;
	const draftId = "reply-email-from-partial-set";
	let draftDeliveryId: string | undefined;
	let isDraft = false;
	let isSent = false;
	let emailCreates = 0;
	let submissionAttempts = 0;
	const queryFilters: Record<string, unknown>[] = [];
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the stateful protocol fake makes the partial Email/set and retry submission sequence explicit
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith("/.well-known/jmap")) {
			const response = Response.json({
				apiUrl: "https://jmap.example/api/{accountId}",
				eventSourceUrl: "https://jmap.example/events?types={types}",
				primaryAccounts: { "urn:ietf:params:jmap:mail": located.accountId },
			});
			Object.defineProperty(response, "url", { value: url });
			return response;
		}
		const request = JSON.parse(String(init?.body)) as {
			methodCalls: Array<[string, Record<string, unknown>, string]>;
		};
		if (request.methodCalls.length === 2) {
			emailCreates += 1;
			submissionAttempts += 1;
			const emailCreate = request.methodCalls[0]?.[1].create as Record<
				string,
				Record<string, unknown>
			>;
			const emailCreationId = Object.keys(emailCreate)[0];
			assert.ok(emailCreationId);
			draftDeliveryId = String(
				emailCreate[emailCreationId]?.["header:X-AI-Outfitter-Delivery-ID:asText"],
			);
			isDraft = true;
			return Response.json({
				methodResponses: [
					["Email/set", { created: { [emailCreationId]: { id: draftId } } }, "email"],
					[
						"error",
						{ type: "serverFail", description: "submission failed after draft create" },
						"submission",
					],
				],
			});
		}
		const [method, args, callId] = request.methodCalls[0] ?? [];
		if (method === "Email/get") {
			return Response.json({ methodResponses: [[method, { list: [original] }, callId]] });
		}
		if (method === "Identity/get") {
			return Response.json({
				methodResponses: [
					[method, { list: [{ id: "identity-1", email: "agent@example.com" }] }, callId],
				],
			});
		}
		if (method === "Mailbox/get") {
			return Response.json({
				methodResponses: [
					[
						method,
						{
							list: [
								{ id: "drafts", role: "drafts" },
								{ id: "sent", role: "sent" },
							],
						},
						callId,
					],
				],
			});
		}
		if (method === "Email/query") {
			assert.ok(args);
			const filter = args.filter as Record<string, unknown>;
			queryFilters.push(filter);
			const queriedDeliveryId = (filter.header as string[])[1];
			assert.match(queriedDeliveryId ?? "", /^delivery-[a-f0-9]{40}$/);
			if (draftDeliveryId) assert.equal(queriedDeliveryId, draftDeliveryId);
			const ids =
				filter.hasKeyword === "$draft" && isDraft
					? [draftId]
					: filter.notKeyword === "$draft" && isSent
						? [draftId]
						: filter.hasKeyword === undefined && filter.notKeyword === undefined && isDraft
							? [draftId]
							: [];
			return Response.json({ methodResponses: [[method, { ids }, callId]] });
		}
		if (method === "EmailSubmission/set") {
			assert.ok(args);
			submissionAttempts += 1;
			const create = args.create as Record<string, { emailId?: string }>;
			const submissionCreationId = Object.keys(create)[0];
			assert.ok(submissionCreationId);
			assert.equal(create[submissionCreationId]?.emailId, draftId);
			isDraft = false;
			isSent = true;
			return Response.json({
				methodResponses: [
					[
						method,
						{ created: { [submissionCreationId]: { id: "submission-after-retry" } } },
						callId,
					],
				],
			});
		}
		throw new Error(`unexpected JMAP method ${method}`);
	}) as typeof fetch;
	let deliveryAttempt = 0;
	try {
		const actions = createJmapActions(
			config,
			undefined,
			sink({
				async deliver(_input, send, reconcile) {
					deliveryAttempt += 1;
					if (deliveryAttempt > 1) {
						const found = await reconcile?.();
						if (found) return found;
					}
					return send();
				},
			}),
		);
		await assert.rejects(
			actions.respond(locator, "Production is healthy."),
			/EmailSubmission\/set failed: submission failed after draft create/,
		);
		const recovered = await actions.respond(locator, "Production is healthy.");
		assert.equal(recovered.responseId, draftId);
	} finally {
		globalThis.fetch = originalFetch;
	}

	assert.equal(emailCreates, 1, "retry must reuse rather than duplicate the stray draft");
	assert.equal(submissionAttempts, 2, "the retry must actually submit after reconciliation misses");
	assert.equal(isDraft, false);
	assert.equal(isSent, true);
	assert.ok(queryFilters.some((filter) => filter.notKeyword === "$draft"));
	assert.ok(queryFilters.some((filter) => filter.hasKeyword === "$draft"));
});

test("JMAP crash-after-send recovery finds the delivery header without a duplicate", async () => {
	const submissions = new Map<string, string>();
	let providerMutations = 0;
	const api: JmapApi = {
		async getEmail() {
			return original;
		},
		async sendReply(_item, _email, _text, deliveryId) {
			providerMutations += 1;
			submissions.set(deliveryId, "sent-email-after-crash");
			return "submission-after-crash";
		},
		async findReply(_item, deliveryId) {
			return submissions.get(deliveryId);
		},
	};
	let deliveryAttempt = 0;
	const actions = createJmapActions(
		config,
		api,
		sink({
			async deliver(input, send, reconcile) {
				assert.equal(input.recovery, "lookup");
				deliveryAttempt += 1;
				if (deliveryAttempt > 1) {
					const found = await reconcile?.();
					if (found) return found;
				}
				const result = await send();
				if (deliveryAttempt === 1) throw new Error("crash after provider accepted submission");
				return result;
			},
		}),
	);

	await assert.rejects(
		actions.respond(locator, "Production is healthy."),
		/crash after provider accepted submission/,
	);
	const recovered = await actions.respond(locator, "Production is healthy.");
	assert.equal(recovered.responseId, "sent-email-after-crash");
	assert.equal(providerMutations, 1);
	assert.equal(submissions.size, 1);
});

function sink(overrides: Partial<SourceTaskActivationSink> = {}): SourceTaskActivationSink {
	return {
		async accept() {
			throw new Error("unused");
		},
		async continue() {
			throw new Error("unused");
		},
		async taskForLocator(source, exactLocator) {
			assert.equal(source, "jmap");
			assert.equal(exactLocator, locator);
			return "task-1";
		},
		...overrides,
	};
}
