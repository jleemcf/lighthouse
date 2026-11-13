# Set up one operator

## Fresh installation (default)

Use [the guided initializer and enrollment](../setup/README.md). A new host starts from an empty home with a
pinned release and private local administrator. On the operator's machine, `node lighthouse/lighthouse.cjs operator
setup` discovers the machine and creates a private request; the host approves a create/bind grant through protected
files. Setup installs core tools and compaction hooks, saves a private binding with a credential-file reference,
and ends with doctor. Missing optional integrations remain off. No secrets are stamped into scripts.

## Existing installation (upgrade)

Use `bash shift.sh update` in the existing home. Preserve its configuration and token files; do not run setup or
enroll again. Follow the reconnect notice after updating tools. Board deployment and any schema migration are
separate authorized host steps. A merge never updates a fleet.

Run `bash shift.sh start` before arming Monitors. Start stops leftover lease launchers too; the reverse order may
end a Monitor with exit 127. Re-arm after starting and inspect the gap. Use `outbox restart` for that component alone.

## Advanced manual configuration

The hand-filled path below remains available for optional adapters and existing Windows/WSL installations.

Use a disposable local installation for the first trial. This guide supports Windows, Git Bash and WSL only.
You are the captain: talk through the board to an operator AI session, which watches firstmate and relays only
your approved words. Firstmate runs its coding crew. This kit supplies the operator's default rules and instruments;
it does not grant the operator independent permission to command the crew.
The board host may run in WSL. Keep its home, the operator home and any advice home separate from this checkout.
Never publish a filled configuration, transcript, token, claim code or model-service key.

## 1. Prerequisites and paths

Install Git for Windows, Node.js 24.16.0+ on Windows, Windows Python 3, WSL with Linux Python 3,
and Claude Code with Monitors. Linux/WSL Node remains 22+.
Set up firstmate and herdr in WSL using firstmate's own documentation. Check `node --version`, `python --version`,
`wsl --list --quiet` and your firstmate session before installing this kit. The kit does not configure firstmate.
Optional integrations need their own tools: `gh` for issue comments, Tailscale for private HTTPS, and Codex CLI for advice.

Windows Node 24.15.0 has an intermittent native child-process crash. The
[24.16.0 release](https://nodejs.org/en/blog/release/v24.16.0) includes
[nodejs/node#62561](https://github.com/nodejs/node/pull/62561), the upstream fix. The installer checks
the Windows Node on PATH and only warns; it never installs Node,
changes PATH or blocks an existing setup for this warning. Upgrade the runtime separately when ready.

Create a private operator home, for example `C:/lighthouse-operator`. Copy `config.example.json` there as
`operator-config.json` and fill every angle-bracket example:

- `__WSL_DISTRO__` and `__WSL_USER__` select the Linux instance and account that run firstmate.
- `__FM_HOME__` is firstmate's absolute Linux working directory; `__FM_HOME_REL__` is its suffix below that user's home.
- `__FM_CONV_DIR__` is Claude Code's encoded project-directory name for that Linux working directory.
- `__OPERATOR_WSL_DIR__` is a private Linux directory for the generated probe and delivery scripts.
- `__WINDOWS_USER__`, `__WINDOWS_NODE_EXE__` and `__CODEX_EXE__` name your Windows profile and executable paths.
- `__OPERATOR_TRANSCRIPT_DIR__` is the Windows working directory opened in the operator's Claude Code session.
- `__BOARD_SERVER__` is the board address reachable from Windows; `__BOARD_ID__` matches a configured board ID.
- `__MACHINE_NAME__` labels this installation. Keep `__BOARD_REPO__` as `none` to skip GitHub issue comments.
- `__OWNER_NAME__`, `__TIME_ZONE__` and `__WINDOWS_TIME_ZONE__` must agree with the board's display settings.

`__OWNER_ID__` becomes the installed `ownerId`; `__OWNER_NAME__` becomes `ownerName` and defaults to `the captain`.
Keep them aligned with the board's stable owner identity and display name; they do not change the internal `owner` role.
If the board recognizes retained identities through `ownerAliases`, copy that array into the kit configuration too.
An optional profile supplies it through `kit.ownerAliases`, falling back to `server.ownerAliases`. Explicit kit
configuration wins, including an empty array to disable aliases; updates retain an installed value.
Only an array is used by the watcher. Owner IDs and aliases print the owner display name; a non-owner whose
capitalized ID equals that name is marked `[non-owner]` so line-mode replies cannot mistake it for the owner.

Leave `__STEWARD_THREAD_ID__` and `__FM_SEND__` as `none-yet`, `__GATE_MODE__` as `off` and `__WATCH_BOARDS__` as
`none` for the first trial. A later verbatim relay uses `fm-send.sh` or a configured delivery command; verify that
route locally before allowing a real relay. Do not guess paths from another installation.

## 2. Install

From the checkout in PowerShell (replace the two local paths):

```powershell
python lighthouse/operator-kit/install.py --config C:/lighthouse-operator/operator-config.json --out C:/lighthouse-operator
```

The installer emits private config.json, scripts, briefs, version manifests and bundled skills; it starts nothing.
Use a real Windows Python 3.10+ executable, not a Store placeholder. Run the WSL handoff command printed by the
installer in Windows Git Bash. It creates the configured Linux home, copies the generated WSL scripts, sets their
executable bits and verifies hashes before publishing the matching WSL KIT-MANIFEST.json. Copying wsl/\* manually
is not a verified installation. If the handoff fails, fix its named cause and rerun that printed command.

Then run bash shift.sh kit-status in the installed home. Installed Windows and Installed WSL must match;
Installed WSL: unknown means setup is incomplete. No helper restart or update is needed for this fresh-install
receipt. Keep both local config files private. There is no repository machines directory to populate or commit;
updates use the installed home's private settings. Before updating a pre-protocol kit, follow the
[one-time bootstrap](../../docs/host-runbook.md#kit-updates-and-bootstrap).

## 3. Claim and test the board connection

First install a test board using the [server guide](../server/README.md). The board needs an operator identity,
for example `operator-workstation`, with the operator role on your board. On the board host, from its private home:

```bash
bash "$HOME/board-home/board.sh" claim operator-workstation
```

Give the one-use code privately to the operator. From Git Bash in the operator home, run
`bash shift.sh claim <code>`. Do not copy the underlying token by hand or print it. Claim codes expire after one hour.
Use `bash shift.sh status` to check the address, collector and shift state; never put the claim code in an issue.

Open Claude Code in `__OPERATOR_TRANSCRIPT_DIR__`. Read the installed `OPERATOR-BRIEF.md`. Run
`bash shift.sh start`, clear stale watchers with `bash shift.sh kill-watchers`, then arm these as separate Monitors:

```bash
node monitor.cjs --source fmwatch -- node fmwatch.cjs
node monitor.cjs --source sweep -- bash lighthouse-sweep.sh
node monitor.cjs --source route -- bash route.sh
```

Post the timed SHIFT line and one made-up TASK_CREATED line. Confirm they appear on the board. Send a captain message
from the page, confirm `route.sh` delivers it, answer with REPLY, and verify the answer on the page. Finish the sample
card and end the shift. Re-arm any Monitor that reaches its 30-minute limit and inspect what happened during the gap.
Reuse the same source on re-arm; keep the whole command or gate pipeline inside the foreground launcher.
See [Foreground Monitor lease](README.md#foreground-monitor-lease) for gated commands and cursor limits.

For example, tell the new session: "Read OPERATOR-BRIEF.md. Start a shift, check your instruments, and open a
welcome card for this disposable trial. Do not send anything to firstmate." Check that the board shows that
card and the on-shift indicator. Write a question on the card from the page; check the route delivers it and
the operator's REPLY appears in that same conversation. Ask it to finish the sample card, then end the shift.
The operator must emit SHIFT before stopping collection; let it follow the brief's ten-second drain period.

If the page gets nothing, check `bash shift.sh status`, the configured transcript directory, the board address
as reached from Windows and whether the correct identity was claimed. Fix the configuration, rerun the installer
and copy its WSL files again. Never recover by printing a token or using another installation's files.

## Verify approved delivery

After the board round-trip works, select `__FM_SEND__` as `herdr` in your private input settings for the documented
WSL/herdr setup. Rerun the same installer command and recopy the generated WSL files. In WSL confirm firstmate's
Claude agent appears in `herdr agent list` with the configured working directory, and its composer is empty.
Do not create another firstmate session to bypass a missing or busy target.

Start a trial shift and ask the operator to propose a harmless question for firstmate, without sending it.
Review the proposed text on its card and choose Send. Confirm firstmate receives those words alone, the operator
records RELAYED after success, and firstmate's answer comes back through the watcher and operator. An absent or
ambiguous target, failed relay or duplicate-delivery warning is a stop for inspection, not permission to retry.
This verifies the full chain without dispatching coding work. Keep real work disabled until you trust the route.

## 4. Optional tools, gate, advice and watch

Line mode is frozen: fixes only. Tool mode is the path for new operators. Follow [tool calls](../../docs/tool-calls.md): use separate tools/collector/shadow
credentials, install the MCP bridge with `claude mcp add --scope local lighthouse -- node <home>/lighthouse-mcp.cjs`,
then `node lighthouse-mcp.cjs install-hooks` and `node lighthouse-mcp.cjs check`. Shadow keeps line mode authoritative;
dry-run calls never replace the lines. Switch a board only after comparing the two in a disposable trial.

The [wake gate](../../docs/wake-gate.md) is optional and fails open. Keep `route.sh` outside it. The
[advice steward](../../docs/advice-steward.md) needs a private `steward-config.json`, a scoped steward credential,
Codex CLI and a separate home. Its example uses read-only mode, no private document pack and no personal policies.
Configure model, effort and access for your installation, rather than copying someone else's live settings.

A [watch operator](../../docs/watch-operator.md) has its own board and read permissions for explicitly selected boards.
It reports conduct against the briefs; it never operates another fleet. Keep it off until the basic shift round-trip works.

## Updating an installed kit

Run `bash shift.sh update` when instructed that the kit changed. It reinstalls into the current home. If the MCP
implementation or tool specification changed, including staged `.new` copies, it prints a reconnect notice. The
person at the keyboard must reconnect the lighthouse server with `/mcp`, or restart the session; updating files
alone does not replace tools or instructions already loaded in a running session.

## Optional Claude Code status-nudge control

Tool instructions and the compaction reminder direct application progress nudges to `board_post(kind: "status")`
on the current card, or silence if its status is already current. Direct human chat still gets a direct answer.
This is guidance, not a chat filter or a hook that converts or blocks text.

Claude Code 2.1.317 recognizes the optional launch-environment setting `CLAUDE_CODE_SILENT_TURN_REMINDER=0` to disable
its silent-turn reminder. This undocumented control may change between versions. The kit neither sets nor installs
it. Any use needs separate authorization and belongs only in that operator's Claude launch environment, outside the
MCP server's environment. It does not affect a running session. Do not put it in project or local settings, which
this build rejects, or change shared user settings. Verify behavior on the exact installed harness in a disposable
session without board access before relying on it after an upgrade.

## First-trial checklist

- Verify one shift start/end, one captain question/reply and one task creation/completion.
- Disconnect the test board briefly: queued records recover; a relay is never guessed or silently retried.
- Confirm a read-only identity cannot write and an operator cannot approve its own proposal.
- In shadow, compare the tool receipts with the line records before considering tools authoritative.
- Confirm the configured captain display name and time zone reach both the page and printed shift clock.
- Stop only this trial's watchers. Never use a trial to test against an existing live fleet or store.
