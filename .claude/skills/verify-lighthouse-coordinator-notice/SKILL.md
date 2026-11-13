---
name: verify-lighthouse-coordinator-notice
description: Verify notice admission, owner authority isolation, inbox reconciliation and unconditional wake.
---

# Verify coordinator notices

A coordinator can wake an operator on its board without becoming the owner. The operator answers on that inbox
card and acts only within existing owner approvals. A notice cannot supply a standing authority, satisfy relay
approval, answer an owner ask or enable /yolo. Existing owner messages and watch conduct corrections keep their rules.

## Run

1. Review the mappings below against the behavior diff. Run
   `node lighthouse/verification/cards/notice-check.cjs --mutate` from the repository root. It removes the paid key,
   runs scratch-board, real-watcher, gate, role, profile, documentation and page regressions, and checks four code
   mutations. Every mutation must fail its named assertion, then pass after restoring its scratch source.
2. Read `/statechart` and use its installed launcher, through WSL, in a fresh scratch folder outside repositories.
   Copy `NoticeInbox.tla`, `NoticeInbox.cfg`, `notice-*-broken.cfg` and `notice-view.mjs` from
   `lighthouse/verification/cards/`. Run the normal config with the view and a new output directory.
   All five invariants and NoDeadlock must hold, with no unchecked rules or reached exploration limit.
3. Use new output directories for `notice-trust-broken.cfg`, `notice-drop-broken.cfg` and
   `notice-repeat-broken.cfg`. Trust must violate all three authority rules on posting a notice; drop must violate
   AnnouncedNoticeWakes on posting then polling; repeat must violate NoticeWakesOnce on posting and two polls.
   Read every report. Run the unmodified normal config again in another output directory.
4. Run `bash lighthouse/test-all.sh` on an LF-normalized scratch copy, with no paid-service key. Rebuild the page
   using `python lighthouse/server/make-page.py` when board sources change. All servers/homes are scratch copies
   on loopback, never port 7700. Use the card, relay, doorbell and enrollment skills for their unchanged core flows.

Do not embed TLC or its launcher path in repository scripts. Do not ship developer verification assets in kits.

## Model and source mapping

Source base: origin/master `b85827f`, plus the coordinator-notice implementation. Recorded evidence is
`lighthouse/verification/cards/README.md`. Move this mapping forward only after rerunning both forms of proof.

- PostNotice: routes-messages.js validates the explicit board role before idempotent lookup, stores a canonical
  coordinator author and unhandled comment, and skips owner transcripts, operator reply settlement and /yolo.
  access.js/web.js handle additive memberships while preserving installation caps and per-board admission.
- NoticeNeverGrantsAuthority: toolcalls-authority.js requires an owner-authored source. A coordinator message has
  a message ID for replies, with its coordinator author intact. It cannot become an authority record.
- NoticeNeverApprovesRelay: toolcalls-relay.js checks authorOf for source/on_word; an authority ID has a distinct
  indexed type. The notice cannot provide any basis. Existing independent owner authority still works.
- NoticeNeverAnswersOwnerAsk: posting bypasses operator reply settlement; grammar.js excludes coordinator words
  from ownerAnsweredAt. prompt-transitions.js excludes them from the newest human Send source.
- OwnerWords: independent existing owner approval/settlement paths, covered by ordinary card/prompt regressions.
- PollInbox: boardwatch.cjs uses the existing once-per-poll reconciliation and saved message keys. The coordinator
  label is distinct from watch notices. Its shared image delivery runs before marking an attachment-only notice
  announced; missing images produce visible diagnostics. gate.cjs classifies the notice as route before judgment.
- ReadFailsOrRetry: inbox errors leave the cursor/keys unchanged; retry identities reuse saved comments. A repeated
  read leaves an already-announced key quiet. Role checks precede retry lookup; the rate budget is saved comments.
- ReplyOnInboxCard: toolcalls.js indexes coordinator notices as messages for board_reply. replies.js/notes.js include
  coordinator messages in line replies/copies; watch OPS acknowledgment excludes them.
- collector.py rejects bare and Monitor-wrapped wakes as owner chat and carries their inbox target for line
  replies. Its final route bracket requires the watch's fixed approval suffix. Notice prose is removed before
  owner headers are recognized, so quoted brackets and fake event tags cannot redirect a reply to an owner ask.
  Python counterexamples and a real HTTP line reply check the inbox target and independent owner question across
  bare, task-notification, attributed-event and closing-tag boundaries. The complete fixed suffix rejects forged
  brackets in failed-image names; notice text stays excluded from owner headers.
  transcript.js rejects the raw prefix, while mid-sentence owner quotations keep their human origin.
  conduct.js excludes notices from operator line, silence, flood and catch-all duplicate evidence.
  Page messages.js labels and styles each notice.
- Profile: only explicit apply-profile.cjs adds the profile's coordinatorGrants. Runtime normalization never grants
  it. The private profile adds only a separate coordinator-only principal; existing roles, credentials and board
  configuration are retained. Profile parity checks forbid elevating the previous principal or minting credentials.
  Create the separate principal's fresh token at go-live; apply before schema-2 registry migration.

## Limits

One notice, one owner ask and one independent owner approval, with up to two attempted announcements. The model
abstracts persistence, retries and refused actions as stutters. It checks safety, not eventual delivery after an
outage. It does not model arbitrary text, multiple boards, clocks/rate budgets, attachments, credential storage,
power failure or concurrent filesystem writes. HTTP and process tests cover the concrete authorization, 4,000
character limit, shared principal budget, role caps, idempotency, collector identity and page rendering boundaries.
NoDeadlock includes waiting stutters. A passing model does not replace the real-code mutations or acceptance tests.
