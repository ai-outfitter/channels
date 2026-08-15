# Channel events — wake pi only when work arrives

Channel sources wake the agent when work arrives, avoiding model-driven polling
on every loop tick. Sources may use push connections, a local daemon, or
lightweight polling. Exact items from Slack, Chatto, Mattermost, and Zulip use
the extension's channel-neutral tools after the wake.

## Why

The `@pi-agents/loop` scheduler fires `pi.sendUserMessage(prompt)` on a timer
(idle-gated), and the **model** then runs a channel skill to poll a CLI. That
spends a full inference turn on **every tick even when nothing arrived**. A push
source spends a turn **only when a message actually arrives**, and does its
connection lifecycle on inference-free hooks.

## How pi makes this possible

pi separates side-effect hooks from model-waking injection (see
`earendil-works/pi` — `src/core/agent-session.ts`, `src/core/extensions/runner.ts`):

| Need | pi primitive | Wakes model? |
| --- | --- | --- |
| Open/close the connection on start/stop | `pi.on("session_start" \| "session_shutdown", …)` handlers (plain awaited callbacks) | **No** |
| Know when the agent settles | `agent_end` / `turn_end` events, `ctx.isIdle()` | No |
| Stage context without a turn | `pi.sendMessage({…}, { triggerTurn:false })`, `deliverAs:"nextTurn"`, `pi.appendEntry()` | No |
| Wake the agent on a real event | `pi.sendUserMessage(text, { deliverAs })` | **Yes** |
| External process → session | resident `--mode rpc` stdin: `prompt` / `steer` / `follow_up` | Yes |

This extension uses **inference-free lifecycle hooks** for the connection.
Sources accept real work through the task plane. Only the durable wake queue
uses `sendUserMessage`, after acceptance has committed a Task claim.

## Design

- **`session_start`** (no inference): read config from env, open the source's push
  connection, keep the returned `stop` handle.
- **On event** (no inference until it wakes): the source sends a content-addressed
  activation to its required task sink. Acceptance commits the Task, journal
  claim, dedupe projection, and evidence. The durable queue then sends one
  body-free `sendUserMessage(..., { deliverAs: "followUp" })` and grants that
  Task as the turn's authority.
- **`session_shutdown`** (no inference): call `stop()` — idempotent, closes the
  connection.
- **Trust boundary:** the wake prompt is trusted and body-free. For located
  items, the model passes the opaque locator to `channel_read`; fetched content
  appears only inside explicit untrusted-content markers.
- **Reliability:** each source owns recovery. JMAP, Signal, Chatto, Mattermost,
  and Zulip use the shared supervisor. Slack uses it for authentication and the
  initial connection; its SDK handles reconnection once connected. GitHub
  schedules its own polls. A separately configured model-polling loop can
  provide an application-level backstop, but it does not restart sources.

## Multiple channels at once

The extension runs **every configured channel** simultaneously; accepted work
feeds one durable Task wake queue. This is what lets one personal agent be
assigned to email *and* Slack *and* Signal without competing wake authorities.

Channel selection:

| `OUTFITTER_CHANNELS` | Behavior |
| --- | --- |
| unset | **Auto-detect** — start every registered source whose credentials are present. |
| `jmap,signal` (list) | Start exactly those channels. |
| `off` / `none` | Disabled; loop-polling unchanged. |

Auto-detect activates each source whose credentials are present. A channel
profile can supply its secret without additional source-selection configuration.

## Configuration

| Env | Used by |
| --- | --- |
| `XIN_BASE_URL` / `XIN_BASIC_USER` / `XIN_BASIC_PASS` | `jmap` source (same creds as the `mail` skill). |
| `SIGNAL_NUMBER` / `SIGNAL_CLI_CONFIG` | `signal` source (same creds as the `signal-responder` skill). |
| `GITHUB_NOTIFY_TOKEN` / `GITHUB_TOKEN` | `github` notification source. Listing notifications requires a **classic** PAT; the first variable lets the poller hold that while `gh` keeps a narrower token. |
| `GITHUB_API_URL` / `GITHUB_SERVER_URL` | `github` source REST base (GHES). Every request is built from this base — a URL taken from a notification payload is never fetched. |
| `GITHUB_NOTIFY_MARK_READ` | Retired and ignored with one startup warning. GitHub now marks the exact notification read only after durable Task acceptance; see the [migration note](./a2a-source-conformance.md#migration-note-github-acknowledgment). |
| `SLACK_APP_TOKEN` / `SLACK_BOT_TOKEN` | `slack` source and action adapter. |
| `CHATTO_BASE_URL` / `CHATTO_TOKEN` / optional `CHATTO_ROOM_IDS` | `chatto` source and action adapter. |
| `MATTERMOST_BASE_URL` / `MATTERMOST_BOT_TOKEN` / optional `MATTERMOST_CHANNEL_IDS` | `mattermost` source and action adapter. |
| `ZULIP_ORGANIZATION_URL` / `ZULIP_BOT_EMAIL` / `ZULIP_API_KEY` / optional `ZULIP_CHANNEL_IDS` | `zulip` source and action adapter. |

## Sources

To add a channel, create `sources/<name>.ts`, export its `ChannelSource` and
optional action adapter, then register it in `extensions/index.ts`. The core
hooks, queue, and trust boundary remain unchanged. Add the source's row to
the [source conformance matrix](./a2a-source-conformance.md).

- **`jmap`** (`extensions/sources/jmap.ts`) — JMAP EventSource (SSE, RFC 8620
  §7.3) on Stalwart; watches the account's `Email` `StateChange` and emits a
  trusted `new mail` event. It also wakes on JMAP `CalendarAlert` pushes when a
  calendar event's alarm fires, allowing scheduled and recurring tasks
  to be plain calendar events. Reads **no** mail or calendar-event bodies; the
  `mail` skill (`xin`) does the mail fetch/reply/move. EventSource push is
  at-most-once: an alert that fires while the source is disconnected is lost,
  so if a missed wake means a missed task, give the event an EMAIL
  alarm as well — that message persists in the mailbox and still fires a
  `new mail` wake. When the `Email,CalendarAlert` subscription fails with a
  status that means the push type itself is unacceptable (400, 404, 422, 501),
  the source downgrades that connection attempt to mail-only wakes
  (logged) and retries `CalendarAlert` on the next reconnect. Any other failure
  (401, 403, 429, 5xx) throws instead, so the supervisor reconnects with the
  full subscription rather than parking on a long-lived mail-only stream. The
  alert's `uid` and, for a recurring event, its `recurrenceId` are the only
  event-derived text that reaches a wake summary, and the source admits each
  only after validating it against the same conservative charset; a uid that
  fails leaves a bare `calendar alert` with no uid, and a recurrenceId that
  fails is simply left out. `CalendarAlert` is outside RFC 8620 — the frame name and field
  casing follow Stalwart's implementation. A frame captured from a live Stalwart
  0.15.5 server is pinned as a test fixture. Routing goes by the payload: an
  explicit `@type` is authoritative in both directions, else the `calendarAlert`
  frame name is taken as a hint, else the payload is matched structurally — so a
  server that names the frame differently still wakes:

  ```text
  event: calendarAlert
  data: {"@type":"CalendarAlert","accountId":"i","calendarEventId":"b",
         "uid":"vega-cron-probe-001","recurrenceId":null,"alertId":"a1"}
  ```

  Stalwart's `calendar-alarm.minTriggerInterval` (default one hour per account)
  throttles alarm **emails**, not these pushes: two alerts 45 seconds apart were
  both delivered, each within 200 ms of its trigger. Scheduling below that
  interval is therefore possible — but an `EMAIL` fallback alarm on a
  sub-hourly schedule is not, so the push-alert cadence and the EMAIL-alarm
  cadence are chosen independently.
- **`signal`** (`extensions/sources/signal.ts`) — spawns `signal-cli … jsonRpc`
  (a dissimilar transport: child-process JSON-RPC, not HTTP SSE) and emits a
  trusted `new message` event per incoming message; the `signal-responder` skill
  does the receive/reply.
- **`slack`** (`extensions/sources/slack.ts`) — the official
  `@slack/socket-mode` client owns the Socket Mode websocket, acknowledgements,
  reconnects, and shutdown. By default, the source listens for `app_mention` in
  every channel the bot has joined; an explicit channel-ID allowlist can narrow
  that Slack membership boundary. It emits a trusted `new mention` event
  containing only validated opaque locators. Its `@slack/web-api` action adapter implements
  `channel_read` and `channel_respond`, including bounded thread context,
  threaded replies, and handled reactions.
- **`chatto`** (`extensions/sources/chatto.ts`) — connects to Chatto's
  protocol-v2 realtime projection, resumes from cursors, and turns created
  mention notifications into opaque locators. The action adapter validates
  notification state, reads bounded room/thread context, posts in the correct
  thread, and dismisses the exact notification. The generated ConnectRPC schema
  is pinned because Chatto remains pre-1.0.
- **`mattermost`** (`extensions/sources/mattermost.ts`) — authenticates a
  Mattermost WebSocket and accepts only `posted` events whose recipient-scoped
  mention list includes the bot. REST actions read bounded channel/thread
  context, reply at the correct root, and add the handled reaction.
- **`zulip`** (`extensions/sources/zulip.ts`) — registers and long-polls a
  message event queue, recreating expired queues and attempting to delete the
  active queue on shutdown. Channel mentions honor an optional numeric channel
  allowlist while direct messages remain eligible. REST actions retain topic/DM
  addressing and use a reaction as handled state.

Source modules follow the dynamic-import convention in
[architecture.md](architecture.md): the core registry probes environment
variables without importing a source, then imports only selected, configured
channel implementations at session startup.

The agent-facing contract and its evaluation against Slack, Chatto, Mattermost,
Zulip, JMAP, Signal, GitHub, and WhatsApp are documented in
[architecture.md](architecture.md#agent-facing-tools).

## Composition — publish channels as outfitter profiles

Each channel is published in `ai-outfitter/community-profiles` as an **agent
profile** (an agent *is* the profile) whose loadout selects its channel **skill**
plus this **pi extension**:

```yaml
# agents/email-assistant/agent.md
skills: [gmail]
extensions: [git:github.com/ai-outfitter/channels]
```

Loadout entries are resolved by slug and merged by ID across layers. A personal
agent can combine channel profiles while loading each skill once and
deduplicating the shared extension. For example, a `personal-assistant` profile
can select `gmail`, `slack-responder`, and `signal-responder` and process all
three through one Task wake queue. Configure `OUTFITTER_CHANNELS`, or let
credential auto-detection select the available channels.

## Verifying against the Stalwart demo

1. Stand up the Stalwart demo and run the agent with `OUTFITTER_CHANNELS=jmap`
   and the loop tick raised to a long heartbeat.
2. Idle agent + send a test email via `xin`: a wake should fire within seconds
   (not on the next tick); the model runs the `mail` skill and processes it.
3. Send several while streaming: they coalesce into one follow-up sweep.
4. Create a calendar event a minute or two out with an alarm on it: when the
   alarm fires, a wake naming `calendar alert: <uid>` should arrive within
   seconds. (A server that refuses the `CalendarAlert` push type logs the
   downgrade instead and keeps waking on mail.)
5. No mail arriving → no turns fire between heartbeats.
6. Quit/reload → the EventSource is closed by `session_shutdown` (no orphan).
