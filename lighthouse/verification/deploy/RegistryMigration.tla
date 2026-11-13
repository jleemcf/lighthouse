---- MODULE RegistryMigration ----
EXTENDS Naturals, TLC
CONSTANT Fault
VARIABLES phase, schema, backup, registry, rollbackReady, runningSchema, work, retainedWork
vars == <<phase, schema, backup, registry, rollbackReady, runningSchema, work, retainedWork>>
Init == /\ phase = "offline schema 1" /\ schema = 1 /\ backup = FALSE
        /\ registry = FALSE /\ rollbackReady = FALSE /\ runningSchema = 0 /\ work = 0 /\ retainedWork = 0
Backup == /\ phase = "offline schema 1" /\ phase' = "backup complete" /\ backup' = TRUE
  /\ UNCHANGED <<schema, registry, rollbackReady, runningSchema, work, retainedWork>>
PrepareRollback == /\ phase = "backup complete" /\ phase' = "rollback ready" /\ rollbackReady' = TRUE
  /\ UNCHANGED <<schema, backup, registry, runningSchema, work, retainedWork>>
ImportRegistry == /\ phase = "rollback ready" /\ phase' = "registry ready" /\ registry' = TRUE
  /\ UNCHANGED <<schema, backup, rollbackReady, runningSchema, work, retainedWork>>
MarkSchema == /\ (phase = "registry ready" \/ (Fault = "early marker" /\ phase = "offline schema 1"))
  /\ phase' = "offline schema 2" /\ schema' = 2
  /\ UNCHANGED <<backup, registry, rollbackReady, runningSchema, work, retainedWork>>
Deploy == /\ phase = "offline schema 2" /\ phase' = "serving schema 2" /\ runningSchema' = 2
  /\ UNCHANGED <<schema, backup, registry, rollbackReady, work, retainedWork>>
NewWork == /\ phase = "serving schema 2" /\ work = 0 /\ work' = 1 /\ retainedWork' = 1
  /\ UNCHANGED <<phase, schema, backup, registry, rollbackReady, runningSchema>>
Rollback == /\ phase = "serving schema 2" /\ phase' = "rolled back compatible code"
  /\ runningSchema' = (IF Fault = "old release" THEN 1 ELSE 2)
  /\ work' = (IF Fault = "restore backup" THEN 0 ELSE work)
  /\ UNCHANGED <<schema, backup, registry, rollbackReady, retainedWork>>
Done == UNCHANGED vars
Next == Backup \/ PrepareRollback \/ ImportRegistry \/ MarkSchema \/ Deploy \/ NewWork \/ Rollback \/ Done
MarkerRequiresFullBackup == schema = 1 \/ backup
MarkerRequiresRegistry == schema = 1 \/ registry
MarkerRequiresCompatibleRollback == schema = 1 \/ rollbackReady
RunningReleaseDeclaresSchema == runningSchema = 0 \/ runningSchema >= schema
RollbackNeverRestoresOldData == work >= retainedWork
====
