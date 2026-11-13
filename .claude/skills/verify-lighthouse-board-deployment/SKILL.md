---
name: verify-lighthouse-board-deployment
description: >-
  Verify staged board releases when changing deploy, rollback, the manual manager, health checks or store-schema
  contracts. Check ordering with the deployment model and replay faults against real scripts in scratch homes.
---

# Verify Lighthouse board deployment

## Setup screens and three-board rehearsal (A5)

Reviewed base 743a5ba86eb748bf390a7ccce28d598d111d595b plus A5. The new management page is inert with
enrollment off; it does not change deployment, policy-selection, maintenance or migration transitions.
node lighthouse/verification/upgrade-rehearsal.cjs passed on fictional three-board copies: safety backup,
profile apply, schema-2 migration, retained compatible baseline, actual staged deployment and legacy kit
update for three homes. Exact parity checks retain board labels/order, roles, policy bytes, clocks, lanes,
every card/comment and configuration/credential bytes. Enrollment remains off throughout.

This is a regression using current source on both sides with synthetic release IDs and simulated Windows/WSL
helpers, not historical-binary or live-adapter proof. Real provenance, ACLs, adapters and controlled reconnects
remain rollout requirements. Never redirect the rehearsal at a live home. All normal, broken and restored
BoardDeploy, PolicyRelease, PolicyApply, RegistryMigration and BoardMaintenance configurations were rerun
through statechart without changing bounds. deploy/verify.cjs --mutate caught active-code overwrite and
missing snapshot and restored its three invariant regressions. Use the checks below
for the observed matrix and non-disruption scope; the full suite remains required for a release.

## Fresh host and policy-byte synchronization

A4 source-sync: 3d00ec0256ae20980c7d3be0790ab4bfc7f46f07. The fresh initializer in setup/host.cjs is a separate
empty-home path: it reads pinned Git bytes, creates the registry before the schema-2 marker, retains that first
release and bootstraps local administration. It never invokes the legacy migration/deployment steps and refuses
every populated home before writes. FreshHostCreateGrantDoctorAndShift exercises the real release on a scratch
loopback port through the documented board.sh start and stop commands. The board-manager scratch fixture
also includes release.json, as required by the baseline release guard. This repairs thirteen baseline fixture
failures and changes no server behavior. Existing host migration, deploy, rollback and policy-selection transitions are unchanged.

scripts/apply-profile.cjs now chooses the running current/rulings.json bytes (or flat rulings.json when no managed
release exists) when parsed JSON equals the digest-verified profile. Different content still selects the verified
profile bytes; explicit host policy selections retain their existing rule. PolicyApplyPreservesRunningBytesForEqualContent
checks CRLF/LF citation identity, rollback of the config followed by reapplication with the policy retained,
and different content. Reapplication verifies the profile source digest and compares existing parsed content,
so preserved CRLF bytes are not incorrectly compared against an LF digest. The setup mutation runner reinstates the byte rewrite,
requires that regression to fail and then passes the restored implementation.

Use /statechart with PolicyApply.tla, PolicyApply.cfg and policy-apply-view.mjs, then PolicyApplyBroken.cfg and
normal again, each in a new external output folder. The graph has 4 states/4 steps; EqualContentKeepsCitations,
ChangedContentUsesProfile and NoDeadlock hold. The broken variant changes equal policy bytes after one apply
step and breaks citation identity only. It abstracts parsed equality and verified source data, not reapplication/integrity decisions or arbitrary
JSON canonicalization, corruption, filesystem atomicity or hash collisions. No bounds were reduced.
All existing deploy, maintenance, policy release and registry-migration configurations were rerun unchanged.
Record evidence and retained exclusions in an external run ledger.

Promise: a deploy never overwrites the code being served; rejected candidates leave a runnable previous
release; replacement retains old code and a final store safety copy. Manual clearing requires its configured
store's safety copy, and restarting never hides a maintenance failure. Harm: a later manual restart could
otherwise run invalid or mixed code, and an unsafe rollback could misread newer data.

Never run this workflow against the live board home, real operator homes or port 7700. Do not deploy or
restart anything outside the scratch fixtures. Do not inherit a real `TYPESAFE_API_KEY` into a test server.
The replay runner removes it itself and refuses platforms where the Linux process tests would be skipped.

## Source sync and coverage

Last confirmed source-sync commit: `3a98465b64feb32c690a7cd0634c89d451876f61`.
Configuration/policy source-sync: `dbe2a4cf9a4d6f3cadbd50da32cdf3630cfb7872`.
Registry migration and compatible fallback source-sync: `01a9e081a478fa505f190363d19fc6afd462c016`.
Seed: the BoardDeploy scout model at `5cd7cf3`, refined to the staged implementation rather than the unsafe
copy-before-validation design. The implementation anchor is deliberately a commit, not a moving branch.

- `board-release.js`, `run`/`copyRelease`: Stage, Validate, Backup; rejected syntax leaves active code untouched.
  A private-checkout compatibility/contact preflight may refuse before Stage, with no live or staged mutation.
  `profile-review.test.js` covers that earlier rejection. It adds no model phase or write: the existing initial
  rejection boundary still precedes every Stop and activation transition.
- `release-check.js`, `validate`/`compatible`/`quiet`: Reject, Quiet, FailBeforeStop; asset/config/schema checks.
- `board-release.js`, stop/snapshot/migrate stages: Stop, Snapshot; confirmed exit and final shutdown write.
- `board-release.js`, `switchRelease`/`atomic`: Switch; one same-filesystem symlink rename and retained code.
- `board.sh`, start/stop/lock/release: Start, StopCandidate, RecoveryStopTimeout; pinned code, no auto lifecycle.
- `release-check.js`, `healthy`/`realLogError`: HealthPass/HealthFail; bound HTTP, process, saved cards and errors.
- `board-release.js`, `restore`/recover: Restore, RestartOld; schema refusal and interrupted-deploy journal.
- `deploy-board.sh`, `rollback-board.sh`, `release.json`: shared lock and explicit schema; shell smoke tests.
- `server.js` policy selection and `steward.js` citations: PolicyRelease StageRelease,
  StartRelease and ManualRestart keep explicitly configured records independent of the selected release;
  an absent setting or missing host file selects that executable's unchanged bundled bytes, not a stale
  flat-home copy retained during migration.
- `board.sh`, claim/archive/clear-cards/restart_after: configured paths, mandatory copy and preserved exit status.
  `config-target.js` validates the explicit/default archive destination before Stop.
  These manual operations use the companion BoardMaintenance model, not an extra deployment phase.

All paths abbreviated in this table are in `lighthouse/server/`. Tests are
`lighthouse/server/tests/deployment.test.js`, `known-deploy.test.js` and `deploy-fixture.cjs` in that directory.

## Real-code checks

From the repository root in Linux/WSL, run:

```bash
node lighthouse/verification/deploy/verify.cjs --mutate
```

This first passes the three named invariant regressions, copies the server into temporary homes outside
the repository, reintroduces active-file overwrite before validation, and then omits the store snapshot.
It requires the corresponding tests to fail for the expected reason, removes the scratch mutations and
passes the original checks again. A mutation that unexpectedly passes is a verification failure, not proof.

Run the full fault matrix for implementation changes:

```bash
node lighthouse/verification/deploy/verify.cjs
node lighthouse/verification/deploy/maintenance-mutations.cjs
node --test lighthouse/server/tests/policy-config.test.js lighthouse/server/tests/policy-profile.test.js
bash lighthouse/test-all.sh
```

The matrix includes the historical flat manager with no release manifest and interruptions between the
migration's separate manager/pointer writes. Recovery checks the retained release's schema contract even
when it restarts the untouched flat server. A runtime-broken first candidate manager is tested through both
automatic restore and explicit recovery: restore reinstalls the saved flat manager and removes the migration
pointer only after confirmed shutdown. Those cases are real-code checks, not extra atomic model steps.
The matrix injects failure before and after every stage, runtime startup failure, HTTP/log/card health
failures, stop and quiet timeouts, process interruption, CRLF input, safe rollback and incompatible schema
refusal. It includes the real dependency-free server and tests manual control locking. The three invariant
tests are named `RunningVersionMatchesDisk`, `FailedDeployPreservesRunnableRelease` and `ReplacementHasBackup`.
The two scout deployment TODOs are now normal cross-platform tests in `known-deploy.test.js`; do not duplicate
them or restore TODO suppression. The full wrapper must pass after the test-baseline merge. Historical kit
failures are recorded in `lighthouse/verification/deploy/README.md`, not accepted as the final gate.

## Formal check and readable results

Read and use the installed `/statechart` skill by name. Copy the model assets into a fresh scratch folder
outside every repository. Ask `/statechart` to check `BoardDeploy.tla` with `BoardDeploy.cfg` and `view.mjs`,
using a new output directory. Do not copy a machine-specific launcher path or its evolving CLI into this
skill. Inspect every invariant result and the generated chart/report, not just the command's exit status.

Then repeat with `BrokenDeploy.cfg` and `BrokenBackup.cfg`, each with a new output directory. The first must
break running/disk agreement, failed-deploy preservation and replacement backup (also schema safety). The
second isolates omitted old-code retention and must break `ReplacementHasBackup` at the switch. Repeat the
normal config after any model edit. Checked with Node 24.20.0 and TLC 2.19 (2024-08-08, rev 5a47802); model
results and replay evidence are recorded next to the assets.

Also check `PolicyRelease.tla` with `PolicyRelease.cfg` and `policy-view.mjs`, then with
`PolicyReleaseBroken.cfg` and `PolicyLegacyBroken.cfg`, each in a new output directory. The normal model checks
12 states and 12 steps: HostPoliciesSurviveReleaseSwitch, FallbackCitationsUnchanged and NoDeadlock hold.
Executable-relative selection in the broken variant loses host policies after two steps;
fallback identity and NoDeadlock still hold. The legacy-broken variant instead selects a stale flat
copy when the setting is absent, breaking FallbackCitationsUnchanged after two steps; host selection
and NoDeadlock still hold. The policy record is opaque: it represents exact ids,
text, metadata and file hash, not a parser proof. The real staged-release regression deploys, restarts
and deploys again with a custom file beside configuration, checks exact policy citations/job hashes,
and proves the host file unchanged. A flat-manager migration test leaves the flat policy file in place,
then deploys two different bundled policy sets, manually restarts each and checks their exact hashes.
Separate fallback and generator-profile tests check bundled identity and historical metadata.
Run the checks below and record observed evidence externally.

Bounds: one serialized deployment; previous/new/invalid code; two candidate-validity outcomes; two schema
compatibility outcomes; code/store backup bits; successful or failed quiet, stop, start and health phases.
The initial model state is a serving previous release; real tests additionally cover a previously stopped
home. File preparation may fail but cannot touch active files. Only the symlink rename is treated as the
indivisible active-release switch. Failed candidate stops retain the selected candidate and journal rather
than switching under a running process. Terminal self-steps prevent artificial deadlocks; no eventual
recovery or distributed liveness is claimed.

Excluded from the proof: arbitrary code lying about its schema contract, external edits to releases/data,
power-loss/fsync guarantees, host reboot/VM shutdown, request semantics beyond the existing stop/drain
contract, schema/data migration and automatic data restoration. The model abstracts card/log/HTTP behavior
into a health outcome; the real-code tests, not that abstraction, cover those checks.

## Offline registry migration companion

RegistryMigration.tla models the explicit schema-1 to schema-2 window separately from ordinary deployment.
registry-migrate.js, migrate/backup, maps Backup, PrepareRollback, ImportRegistry and MarkSchema: a complete
private backup and a flushed runnable schema-2 baseline precede registry import and the additive store marker.
board-release.js, previous selection/restore, and release-check.js, compatible, map Deploy/Rollback: only code
declaring the current schema may run, and rollback never restores older data over newer work.

Run the registry migration acceptance tests with TYPESAFE_API_KEY removed; on Linux also run the deployment
regression named migration then deployment retains a schema-2 fallback. It exercises failed deployment,
successful activation, newer saved work, compatible rollback and rejection of an old schema-1 release.
The native migration matrix terminates a child at nine preparation/commit boundaries, then retries with a fresh
backup and verifies a complete registry/fallback. It checks old and migrated stores, full external/home backups,
redacted summaries and idempotence. The actual historical checker at 1414bf6 rejects schema 2 in scratch;
old direct server binaries without a startup schema gate must never be run outside their release manager.
Run registry-lease.test.js natively and in Linux: active owners refuse a competing writer, recovery fences fail
closed and a reused live PID with a different boot/start identity is reclaimed on Linux. Windows and old
PID-only locks remain conservative and require verified manual recovery, as REGISTRY.md describes. Lease
liveness and arbitrary service managers remain outside this ordering model.

Copy RegistryMigration.tla, RegistryMigration.cfg, the three BrokenRegistry*.cfg files and registry-view.mjs
into external scratch. Use /statechart for normal, Marker, Rollback and Restore variants, each in a new folder,
then repeat normal. The normal graph has nine states and seventeen steps; all five invariants and NoDeadlock
hold. Its chart has seven states and six arrows, collapsing ten same-label steps without hidden arrows.
An early marker breaks backup, registry and fallback requirements in one step; selecting old code breaks
RunningReleaseDeclaresSchema in six; restoring an old backup breaks RollbackNeverRestoresOldData in seven.
Saved registry-*-report.md and registry-\*-chart.mmd files retain the observations.

Bounds: one offline migration, one release activation, one later work bit and one rollback. The model assumes
all writers remain stopped; it proves ordering, not filesystem copy completeness or arbitrary release honesty.
The real full-backup/crash/deployment regressions supply that implementation evidence. For the going-live order,
retained compatible baseline and no-data-restore rule, read lighthouse/server/REGISTRY.md.
The original BoardDeploy and PolicyRelease models still pass: 29/37 and 12/12 states/steps respectively.

## Manual maintenance companion

Run `node --test lighthouse/server/tests/board-manager.test.js` in Linux/WSL. The real scratch manager
checks a non-default config and store, injected copy exit 37, an invalid archive directory and invalid board,
successful restart after refusal, and the existing stop-timeout guard. Claims are written beside the selected
config; tests never print their credentials.

Copy BoardMaintenance.tla, its four configs and maintenance-view.mjs into external scratch. Use /statechart
with BoardMaintenance.cfg, then BrokenMaintenanceCopy.cfg and BrokenMaintenanceStatus.cfg, each in a fresh
output directory, and repeat the normal configuration. Also run BrokenMaintenanceTarget.cfg.
The normal graph has 100 states and 100 steps; all five invariants and NoDeadlock hold.
ValidateTarget and RefuseTarget model target selection before any stop or maintenance write.
The copy mutation breaks ClearRequiresSafetyCopy and CopyFailureKeepsCards in four steps
(select, stop, failed copy, archive). The status mutation breaks MaintenanceFailureIsReported in four
steps (select, stop, failed archive, restart). That rule requires the original nonzero exit status.
The target mutation breaks InvalidArchiveTargetLeavesServing in two steps (select invalid target, stop);
all other rules hold. maintenance-mutations.cjs moves the real target guard after Stop in scratch,
requires the named invalid-board regression to fail, then reruns the unmodified manager successfully.
The saved maintenance-chart.mmd and maintenance-\*-report.md files record those results.

Bounds: one archive or clear-cards command; copy, archive and restart success/failure bits; a successful stop;
valid/invalid archive destinations and terminal stuttering. The real stop-timeout replay proves a failed stop prevents
maintenance. Claims, paths, filesystem errors and actual card retention are real-code checks. No power-loss
durability or automatic recovery is claimed. No arrows are manually suppressed; 24 same-label steps collapse.
The board-release and policy-release graphs are unchanged: owner/clock/codec normalization surrounds
their existing command boundaries. Profile runtime tests cover historical store/archive bytes and policy
identity; deployment fault replays cover execution-relative policy fallback and host policy preservation.
Record the complete baseline and updated model matrix in an external run ledger.

## Maintain the verification

For a counterexample, replay its actions against the mapped code using scratch fixtures. If the real code
cannot take the path, correct the model and explain the mismatch; do not weaken an invariant to get green.
For an intended behavior change, update code, replays, model and this coverage record together. Run the
normal and broken model variants, real-code mutations and covering tests before moving the source-sync
commit forward. The new anchor must identify the reviewed implementation, not merely a documentation edit.
Use `/maintain-formal-verification-skill` for later synchronization work. This developer skill and its models
must not be copied into operator kits.
