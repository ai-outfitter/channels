# Local GitHub notifications runbook

This runbook connects the current Channels checkout to a real GitHub account.
It then verifies one assignment-to-wake round trip on your workstation.

The `github` source polls GitHub. It needs outbound HTTPS. It does not need an
inbound listener, a public URL, or a tunnel.

Do this before you deploy an agent that depends on GitHub to wake it. Every
misconfiguration in this channel fails **silently**. Each of these faults
produces a process that starts cleanly, logs nothing, and never wakes:

- a token of the wrong type;
- a filter name that cannot match; and
- a thread that something already marked read.

This runbook tests the source on its own. A later failure in a deployment is
then a deployment fault, not a source fault.

This runbook is limited to the following resources:

- One GitHub account. Use a machine account, not your own, if the agent will
  act on the forge.
- One repository. Use a throwaway repository: the token below reads
  notifications for **every** repository that the account can see.
- Credentials: you export the token into the shell. Do not commit it. Do not
  echo it. Keep shell tracing disabled.

## Prerequisites

You need:

- this repository checked out, with `npm install` already run;
- a GitHub account that you can assign issues to;
- a **classic** personal access token for that account, with the
  `notifications` scope; and
- a second account that can assign an issue to the first account.

`GET /notifications` accepts **classic** personal access tokens only. It
rejects a fine-grained token. It rejects a GitHub App installation token. A
GitHub App also cannot be the assignee of an issue. An agent that works from
assignments therefore needs a machine account with a classic token.

Create the token at **Settings → Developer settings → Personal access tokens →
Tokens (classic)**.

Run this preflight. It does not print the token:

```sh
test -n "${GITHUB_NOTIFY_TOKEN:?export a classic PAT first}"
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $GITHUB_NOTIFY_TOKEN" \
  https://api.github.com/notifications
```

A `200` shows that GitHub accepts this token for notifications. A `403` shows
that the token is the wrong type. Issue a new classic token if you get a `403`.

This preflight tests the token only. It does not test your filters. It does not
test that the agent acts on a wake.

## Split the wake token from the work token

Deploy two tokens, not one:

- `GITHUB_NOTIFY_TOKEN`: a classic personal access token with the
  `notifications` scope **only**, and no other scope.
- `GITHUB_TOKEN`: a fine-grained personal access token whose resource owner is
  the single organization where the agent works, with access limited to only
  the repositories the agent works in.

A fine-grained personal access token has exactly one resource owner as a
property of the credential. An agent carrying it cannot reach another
organization. A classic personal access token has no organization boundary.
The scope discipline on the wake token is therefore load-bearing: if someone
adds `repo` "to be safe," it silently becomes a cross-organization write
credential.

Verify the classic token's granted scopes from the `X-OAuth-Scopes` response
header on any API call. This prints only the header value, never the token:

```sh
curl -sS -o /dev/null -w '%header{x-oauth-scopes}\n' \
  -H "Authorization: Bearer $GITHUB_NOTIFY_TOKEN" \
  https://api.github.com/notifications
```

The header lists the granted scopes, separated by commas. A correctly minted
wake token shows `notifications` and nothing else. Any additional scope,
especially `repo`, means the token is broader than this runbook intends. The
header is empty for a fine-grained token, which is a further reason to check
the wake token specifically.

The `githubConfigFromEnv` function reads `GITHUB_NOTIFY_TOKEN` first and falls
back to `GITHUB_TOKEN`. Omitting `GITHUB_NOTIFY_TOKEN` forces the one token to
be classic so that polling works, and collapses this split.

For the canonical credential ranking and rationale, see the
[forge credential model](https://github.com/ai-outfitter/outfitter/blob/main/docs/architecture/forge-credential-model.md).
This runbook owns the deployment mechanism.

## Watch notifications from the checkout

Export the configuration, then start Pi with the extension loaded. This example
lists the filters in full, so that the run describes itself:

```sh
export GITHUB_NOTIFY_TOKEN="ghp_…"
export GITHUB_NOTIFY_FILTERS="review_requested,assigned_issue,assigned_pr,author"
export GITHUB_NOTIFY_POLL_MS="15000"
export OUTFITTER_CHANNELS="github"
```

`GITHUB_NOTIFY_POLL_MS` sets a floor, not a fixed interval. GitHub returns an
`X-Poll-Interval` header. This source uses that value when GitHub asks for a
longer gap than your floor. A short floor therefore shortens this test only if
GitHub permits it. The source logs the interval each time it changes.

`GITHUB_NOTIFY_MARK_READ` is retired and ignored with one startup warning.
Channels now accepts the exact notification revision before it marks the
notification read. See the [GitHub acknowledgment migration note](../a2a-source-conformance.md#migration-note-github-acknowledgment).

At start, the source logs its identity and its configuration:

```text
[channels:github] watching notifications as <login>; filters=[…] interval=15000ms api=https://api.github.com acknowledgment=after-acceptance
```

Confirm that the login is the machine account, and not your own account.

The line can instead report that the identity check failed. The poller
continues to run in that case, because GitHub supplies the wake reason and this
source needs no login. But the token is probably wrong, and nothing will wake.

## Verify one assignment-to-wake round trip

From the **second** account, assign an issue to the watched account:

```sh
gh issue create --repo <owner>/<repo> --title "channels wake check" --body "assign to the bot"
gh issue edit <number> --repo <owner>/<repo> --add-assignee <bot-login>
```

The source logs a wake within one poll interval:

```text
[channels:github] waking agent for: github
```

The wake carries one word: the reason. For this test the reason is
`assigned_issue`. GitHub sends `assign` for both issues and pull requests, and
this source splits that one reason by subject type, so that every forge reports
the same event by the same name.

The Task carries the exact repository, subject kind, number, notification ID,
reason, and revision, but not the attacker-controlled title. Process only that
subject. Do not query all assignments or scan the notification inbox during the
turn. Startup reconciliation resumes from the durable poll window after a
restart; see the [migration note](../a2a-source-conformance.md#migration-note-github-acknowledgment).

Now test the negative case. Activity that matches no filter must produce no
wake. Comment on an unrelated issue that the account does not subscribe to.
Wait one interval. Confirm that no new `waking agent` line appears.

## Troubleshoot a silent channel

| Symptom | Cause | Check |
| --- | --- | --- |
| No identity line at start | The channel did not start | Is `github` in `OUTFITTER_CHANNELS`? Is a token exported? |
| `identity check failed` in the identity line | The token is wrong or expired | Run the preflight `curl` again |
| The preflight returns 403 | The token is fine-grained, or an App token | Issue a classic token with the `notifications` scope |
| The identity line shows your own login | The poller watches the wrong account | Export the machine account's token |
| `filter "…" is not a GitHub notification reason` | A filter name is misspelled | Compare it against the filter table in the README |
| `filter "assign" never matches` | `assign` is split by subject type | Use `assigned_issue` or `assigned_pr` |
| Starts cleanly, but never wakes | The filters exclude the reason | Add the reason to `GITHUB_NOTIFY_FILTERS` |
| A revision is not re-woken after restart | Checkpoint or reconciliation failure | Inspect the task-plane source checkpoint and the [migration note](../a2a-source-conformance.md#migration-note-github-acknowledgment) |

No row in this table produces an error or a stack trace. If the channel is
quiet, examine your configuration first. Examine GitHub second.

## Deploy this channel to a resident agent

The round trip above proves the source. Four things change when the same
channel runs as a deployed agent instead of a workstation process.

**Give the agent a shell.** This is the most common way a deployment of this
channel fails. A Slack or mail agent can run with its tools restricted to
`channel_read,channel_respond`, because its channel delivers a message and its
adapter sends the reply. This channel delivers no message and has no adapter:
`channel_read` throws for it. An agent restricted that way starts cleanly,
receives every wake, and can do nothing with any of them. A GitHub agent needs
the tools that run `gh` and edit files.

**Keep the tokens split.** Deliver both tokens described above as secrets,
never in an image or a manifest.

**Expect startup reconciliation.** The poller persists its poll window, `since`,
`lastModified`, and seen state after acceptance. On restart it reconciles unread
notifications from that window before advancing the checkpoint. See the
[migration note](../a2a-source-conformance.md#migration-note-github-acknowledgment).

**Keep the account assignable.** Wakes for `assigned_issue` and `assigned_pr`
arrive only if the forge can assign an issue to this account. A GitHub App
cannot be an assignee, so the account must be a machine user, and it must have
access to the repositories the agent works in.
