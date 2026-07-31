# Local GitHub notifications runbook

Use this runbook to point the current Channels checkout at a real GitHub
account, and verify one assignment-to-wake round trip on your workstation. The
`github` source polls; it needs outbound HTTPS and no inbound listener, public
URL, or tunnel.

Run this before deploying an agent that depends on GitHub waking it. Every
misconfiguration in this channel fails **silently** — a wrong token, an
unrecognised filter, or a thread that was already marked read all produce a
process that starts cleanly, logs nothing, and never wakes. This runbook
separates "the source works" from "the deployment works", so a later failure
has only one place left to hide.

This runbook is limited to the following resources:

- One GitHub account — a machine account, not your own, if the agent will act
  on the forge.
- One repository you can assign issues in. Use a throwaway repository: the
  token below can read notifications for **every** repository the account can
  see.
- Credentials: the token is exported into the shell and never committed or
  echoed. Keep shell tracing disabled.

## Prerequisites

You need:

- this repository checked out, with `npm install` already run;
- a GitHub account you can assign issues to;
- a **classic** personal access token for that account with the
  `notifications` scope; and
- a second account (or a colleague) able to assign an issue to the first.

`GET /notifications` accepts **classic PATs only**. A fine-grained PAT and a
GitHub App installation token are both rejected, and a GitHub App cannot be an
issue assignee at all — so an assignment-driven agent needs a machine account
holding a classic token. Create one at **Settings → Developer settings →
Personal access tokens → Tokens (classic)**.

Preflight without printing the token:

```sh
test -n "${GITHUB_NOTIFY_TOKEN:?export a classic PAT first}"
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $GITHUB_NOTIFY_TOKEN" \
  https://api.github.com/notifications
```

A `200` proves the token is accepted for notifications. A `403` with a
`fine-grained` mention in the body means the token is the wrong type — reissue
it as classic. This checks the token only; it proves nothing about filters or
about the agent acting on a wake.

## Watch notifications from the checkout

Export the configuration and start Pi with the extension loaded. Filters are
listed explicitly here so the run is self-describing:

```sh
export GITHUB_NOTIFY_TOKEN="ghp_…"
export GITHUB_NOTIFY_FILTERS="review_requested,assigned_issue,assigned_pr,author"
export GITHUB_NOTIFY_POLL_MS="15000"
export OUTFITTER_CHANNELS="github"
```

`GITHUB_NOTIFY_POLL_MS` is a floor, not a fixed interval: GitHub returns an
`X-Poll-Interval` header and this source honours it whenever it asks for a
longer gap. A short value here shortens the wait for this test only if GitHub
allows it, and the source logs once when it raises the interval.

Leave `GITHUB_NOTIFY_MARK_READ` unset. It defaults to off, and it must stay off
whenever the agent reads its own notifications: marking a thread read in the
same poll that emits the wake removes the item the woken agent then looks for.

On start, the source logs its identity and configuration:

```text
[channels:github] watching notifications as <login>; filters=[…] interval=15000ms api=https://api.github.com markRead=false
```

Confirm the login is the machine account and not your own. If the line reports
an identity check failure, the poller still runs — GitHub supplies the wake
reason, so no login lookup is required — but the token is likely wrong, and
nothing will wake.

## Verify one assignment-to-wake round trip

From the **second** account, assign an issue to the watched account:

```sh
gh issue create --repo <owner>/<repo> --title "channels wake check" --body "assign to the bot"
gh issue edit <number> --repo <owner>/<repo> --add-assignee <bot-login>
```

Within one poll interval the source logs a wake:

```text
[channels:github] waking agent for: github
```

The wake carries the reason (`assign`) and nothing else. It deliberately does
not carry the issue title, which is text a stranger wrote, and it carries no
item locator — so `channel_read` and `channel_respond` do not apply to this
channel. An agent woken this way finds its work by querying its own
assignments:

```sh
gh search issues --assignee @me --state open
```

Query assignments rather than the notification list. An assignment is durable
state; a notification is a transient hint that may already have been marked
read, and the poller only reports threads updated after it started, so a
restart drops anything pending. Running the same query at session start is what
recovers that.

Then verify the negative case: activity that matches no filter must produce no
wake. Comment on an unrelated issue the account is not subscribed to, wait one
interval, and confirm no new `waking agent` line appears.

## Troubleshoot a silent channel

| Symptom | Cause | Check |
| --- | --- | --- |
| No identity line at start | The channel never started | Is `github` in `OUTFITTER_CHANNELS`, and is a token exported? |
| `identity check returned HTTP 401` | Token wrong or expired | Re-run the preflight `curl` |
| Preflight returns 403 | Fine-grained PAT or App token | Reissue as a classic PAT with `notifications` |
| Identity line is your own login | Watching the wrong account | Export the machine account's token |
| `ignoring unknown filter "…"` | Typo in `GITHUB_NOTIFY_FILTERS` | Compare against the filter table in the README |
| Starts cleanly, never wakes | The reason is filtered out | Add the reason; `assign` splits into `assigned_issue` / `assigned_pr` by subject type |
| Woke once, then never again | The agent marked threads read, or the poller restarted | Query assignments, not notifications |

Every row above produces no error and no stack trace. If the channel is quiet,
assume configuration before assuming GitHub.
