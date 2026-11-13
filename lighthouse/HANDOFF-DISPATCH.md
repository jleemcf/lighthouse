# Board dispatch and ordinary-call ledger

B3 extends B1 ownership and B2 checkpoints for tools boards. It ships dormant. Existing boards keep the current
relay, local journal and automatic ordinary outbox behavior until ownership readiness, the per-board
`dispatchLedgerEnabled: true` setting, and an explicit owner ledger activation all pass. Line mode is unchanged.
Activation writes schema 4; older releases refuse that store. Once activated, removing the setting does not
remove the ledger fence. No update, enrollment, reconnect or live activation is performed by this source change.

The board retains logical intents, attempts and ordinary calls across homes. Each intent records its stable id,
exact SHA-256 instruction hash, original firstmate binding, origin session/installation/epoch and authorization.
Attempts retain their ticket, permission id, consumption operation, evidence and reconciliation history. These
records and ordinary call deduplication records are retained rather than expired by the legacy call cache.

## Dispatch and uncertainty

1. `board_relay` performs the existing source/Send/standing-authority checks and issues the exact text. An active
   board requires the kit's `dispatch-ledger-v1` declaration, so an old MCP cannot obtain a legacy ticket.
2. The kit fsyncs its local journal before requesting permission consumption. It sends a stable consume operation
   through `POST /api/boards/<board>/dispatch-ledger`. B1 rechecks acting rights at durable commit.
3. Only the first consumption response grants dispatch. The kit durably records that first positive response
   before invoking the existing `relay.sh`. A retry, including the identical operation id, never returns another
   positive grant. A lost answer or process crash leaves the board attempt possibly sent even if no route began.
4. Restart retries only saved receipts. It never resumes a route from a saved grant, an empty journal, an unknown
   result or a timeout. A second id with the same unresolved target and instruction is suppressed on the board.
5. An issued, unconsumed permission can be explicitly adopted under the current live session with a review reason.
   The board supersedes the old unspent attempt and creates a new attempt for the same logical intent. Consumed,
   started and unknown attempts cannot be adopted or reissued. Review current authority before adopting.

Already-started external work can finish after relief. A consumed, unknown or conflicting attempt holds conflicting dispatch to its original target.
A non-conflicting positive receipt settles the completed route invocation and releases its hold. Unrelated board calls continue. This
protocol does not cancel an old OS process, modify firstmate or its route, or promise receiver-side exactly-once
delivery. The one-invocation/one-delivery assumption belongs to the external route, outside this protocol.

## Late evidence and owner reconciliation

Receipt evidence uses B1's private ticket-bound capability, independently of current acting rights, lease loss
and ordinary ticket age. Original ticket/session/epoch provenance is retained. An authenticated operator on the
same board may settle imported evidence by supplying that capability and its original session and epoch. This
delegates only evidence settlement; it never renews a lease, transfers a holder or authorizes a board command.
Capabilities are absent from the ledger read view. Outstanding and settled ledger tickets are not pruned.

A positive receipt is reported only after the relay process exits. It settles transport delivery,
without claiming completion of firstmate's downstream work. A non-delivery claim remains
unknown; conflicting evidence is retained and holds the target. To reconcile, the board owner uses the private
ledger control with action `reconcile`, stable `operationId`, `intentId`, `attemptId`, `outcome` (`delivered`,
`not-delivered` or `conflict-resolved`), `independent: true`, `quiesced: true`, an independent evidence reference
and a reason. A timeout, an empty home and the old local grace period are never evidence of non-delivery.
Reconciliation closes uncertainty; it never reissues that consumed permission. Any later deliberate work needs
its own currently authorized intent. A transfer hold clears only when the board finds no remaining effect
blockers; missing evidence and other pending work keep their holds. Terminal queue reviews, applied adoptions
and owner gap resolution also release transfer holds once no other effect remains. Owner-delivered reconciliation
marks the original source just as a positive receipt does; a repeat requires explicit again authority. A late
receipt opposed to the owner's outcome is retained as conflict and needs another independent owner decision.
Agreeing late evidence is retained without reopening work the owner has quiesced.

## Ordinary queued calls

`board_dispatch(action: "inventory")` publishes original call ids, canonical tool/body SHA-256 hashes, origin
metadata and explicit dispositions: `unacknowledged`, `acknowledged`, `rejected`, `adopted`, `superseded`.
The board deduplicates a committed call before it can execute again, even after the legacy 30-day cache expires.
Reusing an id with a different body is refused. Removing the `queued` marker cannot evade review.
During readiness, the ordinary queue still drains. Commits for already-inventoried calls become permanent ledger
acknowledgements; activation also reconciles retained legacy commit records. A review-required conflict during
activation keeps the original local call pending, including when the follow-up status answer is lost.
For legacy entries without a known origin session, a unique matching board commit is recovered across principals.
Multiple candidates or a mismatched body hash hold the original call against adoption; resolve the evidence
separately and explicitly supersede or reject it. An importer identity cannot stand in for missing origin metadata.

On an activated board, the kit inventories changed snapshots of pending commands and pauses their automatic drain.
Board-acknowledged, rejected or superseded calls leave the local outbox; their original records stay on the board. The successor
reads live records, then uses `board_dispatch(action: "review-call", operationId, callId, hash, disposition,
reason)` to adopt, reject or supersede the exact original intent. Adoption explicitly applies the original call
once under current ownership; its original id, body hash and origin remain. Supersede an old shift-end or stale
progress update rather than replaying it. Review newer owner messages before adopting. Old sessions remain
fenced; review and application are separate durable transitions, and a lost application answer is deduplicated.

## Migration and cross-home evidence

Deploy the server first. Pause relays, update a test home with the journal-aware kit and reconnect **every** MCP
process sharing the journals. Do not mix old and new processes. The installer hashes all ledger dependencies and
marks a reconnect when any changes. Updating source or tools does not change the logical session or shift.

Publish each home's inventory before activating. Every attached writer must advertise the new protocol and
that journal identity. Legacy unresolved tickets and local-only unresolved journal entries import as unknown;
local `reconciled` alone is not a board acknowledgement. Never-created optional journals are empty.
Missing previously observed evidence, unreadable or malformed journals produce a durable gap.
An empty later inventory cannot clear a gap. Owner action `resolve-gap` requires independent evidence. Activation
requires complete inventories or explicit owner gap decisions, exact attached process ids and confirmation that
all writers are reconnected. Do not activate publicly until B4/B5 acceptance is complete.

For a planned move, with MCP writers paused, use these commands in the installed scripts directory:

```text
node lighthouse-mcp.cjs dispatch-export <new-encrypted-file> <new-private-key-file>
node lighthouse-mcp.cjs dispatch-import <encrypted-file> <private-key-file>
```

Keep the key in a separately protected directory and transfer it separately through an approved secure channel.
The envelope uses AES-256-GCM with authenticated version, board and original target binding; output never prints
the key. It carries only journal/queue evidence, including scoped receipt capabilities, never process ids, locks
or session credentials. Import retains the authenticated source inventory as private evidence and uses a durable
import-in-progress gap before merging. Imported commands enter a review inventory, never automatic replay.
Missing files, conflicting evidence and interrupted imports stay visible. Do not interpret an import gap as
"nothing pending". Board-acknowledged records remain readable without the old disk; unpublished local evidence
cannot be reconstructed. A different installation never silently retargets firstmate: dispatch pauses until
the original route is reachable or the owner separately decides target migration (outside B3).

Developer checks and bounded-model limits are documented in the repo-local
`verify-lighthouse-handoff` skill. B4 helper generations/unplanned recovery and B5 live activation remain separate.
