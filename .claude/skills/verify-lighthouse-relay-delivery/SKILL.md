---
name: verify-lighthouse-relay-delivery
description: Verify relay intent journaling, external-send uncertainty, receipt acceptance, retries, and restart recovery.
---

# Verify relay delivery

Coordinator notices are message IDs for replies, but never owner words or relay approval. Their admission
boundary is modeled by NoticeInbox and tested through `verify-lighthouse-coordinator-notice`. The delivery
journal begins only after existing owner approval, so ShiftRelay's transitions remain unchanged. See
`lighthouse/verification/cards/README.md` for the supplementary checks and journal-model mapping.

Use this skill whenever changing delivery intent, `relay.sh` invocation, receipt interpretation, outbox draining,
the `_relay_result` board tool or its deduplication. These developer assets must not ship in operator kits.

## Promise and harm

- `DeliveredResultNotSilentlyLost`: delivered words leave accepted board evidence or a retained journal item.
  Losing both leaves the captain unable to reconcile an instruction already sent.
- `SuccessRequiresBoardReceipt`: unqualified success requires the board accepting the matching application receipt.
  HTTP 401/403, 200-with-refusal, missing acknowledgement and transport failures are not acceptance.
- `NoAutomaticResend`: one modeled ticket causes at most one external send attempt.
  Receipt trouble must not send an instruction twice.
- `UnknownStaysVisible`: uncertain external outcomes remain available for manual reconciliation.

## Coverage and synchronization

Last source-sync commit: `b2503008ef0bb953efcbafa64788d2d1fd1050f6`.

Generic-core mapping: explicit owner identity replaces literal-name checks before canonical relay
admission; the compatibility codec preserves historical authors/keys without changing ticket, journal
or typed receipt semantics. Explicit profile/role selection changes installed content and clock settings,
not the external-send boundary. The normal 82-state/317-step graph, both configured broken variants
and the real-code receipt/journal mutants were rerun. Runtime profile tests cover serialization and
authorship independently of the bounded relay model. Record observed results in an external run ledger.

Covered code:

- `lighthouse/operator-kit/scripts/lighthouse-mcp.cjs`: `request`, `relayJournal`, `saveRelayJournal`,
  `updateRelay`, `acceptedRelay`, `recordRelay`, `relayNotice`, `reconcileRelay`, `drain`, `relay`, and `call`.
- `lighthouse/server/toolcalls-relay.js`: `_relay_result` ticket consumption and typed acknowledgement.
- `lighthouse/server/toolcalls-request.js`: `handleCalls` duplicate acknowledgement, legacy acceptance recovery,
  stored call results and removal of acknowledgements from rehearsals.
- `lighthouse/operator-kit/scripts/relay.sh`: firstmate-only external boundary; not a receiver exactly-once guarantee.

The source-sync commit moves forward only after confirming every action and assumption against the changed code.
The Fable shift change centralizes explicit start/end edges and derives lost presence
separately. Lost suppresses automatic overviews, not a captain-authorized relay.
ShiftRelay's explicit start/end actions and receipt/journal boundaries therefore stay
unchanged; tool-receipt presence text and the stdio-only heartbeat do not send or
acknowledge words. Replayed old shift edges now leave the current shift unchanged;
that does not change relay admission or receipt acceptance. The adapter still slices
before the CLI entrypoint, while full MCP fixtures include the new heartbeat helper.
Shell-only shift edges now select the live token file and the shift route refuses
shadow credentials. Normal tool/relay token selection, dry-run admission and receipt
acceptance are unchanged; this adds no ShiftRelay action or state. The real MCP
shadow relay regression, both product mutants and all three formal variants were rerun.
Rerun both real-code mutants and all
three model configurations after changing these shared source files.
Do not merely update the hash because a test passed. Use `/maintain-formal-verification-skill` for stale coverage.

## Suggested-prompt synchronization (November 10, 2026)

Release cleanup removes the retired fleet-steward destination, even when an old config still has
`fleetSteward: true`. Line and tool prompt admission and `board_relay` accept only firstmate; the shell
refuses other destinations before reading words or creating a ledger. Existing home copies are not
armed or invoked by the kit. ShiftRelay already models only `FirstmateReceives`, so its transitions and
all five invariants stay unchanged; its scope note now records that boundary. The advice steward is not
a receiver and its board jobs and `stwake.cjs` are untouched. Run the release-cleanup destination tests,
the real-code journal mutations and all three model configurations to verify this narrower admission.

Reviewed origin/master 7ed752ec29df414220096ca255258ffdd479925c plus this prompt lifecycle change.
prompt-transitions.js owns approval and final states; board_relay issues tickets only for approved
prompts, and \_relay_result consults the same owner before consuming a delivered ticket. A superseded
source refuses its pending receipt. Today's kit already retains a refused receipt in its journal,
so no kit change or reconnect is needed. Authorization already issued cannot recall an external send.

ShiftRelay adds PromptSuperseded and sourceCurrent. Board acceptance and lost-response acceptance
require a current source; SupersededSourceNotRecorded must hold. This abstraction invalidates before
acceptance, not after a previously recorded result. Receipt refusal still preserves delivered evidence.
The companion cards/PromptLife.tla models the board decision and ask gates in greater detail; run it
with /statechart, PromptLife.cfg and prompt-view.mjs, including its final-approval.cfg mutant.
For ordinary line receipts, PromptLife also checks LineReceiptMatchesSource: the latest human
message must be the matching prompt-send instruction. A later separate instruction cannot credit
an unrelated approval. Run unrelated-line.cfg and the real HTTP source pair plus its product
mutation; reproduce counts with the card checks. Credit requires Send to remain the card's latest
human message when RELAYED arrives. Any later human message leaves the prompt awaiting delivery,
then superseded at close, even if delivered: the board under-reports rather than over-reports.
Use the card checks below for current results and the exact external-send boundary.

Prompt retries revalidate non-Send authority or words for each ticket, including after definite
non-delivery. A repeat keeps the original approval and decision time; its explicit ticket may
update relayedAt without settling newer asks. A first receipt settles only the prompt's own
ask, not the captain's follow-through ACTION ask. Run cards/PromptRetry.tla through /statechart
with PromptRetry.cfg, retry-view.mjs and its four mutant configs as described by the card skill.
After failed non-Send delivery, a new checked basis replaces old approval provenance, but only
before first delivery. Recovery guidance offers fresh words or a replacement, not disabled Send.
check.cjs includes prompt-compatibility.test.js before the unchanged journal adapter checks.

## Run the real-code checks

Registry archive keeps the model's existing receipt acceptance transition available for preserved tickets.
Only a direct, non-queued, non-dry-run result from the ticket's board and caller is admitted; no shift is touched.
This ingress policy is tested in registry-notices.test.js, not represented as an extra journal-model variable.
Its settlement regression fails for blanket archive refusal and for shift-touching settlement mutants in the
enrollment mutation runner. Both successful delivery and definite non-delivery replay their matching receipts.
Run these boundary checks alongside the unchanged receipt/journal model:

    node --test lighthouse/server/tests/registry-notices.test.js
    node lighthouse/verification/enrollment/mutations.cjs

From the repository root:

```sh
node lighthouse/verification/relay/check.cjs
```

This runs the real adapter in the scout's VM boundary replay, real scratch HTTP response-loss handling,
and two scratch-only product-code mutants. It removes `TYPESAFE_API_KEY` from every spawned environment.
Deletion after refusal must fail `DeliveredResultNotSilentlyLost`; accepting non-5xx HTTP responses must fail
`SuccessRequiresBoardReceipt`. The original source must pass again afterward; no checkout file is mutated.

Also run `bash lighthouse/test-all.sh`. It removes the paid-service key before any scratch server starts.
On a CRLF checkout, use a scratch exported copy and normalize its `.sh` files to LF before running under WSL.
Do not run against an installed operator home, the live board, its store or port 7700.

## Model-check with /statechart

Read `/statechart` and use its current launcher and options; do not substitute a hand-drawn happy path.
Copy `lighthouse/verification/relay/` into scratch and use a fresh output directory for every run.
Check `ShiftRelay.tla` with `ShiftRelay.cfg` and `view.mjs`. Read every result with `/statechart`.
The passing report must list all four invariants and `NoDeadlock`, without unverified rules or exploration limits.

Then use `delete-receipt.cfg` and `false-success.cfg` in separate fresh outputs. Nonzero exit is expected:
each must produce its named invariant violation. Both counterexamples authorize words, save a sending marker,
deliver externally, save the result, and receive a refused receipt; the sixth step deletes evidence or lies.
Read the shortest paths, not only TLC's exit status. Preserve the passing chart with the proof when updating it.

## Bounds and modeling discipline

Seed: scout `ShiftRelay`, source `5cd7cf3`, originally 14 states with both receipt rules broken. The updated model
has one ticket, one target, two shift values, durable journal transitions, delivery/no-delivery uncertainty,
definite pre-send refusal, retryable/permanent receipt refusal, captain-approved local closure, outages,
response loss after board acceptance and duplicate receipt recovery. The model's `refused` phase represents
`blocked` plus `receipt_refused` in code. It has no fairness
assumptions or eventual-delivery claim. A persisted sending marker and external delivery are separate actions.

`NoAutomaticResend` and `UnknownStaysVisible` are structural checks implied by the send guard and journal
transitions, not independent mutation-proven results. The two receipt rules have real-code and model mutants.
The model covers one ticket only; local reconciliation retains evidence, does not mean board acceptance,
and never sends. A later explicitly authorized ticket is outside the model, not an automatic resend claim.
Captain closure abstracts the code's 70-second recent-unknown grace period; elapsed time is not modeled.

The model assumes atomic completed journal replacement and board save; it does not prove power-loss fsync
durability, receiver behavior, arbitrary filesystem damage, cross-machine delivery, or lock crash recovery.
Concurrency and malformed journal guards are exercised against actual code, not claimed as TLA+ coverage.
The chart coalesces shift-only and duplicate/stuttering steps; the generated report counts those hidden steps.

For a failure, replay its steps against `adapter.cjs` and the adapter tests. Until the code reproduces it,
suspect a modeling error. If it reproduces, fix the product or report the finding; never weaken the invariant
to obtain green. An intended state change needs matching model, replay and mutation updates before source sync.
Run `lighthouse/verification/relay/check.cjs` and inspect the generated `chart.mmd` for the observed run.
