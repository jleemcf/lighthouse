------------------------ MODULE CheckpointTransfer ------------------------
EXTENDS Naturals, FiniteSets, TLC
CONSTANTS Bug, Enabled, ContextMissing
VARIABLE s
vars == <<s>>
Init == s = [phase |-> "working", holder |-> "A", epoch |-> 1, saved |-> FALSE,
  revision |-> 0, readRevision |-> 2, readPhase |-> "none", unknown |-> FALSE,
  degraded |-> FALSE, held |-> FALSE, acceptOps |-> {}, blockedWork |-> FALSE,
  stalePickup |-> FALSE, blindAccept |-> FALSE, shiftId |-> "original", since |-> "original",
  crashed |-> FALSE, continued |-> FALSE, restarted |-> FALSE,
  live |-> TRUE, successorLive |-> TRUE, usedLost |-> FALSE]
ActiveLive == IF s.holder = "A" THEN s.live ELSE s.successorLive
Prepare ==
  /\ (Enabled \/ Bug = "feature-off") /\ s.live
  /\ s.phase = "working" \/ (s.phase = "cancelled" /\ ~s.restarted)
  /\ s' = [s EXCEPT !.phase = "draining", !.saved = FALSE, !.readPhase = "none",
      !.degraded = FALSE, !.restarted = s.restarted \/ s.phase = "cancelled"]
Checkpoint ==
  /\ s.phase = "draining" /\ ~s.saved /\ s.live
  /\ s' = [s EXCEPT !.saved = TRUE]
Continue ==
  /\ Enabled /\ s.phase \in {"working", "cancelled"} /\ s.live
  /\ s' = [s EXCEPT !.phase = "pickup", !.saved = TRUE, !.continued = TRUE,
      !.held = s.unknown /\ Bug = "continuation-hold"]
UnknownWork ==
  /\ s.phase \in {"working", "draining"} /\ ~s.unknown /\ ~s.saved
  /\ s' = [s EXCEPT !.unknown = TRUE]
ResolveEffects ==
  /\ s.unknown /\ s.holder = "A" /\ s.phase \in {"working", "draining", "cancelled", "pickup"}
  /\ s' = [s EXCEPT !.unknown = FALSE]
Seal ==
  /\ s.phase = "draining" /\ s.saved /\ s.live
  /\ s' = [s EXCEPT !.phase = "sealed", !.degraded = (s.unknown \/ ContextMissing) /\ Bug # "false-clean",
      !.held = (s.unknown \/ (ContextMissing /\ Bug = "context-hold")) /\ Bug # "false-clean"]
Read ==
  /\ s.phase \in {"sealed", "pickup"} /\ s.saved
  /\ s' = [s EXCEPT !.readRevision = s.revision, !.readPhase = s.phase]
LateAsk ==
  /\ s.saved /\ s.revision = 0
  /\ s' = [s EXCEPT !.revision = 1]
Accept(operation) ==
  /\ s.phase = "sealed" /\ operation \in {"one", "two"}
  /\ (s.readPhase = "sealed" \/ Bug = "blind-accept")
  /\ (s.live \/ Bug = "lost-accept")
  /\ s' = [s EXCEPT !.holder = "B", !.epoch = 2, !.phase = "pickup",
      !.acceptOps = s.acceptOps \cup {operation}, !.blindAccept = s.readPhase # "sealed",
      !.shiftId = IF Bug = "shift-reset" THEN "new" ELSE s.shiftId, !.usedLost = ~s.live]
Pickup ==
  /\ s.phase = "pickup" /\ s.readPhase = "pickup" /\ ActiveLive
  /\ (s.readRevision = s.revision \/ Bug = "stale-pickup")
  /\ s' = [s EXCEPT !.stalePickup = s.readRevision # s.revision, !.phase = "done"]
Cancel ==
  /\ s.phase \in {"draining", "sealed"} \/
      (Bug = "rollback" /\ s.phase = "pickup" /\ s.holder = "B")
  /\ s' = [s EXCEPT !.phase = "cancelled", !.epoch = 1, !.holder = "A",
      !.held = s.unknown /\ Bug = "cancel-hold"]
Work ==
  /\ s.phase \in {"done", "cancelled"} \/
      (Bug = "drain-work" /\ s.phase \in {"draining", "sealed", "pickup"})
  /\ s' = [s EXCEPT !.blockedWork = s.blockedWork \/ s.phase \in {"draining", "sealed", "pickup"}]
Expire ==
  /\ s.holder = "A" /\ s.live /\ s' = [s EXCEPT !.live = FALSE]
ExpireSuccessor ==
  /\ s.holder = "B" /\ s.successorLive /\ s' = [s EXCEPT !.successorLive = FALSE]
Crash ==
  /\ ~s.crashed /\ s' = [s EXCEPT !.crashed = TRUE]
Retry ==
  /\ s.crashed /\ s.acceptOps # {} /\ s.epoch < 3
  /\ s' = [s EXCEPT !.epoch = IF Bug = "double-accept" THEN s.epoch + 1 ELSE s.epoch]
Next == Prepare \/ Checkpoint \/ Continue \/ UnknownWork \/ ResolveEffects \/ Seal \/ Read \/ LateAsk \/
  (\E operation \in {"one", "two"}: Accept(operation)) \/ Pickup \/ Cancel \/ Work \/
  Expire \/ ExpireSuccessor \/ Crash \/ Retry
Spec == Init /\ [][Next]_vars
ShiftContinuous == s.shiftId = "original" /\ s.since = "original"
SingleTransfer == Cardinality(s.acceptOps) <= 1 /\ s.epoch <= 2
NoRollback == s.acceptOps # {} => s.holder = "B" /\ s.epoch >= 2
NoBlindAccept == ~s.blindAccept
FreshPickup == ~s.stalePickup
NoDrainWork == ~s.blockedWork
HonestSeal == ~s.continued /\ s.phase \in {"sealed", "pickup", "done"} /\ s.unknown => s.degraded /\ s.held
NoUnjustifiedHolds == s.held => s.unknown /\ ~s.continued /\ s.phase \in {"sealed", "pickup", "done"}
FeatureOffParity == ~Enabled => s.phase = "working" /\ s.epoch = 1 /\ ~s.saved
ContinuationIdentity == s.continued => s.holder = "A" /\ s.epoch = 1
NoPlannedRecovery == ~s.usedLost
=============================================================================
