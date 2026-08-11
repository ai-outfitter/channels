# Vendored A2A protocol data model

`a2a.proto` is the unmodified authoritative Protocol Buffer data model from
the A2A protocol, pinned at:

- Release: <https://github.com/a2aproject/A2A/releases/tag/v1.0.1>
- Commit: `3303592588e388e62e0f69f701af531d2f4e3991`
- Path in upstream: `specification/a2a.proto`
- SHA-256: `e195bf96ab630c69797851970203e1b2b6b19528f2e9803b7d904b91a5104016`

The license is the Apache License 2.0. Its text is vendored beside the proto
as `LICENSE`, copied from the repository root of the same pinned commit
(<https://raw.githubusercontent.com/a2aproject/A2A/3303592588e388e62e0f69f701af531d2f4e3991/LICENSE>,
SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`).
Re-copy it whenever the pinned commit changes.

The TypeScript data model in `extensions/a2a/types.ts` derives from this
file. An upgrade past v1.0.1 is an explicit compatibility change: replace
this file from the new tag, record the new commit and hash here, and revisit
every type in `types.ts` against the diff.
