# Private handoff setup commands

This is the setup companion to [HANDOFF-ACTIVATION.md](HANDOFF-ACTIVATION.md), not permission to touch a live home.
Use that runbook's named-board lhactivation wrapper. Examples target harbor only, at the example loopback endpoint.
All files below live in an owner-only private directory, never a repository, checkpoint or board attachment.
The CLI checks file permissions, refuses redirects and refuses line-mode boards before sending setup writes.

## Register the identity and collector

Create an operator credential and a separate collector credential without displaying either secret:

~~~sh
lhactivation new-session --output C:/private/harbor-session.json
lhactivation new-session --session-file C:/private/harbor-session.json --output C:/private/harbor-collector.json
~~~

The output contains only the nonsecret sessionId. Copy that exact ID into the plans below. Keep these files: their
credentials are random and are never discoverable from the board. To retry file creation, use the existing file,
not another identity. For another logical session, choose fresh files and fresh operation IDs.

Use a protected editor/secret-file flow to create harbor-register.json with this JSON structure. Replace the example
endpoint, session ID, installation alias and operator principal with the intended board's values; none is a secret.
The legacy installation alias must explicitly identify this home and its original firstmate installation.

~~~json
{
  "endpoint": "http://127.0.0.1:7781",
  "board": "harbor",
  "sessionFile": "C:/private/harbor-session.json",
  "request": {
    "action": "register", "operationId": "register-harbor-session-01",
    "sessionId": "COPY_SESSION_ID", "installationId": "harbor-home", "principal": "harbor-operator"
  }
}
~~~

Create harbor-collector-register.json with the same scope/session/installation/principal, a fresh operationId,
sessionFile set to harbor-collector.json, and request.scope set to "collector". Run in this order:

~~~sh
lhactivation ownership --input C:/private/harbor-register.json
lhactivation ownership --input C:/private/harbor-collector-register.json
lhactivation inspect
~~~

## Verify and locate before acquisition

Before starting the lease, verify the route as described in the operator kit's HANDOFF-RECOVERY.md. Use opaque
machine/home IDs, not hostnames or addresses. The route hash is verified, not guessed. Create harbor-locate.json
with the same endpoint/board envelope and this request. Once registered this location is immutable.

~~~json
{
  "action": "locate", "operationId": "locate-harbor-session-01", "sessionId": "COPY_SESSION_ID",
  "location": {
    "machineId": "OPAQUE_MACHINE_ID", "homeId": "OPAQUE_HOME_ID", "targetId": "firstmate",
    "targetInstallationId": "harbor-home", "routeHash": "COPY_VERIFIED_64_HEX_ROUTE_HASH"
  }
}
~~~

~~~sh
lhactivation ownership --input C:/private/harbor-locate.json
~~~

## Prepare, nominate and acquire

Use the inspected epoch, initially 0 on an unowned board. Create harbor-nominate.json using the same endpoint/board
envelope, with this request (replace numeric 0 if the inspected epoch differs):

~~~json
{
  "action": "nominate", "operationId": "nominate-harbor-session-01",
  "sessionId": "COPY_SESSION_ID", "expectedEpoch": 0,
  "nominationId": "nomination-harbor-session-01", "expiresAt": 0
}
~~~

Replace expiresAt with a fresh numeric deadline within one hour. This prints a ten-minute deadline in either shell
(public metadata only):

~~~sh
powershell.exe -NoProfile -Command '([DateTimeOffset](Get-Date).AddMinutes(10)).ToUnixTimeMilliseconds()'
lhactivation ownership --input C:/private/harbor-nominate.json
~~~

Create harbor-acquire.json with the same envelope, top-level epoch set to the inspected epoch, and request:

~~~json
{
  "action": "acquire", "operationId": "acquire-harbor-session-01",
  "nominationId": "nomination-harbor-session-01", "expectedEpoch": 0
}
~~~

Acquisition uses the operator credential, not the owner wrapper. Define lhsession in PowerShell:

~~~powershell
function lhsession {
  param([string]$Command)
  $common = @('--endpoint','http://127.0.0.1:7781','--board','harbor',
    '--credential-file','C:/private/harbor-session.json')
  node lighthouse/server/activation-cli.js $Command @common @args
}
~~~

Or in Git Bash:

~~~sh
lhsession() {
  command="$1"; shift
  common=(--endpoint http://127.0.0.1:7781 --board harbor --credential-file C:/private/harbor-session.json)
  node lighthouse/server/activation-cli.js "$command" "${common[@]}" "$@"
}
~~~

Prepare the tools MCP environment before acquiring: set LH_OPERATOR_SESSION_ID to the generated ID,
LH_SESSION_CREDENTIAL_FILE to harbor-session.json and LH_SESSION_EPOCH to the inspected epoch plus one.
Supply the separate collector file only to the collector. Finish kit installation, route verification and
private-file preparation first, so no slow setup work remains between acquisition and the first MCP heartbeat.

Then acquire in either shell:

~~~sh
lhsession ownership --input C:/private/harbor-acquire.json
~~~

On success, confirm the returned epoch matches the prepared environment and reconnect every tools MCP immediately.
The lease lapses after three minutes without a heartbeat; a lapsed session cannot reacquire. Use fresh files and
a fresh logical session if it lapses; never reset the shift or erase accepted work. Follow the activation runbook
for installed-kit/journal readiness and named-board activation.

## Retire a stopped obsolete attachment

Stop and verify the exit of the exact obsolete writer first. Inspect the named board to obtain its process ID
and current epoch. A legacy entry has no session; a non-holder explicit entry may also be retired. Create
harbor-detach.json with the same endpoint/board envelope and request:

~~~json
{
  "action": "detach", "operationId": "detach-harbor-obsolete-01",
  "processId": "COPY_EXACT_OBSOLETE_PROCESS_ID", "expectedEpoch": 1, "confirmStopped": true
}
~~~

~~~sh
lhactivation ownership --input C:/private/harbor-detach.json
lhactivation inspect
~~~

The owner retirement is audited, refuses the current holder and is unavailable after activation. A holder detaches
its own process with its session credential and top-level epoch in the private plan. A lost response is retried
with the same file and operationId. Never use detach to conceal an unaccounted-for or still-running writer.
