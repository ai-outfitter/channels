# A2A task plane

Channels adopts [A2A v1](https://github.com/a2aproject/A2A) as its common
task protocol ([RFC #35](https://github.com/ai-outfitter/channels/issues/35)).
This module is the first contract commit. It defines the HTTP+JSON server
binding and the durable task store. It also defines the mandatory idempotency
rule, the Outfitter task extension, and the resident-agent bridge. Native
adapters keep their own event intake and result delivery. The
[source conformance matrix](./a2a-source-conformance.md) defines their
source-specific contracts.

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

## Task and conversation semantics

This section states the implemented contract for the task-plane milestone.

Message versus Task is the executor's decision. Work mints a Task. A simple
interaction returns a direct A2A Message and no Task ever exists. For an
activation that mints a Task, the rules below apply.

Each provider event that is not a continuation creates exactly one new
Task. An event is a continuation only through the two methods below. Separate
events in one conversation create separate Tasks in the same A2A
`contextId`.

Channels stores this atomic mapping:

```text
(principal, source, conversationKey) -> contextId
```

The `conversationKey` is the source's Conversation fields from the
[source conformance matrix](./a2a-source-conformance.md).

Channels keeps this mapping for 30 days after the last provider event in
the conversation, and never removes it while a non-terminal Task references
its `contextId`. Concurrent
first messages use one atomic upsert. They receive the same `contextId`.

The trusted task-plane interface creates a new Task in an existing context
(`createTask(principal, contextId)`). A conversation key
never selects a Task. A thread identifier never continues a Task.

A provider reply continues a Task only through one of these methods:

- A verified reply anchor selects the Task.
- An authorized client supplies an explicit `taskId`.

An explicit `taskId` is authorized under the same convention as `contextId`:
it attaches only when the requesting principal already owns the Task. An
explicit `taskId` arrives only over the trusted task-plane interface or the
authenticated A2A binding. Channels never parses a `taskId` out of a provider
message body — sender-controlled values remain untrusted.

A verified reply anchor requires all these conditions:

1. The Task has the `INPUT_REQUIRED` or `AUTH_REQUIRED` state.
2. Channels sent a provider response for that Task.
3. Channels stored the provider response ID as a reply anchor.
4. The new event directly replies to that anchor.
5. The event's authenticated intake principal matches the anchor's
   principal. The anchor-key scope enforces this condition.
6. The Task records an unanswered input request.

If any condition fails, the event creates a new Task in the conversation's
context — the same disposition as a normal thread message. Anchor failure is
never a rejection; only an unauthorized explicit `taskId` fails explicitly.

Channels stores this reply-anchor mapping:

```text
(principal, source, providerResponseId) -> taskId
```

A source supports reply anchors only where the provider exposes a per-message
reply relation to the response Channels sent. A thread-root identifier does
not satisfy condition 4. The
[source conformance matrix](./a2a-source-conformance.md) records per-source
support in its Continuation column. Only an authorized explicit `taskId`
continues a Task from a source without reply-anchor support.

Channels accepts an item when its Task, wake, and evidence record are
durably committed. A source may advance its checkpoint or acknowledge the
provider only after acceptance.

Task creation grants no authority. An inbound message does not select an
agent, a tool set, or a workflow topology.

## Contract decisions

- **Idempotency is mandatory and stronger than the A2A minimum.** Scope:
  `(authenticated principal, messageId)`. Stored outcome: the full prior
  result — the created Task (a duplicate returns that Task) or the direct
  Message verbatim. For work-producing A2A intake, the fsynced activation
  journal claim is the dedupe authority and supplies the prior Task directly;
  Task and context IDs minted by the server are excluded from the activation
  digest. A persistence failure returns an error and records no successful
  outcome. Retention: 30 days, never shorter than the referenced task's life.
  Once that Task and its claim have been pruned, the same identity is accepted
  as new work instead of returning a nonexistent Task. A duplicate `messageId`
  with a different payload is an
  explicit `409 DUPLICATE_MESSAGE_ID`, never a silent replay. For native
  intake, the source's Event identity fields from the conformance matrix,
  scoped to the intake principal, serve as the `messageId` for this rule.
- **Recovery uses durable state.** Streams are ephemeral; the durable Task —
  status, history, artifacts — is the record. A reconnecting client reads
  the Task, then opens a new subscription; nothing replays.
- **Wake recovery follows terminal Task state.** `WOKEN` records that Pi began
  a turn, not that the turn completed. On startup, every accepted activation
  whose Task is still non-terminal is offered once to the new runtime, including
  activations already marked `WOKEN`. Terminal claims are filtered before queue
  admission and do not count toward the bound. Replaying a historical wake does
  not replace an unanswered `INPUT_REQUIRED` or `AUTH_REQUIRED` status message
  with bare `WORKING`; a newly accepted continuation still starts normally. A
  wake transport failure retries three times with timer backoff, then records
  `WAKE_FAILED` evidence and stops. Transient store or journal failures during
  pumping schedule a macrotask retry with capped exponential backoff.
- **Wake admission is bounded.** At most 128 wakes wait behind the offered or
  active turn. Overflow is logged and recorded as durable `WAKE_FAILED`
  evidence, so a duplicate-prone source cannot grow the resident queue without
  limit or fail silently.
- **Operational records are compacted at startup.** After incomplete claims
  replay, the journal keeps pending claims, records for retained Tasks, and the
  30-day window. Evidence, reply anchors, outbound deliveries, and contexts use
  the same window while retaining records required by a live Task; an outbound
  delivery still in `sending` is never pruned.
- **Outbound delivery is serialized per delivery ID.** Concurrent identical
  responses share one durable state transition and one provider mutation. A
  persisted `lookup` delivery without its exact reconciler fails closed as
  ambiguous instead of sending blindly.
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
- **A blocking send is bounded.** At `blockingTimeoutMs` (default 60 s) the
  send returns the task's current snapshot rather than holding the socket;
  the client continues by polling or subscribing.
- **Streaming shows what happens after you connect.** An executor that
  settles the task before returning (a fast inline executor) emits its
  updates before the `message:stream` forwarder attaches, so the client
  receives only the final `{task}` frame — the durable state carries
  everything regardless. The resident-agent bridge returns the submitted Task
  after its activation claim is durable; later status and artifact updates
  stream live.

## Resident-agent bridge

`extensions/a2a-extension.ts` hosts the optional server inside a resident Pi
profile. The listener is inert unless `A2A_SERVER=1`; the task tools are
registered whenever the task plane runs, including native-only deployments.
The composed runtime always injects its already-open shared store, so
`A2A_STORE_PATH` is no longer required. Configuration is
`A2A_CREDENTIALS_PATH` (required, `{"credentials": [{"token", "principal"}]}`),
`A2A_HOST`/`A2A_PORT` (default loopback:8788), and `A2A_PUBLIC_URL` /
`A2A_AGENT_NAME` / `A2A_AGENT_DESCRIPTION` / `A2A_AGENT_VERSION` for the Card.

An inbound work message first enters the trusted task-plane sink. Acceptance
writes the journal claim, creates or continues the Task, appends the authorized
history, projects evidence, and queues a **body-free wake** before returning the
Task. Explicit continuation is authorized before its caller message is
persisted. The wake queue changes the
Task to `WORKING` and grants it as the turn's sole authority. The A2A listener
never wakes Pi directly. The agent then drives the task with three tools:

- `a2a_read_task` — read the task's history inside untrusted-content markers.
- `a2a_complete_task` — record the response as an artifact and complete, or
  reject with a reason.
- `a2a_require_input` — pause the task on the caller with a question; the
  task enters `INPUT_REQUIRED`. Today the answer arrives as an authorized
  explicit `taskId` follow-up; the runtime commits add verified reply
  anchors, and make this tool fail for a Task whose source declares no
  continuation method in the conformance matrix — the executor completes or
  rejects instead, so no Task strands in `INPUT_REQUIRED`. The answer causes
  a new wake for that Task. This tool is the protocol-native structured-question
surface ([#27](https://github.com/ai-outfitter/channels/issues/27)).

### Upgrade from the 1.7 standalone A2A store

This release does not automatically merge the legacy `A2A_STORE_PATH` document
into the shared task-plane store. Automatic merging could combine principal,
message-dedupe, and task identities without enough provenance to resolve a
collision safely. Before upgrading an A2A-only deployment, complete or export
any active tasks in the legacy store and retain that file as the audit archive.
New and continued work after the upgrade uses
`${XDG_DATA_HOME:-$HOME/.local/share}/outfitter/channels/task-plane/tasks.json`
unless `CHANNELS_TASK_STORE_PATH` selects another task-plane root.

All three tools require the exact Task to be the active turn authority. A task
ID from another queued or completed Task, or a Task with no activation claim,
is rejected. There is no claim-free resident-owner path. For a native Task whose
source declares no continuation method, `a2a_require_input` fails and the
executor must complete or reject the Task.

The default `${XDG_DATA_HOME:-$HOME/.local/share}/outfitter/channels/task-plane`
store has no cross-process journal lock.
Only one Channels process may open a given store root at a time. Concurrent Pi
sessions must set distinct `CHANNELS_TASK_STORE_PATH` roots. A cross-process
lock is required before this single-process constraint can be removed.

## Verification gates

`tests/a2a-task-plane.test.ts` proves, by name, the gates from the RFC's
conformance note: equal task IDs from two servers do not collide; a foreign
`contextId` does not join local work; a reconnect can miss transient messages
without losing critical state; a simple interaction returns a direct Message
and a duplicate direct Message returns its prior direct result; an unsupported
A2A version fails explicitly; and subscribe uses `GET`, streams updates, and
rejects terminal Tasks.

The existing continuation test (`tests/a2a-task-plane.test.ts`) already
proves the authorized explicit `taskId` method, which this contract keeps —
the runtime commits keep that test. They add the new gates: two messages in
one provider thread create two Tasks in one context; concurrent first
messages resolve one `contextId` through the atomic upsert; the trusted
interface creates a new Task in an existing context; a verified direct reply
continues one waiting Task, including from the `AUTH_REQUIRED` state; a
redelivered duplicate provider event returns the prior Task; a reply anchor
from a principal that cannot access the Task creates a new Task instead; a
later thread message creates a new Task; an unauthorized explicit `taskId` fails; and a `taskId`
embedded in a provider message body neither selects nor continues a Task.
