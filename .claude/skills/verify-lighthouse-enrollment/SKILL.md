---
name: verify-lighthouse-enrollment
description: >-
  Verify registry enrollment when changing grants, scope, proof retries, credentials, lifecycle authority,
  immutable registry snapshots or their commit boundary. Model competing consumers and replay real process crashes.
---

# Verify Lighthouse enrollment

## Board-management companion (A5)

Reviewed base 743a5ba86eb748bf390a7ccce28d598d111d595b plus the A5 management change; post-review source sync
5d3dfe6 also includes additive coordinator roles. registry-management.js
owns filtered management context, host-admin-only audited schema-2 membership adoption and redacted doctor
reports. registry-browser.js owns protected-file sign-in, short-lived HttpOnly sessions and revocation.
Every administrator-cookie mutation requires the exact request Origin, including the configured HTTPS origin
on a loopback proxy. SameSite cookies do not separate local ports. Bearer-only clients retain their API path.
registry-routes.js adds authenticated issue/revoke/member/session forms with origin and CSRF checks; protected
nonbrowser member commands still work while enrollment is off. Host administration grants no board-read role.
enrollment.js now permits owners to issue bind-only grants for their own active boards at lesser roles; it
rechecks that authority under the registry writer lock. Create/owner grants remain host-admin-only.

Run server/tests/management.test.js, server/tests/management-security.test.js, server/tests/registry-cli.test.js
and board/tests/management.test.cjs,
with lighthouse/ prefixed, then node lighthouse/verification/enrollment/management-mutations.cjs.
All ten real-code management mutants failed their intended regression and restored successfully. The four
review regressions cover person-origin browser sessions, explicit-bearer-only import, configured Owner-name
invitation refusal and additive membership preservation. They are concrete tests, not extra abstract model
claims. AdministratorCookieMutationsRequireExactOriginIncludingProxy also rejects missing/cross-port Origin
on comments and standing authorities while accepting the exact Origin, directly and through the proxy setting.
This concrete guard is outside the model's abstract CSRF prerequisite. Normal,
five broken and restored Management configurations ran through statechart: 133 states/203 steps normally,
all five invariants plus NoDeadlock held, and each broken variant failed its named rule. Saved reports/charts
are enrollment/management-_-report.md and management-_-chart.mmd under lighthouse/verification/.
The graph abstracts one browser operation, four actor classes and boolean request prerequisites. It excludes
cryptography, arbitrary DOM/JSON, expiration, concurrent writers, clipboard/history and liveness. The CLI's
enrollment-off adoption, hidden-board filtering and session revocation are implementation checks, not model
claims. Reproduce commands and actual browser/operator checks below; record proof externally,
counterexample paths, full companion matrix and upgrade-rehearsal limits. The original enrollment graph
remains 38/119; all five original variants and eighteen real-code mutants were rerun and restored.

Coordinator access is an additive board membership. Arrays retain existing roles; enrolled credentials remain
capped to their single granted role, and an operator/watch installation cannot inherit coordinator permission.
This changes membership admission, not grant consumption/retry/expiry transitions. Also run
`verify-lighthouse-coordinator-notice` and its coordinator-access.test.js registry/installation cases.
Use the checks in `lighthouse/verification/cards/README.md` to reproduce the normal enrollment-model run.

## Fresh initializer and guided client companion

A4 client source-sync: d430611d8d2a827bba10b05e9d9f275dfd2c3d52. Host initialization in setup/host.cjs checks
prerequisites and an empty home before writes, installs server bytes from the exact Git commit, initializes a
new registry and then marks only that new store schema 2. It uses makeEnrollment.bootstrap locally. Existing
populated homes refuse, including interrupted initializations; no legacy migration is invoked by init.
setup/operator.cjs stores a private prepared proof and credential, requires explicit host trust, submits the
approved create/bind scope and reuses exactly that proof after a lost response. The private binding references
credential.json. Generated scripts have no embedded credentials. Completion means CLI exit zero after doctor;
an installation marker alone is not evidence of a healthy home or a connected Claude session.

Run with TYPESAFE_API_KEY removed:

    node --test lighthouse/operator-kit/tests/setup_test.cjs lighthouse/operator-kit/tests/setup_faults_test.cjs
    node lighthouse/verification/enrollment/setup-mutations.cjs

The Linux scratch acceptance starts a pinned real release through board.sh start, prepares a create grant,
discards its first consumed reply, completes setup with the same operation, verifies only one board, runs both doctors and shift start/end,
and refuses reinitialization without changing config. The cross-platform bind regression verifies protected
credential storage, local tools/hooks and disabled adapters, retries an interrupted completion receipt, and runs
the guided update while preserving config/binding/credential bytes. Diagnostic tests use synthetic credentials only.
The real-code mutation runner catches removed host-trust checking, rewritten equal policy bytes and inconsistent
empty owner fallback, policy reapplication, doctor heartbeat/reconnect isolation and guided update dispatch, then requires
the restored regressions to pass in disposable source copies.

Use /statechart with InitialSetup.tla, InitialSetup.cfg and setup-view.mjs, then each Setup\*Broken.cfg and normal
again, in new external output folders. The normal graph has 10 states/19 steps; four invariants and NoDeadlock
hold. Overwrite breaks ExistingHomeUntouched in one step; trust breaks TrustBeforeEnrollment in three; stamping
breaks CredentialsAreReferences in five; skipping doctor breaks CompletionRequiresDoctor in six.
It models one fresh/existing home and one client installation, explicit trust and command-boundary success.
The chart collapses 12 same-label steps and hides no arrows. It abstracts prerequisite failure, HTTPS and OS ACLs;
it makes no multi-file atomicity or liveness claim. Interrupted setup may leave a partial private home.
Enrollment.tla itself is unchanged at 38 states/119 steps: its five existing broken variants and all real-code
mutants still fail as intended. Record the complete observed matrix in an external run ledger.

Promise: a one-use grant installs exactly its scoped installation in the same durable transaction that spends it;
only the original installation proof can recover the result after a lost reply. Harm: a split or replay could
authorize a second installation, create another board, or disclose a successful enrollment to a bare request ID.

Use scratch homes and loopback ports, never a live board, operator home or port 7700. Remove TYPESAFE_API_KEY
before any acceptance test starts. Never display credentials, grant files, configuration tokens or backup contents.

## Source sync and coverage

Last confirmed implementation: b2503008ef0bb953efcbafa64788d2d1fd1050f6.
All short source paths here are under lighthouse/server/; model assets are lighthouse/verification/enrollment/.

- enrollment.js, issue: host-admin create/owner grants and owner-scoped lesser bind grants, bounded TTL,
  seven canonical scope fields and hashed verifiers.
- enrollment.js, consume: Begin checks scope, expiry and proof inside the registry writer transaction. Two competing
  operation IDs share one grant and installation. Retry requires the saved operation, grant, scope, proof and
  credential hashes, and a still-valid installation. A bind never transfers ownership.
- registry-files.js, transact: FlushMetadata, FlushCredentials and FlushPointer prepare immutable files. Commit
  is the single current.json rename selecting the paired generation; directory flush precedes acknowledgment.
  The writer lease serializes transactions; Linux boot/start identity distinguishes reused PIDs. Cached accessors
  observe external local writers at request, notify and background-tick refresh boundaries, not on every getter.
- registry-lease.js and registry-migrate.js: offline conversion uses a separate runtime lease. See the deployment
  skill's RegistryMigration companion; schema conversion is not an enrollment action.
- enrollment.js, authenticate/installation and web.js, roleOn: scoped roles, credential rotation, revocation and
  version checks and own-key installation lookup. Host administration grants no implicit board role. Lifecycle
  management also respects a lesser installation role for an otherwise owning principal.
- web.js, canNotice, toolcalls-tools.js and events.js: both notice protocols retain the full principal, board
  scope and explicit watch grant. Archived sources refuse new tool-call work before call/shift/queued writes,
  and archived targets accept no notices. Only direct, non-queued, non-dry-run results for existing board/caller
  tickets can settle preserved delivery evidence and replay receipts, without shift writes. Active legacy
  cross-board watches remain unchanged.
- registry.js and server.js: schema-1 projection keeps legacy input tolerance; durable import validates it.
  Migrated startup reports bootstrap drift using only board IDs and field names, never adopting config changes.
- registry-routes.js and registry-cli.js: HTTP TLS/origin/CSRF/rate gates and protected file handoffs. No network
  bootstrap exists. Authenticated management issuance returns the private handoff once, never from context.
  These are real-code checks, not claims made by the original enrollment model.

## Run the real code

From the repository root in PowerShell:

    Remove-Item Env:TYPESAFE_API_KEY -ErrorAction SilentlyContinue
    node --test lighthouse/server/tests/enrollment.test.js lighthouse/server/tests/registry.test.js
    node --test lighthouse/server/tests/registry-durability.test.js lighthouse/server/tests/registry-http.test.js
    node --test lighthouse/server/tests/registry-cli.test.js lighthouse/server/tests/registry-migration.test.js
    node --test lighthouse/server/tests/registry-lease.test.js
    node --test lighthouse/server/tests/registry-notices.test.js
    node lighthouse/verification/enrollment/mutations.cjs

The mutation runner removes the paid-service key itself. It first requires unmodified tests to pass, copies the
server outside every repository, removes each real guard in turn, requires the relevant regression to fail, then
requires the restored tests to pass. It never mutates the checkout or a live home. The replay mutant removes both
the consumed-grant and duplicate-installation guards; either alone is redundant for that exact bind regression.
The other enrollment mutants omit installation persistence, proof matching, expiry and exact scope matching.
Review regressions also reinstate host-admin board rank, silence configuration drift, use inherited installation
keys, enforce strict schema-1 startup, re-read the pointer on getters and ignore Linux boot/start identity. Run
the mutation command in Linux/WSL as well: the PID-reuse mutant is explicitly skipped on Windows. All eighteen
real-code mutants fail their focused regressions on Linux, and restored enrollment passes. These checks cover
implementation behavior outside the bounded protocol model; do not add unrelated model variables for them.
Notice mutants restore name-only authorization in tools and lines, inherit a principal's watch membership
without a watch grant, admit archived-source calls and allow archived-target notices. Archive settlement mutants
block preserved relay results or let those results touch the shift; both must fail the same HTTP regression.

The process-death tests exit immediately at metadata-flushed, credentials-flushed, pointer-flushed,
pointer-renamed and committed; reopening sees either the old pair or the complete new pair, never a split.
Two independent consumers race the same grant, and same-operation retries converge. HTTP and CLI tests use a real
scratch server and protected synthetic credentials, check redacted output and never call a paid service.

## Read every model result with /statechart

Copy Enrollment.tla, its six cfg files and view.mjs into external scratch. Use /statechart with Enrollment.cfg,
then BrokenSplit.cfg, BrokenReplay.cfg, BrokenRetry.cfg, BrokenExpiry.cfg and BrokenScope.cfg, each in a new
output folder. Finish by repeating Enrollment.cfg. Do not run TLC directly and skip the /statechart report.

TLC 1.7.4 checks 38 states and 119 steps normally. Six invariants plus NoDeadlock hold; the chart draws six states
and nine arrows, with 68 same-label steps collapsed and no manually hidden arrows. Saved model-report.md,
model-chart.mmd, broken-_-report.md, broken-_-chart.mmd and restored-\* files are the observed evidence.

- BrokenSplit: AtomicConsumption fails in five steps and AcknowledgmentIsDurable in six. The current pointer
  selects spent-grant metadata without an installation, then the host replies as if it exists.
- BrokenReplay: OneUse fails in eleven steps. After the first commit and restart, a second operation spends the
  same grant and commits a second installation/board result.
- BrokenRetry: RetryRequiresInstallationProof fails in seven steps. The first result commits, its reply is lost,
  then a bare request ID retrieves it without the installation proof.
- BrokenExpiry: ExpiredGrantsRefused fails in two steps: unused grant expires, then Begin accepts it.
- BrokenScope: ScopeIsExact fails in five steps: a mismatched request passes Begin and commits.

## Bounds and exclusions

This is a bounded TLA+ protocol abstraction, not a proof over JavaScript. One grant, one fixed installation,
two competing operation IDs and at most two commits suffice to expose one-use/retry faults. One serialized
writer abstracts the real exclusive lease; crashes discard prepared files but retain the selected generation.
Expiry is checked at transaction entry, not while a synchronous commit is already in progress. Proof equality,
credential hashing and scope equality are abstract booleans, not cryptographic proofs.

Excluded: malicious filesystem owners, arbitrary disk corruption, power loss and hardware flush behavior,
unbounded requests/storage growth, lock fairness/liveness, distributed writers and transport cryptography.
POSIX directory flushes and Windows current-user ACLs are platform implementation checks; the model does not
claim Windows directory-fsync support. HTTP security, legacy token compatibility and archive semantics are
covered by named acceptance tests, not by the enrollment state graph.

## Maintenance

For each counterexample, replay the code's corresponding actions in scratch. If the code cannot follow the path,
repair the model and explain why rather than weakening an invariant. For an intended change, update code,
regressions, mutations and model together. Rerun normal, broken and restored cases before moving the sync commit.
Use /maintain-formal-verification-skill for later synchronization. Never ship this developer skill in operator kits.
