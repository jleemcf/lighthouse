---- MODULE InitialSetup ----
EXTENDS TLC
CONSTANT Fault
VARIABLES phase, existing, trust, written, enrolled, embedded, checked
vars == <<phase, existing, trust, written, enrolled, embedded, checked>>
Init == /\ phase = "start" /\ existing \in BOOLEAN
        /\ trust = FALSE /\ written = FALSE /\ enrolled = FALSE
        /\ embedded = FALSE /\ checked = FALSE
Initialize == /\ phase = "start" /\ (~existing \/ Fault = "overwrite")
              /\ phase' = "host ready" /\ written' = TRUE
              /\ UNCHANGED <<existing, trust, enrolled, embedded, checked>>
Refuse == /\ phase = "start" /\ existing /\ phase' = "refused"
          /\ UNCHANGED <<existing, trust, written, enrolled, embedded, checked>>
Prepare == /\ phase = "host ready" /\ phase' = "request prepared"
           /\ UNCHANGED <<existing, trust, written, enrolled, embedded, checked>>
TrustHost == /\ phase = "request prepared" /\ trust' = TRUE
             /\ UNCHANGED <<phase, existing, written, enrolled, embedded, checked>>
Enroll == /\ phase = "request prepared" /\ (trust \/ Fault = "trust")
          /\ phase' = "bound" /\ enrolled' = TRUE
          /\ UNCHANGED <<existing, trust, written, embedded, checked>>
Install == /\ phase = "bound" /\ phase' = "installed"
           /\ embedded' = (Fault = "stamp")
           /\ UNCHANGED <<existing, trust, written, enrolled, checked>>
Doctor == /\ phase = "installed" /\ phase' = "verified" /\ checked' = TRUE
          /\ UNCHANGED <<existing, trust, written, enrolled, embedded>>
Finish == /\ (phase = "verified" \/ (phase = "installed" /\ Fault = "doctor"))
          /\ phase' = "complete"
          /\ UNCHANGED <<existing, trust, written, enrolled, embedded, checked>>
Done == UNCHANGED vars
Next == Initialize \/ Refuse \/ Prepare \/ TrustHost \/ Enroll \/ Install \/ Doctor \/ Finish \/ Done
ExistingHomeUntouched == ~existing \/ ~written
TrustBeforeEnrollment == ~enrolled \/ trust
CredentialsAreReferences == ~embedded
CompletionRequiresDoctor == phase # "complete" \/ checked
====
