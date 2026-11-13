# Contributing

Keep changes focused and explain the user-visible problem. Shared code must work independently of any
captain's fleet. Use invented examples; never add filled settings, work records, contact addresses, private
hostnames or credentials. Local profile/history data belongs in the excluded `private/` overlay.
Do not deploy, restart an installation, update an operator home or send a real message as part of a code change.

## Before a commit

Run `bash lighthouse/test-all.sh`. It includes the 1,000-line / 120-character source-size rule and removes
`TYPESAFE_API_KEY` so stand-in tests cannot call a paid service. Run Git Bash and WSL suites serialized.
See `lighthouse/TESTING.md` and the repository's developer verification skills for flow-specific proof.
Shell scripts and files bash reads must remain LF.

The page is built, not edited: change `lighthouse/board/` sources, then run
`python lighthouse/server/make-page.py` and include its output. Generate neutral policy examples with
`python lighthouse/server/make-rulings.py`. Keep the server dependency-free.
Use Prettier 3.3.3 with `lighthouse/.prettierrc.json`, installed outside this repository.
Preserve bundled diagram-design and morphdom notices.

## Privacy and export

`scripts/check-private.cjs` scans the explicit shared inventory using newline-separated literal terms from
`PRIVATE_TERMS_PATH` or `PRIVATE_TERMS`. Keep that dictionary outside Git; diagnostics report file and line
while withholding matched terms and passages. Without a list, generic checks run and newcomers can pass.
A configured unreadable or inactive list is an error. Maintainers also run a private-dictionary scan before release.
The allowlist contains only generic language; do not broaden it to conceal a real match.

The shared inventory is `scripts/export-inventory.json`. New shared roots must be listed explicitly.
`node scripts/export-public.cjs --ref COMMIT --out EMPTY_SCRATCH_DIRECTORY` writes a plain shared tree,
reports excluded paths and refuses to complete if privacy fails. Exporting and publishing are separate operations.
CI checks pushes to `main` and pull requests with `node scripts/ci-check.cjs`. Before a release, run
`node scripts/release-check.cjs` in Git Bash and WSL. Its four clean-room scenarios each run the full suite
from fresh Git history, including the first push and a fork without secrets; they stay out of per-commit tests.

Keep protocol and stored author/history compatibility intact. Changes to a modeled flow also update its
verification skill, mapping, bounded model and executable regressions; never weaken a rule just to get green.
See [shared-core configuration](docs/generic-core.md) and [deployment](lighthouse/server/DEPLOYMENT.md) for the
separate, authorized compatibility-profile → board → kit → MCP rollout.
