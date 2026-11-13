# Wake gate

The wake gate reduces repetitive watcher wake-ups without hiding actionable changes. It sits between a read-only
watcher feed and the operator session; it does not decide work, write the board or prompt firstmate.

## Flow

1. `gate.cjs` receives an event and applies `gate-rules.json`: known urgent events bypass the model; known routine
   events can be handled mechanically.
2. The remaining event may be sent to TypeSafe/Jev for one bounded judgment: wake, hold or summarize later.
3. A digest groups held routine events. A release window limits how long a held event can remain unseen.
4. The operator receives the event or digest and still owns its interpretation and any permitted action.

Modes are `off`, `rules`, `observe`, `shadow` and `hold`. The clean example defaults to `off`. Observe and shadow
measure what would have happened before a model is allowed to hold events. Choose settings only after inspecting
local traffic and cost.

## Health and privacy

The gate emits a heartbeat and a failure state. Loss of the model or a malformed result fails open: events reach
the operator rather than disappearing. Read a failed check as blind, not clear. Measure false holds, wake volume,
latency and request cost before considering a rollout.

Watcher payloads and quoted work records are untrusted input. The model receives only the event context needed for
its decision, not credential files or board tokens. Redaction reduces risk but does not make sensitive work public.
A model verdict must never become captain authority. Keep keys outside Git and make an explicit data-sharing decision
before enabling model calls. Tests use stand-ins and remove the real service key.

## Configuration

Install `__GATE_MODE__` and `__TYPESAFE_ENV__` locally, or change mode through `bash shift.sh gate <mode>`. The kit
loads its optional key from the configured private source. `gate-report.py` reports local measurements. The thresholds,
release window and whether to enable holding are installation choices, not this repository's operating policy.

For isolated Git Bash and WSL checks and the known-rule regressions, see
[the test guide](../lighthouse/TESTING.md).
