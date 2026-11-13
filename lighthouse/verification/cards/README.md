# Card lifecycle verification

Promises: a closed card has no unresolved ask, including the older needsAction flag;
staff answers require CRM acceptance before card closure;
an authoritative afterDone alarm requires an explicit task-completion event before
the ask. Otherwise work looks finished while a decision is owed, or an ordinary
step report wrongly accuses the operator of extending a finished task.

Run from the repository root:

```sh
node lighthouse/verification/cards/check.cjs --mutate
```

The check runs real scratch-board HTTP replays, every existing phrase regression,
210 generated status-text cases and generated transitions. In a temporary server copy
it removes the unresolved-ask guard (HTTP 200 versus expected 409), then restores it
and replaces explicit completion detection with the old prose heuristic (afterDone 1
versus expected 0). It also unanchors the legacy phrase matcher; the retained relay
phrase must then fail as a spurious hint. No live store, operator home or paid service is used;
the fixture chooses a loopback port other than 7700 and removes TYPESAFE_API_KEY.

## Model and coverage

Use /statechart by name to run CardLife.tla with CardLife.cfg and view.mjs in a fresh
scratch output directory and interpret every result. Do not run TLC directly in the
repository. The saved chart is chart.mmd. TLC 2.19 checks the finite state graph;
Node 24 runs the real-code checks. The launcher manages Java and TLC.

The model has one task and one unresolved ask, explicit tool/legacy/line/CRM close
actions, settlement by either party, withdrawal, hold, legacy reopening and closed stuttering.
Tool, legacy and CRM closure use CanClose, matching validate in card-transitions.js.
Line TASK_FINISHED explicitly settles all asks and clears needsAction before closing;
the synchronous line handler models this as one atomic action. A bare STATUS state=done
cannot close over a real ask, replacing the old red-in-Done behavior from ruling 55.
The board's own bare-Waiting placeholder still settles when leaving Waiting.
The shared module also owns opening, lane moves, opening asks and settlement.
Adapters retain identity, message and wire-format concerns. Required tool outcome
text remains a tool contract; legacy bodies retain their existing wire format.

ReportsIntermediateStep sets proseMarker without recording completionEvent; at the next
ask it feeds only the uncertain hint, not alarm.
Successful closure sets both taskFinished and completionEvent; LegacyReopens preserves
that log evidence. The chart's alarm persists through later lane changes, like a finding
in the retained log; reopening alone adds no alarm. AsksCaptain raises alarm only from
completionEvent. The invariant
alarm => taskFinished allows a real completion/reopen/ask alarm, while rejecting the
scout's unfinished-preflight path. HTTP replays check that the adapters actually emit
the event, rather than trusting only this model. TLC also checks
ClosedStaffCardsHaveDelivery: asked, working, sending and failed staff questions cannot
close through any adapter. CRM acceptance and guarded closure are separate actions;
a follow-up returns a closed card to an open lane while its answer travels.
All three invariants and NoDeadlock hold, with no manually suppressed arrows.
The observed TLC 2.19 run reaches 180 states and 658 steps. The saved projection has
28 states and 73 arrows, with 83 same-label steps hidden automatically. The CRM guard
mutation fails in two steps: staff asks, premature close.

A scratch model variant sets alarm from proseMarker OR completionEvent. TLC rejects
OnlyTaskCompletionTriggersAfterDone on the shortest three-step path: staff asks a question,
report preflight complete, ask about the remaining work. The ordinary post/open path also fails.
Closure and NoDeadlock still hold. The normal model passes again after this exercise.

Reopen and adapter source-sync: `b0b5230974e79fbe18d2acd0bfd441fb74073c2b` (November 10, 2026).
CRM sending, terminal/retry failure and legacy question-state normalization use the shared
card-transitions.reopen rule. Done alone becomes Inflight and loses closedAt; open lanes,
unresolved asks and completion evidence survive. Older cards need not have decision arrays.
ReopenedCard in the model names that same rule. The refreshed normal graph is unchanged
at 180 states/658 steps, all invariants hold, both documented broken variants still fail,
and the untouched model passes again. check.cjs --mutate passes 130 tests and catches
all six real-code mutations; generated actions include reopen, reaching 1,025 source
states and 13,325 attempted transitions.

The legacy card PUT/PATCH adapter also refuses unreadable attachment references before any mutation.
The disjoint-board resource-access.test.js cases fail with HTTP 200 instead of 403 if the guard is removed;
with it, both leave the entire state unchanged and preserve download denial. The uploader's valid references
still publish. This authorization admission check is outside CardLife's state-transition bounds.
The normal model and all 130 real-code checks plus six mutations pass again after the master merge.

Generated checks execute the real module to depth six with two ask identities,
repeated asks, hold, settlement, withdrawal, legacy PATCH/PUT and discarded asks.
They assert both closure safety and nonmutation on refusal. HTTP tests cover tool
authorization, the captain's settlement, line TASK_FINISHED, CRM reply closure and
legacy write counters. Existing line/tool/CRM scenarios remain in test-all.sh.
Legacy pending-reply regressions also load held, inflight and previously done cards
through a refusal and acceptance. Missing closure intent is inferred before reopening:
open lanes stay open, and previously done cards close only after delivery. These persisted
record cases exercise the real loader; the model separates acceptance from closure.

This is not a proof of arbitrary prose, concurrent boards, persistence after a crash,
external relay delivery, all possible legacy JSON or eventual progress. Statechart's
NoDeadlock includes terminal stuttering and does not establish fairness or liveness.
The model uses one boolean for retained completion evidence, not unbounded log history.
The implementation checks only the retained card log and the existing conduct window;
standing-card and completion-notification exemptions remain unchanged.
LegacyReopens represents retained-log legacy reopening, not every line reopening path.
Legacy PUT may replace the log and remove completion evidence; that suppresses an alarm
rather than inventing one. These history variants are outside the model's boolean history.

## Explicit completion and migration

Successful board_close, line TASK_FINISHED, explicit line state=done, legacy PUT/PATCH
status=done, and CRM auto-closure add event: task_finished to their existing card log
entry (or a new FYI entry where there was none). Refused closure never emits completion.
PROMPT state=done immediately opens a prompt ask, so it records no completion event.
The shared close result supplies this metadata; no caller infers it from outcome text.
The synchronous adapters persist the lane change and event together. The tool schema,
descriptions and outcome requirement are unchanged.

conductOf derives signals.afterDone and examples.afterDone only from that event. Old
logs and ambiguous prose such as Completed preflight may appear under
hints.afterDone = {certainty: uncertain, count, examples}, outside authoritative signals
and examples. They do not drive the existing conduct alarm or conductwatch. This is an
API migration hint, not a new page warning. Historical text is not backfilled as fact.

## Legacy write audit

Authorized PUT/PATCH attempts increment boards[board].legacyCardWrites.PUT or PATCH,
including refused transitions. Read these persisted counters through an authorized
GET /api/state. No card id, task text, token or person name is included in the counters.
Unauthorized attempts do not increment them. Successful writes keep one change-feed
event; refusals emit a board change so their count is persisted too. The route stays
supported until a later audit confirms no active writers.

Known UI limit: if a legacy writer sets needsAction after all real decisions have
already settled, the page hides that flag behind the resolved decision history.
Closure is correctly refused; the legacy writer must clear needsAction, or the
captain can settle through POST /api/cards/<id>/resolve with an empty body.
Showing that residual legacy obligation is a separate page follow-up.

## Regression evidence

On unchanged source 5cd7cf3, the scout replay converted to a normal regression fails:
authorized PATCH status=done returns 200 instead of 409 and leaves the ask unresolved.
The parallel PUT/discard regression fails the same way. With the shared guard both pass.
The scratch broken-guard exercise reproduces the HTTP failure and deletes only its own
temporary copy. Rerun the normal check afterwards to confirm the real source still passes.

On unchanged PR-2/master source 475f66b, the new completed-preflight HTTP regression
fails with afterDone 1 versus expected 0; the completion-event parity regression also
fails because there is no event (0 versus expected 1). The same tests pass after the
explicit event change. The prose-heuristic mutation reproduces the false alarm.
The scout's known-cards.test.js assertion also fails on unchanged test-baseline master
22dee3b with strict known-failure mode (1 versus 0). It is now a normal regression,
with uncertain-hint checks retained there instead of a duplicate preflight replay.

Deployment changes only the board server. No operator-kit update or /mcp reconnect is
needed because no tool schema, descriptions or wire contract changed.

## Suggested prompt lifecycle

PromptLife.tla complements CardLife: one prompt, one ask, one card and one ticket, with
four approval bases and tool/line delivery. Both adapters call prompt-transitions.js.
Send settles the ask but means approved, not relayed. Other settlements supersede the prompt.
Run the companion passing configuration and its final-approval.cfg mutant through /statechart.
PromptLife also distinguishes the latest captain Send instruction from later separate words.
LineReceiptMatchesSource guards ordinary receipts; unrelated-line.cfg must fail on Send, later
words, then a wrongly credited receipt. The HTTP source pair and product mutation replay this path.
Run the executable checks above to reproduce the faults and verify the model boundaries.

PromptRetry.tla separately bounds the already-approved prompt through first delivery and one
explicit repeat. Authority/word expiry, delivery failure and a follow-through ACTION ask are
represented. Its passing configuration and stale-ticket.cfg, repeat-approval.cfg and
follow-through.cfg variants map to normal HTTP regressions in prompt-compatibility.test.js.
A fresh basis after failed delivery must replace non-Send provenance; stale-provenance.cfg
breaks TicketRecordsCheckedBasis when it does not. NoDeadlock is structural, not a recovery guarantee.
retry-chart.mmd is generated from the passing run, not a hand-drawn protocol.
The explicit line-finish HTTP replay starts with an approved, undelivered Send. A scratch
events.js mutation that bypasses the prompt owner leaves it approved instead of superseded
and fails that replay; check.cjs --mutate includes this fifth product-code mutation.

## CRM delivery proof

The audit's four retained failure assertions failed on origin/master 7ed752e before
the delivery change: both operator protocols closed at reply time, and transient
give-up/permanent refusal had no failed conduct count. crm-delivery.test.js now covers
those paths, operator BOARD notes, state-based ACTION routing at coincident times,
legacy normalization, idempotent retry acceptance, needs_owner and explicit open lanes.
It also checks delivered legacy answers left open, repeated ACTIONs, line-close feedback
and deferred explicit finish intent. Retry notices do not invite duplicate answers,
including when a superseded delivery gives up.
Terminal tests seed attempt 59 or 2 and observe the actual final HTTP failure and removal
from the outbox; they do not wait an hour for sixty polls.

The real-code mutation removes only the delivery close guard and must reject a manual
board_close before acceptance. A scratch TLA mutation removes the staff guard from
CanClose and LineCloses and must violate ClosedStaffCardsHaveDelivery after the staff
question and premature close. Run the untouched model again in a new /statechart
output directory afterward.

The model abstracts the CRM response as accepted or refused. HTTP retry limits, notices,
conduct counts, store reloads and exact CRM body fields are real-code replay checks;
CRM implementation, delivery fairness and arbitrary network histories remain excluded.
