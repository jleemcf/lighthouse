# Operator continuity runbook (tools boards only)

This protocol is dormant. It does not deploy, enroll, relocate firstmate, or change an existing home.
Line-mode boards keep their existing watch/shift procedure. Never run `shift.sh stop` to transfer an operator:
the steward owns its own service, jobs, results and outbox, independently of the operator.

## Preparation by the captain

Use the board's existing private session-registration controls to register a **new logical operator session**
and a separate collector credential for it. A compaction/reconnect continues the same logical session; a new
operator conversation does not. Keep every credential file private and out of checkpoints, messages and logs.
Use opaque installation, machine and home IDs, never private hostnames or filesystem paths.

For each session, the captain records an immutable location using ownership action `locate` with `sessionId`
and `location: {machineId, homeId, targetId, targetInstallationId, routeHash}`. Obtain `routeHash` with
`node target-binding.cjs` in the verified home. The two target identity fields must still name the original
external worker, even on a different machine. They are not the successor's local firstmate.
Registering a location never changes an external route or enrolls a host.

The owner follows lighthouse/HANDOFF-ACTIVATION.md in the release repository. Its explicit named-board command
checks all attached processes, matching kit/server protocol, loaded/installed MCP and migrated journal inventory.
It then enables ownership, handoff, dispatch and recovery atomically. All remain off until that command succeeds;
old configuration switches do not activate a running server. Unknown locations fail closed.
Reconnect **every MCP process sharing a changed journal**, and inventory its current journal before readiness.
Do not reuse a predecessor's process ID or credential as the new session's authority.

For the rollout, update this home with the normal kit update command, reconnect every MCP sharing its journal,
and make a board_status call with the explicit session settings. The MCP publishes its migrated journal before
attaching. The owner inspects readiness and handles every blocker; an operator cannot activate its own board.
Do not start a new shift, restart the steward or change a line-mode home. If the owner deactivates this board,
stop its tools/helpers, retain all journals, remove the three explicit-session settings and reconnect in legacy
mode. The owner runbook requires reconciliation first; deactivation is not permission to resend unknown work.

## Planned transfer

1. On the owner page choose **Hand off**, name the registered successor and retain the transfer/operation IDs.
2. The outgoing operator drains new dispatch, saves `board_checkpoint` (all context fields and explicit freshness),
   then seals through `board_transfer`. A clean seal needs no unknown effects; a degraded seal retains holds.
3. If changing homes, export B3's encrypted evidence package with `includeCursors: true`. Transfer the encrypted
   file and its private key through an authenticated channel. Import with the **same original target binding**.
   Never copy PID, lock, helper-generation or active lease files. Imported queued commands remain inventory only;
   review/adopt exact calls through B3. Missing cursor/journal data is a gap, not proof of non-delivery.
4. The named successor reads the checkpoint, full live board records, pending tickets, ledger manifests,
   independent steward results and retained changes. Accept the exact transfer, then reread and complete
   `board_pickup` at the returned revision before acting. Retain IDs for retries after a lost response.
5. Start new generation helpers from the authorized home as described below. Do not restart the shift or steward.
   The shift ID, original On-since and owner approvals are unchanged.

If the outgoing holder expires before acceptance, planned acceptance refuses. Use a fresh recovery approval.
An owner may cancel an uncommitted transfer after reviewing pending effects; a committed epoch cannot roll back.

## Lost session / partition / missing old disk

1. Read the recorded holder and lease. **Lost presence is not an ownership change or proof a remote process has
   stopped.** Do not send work through a second session just because it has a heartbeat.
2. On the owner page choose **Recover**. Name a different registered successor, record a reason, explicitly state
   whether the old disk is available, and review the visible unknown-delivery blockers. Approval is for this loss
   and epoch only and expires after one hour. It is not a preauthorized-successor policy.
3. Before lease expiry, the captain must explicitly check **revoke on acceptance**. The old holder drains while
   waiting; successor acceptance atomically advances the epoch and fences the old authority. Existing in-flight
   effects remain unknown and held. Recovery never means a route was stopped or an external action was undone.
4. The successor performs the same read/accept/reread/pickup barrier as planned transfer. With no checkpoint,
   a versioned all-missing checkpoint is supplied. With no old disk, recover **only board-acknowledged work**.
   The missing-data warning remains and the seal is always degraded; do not certify a complete handoff.
5. The recovery inventory gap blocks external intents. Preserve tickets and late receipts. Reconcile with B3's
   independent evidence and owner `resolve-gap` action, plus explicit call adoption and intent reconciliation as
   needed. Resolving a gap does not resolve an unknown delivery or authorize a blind retry. Steward completion
   releases its conservative hold through the completion path after other blockers clear (S20).
6. A returning predecessor must reconnect explicitly; its old epoch cannot renew or replay queued mutations.
   Its existing ticket-bound outcome evidence remains admissible. Do not erase that evidence to silence a warning.

Only the captain may cancel a recovery approval before acceptance. Cancellation removes that approval's
synthetic inventory gap, not actual unknown deliveries or inherited dispatch holds; it never advances the epoch.

## Location and helper checklist

The captain records each session's immutable location through the ownership `locate` action: opaque `machineId`,
`homeId`, `targetId` and `targetInstallationId`, plus `routeHash` from `node target-binding.cjs` in that home.
Verify the original home's actual target before recording the first binding. A successor must match its delivery
and read-only watcher adapters byte-for-byte (line endings normalized); a different adapter remains paused.
Never copy or edit a route to make a check pass. A deliberately changed target needs a separate owner decision.
Kit upgrades that change either adapter require separate target verification, not an automatic rebinding.
If the original installation's location was never recorded, board-side recovery may still proceed, but the
target stays unlocated and external dispatch stays paused. A successor from another installation cannot pin it
to its own machine through locate, checkpoint or another recovery approval.

On a reachable old disk, `node lighthouse-mcp.cjs dispatch-export <encrypted-file> <new-private-key-file>`
automatically includes cursor evidence only with recovery enabled. Transfer the encrypted file and key by separate
authenticated private channels. At the successor use `dispatch-import <encrypted-file> <private-key-file>` with
the same command; imported calls stay inventory-only pending explicit adoption. Missing cursors add durable gaps.

- **Same home, new session:** reuse the existing journal and collected-event cursors, allocate the new logical
  session and transfer authority. Reconnect every MCP sharing the journal. Start fresh helper processes.
- **Different home, same machine:** use the shared durable board ledger and authenticated encrypted evidence /
  queue / cursor import. The immutable target binding must still name the original worker. No PID/lock import.
- **Different machine:** board-side work may continue after pickup. The original firstmate target stays put.
  This implementation has no secure remote-route adapter, so firstmate dispatch and fmwatch remain paused here.
  Never substitute the successor machine's local worker. Target relocation requires a separate owner decision.

After authorized pickup, run `node helper-runner.cjs boardwatch`, `node helper-runner.cjs fmwatch` or
`node helper-runner.cjs collector --transcript-dir <authorized transcript directory>` in the installed home.
Supply explicit `LH_OPERATOR_SESSION_ID`, `LH_SESSION_EPOCH` and `LH_SESSION_CREDENTIAL_FILE`; the collector
also needs `LH_COLLECTOR_CREDENTIAL_FILE` for its separate same-session collector credential and exact epoch.
These commands never start/stop the steward and never use PID files to stop another process.

Each runner checks board authority, starts only its own child, refreshes a short local lease from confirmed
authority, and retries transient refresh/read failures only until the last confirmed local lease expires
(at most three seconds). Lost authority stops the child with a visible re-arm notice and nonzero exit; a known
newer generation may retire quietly. Local generation markers are monotonic by
epoch; a newer generation retires only that board's older helper generation. Watchers check before output and
cursor writes, collectors before network writes. Cursors record installation/session/epoch/helper identities.
Reused same-home offsets and seen IDs avoid replay. Cross-home import carries seen IDs and a conservative
high-water floor, not foreign filesystem offsets; undated/older history is skipped, not replayed as new work.
The board's epoch fence remains authoritative during an in-flight network request or local lease grace period.

A brief retry-safe board restart is sufficient: retry the original operation ID, read persisted status, and
continue pickup. No shift reset or re-setup is needed. Keep enforcement off until a separately approved rollout.
