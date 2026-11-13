# Testing Lighthouse

Run `bash lighthouse/test-all.sh` from the repository root in Git Bash and WSL, serialized.
It unsets `TYPESAFE_API_KEY` before spawning a test server. Never start a scratch server with a real key
inherited. The sandbox preload rejects production ports and redirects judgment tests to stand-ins.
No fixture should update an installed home, deliver a real message, use a real account or touch port 7700.

The runner executes source-size/privacy inventory checks, every server and page suite, then each kit suite.
Server files run serially so independent fixtures cannot race for a released ephemeral port.
The four full clean-room workflows run separately with `node scripts/release-check.cjs` before release.
CI uses `node scripts/ci-check.cjs` for each push to `main` and pull request; no private secret is required.
Code stays under 1,000 lines per file and 120 characters per line; generated public assets are exempt.
Use Python 3.10+, Node 24.16.0+ on Windows and Node 22+ on Linux/WSL. Shell scripts remain LF.
On Windows use Git Bash explicitly, not the `bash` WSL launcher in PowerShell.
Windows Node 24.15.0 can crash children even in serialized runs (exit 3221226505).
[Node 24.16.0](https://nodejs.org/en/blog/release/v24.16.0) includes
[nodejs/node#62561](https://github.com/nodejs/node/pull/62561); see also
[the upstream report](https://github.com/nodejs/node/issues/63620). Check the actual executable version,
including children, rather than retrying failures into a green result. Tests and their exit checks are unchanged.

Focused commands, from the root:

```text
node --require ./lighthouse/tests/sandbox.cjs --test lighthouse/server/tests/generic-config.test.js
node --require ./lighthouse/tests/sandbox.cjs --test lighthouse/server/tests/profile-runtime.test.js
node --require ./lighthouse/tests/sandbox.cjs --test lighthouse/operator-kit/tests/profile_test.cjs
node --require ./lighthouse/tests/sandbox.cjs --test lighthouse/tests/private-tree.test.cjs
```

The profile suites use optional local expectations only when the excluded overlay exists; exported
shared trees skip those cases. Neutral defaults, explicit roles, polling opt-out, installed-value preservation,
clock/collector rendering and export boundaries remain public regressions. Run the privacy suite with a local
`PRIVATE_TERMS_PATH` or `PRIVATE_TERMS`; diagnostics show file/line and never print the dictionary or matched passage.
Without a dictionary, generic checks still run. A configured unreadable or inactive dictionary fails.

Build the page with `python lighthouse/server/make-page.py` after editing its sources; never edit the output.
Generate example policies with `python lighthouse/server/make-rulings.py`. The historical policy profile is
opt-in data in the overlay, not a default generator input. Keep both generated outputs in the same change.

Developer verification lives under `lighthouse/verification/` with local skills in `.claude/skills/`.
Follow the corresponding skill for bounded TLC models and real-code fault/mutation replays. TLC runs through
`statechart` with new scratch output directories. Deployment process tests require Linux/WSL, not a skip
on Windows. Neutral legacy kit fixtures make bootstrap tests independent of private history. Historical
replays additionally run when their source commits are available; they do not claim recognition of arbitrary
old private installations from a fresh public clone. Verification run ledgers are excluded from exports;
models, public mappings, fault fixtures and executable replays remain available.
The activation rehearsal always exercises real installed MCP processes through deploy, activation, handoff,
recovery and deactivation. With historical ancestry it first installs the pre-activation binary; without it,
the baseline is the current release with activation disabled. The result identifies which baseline was used.
