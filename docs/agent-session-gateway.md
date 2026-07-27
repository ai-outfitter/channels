# Agent Session Gateway

The Agent Session Gateway is the umbrella system for authenticated chat,
observation, control, and hosted-agent lifecycle. These capabilities share
identity and authorization, but they are separate protocols and streams. This
document defines the first implemented slice: the native **agent channel** for
agent-to-agent and authorized operator-to-agent chat.

The layers are deliberately named:

1. **agent channel** — transport-neutral conversations, messages, and
   acknowledgements exposed through Pi channel tools;
2. **Channels relay** — authenticated HTTPS/WSS transport, durable offline
   delivery, reconnect, and cursor replay;
3. **Agent Session Gateway** — the umbrella boundary that can later compose
   chat, observation, control, and hosted lifecycle;
4. **Kubernetes operator** — an independent hosted-agent server that reconciles
   lifecycle requests into workloads.

Chatto, Mattermost, Zulip, and similar services are external channel adapters.
They are not the native agent channel or the relay.

## Identity and authorization

An authenticated **principal** represents an agent or operator. An **endpoint**
is a stable address owned by one principal, such as a resident Pi session.
Principals may have several endpoints and endpoint IDs remain stable across
process restarts. The relay credential authenticates the principal and is never
sent to a browser or placed in a message.

Authorization is capability and route based:

- `register:endpoint-id` allows a connection to receive for an endpoint;
- `send:endpoint-id` allows a principal to submit to an endpoint;
- `list` allows discovery of endpoints explicitly visible to the principal.

Credentials are pre-provisioned, revocable bearer secrets. Relay routes reject
unknown credentials, endpoint impersonation, and sends outside the credential's
allowlist. A successful TLS handshake is not authorization.

## Protocol boundaries

| Plane | Purpose | Data model | This release |
| --- | --- | --- | --- |
| Chat | Human-readable conversation messages | conversation, message, acknowledgement | Implemented as channel `agent` |
| Observation | Session events, output, and telemetry | ordered event stream | Out of scope |
| Control | Interrupt, steer, approve, pause, and resume | typed commands and results | Out of scope |
| Hosted lifecycle | Create, replace, stop, and inspect workloads | desired/observed workload state | Owned by the Kubernetes operator |

Chat messages must never be encoded as control commands. Observation events are
not chat history, and relay endpoint presence is not workload desired state.
Future planes can reuse principal IDs and capability evaluation without sharing
queues, cursors, or schemas.

## Agent channel v1

Every message is an immutable, bounded envelope:

```ts
interface AgentMessageV1 {
  version: 1;
  id: string;              // sender-generated idempotency key
  conversationId: string;
  sender: string;          // authenticated principal/endpoint
  recipient: string;       // stable endpoint
  createdAt: string;       // RFC 3339
  body: string;            // opaque untrusted chat text
  replyTo?: string;
}
```

The channel locator is `agent:v1:<base64url message-id>`. Locators, wake prompts,
URLs, log fields, and metric labels contain structural identifiers only. Message
bodies appear only in durable message storage and inside the explicit untrusted
markers returned by `channel_read`.

Limits are normative defaults and may only be configured downward at a trust
boundary:

| Item | Limit |
| --- | --- |
| UTF-8 message body | 40,000 bytes |
| Identifier | 128 ASCII URL-safe characters |
| Conversation context | 50 messages / 256 KiB |
| Pending endpoint queue | 1,000 messages |
| Locator | 512 characters |
| Relay frame | 64 KiB |
| Local/relay retention | 7 days |

Messages for one conversation are presented by `(createdAt, id)`. This is a
deterministic display order, not a global clock guarantee. Delivery is
at-least-once. Receivers and senders suppress duplicates by immutable message
ID, so externally visible replies are exactly-once per response ID.

### State machine

States advance monotonically:

```text
accepted → delivered → read → replied
                         └────→ handled
```

- **accepted**: durable storage has committed the message;
- **delivered**: a local watcher or remote connection has observed it;
- **read**: `channel_read` returned bounded context containing the target;
- **replied**: a response with a stable response ID was durably accepted;
- **handled**: processing completed without a reply.

Retries repeat an operation with the same ID. They return its current state and
must not create a second message or response. State cannot move backward.
Crashes before the atomic commit have no visible effect; crashes after it are
recovered as a retry of an already accepted operation.

## Storage and transport

The transport contract contains only endpoint discovery, send, read, respond,
and subscribe. The agent adapter owns locator validation, context bounds, and
state rendering. A transport owns durable queues, idempotency, authentication,
and wake notification.

The same-host transport uses a permission-restricted filesystem spool. Each
message and acknowledgement is committed by write-to-temporary, `fsync`, rename,
and directory `fsync`. Startup and a periodic scan recover notifications missed
between the atomic rename and filesystem observation.

The remote transport uses outbound TLS WebSockets. The single-node relay stores
messages before returning `accepted`, queues them while recipients are offline,
and replays after a client resumes from its last durable cursor. Heartbeats
expire stale registrations. A replacement connection for the same endpoint is
duplicate-safe and closes the old connection. HTTPS `/healthz` reports liveness;
`/readyz` reports whether durable storage is writable.

The relay owns transport persistence, not long-term conversation archives.
Operator clients that need history beyond retention must persist their own
authorized projection.

## Flows

### Same-host agent-to-agent

1. Sender calls `agent_send` with recipient, conversation, body, and optional ID.
2. The spool atomically accepts the envelope and returns its stable ID.
3. Recipient watcher emits an `agent` event containing only the locator.
4. Pi receives a body-free wake and calls `channel_read`.
5. Recipient calls `channel_respond`; the reply is atomically accepted once.

### Remote operator-to-agent

1. Operator backend and resident agent open outbound WSS connections and
   authenticate their principals/endpoints.
2. Operator submits a message; relay authorizes its route and durably accepts it.
3. Relay delivers immediately or retains it while the agent is offline.
4. Agent acknowledges its cursor only after local durable acceptance.
5. Reconnect resumes after that cursor, replaying any unacknowledged delivery.

## Redaction and operations

Structured logs may include event name, principal ID, endpoint ID, message ID,
conversation ID, cursor, byte count, state, and error code. They must not include
message bodies, credentials, authorization headers, complete frames, or query
strings. Errors shown to unauthenticated clients are generic and do not reveal
whether a principal or endpoint exists.

Queue exhaustion, invalid frames, oversize bodies, stale cursors, unauthorized
routes, and storage failures fail closed with typed protocol errors. A storage
failure makes readiness false and prevents an `accepted` response.

## Verification matrix

| Area | Required scenarios |
| --- | --- |
| Contract | schema/version rejection, bounds, locator opacity, state monotonicity |
| Local | two agents, simultaneous conversations, operator fixture, restart recovery |
| Idempotency | repeated send/read/respond/ack, crash before/after commit |
| Capacity | message/context/queue/frame limits and retention |
| Relay auth | invalid/revoked credential, impersonation, cross-route rejection |
| Relay recovery | offline delivery, cursor replay, duplicate suppression, heartbeat expiry |
| Operations | TLS requirement, health/readiness, storage failure, redacted logs |

