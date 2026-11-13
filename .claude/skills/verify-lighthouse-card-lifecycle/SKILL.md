---
name: verify-lighthouse-card-lifecycle
description: Verify card transitions and explicit task completion when changing board tools, legacy writes, line events, CRM, captain settlement or afterDone conduct.
---

# Verify the card lifecycle

## Setup and management preservation check (A5)

Reviewed base 743a5ba86eb748bf390a7ccce28d598d111d595b plus A5: administration changes registry membership,
not card/prompt transitions. The new three-board upgrade rehearsal compares every saved card/comment field
through profile application, schema-2 migration, staged deploy and legacy kit update; no card is recreated.
CardLife, PromptLife and PromptRetry normal/broken/restored statechart runs retain their existing bounds:
180/658, 94/219 and 65/129 states/steps normally. Scratch CardLife prose-completion and CRM-close variants
break their intended rules in three and two steps respectively; restored CardLife holds all three invariants
and NoDeadlock. cards/check.cjs --mutate caught all six real card/prompt guard mutations. The existing
unresolved-ask, CRM acceptance and explicit completion semantics remain unchanged. See
the management checks below for commands and rehearsal limitations; record observations externally.

Coordinator notices add a separate message source, never an owner approval or ask settlement. Also run
`verify-lighthouse-coordinator-notice`: its NoticeInbox model and real mutations cover this admission boundary.
The existing CardLife, PromptLife and PromptRetry state rules stay unchanged. The line relay's newest human
source explicitly excludes coordinator messages; replies may answer notices without settling owner asks.
See `lighthouse/verification/cards/README.md` for executable checks and their limits.

Promises: a closed card has no unresolved ask, including the older needsAction flag;
a staff answer cannot close its card before CRM acceptance;
only an explicit task-completion event before an ask can raise authoritative afterDone.
Breaking these marks work finished while a decision is owed, or wrongly treats a step
report as completion of the whole task.

## Coverage and source sync

Last source-sync commit: 3a98465b64feb32c690a7cd0634c89d451876f61.

Generic-core mapping: configuration.js centralizes the stable owner predicate; compatibility.js
decodes configured historical keys/authors at admission and encodes them at persistence/API boundaries.
The canonical card/prompt transition rules, unresolved-ask guard and CRM receipt gate do not change.
crm.js requires an explicitly configured destination; configured business time changes digest admission,
not completion evidence. generic-config.test.js and profile-runtime.test.js cover neutral defaults,
owner display versus authority, historical authors/keys/archives and profile parity. The normal card,
prompt and retry graphs, all configured mutants, both scratch CardLife mutants and real-code mutation
replays were rerun. Bounds and exclusions below still apply; the codec is tested, not modeled as JSON.
Record the complete evidence matrix in an external run ledger.

- lighthouse/server/card-transitions.js: crmCloseReason, validate, open, move, ask, settle, close, reopen, legacyWrite.
- lighthouse/server/prompt-transitions.js: the prompt state owner, approval provenance, final refusal,
  ask-linked supersession, legacy mapping and shared tool/line relay gates.
- lighthouse/server/toolcalls-tools.js: board_open, board_post, board_ask, board_withdraw,
  board_reply and board_close.
- lighthouse/server/toolcalls-relay.js: prompt asks, replacement and relay settlement.
- lighthouse/server/routes-cards.js: legacy PUT/PATCH and captain resolve.
- lighthouse/server/routes-messages.js: prompt decisions.
- lighthouse/server/events.js: applyEvent, line states, asks, settlement, TASK_FINISHED and CRM replies.
- lighthouse/server/crm.js: crmDeliver, crmSend, replyAccepted, replyFailed and crmFlush;
  lighthouse/server/crm-state.js: legacy questionState; lighthouse/server/store.js: load normalization;
  lighthouse/server/notes.js: boardNote and flushNotes.
- lighthouse/board/app/cards.js: delivery badges on cards and both panel layouts.
- lighthouse/server/grammar.js and toolcalls.js: shared states, openAsks and laneFollows.
- lighthouse/server/conduct.js: conductOf, asksAfter and separately uncertain prose hints.

Compare changes since the sync base in these files before trusting the verification.
Move the sync commit forward only after reviewing the mapping and rerunning both checks.

Prompt-lifecycle synchronization (November 10, 2026): reviewed the adapters on origin/master
7ed752ec29df414220096ca255258ffdd479925c plus this change. Prompt decisions use the prompt
rule-keeper before the existing card transitions. Settling a linked ask supersedes offered or
approved prompts, except the same prompt's Send/relay settlement. Closing supersedes approvals
whose asks were already settled by Send. Final refusals do not change the card or prompt.
Rechecked after merging origin/master 7e028ba: deferred CRM acceptance closes through
the prompt owner only after the CRM delivery guard passes. crm-delivery.test.js includes
the accepted-close/undelivered-Send integration replay, failing before that adapter change.
Rechecked after merging origin/master 159bc30: prompt and shift owners remain independent.
The explicit line-finish replay also guards an approved prompt whose Send already settled its ask.

Also run /statechart on cards/PromptLife.tla with PromptLife.cfg and prompt-view.mjs in fresh
external scratch. The companion model adds Send, yolo, his word, standing authority, both receipt
modes, replacement, withdrawal and closing. FinalIsFinal, RelayNeedsApproval,
ClosedCardHasNoActivePrompt, OfferedPromptHasOpenAsk and LineReceiptMatchesSource must hold. The deliberate
final-approval.cfg variant must fail FinalIsFinal on No then approval. Replay that path with
prompt-lifecycle.test.js; it failed against the unchanged origin/master baseline before the fix.
Reproduce counts, limits and evidence with the checks in lighthouse/verification/cards/README.md.
Ordinary line delivery credits only a matching latest human prompt-send source, not an unrelated
approval. Run unrelated-line.cfg: Send, later separate words and a wrong receipt must violate
LineReceiptMatchesSource. The clean model reaches 94 states/219 steps; the mutant reaches 98/227.
The HTTP pair in prompt-compatibility.test.js must pass, and removing the source match in scratch
must fail the unrelated-approval assertion. Credit requires Send to remain the card's latest human
message when RELAYED arrives. Any later human message leaves the prompt awaiting delivery, then
superseded at close, even if delivered: the board under-reports rather than over-reports.

Also run /statechart on PromptRetry.tla with PromptRetry.cfg and retry-view.mjs. It covers
failed delivery, revoked authority or expired/overtaken words, an explicitly requested repeat,
and a follow-through ACTION ask. Failed first delivery can obtain a new word/authority basis;
ticket issue refreshes non-Send provenance only before delivery. TicketRevalidates,
RepeatKeepsApproval, FollowThroughStaysCaptains and TicketRecordsCheckedBasis must hold.
The stale-ticket.cfg, repeat-approval.cfg, follow-through.cfg and stale-provenance.cfg variants
must each fail their corresponding invariant. Refusal stutters only for an ended basis or the
delivery bound; NoDeadlock does not prove eventual recovery. Replay all mutant paths with
prompt-compatibility.test.js, included in check.cjs. PromptLife's ask is the prompt's own ask,
not the follow-through ACTION ask; Send alone settles the latter. Ordinary line relays of the
captain's other words must not be blocked by an offered or declined suggestion. Legacy load
preserves decisions and never invents a delivery or supersession timestamp.

## Run and interpret

1. From the repository root run:
   node lighthouse/verification/cards/check.cjs --mutate
2. Read /statechart by name and use its installed launcher to check
   lighthouse/verification/cards/CardLife.tla with CardLife.cfg and view.mjs.
   Use a new output directory outside the repository. Read every invariant result
   with /statechart; use its shortest counterexample rather than guessing from a chart.
3. Run bash lighthouse/test-all.sh for the covering line/tool/CRM scenarios and size rules.
   In a CRLF checkout, normalize shell-script copies to LF before running them in WSL.

The real-code command uses Node 24. The observed model run used TLC 2.19, managed by
/statechart. The current graph checks ClosedCardsHaveNoOpenAsks,
OnlyTaskCompletionTriggersAfterDone, ClosedStaffCardsHaveDelivery and NoDeadlock.
The CRM projection includes asked, working, sending, failed and accepted, with
acceptance separate from guarded card closure. No arrows are manually suppressed.
The observed TLC 2.19 run reaches 180 states and 658 steps; chart.mmd projects
28 states and 73 arrows, hiding 83 same-label steps automatically. Removing the CRM
guard in scratch violates ClosedStaffCardsHaveDelivery in two steps: staff asks, close.

The mutation exercise copies the server and isolated test harness to its own OS temporary directory, removes
the actual unresolved-ask guard, and runs the same HTTP replay. It must observe the
test failing with actual HTTP 200 versus expected 409. After restoring that guard,
it replaces explicit completion detection with the old prose heuristic. The completed
preflight HTTP regression must fail with afterDone 1 versus expected 0. It also unanchors
the legacy phrase matcher: the retained relay regression must reject the resulting hint.
A separate explicit line-close mutation bypasses the prompt owner and must leave an approved prompt
where the normal replay expects superseded. The clean source passes the same test.
It removes its copy; run the command without --mutate once more to confirm the real source still passes.
It never edits the real source or runs a live home. Fixtures remove TYPESAFE_API_KEY,
bind loopback and exclude port 7700. Never run a test server with that key present.

Original counterexample: post work, open a card, ask a question, then authorized legacy
PATCH status=done. At 5cd7cf3 this left a closed card with an unanswered ask; the normal
ClosedCardsHaveNoOpenAsks HTTP regression failed before the fix. A tools-mode token
still gets 403 on legacy writes: this was a validation defect, not an auth bypass.

The normal scout regression lives in lighthouse/server/tests/known-cards.test.js, with no TODO or duplicate replay.
The second counterexample is open card, post Completed preflight; implementation still
pending., then ask about the remaining work. At 475f66b the new normal
OnlyTaskCompletionTriggersAfterDone HTTP regression reports afterDone 1 rather than 0.
The completion-event parity test also fails there (zero events rather than one).

## Bounds and updating

The TLA model covers one task, one ask, hold, reply/settlement, withdrawal and four
closure adapters. Generated sequences exercise the real module to depth six, with
two ask identities and legal/illegal replacement and closure attempts. Real HTTP
tests cover the replay, PUT retention, captain settlement, line closure, CRM replies
and privacy-safe legacy write counts. See lighthouse/verification/cards/README.md.
TASK_FINISHED settles all asks and closes atomically; a bare STATUS done cannot
close over real asks. Bare-Waiting placeholders still settle on leaving Waiting.

ReportsIntermediateStep sets proseMarker but no completionEvent; at the next ask the
prose marker feeds only hint, not alarm. Successful close records both
taskFinished and completionEvent, matching close's returned metadata and its adapters'
log entry. LegacyReopens keeps that evidence. AsksCaptain sets alarm from completionEvent.
The invariant alarm => taskFinished allows a real completion/reopen/ask alarm. Real HTTP
tests cover event emission by tools, line events, legacy PUT/PATCH and CRM, plus no event
on refusal. Every existing phrase regression and 210 generated step reports still run.
PROMPT state=done is superseded by its own prompt ask, so it records no completion event.

To test the model's completion invariant, copy CardLife.tla, CardLife.cfg and view.mjs
to scratch. Change AsksCaptain's alarm assignment to proseMarker OR completionEvent.
Use /statechart to run that copy. It must reject OnlyTaskCompletionTriggersAfterDone
on staff question, preflight report, ask (three steps); the other two rules still hold.
Then run the untouched repository model again: all four rules must hold. This was
observed with TLC 2.19, not inferred solely from the real-code mutation.

Old prose is only hints.afterDone with certainty uncertain, never signals.afterDone or
examples.afterDone. Historical prose is not backfilled as completion. The hint is an API
migration aid, not a new page warning. Tool schemas and descriptions stay unchanged;
going live needs a board deploy only, not a kit update or /mcp reconnect.

Excluded: arbitrary JSON/prose, concurrent boards, CRM internals, abrupt storage
failure and liveness. NoDeadlock includes closed stuttering, not eventual progress.
The model's completion evidence is one boolean; the real conduct scan uses the retained
card log, existing time window and standing-card/completion-notification exemptions.
LegacyReopens models retained-log legacy reopening, not all line paths. Legacy PUT can
replace the log and remove evidence; these history-loss variants are outside this model.

If a model path does not replay, first suspect the model or mapping. Do not weaken
an invariant to get green. When intended behavior changes, update the model and real
tests together, repeat both broken-variant exercises and review the source mapping before
advancing the sync commit. Use /maintain-formal-verification-skill for later upkeep.

Developer verification only: do not ship this skill or its assets in operator kits.

## CRM delivery replay

Reopen synchronization (November 10, 2026): crmSend, replyFailed and legacy questionState all call the
card module's reopen rule. Only Done becomes Inflight; closedAt is removed, while open lanes, unresolved asks
and retained completion evidence stay intact. It deliberately does not apply closure validation to older
cards with missing decision arrays. CardLife's ReopenedCard rule maps those three adapters and LegacyReopens.
The normal graph remains 180 states/658 steps; all three invariants and NoDeadlock hold. The broken
completion and delivery variants still fail, and the normal model passes again in fresh scratch.
Generated checks now include reopen: 1,025 source states and 13,325 attempted transitions at depth six.
check.cjs --mutate passes 130 tests and catches all six real-code mutations. The direct CRM replay checks
each retained lane, a legacy card without decisions, and that questionState invokes the shared rule.

The legacy PUT/PATCH adapter checks attachment references before counters or lifecycle mutation.
resource-access.test.js refuses cross-board references with unchanged state and retained download denial,
while the uploader's own valid references still publish. Both cases fail if that guard is removed.
Authorization is an admission check outside CardLife's transition model; it does not change that model.
After merging the release-cleanup annotations, the 130 real-code checks, all six mutations and the normal
180-state/658-step model pass again.

crm-delivery.test.js retains the audit's premature-close and silent-drop faults as
normal node:test cases: both line and tool replies remain open through a 500, then
close only on acceptance. Saved retry 59 reaches give-up 60 without losing the card,
operator note or conduct count; the third 422 refusal does the same. It also checks
legacy loading, equal-timestamp ACTION routing, duplicate acceptance, needs_owner,
explicit open lanes and manual/legacy closure guards. The CRM receives exactly its
existing reply fields and retries keep their ID. The page's VM test checks badges.
Review regressions retain closability of delivered legacy answers in open lanes,
single needs_owner escalation, actionable line-close refusals and pending finish intent.
Retrying notices never request another answer; superseded failures do not request one either.
Legacy pending replies without a closure flag infer it from the saved lane before
normalization: held and inflight stay open after acceptance, while done reopens until
acceptance and then closes again. Real loader regressions cover each case.

On origin/master 7ed752e, the original four delivery regressions failed: tool receipt
said closed, line card was done, and both terminal-failure conduct counts were absent.
They passed after the change. check.cjs --mutate also removes the delivery close guard
in a scratch server and must fail the manual-close regression.

For the corresponding model mutation, copy CardLife.tla and remove the staff condition
from CanClose and LineCloses. Run that scratch copy with /statechart: it must reject
ClosedStaffCardsHaveDelivery after a staff question and premature close. Run the original
model again in a fresh output folder. Failure notes, retry budgets and HTTP bodies are
tested in real code, not abstracted as independent model variables.
