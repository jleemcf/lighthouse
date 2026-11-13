# Tools-mode session identity and activation

This is the ownership foundation for the prepare/seal/accept workflow. Existing installations need no
setup change. Enforcement is **off by default**, per board; line-mode boards never enter this protocol.

## Ownership and credentials

The server owns one record per tools board: holderSessionId, installationId, monotonically increasing epoch,
leaseUntil, phase, successor nomination, handoffOperationId and attached processes. Logical sessions are not MCP
processes. Several processes may explicitly attach to the same registered session. Reading a common home never
creates, discovers or acquires that identity. The persistent shift has a separate id; transfer preserves its
state and since. A running legacy shift receives an id at explicit activation without changing since.

GET /api/whoami advertises capabilities.sessionOwnership = session-epochs-v1. GET /api/boards/:id/ownership
returns a public projection without credential hashes. POST to that ownership route requires a private Bearer
credential, no query credentials or browser Origin, and TLS off loopback. Every request has an operationId;
repeat the same operation and body after a lost answer. Reusing an id for different input fails.

Captain-only controls register an explicit session/installation/principal and random credential, nominate a
successor at expectedEpoch with a unique nominationId and bounded expiry, cancel that nomination, or activate
enforcement. Registration stores only a SHA-256 credential hash. Existing registered installations retain their
revocation/version/membership checks; the captain may explicitly bind a legacy installation alias. A collector
has its own credential, scoped to the same registered session, principal, installation and board.

A session acquires only the captain-nominated identity, using nominationId and expectedEpoch. This atomic CAS
increments the epoch exactly once, renews the lease and records the operation and audit together. Two different
accept operations against the same nomination yield one winner. An expired, cancelled or superseded nomination
cannot win. Acquisition never chooses a successor on lease expiry. A lost holder cannot reacquire itself: every
loss needs another captain nomination approved after that loss and an explicitly registered non-current session.
The captain may nominate a previously relieved logical session; it cannot nominate or promote itself.
An earlier planned nomination cannot silently turn into recovery. Acquisition rechecks both nomination expiry
and that approval deadline at the durable commit boundary.

Ordinary session requests carry Authorization: Bearer plus X-Lighthouse-Epoch, an exact nonnegative integer.
Attachment also names a distinct processId and protocol. Heartbeat names the logical session and that attached
process. Renewal cadence is 60 seconds; explicit sessions retry transient failures every five seconds without
changing their identity or epoch. Legacy cadence stays unchanged. Loss is three minutes on the server clock.
Restart does not extend a lease: a genuinely expired lease still needs fresh captain approval. Expiry removes
acting rights,
not the shift, its accepted work or its identity. The existing lapse twelve hours after loss is unchanged.

## One fenced mutation boundary

mutation-routes.js reads the complete body/upload before opening a synchronous store transaction, then resolves
the real target from the URL/card/comment, not a conflicting claimed board. Authorization runs at admission and
again just before durable commit. Each enforcing target needs the holder session, installation, scope, epoch,
live lease and working phase. Registry membership/revocation is refreshed at commit. A renewal additionally keeps
its admission lease deadline: extending the in-memory lease cannot excuse expiry before renewal commits.

Human page asks, uploads, bundles, Global and prompt decisions retain their own role/provenance checks, not
operator credentials. Global targets only writable boards. A session's membership is capped at operator on its
own board, with cross-board reads limited to explicit watch membership. Notice target scope never exempts the
source board's acting write. Captain actions, collector telemetry, watch notices, coordinator notices and steward
jobs retain separate, explicit roles and provenance. None grants a generic legacy-token exception to
acting-operator work. Direct
tool-call and authority helpers repeat their guards; queue drain must match originSessionId and originEpoch.
See verification/handoff/WRITE-INGRESS.md for the complete ingress inventory and its negative proof.

Headerless legacy/watch uploads stage private files belonging to their uploader, not a write to every board
they can see. Referencing that file later in a board comment or call still needs the board's authorization.
Explicit-session uploads and uploads with an explicit board header are checked against that board.

Relay authorization returns a private ticket-bound evidenceCapability, stored hashed on the server and retained
in the kit journal before dispatch. A relieved holder may read and settle that already-held ticket using its
original session, ticket epoch and capability. It cannot renew, instruct, edit cards, end the shift, drain an
ordinary queue or self-promote. Settlement does not renew ownership or liveness. This is evidence settlement,
not dispatch adoption, exactly-once delivery, cancellation of in-flight work or firstmate-target migration.

## Persistence and recovery

store.transact is the single-writer boundary. Ownership, audit, idempotency, mutation results and deferred
responses share one complete JSON snapshot. A sibling temporary file is written, fsynced, closed and renamed
before acknowledgement; POSIX also fsyncs the directory. An interrupted process recovers either the previous
complete snapshot or the new complete snapshot, never a partial epoch. A disk error rolls memory back, suppresses
effects/responses and poisons that writer until restart. A lost acknowledgement is retried against the durable
operation record. Failed authorization preserves unrelated pending legacy saves.

Assumptions: one server writer; same-filesystem atomic rename; working local storage. On Windows the existing
directory-flush helper is a no-op, so tests prove process-crash recovery, not storage-controller or sudden-power
loss durability. Attachments/archive payloads are auxiliary files; JSON metadata is their visibility boundary.
No cross-machine filesystem writer, distributed lock, replicated consensus or zero-downtime deploy is claimed.

Transactions clone and synchronously fsync the complete store, including explicit-session requests before
activation. Legacy requests on enforcement-off boards retain their existing debounced path. Store size affects
transaction latency. Audit/idempotency retention and stale-process compaction need an explicit later policy;
records must not be dropped in a way that permits replay. A legacy installation alias has no individual revoke
control in B1: removing its principal's membership revokes its sessions, while enrolled installations also retain
their existing revocation/version controls.

## Readiness and non-disruptive rollout

Activation is explicit, tools-only and per board. See [HANDOFF-ACTIVATION.md](HANDOFF-ACTIVATION.md) for exact
owner commands, rollout order and lossless deactivation. The supplied processIds must match every attached
process, including stale attachments: reconnect or explicitly detach stale processes before proceeding.
Every process must speak session-epochs-v1 and the matching handoff-activation-v1 kit/server protocol,
load the complete installed MCP, and publish a migrated journal at the current holder/epoch. Observed legacy
writers block the barrier. Unsettled legacy relay tickets must be settled first; previously used tickets do not block.
The server cannot detect a completely silent external process: confirmAllWriters is the captain's attestation
after updating/reconnecting every tool writer. Unknown writers are rejected, not trusted, after activation.

The kit opts in only through LH_OPERATOR_SESSION_ID, LH_SESSION_CREDENTIAL_FILE and LH_SESSION_EPOCH. The private
JSON file explicitly binds sessionId and credential; private storage and file permissions are checked. A new
process uses a distinct random processId; reconnect/compaction retain the explicitly supplied logical identity.
Without these settings all legacy requests and homes behave as before until explicit activation of their board.
The server still accepts old kits while enforcement is off. Shipping this code activates nothing.

Activation now writes schema 5; older releases must not overwrite that store. The current release reads and
writes schemas 1–5 but keeps the default schema 1. Deactivation restores legacy authority on the current binary,
not an old code/schema downgrade: retain checkpoints, accepted work, audit and permanent deduplication history.
The B5 barrier atomically enables ownership, handoff, dispatch ledger and per-loss owner-approved recovery.
Old configuration switches and direct ledger activation cannot bypass it on a running server.

## Tool process commands

Run node lighthouse-mcp.cjs without arguments for MCP stdio. Register it at local project scope only; never grant
tools to unrelated sessions through user-wide registration. The existing shell modes remain supported:

- call <tool> '<json args>': make one tool call without MCP.
- shift start|end: confirm the explicit board shift edge; shift.sh owns local helpers.
- relay-reconcile <id> --delivered|--not-delivered --evidence '<evidence>': settle an uncertain send.
- check [--project <dir>]: check local registration and hooks.
- install-hooks [--project <dir>]: write the project's .claude/settings.local.json hooks.
- here: check the configured session folder.
- hook precompact|sessionstart: run the existing compaction/reconnect hooks.
