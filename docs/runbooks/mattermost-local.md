# Local Mattermost runbook

Use this runbook to verify one Mattermost mention through the body-free wake,
bounded REST read, threaded reply, and handled-reaction flow.

As of 2026-07-25, automated adapter tests pass. A live smoke test has not run
because this environment has no Mattermost server or bot credentials.

## Prerequisites and permissions

Create a [Mattermost bot account](https://developers.mattermost.com/integrate/reference/bot-accounts/)
and copy its access token. Add the bot to a dedicated test channel. Through its
roles and channel membership, the bot must be able to:

- connect to the WebSocket API and read posted events;
- read the channel and post/thread history;
- create posts and thread replies; and
- read and add reactions.

Use the narrowest practical bot role and channel membership; the adapter
allowlist does not replace server authorization.

## Configure and start

From the repository root:

```bash
npm install
npm run check
export MATTERMOST_BASE_URL="https://mattermost.example.com"
read -rsp "Mattermost bot token: " MATTERMOST_BOT_TOKEN; echo
export MATTERMOST_BOT_TOKEN
export MATTERMOST_CHANNEL_IDS="channel-id"
export OUTFITTER_CHANNELS="mattermost"
pi -e ./extensions/index.ts
```

`MATTERMOST_BASE_URL` is the server's HTTP(S) origin; the adapter derives
`/api/v4` and `/api/v4/websocket`. Omit `MATTERMOST_CHANNEL_IDS` only when every
channel visible to the bot is intentionally in scope. Channel IDs may be
separated by commas or spaces.

## Verify the round trip

1. Wait for the resident process to authenticate the WebSocket connection.
2. From another account, post one top-level `@bot` mention in the test channel.
3. Confirm the wake contains a `mattermost:v1:...` locator and no post body.
4. Call `channel_read` with the locator. Confirm the exact target is marked,
   at most ten posts are returned, and `handled` is false.
5. Call `channel_respond` once. Confirm exactly one reply appears in a thread
   rooted at the mention and `white_check_mark` is added to the exact mention.
6. Read the locator again and confirm `handled: true`.
7. Mention the bot inside an existing thread and confirm the reply uses that
   thread's existing root.
8. Stop and restart Pi. Confirm the WebSocket closes on stop and a later mention
   works after reconnect.

Remove reaction permission temporarily to exercise partial success. The reply
must appear once and the tool must report `replied: true, handled: false` with a
warning. Do not retry the reply automatically.

The implementation follows Mattermost's
[WebSocket API](https://developers.mattermost.com/integrate/reference/websocket/)
and [REST API](https://developers.mattermost.com/integrate/reference/rest-api/).

## Troubleshooting and cleanup

| Symptom | Check |
| --- | --- |
| WebSocket authentication fails | Confirm the token is a current bot token for this server and WebSocket access is enabled. |
| No wake for a mention | Confirm the bot is a channel member, the server's recipient-scoped event names the bot, and the channel ID is allowlisted. |
| REST returns forbidden/not found | Confirm bot role permissions, channel membership, server URL, and channel/post IDs. |
| Reply succeeds but handled is false | Grant reaction permission or fix the REST failure; do not resend the reply. |

When finished:

```bash
unset MATTERMOST_BASE_URL MATTERMOST_BOT_TOKEN MATTERMOST_CHANNEL_IDS OUTFITTER_CHANNELS
```

Rotate the token if it was exposed.
