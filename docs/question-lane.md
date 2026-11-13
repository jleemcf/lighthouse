# Optional CRM question lane

This integration lets an external application's staff ask scoped questions without giving them captain authority.
It is disabled when `cfg.crm` is absent. There is no named board or client built into the clean example.

## The contract

Lighthouse polls the external application; the application never needs inbound access to the board. One key issued
for Lighthouse is sent as `Authorization: Bearer <key>`. Keep that key in a private local file or `LH_CRM_KEY`.
All bodies are JSON. The external server remains responsible for authenticating staff and computing their scope.

- **Fetch:** `GET /api/operator-questions?since=<cursor>`, normally every 60 seconds. Return at most 50 questions,
  oldest first: `{ "cursor": "next", "questions": [...] }`. Each question has `id`, `askedAt`, `asker` (`name` and
  `role`), `scope.summary`, `text` and `status`. The board remembers delivered ids and ignores a repeated question.
- **Acknowledge:** `POST /api/operator-questions/<id>/ack` with `state` equal to `received` or `working` and an optional
  `note`. Off-shift questions are acknowledged as received; opening their card acknowledges working.
- **Reply:** `POST /api/operator-questions/<id>/reply` with `text`, `answeredAt` and `by`. An optional `file` has `name`,
  `type` and `base64` and is limited to 10 MB. A second reply is a follow-up. File sending is off unless explicitly enabled.

The board creates a `staff` message on its own `crm-q-<id>` card in the configured board. The operator sees the staff
name, role, scope statement and question. The scope is quoted verbatim; Lighthouse does not invent access rights.
Only the operator's answer is sent back. Captain messages never become a staff reply.

## Authority

A staff question permits investigation within its stated scope, not code changes, publication or a relay to firstmate.
A change request becomes a captain ask. Off shift, a question waits on its card and is replayed at the next shift start.
A reply is queued until accepted, so a transient outage does not silently lose an answer.

## Going live

First implement and test the external application's three endpoints. In a private board config, add `crm` with
`base` (an HTTPS base URL), `keyFile`, `board` (an explicitly configured board id) and optionally `pollSec` and `files`.
No board is inferred. Agree on staff scope, retention, file support and failure handling before enabling it.
Use invented questions in a disposable installation first; do not copy real client or staff records into fixtures.
