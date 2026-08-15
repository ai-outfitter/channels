# Changelog

## Unreleased

- **All profile authors (breaking):** The channel-name-plus-locator wake and
  its in-memory notification queue are removed. Every agent wake is now a
  Task-scoped wake from the durable task-plane queue, and old wake-prompt
  parsers no longer receive compatibility text.
- **A2A profile authors (breaking):** Inbound A2A work now receives a durable
  activation claim and queued Task authority before the agent can use A2A
  tools. Claim-free resident-owner tool access and direct listener wakes are
  removed; unclaimed, queued, foreign, and completed Task IDs fail closed.
- **Source authors (breaking):** Task-producing source loaders and migrated
  source constructors require a task sink. Emitting through the old
  `ChannelEvent` wake callback is rejected instead of waking Pi.
- **Agent, Signal, Forgejo, Mattermost, and Zulip profile authors (breaking):**
  These remaining work sources now require the task-plane sink and emit only
  Task-scoped wakes. Agent transport subscription callbacks are asynchronous;
  spool unlink and relay acknowledgment now wait for durable acceptance.
- **Mattermost and Zulip action integrators (breaking):** Reply and handled
  mutations now require task-bound delivery services. Indeterminate reply
  failures are recorded as ambiguous instead of being blindly repeated.
- **Signal operators:** Each receive envelope is now stored as the Task's
  durable exact-item payload before `signal-cli` intake advances; response
  workflows must quote the recorded sender and timestamp.
- **Forgejo operators:** Poll cursors and accepted revisions are durable, and
  configured mark-read acknowledgment occurs only after Task acceptance.
- **Task-plane operators:** The resident wake queue admits at most 128 pending
  wakes. Overflow is logged and recorded as durable failed-wake evidence.
- **All channel profiles and skills:** Every channel source now sends a
  Task-scoped wake prompt instead of the 1.7 channel-and-locator wake. Update any
  profile or skill that matches or parses the old wake text.
- **GitHub operators:** `GITHUB_NOTIFY_MARK_READ` is retired. Channels ignores a
  set value and logs one warning at startup. GitHub notifications are now marked
  read after their exact revision has been durably accepted by the task plane.
- **Chatto operators:** Channels now dismisses a notification after durable Task
  acceptance, rather than waiting until after the reply.
- **JMAP operators:** Email wakes are now limited to mail that enters INBOX,
  whether newly delivered or moved there. Other Email state changes, including
  flag changes and mail filed outside INBOX, do not create new Tasks.
- **Operators with explicit source selection:** An explicit `OUTFITTER_CHANNELS`
  selection is transactional. If any named source cannot start, no selected
  source remains running and the runtime reports unhealthy. Auto-detection still
  logs and skips an individual source that fails to start.
- **A2A/task-plane operators:** `A2A_STORE_PATH` is no longer required or read for
  the task store. Tasks created by an earlier release in that file are not
  migrated; complete or export active Tasks and retain the old file as an audit
  archive before upgrading.
- **Runtime operators:** The task-plane store now lives at
  `${XDG_DATA_HOME:-$HOME/.local/share}/outfitter/channels/task-plane`.
- **Pi package consumers:** The published package now has one Pi entrypoint,
  `./extensions/runtime-extension.ts`. Remove assumptions that the former
  extension entrypoints load independently.

## [1.7.0](https://github.com/ai-outfitter/channels/compare/v1.6.1...v1.7.0) (2026-08-13)


### Features

* triage issues with an agent resolved from the catalog ([#45](https://github.com/ai-outfitter/channels/issues/45)) ([fa0fe60](https://github.com/ai-outfitter/channels/commit/fa0fe608d323cd0864c806fa012c91087d4d77da))


### Bug Fixes

* track the action's v1 tag instead of a commit ([#48](https://github.com/ai-outfitter/channels/issues/48)) ([ea3f861](https://github.com/ai-outfitter/channels/commit/ea3f861146e66544bd74edd24195d75168a07931))

## [1.6.1](https://github.com/ai-outfitter/channels/compare/v1.6.0...v1.6.1) (2026-08-08)


### Bug Fixes

* **ci:** publish to npm with an npm that supports trusted publishing ([#32](https://github.com/ai-outfitter/channels/issues/32)) ([15827a6](https://github.com/ai-outfitter/channels/commit/15827a615c11a5b9c8b06c2a0a929cd2d27d9f81))

## [1.6.0](https://github.com/ai-outfitter/channels/compare/v1.5.0...v1.6.0) (2026-08-08)


### Features

* **a2a:** add the A2A v1 task plane ([#36](https://github.com/ai-outfitter/channels/issues/36)) ([b4f6444](https://github.com/ai-outfitter/channels/commit/b4f644406747df97876a6c7b255931cd9c79a6ba))

## [1.5.0](https://github.com/ai-outfitter/channels/compare/v1.4.0...v1.5.0) (2026-08-04)


### Features

* **jmap:** wake on CalendarAlert push for scheduled tasks ([#28](https://github.com/ai-outfitter/channels/issues/28)) ([#29](https://github.com/ai-outfitter/channels/issues/29)) ([d4c0274](https://github.com/ai-outfitter/channels/commit/d4c0274f546e02db53f7dea781258e792aeb9635))

## [1.4.0](https://github.com/ai-outfitter/channels/compare/v1.3.0...v1.4.0) (2026-08-03)


### Features

* **relay:** stream content-free turn status events ([#24](https://github.com/ai-outfitter/channels/issues/24)) ([ef4c78c](https://github.com/ai-outfitter/channels/commit/ef4c78c6e1e07105a898f9a8f963cec1ea26da58))


### Bug Fixes

* **relay:** extract status parsing to satisfy the complexity budget ([#26](https://github.com/ai-outfitter/channels/issues/26)) ([da1c8fc](https://github.com/ai-outfitter/channels/commit/da1c8fc8f302764f47040dbb0565daf9832c11e1))

## [1.3.0](https://github.com/ai-outfitter/channels/compare/v1.2.0...v1.3.0) (2026-07-31)


### Features

* add Chatto, Mattermost, and Zulip mention channels ([#10](https://github.com/ai-outfitter/channels/issues/10)) ([78630a8](https://github.com/ai-outfitter/channels/commit/78630a854a8546221bf8d526f9dd4be022efaaa9))


### Bug Fixes

* resolve the PR [#13](https://github.com/ai-outfitter/channels/issues/13) review findings (relay config, slot leak, forwarder lifecycle, Forgejo poller) ([#21](https://github.com/ai-outfitter/channels/issues/21)) ([718410d](https://github.com/ai-outfitter/channels/commit/718410db7a192ac577741e16237540e59cfb6976))

## [1.2.0](https://github.com/ai-outfitter/channels/compare/v1.1.0...v1.2.0) (2026-07-31)


### Features

* **sources:** GitHub notification parity, and stop locator-less wakes pointing at the channel tools ([#14](https://github.com/ai-outfitter/channels/issues/14)) ([bfe1049](https://github.com/ai-outfitter/channels/commit/bfe10491c1e245df894f5722aca22833f6dedea7))
* stream ephemeral reply previews with Pi text events ([#13](https://github.com/ai-outfitter/channels/issues/13)) ([51d8013](https://github.com/ai-outfitter/channels/commit/51d80133f359cfa34ba84ce805a6c36210f82e26))

## [1.1.0](https://github.com/ai-outfitter/channels/compare/v1.0.0...v1.1.0) (2026-07-27)


### Features

* add agent session channel and authenticated relay ([#12](https://github.com/ai-outfitter/channels/issues/12)) ([f1b0c2e](https://github.com/ai-outfitter/channels/commit/f1b0c2e8d388326a82471b466773bd8ac0d71e76))
* add Slack mention channel support ([#3](https://github.com/ai-outfitter/channels/issues/3)) ([cac9647](https://github.com/ai-outfitter/channels/commit/cac964724f149208a4d0fe2aca39e3e0a234045d))

## [1.0.0](https://github.com/ai-outfitter/channels/compare/v0.1.0...v1.0.0) (2026-07-23)


### Features

* channels — pi extension for native channel-event push ([2755320](https://github.com/ai-outfitter/channels/commit/2755320677d7c6ed89e6405dd2e20937052483b9))
* **slack:** add Socket Mode channel source ([d0d30c0](https://github.com/ai-outfitter/channels/commit/d0d30c02d46a2ef0b512f81bd52ebc604e63079a))


### Miscellaneous Chores

* recreate release PR ([c5dfaf3](https://github.com/ai-outfitter/channels/commit/c5dfaf3c01779e5db10b8ca960f310e8b41b9a85))
* release 1.0.0 ([962ed8e](https://github.com/ai-outfitter/channels/commit/962ed8e7122901935603c80afaa4a9c25498b8f7))
