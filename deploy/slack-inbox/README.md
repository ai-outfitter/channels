# Shared resident Slack inbox

Deploy `extensions/slack-inbox/worker.ts` with a private Wrangler configuration,
a D1 binding named `DB`, and the `SLACK_RESIDENT_BINDINGS` Worker secret. Initialize
the D1 database with `0001.sql`; schedule daily retention cleanup. No tenant,
resident, app, token, or workspace identity belongs in this directory.

The secret is an array of records with organizationId, residentId, workspaceId,
appId, signingSecret, deliveryToken, and channelIds. Each workspace/app and delivery
token must be unique. Use an explicit initial channel ID; an empty array permits
mentions in any channel Slack delivers for that installed bot. Separate bot apps
share the same HTTPS `/slack/events` request URL and deployment.

Configure each bot for `app_mentions:read`, `channels:history`, `channels:read`,
`chat:write`, `reactions:write`, and `files:read`. Add `groups:history` only for
private-channel access. Subscribe to `app_mention`; Socket Mode is unnecessary.
Native huddle transcript access must be verified with a real workspace file.

Configure each runtime with `SLACK_BOT_TOKEN`, `OUTFITTER_SLACK_EVENTS_URL` set to
this service's HTTPS `/events`, and its `OUTFITTER_SLACK_EVENTS_TOKEN`. Keep tokens
in credential storage. The existing `SLACK_CHANNEL_IDS` restriction still applies.

Events are acknowledged to Slack after durable insertion. Runtime delivery retries
until Channels accepts the activation; the event is then acknowledged using the
resident's scoped token. Channels owns task deduplication if a process crashes
between acceptance and acknowledgement. Pending deliveries expire after 24 hours;
deduplication records remain for 30 days. No request can select its own resident.

Generate each app manifest with `node deploy/slack-inbox/manifest.mjs /private/resident-slack.json`.
That private file contains only `name`, `requestUrl`, and optional
`privateChannels`. Import the resulting manifest in Slack's app settings, install
the app, and provision its signing secret, bot token and delivery credential.
The existing platform Slack Reader OAuth app can continue serving its original
user-authorized reads; its credential is not a resident bot identity and should
not be copied into resident pods.

Runtime polling checks the response's resident ID and the bot-authenticated
workspace before accepting any event. Permanent intake failures require durable
source evidence before acknowledgement; transient failures retain the event.
Only native mention fields are stored, excluding Slack's deprecated verification
token and unrelated metadata. Acknowledgement clears the message body immediately;
the retained deduplication row contains only routing/event IDs and timestamps.

For initial app creation, omit `requestUrl` from the private input. This generates
a bot/scopes-only manifest. Create/install that app, provision its identity and
signing secret in the shared service, then generate the manifest again with
`requestUrl` to enable and verify webhook delivery. This avoids requiring a
signing secret before Slack has created the app.

### Platform-managed resident setup

When the Resident Agent app manages bot authorization and channel grants, use
`OUTFITTER_SLACK_CONFIG_URL` (HTTPS, exact
`/api/connectors/resident-slack/runtime/config` path),
`OUTFITTER_SLACK_RUNTIME_TOKEN`, and `OUTFITTER_RESIDENT_ID`. Include `slack` in an
explicit `OUTFITTER_CHANNELS` selection while preserving existing sources.

The resident-scoped workload credential is provisioned once by the service
operator. Slack bot credentials stay in encrypted platform storage. The runtime
receives only a pinned inbox URL, provider proxy URL, workspace and allowed
channels. Changes are polled every 30 seconds; disconnects and unavailable
configuration stop that source. Actions recheck configuration every time.
This explicit managed configuration takes precedence over standalone Slack
credentials and Socket Mode, and it does not reset source checkpoints or Tasks.
