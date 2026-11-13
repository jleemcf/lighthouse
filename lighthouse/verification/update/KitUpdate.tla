---- MODULE KitUpdate ----
EXTENDS TLC
CONSTANTS BrokenInstallerGuard, BrokenCopyGuard, BrokenValidationGuard, BrokenPreservationGuard
VARIABLES phase, layout, windows, twin, installed, success, validated, filledValue, resolvedValue
vars == <<phase, layout, windows, twin, installed, success, validated, filledValue, resolvedValue>>

Init == /\ phase = "ready" /\ layout \in {"old", "current", "heartbeat-only"}
        /\ windows = "old" /\ twin = "old" /\ installed = FALSE /\ success = FALSE /\ validated = FALSE
        /\ filledValue = "retained" /\ resolvedValue = "unresolved"
Refresh == /\ phase = "ready" /\ phase' = "resolving"
           /\ UNCHANGED <<layout, windows, twin, installed, success, validated, filledValue, resolvedValue>>
ResolveProfile == /\ phase = "resolving" /\ phase' = "validating"
                  /\ resolvedValue' = IF BrokenPreservationGuard THEN "neutral" ELSE filledValue
                  /\ UNCHANGED <<layout, windows, twin, installed, success, validated, filledValue>>
ValidateScripts == /\ phase = "validating" /\ phase' = "installing" /\ validated' = TRUE
                   /\ UNCHANGED <<layout, windows, twin, installed, success, filledValue, resolvedValue>>
RejectScripts == /\ phase = "validating" /\ phase' = "failed"
                 /\ UNCHANGED <<layout, windows, twin, installed, success, validated, filledValue, resolvedValue>>
SkipValidation == /\ phase = "validating" /\ BrokenValidationGuard /\ phase' = "installing"
                  /\ UNCHANGED <<layout, windows, twin, installed, success, validated, filledValue, resolvedValue>>
InstallNewKit == /\ phase = "installing" /\ phase' = "activating"
                 /\ windows' = "new" /\ installed' = TRUE /\ filledValue' = resolvedValue
                 /\ UNCHANGED <<layout, twin, success, validated, resolvedValue>>
InstallerFails == /\ phase = "installing"
                  /\ phase' = IF BrokenInstallerGuard THEN "copying" ELSE "failed"
                  /\ UNCHANGED <<layout, windows, twin, installed, success, validated, filledValue, resolvedValue>>
ActivateAndVerify == /\ phase = "activating" /\ phase' = "copying"
                     /\ UNCHANGED <<layout, windows, twin, installed, success, validated, filledValue, resolvedValue>>
CopyTwin == /\ phase = "copying" /\ phase' = "helpers" /\ twin' = windows
            /\ UNCHANGED <<layout, windows, installed, success, validated, filledValue, resolvedValue>>
TwinCopyFails == /\ phase = "copying"
                 /\ phase' = IF BrokenCopyGuard THEN "helpers" ELSE "failed"
                 /\ UNCHANGED <<layout, windows, twin, installed, success, validated, filledValue, resolvedValue>>
PhaseFails == /\ phase \in {"ready", "resolving", "activating", "helpers"}
              /\ phase' = "failed"
              /\ UNCHANGED <<layout, windows, twin, installed, success, validated, filledValue, resolvedValue>>
FinishUpdate == /\ phase = "helpers" /\ phase' = "finished" /\ success' = TRUE
                /\ UNCHANGED <<layout, windows, twin, installed, validated, filledValue, resolvedValue>>
Done == phase \in {"failed", "finished"} /\ UNCHANGED vars
Next == Refresh \/ ResolveProfile \/ ValidateScripts \/ RejectScripts \/ SkipValidation \/ InstallNewKit
        \/ InstallerFails \/ ActivateAndVerify \/ CopyTwin
        \/ TwinCopyFails \/ PhaseFails \/ FinishUpdate \/ Done
SuccessRequiresInstallation == ~success \/ installed
SuccessRequiresMatchingCopies == ~success \/ windows = twin
InstallationRequiresValidation == ~installed \/ validated
RejectedScriptsLeaveHomeUntouched == validated \/ (windows = "old" /\ twin = "old" /\ ~installed /\ ~success)
FilledValuesSurviveUpdate == filledValue = "retained"
====
