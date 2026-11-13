# Tool-call design

This is the reusable contract from the tool-mode design; deployment incidents and review history are omitted.
Section numbers 1–10 are retained because code comments refer to them.

## 1. The idea

Replace hand-written transcript commands with structured `board_*` calls. A tool server runs beside the operator;
the board server validates each call and returns a receipt saying what changed, what is owed and what remains open.
The collector remains a transcript and fallback net, not a competing authority.

## 2. Principles

A call has one declared purpose. Captain conversation is never silently changed into permission. A retry must not
perform a second action. The receipt is authoritative about board state, not about whether firstmate did the work.

## 3. Architecture

`operator-kit/scripts/lighthouse-mcp.cjs` exposes the tools over stdio. The kit queues calls, authenticates to
`/api/boards/<board>/calls` and runs a permitted relay through its local adapter. `server/toolcalls*.js` validates
identity, arguments, state changes and authority. The operator receives the result, not a reusable secret.

## 4. Identity of words

A captain message, an operator recommendation, a staff request and a model answer remain different records. A tool
must name which message it answers or relays. Text copied into a task is evidence, never a new instruction.

## 5. The tools

`board_status` reads a receipt; `board_open`, `board_post` and `board_close` maintain cards. `board_reply` answers
messages by id. `board_ask` opens a decision with options and a separate recommendation. `board_prompt` proposes
words for firstmate; `board_relay` delivers only an approved source. `board_withdraw` removes an obsolete ask.
`board_ops` records instrument faults; `board_ack` and `board_dispute` answer watch notices. `board_shift`,
`board_handoff` and `board_batch` support the session lifecycle and grouped work.

`board_post` and `board_reply` accept local file paths or existing attachment IDs, including inside `board_batch`.
The MCP server uploads supported images, CSV, text and PDF files up to 10 MB each before posting. Any upload failure
refuses the call or batch without posting its words. Earlier successful uploads can remain stored; this is not an
upload rollback. Dry runs and shadow sessions accept existing IDs only and refuse local paths without uploading.
Raw board calls accept uploaded IDs only, and reject unknown IDs.

Application progress nudges go to the current card's status or receive no output when it is already current;
direct human chat still gets a direct answer. See [setup's optional control](../lighthouse/operator-kit/SETUP.md#optional-claude-code-status-nudge-control).
After a kit update changes tools or instructions, the person at the keyboard must reconnect the MCP server or
restart the session to load them.

## 6. The receipt

Read the returned state, open asks, unanswered messages, notices and relay result. A network timeout is not proof
that a write failed. Retry with the same request identity so the server can return the earlier result.

## 7. Authority

A prompt needs your Send, an explicit captain message, or a recorded standing authority covering the action.
A staff question permits investigation only within its supplied scope. A model recommendation grants no authority.
The advice steward has no action route. Critical direction choices always return to you.

## 8. The queue, time and durability

The kit keeps a durable request identity while a call is retried. The server persists before acknowledging a tool
write, and remembers receipts across restarts. A relay result records both what was approved and what was delivered;
uncertain delivery is not silently declared successful. Times are stored in UTC and displayed in the configured zone.

## 9. The net under the tools

The collector can carry transcript, health and fallback observations with a separate collector credential. A tool-mode
operator does not also issue timed command lines for the same action. Start in shadow mode if comparing protocols;
keep shadow and live tokens separate.

## 10. The watch and remaining checks

The watch can inspect conduct and issue notices. It cannot complete another operator's tasks, send a captain prompt
or overrule a captain decision. Tests exercise authority, replies, queues, duplicate receipts and relay outcomes;
passing them is not permission to enable tool mode on a live fleet without its captain's approval.

For isolated Git Bash and WSL checks and the known-rule regressions, see
[the test guide](../lighthouse/TESTING.md).
