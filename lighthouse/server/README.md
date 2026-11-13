# Private board server

A dependency-free Node.js server holds board state, validates writes, serves the built page and supplies scoped
operator, advice and conduct feeds. It is not an internet-facing service. Use Node.js 22+; the deployment scripts
expect bash and Python 3. The full operator setup is Windows with WSL.

## Install a disposable board

From the checkout, build `python lighthouse/server/make-page.py` and `python lighthouse/server/make-rulings.py`.
The latter uses the fictional `lighthouse/DIRECTION.example.md`; replace that with your own private policy file
before relying on advice, following [rulings](../../docs/rulings.md).

Create a private home outside Git, for example `$HOME/board-home` in WSL. Copy `config.example.json` into it as
`config.json`. Replace both token placeholders with independent random secrets. The browser identity is `owner`;
the sample operator is `operator-workstation`. Roles in each board's `access` map grant permissions, not display names.
Set `ownerName`, `timeZone` (IANA, UTC by default), board IDs/names and private storage paths for your own installation.
Initialize `store.json` to `{}` only when creating an empty board; never overwrite a live store.

For a brand-new home only, seed the reviewed flat files before its first staged migration. These copy
commands are not an update procedure: never run them over an existing installation. From the checkout in WSL:

```bash
home="$HOME/board-home"
cp lighthouse/server/*.js lighthouse/server/board.sh lighthouse/server/release.json \
  lighthouse/server/rulings.json "$home/"
cp -R lighthouse/server/public "$home/public"
LH_HOME="$HOME/board-home" bash lighthouse/server/deploy-board.sh
```

The deployer stages and validates an immutable candidate before draining or switching the active release. It retains
previous code and a final store safety copy, then checks the selected process and preserved cards. See
[the deployment guide](DEPLOYMENT.md) for flat-home migration, interrupted-activation recovery and code-only rollback.
It copies generated rulings too: use your own locally generated policy record before enabling advice. Never test
a deployment against someone else's configured home. Only the captain authorizes installation changes.

For the first visit on that host, privately open `http://127.0.0.1:7700/?token=<browser-token>`. Replace the
placeholder with the secret for the `owner` browser identity in your local `config.json`; there is no sign-in form.
The page saves that credential in browser-local storage and removes it from the address bar. Never share, record
or commit the initial URL, including in an issue or transcript. Subsequent visits in that browser use the bare
`http://127.0.0.1:7700` URL. Clear that site's local storage to remove the saved credential on a shared computer.
For another device, put the listener behind private authenticated HTTPS and bootstrap its browser privately too.
Do not publish the port or trust forwarded identity headers from the network.

## Persistence and private HTTPS

### Coordinator role and operator notices

Grant `coordinator` in a board's `access` map. A principal with existing operator rights can keep both:
`"coordinating-session": ["operator", "coordinator"]`. A sole coordinator can read and post notices, without
ordinary comment writes, prompt decisions or operator tools. Only an explicit board grant permits notices;
`defaultRole` does not grant this capability.
An enrolled credential is still capped to its enrolled role: an operator or watch installation cannot inherit
coordinator permission from another login belonging to the same principal.

With the coordinator's line-mode API credential, `POST /api/comments` accepts this JSON body:

```json
{"board":"lighthouse","cardId":"lighthouse-inbox","kind":"notice","text":"Review the current work.",
 "sendId":"notice-example-0001"}
```

Use `cardId` for a card's inbox or `board` alone for General. `sendId` is the existing retry identity: reuse it
when retrying the same message. Text is capped at 4,000 characters, and a principal may post at most 20 notices
across all boards per minute (HTTP 429 thereafter). Retries do not spend the budget again. The saved message has
`author: "coordinator"`, the principal in `by`, and `handled: false`. Owner posts keep their ordinary identity.
No schema upgrade is required. Without a coordinator grant, existing access and messages behave as before.

Notices are labelled on the page, the board watcher and tool receipts as coming from a coordinator, never the
owner. They grant no approval or standing authority, answer no owner ask and authorize no relay. Operators reply
on the notice's card using `board_reply`, a REPLY line, or the existing reply tools. Watch conduct corrections
retain their own acknowledgment path. See the kit briefs for the operator's authority rules.

Going live needs a board deploy and kit update (watcher, gate, collector and briefs), then re-arm the watchers.
The tool server and tool schemas are unchanged, so no MCP reconnect is needed. Apply any private profile grants
before a schema-2 registry migration: after migration, access comes from the registry, and configuration edits
cannot adopt new membership. See [REGISTRY.md](REGISTRY.md) for that deliberate migration boundary.

`bash board.sh status`, `start`, `stop` and `restart` manage the selected private home. State, attachments and VAPID
keys live there, not in this checkout. Start and stop stay manual: no auto-start, system service, watchdog or
keep-alive is installed or recommended. A reboot or process exit leaves the board stopped. Read the
[host runbook](../../docs/host-runbook.md) for stopped/unknown status and manual recovery. Back up the home before
changing it; state and attachments are private data, not release files.

`stop` waits up to fifteen seconds for the process to exit and finish its last save before removing its PID file.
An exited Linux zombie counts as stopped. If the deadline expires, it keeps the PID file and fails; `restart`,
`archive` and `clear-cards` then refuse to continue. Resolve the failed stop before retrying maintenance.
`bash board.sh archive <board> <days>` moves old Done cards to `archiveDir`; `clear-cards <board>` moves every card
on that board after a backup and requires the captain's instruction. Both start the board again after archiving.

Tailscale Serve can proxy the loopback listener over the tailnet's HTTPS name. Configure it using Tailscale's
current instructions. Enable `trustTailscaleHeaders` only when an authenticated local Tailscale proxy is the sole
path to the listener, then map its users to local identities in `tailscaleUsers`. Never enable header trust on an
unprotected listener. Push requires HTTPS, browser support, and a local VAPID pair. `pushSubject` is a contact URI;
the example uses a neutral reserved domain. Use your own contact when enabling push.

## Standing cards and card doorbells

Both settings are optional and empty by default in `config.example.json`. Configure them in the server's private
configuration, then restart that server to apply them. They are independent and apply to exact card slugs on every
board, without the board prefix. Neither feature assumes a particular role or inbox card.

- `standingCards`: an array of slugs for long-lived conversations. Listed cards are excluded from stale reminders
  and the conduct report's stale, catch-all and after-finished signals. Other conduct rules and existing built-in
  exclusions still apply. Omitting the setting exempts no extra cards.
- `cardDoorbells`: an array of `{ "slug": "<card slug>", "url": "<receiver HTTPS URL>" }`, one receiver per slug.
  A committed card update queues an asynchronous POST containing only
  { "board": "<board id>", "card": "<full card id>", "revision": 1 }. The receiver authenticates its own
  subsequent board read. No text, author or board credential is sent. HTTP is accepted only for loopback receivers.

The first update rings immediately. Changes coalesce to the latest committed revision, with a one-minute normal
window and retries backing off to at most five minutes. Delivery has a three-second total timeout and follows
no redirects. Failure never blocks a board write. A completed 2xx response acknowledges the sent revision only;
newer work stays pending. A receiver must accept responsibility durably before replying, deduplicate by
(board, card, revision), and then read current card contents. Response loss can produce a repeated delivery.

Pending revisions and retry state are stored and reconciled on restart. /api/state exposes board-scoped
pending/retrying/acknowledged/unconfigured status; the page shows a non-secret failure banner. Receiver URLs
remain private configuration and never enter the store or API. Invalid destinations and failures log generic
messages without URLs. Keep them out of version control and posts. Choosing a receiver is a separate decision.

## Credentials and roles

`bash "$HOME/board-home/board.sh" claim operator-workstation` prints a one-use code, valid for an hour. Privately run
`bash shift.sh claim <code>` in that operator home; the claim endpoint saves the scoped token locally. Do not print,
copy or commit the token. Create separate credentials for collectors, tool operators, advice workers and watches;
see [tool calls](../../docs/tool-calls.md) before switching modes. Captain actions require captain-role access.
The server also supports viewer roles and board-scoped steward/watch credentials; use the narrowest scope needed.

## Main files and APIs

| Area                                | Files / routes                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| Bootstrap and state                 | `server.js`, `store.js`, `routes.js`, `board.sh`, `deploy-board.sh`                     |
| Staged releases                     | `board-release.js`, `release-check.js`, `deploy-board.sh`, `rollback-board.sh`          |
| Card and ask transitions            | `card-transitions.js`, `events.js`, `toolcalls*.js`                                     |
| Durable wake delivery               | `doorbells.js`, `/api/state` doorbell status (receiver 2xx acknowledges)                |
| Board updates and permission checks | `grammar.js`, `events.js`, `toolcalls*.js`, `/api/boards/<board>/calls`                 |
| Read views and streaming            | `/api/state`, `/api/whoami`, `/api/changes`, `/api/stream`, `/api/comments`             |
| Claims and diagnostics              | `/api/claim`, `/api/client-error`                                                       |
| Advice                              | `steward*.js`, `rulings.json`, `make-rulings.py`, `/api/steward/...`, `/api/advice/...` |
| Conduct                             | `conduct.js`, board watch reports and notices                                           |
| Optional question bridge            | `crm.js`, configured explicit `crm.board`; [contract](../../docs/question-lane.md)      |
| Push and images                     | `push.js`, `steward-routes.js` (`cleanSvg`), `/api/push/...`, attachment routes         |
| Built web page                      | `public/`, generated from `../board/` by `make-page.py`                                 |

The source modules enforce exact request shapes; these route families are a map, not an alternate API specification.
`ownerName` and `timeZone` are returned in `/api/state` for display only. Changing them does not grant authority.
The question bridge is absent from the example; enabling it requires an explicit existing board and separate key.

## Check without a live service

Run `bash lighthouse/test-all.sh` from the checkout. It removes the paid model-service key and uses temporary stores
and local stand-ins. [The test guide](../TESTING.md) covers Git Bash and WSL. Rebuild the page after editing its sources, never by hand-editing `public/index.html`.

## Registry administration

See [REGISTRY.md](REGISTRY.md) for the explicit offline schema migration, compatible rollback contract,
board lifecycle commands and protected enrollment handoffs. Existing access stays unchanged; enrollment stays off.

Tools-mode dispatch and queued-call continuity are documented in [HANDOFF-DISPATCH.md](../HANDOFF-DISPATCH.md).
The board dispatch ledger is off by default, requires the ownership and journal readiness barriers, and writes
schema 4 only at explicit owner activation. Server first, then kit update and reconnect of every shared-journal
MCP; B4/B5 acceptance and a separate activation decision are still required before going live.
