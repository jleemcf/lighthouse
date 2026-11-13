---- MODULE KitBootstrap ----
EXTENDS TLC
CONSTANTS BrokenDriver, BrokenNotice, BrokenClear
VARIABLES phase, legacy, driver, windows, twin, notice, oldConnected, newReported
vars == <<phase, legacy, driver, windows, twin, notice, oldConnected, newReported>>
Init == /\ phase = "ready" /\ legacy \in {"b4942b9", "5cd7cf3", "heartbeat-only"}
        /\ driver = "old" /\ windows = "old" /\ twin = "old"
        /\ notice = FALSE /\ oldConnected = TRUE /\ newReported = FALSE
StageFetched == /\ phase = "ready" /\ phase' = "staged"
                /\ driver' = IF BrokenDriver THEN "old" ELSE "new"
                /\ UNCHANGED <<legacy, windows, twin, notice, oldConnected, newReported>>
RecordTarget == /\ phase = "staged" /\ phase' = "installing"
                /\ notice' = ~BrokenNotice
                /\ UNCHANGED <<legacy, driver, windows, twin, oldConnected, newReported>>
Install == /\ phase = "installing" /\ phase' = "activating" /\ windows' = "new"
           /\ UNCHANGED <<legacy, driver, twin, notice, oldConnected, newReported>>
Activate == /\ phase = "activating" /\ phase' = "copying"
            /\ UNCHANGED <<legacy, driver, windows, twin, notice, oldConnected, newReported>>
CopyAndVerify == /\ phase = "copying" /\ phase' = "finished" /\ twin' = "new"
                 /\ UNCHANGED <<legacy, driver, windows, notice, oldConnected, newReported>>
Interrupt == /\ phase \in {"ready", "staged", "installing", "activating", "copying"}
             /\ phase' = "failed"
             /\ UNCHANGED <<legacy, driver, windows, twin, notice, oldConnected, newReported>>
DisconnectOld == /\ oldConnected /\ oldConnected' = FALSE
                 /\ UNCHANGED <<phase, legacy, driver, windows, twin, notice, newReported>>
ReportNew == /\ windows = "new" /\ ~newReported /\ newReported' = TRUE
             /\ notice' = IF oldConnected THEN notice ELSE FALSE
             /\ UNCHANGED <<phase, legacy, driver, windows, twin, oldConnected>>
ReportAgain == /\ windows = "new" /\ newReported /\ ~oldConnected /\ notice
               /\ notice' = FALSE
               /\ UNCHANGED <<phase, legacy, driver, windows, twin, oldConnected, newReported>>
ForgetOnRerun == /\ BrokenClear /\ phase = "finished" /\ notice /\ notice' = FALSE
                 /\ UNCHANGED <<phase, legacy, driver, windows, twin, oldConnected, newReported>>
Done == /\ phase \in {"finished", "failed"} /\ UNCHANGED vars
Next == StageFetched \/ RecordTarget \/ Install \/ Activate \/ CopyAndVerify \/ Interrupt
        \/ DisconnectOld \/ ReportNew \/ ReportAgain \/ ForgetOnRerun \/ Done
FetchedUpdaterDrivesUpdate == phase \notin {"installing", "activating", "copying", "finished"} \/ driver = "new"
ChangedToolsRequireReconnectNotice == windows # "new" \/ (~oldConnected /\ newReported) \/ notice
SuccessRequiresMatchingCopies == phase # "finished" \/ windows = twin
====
