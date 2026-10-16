// Read a deployment-owned app name and webhook URL from a private JSON file.
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (typeof config.name !== 'string' || !config.name.trim() || config.name.length > 80) throw new Error('Configure the bot display name');
const url = config.requestUrl ? new URL(config.requestUrl) : null;
if (url && (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/slack/events')) throw new Error('Configure the shared HTTPS webhook URL');
console.log(JSON.stringify({
  display_information: { name: config.name, description: 'Agent bot for your workspace.' },
  features: { bot_user: { display_name: config.name, always_online: true } },
  oauth_config: { scopes: { bot: ['app_mentions:read', 'channels:read', 'channels:history', 'chat:write', 'reactions:write', 'files:read', ...(config.privateChannels ? ['groups:history'] : [])] } },
  settings: { ...(url ? { event_subscriptions: { request_url: url.href, bot_events: ['app_mention'] } } : {}), socket_mode_enabled: false, org_deploy_enabled: false, token_rotation_enabled: false },
}, null, 2));
