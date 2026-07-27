# channels

A [Pi](https://github.com/earendil-works/pi) extension that watches email,
Signal, GitHub notifications, and Slack mentions, then wakes the running session
only when a source detects matching work. Sources may use push connections,
local daemons, or lightweight polling. Multiple channels share one notification
queue.

The wake is a trusted, body-free ping ("there's new activity on `github`"). For
exact items, the agent reads and replies through channel-neutral tools, so
message contents never enter the session as instructions.

## Install

Install it into pi like any other package (pi loads the raw TypeScript via jiti —
no build step):

```bash
pi install git:github.com/ai-outfitter/channels     # writes ~/.pi/agent/settings.json
```

Variants:

```bash
pi install -l git:github.com/ai-outfitter/channels   # project scope (.pi/settings.json), team-shareable
pi -e git:github.com/ai-outfitter/channels           # load for one run only, no install
```

Or add it by hand to the `packages` array in `~/.pi/agent/settings.json`:

```json
{ "packages": ["git:github.com/ai-outfitter/channels"] }
```

Confirm with `pi list`; update later with `pi update --extensions`.

## Run it resident

A channel watcher starts its connection, daemon, or polling loop with the session
and stops it when the session ends, so it needs a **long-running session**:

- **Interactive:** just run `pi` — the connections stay open until you quit.
- **Headless:** `pi --mode rpc` for an unattended, programmatically-driven session.

Avoid `-p`/`--print` (one-shot, exits immediately). Switching sessions (`/new`,
`/resume`, `/fork`, `/reload`) tears the connections down and reopens them on the
new session — that's expected.

## Pair each channel with a skill

The extension provides wake transport plus `channel_read` and
`channel_respond`. Skills teach the agent when to use them. The
[`ai-outfitter/community-profiles`](https://github.com/ai-outfitter/community-profiles)
catalog publishes matching skills — `mail`, `signal-responder`, `slack-responder`
— and ready-made agent profiles. Enable the channel's skill alongside this
extension. Slack uses the common tools today; the existing JMAP, Signal, and
GitHub skills retain their current workflows until their exact-item adapters are
implemented.

## Choose which channels run

Set `OUTFITTER_CHANNELS` in your shell before launching pi:

| `OUTFITTER_CHANNELS` | Behavior |
| --- | --- |
| unset | **Auto-detect** — start every channel whose credentials are present. |
| `jmap,signal` | Start exactly those channels (comma/space list). |
| `off` / `none` | Disabled. |

Auto-detect enables a channel when its required environment variables are
present.

## Set up each channel

pi has no per-extension config file, so each channel is configured with **shell
environment variables** you export before running `pi` (put them in your shell
profile, an `.envrc`, or a systemd unit for a persistent watcher). Credentials
belong to the extension adapter; existing non-tool skills may reuse them.

### Email — `jmap`

Watches a JMAP mailbox's `Email` state over an EventSource (SSE) and wakes
whenever that state changes. It reads no message bodies; the `mail` skill (via
`xin`) determines whether actionable new mail exists.

- **Prerequisites:** a JMAP mailbox (e.g. [Stalwart](https://stalw.art/),
  Fastmail) and the `mail` skill enabled. *(JMAP servers only — Gmail is not JMAP;
  use the `gmail` skill/`gam` for Google Workspace.)*
- **Configure:**

  ```bash
  export XIN_BASE_URL="https://jmap.example.com"
  export XIN_BASIC_USER="you@example.com"
  export XIN_BASIC_PASS="app-password"
  ```

### Signal — `signal`

Spawns `signal-cli … jsonRpc` and wakes on each incoming Signal message. The
`signal-responder` skill does the receive/reply.

- **Prerequisites:** [`signal-cli`](https://github.com/AsamK/signal-cli) installed
  and a **registered or linked** Signal account (its data directory), and the
  `signal-responder` skill enabled.
- **Configure:**

  ```bash
  export SIGNAL_NUMBER="+15550100"
  export SIGNAL_CLI_CONFIG="$HOME/.local/share/signal-cli"   # signal-cli data dir
  ```

### GitHub notifications — `github`

GitHub has no push transport, so this channel **polls your notifications** and
wakes you **only when one matches your filters**. Pair with `gh`/a GitHub skill to
act on them.

- **Prerequisites:** a token that can read your notifications (a classic PAT with
  the `notifications` scope, or a fine-grained token with *Notifications: read*).
- **Configure:**

  ```bash
  export GITHUB_TOKEN="ghp_…"
  export GITHUB_NOTIFY_FILTERS="review_requested,assigned_issue"   # optional; this is the default
  export GITHUB_NOTIFY_POLL_MS="60000"                             # optional; default 60s
  ```

  | Filter | Wakes on |
  | --- | --- |
  | `review_requested` | a PR review requested from you |
  | `assigned_issue` | an issue assigned to you |
  | `assigned_pr` | a PR assigned to you |
  | `mention` | you were @-mentioned |

### Slack — `slack`

Uses Slack's official `@slack/socket-mode` client to open a **Socket Mode**
websocket and wakes on each `app_mention` in a watched channel. The event wake
carries only an opaque, validated locator. The `slack-responder` skill passes it
to `channel_read` and `channel_respond`; the extension owns context retrieval,
thread addressing, and the handled reaction.

- **Prerequisites:** a Slack app with **Socket Mode** enabled — an app-level token
  (`xapp-…`, scope `connections:write`) for the socket, plus the bot token
  (`xoxb-…`, scopes `app_mentions:read`, `channels:history`, `chat:write`,
  `reactions:write`) used by the official `@slack/web-api` client. Add
  `groups:history` for private channels. Under
  *Event Subscriptions*, subscribe to `app_mention`, then invite the bot to the
  channels it should watch.
- **Configure:**

  ```bash
  export SLACK_APP_TOKEN="xapp-…"                  # Socket Mode (this extension)
  export SLACK_CHANNEL_IDS="joined"                 # default: every channel the bot has joined
  export SLACK_BOT_TOKEN="xoxb-…"                  # context/reply action adapter
  ```

  Both tokens are required for an operational Slack channel: the app token owns
  the wake transport and the bot token owns context/reply operations. The
  source verifies the bot credential with `auth.test`; message text is fetched
  only when the agent calls `channel_read`. Transient authentication or initial
  connection failures retry without blocking other configured channels. Omit
  `SLACK_CHANNEL_IDS` or set it to `joined` for the default. Set it to one or
  more channel IDs to narrow the bot below its Slack membership boundary.

#### Test against a real Slack workspace locally

Socket Mode connects outbound, so local testing needs no public URL or tunnel.
Follow the [local Slack runbook](docs/runbooks/slack-local.md) to configure the
app, start the resident bot, and verify a mention-to-reply round trip.

### Minimal end-to-end

```bash
pi install git:github.com/ai-outfitter/channels
export GITHUB_TOKEN="ghp_…"            # + any other channels' vars
pi                                     # keep this session running
```

The agent now wakes when a review is requested from you (and any other configured
channel), rather than polling.

## Using it with Outfitter

If you compose agents with Outfitter (profiles, skills, in-cluster), select this
extension in an agent's loadout instead of `pi install` — see
**[Using channels with Outfitter](https://github.com/ai-outfitter/outfitter/blob/main/docs/documentation/channels.md)**.

## How it works

Connection lifecycle runs on **inference-free** pi hooks (`session_start` opens
each push stream; `session_shutdown` closes them). Only a real event calls
`pi.sendUserMessage` (a turn), idle-gated and coalesced across channels into one
sweep. Full design, the pi primitives, and verification are in
[docs/channel-events.md](docs/channel-events.md). Source boundaries and the
channel tool boundary, library evaluation, and per-channel dynamic-import
convention are in
[docs/architecture.md](docs/architecture.md).

Native agent-to-agent and authorized operator-to-agent chat, including the
identity model and boundaries from observation/control/lifecycle, is specified in
[Agent Session Gateway](docs/agent-session-gateway.md).

## Add a channel

Add `extensions/sources/<name>.ts` with a `ChannelSource` and, for exact-item
tools, `ChannelActions`, then add one entry in the `SOURCES` registry.

```text
extensions/
  index.ts            # hooks, notification queue, lazy adapter routing
  channel-tools.ts    # channel_read / channel_respond
  sources/
    types.ts          # source, event, locator, and action contracts
    util.ts           # shared helpers (parseList, scopedLog, reconnect delay)
    jmap.ts           # JMAP EventSource source
    signal.ts         # signal-cli jsonRpc source
    github.ts         # GitHub notifications (polling) source
    slack.ts          # Slack Socket Mode source + action adapter
docs/channel-events.md
```
