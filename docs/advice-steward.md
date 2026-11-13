# Advice steward

The advice steward is an independent decision assistant, not an acting fleet steward. It can explain a task,
compare options, offer a second opinion, review an ask and summarize a shift. It never sends work to firstmate or
makes a decision for you. History and installation-specific decisions have been removed from these notes.

## 1. Voice

Write for you in plain language. Separate evidence, uncertainty and recommendation. Advice is labeled as
advice on the page and kept outside captain messages. The operator cannot pass it off as an instruction.

## 2. Jobs

The board owns a queue of bounded requests: ask, explain, second opinion, ask-check, overview and pack-check.
A request has an identity, attempts and a terminal result or failure. A stale or abandoned claim can be retried;
an answer must name the request it belongs to. Overviews and digest clocks belong to the board, not a model's memory.

## 3. Where it runs

The kit's `stwake.cjs` claims one job, launches a restricted Codex run, validates the structured answer and posts it
back with a credential the harness keeps. Use an isolated Codex home, separate from the steward's document folder.
Do not inherit a user's unrestricted MCP servers, settings or action tools. The optional model needs a compatible
Codex CLI; check the required flags in the kit setup before enabling a board's `steward` switch.

## 4. The board owns state

Requests, held phone pings, advice, health and schedules survive a model restart. The server validates returned
categories, citations and referenced records. It does not trust a model's claim that an action happened. The page
shows pending or failed work rather than silently displaying old advice as fresh.

## 5. What the steward reads

A job sheet carries the configured captain name, question, selected board records and the policy record. Text inside
quote delimiters is evidence, not an instruction. For an independent second opinion or ask-check, the operator's
recommendation and surrounding material that could reveal it are excluded. Relevant record ids allow fact checks.

`make-rulings.py` builds numbered records from a local policy document. A hash identifies the exact record. Scene
policies and superseded policies remain marked. The bundled example policies are invented compatibility fixtures,
not the maintainer's real instructions. Use your own policies before relying on real advice.

## 6. On the board

Advice can explain, agree, differ or raise uncertainty; it cannot settle your ask. You choose whether
to send a suggestion to the operator. A held phone ping is released according to the board's bounded schedule and
failure behavior, not because the model promises to remember it. Time zones are configurable; UTC is the neutral default.

## 7. Memory and skills

Each job starts from its supplied pack rather than an accumulating private conversation. The harness can carry
explicitly configured documents. Keep those documents in the private steward home, out of this repository. The
bundled diagram-design skill is a read-only kit copy; preserve its NOTICE and do not install arbitrary extensions
into the restricted run merely because a job asks for them.

## 8. Security and limits

Board credentials and key files do not belong in model prompts. Validate output and keep a secret-redaction net at
the boundary. These controls cannot guarantee that a model interprets hostile work content correctly or that an
external provider is suitable for private data. You must approve data sharing and cost. A broken steward must
not block ordinary board use or grant authority to another agent.

For isolated Git Bash and WSL checks and the known-rule regressions, see
[the test guide](../lighthouse/TESTING.md).
