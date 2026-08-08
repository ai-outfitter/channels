# A2A task plane

Channels adopts [A2A v1](https://github.com/a2aproject/A2A) as its common
task protocol ([RFC #35](https://github.com/ai-outfitter/channels/issues/35)).
This module is the first contract commit: the HTTP+JSON server binding, the
durable task store, the mandatory idempotency rule, the Outfitter task
extension, and the resident-agent bridge. Native adapters (Slack, GitHub,
Chatto, JMAP) keep their own event intake and result delivery; wiring them
through this plane is later work under the RFC.

## Pinned protocol source

The data model derives from the authoritative Protocol Buffer model at A2A
release `v1.0.1`, commit `3303592588e388e62e0f69f701af531d2f4e3991`, vendored
with provenance at [`extensions/vendor/a2a/`](../extensions/vendor/a2a/README.md).
Wire names follow ProtoJSON. An upgrade is an explicit compatibility change.

Two upstream inconsistencies, resolved as follows:

- **Subscribe method.** The v1.0.1 prose maps `SubscribeToTask` to `POST`;
  the authoritative proto annotation says `GET`, and upstream
  [a2aproject/A2A#2068](https://github.com/a2aproject/A2A/pull/2068) corrects
  the prose to `GET`. This implementation serves `GET /tasks/{id}:subscribe`.
  `GET` is also the only method a browser-native `EventSource` can issue.
- **Error format.** §6.4 shows `application/problem+json` for the version
  error while §11.6 defines the normative `google.rpc.Status` JSON error
  model. This implementation uses §11.6 uniformly: every error body carries
  `code`, `message`, and a `google.rpc.ErrorInfo` detail with an A2A `reason`
  and `domain: "a2a-protocol.org"`.

## Surface

| Route | Method | Purpose |
| --- | --- | --- |
| `/.well-known/agent-card.json` | GET | Public Agent Card: streaming on, push notifications off, `outfitter-task/v1` extension declared |
| `/message:send` | POST | Send a message; blocks until the task settles unless `configuration.returnImmediately` |
| `/message:stream` | POST | Send and stream `task` / `statusUpdate` / `artifactUpdate` frames over SSE |
| `/tasks` | GET | List the caller's tasks, filtered by `contextId`, `status`, `statusTimestampAfter` |
| `/tasks/{id}` | GET | Read one task's durable state |
| `/tasks/{id}:subscribe` | GET | SSE stream of updates for a non-terminal task |
| `/tasks/{id}:cancel` | POST | Cancel a non-terminal task |
| `/tasks/{task_id}/pushNotificationConfigs*` | * | Explicit `501` — the Card declares `pushNotifications: false` |

Version negotiation: an `A2A-Version` header other than `1.0` fails
explicitly with `VERSION_NOT_SUPPORTED`. Authentication is bearer-token; each
token maps to a principal, and every task and dedupe record is scoped to it.

## Contract decisions

- **Message versus Task is the executor's decision.** A simple interaction
  returns a direct A2A Message and no Task ever exists; work mints a Task.
  Task creation grants no authority — nothing in an inbound message selects
  an agent, tool set, or workflow topology.
- **Idempotency is mandatory and stronger than the A2A minimum.** Scope:
  `(authenticated principal, messageId)`. Stored outcome: the full prior
  result — the created Task (a duplicate returns that Task) or the direct
  Message verbatim. Retention: 30 days, never shorter than the referenced
  task's life. A duplicate `messageId` with a different payload is an
  explicit `409 DUPLICATE_MESSAGE_ID`, never a silent replay.
- **Recovery uses durable state.** Streams are ephemeral; the durable Task —
  status, history, artifacts — is the record. A reconnecting client reads
  the Task, then opens a new subscription; nothing replays.
- **Server-scoped identity.** The server mints every task id. Equal ids from
  two servers cannot collide because identity is the locator (interface URL
  + binding + version + tenant + taskId), carried by the `outfitter-task/v1`
  extension ([schema](./extensions/outfitter-task.v1.schema.json)). A
  client-supplied `contextId` attaches only when the same principal already
  owns it; a foreign or unknown `contextId` gets a fresh context instead of
  joining local work.
- **Interrupted is not terminal.** `INPUT_REQUIRED` and `AUTH_REQUIRED`
  settle a blocking send and remain subscribable and continuable; only
  completed/failed/canceled/rejected are final.

## Resident-agent bridge

`extensions/a2a-extension.ts` hosts the server inside a resident Pi profile.
Inert unless `A2A_SERVER=1`; configuration is `A2A_STORE_PATH` (required),
`A2A_CREDENTIALS_PATH` (required, `{"credentials": [{"token", "principal"}]}`),
`A2A_HOST`/`A2A_PORT` (default loopback:8788), and `A2A_PUBLIC_URL` /
`A2A_AGENT_NAME` / `A2A_AGENT_DESCRIPTION` / `A2A_AGENT_VERSION` for the Card.

An inbound message becomes a durable task plus a **body-free wake** — the
same untrusted-content rule as every channel source. The agent then drives
the task with three tools:

- `a2a_read_task` — read the task's history inside untrusted-content markers.
- `a2a_complete_task` — record the response as an artifact and complete, or
  reject with a reason.
- `a2a_require_input` — pause the task on the caller with a question; the
  task enters `input-required` and the caller's answer arrives as a new wake
  on the same task. This is the protocol-native structured-question surface
  ([#27](https://github.com/ai-outfitter/channels/issues/27)).

## Verification gates

`tests/a2a-task-plane.test.ts` proves, by name, the gates from the RFC's
conformance note: equal task ids from two servers do not collide; a foreign
`contextId` does not join local work; a reconnect can miss transient
messages without losing critical state; a duplicate direct Message returns
its prior direct result; a follow-up message continues the same non-terminal
task; an unsupported A2A version fails explicitly; subscribe is `GET`,
streams, and rejects terminal tasks.
