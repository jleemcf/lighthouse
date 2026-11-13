# Operator kit

Run `bash shift.sh start` before arming Monitors. Start clears leftover watcher processes, including a live lease
launcher; reversing this order can end the Monitor with exit 127. After a restart, re-arm each Monitor and inspect
its gap. Mid-shift use `outbox restart` for the collector alone.

## Coordinator notices

`NOTICE from <principal> (coordinator, not the owner)` is a board message from a principal granted the
coordinator role on that board. It wakes the operator and waits in the inbox; it is never the owner's word,
approval, standing authority, an answer to an owner's ask, or permission to relay anything to firstmate.
Act on it only within the owner's existing approvals. If it requests something the owner has not approved,
ask the owner on the board. Answer on the inbox card where the notice arrived (or General for a board notice):
use `board_reply` with its message ID in tool mode, or a REPLY line naming that card in line mode.
The watch's conduct notices remain separate: their existing `board_ack`, dispute and OPS rules still apply.

Line mode is frozen: fixes only. Tool mode is the path for new operators; the watch retains its line protocol.

The kit gives a Claude Code operator a read-only view of firstmate and a way to explain its work on a private board.
It does not install firstmate. Start with [SETUP.md](SETUP.md) and keep local configuration outside this checkout.

## Contents

| Files                                                                    | Purpose                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `install.py`, `config.example.json`                                      | Fill paths and optional settings into a private operator home |
| `OPERATOR-BRIEF.md`, `OPERATOR-BRIEF-TOOLS.md`                           | Operator authority and the two board protocols                |
| `WATCH-BRIEF.md`                                                         | Optional conduct-watch role                                   |
| `scripts/shift.sh`                                                       | Claims, shift lifecycle, health, updates and watcher cleanup  |
| `fmwatch.cjs`, `lighthouse-sweep.sh`, `route.sh`                         | Fleet changes, periodic checks and captain messages           |
| `collector.py`, `Start-Collector.ps1`                                    | Read the operator transcript and deliver records to the board |
| `lh-probe.sh`, `lh-pending.py`, `fm-send.sh`                             | WSL process/transcript probes and explicit delivery           |
| `relay.sh`, `record-check.py`, `record-check.sh`                         | Verbatim relay and delivery evidence                          |
| `lighthouse-mcp.cjs`, `toolcalls-spec.json`                              | Optional board tools, hooks and receipts                      |
| `gate.cjs`, `gate-rules.json`, `gate-report.py`                          | Optional TypeSafe wake gate and audit reports                 |
| `boardwatch.cjs`, `watch.sh`, `conductwatch.cjs`                         | Read-only board and conduct feeds                             |
| `stwake.cjs`, `Start-Steward.ps1`                                        | Optional independent advice worker and wake feed              |
| `STEWARD-BRIEF.md`, `steward-schema.json`, `steward-config.example.json` | Advice contract and local settings                            |
| `Kill-Watchers.ps1`                                                      | Stop only watcher processes belonging to this operator home   |
| `skills/`                                                                | Bundled diagram-design skill; its MIT NOTICE is retained      |
| `tests/`                                                                 | Installer, collector, wake gate, MCP, watcher and relay tests |

After the first three rows, the table lists files under `scripts/`, followed by the root-level `skills/` and
`tests/` directories.
Installed scripts sit directly in the home, except the generated `wsl/` set, which must be copied to the configured
WSL directory.

## Local settings

Use `__OWNER_NAME__` for the display name (default: the captain), `__TIME_ZONE__` for an IANA zone (default: UTC), and
`__WINDOWS_TIME_ZONE__` for the matching Windows time-zone ID. Match the board server's `ownerName` and `timeZone`.
The authorization identity remains `owner`; a display-name change does not change permissions.

The GitHub feed is disabled by `__BOARD_REPO__=none`. To opt in, use a repository you can read as `owner/repository`;
its issue comments are treated as work context, never as authority to act. `EXPECT_PROFILE` and
`EXPECT_AUTOCOMPACT` can optionally make the sweep report a selected profile or compaction policy. No model profile
or personal operating policy is enforced by default.

The gate defaults to `off`, the advice thread to `none-yet`, and conduct watching to `none`. Enable each deliberately;
read the [wake gate](../../docs/wake-gate.md), [advice](../../docs/advice-steward.md) and
[watch](../../docs/watch-operator.md) guides first. Monitors expire after 30 minutes; re-arm each one and inspect its gap.

## Updates, versions and recovery

Only the captain authorizes kit updates. See [the host runbook](../../docs/host-runbook.md#kit-updates-and-bootstrap)
for the one-time fetched-updater bootstrap of pre-publication kits whose source checkout retains the baseline
history. Fresh-history public exports cannot recognize those legacy homes: use a reviewed fresh install with
the current example keys and --keep-from the old private config instead. New public installs have a manifest
and need no legacy handoff. Run bash shift.sh update from the installed home in Windows Git Bash, not WSL bash.
Python 3.10+ is required.

An update is complete only after installer writes, Windows activation (including .new files), both script
manifests and required helper restarts succeed. A failed phase exits nonzero, reports the last verified state
and suppresses command output that could contain settings or credentials. Fix the named phase and rerun update;
starting a partial home is not recovery. Refresh/staging failure leaves both installed copies unchanged.

KIT-MANIFEST.json records the source revision, rendered-content digest and script hashes. kit-state.py verifies
the active bytes; the WSL receipt is published only after verification. kit-status (also part of status) and
board_kit_status distinguish repository, installed Windows/WSL and loaded MCP versions. Changed tools leave
MCP-RECONNECT.json until reporting live MCP servers match the target. Reconnect every connected operator session
with /mcp or restart it, then use board_kit_status to verify loaded tools. Matching files alone are insufficient.
The installer includes kit-version.cjs, bootstrap.py, update-protocol.json and the verification helper; it never
installs repository-local developer verification skills or the private legacy start page.

External delivery and board acknowledgment are separate. Read [relay recovery](RELAY-RECOVERY.md) before repairing
a held receipt: retain the journal until board acceptance and never resend solely because its board receipt failed.

## Foreground Monitor lease

Run `bash shift.sh start` before arming Monitors. Stop an old Monitor and run `bash shift.sh kill-watchers`
before switching its command. In the installed home, keep the launcher in the foreground:

```bash
node monitor.cjs --source fmwatch -- node fmwatch.cjs
node monitor.cjs --source sweep -- bash lighthouse-sweep.sh
node monitor.cjs --source route -- bash route.sh
```

With the optional gate, replace the corresponding command, not the launcher around it:

```bash
node monitor.cjs --source fmwatch -- bash -c 'node fmwatch.cjs | node gate.cjs --source fmwatch'
node monitor.cjs --source sweep -- bash -c 'bash lighthouse-sweep.sh | node gate.cjs --source sweep'
```

Keep route ungated. Put any combined wrapper inside one launcher, for example
`node monitor.cjs --source mixed -- bash all-watch.sh`; leave private wrapper contents alone. Use distinct
sources for separate Monitors and reuse each source when re-arming after the thirty-minute limit.
Use native Windows Node for Git Bash, Linux Node for WSL; never mix PID spaces inside one launcher.

The launcher refreshes a token-owned lease every second with a 15-second expiry, measured against system uptime
so wall-clock adjustments cannot revoke or extend a current lease. This tolerates several-second scheduling
and file-sharing stalls without treating a busy machine as a lost Monitor. The wall-clock expiry remains in
the lease for diagnostics and older readers. An expired, superseded or orphaned lease stops watcher output
and cursor commits. Leased firstmate cursors resume gaps up to two hours
after the last save; a cold start or older cursor intentionally baselines existing transcripts quietly. Plain
unleased fmwatch remains supported but has no resume cursor. This is not a detached service or a guarantee
that downstream private filters or tailers consumed a line. Verify downstream delivery separately.

Parent checks still run every 100 ms and immediately before output or cursor publication. A dead launcher
or foreground Monitor therefore stops watchers at their next scheduled check, without waiting 15 seconds.
A transient read can add at most 250 ms of retry time to that check, without authorizing any write.
A live but frozen launcher loses authority no later than 15 seconds after its last renewal timestamp,
plus the 100 ms check interval and scheduler delay. A suspended watcher cannot check until it runs again;
its next output or cursor commit must still pass a fresh check. No retry extends the last confirmed expiry.

A filter after the launcher, such as grep with line buffering, does not control lease renewal. It can hide
WATCH LEASE diagnostics or buffer other lines. Lease stops usually exit zero even without a filter;
a pipeline can additionally substitute its filter's status. Preserve WATCH LEASE lines and check the
local event journal when a stream ends; do not infer healthy watchers from any successful exit status.

Transient sharing or parse failures retry for at most 250 ms, never past the last validated expiry;
then an unexpired last good read can be used, with fresh parent checks. Retries do not extend authority.
A newer Monitor is detected on the next successful read, no later than the cached lease's expiry if reads fail.
Before the first good read, retries wait at most 250 ms without authorizing output or cursor commits.
Each process stopping for lease loss prints one WATCH LEASE line on stdout, the Monitor's notification stream,
and records its reason and lease filename in watch-lease-events.jsonl beside the lease. If the Monitor
is already known dead, only the local record is attempted. Inspect the gap and re-arm if needed; a
replacement notice means a newer Monitor owns the source and needs no action. An unreadable home or
closed pipe can prevent the diagnostic from being saved or displayed. A removed lease fails closed.

The gate follows actual input EOF and its Monitor lease, not the lifetime of an intermediate Git Bash
parent. Controlled gate stops also record their reason in gate-stop-events.jsonl in the gate home;
non-lease stops print one GATE line on stdout. A same-source re-arm requests a cooperative stop so the
old Monitor hears why its gate stopped, even on Windows. If the previous gate cannot cooperate, the
new arm refuses instead of silently force-killing it; stop the old Monitor and use kill-watchers first.
Forcible process termination or a lost machine cannot run a final notification or journal write.
Unleased gates follow EOF, not Monitor lifetime: after stopping their Monitor, also run kill-watchers.

## Tests

The optional tools-mode [handoff and recovery runbook](HANDOFF-RECOVERY.md) covers captain-approved recovery,
generation-scoped watchers, missing data and the original firstmate target. Recovery stays off by default;
installing this kit does not enable it or change a running board.

Run bash lighthouse/test-all.sh from the repository root in Git Bash, then WSL, never overlapping.
[The test guide](../TESTING.md) covers isolated homes, host-boundary fixtures and all ten known-rule regressions.
No test updates an installed kit, uses a real account or delivers to an external agent.
