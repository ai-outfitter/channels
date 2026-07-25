#!/usr/bin/env bash
#
# Run the current Channels checkout as a host-local resident Slack bot.
#
# Socket Mode is outbound-only: this process is the local "server" and needs no
# public URL or tunnel. Keep it running, then @mention the installed app in a
# channel it has joined (or in an explicit SLACK_CHANNEL_IDS allowlist).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dotenv="${SLACK_DOTENV:-$root/.env.slack.local}"

if [[ -f "$dotenv" ]]; then
	set -a
	# This is an explicitly selected, user-owned local secrets file.
	# shellcheck disable=SC1090
	source "$dotenv"
	set +a
fi

node --experimental-strip-types "$root/dev/slack-preflight.ts"

export OUTFITTER_CHANNELS=slack
model="${SLACK_DEV_MODEL:-openai-codex/gpt-5.4-mini}"

echo "Starting the local Slack bot with model $model."
echo "Keep this process running, then @mention the bot in a joined channel."

exec pi \
	--mode rpc \
	--no-session \
	--offline \
	--approve \
	--no-context-files \
	--no-extensions \
	--no-skills \
	--no-prompt-templates \
	--no-builtin-tools \
	--tools channel_read,channel_respond \
	--model "$model" \
	--extension "$root/extensions/index.ts" \
	--skill "$root/dev/slack-responder/SKILL.md" \
	--append-system-prompt "$root/dev/slack-system-prompt.md"
