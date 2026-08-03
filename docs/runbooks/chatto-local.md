# Local Chatto runbook

Use this runbook to verify one Chatto mention through the body-free wake,
`channel_read`, threaded `channel_respond`, and notification dismissal flow.

## Compatibility boundary

The adapter vendors the schema from
[`chattocorp/chatto@ee0425759941501e5f123f9dbeb7b5ecdcc5699e`](https://github.com/chattocorp/chatto/tree/ee0425759941501e5f123f9dbeb7b5ecdcc5699e).
That revision implements realtime protocol v2 and the resumable
`notifications_replace` projection. These features are newer than Chatto
`v0.4.16`, so that tagged release is not compatible with this adapter. Test with
a server built from the pinned revision or a later release that retains the
same protocol and ConnectRPC schema. The source pin and regeneration details are
also recorded in
[`extensions/vendor/chatto/SCHEMA.md`](../../extensions/vendor/chatto/SCHEMA.md).

As of 2026-07-25, automated adapter tests pass. A live smoke test has now run: realtime protocol v2 was negotiated with capability `chatto.realtime.projection.v1`, and a mention-to-reply round trip completed against a live server. The 0.4 release line is a separate branch without the protocol v2 commit, so no published 0.4.x release can serve this adapter; only a build from main works.

## Prerequisites and permissions

You need:

- a compatible self-hosted Chatto server reachable from the workstation;
- two identities: the bot and a human tester;
- a bearer token for the bot;
- a dedicated room containing both identities; and
- Node.js, npm, and Pi installed locally.

The bot must be able to read the room timeline and its own notifications, post
top-level and thread messages, and dismiss its own notifications. Restrict the
bot to the dedicated room when the deployment's membership and token controls
allow it.

## Configure and start

From the repository root, validate the checkout:

```bash
npm install
npm run check
```

Enter the token without placing it in shell history, then start only Chatto:

```bash
export CHATTO_BASE_URL="https://chatto.example.com"
read -rsp "Chatto bot token: " CHATTO_TOKEN; echo
export CHATTO_TOKEN
export CHATTO_ROOM_IDS="room-id"
export OUTFITTER_CHANNELS="chatto"
pi -e ./extensions/index.ts
```

`CHATTO_BASE_URL` must be the HTTP(S) server origin. Omit `CHATTO_ROOM_IDS` only
when every room visible to the bot is intentionally in scope. A partial
configuration is detected at startup and does not prevent other selected
channels from starting.

## Verify the round trip

1. Wait for the resident session to start without a Chatto authentication or
   protocol error.
2. As the human tester, post one top-level message that mentions the bot.
3. Confirm the wake contains a `chatto:v1:...` locator but no message text, room
   name, sender name, or other user-controlled content.
4. Call `channel_read` with that locator. Confirm it returns the exact target,
   no more than ten messages, and `handled: false`.
5. Call `channel_respond` once. Confirm Chatto creates exactly one reply in a new
   thread rooted at the mention and reports `replied: true, handled: true`.
6. Call `channel_read` again. Confirm the dismissed notification maps to
   `handled: true`.
7. Repeat with a mention inside an existing thread. Confirm the reply stays in
   that thread.
8. Stop Pi and confirm the realtime connection closes. Restart and confirm a
   new mention still wakes the session.

For coexistence, repeat with `OUTFITTER_CHANNELS=chatto,slack`. Deliberately make
the Chatto token invalid and confirm Slack still starts, then restore the token
and restart.

If the reply succeeds but dismissal is denied, the tool must report
`replied: true, handled: false` with a warning. Record the warning; do not retry
the reply automatically.

## Troubleshooting and cleanup

| Symptom | Check |
| --- | --- |
| Protocol negotiation fails | Confirm the server is built from the pinned revision or a later protocol-v2-compatible release, not `v0.4.16`. |
| Authentication fails | Confirm the token belongs to the bot identity and is valid for this server origin. |
| No mention wake arrives | Confirm both identities are room members, the event creates a mention notification, and the room ID is allowlisted. |
| Read fails after a wake | Confirm the notification and message still exist and the bot retains room/timeline access. |
| Reply succeeds but handled is false | Grant notification-dismiss permission or fix the server error; do not resend the reply. |

When finished, stop Pi and clear the secret:

```bash
unset CHATTO_TOKEN CHATTO_BASE_URL CHATTO_ROOM_IDS OUTFITTER_CHANNELS
```

Rotate the token immediately if it was exposed in source, logs, shell history,
or chat.
