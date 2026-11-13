# Relay delivery and recovery

External delivery and the board accepting its receipt are different events.
An instruction is never automatically sent again because recording its receipt failed.
This is not an exactly-once guarantee from firstmate or its transport.

## What the operator sees

The tool server keeps `relay-results.jsonl` beside its installed scripts. Each entry keeps the existing
`relay-result-<ticket id>` identity and moves through these states:

- `authorized`: the board issued exact words and the local intent was saved; the route has not started.
- `sending`: a durable marker was saved before invoking `relay.sh`; delivery may have happened.
- `delivered-awaiting-record`: a confirmed delivery or pre-send non-delivery result awaits receipt acceptance.
- `recorded`: the board explicitly accepted the matching receipt id, ticket and delivery outcome.
- `blocked`: the board refused the receipt or returned no matching acknowledgement; evidence remains locally.
- `outcome-unknown`: the route timed out, exited ambiguously, or an interrupted attempt was found after restart.
- `reconciled`: the captain checked independent evidence and closed the warning locally; the audit remains.

Completed entries stay as an audit. Refusals and unknown outcomes stay visible in later board tool answers,
including `board_status`. An incomplete relay returns an error with a **do not relay again** instruction,
even when external delivery succeeded.

The timer and subsequent board calls retry only saved receipt arguments, with their original ids. They never
invoke the external route. A timeout or ambiguous nonzero exit is not evidence that firstmate received nothing.
Explicit pre-send SKIPPED, REFUSED, NO ROUTE YET or usage messages record non-delivery instead. Once the board
accepts that receipt, the route's own retry advice applies. A cached application refusal stops receipt retries;
401/403, outages and old-board responses without acknowledgement remain retryable. An outage pauses the backlog.
Another relay of the same target and exact text is blocked while its earlier outcome remains unresolved,
including `again: true`. Legacy receipt-only entries retain their ids; unresolved entries lacking an intent
conservatively block new relays until reconciliation.

## Reconcile instead of repeating

1. Read the reported entry in `relay-results.jsonl` and inspect the board's receipt and external recipient's
   actual history. Do not infer non-delivery from an empty board record.
2. For a known delivered result with a refused or unavailable receipt, repair board access or availability.
   The tool server retries the **receipt**, not the command. The board deduplicates the same receipt id.
3. For `outcome-unknown` or a permanently refused `blocked` receipt, obtain independent delivery evidence and
   the captain's decision. No automatic receipt asserts an unknown outcome. Do not resend to clear the warning.
4. From the installed scripts directory, close the checked entry locally, retaining its id, intent and result:

   `node lighthouse-mcp.cjs relay-reconcile <id> --delivered --evidence "Captain-approved delivery evidence"`

   Use `--not-delivered` instead only with evidence of non-delivery. Evidence is required. The command accepts
   only `outcome-unknown` or `blocked` entries and saves `reconciled_at` plus the decision and evidence. For a
   recent unknown result, wait at least 70 seconds after its last update: another process may still be sending.
   This grace period is not delivery evidence; the captain must still check the recipient's history. It never
   sends, posts a receipt, deletes evidence or claims board acceptance. Closed entries leave the warning and
   receipt retry set. A new ticket is still required for any captain-approved manual retry; `again` alone does
   not reconcile an entry. Treat a delivered reconciliation as delivery, not permission to duplicate the command.
5. A damaged journal needs developer-assisted repair. Preserve the file. Relays fail closed; status and ordinary
   board calls continue with a journal-unreadable warning rather than silently dropping records.

With the optional board ledger off, there is no board reconciliation endpoint. There is never an automatic
resend or a claim of receiver deduplication.
The shell ledger and firstmate are unchanged. Unknown outcomes stay visible until the captain closes them.

## Activation

Deploy the board first: `_relay_result` now returns `results[0].relay_receipt` with the accepted `id`, `ticket`
and `delivered` fields, including a deduplicated response. Dry runs return no acceptance. Existing successful
receipt ids can recover an acknowledgement from their already-used matching ticket without reapplying delivery.
An older board's untyped `ok: true` is deliberately insufficient for the new adapter.

Pause relays in the home, then update the operator kit and reconnect **every** `/mcp` session sharing that home
before the next relay. Stop every old MCP process: master-era drain code can delete the new journal entries.
New code on disk does not update a running process. Do not mix old and new MCP servers against one journal.
No journal migration replays commands. This source change itself does not deploy or restart anything.

Developers: use `.claude/skills/verify-lighthouse-relay-delivery/SKILL.md` in the repository. Its formal models
and mutation fixtures are developer assets under `lighthouse/verification/relay/`, not operator-kit payload.

## Optional board dispatch ledger (tools mode)

The runbook above remains the behavior on boards with the B3 ledger off. B3 is dormant until ownership readiness,
the per-board `dispatchLedgerEnabled` setting and explicit owner activation all pass. Do not activate before
B4/B5 acceptance. A source update is not a deployment, a shift restart or an ownership transfer.

Deploy the server first, pause relays, update the kit and reconnect **every MCP process sharing the journal**.
Do not run mixed old/new MCP versions against the same files. The installer includes ledger dependencies in its
loaded-version/reconnect evidence. Publish `board_dispatch(action: "inventory")` from each home before the owner
confirms the readiness barrier. Never-created optional files are empty; missing previously observed or damaged evidence is a gap.
An empty successor home cannot clear a board-recorded gap.
Legacy unresolved states, including locally reconciled outcomes without board acknowledgement, import as unknown.

On an activated board the kit must consume one board permission and record it locally before invoking the same
existing relay route. `permission-requested` means the consume answer may have been lost; `permission-consumed`
means the board granted only that invocation. Restart treats either as possibly sent and never invokes the route
again. Board ledger records are shared across homes, so deleting or losing local files does not reissue permission.
An old MCP without the dispatch protocol cannot obtain a relay ticket on an activated board.

Read `board_dispatch(action: "status")` for intents, attempts, receipts, queue dispositions and import gaps.
Only a board-proven issued/unconsumed intent can be explicitly adopted. Review the current instruction and
authority, then use `board_dispatch(action: "adopt-intent", operationId, intentId, attemptId, reason)`.
Started, consumed and unknown intents cannot be resent. A non-conflicting positive receipt after the route
process exits settles that invocation and releases its hold. It does not prove firstmate's downstream work
has finished. Unknown or conflicting evidence keeps the target held until owner reconciliation.
The protocol neither cancels the predecessor's process nor supplies receiver-side exactly-once delivery.

Saved receipts continue settling after relief and ticket/lease expiry using only their private ticket capability
and original provenance. Imported capabilities confer evidence rights only. Conflicts, claimed non-delivery and
missing data need independent evidence and an owner decision on the board. The local `relay-reconcile` shortcut
is refused when this ledger is active. A timeout and the old 70-second grace period are never non-delivery evidence.

Ordinary queued calls also pause for review. Inventory retains original ids, body hashes and origin metadata.
Review live work before `board_dispatch(action: "review-call", operationId, callId, hash, disposition, reason)`.
Choose `adopted`, `superseded` or `rejected`; already committed work deduplicates. Supersede stale shift-end or
progress commands instead of blindly replaying them. New unrelated board work can continue while old calls wait.

For a planned cross-home move, pause every journal writer and use the installed `dispatch-export` and
`dispatch-import` commands documented in `lighthouse/HANDOFF-DISPATCH.md` in the source repository. The evidence
envelope is authenticated and encrypted. Keep its random key in a separate protected directory, transfer the key
separately and never paste it into chat or a board. Homes and key storage must be private. Imported calls are
review inventory, never automatic replay. Missing previously observed files and interrupted imports persist as gaps until evidence
and an owner decision resolve them. Board-acknowledged records survive loss of the old disk; local-only evidence
cannot be reconstructed. Preserve the original firstmate binding; a different installation pauses dispatch.
