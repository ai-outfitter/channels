# A2A task plane

Channels adopts [A2A v1](https://github.com/a2aproject/A2A) as its common
task protocol ([RFC #35](https://github.com/ai-outfitter/channels/issues/35)).
This module provides the HTTP+JSON server binding, durable task store,
mandatory idempotency rule, Outfitter task and origin extensions, relay, and
resident-agent bridge. Slack, GitHub, Chatto, and JMAP intake submits work
through the in-process local task plane.

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
| `/tasks` | GET | List the caller's tasks, filtered by `contextId`, `status`, `statusTimestampAfter`, paged with `pageSize` and `pageToken` |
| `/tasks/{id}` | GET | Read one task's durable state |
| `/tasks/{id}:subscribe` | GET | SSE stream of updates for a non-terminal task |
| `/tasks/{id}:cancel` | POST | Cancel a non-terminal task |
| `/artifacts` | POST | Store up to 32 MiB by digest and return an `outfitter-artifact/v1` URL Part |
| `/artifacts/{sha256}` | GET | Read and verify one artifact; bearer authentication is required |
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
  explicit `409 DUPLICATE_MESSAGE_ID`, never a silent replay. The key is
  claimed before the executor runs. A duplicate that arrives before the
  executor binds a Task gets `409 DUPLICATE_MESSAGE_IN_PROGRESS`. After
  `begin()` atomically binds the claim and Task, a concurrent duplicate
  replays that Task immediately. It never executes a second time.
- **Recovery uses durable state.** Streams are ephemeral; the durable Task —
  status, history, artifacts — is the record. A reconnecting client reads
  the Task, then opens a new subscription; nothing replays.
- **Server-scoped identity.** The server mints every task id; a client never
  supplies one. A task id resolves only on the server that minted it, so
  equal ids from two servers cannot collide. The full identity of a task is
  its locator: interface URL, binding, version, tenant, and task id. Every
  Task emits that locator in the optional `outfitter-task/v1` extension
  ([schema](./extensions/outfitter-task.v1.schema.json)). The server validates
  the extension fields that it reads. A client-supplied `contextId` attaches only when the
  same principal already owns it; a foreign or unknown `contextId` gets a
  fresh context instead of joining local work.
- **Interrupted is not terminal.** `INPUT_REQUIRED` and `AUTH_REQUIRED`
  settle a blocking send and remain subscribable and continuable; only
  completed/failed/canceled/rejected are final.
- **A blocking send is bounded.** At `blockingTimeoutMs` (default 60 s) the
  send returns the task's current snapshot rather than holding the socket;
  the client continues by polling or subscribing.
- **Streaming shows what happens after you connect.** An executor that
  settles the task before returning (a fast inline executor) emits its
  updates before the `message:stream` forwarder attaches, so the client
  receives only the final `{task}` frame — the durable state carries
  everything regardless. The resident-agent bridge returns at `working`, so
  its status and artifact updates stream live.
- **Tasks bind policy and evidence.** Every new Task carries an
  `outfitter-task/v1` Ticket Run, full Task locator, immutable policy-bundle
  digest, idempotency scope, and evidence record references. The resident
  default policy supplies the digest unless an operator selects another
  policy. Message content cannot select the policy.
- **Evidence is a separate plane.** `A2A_EVIDENCE_CONFIG_PATH` names a JSON
  file with `rootPath`, `actor`, and `policy`. The development sink stores
  payloads once by SHA-256 and appends versioned action records. Pi tool hooks
  capture the exact request before execution and the exact result after it.
  A required capture failure blocks Task completion. The run manifest verifies
  all required record classes and payload digests. This local sink does not
  claim compliance-grade retention.
- **Large Artifacts are references.** `A2A_ARTIFACT_STORE_PATH` can override
  the default `$HOME/.channels/task-plane/artifacts` directory.
  `POST /artifacts` accepts base64 bytes, stores them by SHA-256, and returns an
  Artifact with an authenticated URL and typed digest metadata
  ([schema](./extensions/outfitter-artifact.v1.schema.json)). Reads recompute
  the digest and require the caller's bearer token. Inline A2A Parts remain
  bounded by the normal message limit.

## Resident-agent bridge

`extensions/a2a-extension.ts` hosts the server inside a resident Pi profile.
`A2A_SERVER=1` opens the external listener; without it the plane still runs
in-process for local channel intake. Everything else defaults under
`$HOME/.channels/task-plane`: `A2A_STORE_PATH` (`tasks.json`),
`A2A_ARTIFACT_STORE_PATH` (`artifacts/`), `A2A_ORIGIN_STORE_PATH`
(`origins.json`), and the evidence root (`evidence/`).
`A2A_CREDENTIALS_PATH` (`{"credentials": [{"token", "principal"}]}`) is
required only when the external listener is enabled. `A2A_HOST`/`A2A_PORT`
default to loopback:8788; `A2A_PUBLIC_URL` / `A2A_AGENT_NAME` /
`A2A_AGENT_DESCRIPTION` / `A2A_AGENT_VERSION` describe the Card.
For a resident, `A2A_POLICY_BUNDLE_DIGEST` and `A2A_EVIDENCE_CONFIG_PATH` fall
back to the default evidence policy. A relay authority MUST receive an explicit
policy digest because it has no resident evidence runtime.

The default evidence policy permits `channel_read`, `channel_respond`, the
`mcp` adapter tool, and the `mcp__*` direct-tool namespace. The Pi profile loadout and this evidence policy form
an intersection. Operator MAY mount another evidence policy to narrow that
set. Outbound A2A delegation is captured and requires explicit policy approval.

Loading Channels starts the local task plane unless `OUTFITTER_CHANNELS` is
`off` or `none`. A profile does not need an A2A enable flag, path, port,
credential, or resident identity setting for native channel work. Operator
supplies the generic `AGENT_NAME` input and MAY select channels with
`OUTFITTER_CHANNELS`.

One process owns the default task store at a time. Startup fails if another
live process owns its lease. This prevents two Pi sessions from replacing the
same JSON store from independent memory snapshots.

An inbound message becomes a durable task plus a **body-free wake** — the
same untrusted-content rule as every channel source. The agent then drives
the task with three tools. For native work, the wake also carries the validated
channel name and opaque locator. It instructs the agent to use `channel_read`
and `channel_respond` without copying any message body into trusted text.

- `a2a_read_task` — read the task's history inside untrusted-content markers.
- `a2a_complete_task` — record the response as an artifact and complete, or
  reject with a reason.
- `a2a_require_input` — pause the task on the caller with a question; the
  task enters `input-required` and the caller's answer arrives as a new wake
  on the same task. This is the protocol-native structured-question surface
  ([#27](https://github.com/ai-outfitter/channels/issues/27)).

## Local task plane

`extensions/local-task-plane.ts` turns a native channel event into a task on
the in-process server. A source that fills `ChannelEvent.work` routes through
it instead of the wake queue; the A2A message id is derived from the source
kind and provider event id, so the server deduplicates a provider redelivery.
Native event bodies do not enter a trusted wake. The task history contains a
structural locator that the resident agent uses with the channel adapter.

After `channel_respond` performs a native response, the plane records the
delivery result against the exact activation and Task in the origin store.
This state is separate from A2A Task completion.

JMAP email intake uses `$HOME/.channels/task-plane/jmap-email-state.json` as its
durable cursor file. `JMAP_STATE_PATH` MAY override that path.
It establishes an initial Email state, reconciles every later push with
`Email/changes`, fetches each created item with `Email/get`, persists the A2A
activation, and only then advances the cursor. Each task therefore carries an
exact account and email id instead of a generic “mail changed” signal.

## Relay deployment

The relay is an external A2A endpoint for agents that cannot accept inbound
traffic. `A2A_RELAY_SERVER=1` starts the public authority. It always opens the
A2A listener and therefore MUST receive `A2A_CREDENTIALS_PATH` and
`A2A_POLICY_BUNDLE_DIGEST`. Operator MUST also project
`A2A_RELAY_AGENT_ID`, `A2A_RELAY_QUEUE_PATH`,
`A2A_RELAY_ORIGIN_STORE_PATH`, `A2A_RELAY_WORKER_CREDENTIALS_PATH`,
`A2A_RELAY_HOST`, `A2A_RELAY_PORT`, `A2A_RELAY_TLS_KEY_PATH`, and
`A2A_RELAY_TLS_CERT_PATH`. `A2A_RELAY_ALLOW_INSECURE_LOOPBACK=1` MAY replace
connector TLS only for a loopback development process.

A private resident worker sets `A2A_RELAY_CONNECTOR_FILE` to its connector
configuration. Its task tools use the `a2a_relay_*` prefix, so they can coexist
with the local task-plane tools. Relay settings belong to relay workloads. A
resident that only handles native channels MUST NOT repeat them.

## Verification gates

`tests/a2a-task-plane.test.ts` proves, by name, the gates from the RFC's
conformance note: equal task ids from two servers do not collide; a foreign
`contextId` does not join local work; a reconnect can miss transient
messages without losing critical state; a duplicate direct Message returns
its prior direct result; a follow-up message continues the same non-terminal
task; an unsupported A2A version fails explicitly; subscribe is `GET`,
streams, and rejects terminal tasks.
