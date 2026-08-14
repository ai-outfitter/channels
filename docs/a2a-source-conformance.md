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

The matrix states the target contract for the task-plane milestone, not the
current implementation. Current adapters hold poll state in memory. The
`Tests` column states required coverage, not existing coverage; only the
Chatto resume-cursor test exists today.

## Source matrix

| Source | Capability | Event identity | Native object identity | Conversation | Checkpoint | Acknowledgment | Continuation | Response | Delivery recovery | Receipt | Terminal outcomes | Tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Chatto | Work-producing | Notification ID | Notification ID, room ID, message ID, and thread-root ID | Room ID and thread-root ID | Projection cursor. Persist it after Channels accepts all selected notifications. | Dismiss the notification after acceptance. | Audit pending | Respond to the exact activation message. | Audit pending | Audit pending | Audit pending | Unit, restart, duplicate, and packaged-entrypoint tests. The restart test preserves the cursor and exact notification. |
| GitHub | Work-producing | Notification ID and revision | Owner, repository, subject kind, number, notification ID, reason, and revision. A native display URL is derived from the configured API base; a URL from a notification payload is never fetched. | Repository and subject identity | Poll window, `since`, `lastModified`, and seen state. Persist them after Channels accepts all selected revisions. At startup, reconcile unread notifications from the persisted poll window. This is source intake, not a task-bound turn. | Mark the notification as read after acceptance. See the migration note below the matrix. | Audit pending | Process the exact Task subject. Do not scan all assignments, mentions, or notifications. | Audit pending | Audit pending | Audit pending | Unit, restart, duplicate, and packaged-entrypoint tests. The restart test reconciles unread exact notification revisions. |
| JMAP email | Work-producing | Account ID and email ID | Account ID, email ID, and thread ID | Email thread ID | `Email/changes` state. Advance it after Channels accepts all selected email messages. | Audit pending | Audit pending | Pass the exact account ID and email ID to the task-bound mail operation. Do not scan the complete inbox. | Audit pending | Audit pending | Audit pending | Unit, restart, duplicate, and packaged-entrypoint tests. The restart test resumes from the last accepted `Email/changes` state. |
| Slack | Work-producing | Provider event ID | Workspace, channel, message timestamp, and thread timestamp | Workspace, channel, and thread root | Audit pending | Audit pending | No reply-anchor support. `thread_ts` identifies the thread root, not the message that received the reply. A Slack message cannot carry an authorized explicit `taskId` either, because a `taskId` arrives only over the trusted interface or the authenticated A2A binding. A Slack Task therefore cannot be continued from Slack. `a2a_require_input` fails for a Task whose source declares no continuation method (see the task plane); the executor completes or rejects instead. | Respond to the exact Task message. | Audit pending | Audit pending | Audit pending | Unit, restart, duplicate, and packaged-entrypoint tests. A thread reply creates a new Task. |
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
