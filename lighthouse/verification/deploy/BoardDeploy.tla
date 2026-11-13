---- MODULE BoardDeploy ----
EXTENDS TLC
CONSTANTS OverwriteBeforeValidate, SkipBackup
VARIABLES phase, disk, running, candidate, backedUp, storeBackedUp, schemaOK
vars == <<phase, disk, running, candidate, backedUp, storeBackedUp, schemaOK>>

Init == /\ phase = "serving old"
        /\ disk = "old" /\ running = "old"
        /\ candidate \in {"new", "invalid"}
        /\ schemaOK \in BOOLEAN
        /\ backedUp = FALSE /\ storeBackedUp = FALSE

Stage == /\ phase = "serving old" /\ phase' = "staged"
         /\ disk' = IF OverwriteBeforeValidate THEN candidate ELSE disk
         /\ UNCHANGED <<running, candidate, backedUp, storeBackedUp, schemaOK>>
Reject == /\ phase = "staged" /\ (candidate = "invalid" \/ ~schemaOK)
          /\ phase' = "deployment failed"
          /\ UNCHANGED <<disk, running, candidate, backedUp, storeBackedUp, schemaOK>>
Validate == /\ phase = "staged" /\ candidate = "new" /\ schemaOK
            /\ phase' = "validated"
            /\ UNCHANGED <<disk, running, candidate, backedUp, storeBackedUp, schemaOK>>
Backup == /\ phase = "validated" /\ phase' = "backed up"
          /\ backedUp' = ~SkipBackup
          /\ UNCHANGED <<disk, running, candidate, storeBackedUp, schemaOK>>
Quiet == /\ phase = "backed up" /\ phase' = "quiet"
         /\ UNCHANGED <<disk, running, candidate, backedUp, storeBackedUp, schemaOK>>
FailBeforeStop == /\ phase \in {"validated", "backed up", "quiet"}
                  /\ phase' = "deployment failed"
                  /\ UNCHANGED <<disk, running, candidate, backedUp, storeBackedUp, schemaOK>>
Stop == /\ phase = "quiet" /\ phase' = "stopped" /\ running' = "none"
        /\ UNCHANGED <<disk, candidate, backedUp, storeBackedUp, schemaOK>>
Snapshot == /\ phase = "stopped" /\ phase' = "snapshotted" /\ storeBackedUp' = TRUE
            /\ UNCHANGED <<disk, running, candidate, backedUp, schemaOK>>
Switch == /\ phase = "snapshotted" /\ phase' = "switched" /\ disk' = candidate
          /\ UNCHANGED <<running, candidate, backedUp, storeBackedUp, schemaOK>>
Start == /\ phase = "switched" /\ phase' = "checking" /\ running' = candidate
         /\ UNCHANGED <<disk, candidate, backedUp, storeBackedUp, schemaOK>>
HealthPass == /\ phase = "checking" /\ phase' = "serving new"
              /\ UNCHANGED <<disk, running, candidate, backedUp, storeBackedUp, schemaOK>>
FailAfterStop == /\ phase \in {"stopped", "snapshotted", "switched"}
                 /\ phase' = "restoring"
                 /\ UNCHANGED <<disk, running, candidate, backedUp, storeBackedUp, schemaOK>>
HealthFail == /\ phase = "checking" /\ phase' = "stopping candidate"
              /\ UNCHANGED <<disk, running, candidate, backedUp, storeBackedUp, schemaOK>>
StopCandidate == /\ phase = "stopping candidate" /\ phase' = "restoring" /\ running' = "none"
                 /\ UNCHANGED <<disk, candidate, backedUp, storeBackedUp, schemaOK>>
RecoveryStopTimeout == /\ phase = "stopping candidate" /\ phase' = "needs recovery"
                       /\ UNCHANGED <<disk, running, candidate, backedUp, storeBackedUp, schemaOK>>
Restore == /\ phase = "restoring" /\ running = "none"
           /\ phase' = "restored" /\ disk' = "old"
           /\ UNCHANGED <<running, candidate, backedUp, storeBackedUp, schemaOK>>
RestartOld == /\ phase = "restored" /\ phase' = "deployment failed" /\ running' = "old"
              /\ UNCHANGED <<disk, candidate, backedUp, storeBackedUp, schemaOK>>
Done == /\ phase \in {"deployment failed", "serving new", "needs recovery"}
        /\ UNCHANGED vars
Next == Stage \/ Reject \/ Validate \/ Backup \/ Quiet \/ FailBeforeStop \/ Stop \/ Snapshot
        \/ Switch \/ Start \/ HealthPass \/ FailAfterStop \/ HealthFail \/ StopCandidate
        \/ RecoveryStopTimeout \/ Restore \/ RestartOld \/ Done

RunningVersionMatchesDisk == running = "none" \/ running = disk
FailedDeployPreservesRunnableRelease == phase # "deployment failed" \/ disk = "old"
ReplacementHasBackup == disk = "old" \/ (backedUp /\ storeBackedUp)
SchemaCompatibleActivation == disk = "old" \/ schemaOK
====
