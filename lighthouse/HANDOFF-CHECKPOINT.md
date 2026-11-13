# Versioned checkpoints and planned transfer (B2)

This is dormant infrastructure, not public activation. It requires a tools board, B1's completed capability/readiness
barrier and enforcement, and the additional per-board configuration value `handoffEnabled: true`. No setup screen,
initializer or migration enables that switch. Keep it off until B3's dispatch ledger and B4's helper/recovery work
are ready, followed by B5's separately approved rollout. Line boards and the short board-side pickup note are unchanged.

## Records, not a replacement for the board

Checkpoints have schema `version: 1` and live in the durable board store's `handoffs` collection. The pickup note
gains a checkpoint ID reference, not a packed transcript. A checkpoint records goal, next step, decisions, constraints,
commitments, original target binding, queue and relay references, helper references and cursors. Every context field
has `{freshness: "fresh" | "stale" | "missing", observedAt: milliseconds, value: ...}`. Text fields are strings;
the others are lists. An absent field is invalid, not silently empty. Observations older than six hours become stale.
The server stamps board revision, holder/epoch, authoritative owed/card/open-ask/authority IDs, relay tickets and
pending/running steward jobs. Owed uses the same server-derived authorship rule as the operator receipt.

Queue, relay, helper and cursor entries are references with an ID and optional state, hash, originSessionId,
originEpoch, ticket, target, position, revision, attemptId or kind. Never include instructions, credential files,
tokens, passwords or capabilities. The kit inventories only IDs, states, hashes and provenance; malformed journals
are missing, locked journals stale. Server size/key/pattern validation is a guardrail, not a guarantee that arbitrary
prose contains no secrets. Operators must not put secrets in prose or identifiers.

The server pins the first target binding to the authenticated holder's installation (default target ID: firstmate).
An optional targetBinding names that original target; later checkpoints reuse the pin, including compaction with
missing context. A supplied different installation is refused. A different home does not migrate firstmate:
dispatch stays paused when
the original binding is missing, held, or belongs to another installation. B2 does not probe remote reachability or
reconcile an unknown dispatched effect. B3/B4 must supply that adoption and reconciliation before activation.

## Tool protocol

The kit advertises `board_checkpoint`, `board_transfer` and `board_pickup` only when this board's flow is enabled
and an explicit B1 logical session credential is configured. These controls bypass, and never replay, the ordinary
outbox. Every mutating/read operation requires a caller-selected stable operation ID. Reuse the exact input on retry;
the durable result and audit are committed together. Transfer controls require an explicit original expectedEpoch,
even after the successor learns its new epoch. Changed input under the same operation ID is refused.
The kit saves each complete inventoried checkpoint request in private home-local handoff-checkpoints storage
before sending it. Retrying the same operation after a lost answer or reconnect reuses that exact payload,
including observation timestamps. For a planned handoff, changed queue or relay references refuse a reused
operation locally: write a new checkpoint with a new operation ID before sealing. Same-session compaction and
reconnect retain their original inventory without adding holds. Changed arguments under that operation ID are
refused. Keep these retry records with the home.

1. Flush normal acknowledged work before preparing. The owner or current holder calls prepare, names a registered
   successor and a fresh transfer ID, and supplies the current epoch. Holder remains recorded; phase becomes draining.
   No new ordinary operator work, relay dispatch or new steward job claim starts. A running steward job can finish.
2. The outgoing holder writes a checkpoint, then seals. Missing/stale context, unacknowledged queues, unresolved
   relay tickets/attempts and running steward jobs block clean sealing. Cancel, reconcile and prepare again, or
   explicitly request a degraded seal. Degraded blockers remain visible. Only unresolved or unknown effects create
   dispatch holds; missing context alone never holds a target. Affected targets stay held after pickup.
   A later transfer cannot wash away those holds. B2 deliberately has no release-hold/adopt-outbox shortcut.
3. The named successor uses read to receive the sealed checkpoint, all current board records and all retained changes
   after the checkpoint. Accept requires that read receipt plus exact epoch; CAS atomically advances holder/epoch
   into pickup. Lease loss before commit refuses planned transfer and requires future captain-approved recovery.
4. After acceptance, read again, inspect the full live records and every retained change, then acknowledge that read's
   revision using pickup. Any intervening revision, including a new ask, forces reread. The successor cannot work
   before pickup. Crash/reconnect or a lost acceptance reply uses the same durable transfer, never a second shift.
5. Before acceptance, the holder or owner may cancel with the current pending-effects digest. Epoch stays unchanged.
   Cancellation restores the holds inherited before prepare; newly observed effects stay with the same holder
   for reconciliation, not permanent new dispatch holds. Existing degraded-transfer holds cannot be cleared this
   way. After commit, cancellation is refused: reversal needs a newer transfer.

Checkpoint change history is retained independently of the normal bounded change feed until pickup/cancellation.
The checkpoint supplements live records; it never overwrites newer asks, commitments or work. History and operation
records are retained without automatic eviction in B2. Storage retention/compaction is a future activation concern.
Read operations retain only their receipt, checkpoint ID and board-scoped revision, not copies of live board state.
Retrying a read rebuilds the live view; its original revision remains the acknowledgement guard. Activity on another
board cannot invalidate pickup, while every intervening change on this board does.

## Compaction, reconnection and the page

The same checkpoint action with reason compaction or reconnect starts same-session pickup: no holder/epoch change.
Dry-run board_shift calls keep the legacy rehearsal path; they create no checkpoint or pickup barrier.
It preserves inherited dispatch holds but adds none for pending effects: the same holder still owns its journals
and background jobs. Relay evidence keeps draining in both draining and pickup; only ordinary queued calls pause.
Enabled board_shift(compacting) first preserves the ordinary pickup note, then uses this schema and inventories
local journals. It carries only context fields, never the server's authoritative records, and a new note wins over
the prior goal. If context is unknown it explicitly
marks it missing. board_shift(compacted) reads the pending checkpoint/live state; it does not blindly acknowledge it.
The operator must inspect and call board_pickup(action: "pickup") with the read ID and revision before ordinary work.
The compacted response includes the same pickup note and rules. The ordinary outbox pauses during draining/pickup;
it is neither adopted nor dead-lettered just because pickup is pending. After an owner-page acceptance, attachment
and heartbeat conflicts automatically check status and adopt only this logical session's new holder epoch into its
private credential file. Explicit board_pickup(action: "status") does the same. Neither acknowledges pickup or
infers identity from a folder or machine name. Reconnect is bounded by the live lease: once a lease is lost, B2
fails closed and future B4 recovery requires a separate captain approval for that loss.

The existing owner session/CSRF/origin/TLS checks protect Hand off, Accept and Cancel page controls. Acceptance also
requires the successor's private credential file and displays the sealed/live read before confirmation; the file
stays only in dialog memory and is cleared on close, cancellation and page exit. Ordinary tab backgrounding keeps
the file chooser alive, including Android's backgrounding chooser. Successor pickup
still occurs from its authorized home. Status exposes holder, uninterrupted since, phase, checkpoint age/completeness,
degraded blockers and held targets at phone and desktop widths. No handoff step starts/ends/resets the shift.

## Boundaries

No dispatch ledger, outbox adoption, helper generation authority, unplanned recovery, target migration, fleet kit
update, deploy or live enrollment is part of B2. Going live later needs a board deploy, new kit and reconnect plus
the activation checks in HANDOFF-ACTIVATION.md. See the repo-local handoff verification skill for executable proof
and limits. Atomic local store replacement and a single server writer remain B1 assumptions.
Do not change the dormant board switch during a transfer; rollout/rollback sequencing belongs to B5.
