---
name: verify-lighthouse-handoff
description: >-
  Verify tools-mode operator ownership, durable epochs, commit fencing, leases, readiness or ticket evidence
  when changing the handoff protocol, HTTP/tool write routes, session credentials, persistence or kit reconnects.
---

# Verify Lighthouse identity, checkpoints, dispatch and recovery

Promise: only the current live session at the exact epoch may act, and an acknowledged transfer already has its
epoch, audit and retry record on disk. Breaking this lets two sessions direct work or loses a successor on restart.
A transfer changes the holder, not the ongoing shift or its original since. Enforcement-off boards retain legacy
behavior; a relieved holder may settle only its existing ticket evidence.

## Run on a relevant change

1. Read lighthouse/HANDOFF-IDENTITY.md and verification/handoff/WRITE-INGRESS.md. Compare every changed entry point
   with the coverage below. Check synchronous transaction boundaries and effects, not just route admission.
2. Load the installed statechart/SKILL.md by path and run verification/handoff/HandoffIdentity.tla with none.cfg and
   view.mjs. Follow that skill's current launcher instructions; use a new output folder outside every repository.
   Read the report and chart. All six named invariants and NoDeadlock must hold.
3. Through /statechart, run no-fence.cfg, arrival-only.cfg, nondurable.cfg, split-audit.cfg, stale-nomination.cfg,
   shift-reset.cfg and legacy-bypass.cfg, each into another new external folder. Each must expose its intended
   shortest bug path in an external run ledger. Read every result; bounded-out rules are not passes. Run none.cfg
   again, without reducing the bounds or weakening a rule.
4. Run node lighthouse/verification/handoff/mutations.cjs. It copies the real code into external scratch folders,
   removes each guard, requires its concrete regression to fail, rejects load/syntax errors as false proof,
   discards the copies and checks the restored implementation. Never run a mutant on a live home or server.
5. Through the same unmodified launcher, run CheckpointTransfer.tla with checkpoint-none.cfg and checkpoint-off.cfg
   and checkpoint-view.mjs. All eleven safety invariants must hold. The expanded normal model exceeds the
   500-state drawing budget; no normal chart is emitted. checkpoint-chart.mmd and checkpoint-continuation-chart.mmd
   are generated shortest counterexamples for cancel-hold and continuation-hold, not the normal graph. B2 disables
   deadlock checking: expired-lease recovery is intentionally outside this bounded protocol, not a liveness claim.
   Run checkpoint-missing-context.cfg as another passing case and checkpoint-context-hold.cfg as a failing one.
   Run checkpoint-{shift-reset,double-accept,rollback,blind-accept,stale-pickup,drain-work,false-clean,feature-off,
   lost-accept,continuation-hold,cancel-hold}.cfg separately. Each must expose its named bug, never a syntax error.
   Rerun checkpoint-none.cfg.
   Run node --require ./lighthouse/tests/sandbox.cjs lighthouse/verification/handoff/checkpoint-mutations.cjs.
   All sixteen real-code counterexamples must be caught and unmodified acceptance must pass before and after.
   Twelve map to model faults; receipt-pause, checkpoint-retry, changed-journals and dry-run cover kit obligations.
6. Through the same launcher, run DispatchLedger.tla with dispatch-none.cfg and dispatch-disabled.cfg and
   dispatch-view.mjs. All nine invariants must hold (12,420 normal states; nine disabled states).
   Run dispatch-{resend,receipt-gate,alias,gap,queue,off,target,settled-hold}.cfg separately.
   Each must expose its intended
   counterexample, not a parser/load error. The normal graph exceeds the drawing budget; fault views retain every
   bug-path state. Retain safety bounds and the external one-delivery assumption in the run ledger.
   Run node --require ./lighthouse/tests/sandbox.cjs lighthouse/verification/handoff/dispatch-mutations.cjs.
   Run node --require ./lighthouse/tests/sandbox.cjs lighthouse/verification/handoff/dispatch-kit-mutations.cjs.
   All twenty-eight server and eight kit real-code mutants must be caught; unmodified acceptance must pass
   before and after. Rerun the
   normal model without reducing bounds or weakening invariants. The extra consume-answer replay covers the
   stored-result obligation independently of the model's successor resend path.
   Also run DispatchSettlement.tla with settlement-none.cfg, settlement-view.mjs and each
   settlement-{migration,call-hold,gap-hold,owner-source,owner-conflict,owner-agree,legacy-origin}.cfg.
   The normal case has 2,858 states and six rules. Each fault must show its named harm;
   migration checks the double execution rule alone
   to reach the five-step harmful replay. Read every rule result and rerun settlement-none.cfg.
7. Read lighthouse/operator-kit/HANDOFF-RECOVERY.md. Through the same launcher run RecoveryGeneration.tla
   with recovery-view.mjs and recovery-none.cfg, recovery-disk.cfg and recovery-off.cfg. All seventeen invariants
   must hold: enabled cases have 372 states and 1,064 transitions; disabled has four states and four transitions.
   Run recovery-{approval,revocation,renew,queue,missing,helper,pid,replay,target,steward,completion,off-bug}.cfg
   and recovery-{cancel,cancel-gap,pin,transient,notice}.cfg
   separately. Each must expose its named harm, never a syntax/load error or an unchecked rule. Read the report
   and chart, then rerun all three correct configurations. The bounded protocol endpoints disable deadlock
   checking; this is a safety claim, not eventual recovery.
   Run node --require ./lighthouse/tests/sandbox.cjs lighthouse/verification/handoff/recovery-mutations.cjs.
   All twenty-eight real-code mutants must fail their behavioral regressions and restored acceptance must pass.
   Seventeen model faults map to concrete replays; the three target-pin paths, transient JS/Python reads,
   malformed status, combined-lease notices, persisted lease writes, adapter substitution and S20 duplicate
   completion add coverage. Failed writes must not extend local authority; retry only to the persisted expiry.
8. Run bash lighthouse/test-all.sh with the paid-service key absent (the wrapper unsets TYPESAFE_API_KEY). For a
   quick focused check use node --test lighthouse/server/tests/ownership*.test.js and
   node --test lighthouse/operator-kit/tests/session-identity_test.cjs. Use the repository's sandbox preload when
   calling Node directly: --require ./lighthouse/tests/sandbox.cjs. All homes/servers must be synthetic loopback
   fixtures away from port 7700. Reserve a native Windows test window with the coordinating session first.

The skill was followed against nine B1 and sixteen B2 real-code scratch mutations and the restored implementation.
TLC 2.19 (revision 5a47802) through /statechart checked the model; Node 24 runs the concrete tests. The model check
and mutation replay take seconds in WSL; the complete release suite is longer.
Do not copy a statechart launcher or its installation paths into repository scripts or change upstream skill files.

## Model/source coverage

Source sync: f7f9966 (reviewed recovery fences and helper continuity through transient reads and writes).
Move this commit forward only after confirming the mapping
still describes the changed code and rerunning the model, real-code counterexamples and acceptance tests.

B3 maintenance compared 2e00e2c through the B2 squash 9d599b8, B3 implementation ed5247c and the checked source
65f2e1d and review fixes 14285c1, d20b513 and 057319d, including moved MCP setup and source-settlement code.
B1/B2 model boundaries and promises remain in sync; dispatch, import and
adoption need the added model and concrete harness. The prior passing B1/B2 checks did not establish B3 behavior.
Prior safety promises and bounds remain; settled continuation now has an explicit enabled-action invariant.
All prior correct and fault configurations and all 25
prior concrete mutants were rerun; the B3 models and thirty-six mutants establish the new mapping.

- Nominate/Invalidate/Acquire/Retry: server/ownership-control.js control/acquire; exact nomination status, epoch,
  expiry and operation-id checks. Loss invalidates an earlier planned approval; fresh captain approval is required.
  Acquisition checks deadlines again before commit. Audit, operation result and holder commit in one snapshot.
- Expire: server/ownership.js acting/renew and shift-presence.js presence. Expiry revokes acting rights without
  choosing a successor or ending the shift. Renewal retains the admission lease deadline through beforeCommit.
- Arrive/Commit: mutation-routes.js route/authorize, store.js transact; full body before admission, synchronous
  mutation, second scope/epoch/lease check at commit, rollback, deferred effects and response. Direct
  toolcalls-request.handleCalls and toolcalls-authority createAuthority/yoloSwitch repeat their boundaries.
- OldSessionActs/LegacyActs: ownership.acting plus web.principalOf and scoped legacy/protocol admission. The model
  abstracts credential validation; concrete HTTP/helper matrices check missing, legacy, collector and stale actors.
  ownership-review.test.js also checks human-page role parity, cross-board session limits, heartbeat IDs and source
  fencing for notices. Normal heartbeat retries cover a 90-second outage without extending a genuinely lost lease.
  Unbound legacy uploads are private staging, not modeled board writes; publication references and explicit upload
  bindings remain fenced. Concrete tests cover this non-disruption boundary and permanent attach-error cadence.
  Headerless and unrelated-header session uploads remain bound to the credential's board; both routing bypasses
  have concrete mutants caught by the ingress matrix. These supplement the model's seven counterexample paths.
- LateEvidence: ownership.evidence/ticket and toolcalls-relay; original session/epoch and private ticket-bound
  capability. Kit session-identity.cjs and lighthouse-mcp.cjs retain provenance before dispatch/queueing.
- DurableAcknowledgement/AuditAndOperationAtomic: store.js transact, web.send, durable-store.js write. Crash tests
  kill a real persistence-writer child with synthetic epoch/audit/operation values at each stage. A separate real
  ownership-store test cold-loads and retries in-process; HTTP acceptors race and retry. Server death between disk
  commit and its HTTP reply is not exercised. These distinct tests must not be described as that end-to-end kill.
- ShiftContinuous: ownership-control acquire/activate and shift.js transition. First activation may add a shift id
  without changing since; a real start after an ended shift is separate from holder transfer.

## Bounds, assumptions and interpretation

B2 mapping: handoff.control/perform transact the checkpoint/actions and operation/audit together. Prepare retains
the holder and enters draining; checkpoint and seal use authoritative live references, freshness and quiescence.
Accept validates a durable sealed-read receipt and outgoing lease before changing holder/epoch exactly once.
Pickup reads current board records plus every retained change since checkpoint, then acknowledges the last
board-scoped retained revision, not the server-wide sequence. Read retries retain a small receipt and rebuild live
records. Context-only incompleteness cannot create dispatch holds; unknown queue/relay effects hold at a transfer
seal. Cancel rechecks effects and restores inherited holds before resuming the same epoch; commit cannot roll back.

Kit fromHome persists the full checkpoint request before sending, keyed by board/session/operation. Reconnect
reuses that inventory and rejects changed caller arguments. Planned-handoff retries compare current queue/relay
references, ignoring timestamps, and require a new operation after journal changes. Same-holder continuations
keep their original inventory. handoff-retry.test.js exercises real control after lost answers and outages;
checkpoint-retry rebuilds the payload and changed-journals removes the comparison. Both must fail. This client-
to-operation mapping is a concrete persistence obligation outside the bounded server-action model.

Kit intercept returns dry-run board_shift calls directly to the legacy engine before any handoff request.
The real HTTP regression compares the entire durable store for compacting and compacted on an enabled board;
the dry-run mutant removes this guard. Rehearsal must not create a checkpoint, pickup barrier or retry record.
This client-only nonmutation obligation is outside the server-action model; no bounds or invariants change.

Continue uses the same schema/read/pickup path without changing holder, epoch, shift id or since. dispatch guards
and ownership.acting refuse new work during draining/pickup. Feature-off control refusal preserves legacy behavior.
Concrete coverage: handoff*.test.js, kit handoff_test.cjs, board handoff.test.cjs; crash worker covers each of seven
protocol controls at written/flushed/renamed/committed stages, cold reload and two exact retries.

CheckpointTransfer.tla adds a separate bounded safety model: two sessions, one transfer OR continuation, two
competing operation ids, one late ask/revision, one unknown-work flag, one crash and separate outgoing/successor
leases. ContextMissing is a fixed input, checked both ways. One cancel/reprepare and same-holder effect resolution
are now included; compaction may start with pending work. Correct configuration reaches 1,112 states; all eleven
safety invariants hold. Off reaches eight states/16 steps; missing-context reaches 1,064 states.
NoDeadlock is not claimed:
the old unconditional Done masked every stuck state and is removed. Successor loss requires captain recovery,
not an automatic lease revival. Concrete stale-epoch attachment/heartbeat tests prove reconnect inside the lease.
The normal graph exceeds the chart budget; each of twelve fault configs draws only its shortest unsafe paths.
TLC still checks every reached state, with no smaller exploration bound. No transferred effect loses its hold;
HonestSeal applies to actual seals, not same-holder continuation, which has not transferred effects.
NoUnjustifiedHolds now also forbids newly invented continuation/cancel holds. Receipt settlement before ordinary
queue pausing is checked against the real MCP source, including a deliberately restored early-return mutant.

Two sessions, epochs 1 and 2, one captain-approved transfer, two competing accept operation IDs, one in-flight
request, one original relay ticket and a live/expired lease. Admission, synchronous mutation and precommit checking
are distinct model steps; atomic durable replacement is one step in both the model and implementation. Persistent
operation retries and independent evidence are stutters in the chart. The chart hides 124 same-label transitions.
SingleCASWinner is structural in these bounds; the real HTTP race is the direct two-acceptor implementation proof.

This is bounded safety, not availability, eventual handoff or a proof of every JavaScript input. Credentials,
readiness enumeration, multiple boards, registry revocation, real clock jumps, renewal timing, filesystem errors
and arbitrary tool payloads are concrete-test obligations, not modeled states. One server writer and atomic local
rename are assumed. POSIX directory fsync is used; Windows proof covers process crashes, not sudden power loss.
B3 coverage is in DispatchLedger.tla and the checks above: stable logical intents, single-use permission,
separate local request/answer writes, caller crashes, lost answers, two homes, external completion after relief,
scoped late receipts after transfer/expiry, explicit adoption and sticky import gaps. dispatch-ledger/attempts/
calls/routes and toolcalls-request commit through B1's fenced boundary. The kit consumes and saves permission
before the existing route, and never resumes a route from a persisted grant. New ids cannot evade unresolved
target/hash suppression. Original target binding pauses another installation; unrelated board work continues.
Ordinary calls retain ids, body hashes and origin, require current-epoch review, and permanently deduplicate
committed results. Receipt capabilities may settle imported evidence under authenticated board access while
preserving original ticket/session/epoch scope; they never grant acting rights. Missing imports latch a gap.
Owner reconciliation requires independent evidence and quiescence; it does not reissue consumed permission.
The cryptographic envelope, real ACLs, source-authority revalidation, journal fsync and schema startup are
concrete-test obligations. Twenty-eight server and eight kit mutants cover the eight modeled faults, positive-answer
replay, authorization, rehearsal isolation, schema protection, optional files and queue steady state.
The model includes owner gap resolution and reconciliation, receipt settlement and next-instruction issuance.
The second instruction is modeled through issuance only; real sequential delivery tests cover its full route.
DispatchSettlement.tla adds readiness-time commits, activation settlement and cache pruning before
cross-principal adoption. It includes queue/gap transfer holds and release after the final effect, owner source
marking and both polarities of scoped receipt evidence. Unknown legacy origins resolve a unique original commit
across original/successor importer principals; ambiguous candidates remain a concrete HTTP obligation.
One original call, one transfer, one gap, one receipt, one unknown relay and one owner decision are bounded;
acting/evidence validation is assumed from the separate models. Its seven faulty configurations replay review
S11-S16 against real code. Owner-agree and legacy-origin
expose the late-negative-receipt hold and cross-principal legacy duplicate; 12 server and one kit mutants
were added for these review paths.
B4 adds RecoveryGeneration.tla: captain approval for each loss, explicit live revocation, atomic epoch advance,
the B2 pickup barrier, returning-predecessor fences, missing-data honesty, original-target preservation, scoped
helper generations, transcript deduplication and independent steward continuity. handoff-recovery.js approves
and checks approval again at commit; handoff-actions.js accepts through B1's CAS and requires pickup. Locations
are immutable captain-recorded metadata; handoff-location.js and dispatch-ledger.js pause unmatched or remote
targets. target-binding.cjs verifies normalized installed adapter hashes before external permission consumption.
helper-runner.cjs starts only new child handles and retires only those children; helper-generation.cjs and
helper_generation.py fence local cursors, output and headers with installation/session/epoch/helper identities.
helper-cursors.cjs imports no process metadata or foreign offsets; collector.py retains seen UUIDs and a
cross-home timestamp floor. steward-result.js settles holds on every helper completion, including duplicate
completion of an already-finished job (S20), without stopping the steward service or changing its ownership.
Same-home, same-machine/different-home and cross-machine cases are concrete obligations; no remote firstmate
adapter is supplied, so cross-machine dispatch pauses while board work proceeds. Missing local data always
leaves a degraded seal and an inventory gap until independent reconciliation. B5 live activation, preauthorized
successors, target migration, firstmate changes and line-mode handoff remain outside these models.

If a real replay disagrees with the model, first treat the model as suspect. If intended product behavior changes,
update the model and regressions together; never hide a finding by narrowing the bound or changing an invariant.
Record open counterexamples and user harm in an external ledger. Use /maintain-formal-verification-skill after a change
that did not maintain this mapping. Keep the related relay, deployment, enrollment and coordinator skills intact.


## Inventory ordering maintenance

ad38f20 defers committed-call import hold release to the final inventory control boundary. The batch still commits
atomically, but a release performed between items could clear retained holds before later calls, gaps or relays
became visible. Four concrete regressions cover new and previously imported calls and each later effect. The
inventory-prior-hold and inventory-new-hold mutants restore each premature release; recovered-call-hold follows
the release flag. The one-call settlement model does not describe this within-inventory ordering.
Receipt source marking now matches the used-ticket return after owner reconciliation, including conflict-resolved.
No property or bound changed. All model configurations and all 61 B1/B2/B3 concrete mutants were replayed at this
source mapping, with restored acceptance before and after. Normal state counts remain 57 / 1,112 / 12,420 / 2,858.


## Receipt provenance and retained history maintenance

2bd3b65 preserves the original session and epoch on imported B1 receipts without ledgerVersion. Publication
omits only board-acknowledged recorded relays; unresolved and locally reconciled records remain, and full local
journals and encrypted exports are unchanged. Run dispatch-review_test.cjs with the other focused kit suites.
The legacy-receipt-origin and acknowledged-history mutants must fail their concrete regressions. These are
serialization and publication obligations within the existing scoped-evidence/import abstraction; model steps,
properties and bounds did not change. All configurations and the complete verification skill were replayed.

## Watcher compatibility maintenance

361d7bf supplies the dormant generation flag in the extracted legacy cursor fixture. Master 47d82bc adds bounded
monitor read retries and loss notices; generation validity still precedes every cached legacy lease check.
a95a9c6 retires generation-only watchers without a legacy monitor path, which that new notice path otherwise
assumed. The new generation regression and a scratch removal of this guard reproduce the TypeError and clean
retirement. No model action, promise or bound changes: OS retirement reporting remains concrete coverage.
All 56 configurations, seven restored configurations and 74 behavioral mutants were replayed at a95a9c6.
The full WSL release suite passes all 46 suites; rerun lease_read_test.cjs and monitor_lease_test.cjs with
helper-generation_test.cjs after changing this shared watcher boundary.

## Recovery review maintenance

32e6b46 fixes revoked-predecessor cancellation, successor target pinning, transient helper loss, cancelled
synthetic gaps, lazy MCP dependency tracking and combined-lease notices. bf95611 requires a confirmed greater
epoch for quiet retirement, rather than treating malformed status as a successor. Reproduce recovery checks above.
The previous green model omitted these branches: its pass was on an incomplete description. Add Cancel,
PredecessorCancel, LocateOriginal, PinSuccessor, RefreshFailure and ExpireHelper without shrinking old bounds.
CaptainControlsRecovery, CancelReleasesGap, TransientHelpersContinue and HelperLossVisible extend the old rules.
Unlocated original targets remain unknown and paused, even when degraded board-side recovery is permitted.
Replay all 61 configurations, seven restored cases and 85 concrete mutants, with acceptance before and after.

## Lease-write maintenance

f7f9966 extends helper refresh retry to transient local writes and advances remembered expiry only after the
atomic write returns. Review found a real code bug in the original B4 refresh, not a changed safety promise.
RefreshFailure already covers unsuccessful local authority refresh; its view now names reads and writes.
The model actions, properties and bounds are unchanged. Run the recovery checks for the acknowledged-write
boundary and the failing-before regression. The four new mutants restore expiry-before-write, immediate
write-failure stop, leaked rename artifacts and the misleading process-start notice. All 61 configurations,
seven restored cases and 89 concrete mutants were replayed, with acceptance before and after every harness.
Run helper-generation_test.cjs after changing this boundary; a failed write must never extend local authority.

## Steward privacy boundary maintenance

5374018 replaces full steward-request copies in successor reads with an allowlist of continuity metadata.
Run handoff-recovery.test.js: both planned handoff with recovery disabled and missing-disk recovery must expose
running/completed request identity, state, timing and result references without private questions, job prompts,
errors, card/ask consultation targets or future private fields, while leaving the steward records unchanged.
783a931 also removes cardId and askId under the release decision; both association regressions fail before
that removal and pass afterward. Both original private-payload regressions fail
before the fix and pass after it. RecoveryGeneration.Read records only that pickup evidence was read; it does
not describe payload fields or prove confidentiality. This serialization fix changes no modeled state, action,
property or bound. All 68 model reports at 9ffff75 match the prior maintained replay, with no unchecked rules;
all 89 concrete mutants are caught. The final association-only narrowing is outside those unchanged modeled
fields. The authority/continuity models remain in sync; privacy is concrete coverage.

## B5 activation mapping and acceptance

329516f maps the existing enabled abstraction to the durable per-board handoffActivation record in a real server.
The old ownership-only and ledger-only activation controls cannot bypass the named-board readiness transaction.
Primitive model fixtures retain their B1-B4 flag adapters. The checkpoint feature-off and recovery off mutation
anchors follow that mapping; no model action, property or bound changes. All 61 configurations plus seven restored
cases were replayed (68 reports), with each promised rule checked and each intended counterexample observed.

Read lighthouse/HANDOFF-ACTIVATION.md. Run activation-http.test.js,
activation-process.test.js, activation-dispatch.test.js, activation-services.test.js and activation-rehearsal.test.js
under the sandbox preload with TYPESAFE_API_KEY removed, then bash lighthouse/test-all.sh. The rehearsal stages B4
to current code in scratch homes only. Windows skips POSIX staged deployment, but runs real HTTP crash/ACK-loss,
dispatch, helper and steward processes. Use the approved native test window; never target an installed live home.

The readiness census, exact kit compatibility version, loaded/installed manifest check, complete journal migration,
owner attestation and lossless deactivation are concrete obligations, not claims proved by the protocol models.
Preactivation imported calls must settle permanently while legacy writers drain, before the activation switch: run
dispatch-migration.test.js and the readiness-commit/cache-settlement mutants after changing this boundary.
Repeat all five mutation harnesses with their baseline and restored acceptance, not just the changed model.
The B5 replay catches all 89 behavioral mutants (9 identity, 16 checkpoint, 28 dispatch, 8 kit and 28 recovery),
with baseline/restored acceptance around each harness. Fixture migration now uses the real B5 activation barrier,
not direct B1/B3 switches; the synthetic relay fixture includes the new readiness dependency and isolates sessions.

## B5 reviewed readiness boundaries

9d74ed9 adds audited inactive-only retirement of stopped obsolete attachments, owner-resolved journal reconnect,
terminal call retention after deactivation, schema-5 registry refusal and immutable original-route pin readiness.
These concrete activation obligations do not change model actions, invariants or bounds. Run activation-review.test.js
and activation-setup.test.js with the acceptance commands above. The private-file CLI setup path must not return
credentials. The rehearsal must accept legacy work on both tools boards before upgrading and retiring old writers.

The checkpoint binding now uses the same durable recovery-enabled predicate as the rest of B5; the checkpoint-pin
negative replay and activation-services.test.js require the original machine pin to survive. RemotePause must bypass
delivered-source suppression, assert the dispatch-paused reason, and leave intents and attempts unchanged. Each crash
fixture must inspect the first retry's duplicate flag at every persistence stage, not only the next successful retry.

previousCall now settles tracked calls while disabled, so an inventoried cache hit no longer reaches the old cache
fallback. The cache-settlement mutant must still fail on an uninventoried legacy cache hit after activation:
dispatch-migration.test.js separately tests that remaining path. Do not weaken or remove the mutant as redundant.
Six scratch-only negative replays restore the retirement, terminal-call, resolved-journal, registry, checkpoint-pin
and target-readiness bugs; each named regression must fail, with baseline/restored acceptance.

## Paged migration maintenance

9dc8fa2 is the source mapping for bounded journal migration, following c41badc. The gap mutant now removes
previousComplete from the final-page guard rather than matching the old unpaged expression. This is verification
drift from a renamed predicate, not a changed promise. Keep the same counterexample and bounds.

Paging imports are durable evidence while incomplete; readiness, dispatch and deactivation stay held. Independent
owner resolution may explicitly abandon an exact migration ID at the current epoch, retaining imported obligations,
the missing-pages gap and an audit record. Approval records the gap set present at commit; it does not CAS-bind
the owner's earlier inspection. The latter remains an explicit follow-up, not a verified promise.
These intermediate steps and active-client request bounds remain concrete obligations outside the one-gap model.
Run activation-gap-review.test.js, activation-migration.test.js and activation-process.test.js; their negative
replays must catch stale gap approval, orphan readiness, missing owner backout and unbounded active publication.
Run the maintained models and all 89 concrete mutants without weakening any property or reducing bounds.

a9060c2 additionally carries the interrupted snapshot's completeness and source gaps into migration restarts.
Run activation-restart-review.test.js: both paged cases must fail without their respective carry-forward guards,
while the two equivalent unpaged controls pass. A restarted clean snapshot cannot erase a recorded loss or extend
an older resolution. Same-migration pages keep their original sourceComplete/sourceGaps consistency checks.
