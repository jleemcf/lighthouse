# Board releases: captain-approved, manual lifecycle

Merging code does not deploy it. Only the captain authorizes a host deployment, including the one-time
flat-layout migration below. Do not deploy, update kits, reconnect operators, or start a stopped production
board just because a branch merged. No systemd unit, startup shortcut, watchdog, keep-alive, or automatic
restart is installed. The interface in the board home stays:

```bash
bash board.sh start
bash board.sh stop
bash board.sh status
```

The manager detaches a requested start from its calling terminal, but does not restart it after an exit or
host reboot. `status` reports the process and selected release; an HTTP answer alone is not proof of health.

## Prepare the approved deploy

For the generic-core transition, first apply the captured compatibility profile to the host configuration
with its numbered backup (inspect `--dry-run` first; see `docs/generic-core.md`). Then deploy the board,
update the kit in each operator home, and reconnect every MCP session. This order preserves historical
identities, policies, clocks and client fields. Merging does none of these operations. Never deploy the
neutral example over an existing configuration, and never apply a profile to the live home without approval.
Retain the existing push contact as explicit `pushSubject` in host configuration before this transition;
contact addresses must not be copied into the repository. A private source checkout refuses deployment of
its captured board set until the profile and this runtime contact are explicit, before stopping service.

Use a reviewed checkout on the board host, Linux/WSL with Node, bash, flock, setsid and curl. The server stays
dependency-free. Shell files are checked out LF (including on Windows). If an older checkout has CRLF shell
files, normalize the three entry scripts before invoking them; staged manager copies are normalized again.

1. Record the approval, checkout commit, existing manual status, and board card counts. Keep the private
   configuration and all credentials on the host; never paste them into a PR or deployment report.
2. Ensure there is room for a full candidate, retained old code and a store safety copy. Keep `config.json`,
   `storeFile`, attachments, claims, VAPID data and archives in their existing locations. Relative config paths
   continue to resolve against the board home's `config.json`, not a release directory.
3. From that checkout, run the approved deploy explicitly:

```bash
LH_HOME="$HOME/lighthouse-board" bash lighthouse/server/deploy-board.sh
```

The script acquires the same exclusive control lock as manual manager commands. It stages every server
module, rulings, manager, release contract and public asset in `releases/<unique-id>`, without changing active
files. It checks JavaScript and manager syntax, local dependencies, required assets, JSON, config shape and
store-schema compatibility. It retains the previous code, waits up to 60 seconds for three seconds without a
store write, stops the process, confirms its exit, and copies the final flushed store into `backups/<id>/`.
Stop or quiet timeouts fail closed without switching code; the old process may remain running.

Only then does it atomically rename the `current` symlink. The manager starts the candidate by its immutable
absolute path and checks that exact process, HTTP 200 from `/api/whoami`, preservation of every saved card ID,
the schema contract, and new log lines. The normal Node DEP0169 `url.parse()` warning and trace-deprecation
companion are harmless. A real error, missing process, non-200 endpoint or missing card rejects activation.
This explicit deploy command starts the candidate for its health check, even if the home was initially stopped.

Successful output names the active release, retained previous release and store safety copy. Record these,
then run `bash board.sh status` in the board home and inspect the board. Do not remove retained releases or
safety copies as part of deployment. The generic-core rollout also requires the profile application before
deployment and per-home kit updates and `/mcp` reconnects afterward.

## One-time flat-home migration

The first approved deploy accepts today's flat board home; no preparatory migration command is needed.
It snapshots the flat server modules and public assets into a retained `legacy-...` release before stopping.
The flat manager then on disk is retained as `legacy-manager.sh`; the snapshot receives the release-aware
manager adapter so a later code rollback still starts the exact retained server path. If an earlier interrupted
attempt already upgraded the manager while leaving the home flat, the original manager remains in that
attempt's `backups/<id>/board.sh`. An unversioned store
and legacy release are schema 1. Unknown newer schemas are refused, not guessed or downgraded.

After validation and confirmed shutdown, the script installs the release-aware root `board.sh` and selects
the retained legacy release, then switches to the candidate. The flat `.js` and asset files remain untouched
but are no longer the active restart target. Config and data never move. A failed first activation restores
the saved flat manager and untouched flat restart target, removing the migration pointer only after confirming
shutdown. Recovery does the same, so it never needs the failed candidate's manager to restart the old board.
A later approved deploy can retry migration. Do not undo migration by manually copying files over a running
release or deleting `current`.

## Safe code-only rollback

Use the exact retained release path named by the deploy (also in `previous-release.json`):

```bash
LH_HOME="$HOME/lighthouse-board" bash lighthouse/server/rollback-board.sh \
  "$HOME/lighthouse-board/releases/the-recorded-release-id"
```

Substitute the recorded directory, not the old `backup-before-*` layout. A rollback follows the same
validation, quiet/drain, snapshot, switch and health checks. It retains the release being replaced as well.
The current store is never replaced by an old safety copy: that could erase work accepted since deployment.
Every `release.json` declares `storeSchema.min`, `.max` and `.write`; a store's `schemaVersion` defaults to 1
only when absent. Activation requires the current schema to be readable and to equal the declared write
schema. Changing a schema needs a separately reviewed data migration. Never broaden a release contract
merely to make rollback pass.

## Failed or interrupted activation

Ordinary activation failure stops the candidate, rechecks that the previous code supports the current store,
restores its manager/pointer and restarts it if it was previously running. Exit status remains nonzero even
when restoration succeeds. Store/card damage is not silently reversed; the final pre-switch safety copy is
retained for an explicit data-recovery decision.

If stop, restoration, or compatibility checks fail, `.board-deploy.json` remains visible. A terminated
deployment also leaves this journal. New deploys/rollbacks and manual starts refuse to proceed until it is
reconciled. Do not delete the journal or force-kill a board as a deployment shortcut. With captain approval,
use the same reviewed checkout:

```bash
LH_HOME="$HOME/lighthouse-board" bash lighthouse/server/deploy-board.sh recover
```

Recovery stops any surviving board process, checks compatibility, selects the journal's previous release
and restores its prior running/stopped state. If an incompatible store prevents safe code-only recovery,
leave the journal and data in place and obtain a data-migration/recovery decision. Original flat managers
cannot enforce the new journal gate before migration, but their restart target is still the untouched flat
release. No automatic retry or automatic data restoration occurs.

## Developer proof

Run `bash lighthouse/test-all.sh` in Linux/WSL; it removes `TYPESAFE_API_KEY` before spawning servers. Never
start a scratch test server with that key inherited. Focused replays and real-code mutations live in
`lighthouse/verification/deploy/`; use `/verify-lighthouse-board-deployment` and read its model with
`/statechart`. All test homes use temporary directories and ephemeral loopback ports, never the live home
or port 7700. The model covers bounded ordering, not power-loss durability, a lying schema declaration,
arbitrary malicious code, external writes to retained releases, or host/process-supervisor configuration.
