# Handoff activation: one tools board at a time

Installing this release enables nothing. A host deployment, operator kit update and MCP reconnect are separate
steps. An owner then explicitly activates one named tools board. Never activate all boards together. A line-mode
watch board is refused; no command converts it. The steward and CRM lane keep their own services and records.

## Host preparation

1. Back up the host configuration, store, attachments and each operator's journals using the existing backup
   procedure. Keep the backup private. It is disaster evidence, not a store to restore over subsequently accepted work.
2. Follow the existing deployment runbook to stage this server release. A brief retry-safe restart is sufficient;
   do not end the shift or rerun initial board setup. Before activation a compatible retained release can still be
   selected. After activation the store is schema 5; an older binary is refused.
3. Update the kit in each attached tools home with the existing installer/update procedure and reconnect every
   MCP process. Updating files alone is not reconnecting. Never update or reconnect an unrelated line-mode home.
4. Use the exact private-file commands in [handoff setup](HANDOFF-SETUP.md) to register the operator logical identity
   and separate collector credential, then nominate/acquire the initial holder before activation. Record its
   immutable opaque location and verify the original firstmate route as in the kit's HANDOFF-RECOVERY.md.
5. Supply LH_OPERATOR_SESSION_ID, LH_SESSION_CREDENTIAL_FILE and LH_SESSION_EPOCH to each tools process.
   The credential file binds the exact sessionId and credential, is private, and is never put in a checkpoint.
   The updated MCP publishes its dispatch journal in bounded pages before attaching. Missing pages block readiness;
   reconnect restarts the full snapshot safely. An incomplete journal is a stop sign, not permission to erase it.
6. Inventory every writer, including stopped/silent processes. Reconnect or explicitly detach obsolete process IDs
   using the stopped-process plan in handoff setup; do not wait for stale entries to disappear. An owner can retire
   only a stopped legacy/non-holder process on an inactive board, with the current epoch and an audit entry.
   Finish legacy relay tickets first.

If a pre-B5 experimental store already has dispatchLedger.ready set, stop and request a separate owner-reviewed
migration. This rollout assumes the previously dormant defaults; it does not silently adopt prototype activations.

The barrier checks every attachment, live holder/lease, location, protocol version, dispatch capability, complete
installed-vs-loaded MCP hash, and migrated journal at the current epoch. Kit/server version here means the exact
handoff protocol compatibility version (handoff-activation-v1), not identical repository SHAs: installed kits include
home-specific substitutions. Keep their release manifests for source provenance. A changed census invalidates a plan.
The host cannot discover a wholly silent external writer; --confirm-all-writers is the owner's explicit attestation
that every writer is accounted for. Unknown/legacy writers cannot act after activation.

## Owner command

Run from the release repository with Node 24. The same commands work in PowerShell and Git Bash. Replace the example
endpoint, board ID and absolute private-file paths with the intended installation. Never put a credential in a command
argument, URL, shell history or board post. Provision owner.json through the existing protected secret-file flow:
its JSON contains a credential field with the board owner's credential; it must pass the host's private-file checks.
An operator or collector credential cannot activate a board. HTTPS is required outside loopback; redirects are refused.

Define this named-board wrapper in PowerShell, after replacing paths/endpoint:

~~~powershell
function lhactivation {
  param([string]$Command)
  $common = @('--endpoint','http://127.0.0.1:7781','--board','harbor',
    '--credential-file','C:/private/owner.json')
  node lighthouse/server/activation-cli.js $Command @common @args
}
~~~

Or define the equivalent wrapper in Git Bash:

~~~sh
lhactivation() {
  command="$1"; shift
  common=(--endpoint http://127.0.0.1:7781 --board harbor --credential-file C:/private/owner.json)
  node lighthouse/server/activation-cli.js "$command" "${common[@]}" "$@"
}
~~~

The following commands are identical in either shell. Inspect harbor first (not a wildcard or a list).
Do not overwrite an existing plan:

~~~sh
lhactivation inspect --output C:/private/harbor-on.json
~~~

If an inventory remains incomplete after repairing local files, account for the missing evidence independently.
The owner can resolve that specific journal before activation; an operator cannot. Finish every migration page first
when the original installation is available. All unresolved journals block readiness, including unattached ones.
Save this JSON as a new private gap-plan.json, replacing the endpoint, board, journal ID, inspected epoch, unique
operation ID and evidence with the exact reviewed values. Never include credentials or private message content:

~~~json
{
  "endpoint": "http://127.0.0.1:7781",
  "board": "harbor",
  "resolution": {
    "action": "resolve-gap",
    "operationId": "owner-gap-review-unique-id",
    "expectedEpoch": 1,
    "journalId": "journal-id-from-inspection",
    "independent": true,
    "evidence": "Reference to the independent records accounting for this gap"
  }
}
~~~

~~~sh
lhactivation resolve-gap --input C:/private/gap-plan.json
~~~

If the original installation is lost during paging, inspect the journal's migration.id. Only after independent review
accounts for the missing pages, add 'abandonMigrationId' with that exact ID to the resolution object. Keep expectedEpoch
at the freshly inspected epoch. The owner command explicitly abandons that one migration, preserves all imported calls
and dispositions, records a migration-pages-missing gap and audits the decision. It does not claim the pages arrived.
An old approval does not cover new gaps; each newly observed loss needs another independent owner decision.

This records the owner decision and never activates the board. Republish/reconnect when available, then inspect again
and create a fresh activation plan. If evidence is unavailable, leave the board inactive or keep active dispatch paused.
The same bounded paging applies to active-board queue drains, inventory tools and dispatch imports.

If ready is false, fix the named blockers and inspect into a fresh plan. Leave other boards alone. When ready is true
and every writer is accounted for, run:

~~~sh
lhactivation activate --input C:/private/harbor-on.json --confirm-all-writers
lhactivation verify --expect active
~~~

The activation transaction enables all four protocol layers together and preserves the shift. The command verifies
the result with a separate read. If the answer is lost, keep the same plan and retry the exact command: its operation
IDs are durable. Do not generate another plan to guess what happened. Inspect the named board after any uncertainty.
Validate planned transfer, pickup, late receipt and owner-approved recovery in the scratch rehearsal before deciding
to activate studio. This is not an instruction to simulate a production session loss; any live drill requires a
separate owner decision.
Then repeat the commands with --board studio and separate studio plan files. Never reuse harbor's plan for studio.

## Back out without losing work

Deactivation is not a transfer to a predecessor and not a backup restore. It returns the named board to today's
legacy authority behavior on this release. Keep the updated server/kit and schema 5. A code rollback to pre-B5 after
activation is unsupported even after deactivation. Never edit flags, erase the ledger, or lower schemaVersion.

1. Pause new work on this board. Finish or cancel any unaccepted transfer with its pending-effects review.
2. Reconcile every unknown/in-flight relay with independent evidence and the owner decision. Review/adopt/drain or
   explicitly reject/supersede queued calls. Resolve actual journal gaps; a timeout is not proof of non-delivery.
   Deactivation refuses nonterminal calls/intents, effect holds and unfinished transfers; it discards none of them.
3. Stop every MCP/collector/generation helper for this board only. Leave the independent steward running. Do not end
   the shift. Inspect after stopping, so the off-plan has the current epoch and complete attachment census.
4. Run the following with a fresh off-plan, then reconnect the legacy operator without explicit-session settings:

~~~sh
lhactivation inspect --output C:/private/harbor-off.json
lhactivation deactivate --input C:/private/harbor-off.json --confirm-quiesced
lhactivation verify --expect inactive
~~~

The server revokes the board's explicit sessions and advances the epoch, fencing returning tools. It retains shift
state/id/start, board work, checkpoints, receipts, history and permanent commit deduplication. Old session credentials
do not resume; remove LH_OPERATOR_SESSION_ID, LH_SESSION_CREDENTIAL_FILE and LH_SESSION_EPOCH before legacy reconnect.
To activate again, register a fresh logical session, reconnect/inventory, and pass the barrier again.
Reactivation retains the original target pin. Use the same original home and verified route for local dispatch;
reactivation on another machine may pass readiness but dispatch intentionally remains paused, not migrated.

## Guarantees and limits

One current board actor, durable epochs, retry-safe acknowledged transitions, continuous shifts and independent
steward jobs are guaranteed under the documented single-writer/local-storage assumptions. A consumed permission
never grants again. This is NOT receiver-side exactly-once delivery: a lost grant can mean zero sends, a transport
may have delivered despite losing its receipt, and uncertain work stays held until independently reconciled.
Returning predecessors can settle scoped existing evidence, not direct new work. Compaction keeps the same identity.
Cross-machine pickup preserves the original firstmate target. Without a verified secure remote route, dispatch
pauses; there is no automatic target migration. No zero-downtime deployment, remote filesystem consensus, automatic
successor after loss, or line-mode handoff is promised. Reproduce checks with the repo-local handoff verification skill.
