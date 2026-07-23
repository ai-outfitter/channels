# Channel events — native push into a pi session

This extension lets a channel's **native push stream** wake the agent only when
there is real work, instead of the loop extension waking the model on every tick
to poll. It is the push counterpart to the model-polled channel skills
(`mail`/`gmail`/`slack-responder`/…).

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

This extension uses **inference-free lifecycle hooks** for the connection and
`sendUserMessage` (a turn) only on a real event.

## Design

- **`session_start`** (no inference): read config from env, open the source's push
  connection, keep the returned `stop` handle.
- **On event** (no inference until it wakes): the source calls back with a
  **trusted ping** (`{ channel, summary }` — *never* the untrusted body). The
  extension sends one `sendUserMessage(..., { deliverAs: "followUp" })`: idle →
  runs now; streaming → runs after the current turn (never interrupts). Events are
  **coalesced** behind a `wakePending` flag (cleared on `agent_end`) so a burst
  folds into a single sweep — the channel skills already drain the whole inbox.
- **`session_shutdown`** (no inference): call `stop()` — idempotent, closes the
  connection.
- **Trust boundary:** the wake prompt is trusted and body-free; the model fetches
  and reads the real (untrusted) content via the skill, so attacker-controlled
  text never enters as a user message. Same rule as skill references.
- **Reliability:** keep a low-frequency loop tick as the heartbeat/reconnect
  backstop. The push path is the fast path; the loop catches missed pings and
  restarts. Server-side channel state (a message stays in `INBOX` until the skill
  moves it) means a dropped push loses latency, not mail.

## Multiple channels at once

The extension runs **every configured channel** simultaneously; all their events
feed one shared **notification queue** (`pending`) drained after each turn. This is
what lets one personal agent be assigned to email *and* Slack *and* Signal.

Channel selection:

| `OUTFITTER_CHANNELS` | Behavior |
| --- | --- |
| unset | **Auto-detect** — start every registered source whose credentials are present. |
| `jmap,signal` (list) | Start exactly those channels. |
| `off` / `none` | Disabled; loop-polling unchanged. |

Auto-detect is the composition-friendly default: a channel activates simply because
its credentials are present, so adding a channel profile (which brings its Secret)
lights up its source with no extra wiring.

## Configuration

| Env | Used by |
| --- | --- |
| `XIN_BASE_URL` / `XIN_BASIC_USER` / `XIN_BASIC_PASS` | `jmap` source (same creds as the `mail` skill). |
| `SIGNAL_NUMBER` / `SIGNAL_CLI_CONFIG` | `signal` source (same creds as the `signal-responder` skill). |

## Sources

Adding a channel = one new `sources/<name>.ts` exporting a `ChannelSource` + one
entry in the `SOURCES` registry in `extensions/index.ts`. The core extension, hooks,
queue, and trust handling never change.

- **`jmap`** (`extensions/sources/jmap.ts`) — JMAP EventSource (SSE, RFC 8620
  §7.3) on Stalwart; watches the account's `Email` `StateChange` and emits a
  trusted `new mail` event. Reads **no** bodies; the `mail` skill (`xin`) does the
  fetch/reply/move.
- **`signal`** (`extensions/sources/signal.ts`) — spawns `signal-cli … jsonRpc`
  (a dissimilar transport: child-process JSON-RPC, not HTTP SSE) and emits a
  trusted `new message` event per incoming message; the `signal-responder` skill
  does the receive/reply.
- **`slack`** (`extensions/sources/slack.ts`) — Slack Socket Mode websocket
  (`apps.connections.open` → ws; a third transport shape alongside SSE and the
  child process). ACKs every envelope and emits a trusted `new message` event per
  message in a watched channel; the `slack-responder` skill handles the data.

## Composition — publish channels as outfitter profiles

Each channel is published in `ai-outfitter/community-profiles` as an **agent
profile** (an agent *is* the profile) whose loadout selects its channel **skill**
plus this **pi extension**:

```yaml
# agents/email-assistant/agent.md
skills: [gmail]
extensions: [git:github.com/ai-outfitter/channels]
```

Because loadout entries are slugs resolved and **merged by ID across layers**, a
user's personal agent that draws from several channel profiles gets each channel
skill once and the shared extension **deduplicated** to a single load. A
`personal-assistant` profile that lists `skills: [gmail, slack-responder,
signal-responder]` + the one extension is a unified agent assigned to all three
channels, working a single notification queue. Set (or auto-detect) the channels
whose credentials the deployment provides.

## Verifying against the Stalwart demo

1. Stand up the Stalwart demo and run the agent with `OUTFITTER_CHANNELS=jmap`
   and the loop tick raised to a long heartbeat.
2. Idle agent + send a test email via `xin`: a wake should fire within seconds
   (not on the next tick); the model runs the `mail` skill and processes it.
3. Send several while streaming: they coalesce into one follow-up sweep.
4. No mail arriving → no turns fire between heartbeats.
5. Quit/reload → the EventSource is closed by `session_shutdown` (no orphan).
