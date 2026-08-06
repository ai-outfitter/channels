# Agent mailbox runbook — Google Workspace front door, self-hosted mailboxes

Use this runbook to give a resident agent a real, deliverable internet email
address — one it can receive at and send from — without creating a Google
mailbox for it and without adding a Google Workspace licence per agent.

Google Workspace stays the front door: it owns MX, applies its spam filtering,
and relays your outbound mail from a reputable IP. Every agent mailbox lives on
a mail server you run. Agents get addresses on a dedicated subdomain of a domain
Workspace already owns, so the human domain is untouched.

The reference implementation this runbook was written from uses
[Stalwart](https://stalw.art/) as the mail server, nginx as the gateway proxy,
and a Tailscale-style WireGuard mesh (tailnet) between them. Any JMAP/IMAP
server, any TCP proxy, and any private overlay network work the same way; the
Google-side procedure is identical regardless.

Once mailboxes exist, point the extension's `jmap` channel at the mail server —
see [Email — `jmap`](../../README.md#email--jmap) — and the agent wakes on new
mail.

## What you get

- `agent-name@agents.example.com` is a real address on the public internet.
- Inbound mail is spam-filtered by Google before it reaches your server.
- Outbound mail leaves from Google's relay, so SPF, DKIM, and DMARC pass and
  deliverability does not depend on your gateway's IP reputation.
- No Google user, no Google mailbox, and no Google credentials anywhere in the
  path. Adding the 30th agent costs the same as the first: nothing.

## Success criteria

The setup is done only when all of these are true:

- an external sender's message to `agent@agents.example.com` lands in the
  agent's mailbox on your server;
- the mail server's log records the **real** external client IP for that
  delivery, not the gateway's address;
- a message sent by the agent reaches an external recipient, and its headers
  show `smtp-relay.gmail.com` in the `Received` chain with `spf=pass`,
  `dkim=pass`, and `dmarc=pass`; and
- `dig` returns your gateway's true origin IP for the SMTP hostname, on both A
  and AAAA.

## Architecture

Two hosts:

- a **gateway** with a public IP (a small VPS is enough — it runs a TCP proxy
  and nothing else); and
- a **mail server** on a private network, reachable only over your overlay
  network.

```text
INBOUND
  internet sender
    -> MX: smtp.google.com                  (Google receives + spam-filters)
    -> Gmail routing rule (envelope recipient matches @agents.example.com)
    -> Gmail mail route -> gw.example.com:25
    -> nginx stream proxy on gateway, PROXY protocol added
    -> tailnet
    -> mail server :25

OUTBOUND
  mail server queue, route "relay"
    -> gateway:587 over the tailnet
    -> nginx stream proxy
    -> smtp-relay.gmail.com:587             (authorised by the gateway's IP)
    -> internet recipient
```

Two properties make this cheap and simple:

- Google's SMTP relay in "Only addresses in my domains" mode with an IP
  allowlist needs **no account and no credentials** — the envelope sender only
  has to be in a domain registered to the tenant.
- A subdomain of an already-verified Workspace domain can be added as a
  **secondary domain with no re-verification**, and a secondary domain with no
  users costs nothing. Licences are per user, not per domain.

## Prerequisites

You need:

- a Google Workspace tenant with super-admin access and at least one verified
  domain;
- control of that domain's DNS;
- a VPS or other host with a static public IP, on which inbound TCP 25 and
  outbound TCP 587 are permitted;
- a mail server host on a private network, joined to an overlay network the
  gateway can also reach; and
- a TLS certificate on the mail server covering the gateway hostname you will
  publish (a `*.example.com` wildcard covers `gw.example.com`).

**Check your VPS provider's port-25 policy before you start.** Providers
commonly block *outbound* 25 while leaving *inbound* 25 open. That is fine here:
inbound mail arrives on 25, and outbound leaves on 587 to Google's relay, so no
unblock request is needed. Confirm the direction your provider blocks — a
provider that blocks inbound 25 cannot host this gateway at all.

## Step 1 — Add the agent subdomain to Workspace

1. Open **Admin console → Account → Domains → Manage domains**.
2. Select **Add a domain**.
3. Enter `agents.example.com` and choose **Secondary domain** (not a domain
   alias — an alias mirrors your users' addresses, which is the opposite of what
   you want).
4. Because the parent domain is already verified, Google accepts the subdomain
   with no new TXT record and no re-verification.

The tenant supports up to 600 domains, and secondary domains with no users incur
no charge. Do not create any Google user on this domain.

## Step 2 — Publish DNS for the agent subdomain

All records below are on `agents.example.com`.

| Record | Name | Value | Notes |
| --- | --- | --- | --- |
| MX | `agents.example.com` | `smtp.google.com` priority `1` | Google receives everything for the subdomain. |
| TXT | `agents.example.com` | `v=spf1 include:_spf.google.com ~all` | Outbound leaves via Google's relay, so Google's SPF range is the only one needed. |
| TXT | `_dmarc.agents.example.com` | `v=DMARC1; p=none; rua=mailto:dmarc@example.com` | Start at `p=none`; tighten once reports are clean. |
| TXT | `<selector>._domainkey.agents.example.com` | DKIM public key from the mail server | Generate on the mail server (Stalwart emits the record text with the key); the selector is whatever the server signs with. |

DKIM signing happens on your mail server, before the message reaches Google's
relay. Google's relay does not re-sign for a domain it holds no key for, so the
mail server's DKIM key is the one that must be published.

## Step 3 — Publish the gateway hostname, DNS-only

Create an A record (and an AAAA record if the gateway has IPv6) for
`gw.example.com` pointing at the gateway's public address.

**If your DNS is behind Cloudflare or any similar reverse proxy, every record
for this hostname must be grey-cloud / DNS-only.** This is the subtlest failure
in the whole setup. Proxy status is per record *type*, and a hostname with a
DNS-only A record but a **proxied AAAA record** is answered entirely with the
proxy's edge addresses — `dig A` then returns edge IPs such as `104.21.x.x` or
`172.67.x.x`, and SMTP can never reach your origin. A CNAME pointing at such a
name inherits exactly the same breakage.

The dashboard's per-record toggle is not sufficient evidence on its own. Verify
from outside:

```bash
dig +short gw.example.com A
dig +short gw.example.com AAAA
```

Both must return the gateway's real addresses and nothing else. If either
returns an address you do not recognise as your own host, stop and fix the proxy
status before continuing — everything downstream will fail silently.

## Step 4 — Run the gateway TCP proxy

The gateway runs nginx in `stream` mode only. It is a byte pump: it terminates
no TLS, parses no SMTP, and queues nothing. TLS and STARTTLS negotiate end to
end through it untouched.

```nginx
# /etc/nginx/nginx.conf  (stream context, not http)
stream {
    # Inbound: Google's mail route -> this gateway -> private mail server.
    server {
        listen 25;
        proxy_pass       10.0.0.6:25;   # mail server's overlay-network address
        proxy_protocol   on;            # preserve the real client IP
        proxy_timeout    5m;
    }

    # Outbound: mail server -> this gateway -> Google's SMTP relay.
    server {
        listen 10.0.0.2:587;            # bind to the gateway's overlay address
        proxy_pass    smtp-relay.gmail.com:587;
        proxy_timeout 5m;
    }
}
```

Replace `10.0.0.6` with the mail server's overlay address and `10.0.0.2` with
the gateway's. Binding the outbound listener to the overlay address keeps port
587 off the public interface.

`proxy_protocol on;` is what preserves the sending host's IP. Without it every
inbound connection appears to originate from the gateway, which defeats rate
limiting, greylisting, reputation scoring, and fail2ban on the mail server. The
mail server must be configured to trust and parse the PROXY header — see step 5.

Open the gateway's firewall for inbound TCP 25 from the internet. Port 587 needs
to be reachable only from the overlay network.

## Step 5 — Configure the mail server

Three things must be true on the mail server: it trusts the gateway's PROXY
protocol header, it accepts mail for the agent domain, and it routes outbound
mail through the gateway tunnel.

### Trust the PROXY protocol header

In Stalwart:

```toml
[server.listener.smtp.proxy]
trusted-networks = ["10.0.0.2"]   # the gateway's overlay address, and only it
```

List only the gateway. Any host in this list can forge its source IP.

### Route outbound mail through the tunnel

Stalwart chooses a queue route with an if/else expression, then defines that
route. Verified against Stalwart v0.15.5:

```toml
[queue.strategy]
route = [
    { if = "is_local_domain('', rcpt_domain)", then = "'local'" },
    { else = "'relay'" },
]

[queue.route.relay]
type     = "relay"
address  = "smtp-relay.gmail.com"
port     = 587
protocol = "smtp"
tls.implicit = false          # STARTTLS on 587, not implicit TLS
```

The address is the **real relay hostname**, not the gateway. Pin that hostname
to the gateway's overlay IP in the mail server's hosts file so the connection
goes through the tunnel while the TLS handshake still validates against
`smtp-relay.gmail.com`:

```text
# /etc/hosts on the mail server
10.0.0.2   smtp-relay.gmail.com
```

On NixOS:

```nix
networking.hosts."10.0.0.2" = [ "smtp-relay.gmail.com" ];
```

If you point the route at the gateway's own hostname instead, STARTTLS
certificate hostname validation fails and outbound mail stalls in the queue.

### Create agent accounts

Create one account per agent on `agents.example.com`. Two Stalwart-specific
traps, both of which produce confusing failures:

- **Every account needs `roles: ["user"]`.** Without it, authentication
  *succeeds* and then IMAP, SMTP, and JMAP all refuse the session with
  `security.unauthorized`.
- **A password must not begin with `$`.** Stalwart reads a leading `$` as the
  marker for a pre-hashed secret and stores the literal string as a hash, so
  login can never succeed.

Also pick one configuration surface and stay on it. Mixing web-UI changes with
hand-edited TOML causes settings from one side to be silently ignored.

The systemd unit is `stalwart.service` — not `stalwart-mail.service`, which is
the name in older documentation.

## Step 6 — Open the overlay network in both directions

Tailnet/WireGuard ACLs gate each direction separately, and the outbound rule is
the one most often forgotten:

- gateway → mail server, TCP 25 (inbound mail); and
- mail server → gateway, TCP 587 (outbound relay).

A missing rule shows up as a connection timeout with nothing logged on the far
side.

## Step 7 — Configure the Gmail mail route

This tells Google *where* to hand mail off.

1. Open **Admin console → Apps → Google Workspace → Gmail → Hosts**.
2. Select **Add route**.
3. Name it, for example `agent-mail-gateway`.
4. Under **Specify email server**, enter `gw.example.com` and port `25`.
5. Leave **Perform MX lookup on host** unchecked — this is a direct host, not a
   domain to resolve MX for.
6. Enable **Require TLS**, **Require CA-signed certificate**, and **Validate
   certificate hostname**.
7. Save.

Use a hostname rather than a bare IP so hostname validation can stay on. The
hostname must be covered by the certificate your mail server presents, since the
proxy passes that certificate through unchanged.

## Step 8 — Configure the Gmail routing rule

This tells Google *which* mail to hand off. Read the warning below before
saving.

1. Open **Admin console → Apps → Google Workspace → Gmail → Routing**, then the
   **Routing** setting, and select **Configure**.
2. Name it, for example `agents-subdomain-to-gateway`.
3. **Messages to affect:** check **Inbound** (add **Internal — receiving** if
   your own Workspace users must be able to mail agents).
4. Under **For the above types of messages, do the following**, choose **Modify
   message**, then **Also deliver to / Change route** — select **Change route**
   and pick the `agent-mail-gateway` route from step 7.
5. Under **Envelope filter**, check **Only affect specific envelope
   recipients**, choose **Pattern match**, and enter a regular expression that
   matches the agent domain and nothing else:

   ```text
   ^.*@agents\.example\.com$
   ```

6. Under **Account types to affect**, select **Unrecognized / Catch-all** only.
   Leave **Users** and **Groups** unchecked so real user mail is never
   redirected.
7. Save, then allow up to 24 hours for propagation (changes usually take
   minutes).

> **The envelope-recipient filter is not optional.** A routing rule that affects
> all inactive and unrecognised accounts *without* an envelope filter applies to
> **every domain in the tenant**. It silently hijacks catch-all for your primary
> human domain and any other secondary domain, sending their unmatched mail to
> your gateway. This is the single most dangerous misconfiguration in this
> procedure. Set the envelope filter in the same edit that sets the route, and
> re-open the rule after saving to confirm the filter persisted.

## Step 9 — Authorise the gateway on Google's SMTP relay

1. Open **Admin console → Apps → Google Workspace → Gmail → Routing**, then
   **SMTP relay service**, and select **Configure**.
2. Name it, for example `agent-gateway-relay`.
3. **Allowed senders:** select **Only addresses in my domains**. The envelope
   sender must then be in a domain registered to the tenant —
   `agents.example.com` qualifies, and no Google account is involved.
4. **Authentication:** check **Only accept mail from the specified IP
   addresses** and add the gateway's public IP. **Uncheck "Require SMTP
   Authentication."**
5. Optionally enable **Require TLS encryption**.
6. Save.

Leaving **Require SMTP Authentication** enabled is a silent breaker: your mail
server has no Google credentials to offer, so the relay rejects every outbound
message while the rest of the stack looks healthy.

The relay's published limit is 10,000 messages per user per 24 hours.

## Verification

Run these in order. Each step isolates one hop, so a failure names its own
cause.

### 1. DNS

```bash
dig +short agents.example.com MX
dig +short agents.example.com TXT
dig +short _dmarc.agents.example.com TXT
dig +short <selector>._domainkey.agents.example.com TXT
dig +short gw.example.com A
dig +short gw.example.com AAAA
```

MX must be `smtp.google.com`. The gateway A/AAAA answers must be your origin
addresses — nothing from a CDN or reverse proxy.

### 2. The gateway accepts connections

From an external host:

```bash
nc -vz gw.example.com 25
```

A timeout here means DNS is answering with proxy addresses, the provider blocks
inbound 25, or the gateway firewall is closed.

### 3. Inbound delivery preserves the client IP

Send a message from an external account (a personal Gmail or similar) to
`agent@agents.example.com`. Then confirm both:

- the message is in the agent's mailbox; and
- the mail server's log records the **sending host's real IP** for that SMTP
  session, not the gateway's overlay address.

The second check is the proof that PROXY protocol is working end to end. If the
log shows the gateway's address, either `proxy_protocol on;` is missing from
nginx or the gateway is absent from the mail server's trusted-networks list.

### 4. Outbound relay and authentication results

Send a message from the agent account to an external address you control.
Inspect the received message's full headers and confirm:

- a `Received` hop through `smtp-relay.gmail.com`;
- `spf=pass`;
- `dkim=pass` with your mail server's selector and `agents.example.com`; and
- `dmarc=pass`.

A message that never leaves the mail server's queue points at the relay
configuration (step 9) or the hosts-file pin (step 5).

## Troubleshooting

Nearly every failure in this stack is a **silent no-op** rather than an error.
Work symptom-first.

| Symptom | Check |
| --- | --- |
| Inbound mail vanishes — accepted by Google, never arrives | The routing rule's envelope filter, the account types it affects, and that the route it selects is the gateway route. A rule that saved without the route change looks identical in the list. |
| Mail for your **primary** domain starts arriving at the gateway | The routing rule has no envelope-recipient filter, so it is catching every domain in the tenant. Add the filter immediately; the rule is live for all domains until you do. |
| Connection to the gateway times out from outside | `dig` both A and AAAA. A proxied record of either type replaces the whole answer with edge IPs. Then check the provider's inbound-25 policy and the host firewall. |
| Google reports a certificate hostname mismatch on the route | The mail route must name a hostname covered by the certificate the mail server presents, and the proxy must not be terminating TLS. Confirm nginx is using `stream`, not `http`. |
| Every inbound connection is logged from the gateway's IP | `proxy_protocol on;` missing on the nginx inbound server, or the gateway not listed in the mail server's PROXY trusted-networks. |
| Login succeeds but IMAP/SMTP/JMAP return `security.unauthorized` | The account is missing `roles: ["user"]`. |
| Authentication fails for a password you are certain is correct | The password starts with `$`, so it was stored as a pre-hashed secret. Set a password with no leading `$`. |
| A configuration change has no effect at all | You edited TOML on a server whose settings are being managed through the web UI, or the reverse. Pick one surface. |
| The service will not start or is "not found" | The unit is `stalwart.service`, not `stalwart-mail.service`. |
| Outbound mail is rejected by the relay | **Require SMTP Authentication** is still enabled, the gateway's public IP is not in the allowlist, or the envelope sender is in a domain not registered to the tenant. |
| Outbound mail sits in the queue and never connects | The overlay ACL for mail server → gateway:587, or a missing hosts-file pin so the mail server is dialling Google directly on a blocked port 25 path. |
| Outbound STARTTLS fails with a hostname mismatch | The queue route names the gateway's hostname instead of `smtp-relay.gmail.com`. Point the route at the relay hostname and pin that name to the gateway's overlay IP. |
| Admin API returns 401 | The admin credential is wrong or the account lacks the admin role; on Stalwart, re-check that the account exists with an admin role rather than assuming the password is at fault. |

## Design notes — why not X

**Why not run the mail server on the public VPS?** In the reference deployment
the VPS is also the overlay network's control plane; it is the most exposed host
in the estate. Keeping mailbox data on a private-LAN host means a gateway
compromise exposes a TCP proxy configuration and nothing else. It also keeps
mail storage on hardware you own.

**Why not run a full MTA on the gateway instead of a proxy?** A store-and-
forward MTA there buys nothing. Sending servers already retry for days, and
Google's route retries on its own, so no queue is needed at the edge to absorb a
mail-server outage. An MTA at the edge adds a second place mail can silently get
stuck, a second spool to monitor, a second TLS configuration, and a second
identity in the `Received` chain. A `stream` proxy has none of that and passes
TLS through untouched.

**Why not DNAT / iptables for the gateway → mail-server hop?** The return path
breaks across an overlay network unless you also masquerade, and masquerading
rewrites the source address — destroying exactly the client IP that rate
limiting, reputation, and fail2ban depend on. nginx `stream` with PROXY protocol
forwards the bytes and carries the true client IP in a header the mail server
can trust, which is strictly better on both counts.

**Why not give each agent a Google mailbox?** It works, and it costs a licence
per agent per month, with a per-agent account to provision, secure, and offboard
in the same tenant as your humans. This design puts agent mail on infrastructure
you already run, and keeps Google doing only the two things it is genuinely best
at here: filtering inbound spam and lending reputation to outbound mail.
