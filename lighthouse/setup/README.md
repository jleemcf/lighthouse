# Fresh installations and diagnosis

Start with [the newcomer guide](../../docs/getting-started.md) for the complete path from an empty host to a
first working operator. The page now provides private administrator sign-in, board creation, copy-once operator
invitations and doctor summaries. See [board management](../../docs/board-management.md) for permissions and
[upgrading](../../docs/upgrading.md) for existing installations. The host commands below are also useful for
advanced protected-file approval when a browser clipboard is unsuitable.

Use a release checkout, Node 24.16.0+ on Windows (22+ on Linux/WSL), Python 3.10+ and Git.
Host commands run in Linux or WSL with bash, flock,
setsid and curl. Core operator tools run on Windows or Linux; WSL, firstmate, transcript collection, advice,
paid judgments and watchers are optional adapters. Setup discovers their presence and leaves them off.
The full firstmate adapter remains Windows with Git Bash and WSL. Setup never configures firstmate itself.

## New host

From a checkout at a reviewed full release commit, run inside Linux/WSL:

```sh
node lighthouse/lighthouse.cjs init --home "$HOME/board-home" --port 7711 --release FULL_COMMIT_SHA
bash "$HOME/board-home/board.sh" start
node lighthouse/lighthouse.cjs doctor --home "$HOME/board-home"
```

An absent or empty home needs no copied files, filled config or legacy migration. Init reads the server files
from the exact Git commit, installs a retained release and current symlink, initializes schema 2 and its registry,
and uses the registry's local bootstrap to save `admin.json` privately. It starts no service. The fresh config
binds loopback, trusts no identity headers, enables enrollment and disables optional paid/project integrations.
Use a separately configured HTTPS endpoint for enrollment off loopback; this command does not set up a proxy.
No existing home's enrollment setting changes. The optional `--release` must equal checkout HEAD; omitting it
pins that HEAD automatically. Use a complete release clone with Git metadata, not an exported directory.

Init refuses every populated home before writing or changing permissions. If init itself is interrupted, retain
that partial home for diagnosis and start with another empty destination. Never run init as an upgrade.

## New operator and private approval

The default operator home is `~/lighthouse-operator`. `--home` selects another empty private directory. In the
operator's machine, run from the release checkout (PowerShell supports these same arguments):

```sh
node lighthouse/lighthouse.cjs operator setup --home OPERATOR_HOME --host http://127.0.0.1:7711 --trust --prepare
```

Without arguments in a terminal, setup asks for the host, explicit trust approval and a protected grant-file path.
`--trust` records that explicit approval for unattended use. Credentials and grant secrets have no command-line
options. This protected-file flow is the supported alternative to entering a secret through a masked prompt.
The home, Node, Python, platform, available WSL distro, Claude transcript location and conventional firstmate
route location are discovered; `--distro` selects an installed WSL distro if needed. A missing transcript folder
is normal before the first Claude session. No integration is activated merely because it was found.

Privately transfer only `installation-request.json` to the host administrator. It contains an installation ID and
proof verifier, not a token. The host creates a private JSON input combining those two fields with:

```json
{
  "scope": {
    "action": "create",
    "principal": "operator-workstation",
    "role": "operator",
    "protocol": "tools",
    "installationId": "the ID from the request file"
  },
  "board": { "name": "My board", "access": { "owner": "owner" }, "protocol": "tools" }
}
```

Include the request's top-level `proofVerifier` too. For an existing board use `action: "bind"` and its `boardId`
in scope, omitting `board`. This is the board selection: the host fixes the board, principal and role in the grant;
an ordinary operator cannot enumerate hidden boards or create an unapproved one. Create grants establish a new
board, bind grants never transfer ownership. Host administration alone provides no captain/browser membership.
See [the registry guide](../server/REGISTRY.md) for authorization. On a fresh host, select admin.json in the
page's protected file picker and explicitly make the administrator principal a board owner if it should also
read cards. Existing browser access is unchanged. For a manual create grant, choose the intended owner in the
board definition; host administration by itself still grants no board content access.

Write that input with POSIX mode 0600 or a Windows current-account-only ACL, then on the host:

```sh
node lighthouse/server/registry-cli.js grant --config BOARD_HOME/config.json --credential-file BOARD_HOME/admin.json --input PRIVATE_INPUT.json --output PRIVATE_GRANT.json
```

Transfer the protected grant file through a private file channel. Reapply private permissions after a copy:
`chmod 600 PRIVATE_GRANT.json` on Linux/WSL. In Windows Command Prompt, use
`icacls PRIVATE_GRANT.json /inheritance:r /grant:r "%USERNAME%:F"` and remove any other explicit grants.
Grants expire in five minutes by default. Never paste file contents into chat, URLs, command arguments, logs or shell history.
On the operator machine:

```sh
node lighthouse/lighthouse.cjs operator setup --home OPERATOR_HOME --host http://127.0.0.1:7711 --trust --grant-file PRIVATE_GRANT.json
node lighthouse/lighthouse.cjs doctor --home OPERATOR_HOME
```

If a response is lost, rerun with the same home, host and files. Setup keeps the installation proof and credential
and retries the same operation; the server returns only nonsecret metadata. Interrupted kit installation can
also retry. A completed home refuses setup. Update the recorded release checkout to the next reviewed version, then run
`bash shift.sh update` in the guided home. It reinstalls from the checkout in `REPO.txt`, verifies the kit and
prints the MCP reconnect notice; it keeps the binding and credential. Keep preparation and grant files private;
they are retained for interrupted-operation recovery, not published as instructions or tool output.

The private `binding.json` refers to `credential.json`; config and scripts contain only that reference.
Setup installs the kit, project-scoped `.mcp.json` and compaction hooks in this home, then runs doctor. It does not
change global Claude settings or another project. Start Claude Code **in that home**, approve its local MCP server
and reconnect. Read the tools brief and full board status before working. Enrollment is not exclusive session
ownership or handoff. Core guided homes skip the optional Monitor-arming steps in the installed briefs.
The core shift command starts no optional adapters:

```sh
bash shift.sh start
bash shift.sh stop
node setup-runtime.cjs doctor
```

Doctor reports ok, warning or fault for versions, binding, hooks, a real MCP initialize, kit hashes, Monitor leases
and current/last board contact. Missing optional integrations are reported as off. It prints no paths, hostnames,
principals or credentials. Expired Monitor leases warn; missing required bindings or unreachable boards fault.
The local MCP registration still needs approval/reconnection in Claude; a successful stdio probe proves the
server answers, not that an already-open Claude session has loaded it.

## Existing homes and advanced setup

Existing operator homes use `bash shift.sh update` once, retain their settings and tokens, and reconnect MCP when
the persistent notice requires it. They never enroll again. Existing boards use the separate reviewed migration
and [deployment path](../server/REGISTRY.md#release-contract-and-going-live), at an authorized maintenance window.
Merging this change does not deploy, restart or update any running fleet.

Run `bash shift.sh start` before arming Monitors. It intentionally clears leftovers, including lease launchers.
Reversing that order can terminate a Monitor with exit 127. This compatibility rule applies to existing homes.

For optional adapters or a hand-filled installation, follow the advanced sections of
[kit SETUP](../operator-kit/SETUP.md#advanced-manual-configuration). Configure and verify a real firstmate route
separately before allowing relays; discovering a directory does not approve an external delivery route.
