---- MODULE Management ----
EXTENDS TLC
CONSTANT Fault
VARIABLES actor, csrf, origin, enabled, schemaTwo, phase, changed, audited, secretVisible, replayVisible
vars == <<actor, csrf, origin, enabled, schemaTwo, phase, changed, audited, secretVisible, replayVisible>>
Init == /\ actor \in {"admin", "owner", "operator", "watch"}
        /\ csrf \in BOOLEAN /\ origin \in BOOLEAN /\ enabled \in BOOLEAN /\ schemaTwo \in BOOLEAN
        /\ phase = "ready" /\ changed = FALSE /\ audited = FALSE
        /\ secretVisible = FALSE /\ replayVisible = FALSE
MayEdit == schemaTwo /\ enabled /\ origin /\ (csrf \/ Fault = "csrf")
           /\ (actor = "admin" \/ Fault = "authority")
SaveMembership == /\ phase = "ready" /\ phase' = "finished"
                  /\ changed' = MayEdit /\ audited' = (MayEdit /\ Fault # "audit")
                  /\ UNCHANGED <<actor, csrf, origin, enabled, schemaTwo, secretVisible, replayVisible>>
IssueGrant == /\ phase = "ready" /\ actor \in {"admin", "owner"}
              /\ schemaTwo /\ enabled /\ origin /\ csrf
              /\ phase' = "private invitation" /\ secretVisible' = TRUE
              /\ UNCHANGED <<actor, csrf, origin, enabled, schemaTwo, changed, audited, replayVisible>>
ReadContext == /\ phase = "private invitation" /\ phase' = "reloaded"
               /\ secretVisible' = FALSE /\ replayVisible' = (Fault = "replay")
               /\ UNCHANGED <<actor, csrf, origin, enabled, schemaTwo, changed, audited>>
CopyOrLeave == /\ phase = "private invitation" /\ phase' = "finished"
               /\ secretVisible' = (Fault = "copy")
               /\ UNCHANGED <<actor, csrf, origin, enabled, schemaTwo, changed, audited, replayVisible>>
Done == UNCHANGED vars
Next == SaveMembership \/ IssueGrant \/ ReadContext \/ CopyOrLeave \/ Done
OnlyAdministratorAdopts == ~changed \/ actor = "admin"
FormsRequireCsrf == ~changed \/ (csrf /\ origin /\ enabled /\ schemaTwo)
MembershipIsAudited == ~changed \/ audited
SecretLeavesOnlyOnce == phase = "private invitation" \/ ~secretVisible
NoGrantReadback == ~replayVisible
====
