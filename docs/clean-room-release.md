# Release checks and public exports

Run `bash lighthouse/test-all.sh` for each change. CI runs `node scripts/ci-check.cjs` on pushes to `main`
and pull requests: privacy, the per-commit tests, page/policy generation and a generated-file diff.
It checks the entire current tree, so an initial push needs no previous revision. No private secret is
required: forks run the same generic privacy rules.

Before a release, run `node scripts/release-check.cjs` in Git Bash and WSL, serialized. It exports committed
source into a temporary directory, initializes new Git history, then runs the complete CI command for four
scenarios: initial push with an all-zero previous revision, later push, deletion and rename, and a fork pull
request without a private dictionary. Each scenario runs the full per-commit suite. Successful temporary
trees are removed; failed trees and logs remain for diagnosis. These scenarios are release-only.

To build a public tree from a chosen commit:

```text
node scripts/export-public.cjs --ref COMMIT --out EMPTY_SCRATCH_DIRECTORY
```

The destination must be empty and outside every Git repository. The command reads committed blobs, ignores
working-copy changes, rejects unlisted roots, symlinks and submodules, and reports the commit and excluded
paths with reasons. Local configuration, working notes and verification records
are excluded by `scripts/export-inventory.json`. Models, executable verification and public mappings remain.
The tree appears at the destination only after privacy passes; an unsuccessful check leaves no completed export.

`node scripts/check-private.cjs --root DIRECTORY` checks shared file paths and content. Set
`PRIVATE_TERMS_PATH` to a dictionary outside Git, or supply newline-separated terms in `PRIVATE_TERMS`.
The exporter uses those same variables. A configured unreadable or inactive dictionary fails closed;
without one, generic credential, contact and private-address checks still run. Diagnostics show `file:line`,
never the matched term or passage. A filename containing private content is replaced by an opaque path ID.
Never print, copy or commit a private dictionary or waive unexpected matches.

Initialize an exported tree as a fresh repository and repeat the per-commit and release commands there.
Historical private ancestry is not needed: neutral legacy kit fixtures exercise supported bootstrap behavior.
Optional historical/profile-only cases skip when their source evidence is absent. This does not claim that
a public clone can recognize arbitrary old private installations.

See [configuration](generic-core.md), [testing](../lighthouse/TESTING.md) and [host maintenance](host-runbook.md).
Exporting does not publish a repository or deploy a running installation.
