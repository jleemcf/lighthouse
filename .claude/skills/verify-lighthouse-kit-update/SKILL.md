---
name: verify-lighthouse-kit-update
description: Verify kit bootstrap, activation, twin-copy failures and loaded MCP identity before release.
---

# Verify the Lighthouse kit update

## Fresh setup synchronization

A4 product source-sync: d430611d8d2a827bba10b05e9d9f275dfd2c3d52.
The existing update arm is byte-identical to b85827f; ExistingUpdateArmIsUnchanged checks that boundary when
historical Git data is available. New guided homes dispatch start/stop/status/doctor/update through setup-runtime.cjs
only when binding.json exists. Homes lacking that new binding keep the previous lifecycle and update path.
The new doctor command and runtime script are additive; collector fixes and the tool's private credential-file
selection are intentional installed-code changes. Operator settings, existing token selection and WSL copying
are preserved. Loaded MCP source changes still require the normal persistent reconnect notice.

Guided setup uses install.py's same preflight and manifest writing, then installs local hooks and project-scoped
MCP registration. Optional adapters stay off, so it does not publish a WSL twin receipt or start collectors.
FreshHostCreateGrantDoctorAndShift and GuidedOperatorBindGrantAndPrivateStorage verify the resulting home and
real MCP initialize. The probe uses an invalid local-only server override and closes stdin, then waits for exit;
DoctorProbeLeavesNoHeartbeatOrLoadedReceipt proves it posts no heartbeat and leaves no loaded receipt.
LH_MCP_PROBE suppresses kit-version loaded-session reporting only for diagnostics. The bind regression seeds
a pending reconnect at the installed target and proves doctor cannot acknowledge or remove that notice.
The guided update reinstalls from REPO.txt, verifies the manifest and requires an MCP reconnect. The same bind
regression changes installed runtime bytes, runs the actual shift.sh update and verifies the resulting doctor
plus unchanged config, binding, credential and MCP registration.
LegacyInstalledUpdatePreservesSettingsAndOnlyChangesIntendedFiles
installs b85827f into scratch, updates with --keep-from and compares token/config bytes, file inventory and output.
The old update/bootstrap models keep their transitions and bounds. The guided updater is a separate
install/verify path with no WSL twin or helper stages; the old model does not
claim its lifecycle. Its concrete success evidence is the installed-home regression. Core setup is covered
separately by InitialSetup.tla in the enrollment verification family, not an invented update phase.
Run setup_test.cjs, setup_compat_test.cjs and setup_faults_test.cjs with the paid key removed, alongside the
commands below.
ShiftStartPrecedesMonitorArmingInEveryBrief locks the documented compatibility order: shift start clears
lease launchers before Monitors are armed. Exit 127 after reversing that order is not a safe launcher-preservation
guarantee. The current-generation/parent-ownership proof is deliberately not broadened by this task.
Record normal, broken and restored statechart runs and real-code replays in an external run ledger.

Promise: an update exits successfully only after installation, pending-file activation,
Windows and WSL manifest verification, and any required helper restarts succeed.
Harm: false success leaves an operator running stale scripts while the board appears healthy.
Changed tools must leave a persistent reconnect notice until a new MCP server reports its loaded
identity and every other reporting live server matches. A fetched updater, not its predecessor,
must drive the installation. Otherwise the first update silently misses its newly installed checks.

## Coverage and source synchronization

Release cleanup removes retired fleet-steward files and install keys, not updater phases. The historical
bootstrap fixture still supplies inert values for the two retired keys because old installers require
them; current kit/example configs do not. Updating a home preserves old copies without arming them.
Source comments and the firstmate-only tool catalog change loaded identity, so the existing reconnect
notice is expected after an eventual kit update. Cleanup does not alter updater transitions or invariants;
configuration preflight adds the validation rules below. Rerun both real-code mutation suites and all
passing/broken formal configurations.

Generic-core source-sync commit: 3a98465b64feb32c690a7cd0634c89d451876f61.
Configuration preflight origin: 813654b72ea580df7b8dca52eba7b2b777369a0a.
Release cleanup source-sync commit: 178278066986176dd4d8fd6c8a6a6aeb1c5aee9c.
Covered code: the update arm, swap_new, outbox and steward in
lighthouse/operator-kit/scripts/shift.sh; rendering and manifest writing in
lighthouse/operator-kit/install.py, profile.py and render.py; verify in scripts/kit-state.py.
The model maps Refresh to repository/path checks, ResolveProfile to explicit profile selection
and retaining filled installed placeholder values, ValidateScripts/RejectScripts to
language-aware rendering and syntax preflight before any installed-home write,
InstallNewKit and InstallerFails to
installer completion, ActivateAndVerify to swap_new and the Windows verifier, CopyTwin
and TwinCopyFails to the WSL command, and FinishUpdate to helper activation and zero exit.
InstallationRequiresValidation and RejectedScriptsLeaveHomeUntouched cover preflight ordering.
FilledValuesSurviveUpdate covers precedence over new machine/profile defaults.
Source-selected profile, role and document metadata refresh independently of operational placeholders.
The installer itself resolves the private source for an already-running base bootstrap after its pull.
An unprofiled failed migration's generated neutral identity/clock defaults cannot mask that source profile.
profile_test.cjs replays the actual base bootstrap, checks each machine's selected historical briefs,
and separately verifies that genuinely filled operational values still survive the update. These cases
stay inside the existing ResolveProfile/StageFetched pre-write boundary; the bounded graphs are unchanged.
Display substitution is limited to operator/watch briefs; setup/readme key references and role documents
remain literal. This does not change updater phases. The neutral installation regression covers the boundary.
Owner aliases resolve inside the same ResolveProfile/StageFetched boundary: installed values win over explicit
kit configuration, then profile kit defaults, then profile server aliases. Explicit empty arrays are retained.
profile_test.cjs checks installed config.json for all four sources; its server-alias case fails without the
profile.py fallback. boardwatch_test.cjs exercises actual watcher output and collector routing for aliases,
invalid alias types, colliding non-owner labels, bundle headers and the shared default display name, with an
exact no-alias compatibility-output assertion. gate_test.cjs confirms the default route bypasses the judge.
These data/label changes add no update transitions or reconnect obligation; model bounds stay unchanged.
Preflight protects pending files, config, manifests and reconnect notices. The model abstracts command
completion; it does not promise that multi-file installation
or WSL copying is atomic. A failed phase can leave a partial home, which the command reports.
The fresh-install handoff printed by install.py is covered by install_test.cjs, not by the
update state models. It verifies copied scripts before publishing the WSL manifest and starts
no helpers. Its success and mismatched-copy cases use paths with spaces and apostrophes;
status must report the matching verified Windows/WSL release without an intervening update.

Bootstrap coverage: supported/run in lighthouse/operator-kit/bootstrap.py; protocol 1 in
lighthouse/operator-kit/update-protocol.json; write_json/tool_version/main in install.py;
connect/report/notice/status in scripts/kit-version.cjs; the initialize and tools/call handlers
in scripts/lighthouse-mcp.cjs; board_kit_status in scripts/toolcalls-spec.json;
kit-state.py --describe and the staged update arm in shift.sh.
The loaded MCP identity includes scripts/shift-session.cjs, not only the entrypoint,
tool specification and version reporter. The heartbeat-only starting label models
an unchanged entrypoint with a changed dependency: it must use the same persistent
reconnect notice and old-process reporting rules. bootstrap_test.cjs changes only
that helper and runs real old/new stdio servers to check the mapping.
Legacy recognition compares the three rendered updater/tool files against every change
on the b4942b9-to-HEAD ancestry path, not a fixed release whitelist. Complete history is required.
The direct-driver fallback remains a command-boundary fault-injection seam for PR5 regressions;
production updates enter bootstrap first and bypass its temp-copy, pull and machine-config paths.
KitBootstrap.tla maps StageFetched to snapshot/render/preflight/handoff, RecordTarget to the pre-write
reconnect marker, Install to completed script replacement, Activate to pending-file activation,
CopyAndVerify to verified WSL receipt, DisconnectOld to process exit and ReportNew/ReportAgain
to the loaded-process report. Interrupt abstracts failures between completed commands; no model
action asserts that the multi-file install/copy is an indivisible filesystem transaction.
The relay adapter in lighthouse/verification/relay/adapter.cjs includes the helper in its
scratch homes so merged relay tests execute the same MCP source without a missing module.
The shell-only shift command selects the live token file beside a shadow trial; normal
initialize/tools/call token selection is unchanged. This adds no update or reconnect
boundary. mcp_test.cjs covers shell edges and unchanged shadow dry runs against real
scratch routes; both passing models and all broken variants were rerun after the change.

## Run on every relevant change

Run from the repository root, with Python 3, Node 24 and Git Bash (Windows) or bash (Linux):

    node --test lighthouse/operator-kit/tests/install_test.cjs lighthouse/operator-kit/tests/bootstrap_test.cjs
    node --test lighthouse/operator-kit/tests/config_render_test.cjs
    node --test lighthouse/operator-kit/tests/*update*_test.cjs
    node lighthouse/verification/update/mutations.cjs
    node lighthouse/verification/update/bootstrap-mutations.cjs
    node lighthouse/verification/update/profile-mutations.cjs
    bash lighthouse/test-all.sh

The runner removes TYPESAFE_API_KEY before any test server starts. On a CRLF checkout,
run shell scripts from an LF-normalized scratch copy, never an installed operator home.
All updater replays create scratch Windows/WSL homes and replace external commands;
they never contact an operator, board or actual WSL home.
The fresh-install regressions fail on f230d3f because its installer prints no verified
handoff. Executing the corrected printed command through real wsl.exe in a scratch /tmp
home also reports matching releases. The change is a setup-only path, so the update model
mapping and bounds stay unchanged; all passing and broken formal variants were rerun.

The named ChangedToolsRequireReconnectNotice regression in known-update_test.cjs uses the bootstrap
replay to render actual historical sources with their historical installer, not a
new script labeled old: b4942b9, 5cd7cf3, 30056e2 and f0312bf must migrate and retain the first notice on an
unchanged rerun; ceb65aa must be refused unchanged. It exercises staging, pre-install, partial
installation without a final manifest, pending activation and copy failures followed by recovery.
The replay invokes the real bootstrap main entry and checks safe, phase-specific staging failures.
The connected-session test runs actual MCP stdio processes across an update and checks that an
old process still reports its captured identity, even after files on disk change. A new process
cannot clear the marker while the old reporting process lives; another report after exit can.
Keep complete Git history. For an LF-normalized scratch copy outside Git, set KIT_TEST_HISTORY
to the original worktree's absolute Git directory from git rev-parse --absolute-git-dir
(a Linux path when running in WSL), not its common directory, whose HEAD can name another branch.
This is a read-only fixture-history lookup; never modify that directory.

Consult /statechart by name before running or interpreting the TLA+ checks. Use its
current launcher with lighthouse/verification/update/KitUpdate.tla, KitUpdate.cfg and
view.mjs; write outputs to a new scratch directory. Repeat with broken.cfg: both
SuccessRequiresInstallation and SuccessRequiresMatchingCopies must fail there.
Repeat with preflight-broken.cfg: InstallationRequiresValidation and
RejectedScriptsLeaveHomeUntouched must fail after installation without validation;
the two original success rules and NoDeadlock must still hold.
Repeat with profile-broken.cfg: FilledValuesSurviveUpdate must fail after four steps;
all installation, validation, copy and deadlock rules must still hold.
Do not copy a machine-specific launcher path into this skill or its assets.

Also run KitBootstrap.tla with KitBootstrap.cfg and bootstrap-view.mjs through /statechart.
Repeat with bootstrap-broken.cfg and bootstrap-rerun-broken.cfg. The first must break
FetchedUpdaterDrivesUpdate and ChangedToolsRequireReconnectNotice; the second must break the
notice rule on an unchanged rerun. Matching copies and NoDeadlock must still hold.

## Mutation and result interpretation

mutations.cjs executes actual updater bodies with the installer or WSL failure guard
removed, confirms their zero exit, and proves the normal failure assertion rejects
each one. It then reruns the restored body and requires a nonzero exit. No production
file is edited. A missing mutation anchor is a stale verification asset, not a pass.

bootstrap-mutations.cjs replaces the staged driver with the actual old installed body,
removes the installer's pre-write notice and clears the notice on an unchanged rerun, each in
separate scratch sources. It verifies the missing new manifest/notice and then reruns each
restored variant. These are deliberately broken real code paths, not only model constants.

Bounds: three starting layouts (no manifest, current manifest and heartbeat-only), one update, one
Windows home and one WSL twin; success/failure at each modeled command boundary.
The layout variable labels identical command-boundary behavior; layout-specific
manifest and pending-file behavior is checked by the executable replay, not TLC.
The passing model checked 39 states and 60 steps; the broken model checked 54 states
and 84 steps and exposed six-step installer and seven-step twin-copy counterexamples.
The validation-broken model checked 60 states and 96 steps and broke both preflight rules
after four steps. Eighteen passing-model self-steps are omitted by the chart projection.
The profile-broken model checked 39 states and 60 steps; its four-step path replaces a filled
value after refresh, profile resolution, validation and installation. profile-mutations.cjs checks
the real bootstrap/installer boundary: normal, filled-value overwrite mutant, normal again.
KitBootstrap StageFetched already encloses profile resolution and preflight before home writes;
its command-boundary graph and reconnect obligations are unchanged. profile_test.cjs covers
explicit role content, optional polling, configured clocks and preservation of every installed key.
All five verification families and their deliberately broken variants were rerun; see
the baseline checks above for bounds and retained assumptions.
The configuration regressions exercise actual syntax checkers and reject malformed JS/CJS,
shell, JSON and PowerShell (when available) before any home write. Ordinary config retains
the legacy rendered bytes; apostrophes, backslashes and spaces round-trip as literal data.
Run the configuration checks above and record baseline and updated evidence outside the public tree.

Bootstrap bounds: two legacy source-layout labels plus a heartbeat-only update, one old reporting process and one
new reporting process, with a separate unchanged-rerun forget action for the broken variant.
The reporting-process transitions model a subsequent protocol-1 update, not the first legacy rollout:
pre-migration servers cannot report, so the first new report cannot prove other legacy sessions exited.
The passing bootstrap model checked 96 states and 222 steps. The view merges source labels
into 12 states and 18 arrows and hides 102 within-label steps, including terminal self-steps.
The broken model checked 72 states and 174 steps: selecting the old body fails the fetched-driver
rule after two steps; replacing changed tools without intent fails the notice rule after three.
The broken unchanged-rerun model checked 105 states and 255 steps, exposing a six-step lost-notice
path. All configured invariants and NoDeadlock were checked, not skipped after the first failure.

Excluded: power-loss durability, simultaneous updates, actual Windows file locks and physical
WSL permissions. Pre-migration MCP processes have no reporting protocol and remain unknown;
the documented first rollout must reconnect every legacy session. Live PID reports are not
proof against PID reuse or an authenticated process registry. A model pass is bounded evidence,
not a claim that every operating-system failure or arbitrary historical kit is supported.

If TLC fails, replay its named steps using the real updater tests before changing a
property. Treat a path absent from the code as a modeling error; treat a reproduced
zero exit after failure as a code defect. Never weaken a property to conceal a defect.
Move the sync commit forward only after reviewing the changed code-to-action mapping
and rerunning both the passing and intentionally broken variants. Use
/maintain-formal-verification-skill when that mapping needs maintenance.
