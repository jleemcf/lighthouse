---- MODULE BoardMaintenance ----
EXTENDS Integers, TLC
CONSTANTS IgnoreCopyFailure, MaskArchiveFailure, IgnoreTargetFailure
VARIABLES phase, command, targetValid, copyOK, archiveOK, restartOK, running, copied, cleared, result, exitCode
vars == <<phase, command, targetValid, copyOK, archiveOK, restartOK, running, copied, cleared, result, exitCode>>

Init == /\ phase = "serving" /\ command \in {"archive", "clear-cards"}
        /\ targetValid \in BOOLEAN /\ (command = "clear-cards" => targetValid)
        /\ copyOK \in BOOLEAN /\ archiveOK \in BOOLEAN /\ restartOK \in BOOLEAN
        /\ running = TRUE /\ copied = FALSE /\ cleared = FALSE /\ result = 0 /\ exitCode = -1
ValidateTarget == /\ phase = "serving" /\ (targetValid \/ IgnoreTargetFailure) /\ phase' = "target selected"
                  /\ UNCHANGED <<command, targetValid, copyOK, archiveOK, restartOK,
                                  running, copied, cleared, result, exitCode>>
RefuseTarget == /\ phase = "serving" /\ ~targetValid /\ ~IgnoreTargetFailure
                /\ phase' = "reported" /\ result' = 2 /\ exitCode' = 2
                /\ UNCHANGED <<command, targetValid, copyOK, archiveOK, restartOK, running, copied, cleared>>
Stop == /\ phase = "target selected" /\ running' = FALSE
        /\ phase' = IF command = "clear-cards" THEN "copying configured store" ELSE "archiving"
        /\ UNCHANGED <<command, targetValid, copyOK, archiveOK, restartOK, copied, cleared, result, exitCode>>
Copy == /\ phase = "copying configured store" /\ copied' = copyOK
        /\ phase' = IF copyOK \/ IgnoreCopyFailure THEN "archiving" ELSE "restarting"
        /\ result' = IF copyOK THEN 0 ELSE 37
        /\ UNCHANGED <<command, targetValid, copyOK, archiveOK, restartOK, running, cleared, exitCode>>
Archive == /\ phase = "archiving" /\ phase' = "restarting"
           /\ cleared' = archiveOK /\ result' = IF archiveOK THEN result ELSE 2
           /\ UNCHANGED <<command, targetValid, copyOK, archiveOK, restartOK, running, copied, exitCode>>
Restart == /\ phase = "restarting" /\ phase' = "reported" /\ running' = restartOK
           /\ exitCode' = IF result # 0 /\ ~MaskArchiveFailure THEN result ELSE IF restartOK THEN 0 ELSE 1
           /\ UNCHANGED <<command, targetValid, copyOK, archiveOK, restartOK, copied, cleared, result>>
Done == /\ phase = "reported" /\ UNCHANGED vars
Next == ValidateTarget \/ RefuseTarget \/ Stop \/ Copy \/ Archive \/ Restart \/ Done

ClearRequiresSafetyCopy == command # "clear-cards" \/ ~cleared \/ copied
CopyFailureKeepsCards == command # "clear-cards" \/ copyOK \/ ~cleared
MaintenanceFailureIsReported == phase # "reported" \/ result = 0 \/ exitCode = result
SuccessfulRestartIsRetained == phase # "reported" \/ ~restartOK \/ running
InvalidArchiveTargetLeavesServing == targetValid \/ (running /\ ~copied /\ ~cleared)
====
