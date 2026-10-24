# Resident main-session voice conversation

The optional `/voice/*` API delivers each transcript directly to the resident's
existing persistent main Pi session with `pi.sendUserMessage(text,
{ deliverAs: "followUp" })`. It does not create an A2A task session or an
intermediary model. The resident keeps its current profile, model, tools and
conversation context. A2A tasks retain their existing separate task sessions.

Enable the existing A2A HTTP listener and set `A2A_VOICE_PRINCIPALS` to a
comma-separated list of credential principals explicitly trusted to assert voice
caller identities, for example `voice-broker:voice-preview`. The default is deny.
These principals must already have bearer credentials in `A2A_CREDENTIALS_PATH`.
Do not grant the capability to forge/webhook callers or expose this credential to
a browser. The broker must authenticate its caller and derive organizationId,
userId and callId from its stored call; it must not proxy browser-supplied scope.

This is the resident's shared main memory, not isolated user chat history. A lease
isolates live output delivery and serializes voice turns; it does not remove
shared resident memory or prevent the resident from recalling earlier work.
Authorize callers for that shared resident trust boundary.

## HTTP contract

All routes are POST JSON with `Authorization: Bearer <service credential>`, on
the existing A2A host/port. The A2A protocol-version header is not required for
these separate routes. Successful responses are JSON with `Cache-Control:
no-store`. Errors use HTTP status and `{ "error": "..." }` (bearer failures keep
the existing A2A authentication error format).

A scope is `{callId, organizationId, userId}`. IDs are opaque nonempty strings
(up to 128 UTF16 code units, without ASCII control characters). All operations carry that same
scope. The authenticated principal is also part of the binding.

- `/voice/lease`: scope plus `expiresAt`, an epoch-millisecond timestamp in the
  next sixteen minutes. Returns `{leased:true}`. Acquire before starting media;
  an incompatible caller lease or busy unleased main session returns 409. The
  same owner can renew its lease. Expiry stops new submissions, not resident work.
- `/voice/turns`: scope plus immutable `turnId` and exact `text` (nonblank, up to
  16000 UTF8 bytes and 8000 UTF16 code units). Requires a current unreleased lease. Returns
  `{turnId,state}` after a durable queued receipt, before inference is dispatched.
  Retrying the same owner/id/text returns the stored state without rerunning;
  changed text returns 409. Cross-owner turn lookup returns 404.
- `/voice/turns/poll`: scope plus `turnId` and integer `afterSeq` (initially zero).
  Returns `{turnId,events:[...]}` with contiguous positive sequence numbers. Pages have
  at most 32 events and at most 16000 UTF8 bytes of JSON. Each assistant text
  chunk is at most 2048 UTF16 code units, without splitting surrogate pairs.
  Polling a caller's accepted turn remains possible after lease expiry/release.
- `/voice/lease/release`: scope. Returns `{released:true}`. A busy lease stays
  reserved until all accepted work drains. Release does not cancel queued or
  running work. Neither hangup nor barge-in should invoke A2A cancellation or Pi
  abort. Barge-in can stop playback at the client while resident work continues.

Turn states are `queued`, `running`, `completed`, `failed`, `uncertain`. Events:

```json
{"seq":1,"type":"status","state":"queued"}
{"seq":2,"type":"status","state":"running"}
{"seq":3,"type":"assistant-text","text":"The resident's own words."}
{"seq":4,"type":"status","state":"tool-running"}
{"seq":5,"type":"terminal","state":"completed"}
```

Only assistant text deltas and content-free tool activity are forwarded. Thinking,
tool arguments and tool results are not voice events. Completion waits for Pi's
`agent_settled`, rather than an `agent_end` that might precede automatic retry.
On automatic retry, a `retrying` status distinguishes the next attempt; a voice
client may suppress the remainder of that turn playback rather than speaking a
partial answer followed by a repeat. Already-played audio cannot be retracted.
A mismatched prompt, intervening main-session user message, or custom message
after assistant output starts ends correlation
as `uncertain`; subsequent foreign output is not delivered to the voice caller.
The adapter does not block or cancel that other main-session activity. Channels
wakes can also intervene and make a voice turn uncertain.

If dispatch does not reach the own-prompt hook within ten seconds, the turn is
marked uncertain and voice intake is quarantined. Pi preflight can remain pending
while reporting idle, so automatically starting another turn would risk attributing
a late original answer to it. Quarantine clears only through process/session recovery; an unrelated later
settle cannot prove the pending preflight ended, so it does not clear quarantine.
Recovery marks all remaining accepted work uncertain without replay; the adapter never cancels the pending Pi work.

## Durability and recovery

The adapter writes a private mode-0600, fsync'd per-main-session journal under
`CHANNELS_TASK_STORE_PATH/voice-conversations/<session-id-hash>.jsonl` (the normal
Channels task-plane data directory when unset), and mirrors turn/status/terminal records with
`pi.appendEntry("channels:voice-conversation", record)` for session audit. The
separate journal is necessary because Pi can buffer session entries until its
first assistant message. Session IDs keep journals separate when switching Pi
sessions. A persistent Pi session is required. Configure a stable resumed main
session ID and persistent
session/journal directories across pod replacement. The operator direct-Pi source
uses `--session-id <Agent name>` and a session directory on the resident home PVC;
this implementation does not itself prove a live pod restart preserved context.

After restart every accepted nonterminal turn becomes `uncertain`, including
queued turns: no automatic replay is attempted. The original owner may poll that
terminal receipt. The broker must preserve its turn ID before submit and poll the
same ID after ambiguous network errors; it must not mint a fresh ID to retry an
unknown execution. Corrupt journal data fails startup closed. Journal write
failures close further voice intake and never authorize a replay.

There are at most 16 waiting turns, 10000 retained turn receipts per main session,
4096 nonterminal events and 256KiB assistant text per turn, and a 64MiB total
per-session side journal. Text deltas are batched at 2048 code units, on assistant
message end/tool status, or every 250ms. Only turn/status/terminal records are
mirrored to the audit journal, avoiding a session custom entry per token. An
audit-mirror failure is logged and does not invalidate the durable side receipt.
Receipts are not silently pruned because
that would lose deduplication. Capacity exhaustion requires explicit operator
maintenance; do not delete the journal and then retry old turn IDs.

This is source implementation and local verification, not a deployment receipt.
The resident Channels pin/runtime and explicit voice-principal configuration must
be updated together before a broker can use the API. No cluster change or release
is performed by this change.

Release of an absent or differently owned lease returns409, not a successful
no-op. A broker whose acquire timed out must retry release of that exact scope;
it must not treat409 as proof a delayed acquire cannot still arrive. That race
can temporarily reserve a lease until successful cleanup or natural expiry.
