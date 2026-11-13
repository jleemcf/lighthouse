# From an empty host to a first shift

Lighthouse is a local board and an operator kit. The host administrator approves each board and operator scope.
Start with core tools. Firstmate, transcript collection, an advice steward, watches, CRM and paid
services are optional and stay off until explicitly configured. Enrollment is not exclusive session ownership;
keep one acting operator per board until handoff is supported.

## 1. Initialize a new host

Use Node 22+, Python 3.10+, Git and a checkout at the reviewed release commit. Host commands run in Linux or WSL
with bash, flock, setsid and curl. A complete firstmate integration still needs Windows with Git Bash and WSL.
Choose an absent or empty host home outside the checkout. Never run init on an existing home.

Run in Linux or WSL, replacing FULL_COMMIT_SHA with the full reviewed release commit:

    node lighthouse/lighthouse.cjs init --home "$HOME/board-home" --port 7711 --release FULL_COMMIT_SHA
    bash "$HOME/board-home/board.sh" start
    node lighthouse/lighthouse.cjs doctor --home "$HOME/board-home"

The initializer installs the pinned first release, creates schema 2, and saves the administrator credential in
the protected home/admin.json file. It does not start or configure a system service. The board binds loopback;
open http://127.0.0.1:7711 on the host. For a remote browser/operator, first arrange a trusted private HTTPS
endpoint. HTTP off loopback is refused by enrollment. Init does not configure a proxy or internet exposure.
For a TLS-terminating proxy on the host, set enrollment.browserOrigin in the private config to the exact HTTPS
origin (for example https://board.example.invalid), with no trailing slash or path. Only loopback upstream
requests use that explicit origin. The session cookie is then Secure, and the local HTTP page no longer accepts
administration forms. Do not enable arbitrary forwarded identity/origin headers.

## 2. Create the first board

The page offers a short setup guide instead of an empty board. Select the protected admin.json file with its
file picker to sign in. Do not print or paste the credential. The browser exchanges it for a thirty-minute,
HttpOnly, same-site administration session; it never puts that credential in local storage or a URL.
Sign out of administration when finished; that revokes the session and reloads the page.

Choose a board name and its owner principal. Use the signed-in administrator principal if the same person
should also read and use this board; host administration alone does not grant board membership. New boards
use tools mode. Leave advice off unless a host runner is already configured. IDs and history do not change
when a board is renamed. The page's Manage boards button returns to these controls later.

The new host's administrator principal and configured Owner identity are separate. Board membership lets the
administrator post ordinary questions and use board controls, including prompt Send. Global, the typed /yolo
command and free-word relay approval still require a page identity matching the configured Owner. An owner
role on a board also allows a page identity to record standing authorities, including relay and yolo-scoped
authorities. Assign that role deliberately; host administration alone grants neither board access nor these controls.

## 3. Prepare an operator installation

Use an empty private operator home outside the checkout on the operator machine. From the release checkout:

    node lighthouse/lighthouse.cjs operator setup --home OPERATOR_HOME --host http://127.0.0.1:7711 --trust --prepare

Use the private HTTPS address instead if the operator is on another machine. Trust must be deliberate; do
not accept an unknown host. Setup discovers Node, Python, the platform and optional integrations. It creates
installation-request.json in the private home without activating optional adapters.

Privately transfer only installation-request.json to the host administrator or board owner. It contains the
installation ID and a proof verifier, not the private proof or credential. Never send prepared.json or
credential.json; they remain on the operator machine.

## 4. Approve exactly that operator

In Manage boards, choose Invite an operator on the correct board. Select the request file, choose a principal
and role, then issue a one-use grant. Board owners can invite operators, watches, viewers and commenters only
to boards they own. Host administrators can manage membership separately, including coordinator notices.

The private invitation panel shows the grant once. Copy once and clear removes it immediately, as do dismiss,
closing management, hiding the page and leaving it. It is never recoverable from a later board read. If the
clipboard operation fails, revoke that pending invitation and issue another; do not retry an uncertain copy.
Clipboard history is controlled by the operating system: clear it after the private transfer.

Use a private file channel to save the copied JSON as grant.json with mode 0600 on Linux/WSL, or a current-user-only
ACL on Windows. Do not use an echo command, command argument, URL, chat or shared clipboard to transfer it.
The grant expires after five minutes and is scoped to the chosen host, board, role, protocol and installation.
The [protected-file host command](../lighthouse/server/REGISTRY.md) is available when a browser clipboard is unsuitable.

Complete setup on the operator machine using the same prepared home:

    node lighthouse/lighthouse.cjs operator setup --home OPERATOR_HOME --host http://127.0.0.1:7711 --trust --grant-file PRIVATE_GRANT_FILE
    node lighthouse/lighthouse.cjs doctor --home OPERATOR_HOME

Only paths appear in these commands, never secrets. A lost enrollment reply is retried using that home's
original operation identity and proof. Do not start a second home to recover it. The result is a private binding,
a credential reference, core tools/hooks and a redacted doctor report. Existing homes use update, not setup.

## 5. Verify and begin

Refresh Manage boards to see the installation and its last reported doctor checks. No report means unknown,
not healthy; an old report is historical, not proof of a currently connected process. Run doctor again locally
to refresh it. Setup/doctor publishes only known check names and ok/fault statuses, never local paths or details.

Start Claude in the operator home, approve its local MCP registration and reconnect if requested. Read the
installed operator brief and full board status. Run bash shift.sh start from that home before arming Monitors.
The first shift should establish presence and read the board, not send an unapproved external instruction.
Tools need a connected MCP session; a green doctor is not evidence of an acting or exclusive operator session.

If doctor reports a fault, fix it locally and rerun. Optional services are not prerequisites for core setup.
If an invitation expires, revoke it and issue a fresh one for the same prepared request. Revoke a lost or retired
installation from the page; that credential stops working without revoking other homes or legacy credentials.

## Existing installations and advanced setup

Use the [upgrade guide](upgrading.md) for existing hosts and homes. It preserves their settings and never reruns
onboarding. See [board management and permissions](board-management.md) for roles, safe archiving and adoption.
The original hand-filled configuration path remains the advanced appendix in
[the operator kit setup guide](../lighthouse/operator-kit/SETUP.md); it is not required for a new core installation.
