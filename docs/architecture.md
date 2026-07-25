# Architecture

The Channels extension turns external activity into trusted, body-free wakes for
one resident Pi session. Transport sources detect activity; channel adapters read
and act on the untrusted content after the agent wakes.

The native agent-to-agent and operator-to-agent plane is specified separately in
[Agent Session Gateway](agent-session-gateway.md). It reuses this extension's
body-free wake and channel-tool boundary while keeping chat distinct from session
observation, control, and hosted workload lifecycle.

## Boundaries

There are three layers:

1. A **source** detects work and emits a body-free `ChannelEvent`.
2. The **channel tools** give the agent one stable read/respond interface.
3. An **adapter** translates that interface to Slack, Chatto, Mattermost, Zulip,
   JMAP, Signal, GitHub, or a future transport.

The agent should not need SDK-specific skills, raw HTTP recipes, credentials, or
JSON response parsing. A channel skill teaches workflow and policy only.

## Agent-facing tools

The extension registers two high-level tools:

```ts
channel_read({ locator })
channel_respond({ locator, response })
```

`channel_read` returns bounded context with one target message and a `handled`
flag. `channel_respond` returns whether the reply was submitted, whether the
source item was marked handled, an optional response id, and an optional warning.
The readable tool output marks all fetched content as untrusted; the same result
is also available as structured tool details.

The contract deliberately accepts plain text only. Attachments, interactive
controls, rich blocks, edits, and approved WhatsApp templates have materially
different capabilities and policy constraints. Add them later as explicit,
typed capabilities instead of a transport-specific `options` bag.

This is a conversational response API, not a universal channel-action API.
GitHub approvals, message edits, attachment uploads, and WhatsApp template sends
need separate typed capabilities. If a workflow needs to close an item without
replying, add a `channel_complete` operation when that use case is implemented;
do not overload `channel_respond` with an empty response.

### Locators

A locator is a self-contained, opaque, versioned string:

```text
<adapter>:v<version>:<base64url-adapter-payload>
```

For example, Slack emits `slack:v1:...`. Core code reads only the adapter and
version prefix. Only the owning adapter may decode and validate the payload.
Callers pass the full locator through unchanged.

A self-contained locator avoids mutable process-local lookup state. Its adapter
can evolve the payload without exposing native ids through the common interface.
Locators contain structural identifiers only, never sender-controlled content
such as message bodies, subjects, or filenames.

### Adapter responsibilities

Every action adapter owns:

- locator decoding, versioning, and native identifier validation;
- authenticated context retrieval and pagination;
- selection of bounded context and the exact target;
- native reply addressing, such as a Slack thread or quoted Signal message;
- native handled-state behavior and duplicate-suppression strategy;
- service-specific limits, retry policy, and actionable errors.

The common tools own:

- tool schemas and agent guidance;
- routing from locator prefix to a lazily loaded adapter;
- consistent untrusted-content markers;
- the invariant that a partial result (`replied: true`, `handled: false`) must not
  cause a duplicate reply.

Slack, Chatto, Mattermost, and Zulip implement exact-item action adapters. JMAP,
Signal, and GitHub still wake their existing skills without exact-item locators
until their action adapters are added.

## Evaluation against real channels

Every adapter exposes the same two tools while retaining its channel's reply and
handled-state semantics.

| Channel | Recommended library/API | Read mapping | Respond and handled mapping | Boundary implication |
| --- | --- | --- | --- | --- |
| Slack | Official [`@slack/socket-mode`](https://docs.slack.dev/tools/node-slack-sdk/socket-mode/) and [`@slack/web-api`](https://docs.slack.dev/tools/node-slack-sdk/web-api/) | `conversations.history` for a top-level mention; paginated [`conversations.replies`](https://docs.slack.dev/reference/methods/conversations.replies/) for a thread | [`chat.postMessage`](https://docs.slack.dev/reference/methods/chat.postMessage/) into the thread, then [`reactions.add`](https://docs.slack.dev/reference/methods/reactions.add/) on the target | A reply can succeed while the handled reaction fails, so the result needs both states. |
| Chatto | Generated ConnectRPC clients pinned to a specific schema, plus the [realtime WebSocket protocol](https://docs.chatto.run/reference/connectrpc-api/realtime/) | Validate the notification, then use room or thread events-around RPCs | Create a message in a new or existing thread, then dismiss the exact notification | Notification state, not message state, is the duplicate-suppression boundary. Protocol v2 is pinned because Chatto is pre-1.0. |
| Mattermost | Native WebSocket plus the [Mattermost REST API](https://developers.mattermost.com/integrate/reference/rest-api/) | Fetch the exact post, then bounded channel history or thread posts | Create a post at the correct root, then add `white_check_mark` to the target | WebSocket `mentions` is recipient-scoped; reply and reaction remain separate operations. |
| Zulip | Direct use of [realtime event queues](https://zulip.com/api/real-time-events) and REST | Fetch the exact message, then a bounded channel/topic or DM narrow | [Send](https://zulip.com/api/send-message) to the same topic or DM recipients, then [react](https://zulip.com/api/add-reaction) to the target | Channel allowlists do not suppress DMs. `REACTION_ALREADY_EXISTS` is already handled, while other failures produce partial success. |
| JMAP mail | Direct `fetch` today; [`jmap-jam`](https://www.npmjs.com/package/jmap-jam) is a typed candidate for the adapter | [`Email/get` and `Thread/get`](https://www.rfc-editor.org/rfc/rfc8621.html) | `EmailSubmission/set` with `onSuccessUpdateEmail` to apply `$answered` or mailbox changes after submission | Submission and mailbox state have distinct outcomes, so a submitted reply must survive a later state-update failure. |
| Signal | [`signal-cli`](https://github.com/AsamK/signal-cli) JSON-RPC daemon | Persist each receive notification in an adapter-owned durable inbox before emitting its locator | `send` with quote timestamp/author; receipts are available but there is no universal durable "handled by this bot" marker | A discarded receive notification cannot be fetched later. The locator must resolve to durable adapter-owned state. |
| GitHub | Official [`octokit`](https://github.com/octokit/octokit.js) | Resolve a notification subject to its issue, pull request, review, or comment context | Create a plain-text comment or review, then [mark the notification thread read](https://docs.github.com/en/rest/activity/notifications) | Comment replies fit the common tool. Approval, request-changes, merge, and issue mutations need typed GitHub capabilities. Some token types cannot use every notifications endpoint. |
| WhatsApp Cloud API | Direct Meta Graph API initially; Meta's former Node SDK is [archived](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/) | Webhook payload plus app-owned conversation storage | Send `/messages` with [`context.message_id`](https://www.postman.com/meta/whatsapp-business-platform/request/73yi2uj/send-reply-to-text-message), then mark the message read | Free-form replies are limited to Meta's [24-hour customer-support window](https://www.postman.com/meta/whatsapp-business-platform/folder/fuaee8l/statuses-object); approved template sends need a separate typed capability. |

Matrix timelines, Teams `replyToId`, and Discord message references also fit an
opaque locator plus read/respond pair, but read receipts and reply semantics
differ. Each adapter therefore owns handled state and reply addressing; the core
API does not define Slack-specific threads or reactions.

## Source boundary

Every channel implements the same `ChannelSource` contract:

1. inspect environment variables without importing the channel implementation;
2. dynamically import the source only when that channel is selected and
   configured;
3. start the source during `session_start`;
4. emit a trusted `ChannelEvent` containing only a channel name, a fixed summary,
   and an optional opaque locator;
5. close the source during `session_shutdown`.

Message bodies and other sender-controlled values never belong in
`ChannelEvent`. The action adapter fetches those values through an authenticated
client and exposes them only inside the tool's untrusted-content markers.

## Dynamic-import convention

`extensions/index.ts` owns a lightweight registry. Each registration has a
dependency-free `configured()` probe, an asynchronous `load()` for the source,
and, where implemented, `loadActions()` for the action adapter:

```ts
slack: {
  configured: () =>
    Boolean(process.env.SLACK_APP_TOKEN || process.env.SLACK_BOT_TOKEN),
  async load() {
    const slack = await import("./sources/slack.ts");
    const config = slack.slackConfigFromEnv();
    return config ? slack.createSlackSource(config) : undefined;
  },
  async loadActions() {
    const slack = await import("./sources/slack.ts");
    const config = slack.slackActionsConfigFromEnv();
    return config ? slack.createSlackActions(config) : undefined;
  },
},
```

| Channel | Configuration probe | Dynamically imported module |
| --- | --- | --- |
| JMAP | any `XIN_*` credential exists | `sources/jmap.ts` |
| Signal | `SIGNAL_NUMBER` or `SIGNAL_CLI_CONFIG` exists | `sources/signal.ts` |
| GitHub | `GITHUB_TOKEN` exists | `sources/github.ts` |
| Slack | `SLACK_APP_TOKEN` or `SLACK_BOT_TOKEN` exists | `sources/slack.ts` |
| Chatto | any `CHATTO_*` adapter variable exists | `sources/chatto.ts` |
| Mattermost | any `MATTERMOST_*` adapter variable exists | `sources/mattermost.ts` |
| Zulip | any `ZULIP_*` adapter variable exists | `sources/zulip.ts` |

The probe intentionally detects partial configuration so startup can log an
actionable incomplete-configuration error. Do not add static channel SDK imports
to `extensions/index.ts`; type-only imports are safe because TypeScript erases
them.

Dynamic imports avoid evaluating an unused channel SDK and isolate a
channel-specific module failure from unrelated sources. They do not avoid
installing declared dependencies. Separate published channel packages would be
needed if install or image-size isolation becomes important.

## Notification coalescing

Channel-only events use their channel name as the queue key, so repeated JMAP,
Signal, or GitHub notifications coalesce into one sweep. Located events use the
full opaque locator, preserving distinct Slack mentions while coalescing
duplicate delivery of the same mention. Chatto, Mattermost, and Zulip exact-item
events use the same locator-key behavior.

The wake prompt contains the locator string but no decoded native ids or message
text. It directs the agent to pass each locator unchanged to `channel_read` and
then `channel_respond`. Each wake contains at most 25 locators. The in-memory
queue holds at most 500 pending events; under sustained overload, new distinct
events are dropped with a log message while duplicates continue to coalesce.
This bounds memory and prompt growth until the channel has durable ingestion.

## Slack implementation

Slack's Socket Mode source listens on the SDK's catch-all `slack_event`, first
acknowledges every envelope, and then emits a `slack:v1` locator only for an
`app_mention`. Acknowledging before filtering prevents other subscribed event
types from being redelivered. The action adapter:

1. validates and decodes the locator;
2. fetches the exact top-level message or paginates the thread until it finds the
   exact mention;
3. returns at most ten messages, retaining the thread root when applicable;
4. posts one reply to the thread root;
5. adds the configured handled reaction to the exact mention.

The handled reaction suppresses normal reprocessing after a successful reply,
but `channel_respond` is not transactionally idempotent. A process failure after
Slack accepts the reply but before the reaction succeeds can leave an uncertain
outcome. If the tool reports `replied: true`, callers must not retry the reply.

Authentication and initial Socket Mode connection run under the shared source
supervisor. Once connected, the Socket Mode SDK owns reconnection. A failed source
import, configuration, or startup is caught at the per-source boundary, so the
remaining selected channels still start. The action adapter caches a successful
`auth.test` identity, but evicts a failed authentication promise so a later tool
call can recover from a transient Slack or network failure.

Required configuration:

```dotenv
SLACK_APP_TOKEN=xapp-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_IDS=joined
```

The app token requires `connections:write`. The bot requires
`app_mentions:read`, `channels:history`, `chat:write`, and `reactions:write`;
add `groups:history` for private channels. `SLACK_CHANNEL_IDS` defaults to
`joined` when omitted. Explicit channel IDs narrow event handling below the
channels the bot has joined; `joined` cannot be mixed with IDs.

## Chatto, Mattermost, and Zulip implementations

Chatto opens `/api/realtime`, negotiates protocol v2, subscribes to the
authenticated projection, and converts unseen pending mention items in
`notifications_replace` into `chatto:v1` locators. The locator identifies the
notification, room, exact message event, and optional thread root. Reads
revalidate the notification and retrieve at most ten room/thread events.
Top-level mentions start a thread; threaded mentions stay in their thread.
Handled state is the exact notification's dismissed state. The vendored schema
and compatibility boundary are recorded in
[`extensions/vendor/chatto/SCHEMA.md`](../extensions/vendor/chatto/SCHEMA.md).

Mattermost authenticates its `/api/v4/websocket` connection with a bot token and
accepts `posted` events only when the server's per-recipient `mentions` list
contains that bot. A `mattermost:v1` locator identifies the exact post and
channel. REST reads return at most ten posts, retaining the thread root when
applicable. Replies use the existing root for a thread or the target post for a
new thread, then add `white_check_mark` to the target.

Zulip registers a message event queue and long-polls it until shutdown or
expiry. When Zulip returns `BAD_EVENT_QUEUE_ID`, the polling loop exits and the
supervisor registers a replacement queue. During teardown, the adapter attempts
to delete the allocated queue and ignores one the server already considers
expired. Channel messages require the bot's `mentioned` flag and optional
numeric channel allowlist. Direct messages remain eligible. A `zulip:v1`
locator identifies the exact message and, for channel messages, its channel.
Reads use a bounded topic or DM narrow. Replies preserve the original topic or
DM recipient set, then add `white_check_mark`; an existing identical reaction
counts as handled.

If a reply succeeds but the item remains unhandled, the adapter returns
`replied: true, handled: false`. Callers must report that warning and must not
retry the reply automatically.
