---- MODULE Enrollment ----
EXTENDS Naturals, TLC
CONSTANT Fault
VARIABLES phase, candidate, spent, installed, boards, operation, commits,
          expired, expiryViolation, scopeViolation, leakedReceipt, unsafeReply
vars == <<phase, candidate, spent, installed, boards, operation, commits,
          expired, expiryViolation, scopeViolation, leakedReceipt, unsafeReply>>

Init == /\ phase = "idle" /\ candidate = "none"
        /\ spent = FALSE /\ installed = FALSE /\ boards = 0 /\ operation = "none" /\ commits = 0
        /\ expired = FALSE /\ expiryViolation = FALSE /\ scopeViolation = FALSE
        /\ leakedReceipt = FALSE /\ unsafeReply = FALSE

Begin(request) ==
  /\ phase = "idle" /\ commits < 2
  /\ (~spent \/ Fault = "replay")
  /\ (~expired \/ Fault = "expiry")
  /\ (request \in {"first", "second"} \/ (request = "wrong scope" /\ Fault = "scope"))
  /\ phase' = "preparing metadata" /\ candidate' = request
  /\ expiryViolation' = (expiryViolation \/ expired)
  /\ UNCHANGED <<spent, installed, boards, operation, commits, expired, scopeViolation, leakedReceipt, unsafeReply>>

FlushMetadata == /\ phase = "preparing metadata" /\ phase' = "preparing credentials"
  /\ UNCHANGED <<candidate, spent, installed, boards, operation, commits, expired,
                 expiryViolation, scopeViolation, leakedReceipt, unsafeReply>>
FlushCredentials == /\ phase = "preparing credentials" /\ phase' = "preparing pointer"
  /\ UNCHANGED <<candidate, spent, installed, boards, operation, commits, expired,
                 expiryViolation, scopeViolation, leakedReceipt, unsafeReply>>
FlushPointer == /\ phase = "preparing pointer" /\ phase' = "ready to commit"
  /\ UNCHANGED <<candidate, spent, installed, boards, operation, commits, expired,
                 expiryViolation, scopeViolation, leakedReceipt, unsafeReply>>

Commit == /\ phase = "ready to commit" /\ phase' = "committed without reply"
  /\ spent' = TRUE /\ installed' = (Fault # "split") /\ boards' = boards + 1
  /\ commits' = commits + 1 /\ operation' = candidate
  /\ scopeViolation' = (scopeViolation \/ candidate = "wrong scope")
  /\ UNCHANGED <<candidate, expired, expiryViolation, leakedReceipt, unsafeReply>>

Reply == /\ phase = "committed without reply" /\ phase' = "reply delivered"
  /\ unsafeReply' = (unsafeReply \/ ~installed)
  /\ UNCHANGED <<candidate, spent, installed, boards, operation, commits,
                 expired, expiryViolation, scopeViolation, leakedReceipt>>
LoseReply == /\ phase = "committed without reply" /\ phase' = "idle"
  /\ UNCHANGED <<candidate, spent, installed, boards, operation, commits,
                 expired, expiryViolation, scopeViolation, leakedReceipt, unsafeReply>>
Crash == /\ phase # "idle" /\ phase' = "idle" /\ candidate' = "none"
  /\ UNCHANGED <<spent, installed, boards, operation, commits,
                 expired, expiryViolation, scopeViolation, leakedReceipt, unsafeReply>>

Retry(request, proof) == /\ phase = "idle" /\ spent
  /\ request = operation /\ (proof = "installation proof" \/ Fault = "retry")
  /\ phase' = "reply delivered"
  /\ leakedReceipt' = (leakedReceipt \/ proof # "installation proof")
  /\ unsafeReply' = (unsafeReply \/ ~installed)
  /\ UNCHANGED <<candidate, spent, installed, boards, operation, commits,
                 expired, expiryViolation, scopeViolation>>
Expire == /\ ~expired /\ expired' = TRUE
  /\ UNCHANGED <<phase, candidate, spent, installed, boards, operation, commits,
                 expiryViolation, scopeViolation, leakedReceipt, unsafeReply>>
Done == UNCHANGED vars
Next == (\E request \in {"first", "second", "wrong scope"}: Begin(request))
        \/ FlushMetadata \/ FlushCredentials \/ FlushPointer \/ Commit \/ Reply \/ LoseReply \/ Crash
        \/ (\E request \in {"first", "second"}, proof \in {"installation proof", "bare request id"}:
              Retry(request, proof)) \/ Expire \/ Done

AtomicConsumption == spent = installed
OneUse == commits <= 1 /\ boards <= 1
AcknowledgmentIsDurable == ~unsafeReply
RetryRequiresInstallationProof == ~leakedReceipt
ExpiredGrantsRefused == ~expiryViolation
ScopeIsExact == ~scopeViolation
====
