# Board management and permissions

Management screens appear only when enrollment.enabled is explicitly true and the host has an authoritative
schema-2 registry. Fresh init enables it. An omitted or false setting keeps existing pages unchanged. Existing
operators and watches never receive administration controls. Do not enable enrollment on a live host without
its own authorized rollout; merging code is not deployment.

## Authority

| Action                                       | Host administrator      | Board owner                        | Operator or watch       |
| -------------------------------------------- | ----------------------- | ---------------------------------- | ----------------------- |
| Create a board                               | Yes                     | No                                 | No                      |
| Read normal board content                    | Only through membership | Own authorized boards              | Their authorized boards |
| Rename, reorder, preview/archive             | All boards              | Own boards                         | No                      |
| Issue a bind invitation                      | All active boards       | Own active boards, non-owner roles | No                      |
| Issue a create grant through protected files | Yes                     | No                                 | No                      |
| Revoke a pending invitation or installation  | All                     | Own boards                         | No                      |
| Change membership, including coordinator     | Yes, after schema 2     | No                                 | No                      |
| Rotate an installation credential            | Protected host command  | No                                 | No                      |

Host administration is established by the local initializer/bootstrap, never by unauthenticated network setup.
A board owner is not a host administrator. Imported default roles remain effective until explicitly overridden
for a board. Installation credentials are also capped by their approved role and board binding; giving a
principal more membership does not silently increase an existing installation credential's scope.

The normal roles are viewer (read), commenter (read and comment), operator (operator tools), owner (captain
controls) and watch (read and scoped conduct notices). Coordinator is an explicitly adopted notices role;
it is not host administration or permission to act as an operator. Notice-specific restrictions still apply.
Ordinary token aliases, Tailscale identity mappings and preexisting permissions are not migrated by visiting a page.

## Boards

Create a board with a name, owner and optional advice setting. Its opaque ID is permanent. Rename changes the
label, not the ID, cards, installed bindings or saved history. Move up/down orders only boards the caller can
manage. Owner-facing lists have dense positions and never reveal hidden board names, counts or order values.
An administrator manages every registry board but must explicitly join one to read its cards and conversations.

Archive starts with a preview of active ownership, jobs, cards, messages, relay tickets, standing authorities
and CRM deliveries. If any remain, the normal archive is refused. An administrator can explicitly preserve
that unresolved work with a written disposition reason; this does not finish, delete or silently cancel it.
If the preview changes, preview again. Archived boards retain read access and narrowly permitted settlement
of existing evidence; they reject new work. There is no delete or purge button.

The older board.sh archive command archives Done cards. It is not board lifecycle archiving.

## Membership adoption after migration

After offline schema-2 migration, a host administrator can add, change or remove a principal's board role in
Manage boards. Every successful change appends its actor, board, principal, old/new role and timestamp to the
durable membership audit. An existing owner cannot be removed until a replacement is adopted. Imported boards
without an explicit owner can still be repaired through membership adoption.
Removal creates an explicit no-access override even if a legacy default role would otherwise grant access.

Coordinator is additive. Select operator+coordinator to retain operator rights, or owner+coordinator to retain
ownership. A host command can supply an array such as "role": ["operator", "coordinator"]. Selecting just
coordinator replaces the previous roles; it does not retain them implicitly.

The same operation is available as a host command, including when enrollment screens remain off. Save the
nonsecret request below in member.json, replacing the example board ID with the existing immutable ID:

    { "id": "BOARD_ID", "principal": "coordinator", "role": "coordinator" }

Then run from the active server release, using the protected administrator file:

    node registry-cli.js member --config /board/config.json --credential-file /private/admin.json --input /private/member.json

Use role null to remove access. Operators and watches cannot run this operation even against a board they can
read. The command talks to the running host; it is not a second writer. Do not edit registry snapshots by hand.

## Invitations and installation health

Prepare a request on the new operator's machine before issuing an invitation. A one-use grant is not a public
registration link. It fixes host, board, principal, role, protocol, installation and proof verifier, and expires
in five minutes. Owners cannot use a bind grant to transfer ownership, grant host administration or enroll a
principal matching the configured Owner identity or aliases. Pending lists omit expired and legacy invitations
without a revoke ID; legacy invitations expire within fifteen minutes.

Only the issuance response contains the plaintext grant. Later lists contain nonsecret invitation metadata
and a revoke ID, not the grant or its verifier. Copy once clears the private panel even before clipboard
completion; dismiss, page hide and navigation clear it too. A refresh cannot recover it. Revoke a lost invitation
before issuing another. The server stores only a hashed verifier, never that plaintext secret.

Enrolled installations are listed per managed board. Revoke refuses that installation's future reads/writes,
without changing another installation, legacy credential or board membership. The redacted doctor summary is
reported by that installation itself: it can report only its own known check names and statuses. It is useful
diagnosis, not host-verified attestation or proof of liveness. A timestamped old report remains visibly historical.

Administration forms require a same-origin CSRF token. Browser sign-in uses an explicitly selected protected
administrator file, then an HttpOnly, thirty-minute SameSite=Strict session cookie. No new secret enters local
storage, URLs, telemetry or server logs. Use HTTPS off loopback. Keep private grants/admin files protected,
clear operating-system clipboard history after transfer, and keep the browser and device trusted.
Bulk import remains a protected host command: an administrator browser cookie alone cannot authorize it.
Sign out revokes the session immediately. A loopback TLS proxy must have an explicitly configured HTTPS
enrollment.browserOrigin; it receives a Secure cookie. Without that setting the page accepts only its direct
origin, never an untrusted forwarded header.
