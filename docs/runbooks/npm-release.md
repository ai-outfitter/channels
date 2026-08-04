# npm release runbook

This runbook tells you how `@ai-outfitter/channels` goes to npm, and what a
person must do one time before the automatic path can work.

## How a release runs

1. A conventional commit lands on `main`.
2. `release-please.yml` opens or updates the release pull request.
3. The merge of that pull request creates a tag and a published GitHub release.
4. `release.yml` starts on `release: published`. It runs `npm run check` and
   then `npm publish --access public --provenance`.

`release.yml` sends no npm token. It authenticates with **trusted publishing**:
GitHub Actions gives the job an OIDC token, and npm accepts that token in place
of a credential. The `id-token: write` permission and the `npm-publish`
environment are part of that contract.

## Requirements

- The workflow must run npm **11.5.1 or later**. Older npm does not send the
  OIDC token. The registry then sees an anonymous request and answers
  `404 Not Found` on the scoped `PUT`, which reads like a missing package but
  is an authentication failure. `.node-version` pins Node 24.18.0 for this
  reason; do not lower it below Node 22.14.0 / npm 11.5.1.
- npm must hold a trusted publisher for this package. Configure it from the
  CLI with npm 11.5.1 or later:

  ```sh
  npm trust github @ai-outfitter/channels \
    --repository ai-outfitter/channels \
    --file release.yml \
    --environment npm-publish \
    --allow-publish
  ```

  Use `--dry-run` first. `npm trust list @ai-outfitter/channels` shows the
  current configuration. The web form at
  <https://www.npmjs.com/package/@ai-outfitter/channels/access> writes the same
  record:

  | Field | Value |
  | --- | --- |
  | Publisher | GitHub Actions |
  | Organization or user | `ai-outfitter` |
  | Repository | `channels` |
  | Workflow filename | `release.yml` |
  | Environment | `npm-publish` |

  The values must match the workflow exactly. A rename of the workflow file or
  the environment breaks publishing.

## One-time bootstrap

npm cannot configure a trusted publisher for a package that does not exist, and
it does not let OIDC publish the first version. A person must publish the first
version with an npm account.

1. Get a clean checkout of the release tag.

   ```sh
   git clone git@github.com:ai-outfitter/channels.git /tmp/channels-release
   cd /tmp/channels-release && git checkout v1.5.0
   npm ci && npm run check
   ```

2. Sign in as a user with publish rights on the `@ai-outfitter` scope.

   ```sh
   npm login
   npm whoami   # must print your username
   ```

3. Publish the first version. This publish has no provenance statement,
   because provenance needs a CI OIDC token. Later releases get provenance.

   ```sh
   npm publish --access public
   ```

4. Add the trusted publisher with the command or the table above.
5. Confirm the automatic path on the next release. Do not re-run the failed
   release job for a version that is already on the registry — npm refuses to
   publish over a published version.

After step 4, no person publishes again, and no npm token is stored in this
repository.

## Diagnosis

| Symptom | Cause |
| --- | --- |
| `404 Not Found - PUT .../@ai-outfitter%2fchannels` | The request carried no credential. Check the npm version in the job log, and check that the trusted publisher exists. |
| `provenance statement published` and then a 404 | Same cause. Provenance uses the OIDC token from npm 9.5, but registry authentication needs npm 11.5.1. |
| `403 Forbidden` | The trusted publisher exists but one field does not match — usually the environment or the workflow filename. |
| `cannot publish over previously published version` | The version is already on npm. Release a new version. |
