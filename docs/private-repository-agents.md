# Private repository agent channels

This guide applies when an agent works on a repository that MUST stay private.
It describes the Channels 1.5.0 boundary. It also describes controls that other
components MUST provide.

Channels detects work and sends wakes. Channels does not control Git commands,
shell commands, process credentials, or network access. A Channels setting alone
cannot prevent a copy to another forge.

## Required deployment unit

Treat one forge organization and one agent role as one deployment unit.

Each unit MUST have these resources:

- one agent process;
- one workspace;
- one work credential;
- one Channels endpoint;
- one Channels principal; and
- one relay credential.

The endpoint and principal MUST include the organization and role. Do not reuse
them for another organization.

For example:

```dotenv
OUTFITTER_CHANNELS=agent
AGENT_ENDPOINT_ID=outfitter-agents-luce
AGENT_PRINCIPAL_ID=link:outfitter-agents-luce
AGENT_RELAY_URL=wss://relay.example.com/v1/connect
AGENT_RELAY_TOKEN=replace-with-one-org-role-secret
```

Use a different pair for the same role in another organization:

```dotenv
AGENT_ENDPOINT_ID=ncrmro-agents-luce
AGENT_PRINCIPAL_ID=link:ncrmro-agents-luce
```

The profile for `luce` MAY be common to both deployments. The identity,
workspace, credentials, session, and channel routes MUST NOT be common.

## Select channels explicitly

`OUTFITTER_CHANNELS` MUST contain an explicit list. Do not leave it unset.

An unset value enables every source for which the process finds a credential.
For example, `GITHUB_TOKEN` can enable the `github` source. A Forgejo credential
can enable the `forgejo` source.

For the protected coding agent, use:

```dotenv
OUTFITTER_CHANNELS=agent
```

Add another channel only when the organization approves that channel as a data
destination. Do not add `github` to the coding agent in the strict design.

This setting selects Channels sources only. It does not restrict `git`, `gh`,
the shell, or network destinations.

## Keep wake and work identities separate

The wake identity detects new work. The work identity reads and changes the
repository. These identities have different permissions.

The wake and work identities MUST NOT share one bearer token. The coding agent
MUST receive only the work token.

### Current GitHub notifications source

The Channels 1.5.0 `github` source polls `GET /notifications`. GitHub supports
only a classic personal access token for this endpoint. The endpoint rejects a
fine-grained personal access token. It also rejects a GitHub App installation
token. See the
[GitHub notifications API](https://docs.github.com/en/rest/activity/notifications).

The current source reads `GITHUB_NOTIFY_TOKEN` first. It falls back to
`GITHUB_TOKEN`. The separate names prevent an accidental fallback when both
variables are set. The names do not create a security boundary.

The source runs in the Pi process. Other tools in that process can receive the
same environment. Therefore, a coding agent can get the classic token if the
token is in that process.

A user notification response can contain threads from every repository that the
token owner can see. The current source has no repository allowlist. GitHub
recommends fine-grained tokens when possible. See
[Managing personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

For a repository that MUST stay private:

- The classic notification token MUST NOT exist in the coding agent process.
- The classic notification token MUST NOT exist in the coding workspace.
- The current `github` source MUST NOT run in the coding agent process.
- A wake-only process MAY use the current source as a temporary control.
- That process MUST have no repository workspace and no coding tools.
- The machine account for that process MUST see only approved repositories.

The local polling runbook remains useful for source verification. It is not the
recommended boundary for a protected coding agent.

### Work identity

The coding agent MUST receive one narrow work identity. Use one of these
options:

1. Use a fine-grained personal access token for one resource owner and selected
   repositories.
2. Use a short-lived GitHub App installation token for selected repositories
   and permissions.

Put the work token in `GITHUB_TOKEN`. Do not put a classic notification token in
this variable.

A fine-grained token is a useful temporary option. GitHub limits one token to
one resource owner. GitHub can also limit it to selected repositories and
permissions.

A GitHub App installation token is the preferred work credential. It expires
after one hour. The token request can reduce the repository set and permissions
below the installation grant. See
[Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation).

The GitHub App private key MUST stay outside the coding agent. A separate token
service SHOULD create installation tokens. Channels 1.5.0 does not provide this
service or refresh these tokens.

The work identity MUST NOT have repository Administration permission. The
runtime MUST also remove unapproved SSH agents, Git credential stores, and
provider tokens.

GitHub requires Administration write permission to create a fork, create a
repository, or update repository settings. See the
[fork API](https://docs.github.com/en/rest/repos/forks#create-a-fork) and the
[repository API](https://docs.github.com/en/rest/repos/repos).
Removing this permission blocks these API actions. It does not block a shell
from copying files to another service.

## Preferred wake design

Use a signed GitHub App webhook gateway instead of user notifications.

This gateway is a planned control. Channels 1.5.0 does not include a GitHub
webhook receiver.

The gateway MUST do these actions in this order:

1. Read the raw request bytes.
2. Check `X-Hub-Signature-256` with HMAC-SHA-256.
3. Compare signatures with a constant-time operation.
4. Reject an unknown event type.
5. Reject an unknown App installation.
6. Reject an unknown repository ID.
7. Deduplicate `X-GitHub-Delivery`.
8. Map the event to one approved organization-role endpoint.
9. Send one fixed notification through the Channels relay.

The route table MUST use approved structural fields. These fields can include
the installation ID, repository ID, event action, and an approved label. The
route table MUST NOT use a title, comment, or other free text.

GitHub documents the signature process in
[Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).
GitHub defines `X-GitHub-Delivery` as the unique delivery identifier in
[Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads).

The gateway MUST NOT put these values in a wake or relay message:

- an issue or pull request title;
- a comment body;
- a branch name;
- a commit message;
- a patch; or
- another sender-controlled value.

The gateway MAY send a fixed value such as `github-work`. The Channels `agent`
source then sends an opaque locator in the wake. The agent MUST query GitHub
with its work identity after it wakes.

The gateway MUST store its webhook secret outside all coding agents. The
credential broker MUST store the GitHub App private key. The gateway does not
need that key unless one reviewed service provides both functions. A combined
service becomes the trust root for wake routing and work credentials. The
gateway MUST keep a durable delivery-ID record for the deduplication interval.

## Scope relay routes to one organization

Create one relay credential for each organization-role pair. Each coding
credential MUST register only its own endpoint.

Create one gateway principal for each organization. Its `send` list MUST name
only endpoints for that organization.

For example:

```json
{
  "credentials": [
    {
      "token": "replace-with-gateway-secret",
      "principal": "service:github-webhook:outfitter",
      "register": ["github-webhook-outfitter"],
      "send": [
        "outfitter-agents-vega",
        "outfitter-agents-drago",
        "outfitter-agents-luce"
      ],
      "list": []
    },
    {
      "token": "replace-with-luce-secret",
      "principal": "link:outfitter-agents-luce",
      "register": ["outfitter-agents-luce"],
      "send": [],
      "list": []
    }
  ]
}
```

Do not use `send: ["*"]`. Do not add endpoints from a second organization to
the same gateway route.

The coding credential MUST have an empty `send` list for a wake-only workflow.
The `agent_send` tool can carry an arbitrary message body. Add a separate
reviewed response endpoint only when the workflow requires outbound messages.
That endpoint becomes an approved data recipient.

Relay routes control agent chat only. They do not control HTTP, Git, SSH, shell
commands, or model-provider requests.

## Current and planned controls

| Control                                         | Channels 1.5.0 state | Required use                                               |
| ----------------------------------------------- | -------------------- | ---------------------------------------------------------- |
| Explicit `OUTFITTER_CHANNELS` selection         | Available            | The coding agent MUST use an explicit list.                |
| Body-free source wakes                          | Available            | Sender-controlled content MUST stay out of wakes.          |
| `GITHUB_NOTIFY_TOKEN` name                      | Available            | It separates configuration. It does not isolate the token. |
| Classic-PAT notification poller                 | Available            | It MUST run outside a protected coding agent.              |
| Organization-scoped relay principals and routes | Available            | Every organization-role pair MUST have a unique route.     |
| Signed GitHub App webhook receiver              | Not available        | A separate gateway MUST provide it.                        |
| Webhook delivery deduplication                  | Not available        | The gateway MUST provide it.                               |
| Installation and repository routing checks      | Not available        | The gateway MUST provide them.                             |
| GitHub App token service                        | Not available        | A separate service SHOULD provide it.                      |
| Shell and Git restrictions                      | Out of scope         | The runtime MUST provide them.                             |
| Network destination restrictions                | Out of scope         | The platform MUST provide them.                            |

## Limits of this boundary

Channels does not make an unrestricted coding agent safe.

The operator and platform MUST provide these controls:

- The coding agent MUST have one organization workspace.
- The process MUST have no credential for another forge or organization.
- The process MUST have no general SSH agent.
- The network MUST deny unapproved Git providers and upload destinations.
- GitHub organization policy MUST prevent agent identities from changing
  repository visibility.
- GitHub organization policy SHOULD disable private repository forks.
- Logs and session storage MUST not contain credentials or webhook payloads.
- The approved model provider MUST be an explicit data destination.

A prompt, skill, tool allowlist, or relay route MAY reduce mistakes. None of
these controls prevents a shell command from copying files.

## Verification checklist

Complete this checklist for every organization-role deployment.

### Identity and channel selection

- [ ] `OUTFITTER_CHANNELS` contains an explicit list.
- [ ] The protected coding agent does not start the `github` source.
- [ ] The endpoint contains the organization and role.
- [ ] The principal contains the organization and role.
- [ ] No other deployment uses the endpoint or principal.
- [ ] The coding process has no `GITHUB_NOTIFY_TOKEN`.

### Work credential

- [ ] `GITHUB_TOKEN` names one resource owner.
- [ ] The token has access to approved repositories only.
- [ ] The token has the minimum required permissions.
- [ ] The token does not have repository Administration permission.
- [ ] The process has no unapproved PAT, SSH key, SSH agent, or credential
      store.
- [ ] A test against an unapproved repository fails.

### Webhook gateway

- [ ] A request with a bad HMAC signature fails.
- [ ] A request with an unknown installation fails.
- [ ] A request with an unknown repository ID fails.
- [ ] A repeated `X-GitHub-Delivery` causes only one relay notification.
- [ ] A valid event reaches only its approved organization-role endpoint.
- [ ] The relay message contains no webhook body or sender-controlled text.
- [ ] Logs contain no webhook body, secret, or authorization header.

### Relay and runtime

- [ ] Each coding credential registers only its own endpoint.
- [ ] Each wake-only coding credential has an empty `send` list.
- [ ] Any approved response endpoint is separate and names one reviewed
      recipient.
- [ ] Each gateway route lists only endpoints for one organization.
- [ ] No protected route uses `send: ["*"]`.
- [ ] A cross-organization relay send fails.
- [ ] A cross-organization Git or HTTP request fails independently of the
      relay.
- [ ] Revocation of one deployment credential does not stop another deployment.

## Related documents

- [Local GitHub notifications runbook](runbooks/github-notifications-local.md)
- [Agent Session Gateway](agent-session-gateway.md)
- [Architecture](architecture.md)
