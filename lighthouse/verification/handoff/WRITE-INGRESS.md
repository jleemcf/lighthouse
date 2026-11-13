# Write ingress inventory

Scope: tools-mode session ownership with enforcement enabled. Unlisted mutations in the three ordinary route
groups fail closed: mutation-routes.route does not dispatch a non-read request unless its path is inventoried.
The outer routes.js mode restrictions still apply. Off/line boards keep their old admission and dispatch rules.

## Acting-operator and collector entry points

All rows below enter routes.handle -> mutation-routes.route -> store.transact -> mutation-routes.authorize twice
(admission and precommit) -> ownership.acting, with rollback on refusal. Body reads finish before transaction
admission. The authenticated identity contains source=session, board, sessionId, installationId, explicit scope
and exact request epoch; no body can substitute its principal or destination. tools tokens already restrict most
direct routes, but a broader legacy lines token cannot bypass the new boundary either.

| Ingress | Durable core | Required scope / additional restriction |
| --- | --- | --- |
| POST boards/:id/calls, all tool names and batches | toolcalls-request.handleCalls | operator holder + epoch |
| board_relay within calls | toolcalls-relay | operator + existing owner approval; ticket binds session/epoch |
| _relay_result within calls | toolcalls-relay | original ticket capability; no queued/dry evidence exception |
| queued calls / MCP outbox drain | toolcalls-request.applyCalls | holder + matching originSessionId/originEpoch |
| POST boards/:id/status | routes-operator / toolcalls | operator; even receipt-generating POST is fenced |
| POST boards/:id/shift | shift.transition | operator; captain may explicitly change shift, not impersonate it |
| POST boards/:id/heartbeat | ownership.renew / shift.heartbeat | operator + attached process + original live lease |
| POST boards/:id/activity | routes-operator | operator holder |
| POST boards/:id/events | grammar / notes / replies | collector credential for current holder and epoch |
| POST boards/:id/chat | routes-operator | collector; owner words stay collector-provenanced |
| POST boards/:id/transcript | transcript | collector |
| POST boards/:id/instruments | routes-operator | collector |
| POST comments | routes-messages | operator, human comment rights, or separate coordinator notice scope |
| POST bundles | routes-messages | operator or human comment rights, each resolved target checked |
| POST global | routes-messages | owner page only; writable targets, not claimed body.board |
| POST attachments | routes-messages | session board or explicit board header; unbound legacy staging is private |
| PUT/PATCH cards/:id | card-transitions | actual existing card board wins over conflicting body.board |
| DELETE cards/:id | routes-cards | actual existing card board |
| POST cards/:id/resolve | prompt-transitions | human comment rights, never acting operator |
| PATCH comments/:id | routes-cards | actual comment board |
| POST comments/:id/decide | prompt-transitions | human comment rights, never acting operator |
| POST boards/:id/archive | store.archiveDone | holder/captain + transaction; auxiliary archive files |
| POST boards/:id/authorities | toolcalls-authority | captain only; no legacy chief-developer shortcut |

T.* handlers are private to toolcalls.js. They are reached only through handleCalls, which repeats the same
authorization and opens its own store transaction when called by a helper outside HTTP. Batches cannot smuggle
a relay or a nested batch. Exported createAuthority and yoloSwitch similarly require captain scope and a
transaction on an enforcing board. yoloSwitch's ordinary callers are the separately authorized human comment
and global-message paths. receipt/ensureSid/reindex/yoloOf only read or maintain derived indexes, not acting rights.

## Ownership control plane

GET ownership is read-only. POST ownership is routed before legacy mode admission and calls ownership.control;
each successful operation and its audit/response/idempotency record commit in one store.transact.

| Action | Scope | Fencing |
| --- | --- | --- |
| register | captain page identity, board owner membership | explicit session/installation/principal; hashed random credential |
| nominate | captain | exact expectedEpoch; bounded expiry; existing nominated session |
| cancel | captain | exact expectedEpoch and nominationId; nomination must still be pending |
| activate | captain | live holder, complete readiness barrier, no unsettled legacy tickets |
| acquire | registered nominated operator session | expectedEpoch CAS, exact nomination, live nomination, one operation winner |
| attach / detach | registered operator session | exact header epoch; live current holder once enforced |

Captains retain their independent authority; operator credentials never acquire captain scope. An expired lease
does not erase the holder, reset/end the shift or auto-promote a successor. Only another captain approval can
nominate recovery after that loss; a prior planned nomination is insufficient. Acquisition rechecks nomination
expiry and recovery approval before durable commit. Same-operation retries use saved results and cannot increment
the epoch twice.

## B2 checkpoint and transfer controls

POST boards/:id/handoff is a separately inventoried control plane, not ordinary operator work. It requires
tools mode, enforced B1 ownership/readiness and the explicit per-board handoffEnabled switch (absent/off by
default). Its operation result, checkpoint/read receipt, ownership and audit use the same atomic store snapshot.
Owner-page calls retain existing session, CSRF and Origin protection. Successor credentials are used only for
authorized-home authentication and are removed before durable operation hashing/storage; no query credentials.

| Action | Principal and fence | Durable effect |
| --- | --- | --- |
| prepare | captain or live holder; exact epoch | named successor, holder retained, draining |
| checkpoint / seal | live outgoing holder; exact epoch and transfer | reference schema; fresh quiescence check |
| accept | registered successor; sealed read proof, expected epoch, outgoing lease | CAS once; pickup, epoch +1 |
| read / pickup | successor/current continuing session; exact epoch | live records + deltas; board-scoped revision ack |
| cancel | captain or holder before commit; current pending-effects digest | same epoch; restore inherited holds |
| continue | live current holder; reason compacting/reconnecting | same-session checkpoint/pickup; no epoch change |

ownership.holding allows only heartbeat and attachment in draining/pickup; ownership.acting still rejects work.
ownership-control rejects the older nominate/acquire/cancel route around an active B2 holder. New steward claims
and relay ticket issuance check handoff dispatch holds; already running steward results remain settleable.
shift.sweep preserves the uninterrupted shift while handoff awaits pickup; lease loss never grants acceptance.
The original firstmate target remains pinned, with cross-installation dispatch held rather than migrated.
handoff-faults.test.js kills real protocol operations at four disk-write stages; checkpoint-mutations.cjs replays
the twelve B2 model faults and one kit receipt-pause mutant on external scratch copies. Read receipts do not
persist live board copies. Missing context blocks a clean seal; only actual transfer seals add effect holds.
Continuation and cancel keep preexisting holds without inventing new ones for the same holder's pending effects.
The kit drains ticket evidence before pausing its ordinary outbox. GET handoff
context also refuses collector, steward and shadow principals. HANDOFF-CHECKPOINT.md names limits.

## Independent scopes and non-acting writes

These paths cannot perform arbitrary acting-operator work; the ordinary fenced boundary remains required for
that work even when the same named principal has multiple memberships.

| Ingress | Separate boundary and provenance |
| --- | --- |
| board_notice tool | source acting fence; web.canNotice checks source/target read and target watch scope |
| human page messages/uploads/resolve/decide | route-local role and human provenance; never operator authorship |
| POST comments kind=notice | web.isCoordinatorOn + routes-messages coordinator provenance; notice only |
| POST boards/:id/steward, advice/:id/put | steward-routes requires human owner/reader scope, not operator API |
| steward next/result/heartbeat/review/diagram | explicit steward token/mode + board/job leases; no tool-call scope |
| registry/enrollment routes and CLI | registry's durable transaction, explicit admin/owner/enrollment scopes |
| session calling registry/enrollment | rejected before any administration action |
| POST import / CLI import | host administrator; activated stores reject import, ownership payloads always refused |
| CLI archive | activated board rejected outside fenced server transaction |
| push subscriptions/settings | own subscription/owner preferences, never board task/shift/authority writes |
| POST claim | one-use host-created claim capability; only token exchange, not session acquisition |
| POST client-error | diagnostic log only; no task/shift mutation |
| shift sweep, presence/lapse, CRM poll/outbox, steward timers | server-derived or integration-scoped transitions |
| startup normalization / lazy short IDs / read indexes | derived bookkeeping, not a session or authority grant |
| board release / export / backup | host lifecycle/read scope; no holder selection; schema-3 downgrade refused |

Registry and integrations are trusted server code with their existing explicit sources. B1 does not pretend to
fence an administrator editing files, a second server process, the CRM service, or an already-dispatched external
instruction. B3/B4 own dispatch adoption and helper generations; no new helper activation is introduced here.

A headerless non-session upload stages an uploader-private file, not a board change. Its eventual comment/call
reference still enters the board's fence; membership in an unrelated enforcing board cannot disable uploads
for a legacy or watch home. Explicit session uploads and an explicit board header remain board-fenced.

## Executable proof

- ownership-ingress.test.js sends missing, stale, relieved, watch, legacy and collector credentials to every
  acting path above (including relay, receipt, batch and drain), checks refusal and unchanged public state.
  It also attacks steward/import paths, route/body target substitution, slow bodies, racing acceptors,
  stale outbox provenance, valid separate scopes and real late-ticket evidence after relief.
- The same file exercises an expired holder against each path's common commit authorizer; ownership.test.js
  expires a request after admission and after renewal but before commit, proving rollback and no effects.
- ownership-helpers.test.js attacks exported engine/authority helpers and ownership controls directly, including
  wrong scope, missing session, legacy token, stale epoch, relief, membership removal and captain separation.
- ownership-persistence.test.js crashes a persistence-writer child at written/flushed/renamed/committed stages
  using synthetic epoch/audit/operation values. Separate tests retry real ownership operations after in-process
  cold reload, test poisoned disk failure, and preserve preexisting legacy saves; not an end-to-end HTTP crash.
- Enforcement-off HTTP scenarios and the entire existing suite prove old kit/token/line-board parity. Kit
  session-identity tests prove no shared-home inference and explicit reconnect/attachment/outbox provenance.
- mutations.cjs removes each modeled guard on external scratch copies, observes the corresponding real test
  failure, then checks the unmodified code again. Run the executable checks to verify model bounds and replay results.

When adding a route, helper export, scope exception or side effect, update this inventory and the matrix before
shipping. Do not add a legacy bypass to make activation convenient.

The kit handoff.fromHome adapter persists each complete checkpoint request before POST, not just its operation
ID. Atomic exclusive publication makes competing retries share one inventory; reconnect reads the same request.
Changed caller arguments are refused locally. Planned-handoff retries also refuse changed queue/relay references
before sending, requiring a fresh operation; continuation retries preserve their original inventory without holds.
handoff-retry.test.js and checkpoint-retry/changed-journals scratch mutations cover timestamp-only lost answers
and an outage followed by new queued work. This is not a new board ingress or dispatch ledger.

Kit intercept leaves every dry-run board_shift call on the legacy rehearsal path before capability lookup or
checkpoint inventory. The enabled-board HTTP regression compares complete durable snapshots for compacting
and compacted; the dry-run mutant removes this guard and must fail. Legacy lazy read indexes are materialized
before the snapshot, not treated as operator handoff mutations. No handoff POST or phase/epoch change is allowed.
