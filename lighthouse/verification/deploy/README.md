# Deployment verification evidence

Implementation source-sync: `cc18deec1d19360260d4970ef783122ea369496a`.
Date: November 9, 2026. Runtime: Linux/WSL, Node 24.20.0; formatter: Prettier 3.3.3 with the repository config.
All homes were temporary copies with ephemeral loopback ports. No live board, live store, operator home,
operator connection or port 7700 was used. Test child environments removed `TYPESAFE_API_KEY`.

## Reproduced before fixing

On master `5cd7cf3`, before changing the actual deploy script, the two newly written replay regressions
failed exactly as the scout predicted:

- `RunningVersionMatchesDisk: rejected syntax never overwrites the serving release`: old process answered
  `old`, while active `server.js` contained `const broken = ;`.
- `FailedDeployPreservesRunnableRelease: rejected candidate leaves a safe manual restart`: after validation
  failed, the manual start failed on the overwritten invalid JavaScript.

Command: `node --test lighthouse/server/tests/deployment.test.js` in Linux/WSL. Result at that point:
0 passed, 2 failed. The tests use the actual shell deployment entry point, scratch candidate/home copies and
a real synthetic loopback Node process, following the scout's replay rather than merely asserting a model.
Those are the historical replay definitions; the current canonical normal tests are in
`server/tests/known-deploy.test.js`, after integrating the scout baseline below.

## Real implementation proof

`node lighthouse/verification/deploy/verify.cjs --mutate` passed the three invariant tests, caught both
active-overwrite regressions in a scratch-mutated copy, caught the missing-store-snapshot regression, then
passed the original three again. The mutation runner checks expected failure evidence, not just a nonzero
exit code, and removes the broken copies. This exercise never changes tracked product files.

The full deployment suite also covers faults before and after all eleven stages, failed runtime start,
non-200 HTTP, dropped saved cards, real startup/probe errors, harmless DEP0169 and its companion, CRLF manager
input, incompatible rollback, a schema change that must block automatic rollback, interrupted deploy
recovery, busy-store refusal, old/candidate stop timeouts, manual control locking and final-save backup order.
It includes an activation and manual restart of the real dependency-free server with real public assets.
Before the legacy-recovery review fix, the complete focused run passed 53 tests in 237 seconds with
`node lighthouse/verification/deploy/verify.cjs`.

Review found that an interrupted first deploy could restart a flat home but wrongly look for its missing
release manifest during recovery health. The historical manager fixture retains the actual `5cd7cf3`
start/stop/status/restart paths, without its unrelated claim/archive commands. Tests remove the flat home's
manifest and inject failures and crashes after stop, around snapshot, before migration, and between the
manager/pointer writes. Before the fix, eight scenarios failed with a retained journal or missing manifest.
After checking the retained release's contract and installing the manager before the pointer, all eleven
selected test assertions/subtests passed. The reviewer also ran the final test against the pre-fix code:
the pointer-write interruption failed on a running-path mismatch, giving nine failing subtests out of ten.
That recovery-fix deployment matrix passed 64 tests, none failed or skipped, in the reviewer's replay.
The phase model is unchanged: it abstracts restoration and does
not model either manager-file write as an indivisible operation; these real-code replays cover that gap.

A separate scratch replay exported the actual `5cd7cf3` manager, removed the release manifest, and exercised
first migration followed by the actual `rollback-board.sh` entry point. Both succeeded and the retained old
code served again. The original manager was retained alongside its release-aware rollback adapter.

The GitHub bot found that health checks discarded the configured bind address. A real-server regression
first failed on `127.0.0.2` and `::1`: activation and restoration both timed out, retaining the journal,
although the configured endpoint answered HTTP 200. After retaining the bind and mapping wildcard addresses
to their matching loopback family, all five assertions/subtests passed for `127.0.0.2`, `0.0.0.0`, `::`
and `::1`. The specific-address cases activate the real server and prove failed activation restores it
and clears the journal. Wildcard settings are probed against servers listening only on the matching
loopback address; no wildcard listener is opened. Command: `node --test --test-name-pattern='configured bind health probes'
lighthouse/server/tests/deployment.test.js`. HTTP address selection remains a real-code check, not a new
phase in the model.

## Formal evidence

Read these results with `/statechart`; the repository-local verification skill describes rerunning them.
No machine-specific launcher path is embedded in the skill or assets.

- `BoardDeploy.cfg`: 29 states, 37 steps; all four configured invariants and NoDeadlock hold.
- `BrokenDeploy.cfg`: 28 states, 36 steps; running/disk agreement, backup and schema safety break in one
  step; failed-deploy preservation in two.
- `BrokenBackup.cfg`: 28 states, 36 steps; only ReplacementHasBackup breaks, at the seventh step (switch).

TLC: 2.19, 2024-08-08, revision 5a47802, one worker. Every configured invariant was checked; no exploration
bound was reached. `chart.mmd` and the three `*-report.md` files are generated checker results. A model pass
is an ordering claim under its stated bounds, not a proof of the whole server, power-loss durability, a
schema migration, or arbitrary candidate behavior. Real-code replays cover HTTP/log/card checks separately.

## Full repository check

Command: `bash lighthouse/test-all.sh` in Linux/WSL (with CRLF removed from the shell entry file).
The first full run passed file limits, 134 server tests, all board-scene tests, attachments, fmwatch, gate,
update, pending and record-check suites. It reproduced the same three unrelated failures recorded by the
scout on master:

- MCP: ambiguous Claude session-folder matching in its fixture.
- Steward waker: changed files missing from the review prompt assertion.
- Collector: unsendable-file reason assertion.

Those failures are not deployment defects and are not fixed or counted as passing here. Subsequent focused
deployment runs cover additions after that first full run; final PR proof records the latest counts.
An intermediate full run after the recovery fix and upstream updater/doorbell merges passed 158 server
tests, 14 board-scene tests and 42 update-failure tests, with only those same three failures. An independent
scratch export of master `5cd7cf3` reproduced all three exact assertions and passed every other suite.
A later full run on `e300f07`, including master `f0312bf`, passed 168 server tests and every other suite
except those same three assertions. The configured-bind fix is checked separately above until the next
complete wrapper result is recorded. That bind-fix wrapper passed 173 server tests and every other suite
except the same three baseline assertions.

Master `22dee3b` then repaired those three fixtures and added the scout rule replays. Its two deployment
TODOs are promoted to normal tests in `server/tests/known-deploy.test.js`, using complete candidates and
the real release engine's validation boundary on both Windows and Linux. The duplicate Linux-only rule
definitions are removed; shell/manual-manager behavior remains covered by the Linux fault matrix.
The two canonical tests pass on Git Bash and WSL, with zero failures, skips or TODOs. The mutation runner
still catches both active-overwrite failures and the missing final store snapshot, then passes the original
invariants again. The remaining two scout TODOs belong to cards and the historical updater, not deployment.

After the baseline merge, the full WSL wrapper passed with exit 0: 176 server passes, no server skips or
failures, 14 board passes, and every kit suite passing. The two unrelated scout TODOs remain visible.
An overlapping Git Bash run stalled in the unchanged gate registry fixture; only that run's five owned
Node processes were stopped. The chief of staff identified the pre-existing registry race and required
serialized platform reruns, without a gate-fixture change. Final exact-head platform results are also
recorded in the PR; no overlapping or interrupted run counts as the final Git Bash pass.

Master `9977035` then made explicit card completion a normal regression as well. The merged candidate
retains all nine fixed scout rules as normal tests; only the unrelated historical updater rule remains TODO.
Its fresh serialized Git Bash and WSL wrapper results are recorded on the PR before the merge gate is used.
Master `89411d1` subsequently fixed that updater rule. After integrating it, all ten scout rules are normal
regressions with no TODOs. The deployment implementation is unchanged; final integrated platform proof is on the PR.

The second bot review found a separate first-migration failure: a candidate manager with valid shell syntax
but `exit 42` in its start branch was reused for restoration. Both automatic restoration and explicit
recovery failed before `cc18dee` (zero passed, two failing subtests plus their failing parent). Restore now
reinstalls the saved flat manager and removes the migration pointer after confirming shutdown, so neither
restart depends on the failed candidate manager. Both scenarios pass, including a manual restart and the
old HTTP response; the full focused legacy/interruption/runtime set passes all 15 tests without skips.
The three real-code invariant mutations were rerun successfully, catching both broken variants before
passing the original invariants again. The unchanged model was checked through `/statechart` again:
normal 29 states/37 steps with all four invariants and NoDeadlock holding; both broken configurations
retain their documented counterexamples. Manager execution remains a real-code replay, not a model claim.

## Manual maintenance refresh (November 10, 2026)

Implementation source-sync: `186482cd7f2cb15b8e1bea541560b130c3091b11`. The staged deployment interface,
release manifest, schema and DEP0169 rollback-log tolerance are unchanged.

Five targeted real-manager regressions all failed on unchanged origin/master `cb0c5b7`:

- `clear-cards backs up the configured non-default store before removing cards`
- `a failed safety copy refuses clear-cards and preserves its failure through restart`
- `archive reports an invalid target even when the stopped board restarts`
- `archive preserves invalid-board refusal instead of reporting restart success`
- `claim uses the manager configuration and its adjacent claims directory`

They pass with the fix in Linux/WSL. A failed copy injects exit 37; cards and archives remain untouched,
the board restarts and exit 37 survives. Invalid-board refusal retains exit 2. A non-default config and
store prove that the backup belongs beside the configured store and claims beside the selected config.
Existing real stop-timeout tests retain the original process and prevent all three maintenance commands.

The companion BoardMaintenance model has 68 states/68 steps and a seven-state/nine-arrow projection.
ClearRequiresSafetyCopy, CopyFailureKeepsCards, MaintenanceFailureIsReported, SuccessfulRestartIsRetained
and NoDeadlock all hold. maintenance-report.md and maintenance-chart.mmd are generated checker outputs.
BrokenMaintenanceCopy.cfg breaks both copy rules after stop, failed copy, archive; BrokenMaintenanceStatus.cfg
breaks the exact-exit-status rule after stop, failed archive, restart. Both shortest counterexamples have
three steps. The original configuration passes again. No arrows are manually hidden; sixteen same-label
steps collapse automatically. The model bounds one command, a successful stop, independent copy/archive/
restart outcomes and terminal stuttering. Paths, claims, filesystem effects and failed stop are real-code
checks, not abstract-model claims; power-loss durability and eventual recovery remain excluded.

The existing BoardDeploy model was rerun unchanged: 29 states/37 steps, all four invariants and NoDeadlock
hold. BrokenDeploy retains its one/two-step failures; BrokenBackup still fails ReplacementHasBackup at
step seven. The real-code --mutate runner again catches overwrite and omitted snapshot, then passes
the three untouched invariant regressions. TLC runs use the installed /statechart launcher in external
scratch, fresh output folders, Node 24.20.0 and TLC 2.19. All services use ephemeral loopback fixtures;
the real TYPESAFE_API_KEY is removed before every test.
The complete `node lighthouse/verification/deploy/verify.cjs` matrix passes 72 tests with no skips.

## Going live

Only a captain-approved board deploy performs the one-time migration and activates these scripts. Manual
start/stop/status stays the interface. No kit update or operator `/mcp` reconnect is required. Follow
`lighthouse/server/DEPLOYMENT.md`. Schema/data migration and backup retention policy remain separate work;
no data is automatically restored from a safety copy. The historical kit fixture failures are repaired by
the merged test baseline, not accepted as failures in the final wrapper gate.
