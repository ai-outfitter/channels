# A2A source conformance

This document defines source-specific identity and recovery methods. It is the
source-level companion to the [task plane](./a2a-task-plane.md), which defines
the general contract these rows instantiate. The matrix uses `Audit pending`
when the source audit must define a value. The source audit is the
remaining-sources commit of the task-plane milestone
([RFC #35](https://github.com/ai-outfitter/channels/issues/35)). A
contributor who adds a new source writes `Audit pending` for any field the
source does not yet implement; the source audit replaces it with the target
contract.

Every replayable source stores a durable checkpoint. The source advances
its checkpoint only after Channels accepts all selected items. The
[task plane](./a2a-task-plane.md) defines acceptance and the idempotency
rule that governs duplicates and replays.

The matrix states the implemented contract for the task-plane milestone. The
`Tests` column states the required regression coverage for each adapter.

## Source matrix

| Source | Capability | Event identity | Native object identity | Conversation | Checkpoint | Acknowledgment | Continuation | Response | Delivery recovery | Receipt | Terminal outcomes | Tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Chatto | Work-producing | Notification ID | Notification ID, room ID, message ID, and thread-root ID | Room ID and thread-root ID | Projection cursor. Persist it after Channels accepts all selected notifications. A notification dismissed elsewhere and a notification ID replayed with changed payload are permanent projection outcomes: record evidence, advance the cursor, and continue. Durable Task acceptance, not the subsequently dismissed notification row, authorizes read and response; handled state is the durable Task's terminal state. | Dismiss the notification after acceptance. `NOT_FOUND` means it was already handled. | None. Chatto Tasks complete or reject; they cannot enter input-required. | Respond to the exact activation message. | Dismiss is an idempotent exact-notification mutation. Reply creation uses the ambiguous policy because Chatto exposes neither an idempotency key nor an exact sent-message lookup. An indeterminate reply failure becomes unhealthy and is not automatically retried; a determinate provider rejection remains retryable, and revised text creates a distinct delivery operation. | None. | Native reply, rejection, no-op, or evidence only. | Unit, restart, duplicate, and packaged-entrypoint tests. The restart test preserves the cursor and exact notification; permanent projection tests cover already-dismissed and changed duplicate rows. |
| GitHub | Work-producing | Notification ID and revision | Owner, repository, subject kind, number, notification ID, reason, and revision. A native display URL is derived from the configured API base; a URL from a notification payload is never fetched. Notifications without an exact issue or pull-request identity are classified non-work and checkpointed only after that decision. | Repository and subject identity | The API base and immutable numeric account ID scope the poll window, `since`, `lastModified`, and seen state, so an account rename keeps its checkpoint. Persist them after Channels accepts all selected revisions. An aborted or retryable partial batch does not advance; replay returns prior Tasks through provider-event dedupe. At startup, identity resolution and unread reconciliation run under the source supervisor, so a transient `/user` failure retries without failing aggregate startup. | Mark the notification as read after acceptance. See the migration note below the matrix. | None. GitHub Tasks complete or reject; they cannot enter input-required. | Process the exact Task subject. Do not scan all assignments, mentions, or notifications. | Mark-read is an idempotent exact-notification mutation and is retried after a crash in `sending`; permanent item failures are isolated and recorded as processed. | None. | Exact subject mutation, rejection, no-op, or evidence only. | Unit, restart, rename, duplicate, and packaged-entrypoint tests. The restart test reconciles unread exact notification revisions. |
| JMAP email | Work-producing | Account ID and email ID | Account ID, email ID, and thread ID | Email thread ID | `Email/changes` state. Select the union of IDs in `created` and `updated`, fetch mailbox membership in `maxObjectsInGet` chunks (safe default 256), and accept only messages currently in the mailbox whose role is `inbox`. Thus newly delivered mail and mail moved into INBOX are offered, while changes to mail outside INBOX are ignored; provider dedupe returns the existing Task for an already-accepted INBOX message, so flag and other updates do not create another Task. Advance after all selected messages are accepted. Startup reconcile runs alongside SSE opening and retries three times with backoff, so push remains live and a quiet mailbox does not strand one transient failure. On `cannotCalculateChanges`, record resync evidence, reset to the current state, and reconcile at most 100 exact INBOX IDs through `Email/query`. | None. | None. JMAP Tasks complete or reject; they cannot enter input-required. | Pass the exact account ID and email ID to the task-bound mail operation. Do not scan the complete inbox. | The in-process source sends no provider mutation. A future native mail send must use an exact lookup or the ambiguous policy before it is enabled. | None. | Rejection, no-op, or evidence only. | Unit, restart, duplicate, chunking, startup-failure, resync, and packaged-entrypoint tests. The restart test resumes from the last accepted `Email/changes` state. |
| Slack | Work-producing | Provider event ID | Workspace, channel, message timestamp, and thread timestamp | Workspace, channel, and thread root | Socket Mode redelivery plus provider-event dedupe; no source cursor exists. | Acknowledge the Socket Mode envelope only after durable Task acceptance. Acceptance failure remains unacked for provider redelivery. Non-work and malformed envelopes are acknowledged only after durable classification evidence is recorded. | No reply-anchor support. `thread_ts` identifies the thread root, not the message that received the reply. A Slack message cannot carry an authorized explicit `taskId` either, because a `taskId` arrives only over the trusted interface or the authenticated A2A binding. A Slack Task therefore cannot be continued from Slack. `a2a_require_input` fails for a Task whose source declares no continuation method (see the task plane); the executor completes or rejects instead. | Respond to the exact Task message. | Reply creation uses the ambiguous policy because this adapter has no exact sent-message lookup. An indeterminate reply failure becomes unhealthy and is not automatically retried; a determinate provider rejection remains retryable, and revised text creates a distinct delivery operation. The handled reaction is an idempotent exact-message mutation and is safe to retry. | None. | Native reply, rejection, no-op, or evidence only. | Unit, restart, duplicate, and packaged-entrypoint tests. A thread reply creates a new Task. |
| JMAP calendar | Follow-on milestone | Account ID, calendar ID, event ID, recurrence ID or start, alert ID, and scheduled time. One activation per CalendarAlert occurrence; the calendar event stays the durable schedule resource | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending |
| Forgejo | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending |
| Mattermost | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending |
| Signal | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending |
| Zulip | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending |
| Agent relay | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending |
| Vega web (browser client, HTTPS gateway) | Work-producing | A2A `messageId` scoped to the authenticated principal | Audit pending | Caller-supplied `contextId` that the principal owns | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending | Audit pending |

## Migration note: GitHub acknowledgment

When the runtime commits land, source-side mark-read-after-acceptance will
supersede the agent-marks-read guidance in the README, `channel-events.md`,
`runbooks/github-notifications-local.md` (including its find-by-assignments
recovery steps), and the `GITHUB_NOTIFY_MARK_READ` default in
`extensions/sources/github.ts`. The flag will be retired: a set variable
will be ignored and will log one startup warning.

Source-side acknowledgment activates only in the same change that delivers
the exact Task subject and persists acceptance durably. To mark a thread
read before durable acceptance would destroy the evidence the woken agent
needs. The find-by-assignments recovery path will be superseded by startup
reconciliation, which relies on durable acceptance state, not unread state.
The runtime commits will update every superseded location with a forward
pointer to this note.

## Identifier encoding

The task plane keeps the strict identifier pattern for principals, sources,
provider event IDs, dedupe keys, and conversation keys. Adapters hash raw
provider values into a source-prefixed identifier when those values can contain
characters such as `@` or `/`. The unhashed value remains in `nativeLocator` or
message data. Locator keys use the identifier pattern, but locator values are
opaque provider data: they must be non-empty strings of at most 4096 characters
and are not interpreted as task-plane identifiers. This narrow relaxation
preserves exact JMAP account IDs, Slack compounds, and provider URLs without
widening principal syntax.

## Field rules

| Field | Required content |
| --- | --- |
| Capability | State `Work-producing`, `Non-work`, `Follow-on milestone`, or `Audit pending`. |
| Event identity | List the stable provider fields. |
| Native object identity | List the fields that identify one exact provider object. |
| Conversation | List the fields that resolve one `contextId`. |
| Checkpoint | Name the durable provider cursor. State its commit point. |
| Acknowledgment | Name the provider acknowledgment operation. State its point after acceptance. |
| Continuation | State reply-anchor support or explicit `taskId` support. |
| Response | Name the exact provider operation. |
| Delivery recovery | State the source-specific delta only. The [task plane](./a2a-task-plane.md) mandates the idempotency scope and the duplicate-payload rule. Name an idempotency key, an exact lookup, or the ambiguous policy. The ambiguous policy: mark the delivery `ambiguous`, record evidence, report unhealthy, and do not retry the provider mutation automatically. |
| Receipt | Name the acceptance-receipt operation, or state `None`. |
| Terminal outcomes | State reply, mutation, rejection, no-op, or evidence only. |
| Tests | State unit, restart, duplicate, and packaged-entrypoint coverage. A packaged-entrypoint test loads the packed npm artifact through Pi's Jiti loader with `moduleCache: false` and starts it. No packaged-entrypoint test exists yet; the runtime commits add the first one. |

## Interoperability invariants

These invariants are targets that keep the wire protocol and the storage
backend swappable. The task-plane milestone reviews
([RFC #35](https://github.com/ai-outfitter/channels/issues/35)) check new
code against them.

1. Every payload that crosses the intake boundary is content-addressed. Each
   activation and evidence record keeps a content digest and an immutable
   locator.
2. Channels must not persist A2A wire types. Stores hold Channels-native
   records. Serialization happens only at the protocol boundary. Known
   exception today: the A2A store persists the pinned ProtoJSON task shape
   (`StoredTask.task`); new stores must not repeat this.
3. Evidence retention and operational retention are separate. Context and
   dedupe stores are operational state; the
   [task plane](./a2a-task-plane.md) owns their retention policy. Evidence
   records live outside the pruning path and their effective retention can
   increase but not decrease.
4. The external protocol surface grows consumer by consumer. The listener
   implements only the operations a real consumer uses. The conformance
   matrix discipline applies to consumers as well as sources.
