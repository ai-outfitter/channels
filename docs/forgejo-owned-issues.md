# Externally orchestrated Forgejo issues

Set `FORGEJO_IGNORED_ISSUE_AUTHORS` to comma-separated account logins when an
external orchestrator owns issue dispatch. For example, an Outfitter Foundry
coordinator can create an issue which a repository workflow then assigns to a
resident. Without this filter that assignment starts a competing native task.

The source verifies the issue author from the configured Forgejo API and treats
matching Issue notifications as permanent non-work. It does not wake a resident
or copy issue text into a prompt. Author matching ignores case. The default is
empty, preserving existing behavior. Pull-request review requests and regular
human-authored issue assignments still work. Transient subject lookup failures
retain their cursor and retry normally.

This controls new notification intake only. Settle or explicitly cancel any
already active duplicate task through its authenticated native task interface;
do not rewrite task ledgers or delete the evidence.
