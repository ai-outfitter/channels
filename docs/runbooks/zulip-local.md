# Local Zulip runbook

Use this runbook to verify Zulip channel mentions and direct messages through a
body-free wake, bounded read, address-preserving reply, and handled reaction.

As of 2026-07-25, automated adapter tests pass. A live smoke test has not run
because this environment has no Zulip organization or bot credentials.

## Prerequisites and permissions

Create a Zulip bot, copy its email and API key, and subscribe it to a dedicated
test channel. The bot must be able to read messages in that channel, receive
direct messages, send channel/topic and direct replies, and add reactions.
Organization policies and channel subscription remain the authorization
boundary.

Relevant Zulip APIs are [real-time events](https://zulip.com/api/real-time-events),
[send message](https://zulip.com/api/send-message), and
[add reaction](https://zulip.com/api/add-reaction).

## Configure and start

From the repository root:

```bash
npm install
npm run check
export ZULIP_ORGANIZATION_URL="https://zulip.example.com"
export ZULIP_BOT_EMAIL="bot@zulip.example.com"
read -rsp "Zulip bot API key: " ZULIP_API_KEY; echo
export ZULIP_API_KEY
export ZULIP_CHANNEL_IDS="12"
export OUTFITTER_CHANNELS="zulip"
pi -e ./extensions/index.ts
```

`ZULIP_CHANNEL_IDS` contains numeric channel IDs separated by commas or spaces.
Omit it only when every channel visible to the bot is intentionally in scope.
The allowlist applies to channel messages; direct messages to the bot remain
eligible.

## Verify the round trip

1. Wait for the resident process to register its message event queue.
2. From another account, post one `@bot` mention in a topic in the test channel.
3. Confirm the wake contains a `zulip:v1:...` locator and no message content,
   topic, channel name, sender name, or recipient address.
4. Call `channel_read` with the locator. Confirm it returns the exact target and
   at most ten messages from the same channel/topic, with `handled: false`.
5. Call `channel_respond` once. Confirm exactly one reply appears in the same
   channel/topic and `white_check_mark` is added to the exact mention.
6. Read the same locator again and confirm `handled: true`.
7. Send the bot a direct message. Confirm it wakes even when the channel
   allowlist excludes every channel, and the response goes to the same DM
   participants.
8. Stop Pi and confirm the event queue is deleted. Restart and confirm a new
   queue receives a later mention.

To exercise queue recovery, invalidate the queue with an administrative test
fixture or otherwise force the server to return `BAD_EVENT_QUEUE_ID`. Confirm
the adapter registers a fresh queue without restarting Pi.

Remove reaction permission or induce a reaction API failure to exercise partial
success. The reply must appear once and the tool must report
`replied: true, handled: false`. An API response with
`REACTION_ALREADY_EXISTS` must instead report `handled: true`. Never resend an
already successful reply.

## Troubleshooting and cleanup

| Symptom | Check |
| --- | --- |
| Authentication fails | Confirm the organization URL, bot email, and API key all belong to the same Zulip organization. |
| Channel mention does not wake | Confirm the bot is subscribed, is actually mentioned, and the numeric channel ID is allowlisted. |
| Direct message does not wake | Confirm the sender addressed the bot and the organization permits the conversation. The channel allowlist does not filter DMs. |
| Reply has the wrong address | Stop the test and record whether the source was a channel/topic or DM; do not manually alter the opaque locator. |
| Queue repeatedly expires | Check server/network timeouts and proxies; the adapter recreates `BAD_EVENT_QUEUE_ID` queues automatically. |

When finished:

```bash
unset ZULIP_ORGANIZATION_URL ZULIP_BOT_EMAIL ZULIP_API_KEY ZULIP_CHANNEL_IDS OUTFITTER_CHANNELS
```

Rotate the API key if it was exposed.
