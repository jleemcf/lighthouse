# Run the board by hand

The captain authorizes every deployment and kit update. A merge only changes source; it does not authorize
changing an installed board, reconnecting operators or sending them messages. Start and stop are deliberate
host actions, not a service policy. There is no auto-start, watchdog or keep-alive, by design.

## First installation

Follow the [board setup](../lighthouse/server/README.md#install-a-disposable-board) with a new private home,
for example $HOME/board-home in WSL. Keep it outside all Git checkouts. Install Node.js 22+, Python 3, bash,
flock, setsid and curl on that host. The full operator setup also needs Windows Git Bash and WSL.

Build the page and fictional policy records in the checkout. Use the example config, independent local
credentials, loopback binding and an empty store only for a new disposable board. Keep advice, private HTTPS,
CRM and receiver integrations disabled until separately configured and authorized. Never replace an existing store.
Before the first deployment, seed that brand-new home with the reviewed flat runtime files and public assets
using the board setup commands. The deployer migrates an existing flat layout; config and store alone are
not a runnable baseline. Never repeat that initial copy over an existing home. The first approved deployment
then stages, validates and starts the new home, including its health check.
For scratch trials choose an unused loopback port other than 7700 and keep all settings under a temporary home.

## Everyday commands

In the private board home, run:

```bash
bash board.sh status
bash board.sh start
bash board.sh stop
```

A requested start detaches from its terminal. Closing that terminal need not stop the board, but a host reboot
or a process exit leaves it stopped until someone runs start again. Do not add a startup shortcut, scheduled
restart, systemd unit or automatic keep-alive as an incidental fix.

- Running identifies the tracked process and selected release. Check the authenticated board as well;
  an unrelated HTTP response on the port is not proof of the correct process or release.
- Stopped means the manager has no running tracked board. Check the latest private board.log and host availability.
  If no deployment journal is pending, use start when the captain's instruction permits running it.
- Unknown or inconsistent status is not permission to start a second process. Preserve the PID file, log,
  selected release and deployment journal; compare the process command with this home's selected server.
  A stale PID, occupied port, incompatible store or interrupted deployment needs diagnosis first.
- A failed stop keeps the PID record. Resolve the reported process problem before retrying; do not remove
  bookkeeping files, force-kill another process or overwrite state to make status look green.

## Deploy, recover and roll back

Use the reviewed checkout and the captain-approved home, never a real installation for a test. The complete
[deployment guide](../lighthouse/server/DEPLOYMENT.md) is authoritative for release layout and migration.

```bash
LH_HOME="$HOME/board-home" bash lighthouse/server/deploy-board.sh
LH_HOME="$HOME/board-home" bash lighthouse/server/deploy-board.sh recover
LH_HOME="$HOME/board-home" bash lighthouse/server/rollback-board.sh \
  "$HOME/board-home/releases/the-recorded-release-id"
```

The deploy stages an immutable release, validates source/assets/config/schema, waits for quiet writes, confirms
shutdown and takes a final store safety copy before switching current. It starts the candidate even if the home
was stopped, to check that exact process, API health, schema and preserved card IDs. The first flat-home migration
retains its old manager and restart target. Record the active/previous release and safety-copy paths privately.

An interrupted or unrecoverable activation leaves .board-deploy.json. New starts, deploys and rollbacks refuse
until approved recovery reconciles it. Recover restores the previous running/stopped state; it does not erase
newly accepted work. Never delete the journal or restore an old store automatically. Code-only rollback validates
compatibility with the current store. Incompatible schemas or lost data need a separate recovery decision.

## Kit updates and bootstrap

The captain authorizes these separately from board deployment. In each installed operator home, use Windows
Git Bash, not WSL bash. Keep the installed config.json private; there is no machine-config directory to publish.
Python 3.10+ is required. The one-time protocol-one handoff below applies only to pre-publication installs
whose source checkout retains the complete baseline history. A fresh-history public export has no such
baseline: for an old home without KIT-MANIFEST.json, the captain must approve a fresh install using the current
example keys and --keep-from the old private config. Do not run the old updater or replace the old home blindly.
See [kit setup](../lighthouse/operator-kit/SETUP.md). New public installs already contain the manifest.

For a recognized pre-publication install, perform the one-time fetched-updater handoff.
Stop Monitors holding their scripts, open Git Bash in the installed home, and run:

```bash
home="$PWD"
repo="$(sed -n 2p "$home/REPO.txt" | tr -d '\r')"
git -C "$repo" pull --ff-only &&
  python "$repo/lighthouse/operator-kit/bootstrap.py" \
    --home "$(cygpath -am "$home")" --bash "$(cygpath -am "$BASH")"
bash "$home/shift.sh" kit-status
```

The bootstrap recognizes rendered legacy files against retained baseline history, stages the kit,
and runs its newly rendered updater, not the already-loaded old body. Unrecognized older kits need a reviewed
fresh install using the current example keys and --keep-from with their old private config;
never substitute the old updater. See [kit setup](../lighthouse/operator-kit/SETUP.md).

Later updates use bash shift.sh update. Any failed phase exits nonzero and names the last verified state.
Fix that phase and rerun update; pending .new files or a partial Windows/WSL copy are not a completed release.
A repository-refresh or staging failure leaves installed copies unchanged; later failures may leave a partial home.

KIT-MANIFEST.json records source and rendered hashes. kit-status and board_kit_status distinguish repository,
installed Windows, verified WSL and loaded MCP tools. Windows and WSL must match. Changed tools require /mcp
reconnection or session restart in every connected operator session, followed by board_kit_status. A matching
disk version alone does not prove a running session reloaded. The reconnect notice persists until reporting
live sessions match. A kit merge, board deploy or status check never reconnects operators automatically.

Relay recovery is separate: see [the receipt guide](../lighthouse/operator-kit/RELAY-RECOVERY.md). An external
send with a missing board receipt is not permission to send twice. Keep journals until board acceptance.

## Prove a release without a live home

Run bash lighthouse/test-all.sh in Git Bash, then in WSL, one after the other. The
[test guide](../lighthouse/TESTING.md) describes isolated homes and LF normalization. The
[shared export gate](clean-room-release.md) checks the explicit inventory and optional private dictionary.
It writes only to disposable scratch destinations; it never pushes or changes the board lifecycle.
