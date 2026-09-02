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
- **GitHub operators:** `GITHUB_NOTIFY_ORGS` is a new optional allowlist of
  repository owners. When it is set, a notification from another owner creates
  no Task, wakes no agent, and is not marked read, so a second deployment of the
  same account still receives it. Unset, nothing is filtered. This lets one
  machine account that belongs to two organizations run one resident agent per
  organization.
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

## [1.10.0](https://github.com/ai-outfitter/channels/compare/v1.9.0...v1.10.0) (2026-09-02)


### Features

* **runtime:** isolate each Task in a Pi session ([3650791](https://github.com/ai-outfitter/channels/commit/3650791862a9f48432de08452bf36f8241c6e496))


### Bug Fixes

* **channels:** forward cached adapters to live task plane ([a628a9b](https://github.com/ai-outfitter/channels/commit/a628a9b5eda32f909f283b43dcf09a25d6f8067e))
* **channels:** join canceled source startup ([2fae05f](https://github.com/ai-outfitter/channels/commit/2fae05fad9593dd3d582954e8b64366918d051e1))
* **channels:** preserve zero-source start idempotence ([7ea70c2](https://github.com/ai-outfitter/channels/commit/7ea70c2d5154d78815f7535814f51f66da96ed4d))
* **channels:** serialize replacement generations ([d123702](https://github.com/ai-outfitter/channels/commit/d1237026dc08cce099b314c296cfb266bc1ae2a0))
* **runtime:** bound delivery admission lifecycle ([ddcd1a7](https://github.com/ai-outfitter/channels/commit/ddcd1a766ef89022c4054e31f461a6d900848e6d))
* **runtime:** cancel channel restart with task plane ([02fd458](https://github.com/ai-outfitter/channels/commit/02fd458dd10bd87f8705a3a14f7cc5b7e92b9b00))
* **runtime:** close outbound delivery admission ([2a0fb7e](https://github.com/ai-outfitter/channels/commit/2a0fb7e6123d7d2517f748a1fb140adae387bcd3))
* **runtime:** drain outbound delivery on close ([ac40979](https://github.com/ai-outfitter/channels/commit/ac40979264d1d41b418fcfb7f0c2cb686aa0a407))
* **runtime:** isolate canceled lifecycle cleanup ([495ed20](https://github.com/ai-outfitter/channels/commit/495ed20f8028ee9a01fe98d92d2e5a04b18b135a))
* **runtime:** isolate each A2A Task in a Pi session ([c2864ee](https://github.com/ai-outfitter/channels/commit/c2864eec360f81d38c90efa379dde8bbd2e53dd7))
* **runtime:** join overlapping task-plane cleanup ([2287834](https://github.com/ai-outfitter/channels/commit/22878346751b4baa6e928a7cf2cfc1e841738211))
* **runtime:** preserve restart during startup ([2db6e8c](https://github.com/ai-outfitter/channels/commit/2db6e8c2a0bd2e0b73e15ac9633c4c7597667a90))
* **runtime:** replace canceled startup generation ([e861fa3](https://github.com/ai-outfitter/channels/commit/e861fa3ff365e656dcd303bcce45301ce5a13fe3))
* **runtime:** serialize replacement generations ([42af439](https://github.com/ai-outfitter/channels/commit/42af4394afeb36343c65171dd8a082398fc50dbb))
* **runtime:** serialize restart with cleanup ([bb95803](https://github.com/ai-outfitter/channels/commit/bb958036a6e8e822527c78ccc58c06c12c51e4be))
* **task-plane:** await wake queue quiescence ([7e96644](https://github.com/ai-outfitter/channels/commit/7e96644e81e4453f91bd4f27b26c9b59877062db))
* **task-plane:** close isolated session lifecycle gaps ([42a7a2a](https://github.com/ai-outfitter/channels/commit/42a7a2ae9dffb05d579bca62403f341fea194b93))
* **task-plane:** close wake stop races ([637f22b](https://github.com/ai-outfitter/channels/commit/637f22bd9d24840f8e2600e602ddeb7e82e37a3a))
* **task-plane:** retry delivery-cap finalization ([b58f50e](https://github.com/ai-outfitter/channels/commit/b58f50efdd6d29e33e0f1573e0da3a9f5626e3a5))
* **task-plane:** stop wake queue on startup rollback ([cebc61e](https://github.com/ai-outfitter/channels/commit/cebc61e4a2edf7b03e430925b02ec178dbf2bfd1))
* **task-sessions:** authorize channel locators ([117bc6c](https://github.com/ai-outfitter/channels/commit/117bc6cc9cb67158334749d86b53a99163938cd3))
* **task-sessions:** close remaining recovery races ([0afab39](https://github.com/ai-outfitter/channels/commit/0afab390da31efe20e0f219e04472bf4965d66dc))
* **task-sessions:** close replay and retry races ([9d6c558](https://github.com/ai-outfitter/channels/commit/9d6c558b3a281028769039715bf008e4754fde07))
* **task-sessions:** dispose every terminal path ([6612b4e](https://github.com/ai-outfitter/channels/commit/6612b4e79212df07de80cb21e02d42d4b3236d65))
* **task-sessions:** harden startup and replay recovery ([bfe8120](https://github.com/ai-outfitter/channels/commit/bfe8120b2a981f352584bde2667f1b5e638f5cfe))
* **task-sessions:** honor cancellation and trust ([952fc0d](https://github.com/ai-outfitter/channels/commit/952fc0d787d4d8cdbebaeb224455322933abe3e2))
* **task-sessions:** index durable sessions once ([531de4e](https://github.com/ai-outfitter/channels/commit/531de4e0cfd68d72e57a67f5e7007a6213d6c151))
* **task-sessions:** preserve derived id before first flush ([fd68c3b](https://github.com/ai-outfitter/channels/commit/fd68c3b4f0d7ba22574204feaff30a9a8e9c1cbb))
* **task-sessions:** preserve recovery and close barriers ([b593706](https://github.com/ai-outfitter/channels/commit/b5937064aa356b940af04817b167f2f4d3b78530))
* **task-sessions:** quiesce cancellation cleanup ([0247657](https://github.com/ai-outfitter/channels/commit/024765791ca5e33f313a9ad5e0fd75ea460a5102))
* **task-sessions:** release every retained session ([33a790a](https://github.com/ai-outfitter/channels/commit/33a790a8bead545af6c8acd65daa18fabf1415d7))
* **task-sessions:** release failure tombstones ([fdf3e9a](https://github.com/ai-outfitter/channels/commit/fdf3e9a79a256a08d96d57537321ac3456089158))
* **task-sessions:** release paused task resources ([b6c44e2](https://github.com/ai-outfitter/channels/commit/b6c44e2d761d7a618a4c8c3f9fa71b8a5c18acce))
* **task-sessions:** replay only newest continuation ([67ca829](https://github.com/ai-outfitter/channels/commit/67ca829fb8bd8e9a6cfe89159b3d593f4fa7982b))
* **task-sessions:** restrict task tool authority ([e5811f9](https://github.com/ai-outfitter/channels/commit/e5811f95edd2c87c5a21f8d0f9c61fc72a9af9ad))

## [1.9.0](https://github.com/ai-outfitter/channels/compare/v1.8.0...v1.9.0) (2026-08-20)


### Features

* **github:** scope notification wakes to an org allowlist ([#62](https://github.com/ai-outfitter/channels/issues/62)) ([e37f11a](https://github.com/ai-outfitter/channels/commit/e37f11aefc58660785c99fbb2db0d7a979bd361d))

## [1.8.0](https://github.com/ai-outfitter/channels/compare/v1.7.0...v1.8.0) (2026-08-16)


### ⚠ BREAKING CHANGES

* **a2a:** every agent wake now flows through the task plane with one active Task authority; the pre-task-plane wake paths are removed.

### Features

* **channels:** add idempotent scheduled publication ([#58](https://github.com/ai-outfitter/channels/issues/58)) ([8e8879a](https://github.com/ai-outfitter/channels/commit/8e8879aa064a9f39370fe08ea8f242fd4c411c17))
* **jmap:** task-bound exact-item read and reply ([856f1d4](https://github.com/ai-outfitter/channels/commit/856f1d4dee72ab5de9754d4417b1993df2215ecb))
* **sources:** route remaining work sources through the task plane ([aebfa4c](https://github.com/ai-outfitter/channels/commit/aebfa4c1d6aca2b01faf23f33ef58191aaa2b7c9))
* **sources:** route Slack, Chatto, GitHub, and JMAP through the task plane ([9eada94](https://github.com/ai-outfitter/channels/commit/9eada946595b3ca15cb167f6ed54c1eb89d896a6))


### Bug Fixes

* **a2a:** grant wake authority at delivery and cap re-offers ([7bd019e](https://github.com/ai-outfitter/channels/commit/7bd019eeb928a09f062de090d2d8e35bb30a7d77))
* **a2a:** harden the task plane per adversarial review ([2c83115](https://github.com/ai-outfitter/channels/commit/2c831159380773dbba4f691025b8e98f5de70cdf))
* **sources:** evaluate each source module once under concurrent import ([5c2e305](https://github.com/ai-outfitter/channels/commit/5c2e3056db815a7d3664347a7f6bb64f78eae515))


### Code Refactoring

* **a2a:** remove the legacy wake paths ([2dadd05](https://github.com/ai-outfitter/channels/commit/2dadd051db3892e3a91b3e1527f32acab1a0353d))

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
