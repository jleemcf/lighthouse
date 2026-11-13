<h1 align="center">Lighthouse</h1>
<p align="center"><strong>A coding crew, explained. Approved decisions, carried through.</strong></p>

<p align="center">
  <img src="docs/assets/home.png" width="960" alt="Pixel-art lighthouse and keeper's cottage on a green island, with a sailing ship on the sea." />
</p>

## What it is

An AI coding crew can build a lot. Following its terminals, interpreting its questions and deciding what it should
do next can still feel like a second job, especially without a coding background.

Lighthouse puts an operator between the captain and that machinery. **The captain talks to the operator through
the board**: cards and replies on a computer or phone. The operator is an AI session sitting in firstmate's
captain seat. It watches firstmate, explains what is happening, keeps the board current and passes along
only approved words or actions. **Firstmate runs the crewmates that do the coding.**

The captain's words reach firstmate only through the operator's authorized relay. The operator controls the board, not a
second coding crew: it cannot choose a direction, approve its own proposal or send unapproved instructions.
The captain can also speak directly in its Claude Code chat; the collector mirrors that conversation on the board.

Lighthouse is an independent **companion above [firstmate](https://github.com/kunchenguid/firstmate)**, not a fork,
replacement or upstream release. It includes the operator kit and default operating rules, not just a dashboard.
Each installation's paths, boards, names, permissions and integrations are its own settings. The bundled policies
are made-up examples, not rules about real projects. This is an early Windows-with-WSL prototype, not a one-click product.

## Features

- **A conversation, not a terminal wall.** Cards say what is moving, what is held and what needs a decision.
  Replies, suggested prompts and approved sends stay with the work they concern.
- **An operator with rules.** The included kit installs line-mode and tools-mode briefs, a shift lifecycle,
  firstmate watchers, a transcript collector and an exact-text delivery route. New operators use tools mode.
- **Approval stays with the captain.** The operator explains and recommends; only captain messages, Send or explicitly scoped
  standing authority permit a relay. An agent's output cannot grant permission.
- **A board for computer and phone.** The Home scene is an animated island; task cards and conversations live on
  the same page. Private HTTPS and push are optional, not permission to expose the server to the internet.
- **Optional second opinions and conduct checks.** An advice steward advises without acting; a watch operator
  checks operator conduct. A wake gate can batch low-priority events without gating captain messages.
- **Long-lived conversations and file sharing.** Optional standing cards avoid task-aging reminders; card doorbells
  can wake a configured receiver. Board tools upload local files with posts and replies, including in batches.
- **Local and inspectable.** The board server needs no runtime packages. Tests, editable page sources, example
  configurations and design notes ship together. Monitors expire after **30 minutes** and must be re-armed.

## Quick Start

### Requirements

The supported full setup is **Windows with Git Bash and WSL**, not a portable Unix-only installation:

- Git for Windows, Node.js 24.16.0+ on Windows (22+ on Linux/WSL), Windows Python 3 and Python 3 in WSL;
- firstmate running in WSL with its herdr backend, set up using its own documentation;
- Claude Code with Monitors for the Windows-side operator session.

Windows Node 24.15.0 can intermittently crash child processes. Use at least
[Node 24.16.0](https://nodejs.org/en/blog/release/v24.16.0), which includes
[the upstream fix](https://github.com/nodejs/node/pull/62561). Doctor and the kit installer warn on older
Windows runtimes; they never upgrade Node or change an existing installation automatically.

Optional tools: Codex CLI for advice, TypeSafe/Jev for wake judgments, Tailscale for private HTTPS/identity/phone
access, and `gh` for issue comments. Leave those integrations off for the first trial. They need their own
credentials, data-sharing review and cost decisions.

### Fresh install

Start with a release checkout, an empty board home and an empty operator home outside this repository.
Follow [zero to a first shift](docs/getting-started.md): `node lighthouse/lighthouse.cjs init`
installs the first pinned release, initializes its registry and creates a protected local administrator file.
The page guides private sign-in and first-board creation. Operator setup prepares an installation request;
the board owner approves a scoped copy-once invitation, and setup installs core tools/hooks and runs doctor.
Use [board management and permissions](docs/board-management.md) for lifecycle, invitations and membership.
Core tools need Node and Python; optional firstmate, WSL, transcript, watcher and paid integrations stay off.
The complete firstmate adapter still uses the Windows/WSL requirements above.

### Upgrade an existing installation

Keep existing operator homes and run `bash shift.sh update`; follow its MCP reconnect notice. They do not run
setup or enrollment again. Existing hosts use the [backup-to-kit-update guide](docs/upgrading.md),
only at an authorized maintenance window. Run `bash shift.sh start` before arming Monitors: start clears leftover
lease launchers too, and the reverse order may end a Monitor with exit 127. Re-arm after starting.

### Advanced manual install

Use a disposable board and operator home, outside this checkout. Do not experiment on an existing fleet.

```sh
git clone https://github.com/jleemcf/lighthouse.git
cd lighthouse
python lighthouse/server/make-page.py
python lighthouse/server/make-rulings.py
```

1. Follow the [board setup](lighthouse/server/README.md#install-a-disposable-board): copy its example config into
   `$HOME/board-home` in WSL, create an empty store only for this new board, and replace the two credential
   placeholders with independent secrets. Set the display name, board and time zone; defaults use the captain
   and UTC. The server starts on loopback with identity-header trust and CRM disabled.
2. Seed that brand-new home with the reviewed runtime files as the board setup explains. This is a one-time
   copy, not an update procedure. From the checkout in WSL, deploy only that new home:
   `LH_HOME="$HOME/board-home" bash lighthouse/server/deploy-board.sh`.
3. Configure browser access separately using the server security guide and an authenticated private proxy.
   Keep browser credentials in protected storage; never put them in a URL, chat or shell command. The fresh
   initializer's host administrator is a separate identity and grants no implicit browser/board membership.

Read the **[host runbook](docs/host-runbook.md)** before maintaining an installation. Start and stop stay manual;
merging source never authorizes a live deploy or kit update.

### Start a first operator

The **[newcomer guide](docs/getting-started.md)** covers a prepared request, a private one-use grant, doctor,
MCP approval/reconnection and the first shift. Start with core tools; verify a harmless, approved delivery route
before enabling firstmate or other adapters. The old hand-filled flow remains in the
[advanced kit appendix](lighthouse/operator-kit/SETUP.md#advanced-manual-configuration), not the default path.

The full briefs ship by default: no private machine configuration or separate rule pack is needed to learn the
protocol. Replace the fictional policy records with local decisions before relying on policy advice.
The display name stays configurable. Legacy keys such as `ownerName` are compatibility names, not forms of address.

### Example conversation

On a task card, for example:

```text
Captain:  What is holding up the sign-in fix? Explain it without code.
Operator: Firstmate's crew has a tested patch. It needs a decision: ship the small fix
          or include the larger cleanup. I recommend the small fix because it is easier to review.
Captain:  Draft the small-fix instruction. Do not send it yet.
Operator: [Proposes a prompt on the card; nothing goes to firstmate.]
Captain:  [Reviews the text, then chooses Send.]
Operator: [Relays exactly the approved text to firstmate and records the delivery.]
```

## How It Works

```text
                    CAPTAIN
          cards and replies on computer / phone
                          |
                          v
             +-------------------------+
             | LIGHTHOUSE BOARD        |<---- Advice steward
             | Page + board server     |      (advice, never action)
             +-------------------------+
                 | messages    ^ records / replies
                 v             | (collector or board tools)
             +-------------------------+      Watch operator
             | OPERATOR AI SESSION     |<---- (conduct notices only)
             | firstmate's captain seat|
             +-------------------------+
                 | approved words only ^ read-only watchers
                 v                     |
             +-------------------------+
             | FIRSTMATE               |
             | Runs and supervises crew|
             +-------------------------+
                          |
                +---------+---------+
                v         v         v
             crewmate  crewmate   crewmate
                |         |         |
                +-- code, tests, PRs-+
```

The operator runs and watches firstmate on the captain's behalf through the configured route; it does not take over
firstmate's internal orchestration. Firstmate sends the work to its crew. Watchers bring back evidence; the
operator translates it into cards and replies, collected from its transcript or written through board tools.
The board holds the captain's conversation with the operator, **not a direct command channel to firstmate**.

### Security and limits

Keep configuration, tokens, transcripts, real policies and live state outside Git. Browser, operator, collector
and advisor credentials are separate. A model recommendation is not approval; tools enforce message and authority
checks. Claim codes are single-use and expire after an hour. Trust identity headers only behind an explicitly
configured authenticated local proxy. Read [SECURITY.md](SECURITY.md) before enabling remote access or model services.

The live event stream filters board changes by the same permissions as polling. The board manager waits for a real
server exit before restart or archiving; a failed stop blocks those operations and clearing cards. Back up private
state before maintenance. This remains a single-host prototype; it is not a multi-tenant hosted platform.
Do not mistake a quiet or expired Monitor for a healthy fleet; re-arm it and inspect its gap.

## Documentation

- [Concepts](docs/concepts.md) - captain, operator, firstmate, board and authority vocabulary.
- [Board](docs/board.md) - cards, conversations, roles and data flow.
- [Tool calls](docs/tool-calls.md) - optional tools mode, receipts and shadow trials.
- [Wake gate](docs/wake-gate.md) - batching and failure behavior.
- [Advice steward](docs/advice-steward.md) - independent opinions and read-only jobs.
- [Watch operator](docs/watch-operator.md) - conduct notices and escalation boundaries.
- [Question lane](docs/question-lane.md) - optional staff questions, never delegated approval.
- [Rulings format](docs/rulings.md) - replace the fictional policies with private local decisions.
- [Server guide](lighthouse/server/README.md) and [operator setup](lighthouse/operator-kit/SETUP.md) - installation.

## Release verification

Every push to `main` and pull request runs the per-commit suite, generic privacy checks and generated-file
checks. Releases also run `node scripts/release-check.cjs`: four fresh-repository scenarios covering an initial
push, a later push, deletion/rename and a fork without private secrets. Maintainers check an export against an
external private dictionary before publication. See [the test guide](lighthouse/TESTING.md) and
[release checks](docs/clean-room-release.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [shared-core configuration](docs/generic-core.md).

## License

MIT - see [LICENSE](LICENSE). The bundled diagram-design notice and morphdom attribution stay with their copies.
