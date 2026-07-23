# channels

A [Pi](https://github.com/earendil-works/pi) extension that pushes **channel
events into your running pi session** — email, Signal, GitHub notifications — so
the agent wakes and runs a turn **only when a channel has real work**, instead of
polling on a timer. Multiple channels run at once and feed one notification queue.

The wake is a trusted, body-free ping ("there's new activity on `github`"); your
agent then reads and replies using that channel's skill, so message contents never
enter the session as instructions.

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

A channel watcher opens push connections when a session starts and closes them
when it ends, so it needs a **long-running session**:

- **Interactive:** just run `pi` — the connections stay open until you quit.
- **Headless:** `pi --mode rpc` for an unattended, programmatically-driven session.

Avoid `-p`/`--print` (one-shot, exits immediately). Switching sessions (`/new`,
`/resume`, `/fork`, `/reload`) tears the connections down and reopens them on the
new session — that's expected.

## Pair each channel with a skill

This extension only **wakes** the agent. To actually read and reply on a channel,
your agent also needs that channel's **skill** (or equivalent tools). The
[`ai-outfitter/community-profiles`](https://github.com/ai-outfitter/community-profiles)
catalog publishes matching skills — `mail`, `signal-responder`, `slack-responder`
— and ready-made agent profiles. Enable the channel's skill alongside this
extension.

## Choose which channels run

Set `OUTFITTER_CHANNELS` in your shell before launching pi:

| `OUTFITTER_CHANNELS` | Behavior |
| --- | --- |
| unset | **Auto-detect** — start every channel whose credentials are present. |
| `jmap,signal` | Start exactly those channels (comma/space list). |
| `off` / `none` | Disabled. |

Auto-detect means a channel turns on simply because you exported its credentials —
adding a channel is adding its env, nothing else.

## Set up each channel

pi has no per-extension config file, so each channel is configured with **shell
environment variables** you export before running `pi` (put them in your shell
profile, an `.envrc`, or a systemd unit for a persistent watcher). Each channel
reuses the same variables as its skill.

### Email — `jmap`

Watches a JMAP mailbox's `Email` state over an EventSource (SSE) and wakes on new
mail. It reads no message bodies — the `mail` skill (via `xin`) does the reading.

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

### Slack — `slack` *(planned)*

Slack Socket Mode is the next source.

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
[docs/channel-events.md](docs/channel-events.md).

## Add a channel

One file + one registry entry: add `extensions/sources/<name>.ts` exporting a
`ChannelSource`, then one entry in the `SOURCES` registry in `extensions/index.ts`.

```text
extensions/
  index.ts            # the extension: hooks, notification queue, wake logic
  sources/
    types.ts          # ChannelSource / ChannelEvent
    util.ts           # shared helpers (parseList, scopedLog, reconnect delay)
    jmap.ts           # JMAP EventSource source
    signal.ts         # signal-cli jsonRpc source
    github.ts         # GitHub notifications (polling) source
docs/channel-events.md
```
