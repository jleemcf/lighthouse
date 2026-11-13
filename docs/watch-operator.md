# Watch operator

The watch is a separate operator that checks how other operators follow the installed contract. It is not a second
fleet manager. These notes retain the conduct model and omit deployment incidents and personal instructions.

## Two layers

The server first produces a mechanical conduct report: shifts, stale cards, open asks, unanswered messages,
mislabeling and missing follow-through. This layer is evidence, not a judgment of intent. A watch operator then reads
the report and the permitted conversation, decides whether a correction is warranted, and can issue a NOTICE.

A useful notice names the observed conduct, the relevant installed rule and the concrete correction. The receiving
operator acknowledges or disputes it with evidence. Disagreement that requires changing goals or permissions goes
to you, not to a battle of notices.

## Boundaries

The watch may read only the boards its identity permits. It cannot complete another operator's cards, relay its
prompts, change a project's scope or substitute its judgment for a captain decision. It must not read your
private advice questions merely because the advice steward exists. It may monitor instrument health, not control
that steward's answers.

Use its own cards for watch work. Keep routine Monitor re-arms quiet. Escalate real repeated drift or an instrument
that is blind. Enable this role only when you have adopted an operating contract and authorized notices; the
example configuration watches no boards by default.

Kit reports and proposals go on the board's Held `maintainer-inbox` card, rather than cross-session messages.
Captain-only decisions still use asks on their own cards. Configured standing cards are excluded from stale,
catch-all and after-finished signals; other rules still apply. A completion notice such as telling the requester
that a fix is live is not follow-on work. A request to start, test or extend something after completion still is.

## Installing

Choose `__WATCH_BOARDS__` in the local kit config and grant the identity the board's `watch` role. The installer then
copies `WATCH-BRIEF.md`. From the operator home, run `bash shift.sh start` before arming the conduct Monitor with
`node monitor.cjs --source conduct -- bash watch.sh`. Its findings are inputs to the session, not automatic
permission to interfere with another fleet.

The after-finished signal uses explicit closure: board_close, TASK_FINISHED, state=done, legacy status=done
or CRM auto-close. Prose-only completion guesses remain separate uncertain API hints, never proof of closure.
