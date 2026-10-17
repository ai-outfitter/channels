# Shared Slack inbox

Deploy `extensions/slack-inbox/worker.ts` with a private Wrangler configuration,
a D1 binding named `DB`, and the `SLACK_INBOX_BINDINGS` Worker secret. Initialize
the D1 database with `0001.sql`; schedule daily retention cleanup. No tenant,
binding, app, token, or workspace identity belongs in this directory.

The secret is an array of records with tenantId, bindingId, workspaceId,
appId, signingSecret, deliveryToken, and channelIds. Each workspace/app and delivery
token must be unique. Use an explicit initial channel ID; an empty array permits
mentions in any channel Slack delivers for that installed bot. Separate bot apps
share the same HTTPS `/slack/events` request URL and deployment.

Configure each bot for `app_mentions:read`, `channels:history`, `channels:read`,
`chat:write`, `reactions:write`, and `files:read`. Add `groups:history` only for
private-channel access. Subscribe to `app_mention`; Socket Mode is unnecessary.
Native huddle transcript access must be verified with a real workspace file.

Configure each runtime with `SLACK_BOT_TOKEN`, `SLACK_EVENTS_URL` set to
this service's HTTPS `/events`, its `SLACK_EVENTS_TOKEN`, and `SLACK_BINDING_ID`
matching the configured binding. Keep tokens
in credential storage. The existing `SLACK_CHANNEL_IDS` restriction still applies.

Events are acknowledged to Slack after durable insertion. Runtime delivery retries
until Channels accepts the activation; the event is then acknowledged using the
binding's scoped token. Channels owns task deduplication if a process crashes
between acceptance and acknowledgement. Pending deliveries expire after 24 hours;
deduplication records remain for 30 days. No request can select its own binding.

Generate each app manifest with `node deploy/slack-inbox/manifest.mjs /private/slack-bot.json`.
That private file contains only `name`, `requestUrl`, and optional
`privateChannels`. Import the resulting manifest in Slack's app settings, install
the app, and provision its signing secret, bot token and delivery credential.
The existing platform Slack Reader OAuth app can continue serving its original
user-authorized reads; its credential does not represent these bots and should
not be copied into runtime processes.

Runtime polling checks the response's binding ID and the bot-authenticated
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

### Service-managed setup

Any service implementing the managed Slack contract can supply configuration,
inbox delivery and a Slack Web API proxy. Set `SLACK_CONFIG_URL` to its HTTPS
configuration endpoint, `SLACK_CONFIG_TOKEN` to a binding-scoped workload
credential, and `SLACK_BINDING_ID` to the opaque identity expected in responses.
Include `slack` in an explicit `OUTFITTER_CHANNELS` selection while preserving
existing sources.

The configuration endpoint returns JSON with `bindingId`, `workspaceId`,
`revision`, `channelIds`, `inboxUrl`, and `proxyUrl`. Endpoint paths are service
owned: Channels does not require an Outfitter route. Both returned URLs must use
the configuration endpoint's HTTPS origin, without credentials, queries or
fragments. `inboxUrl` has no trailing slash; acknowledgements POST to its `/ack`
suffix. `proxyUrl` ends in `/` and accepts Slack Web API method names appended by
the SDK. Configuration and inbox redirects are rejected. Inbox responses contain `bindingId`,
`workspaceId`, `revision`, and `events` (each with `eventId` and `body`). A changed
revision is rejected before accepting or acknowledging events. Configuration
HTTP 409 means the binding is not connected.

Slack bot credentials stay with the service. Changes are polled every 30 seconds;
disconnects and unavailable configuration stop that source. Actions recheck
configuration every time. This explicit managed configuration takes precedence
over standalone Slack credentials and Socket Mode. It does not reset source
checkpoints or Tasks. The Resident Agent app is one consumer of this contract;
its tenant records and OAuth setup remain outside Channels.
