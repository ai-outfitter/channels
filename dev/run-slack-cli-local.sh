#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dotenv="${SLACK_DOTENV:-$root/.env.slack.local}"

if [[ -f "$dotenv" ]]; then
	set -a
	# shellcheck disable=SC1090
	source "$dotenv"
	set +a
fi

slack_bin="${SLACK_CLI_BIN:-$(command -v slack || true)}"
if [[ -z "$slack_bin" && -x "${HOME}/.local/bin/slack" ]]; then
	slack_bin="${HOME}/.local/bin/slack"
fi
if [[ -z "$slack_bin" ]]; then
	echo "Slack CLI is required: https://docs.slack.dev/tools/slack-cli/" >&2
	exit 1
fi
export SLACK_CLI_BIN="$slack_bin"

"$root/dev/setup-slack-cli-app.sh"

: "${SLACK_CLI_TEAM_ID:?Set SLACK_CLI_TEAM_ID in $dotenv}"
: "${SLACK_CLI_ENVIRONMENT:=local}"

cd "$root/dev/nonprod-bot"
exec "$slack_bin" run \
	--app "$SLACK_CLI_ENVIRONMENT" \
	--team "$SLACK_CLI_TEAM_ID" \
	--no-color
