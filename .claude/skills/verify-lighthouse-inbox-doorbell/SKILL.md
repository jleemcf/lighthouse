---
name: verify-lighthouse-inbox-doorbell
description: >-
  Verify inbox wake revisions, durable retry obligations, coalescing, acknowledgments and startup recovery.
  Use when changing doorbells, their store hooks, persistence or failure visibility.
---

# Verify Lighthouse inbox doorbells

Coordinator notices use the existing comment change hook, so a committed notice on an inbox card rings the
same revision obligation. No new delivery/acknowledgment state is added. Also run the supplementary
`verify-lighthouse-coordinator-notice` skill for identity isolation and the operator's watcher/gate wake.
Its executable checks and model mapping are described in `lighthouse/verification/cards/README.md`.

## Promise and harm

A configured inbox's latest committed update stays saved and scheduled for delivery until HTTP 2xx acknowledges
that revision. Losing the obligation can leave the chief of staff asleep indefinitely after one failed wake.
Retries, startup and coalescing must never invent a card revision, and an older response must not acknowledge a
newer update. Delivery is at least once, not exactly once. The receiver is unchanged.

## Run this skill

1. Read the covered code and the model mapping below. If the code changed since the source-sync commit, confirm
   or repair the mapping before interpreting a pass.
2. Run `node lighthouse/verification/doorbell/verify.cjs` from the repository root. It removes the paid-service
   key from child environments, runs real-code regressions and checks three broken copies in disposable scratch
   directories. A successful command must report all real-code tests passing and all three mutations caught.
3. Read and invoke `/statechart` by name. Copy the model, configs and `view.mjs` from
   `lighthouse/verification/doorbell/` to a fresh scratch directory outside every repository. Check
   `InboxDoorbell.tla` with `InboxDoorbell.cfg`, using `view.mjs` and a new output directory. Read its report with
   `/statechart`; every named invariant and NoDeadlock must hold, with no unchecked rules or reached limit.
4. Use `/statechart` on the same model with `LostWake.cfg`, `InventedRevision.cfg` and
   `StaleAcknowledgment.cfg`, each with a new output directory. Each must fail its corresponding rule in the
   recorded short path; the other rules must still be checked. Do not edit the passing model to excuse a failure.
5. Run `bash lighthouse/test-all.sh`. Rebuild a changed page from its board sources using
   `python lighthouse/server/make-page.py`; never edit the generated page. Never start a test server with
   `TYPESAFE_API_KEY` set. All receivers and boards used here are scratch loopback fixtures.

The statechart launcher owns TLC installation and invocation; do not embed its path or command in repository
scripts. The checked run used TLC 1.7.4, Node 24.20.0 for the launcher, and Node 24.15.0 for the real-code tests.
The Node replay normally takes a few seconds; all four finite checks together take roughly fifteen seconds.

## Coverage and source sync

Release cleanup changes only explanations in the delivery implementation. The real-code mutation
fixture now preserves the server/tests and sibling tests/sandbox.cjs layout and copies store.js with
its card/prompt transition dependencies. A missing dependency is not an invariant counterexample:
each broken copy must reach its named assertion. The existing three mutations are unchanged.

Last confirmed source-sync commit: `3a98465b64feb32c690a7cd0634c89d451876f61`.

Generic-core mapping: store.js now uses the configured historical codec at load/save, while in-memory
revision counters, saved obligations and HTTP acknowledgment transitions stay canonical and unchanged.
The stable owner helper replaces literal identity checks; display names grant no authority. Board discovery
uses configured presentation and existing authorization, not a fixed projection. Config/codec runtime tests
cover those boundaries; the normal 48-state/139-step doorbell graph and all three broken variants
were rerun, as were the real-code mutation replays. The codec is not a new retry state or a delivery proof.
Record observed results outside the public tree; the existing bounds and at-least-once caveats remain.
The investigation seed was the inbox model and the sole-503 replay on `5cd7cf3`.
The generic-core replay initially exposed harness drift, not a doorbell invariant failure:
its scratch copy omitted the new compatibility codec and the CRM load dependency. verify.cjs
now copies both and selects TAP explicitly so each mutant must reach its named assertion.

- `CaptainWrites`: `lighthouse/server/store.js`, `wakeCard`, committed `pushLog`, comment/bundle `change` hooks.
- Durable revision and obligation: `lighthouse/server/doorbells.js`, `ringCard`; `store.js`, `saveNow`.
- `SendLatest`: `doorbells.js`, `schedule` and `deliver`; persist before the HTTP request.
- `Http2xx`: `doorbells.js`, `finish(true)` acknowledges the sent snapshot and schedules newer work.
- `ReceiverFailsOrTimesOut`, `ResponseLost`: `finish(false)`, response/error handlers and the total deadline.
- `Crash`, `Startup`: `store.json`, `makeDoorbells` startup scheduling and server shutdown cleanup.
- Visibility and privacy: `routes.js`, `board/server-layer.js`, `board/app/render.js` and real-code tests.

`CaptainWrites` abstracts a real wake-worthy mutation plus its successful store save as one commit. The code
assigns the revision in the actual store hook and saves the card and wake together before any outbound request.
Rehearsal copies do not invoke the committed-card hook. Multiple mutations before a save can skip intermediate
delivered revisions; they do not create a retry revision. `queued` abstracts a timer or request for outstanding
work, and `sent` is the immutable snapshot taken by `deliver`. Timers are abstracted as enabled sends, not numbers.

Move the sync commit forward only after checking these correspondences, rerunning the skill, and reviewing the
current behavior diff. Use `/maintain-formal-verification-skill` when a change has drifted without rechecking.

## Bounds and interpretation

One configured card and receiver, zero to two committed revisions, one in-flight request, and at most one
crash/startup pair. Failures and retries can cycle; the state graph is finite. The three rule names are
`NoSilentLostWake`, `CoalescingNeverInventsUpdates`, and `AcknowledgmentIsForSentRevision`. NoDeadlock includes
explicit waiting stutters; it is not a liveness claim. Eventual success requires a receiver eventually accepting
requests and a running board whose timers execute.

The model does not verify JavaScript execution, filesystem power-loss durability, real-time backoff bounds,
multiple receivers, authorization, UI layout, or the T3 receiver's internal effects. The real-code tests cover
timeouts, bounded backoff, saved-state restart, nonblocking writes, privacy and an idempotent stand-in receiver.
An HTTP 2xx is transport acceptance, not evidence that an agent read the card. Lost responses can repeat the
same `(board, card, revision)` identity; only the receiver can de-duplicate its work.

If a model counterexample cannot be replayed, investigate the model/code mapping before calling it a product
bug. If a real-code mutation unexpectedly passes, the verification is incomplete: fix the test, not the mutation.
Never ship this skill or these assets into operator kits.

## Recorded evidence

Record state counts, shortest broken paths and real-code mutation results in an external run ledger. The
anchors, and the original red-to-green replay. `chart.mmd` is the generated passing design chart; regenerate it
through `/statechart` when the modeled behavior changes.
