---- MODULE PolicyApply ----
EXTENDS TLC
CONSTANT RewriteEqualBytes
VARIABLES phase, equal, selected
vars == <<phase, equal, selected>>
Init == /\ phase = "before apply" /\ equal \in BOOLEAN /\ selected = "running bytes"
Apply == /\ phase = "before apply" /\ phase' = "applied"
         /\ selected' = IF equal /\ ~RewriteEqualBytes THEN "running bytes" ELSE "repository bytes"
         /\ UNCHANGED equal
Done == /\ phase = "applied" /\ UNCHANGED vars
Next == Apply \/ Done
EqualContentKeepsCitations == ~equal \/ selected = "running bytes"
ChangedContentUsesProfile == phase # "applied" \/ equal \/ selected = "repository bytes"
====
