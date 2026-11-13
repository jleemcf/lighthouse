# Host registry, lifecycle and enrollment

The registry adds durable host administration without changing any existing token or claim. Enrollment is off
unless the host explicitly sets `enrollment.enabled` to true. An omitted setting remains off. The operator kit,
operator connections and existing homes need no update or reconnect for this release.

Owner identity uses exact principal matches only. An explicit ownerAliases setting must be an array of non-empty
strings; malformed types or empty entries refuse startup with a clear configuration error. Existing valid aliases
remain unchanged and display names never confer authority.

Watch notices use the authenticated principal, not just its name, in both tool calls and legacy NOTICE lines.
An installation needs a watch grant for the target board; watch memberships on other boards or a non-watch grant
cannot extend that credential. Legacy watchers keep their existing cross-board notice access on active boards.
Archived sources reject tool-call POSTs before recording calls, queued failures or shift activity, except direct
non-queued, non-dry-run relay results for an existing ticket owned by that board and caller. Those results can
settle preserved delivery evidence and replay the same receipt without touching the shift; they cannot create
new work. Archived targets reject notices through both protocols. Existing read access, including GET status,
remains available.

## Release contract and going live

This is a data migration followed by a board deployment, **both only at the host owner's word** for an existing fleet.
Merging the code does neither. Keep the server stopped between these steps; do not restart the old binary after
migration. The new release reads and preserves schema 1 or 2, declared by `release.json`'s `writes: [1, 2]`.
It never implicitly upgrades a store. A schema-1 runtime uses the configuration-backed compatibility projection
and refuses registry mutations. Schema 2 requires its matching durable registry; missing files fail closed.

1. Stage this complete schema-2 release outside the board home. At the authorized migration window, stop the
   board and keep all writers offline. Use the staged command, not an older release's command:

   `node registry-cli.js migrate --config /board-home/config.json --backup /private-backups/new-registry-backup`

2. The command checks the runtime/migration lease, managed PID and configured listening port; takes a full,
   flushed, private backup; retains a runnable schema-2 fallback under the home's releases directory; imports the
   registry once; records the backup/fallback receipt; then flushes and atomically replaces only the store's
   additive `schemaVersion: 2` marker. Histories, authors, board IDs, bindings and configuration are not rewritten.
   Stdout is only a redacted summary: schema, counts and completion booleans. No tokens, principals or paths print.
   A second successful invocation is a no-op. After interruption, rerun with a **new** backup destination; incomplete
   backups are not accepted as complete. A completed migration needs no new backup on retry.
3. At the authorized board-deployment window, run this release's normal `deploy-board.sh` against the same home.
   The deployer uses the retained schema-2 fallback when the pre-migration active release cannot read schema 2.
   A failed activation selects compatible code, never the pre-migration data. Preserve the configuration's
   existing access and leave enrollment off. No live command is part of the test or review procedure.
4. **Rollback after migration only to a release declaring schema 2.** Keep at least one earlier compatible
   schema-2 build available; the migration retains the initial baseline before activation, and subsequent releases
   retain their compatible predecessor. Never prune the last compatible baseline. A schema-1 release contract is
   refused by the release gate, including rollback. Never bypass that gate by directly running an old server.
   Never restore a pre-migration store over newer work. Full backups are for isolated, deliberate disaster recovery,
   not routine rollback; preserve current data and its registry together before any such recovery decision.

The backup includes the complete home (configuration, claims, keys, attachments, archives, retained releases and
any existing registry) plus configured external store, attachments, archives, VAPID, CRM key, policy and judge-key
files. `complete.json` privately maps source paths to copied trees. The destination must be new and outside every
source tree. Symlinks are materialized, cyclic links and nonregular files are refused. Service managers and old
binaries that do not participate in the lease must remain disabled throughout the offline window. POSIX files
are 0700/0600; Windows storage is current-user-only ACL protected. Unsupported permissions fail closed.

Runtime and registry writer leases record the PID. On Linux they also record the kernel boot identity and
process start time, so a reused PID after an unclean stop is reclaimed without mistaking a live writer for stale.
Windows and legacy PID-only leases conservatively refuse recovery while that PID exists. A refusal names the
lock file: stop every writer and service restart loop, verify they have exited, then remove only that stale lock.
Never remove a lock merely because its PID belongs to an unexpected process while another writer may run.

## Local authority and protected handoffs

Run these commands as the board host's account. Paths may be supplied as arguments; credentials never may.
The first administrator can be created only by the local command, never by a network endpoint:

`node registry-cli.js bootstrap --config /board-home/config.json --principal host-admin --output /private/admin.json`

Keep the resulting file private. A board owner is not a host administrator and cannot create boards, import the
global store, reconcile configuration, change membership or rotate installations. Owners can rename, reorder,
preview/archive, issue non-owner bind grants and revoke invitations/installations on their own boards.
A host administrator can manage every board. See [the permission table](../../docs/board-management.md).
The administrator credential alone grants no board membership, hidden-board reads or operator authorship.
Normal board routes require that principal's actual membership, just like every other principal.
Administration from a browser requires same-origin requests and a token from `GET /api/registry/csrf` in the
`X-Lighthouse-CSRF` header. CLI bearer requests do not use ambient cookies. Raw new credentials are bearer-only,
never query strings or cookies. Private page sign-in exchanges the selected administrator file for a thirty-minute
HttpOnly SameSite=Strict session cookie; sign-out revokes it and reloads the page. Every new administration path has
bounded limits (20 mutations and 120 reads per minute/address, 200 requests globally) and requires TLS off loopback.
For a loopback TLS-terminating proxy, explicitly configure enrollment.browserOrigin as its exact HTTPS origin;
only loopback proxy requests use that origin, and the administration cookie becomes Secure. Forwarded headers
are not trusted for this. Restrict the proxy's upstream to loopback and protect access to the endpoint.
Enrollment itself refuses browser-origin requests.

For a new installation, on that installation's machine:

`node registry-cli.js prepare --output /private/prepared.json --request /private/installation-request.json`

Transfer only the request file to the host using a private file channel. It contains an installation ID and a
proof verifier, not the installation's private proof or future credential. In a host-side input JSON file, combine
those fields with `scope`: action `bind` or `create`, boardId (bind only), principal, role, protocol and installationId.
A create input also supplies a `board` definition with name and owner membership. The host ID, a new board UUID
for create, and the final definition are fixed when issuing the grant. Default lifetime is 300 seconds, maximum 900.

`node registry-cli.js grant --config /board-home/config.json --credential-file /private/admin.json --input /private/grant-request.json --output /private/grant.json`

Transfer the grant file privately to the installation; do not paste it into chat, terminal history, URLs or logs:

`node registry-cli.js enroll --config /local/config.json --endpoint https://board.example.invalid --prepared /private/prepared.json --grant-file /private/grant.json --output /private/binding.json`

Retry with exactly the same files after a lost reply. The host durably selects the grant consumption, installation,
board/membership and operation receipt in one transaction before replying. A retry must prove the same installation,
grant, complete scope, operation and credential; it receives only nonsecret metadata. Bare operation IDs cannot
recover a receipt. A bind grant never transfers ownership. Installation credentials are independent and board/role
scoped; rotation and revocation leave existing configuration tokens alone. Bootstrap has no network endpoint.
The page's authenticated grant endpoint returns the handoff only once; context lists contain no plaintext grant.
If a local handoff is interrupted before commit, retain the protected orphan for diagnosis
and issue again with a new output path; it is not a valid consumed enrollment.

## Lifecycle CLI

For `create`, `rename`, `reorder`, `preview`, `archive`, `revoke`, `rotate`, `revoke-grant` or `member`, pass `--config`,
`--endpoint`, `--credential-file` and `--input` file paths. Inputs are small JSON objects:

- Create: `{"board":{"name":"New board","access":{"captain":"owner"},"protocol":"tools"}}`.
- Rename: `{"id":"board-id","name":"New label"}`. Reorder: `{"id":"board-id","order":10}`.
- Preview: `{"id":"board-id"}`; copy its nonsecret confirmation into the archive input.
- Archive: id and confirmation. Active ownership, jobs, open cards, unresolved decisions/messages/prompts,
  unused relay tickets, active authorities and queued CRM deliveries block it. Only a host administrator can
  explicitly preserve those obligations with `{"disposition":{"action":"preserve","reason":"park intact"}}`.
  Archive keeps history and read access; new writes/background scheduling stop. Existing caller-owned relay
  delivery evidence can still settle through the narrow result path described above. There is no destructive delete.
- Revoke: `{"installationId":"installation-uuid"}`. Rotate additionally takes a fresh credential in the
  **protected input file**, never a command argument. Prepare/store that value locally in a private editor/tool;
  neither the response nor retry returns it. Revoked installations stay revoked after rotation.

`reconcile` is local: use config and administrator credential file. It reports IDs and differing field names,
including credential-setting differences, never values, and changes nothing. After migration the configuration is
bootstrap defaults only: registry edits always win. All board discovery, access checks, notifications and scheduled
consumers use the shared projection. Secrets are kept in the protected credential snapshot, not board metadata.

After migration, config edits no longer control existing board names/display names, order, access/owner roles,
protocol, feature settings (including steward behavior), credential settings or defaultRole. Startup logs a redacted
reconcile warning when these differ: board IDs and field names only. Use rename/reorder for labels/order and
preview/archive for lifecycle; when enrollment is enabled, a scoped bind grant can add a non-owner membership.
The schema-2 host-admin member command explicitly adopts a principal's role, including coordinator or null
(no access), with a durable audit entry. At least one owner must remain. See [membership adoption](../../docs/board-management.md#membership-adoption-after-migration).
Protocol, features, credential settings and defaultRole are not automatically adopted; settle those values before
migration. Lifecycle archives remain registry-only, not config changes.
Schema-1 compatibility startup keeps legacy role/protocol/ID/name tolerance; explicit migration validates them.

Push device lists and switches are scoped to the authenticated principal and, for enrolled credentials, its
installation. Devices subscribed under a different principal no longer appear in that principal's bell sheet.
This prevents one board owner from listing or changing another owner's devices. Existing subscriptions remain.

`board.sh archive` remains the separate Done-card archiver, not the board lifecycle command. The
[newcomer guide](../../docs/getting-started.md) covers the page and guided operator kit. Ownership handoff and
session fencing remain separate work. Existing homes follow [the upgrade guide](../../docs/upgrading.md).
