---- MODULE PolicyRelease ----
EXTENDS TLC
CONSTANTS ExecutableRelative, ImplicitHostPath
VARIABLES phase, mode, selected
vars == <<phase, mode, selected>>
Expected == IF mode = "configured host path" THEN "host record" ELSE "bundled record"
Selection == IF ImplicitHostPath /\ mode = "legacy flat copy" THEN "stale flat record"
             ELSE IF ExecutableRelative THEN "bundled record" ELSE Expected
Init == /\ phase = "previous release"
        /\ mode \in {"legacy flat copy", "configured host path", "missing host file"}
        /\ selected = Expected
StageRelease == /\ phase = "previous release" /\ phase' = "staged release"
                /\ UNCHANGED <<mode, selected>>
StartRelease == /\ phase = "staged release" /\ phase' = "candidate running"
                /\ selected' = Selection
                /\ UNCHANGED mode
ManualRestart == /\ phase = "candidate running" /\ phase' = "restarted"
                 /\ selected' = Selection
                 /\ UNCHANGED mode
Done == /\ phase = "restarted" /\ UNCHANGED vars
Next == StageRelease \/ StartRelease \/ ManualRestart \/ Done
HostPoliciesSurviveReleaseSwitch == mode # "configured host path" \/ selected = "host record"
FallbackCitationsUnchanged == mode = "configured host path" \/ selected = "bundled record"
====
