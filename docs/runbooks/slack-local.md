# Local Slack runbook

Use this runbook to connect the current Channels checkout to a real Slack app,
run the bot on your workstation, and verify one mention-to-reply round trip.
Socket Mode is outbound: the local process needs no HTTP listener, public URL,
or tunnel.

Slack setup links:

- [Create or manage Slack apps](https://api.slack.com/apps) — select
  **Create New App** to add the bot to a workspace.
- [Slack's official Socket Mode setup](https://docs.slack.dev/apis/events-api/using-socket-mode/)
  — documents app-level tokens, `connections:write`, event subscriptions, and
  why Socket Mode needs no Request URL.
- [Create an app from Slack's app settings](https://docs.slack.dev/app-management/quickstart-app-settings/)
  — Slack's browser-based app creation walkthrough.

## Success criteria

The test passes only when all of these are true:

- the resident process connects as the expected bot;
- a human posts one marked, top-level mention in a channel the bot has joined;
- the bot posts exactly one later reply in that message's thread;
- the bot adds its handled reaction to the mention; and
- `npm run verify:slack` exits zero.

## Prerequisites

You need:

- permission to create or install an app in the company Slack workspace, or an
  app administrator who can approve it;
- a dedicated test channel;
- Node.js, npm, and `pi` on `PATH`;
- this repository with dependencies installed; and
- working Pi credentials for the selected model.

From the repository root:

```bash
npm install
pi --version
npm run check
```

The local runner defaults to `openai-codex/gpt-5.4-mini`. Set
`SLACK_DEV_MODEL` if your Pi installation uses another authenticated model.

## Configure the Slack app

Use one app installed in the same workspace as the test channel. If company
policy restricts app creation, scopes, or installation, give the following
configuration to a Slack app administrator and wait for approval before
continuing.

1. Open [Slack's **Your Apps** page](https://api.slack.com/apps), then create or
   select the app in the target workspace.
2. Under **Socket Mode**, enable Socket Mode.
3. Under **Basic Information → App-Level Tokens**, generate a token with
   `connections:write`. Save the resulting `xapp-…` token.
4. Under **OAuth & Permissions → Bot Token Scopes**, add:

   - `app_mentions:read`
   - `channels:history`
   - `chat:write`
   - `reactions:write`

   Add `groups:history` only when the test channel is private. Do not add
   `chat:write.public`, user-token, or admin scopes.

5. Under **Event Subscriptions**, enable events and subscribe the bot to
   `app_mention`. Socket Mode does not use a Request URL.
6. Install the app to the workspace. If the app was already installed, reinstall
   it after changing scopes.
7. Copy the installed bot token from **OAuth & Permissions**. It starts with
   `xoxb-`.
8. Invite the bot to the dedicated test channel with `/invite @your-bot`.
9. For verification, open the test channel details and copy its channel ID,
   such as `C0123ABCD`.

The app token, bot token, and channel ID must belong to this app and workspace.
Slack documents the same setup in
[Using Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/)
and the [`app_mention` event reference](https://docs.slack.dev/reference/events/app_mention/).

## Set the local environment

The local runner defaults to every channel the bot has joined. Set
`SLACK_CHANNEL_IDS=joined` explicitly for clarity, or omit it. One or more
channel IDs narrow handling to those channels. `joined` cannot be mixed with
channel IDs.

The checkout ignores `.env.slack.local`. The runner loads it automatically when
present:

```dotenv
SLACK_CLI_APP_ID=A0BKPNHJ12N
SLACK_CLI_TEAM_ID=T7GCW93AA
SLACK_CLI_APP_NAME=nonprod-bot
SLACK_CLI_ENVIRONMENT=local
SLACK_APP_TOKEN=xapp-REPLACE_ME
SLACK_BOT_TOKEN=xoxb-REPLACE_ME
SLACK_CHANNEL_IDS=joined
SLACK_VERIFY_CHANNEL_IDS=C0123ABCD
```

Restrict the file to your account:

```bash
chmod 600 .env.slack.local
```

Set `SLACK_DOTENV` to another path if a password manager or local secrets
workflow writes the file elsewhere.

To keep tokens out of shell history, enter them without putting their values in
the command when you do not use the dotenv file:

```bash
read -rsp "Slack app token (xapp-): " SLACK_APP_TOKEN; echo
read -rsp "Slack bot token (xoxb-): " SLACK_BOT_TOKEN; echo
read -rp "Slack verification channel ID: " SLACK_VERIFY_CHANNEL_IDS
export SLACK_APP_TOKEN SLACK_BOT_TOKEN SLACK_VERIFY_CHANNEL_IDS
```

Optional overrides:

```bash
export SLACK_DEV_MODEL="openai-codex/gpt-5.4-mini"
export SLACK_VERIFY_MARKER="[channels-local-smoke]"
export LINK_SLACK_DONE_EMOJI="white_check_mark"
```

Do not commit the tokens, paste them into chat, or store them in a tracked
`.env` file. The verification terminal needs the same three required variables
and the same marker and emoji overrides.

## Start the resident bot

In the first configured terminal:

```bash
npm run dev:slack
```

The command:

1. authenticates the bot token with `auth.test`;
2. verifies every explicit channel ID, or uses Slack membership as the boundary
   in the default `joined` mode; and
3. starts Pi in resident RPC mode with only `channel_read` and
   `channel_respond`.

Wait for output like:

```text
Slack bot U… authenticated.
Listening for mentions in every channel the bot has joined.
[channels:slack] socket mode connected as U…
```

The first two lines validate the bot token and channel access. The connection
line validates the app-level token and Socket Mode.

## Send the test mention

Post a new top-level message in any channel the bot has joined. Replace `@your-bot`
with the installed app:

```text
@your-bot [channels-local-smoke] Reply with a one-sentence confirmation that the local channel test works.
```

If you changed `SLACK_VERIFY_MARKER`, use that exact marker. The verifier scans
top-level channel history for the marked mention.

## Verify the round trip

After the bot replies, open a second terminal and set the same environment
variables. Then run:

```bash
npm run verify:slack
```

A passing result contains only structural evidence:

```text
Slack local round trip verified:
  channel: C…
  mention: 17….……
  thread:  17….……
  reply:   17….……
  handled: white_check_mark
```

When the listener uses `joined`, `SLACK_VERIFY_CHANNEL_IDS` tells the verifier
which test channel to inspect without requiring broad channel-list scopes. The
verifier exits nonzero unless it finds the latest marked human mention,
exactly one later reply from the bot, and the bot's handled reaction. It does
not print message content or tokens.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `SLACK_APP_TOKEN must be an xapp-…` | Generate an app-level token under **Basic Information** with `connections:write`. Do not use the bot token here. |
| `SLACK_BOT_TOKEN must be an xoxb-…` or authentication fails | Copy the installed bot token from **OAuth & Permissions**. Reinstall or rotate the app if the token was revoked. |
| `missing_scope` | Add the scope named by Slack, then reinstall the app so the installed bot receives it. |
| `not_in_channel`, `channel_not_found`, or preflight cannot read the channel | Invite the bot to the channel. For an explicit ID, also confirm the ID and workspace; add `groups:history` for a private channel. |
| Company approval is pending | Ask the Slack app administrator to approve the app, listed scopes, installation, and dedicated test channel. |
| Socket Mode never connects | Confirm Socket Mode is enabled and the `xapp-…` token has `connections:write`. |
| Socket connects but mentions do not wake the bot | Confirm **Event Subscriptions** is enabled, `app_mention` is subscribed, and the bot is invited. If using explicit IDs, confirm the channel is included. |
| The bot replies but verification reports no reaction | Confirm `reactions:write`, reinstall after scope changes, and use the same `LINK_SLACK_DONE_EMOJI` in both terminals. |
| Pi reports a model or authentication error | Set `SLACK_DEV_MODEL` to a model for which local Pi authentication is configured. |
| Verification cannot find the mention | Post the marked test as a new top-level message and use the same `SLACK_VERIFY_MARKER` in the second terminal. |

## Stop and clean up

Stop the resident process with Ctrl-C. Then remove the token values from each
terminal:

```bash
unset SLACK_APP_TOKEN SLACK_BOT_TOKEN SLACK_CHANNEL_IDS SLACK_VERIFY_CHANNEL_IDS
```

Remove the app from the test channel if it should not remain there. If either
token was exposed in source, logs, shell history, or chat, rotate it immediately
in the Slack app settings.
