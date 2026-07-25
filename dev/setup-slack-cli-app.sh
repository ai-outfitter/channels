#!/usr/bin/env bash
#
# Create or refresh the ignored Slack CLI wrapper project used for local runs.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dotenv="${SLACK_DOTENV:-$root/.env.slack.local}"

if [[ -f "$dotenv" ]]; then
	set -a
	# shellcheck disable=SC1090
	source "$dotenv"
	set +a
fi

: "${SLACK_CLI_APP_ID:?Set SLACK_CLI_APP_ID in $dotenv}"
: "${SLACK_CLI_TEAM_ID:?Set SLACK_CLI_TEAM_ID in $dotenv}"
: "${SLACK_CLI_APP_NAME:=nonprod-bot}"
: "${SLACK_CLI_ENVIRONMENT:=local}"

if [[ "$SLACK_CLI_APP_NAME" != "nonprod-bot" ]]; then
	echo "SLACK_CLI_APP_NAME must be nonprod-bot for the ignored local project." >&2
	exit 1
fi

slack_bin="${SLACK_CLI_BIN:-$(command -v slack || true)}"
if [[ -z "$slack_bin" && -x "${HOME}/.local/bin/slack" ]]; then
	slack_bin="${HOME}/.local/bin/slack"
fi
if [[ -z "$slack_bin" ]]; then
	echo "Slack CLI is required: https://docs.slack.dev/tools/slack-cli/" >&2
	exit 1
fi

project="$root/dev/nonprod-bot"
if [[ ! -f "$project/.slack/config.json" ]]; then
	(
		cd "$root/dev"
		"$slack_bin" create \
			--template slack-samples/bolt-js-blank-template \
			--app "$SLACK_CLI_APP_ID" \
			--name "$SLACK_CLI_APP_NAME" \
			--team "$SLACK_CLI_TEAM_ID" \
			--environment "$SLACK_CLI_ENVIRONMENT"
	)
fi

cp "$root/dev/slack-cli/app.js" "$project/app.js"
cp "$root/dev/slack-cli/manifest.json" "$project/manifest.json"
echo "Slack CLI local project ready at $project"
