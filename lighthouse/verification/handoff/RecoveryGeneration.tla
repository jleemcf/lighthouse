------------------------ MODULE RecoveryGeneration ------------------------
EXTENDS Naturals, TLC
CONSTANTS Bug, Enabled, OldDisk
VARIABLE s
vars == <<s>>
Init == s = [holder |-> "A", epoch |-> 1, phase |-> "working", lost |-> FALSE,
  approved |-> FALSE, approvalEpoch |-> 0, revoked |-> FALSE, read |-> FALSE,
  transferred |-> FALSE, complete |-> FALSE, gap |-> FALSE, held |-> FALSE,
  jobRunning |-> TRUE, stewardOn |-> TRUE, resultVisible |-> FALSE,
  oldRenewed |-> FALSE, oldMutation |-> FALSE, helperGeneration |-> 1,
  oldHelperActs |-> FALSE, killedUnrelated |-> FALSE, target |-> "original",
  targetPinned |-> FALSE, cancelled |-> FALSE, revocationUndone |-> FALSE,
  helperFailure |-> FALSE, helperExpired |-> FALSE, helperStopped |-> FALSE, lossVisible |-> FALSE,
  replayed |-> FALSE, shift |-> "original", since |-> "original"]
Feature == Enabled \/ Bug = "off"
Lose == /\ ~s.lost /\ s.holder = "A"
        /\ s' = [s EXCEPT !.lost = TRUE]
Approve ==
  /\ Feature /\ ~s.approved /\ ~s.transferred /\ ~s.cancelled
  /\ (s.lost \/ s.revoked \/ Bug = "revocation")
  /\ s' = [s EXCEPT !.approved = TRUE, !.approvalEpoch = s.epoch, !.phase = "draining",
      !.gap = TRUE, !.held = TRUE]
Revoke == /\ Feature /\ ~s.revoked /\ ~s.transferred
          /\ s' = [s EXCEPT !.revoked = TRUE]
Read == /\ Feature /\ ~s.read /\ s.approved
        /\ s' = [s EXCEPT !.read = TRUE]
Cancel ==
  /\ Feature /\ s.approved /\ ~s.transferred
  /\ s' = [s EXCEPT !.approved = FALSE, !.read = FALSE, !.cancelled = TRUE, !.phase = "working",
      !.gap = Bug = "cancel-gap", !.held = FALSE]
PredecessorCancel ==
  /\ Feature /\ s.approved /\ s.revoked /\ ~s.transferred /\ Bug = "cancel"
  /\ s' = [s EXCEPT !.approved = FALSE, !.read = FALSE, !.cancelled = TRUE, !.phase = "working",
      !.revocationUndone = TRUE, !.gap = FALSE, !.held = FALSE]
LocateOriginal ==
  /\ Feature /\ s.holder = "A" /\ ~s.targetPinned
  /\ s' = [s EXCEPT !.targetPinned = TRUE]
PinSuccessor ==
  /\ Feature /\ s.holder = "B" /\ ~s.targetPinned /\ Bug = "pin"
  /\ s' = [s EXCEPT !.targetPinned = TRUE, !.target = "local"]
Recover ==
  /\ Feature /\ ~s.transferred
  /\ ((s.approved /\ s.approvalEpoch = s.epoch /\ s.read) \/ Bug = "approval")
  /\ s' = [s EXCEPT !.holder = "B", !.epoch = 2, !.phase = "pickup", !.transferred = TRUE,
      !.complete = Bug = "missing" /\ ~OldDisk, !.gap = TRUE, !.held = TRUE,
      !.stewardOn = Bug # "steward", !.target = IF Bug = "target" THEN "local" ELSE @]
Pickup == /\ s.transferred /\ s.phase = "pickup"
          /\ s' = [s EXCEPT !.phase = "working"]
ResolveGap ==
  /\ s.transferred /\ s.gap
  /\ s' = [s EXCEPT !.gap = FALSE, !.held = s.jobRunning]
CompleteJob ==
  /\ s.jobRunning
  /\ s' = [s EXCEPT !.jobRunning = FALSE, !.resultVisible = TRUE,
      !.held = IF Bug = "completion" THEN @ ELSE s.gap]
ReturningRenew ==
  /\ s.transferred /\ ~s.oldRenewed /\ Bug = "renew"
  /\ s' = [s EXCEPT !.oldRenewed = TRUE]
ReturningQueue ==
  /\ s.transferred /\ ~s.oldMutation /\ Bug = "queue"
  /\ s' = [s EXCEPT !.oldMutation = TRUE]
StartHelpers ==
  /\ s.transferred /\ s.phase = "working" /\ s.helperGeneration = 1
  /\ s' = [s EXCEPT !.helperGeneration = 2, !.killedUnrelated = Bug = "pid"]
OldHelperWrite ==
  /\ s.helperGeneration = 2 /\ ~s.oldHelperActs /\ Bug = "helper"
  /\ s' = [s EXCEPT !.oldHelperActs = TRUE]
Recollect == /\ s.helperGeneration = 2 /\ ~s.replayed /\ Bug = "replay"
             /\ s' = [s EXCEPT !.replayed = TRUE]
RefreshFailure ==
  /\ Feature /\ ~s.helperFailure /\ ~s.helperExpired
  /\ s' = [s EXCEPT !.helperFailure = TRUE, !.helperStopped = Bug = "transient"]
ExpireHelper ==
  /\ Feature /\ s.helperFailure /\ ~s.helperExpired
  /\ s' = [s EXCEPT !.helperExpired = TRUE, !.helperStopped = TRUE, !.lossVisible = Bug # "notice"]
Next == Lose \/ Approve \/ Revoke \/ Read \/ Recover \/ Pickup \/ ResolveGap \/ CompleteJob
        \/ ReturningRenew \/ ReturningQueue \/ StartHelpers \/ OldHelperWrite \/ Recollect
        \/ Cancel \/ PredecessorCancel \/ LocateOriginal \/ PinSuccessor \/ RefreshFailure \/ ExpireHelper
Spec == Init /\ [][Next]_vars
ApprovedPerLoss == s.transferred => s.approved /\ s.approvalEpoch = 1 /\ s.read
EmergencyRevocation == s.transferred => s.lost \/ s.revoked
OldEpochFenced == ~s.oldRenewed /\ ~s.oldMutation
GenerationScoped == ~s.oldHelperActs
NoTranscriptReplay == ~s.replayed
NoUnrelatedKill == ~s.killedUnrelated
MissingDataHonest == (s.transferred /\ ~OldDisk) => ~s.complete
UnknownEffectsHeld == (s.transferred /\ s.gap) => s.held
OriginalTarget == s.target = "original"
StewardContinuous == s.stewardOn /\ (~s.jobRunning => s.resultVisible)
CompletionReleasesHold == (s.transferred /\ ~s.gap /\ ~s.jobRunning) => ~s.held
ShiftContinuous == s.shift = "original" /\ s.since = "original"
FeatureOffParity == ~Enabled => s.holder = "A" /\ s.epoch = 1 /\ s.phase = "working"
CaptainControlsRecovery == ~s.revocationUndone
CancelReleasesGap == s.cancelled => ~s.gap /\ ~s.held
TransientHelpersContinue == (s.helperFailure /\ ~s.helperExpired) => ~s.helperStopped
HelperLossVisible == s.helperStopped => s.lossVisible
=============================================================================
