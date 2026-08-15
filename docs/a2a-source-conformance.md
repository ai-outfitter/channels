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
`Tests` column states the regression coverage that exists for each adapter.

## Source matrix

| Source | Capability | Event identity | Native object identity | Conversation | Checkpoint | Acknowledgment | Continuation | Response | Delivery recovery | Receipt | Terminal outcomes | Tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Chatto | Work-producing | Notification ID | Notification ID, room ID, message ID, and thread-root ID | Room ID and thread-root ID | Projection cursor. Persist it after Channels accepts all selected notifications. A notification dismissed elsewhere and a notification ID replayed with changed payload are permanent projection outcomes: record evidence, advance the cursor, and continue. Durable Task acceptance, not the subsequently dismissed notification row, authorizes read and response; handled state is the durable Task's terminal state. | Dismiss the notification after acceptance. `NOT_FOUND` means it was already handled. | None. Chatto Tasks complete or reject; they cannot enter input-required. | Respond to the exact activation message. | Dismiss is an idempotent exact-notification mutation. Reply creation uses the ambiguous policy because Chatto exposes neither an idempotency key nor an exact sent-message lookup. An indeterminate reply failure becomes unhealthy and is not automatically retried; a determinate provider rejection remains retryable, and revised text creates a distinct delivery operation. | None. | Native reply, rejection, no-op, or evidence only. | Unit, restart, duplicate, and packaged-entrypoint tests. The restart test preserves the cursor and exact notification; permanent projection tests cover already-dismissed and changed duplicate rows. |
| GitHub | Work-producing | Notification ID and revision | Owner, repository, subject kind, number, notification ID, reason, and revision. A native display URL is derived from the configured API base; a URL from a notification payload is never fetched. Notifications without an exact issue or pull-request identity are classified non-work and checkpointed only after that decision. | Repository and subject identity | The API base and immutable numeric account ID scope the poll window, `since`, `lastModified`, and seen state, so an account rename keeps its checkpoint. Persist them after Channels accepts all selected revisions. An aborted or retryable partial batch does not advance; replay returns prior Tasks through provider-event dedupe. At startup, identity resolution and unread reconciliation run under the source supervisor, so a transient `/user` failure retries without failing aggregate startup. | Mark the notification as read after acceptance. See the migration note below the matrix. | None. GitHub Tasks complete or reject; they cannot enter input-required. | Process the exact Task subject. Do not scan all assignments, mentions, or notifications. | Mark-read is an idempotent exact-notification mutation and is retried after a crash in `sending`; permanent item failures are isolated and recorded as processed. | None. | Exact subject mutation, rejection, no-op, or evidence only. | Unit, restart, rename, duplicate, and packaged-entrypoint tests. The restart test reconciles unread exact notification revisions. |
| JMAP email | Work-producing | Account ID and email ID | Account ID, email ID, and thread ID | Email thread ID | `Email/changes` state. Select the union of IDs in `created` and `updated`, fetch mailbox membership in `maxObjectsInGet` chunks (safe default 256), and accept only messages currently in the mailbox whose role is `inbox`. Thus newly delivered mail and mail moved into INBOX are offered, while changes to mail outside INBOX are ignored; provider dedupe returns the existing Task for an already-accepted INBOX message, so flag and other updates do not create another Task. Advance after all selected messages are accepted. Startup reconcile runs alongside SSE opening and retries three times with backoff, so push remains live and a quiet mailbox does not strand one transient failure. On `cannotCalculateChanges`, record resync evidence, reset to the current state, and reconcile at most 100 exact INBOX IDs through `Email/query`. | None. | None. JMAP Tasks complete or reject; they cannot enter input-required. | Read only the task locator's exact account ID and email ID with bounded `Email/get`; reply to that message's sender with `EmailSubmission/set`. Do not scan the complete inbox. | Reply creation adds a deterministic task-plane delivery ID as an outbound header. Recovery uses an exact `Email/query` header filter that excludes drafts. If draft creation succeeded but submission failed, retry reuses and submits the matching draft. Normal and reconciled response IDs both identify the outbound email. JMAP creation IDs are request-scoped, so the Email and EmailSubmission use distinct creation IDs rather than claiming cross-request idempotency. | None. | Native reply, rejection, no-op, or evidence only. | Unit coverage for locator round-trip, exact-item read, reply headers and delivery recording, crash-after-send lookup recovery, partial draft-creation recovery, and activation locator projection, plus restart, duplicate, chunking, startup-failure, resync, and packaged-entrypoint tests. The restart test resumes from the last accepted `Email/changes` state. |
| Slack | Work-producing | Provider event ID | Workspace, channel, message timestamp, and thread timestamp | Workspace, channel, and thread root | Socket Mode redelivery plus provider-event dedupe; no source cursor exists. | Acknowledge the Socket Mode envelope only after durable Task acceptance. Acceptance failure remains unacked for provider redelivery. Non-work (including non-mentions and disallowed channels) is durably aggregated into one in-place counter per workspace/channel/classification before acknowledgement, bounding evidence-store growth; malformed envelopes retain exact durable evidence. | No reply-anchor support. `thread_ts` identifies the thread root, not the message that received the reply. A Slack message cannot carry an authorized explicit `taskId` either, because a `taskId` arrives only over the trusted interface or the authenticated A2A binding. A Slack Task therefore cannot be continued from Slack. `a2a_require_input` fails for a Task whose source declares no continuation method (see the task plane); the executor completes or rejects instead. | Respond to the exact Task message. | Reply creation attaches the stable task-plane delivery ID as Slack message metadata and uses paginated thread history with message metadata explicitly included to find the bot's exact match after a crash. This lookup recovery sends only when no match exists. If lookup is unavailable, task-plane delivery fails closed as ambiguous. The handled reaction is an idempotent exact-message mutation and is safe to retry. | None. | Native reply, rejection, no-op, or evidence only. | Unit, restart, duplicate, bounded non-work evidence-before-ack, exact reply reconciliation, and packaged-entrypoint tests. A thread reply creates a new Task. |
| JMAP calendar | Work-producing | CalendarAlert UID plus recurrence ID when present; a nonconforming raw UID/occurrence is hashed into an identifier-safe key | Account-scoped alert occurrence signal | None; each occurrence creates one Task | EventSource has no replay cursor; the calendar event remains the durable schedule resource | None | None. Calendar Tasks complete or reject. | Process the exact scheduled occurrence named by the Task signal. | Provider-event dedupe on the validated or hashed occurrence key; malformed values stay out of trusted summaries without collapsing distinct alerts | None | Completion, rejection, no-op, or evidence only. | Parser, valid and malformed occurrence-dedupe, task-intake, and no-generic-wake tests. |
| Forgejo | Work-producing | Notification thread ID and `updated_at` revision | Thread ID, revision, repository, exact API subject path, and derived reason | Exact issue or pull-request subject path | Forge clock `since` plus the accepted revision set. Persist after every selected revision is accepted or permanently classified; transient classification, acceptance, or acknowledgment failures hold the cursor. | When `FORGEJO_NOTIFY_MARK_READ=1`, mark the exact thread read only after acceptance. `404` is already handled. | None. Forgejo Tasks complete or reject; a thread message never selects an existing Task. | Operate on the exact issue or pull request in the Task locator; do not scan notifications. | Mark-read is an idempotent exact-thread mutation and resumes from task-plane delivery state. Provider mutations performed outside this adapter cannot claim delivery recovery. | None. | Exact subject mutation, rejection, no-op, or evidence only. | Unit coverage for filtering, exact subject routing, cursor anchoring, mark-read configuration, transient subject/intake retries, permanent intake classification, and retry backoff. |
| Mattermost | Work-producing | Post ID | Channel ID, post ID, and root post ID when present | Channel ID and root post ID (or the top-level post ID) | Persist the exact accepted post ID. WebSocket has no replay cursor, so a transient acceptance failure retains and retries the parsed frame without reconnecting; provider-event dedupe handles redelivery. | No protocol acknowledgment. The accepted-post checkpoint advances only after acceptance or durable permanent-conflict evidence. | No reply-anchor support. A root ID identifies a thread, not a direct reply to the bot response; Tasks complete or reject. | Respond to the exact post in its root thread. | Reply creation uses the ambiguous policy because the adapter has no exact sent-post lookup. The handled reaction is an idempotent exact-post mutation. | The bot's `white_check_mark` reaction on the exact post. | Native reply, rejection, no-op, or evidence only. | Unit coverage for configuration, mention filtering, exact-item actions, reconnect/shutdown, transient intake retention, and permanent intake classification. |
| Signal | Work-producing | Authenticated sender identity and data-message timestamp | Sender identity, envelope timestamp, and data-message timestamp | Authenticated sender identity | The complete receive envelope is committed in Task history before the next stdout line is processed; readline pauses stdout while acceptance is in flight, bounding read-ahead to the stream's current chunk. Task history is the adapter-owned durable inbox because Signal cannot fetch a discarded receive notification. Provider-event dedupe covers replay. | No protocol acknowledgment. A transient intake failure is contained and retries the retained parsed envelope before later lines advance. | None. Signal Tasks complete or reject. | No in-repo responder. Sending is performed by an external skill using the exact sender and Task envelope. | `signal-cli` quote-based send exposes no exact sent-message lookup here. An in-process sender must use the ambiguous policy before it can report delivery; current external skill sends cannot claim task-plane recovery. | Signal receipts are available, but this adapter records no universal handled receipt. | External native reply, rejection, no-op, or evidence only. | Parser, bounded read-ahead, durable-envelope intake, transient retry, and permanent intake classification tests. |
| Zulip | Work-producing | Message ID | Message ID and stream ID for channel messages | Stream ID and topic for channel messages; sorted participant IDs for direct messages | Event-queue `last_event_id`, persisted after each item is accepted or permanently classified. A transient item failure holds the cursor so the queue replays that exact item before later events. A replacement queue starts at the provider's current cursor; message-ID dedupe covers provider redelivery. | Advancing `last_event_id` acknowledges the item only after acceptance or durable permanent-conflict evidence. | None. Topic and DM conversation identity do not verify a direct reply to a bot response; Tasks complete or reject. | Respond to the exact message's topic or direct-message recipients. | Reply creation uses the ambiguous policy because the adapter has no exact sent-message lookup. The handled reaction is an idempotent exact-message mutation. | The bot's `white_check_mark` reaction on the exact message. | Native reply, rejection, no-op, or evidence only. | Unit coverage for configuration, filtering, exact-item actions, queue recreation/shutdown, cursor hold, transient retry backoff, and permanent intake classification. |
| Agent relay | Work-producing | Agent protocol message ID | Message ID, sender endpoint, recipient endpoint, and conversation ID | Agent conversation ID | Filesystem spool file or relay-server cursor. The filesystem journal and unlink, or relay journal checkpoint and server ack, happen only after Task acceptance. Failed acceptance leaves the exact spool item or relay cursor available for retry. | Durable unlink for filesystem delivery; relay `ack` for network delivery. Both occur after acceptance. | None. `replyTo` preserves native reply context but is not yet a verified task-plane reply anchor; a later inbound agent message creates a new Task in the same context. | Respond to the exact agent message ID. | Response IDs are stable over endpoint, request ID, and body. Task-plane idempotent delivery recovery safely repeats the exact send; filesystem and relay transports dedupe the response ID. | Durable agent message state (`replied`/`handled`). | Native reply, rejection, no-op, or evidence only. | Unit, spool-order, relay-ack-order, restart, duplicate, task-intake, and packaged-entrypoint tests. |
| A2A HTTP | Work-producing | Authenticated principal and A2A `messageId` | Server Task ID and message ID | Server-authorized `contextId` | The activation journal claim is the intake and dedupe authority; task history is projected only after authorization | Return the submitted Task only after task-plane acceptance; persistence failure returns an error with no dedupe outcome | Authenticated explicit `taskId` while the Task is interruptible | A2A task status, artifact, and input-required operations | The principal-scoped journal claim returns the prior retained Task; minted Task/context IDs are excluded from its digest, and a pruned Task permits new acceptance | Returned Task snapshot | Completion, rejection, failure, cancellation, or input-required | Binding, crash-after-claim retry, persistence-error, authorization-before-history, queued-wake, and authority tests. |
| Vega web (browser client, HTTPS gateway) | Work-producing | A2A `messageId` scoped to the authenticated principal | HTTPS interface locator, server Task ID, and message ID | Caller-supplied `contextId` only when that principal already owns it | Protocol task store plus activation journal; reconnect reads the durable Task and opens a new subscription | Return the submitted Task to the browser only after task-plane acceptance | Authenticated explicit `taskId` while the Task is input-required or auth-required with an unanswered request | A2A task status, artifact, and input-required operations over the HTTPS gateway | Protocol message dedupe and task-plane activation dedupe share the principal-scoped message ID; durable Task state recovers interrupted browser delivery | Returned Task snapshot and subsequent task/status/artifact SSE frames | Completion, rejection, failure, cancellation, or input-required | Shared A2A binding, HTTPS gateway, journal-claim, reconnect, queued-wake, and authority tests. |

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
3. Evidence and operational records share the task-plane retention floor.
   Startup compaction keeps the 30-day window and every record referenced by a
   retained Task; pending journal claims and `sending` deliveries are retained
   regardless of age. A deployment can archive records externally for a longer
   evidence-retention policy.
4. The external protocol surface grows consumer by consumer. The listener
   implements only the operations a real consumer uses. The conformance
   matrix discipline applies to consumers as well as sources.
5. A source or protocol binding never calls Pi directly. It commits through
   the task-plane sink; only the durable wake queue may call
   `pi.sendUserMessage` for agent work.
