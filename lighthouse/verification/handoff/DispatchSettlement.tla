------------------------ MODULE DispatchSettlement ------------------------
EXTENDS Naturals, TLC
CONSTANT Bug
VARIABLE s
vars == <<s>>
CommitFound == s.cache /\ (s.originKnown \/ s.importerOriginal \/ Bug # "legacy-origin")
Effects(d, g, r) == d \in {"unacknowledged", "adopted"} \/ g \/ r \in {"unknown", "conflict"}
KeepHold(d, g, r) == s.held /\ Effects(d, g, r)
Init == s = [active |-> FALSE, inventoried |-> FALSE, drained |-> FALSE, cache |-> FALSE,
             disposition |-> "absent", executions |-> 0, transferred |-> FALSE, held |-> FALSE,
             gap |-> FALSE, gapSeen |-> FALSE, gapResolved |-> FALSE,
             relay |-> "none", owner |-> "none", sourceMarked |-> FALSE, receiptSeen |-> FALSE,
             receiptDelivered |-> FALSE, ownerReceiptSeen |-> FALSE,
             originKnown |-> FALSE, importerOriginal |-> TRUE]
Inventory(known, original) ==
  /\ ~s.inventoried
  /\ s' = [s EXCEPT !.inventoried = TRUE, !.originKnown = known, !.importerOriginal = original,
             !.disposition = IF s.cache /\ (known \/ original \/ Bug # "legacy-origin")
                              THEN "acknowledged" ELSE "unacknowledged"]
LegacyDrain ==
  /\ ~s.active /\ ~s.drained
  /\ s' = [s EXCEPT !.drained = TRUE, !.cache = TRUE, !.executions = @ + 1,
             !.disposition = IF s.inventoried /\ Bug # "migration"
                              THEN "acknowledged" ELSE @]
Activate ==
  /\ ~s.active /\ s.inventoried
  /\ s' = [s EXCEPT !.active = TRUE,
             !.disposition = IF CommitFound /\ Bug # "migration" THEN "acknowledged" ELSE @]
PruneCache ==
  /\ s.active /\ s.cache
  /\ s' = [s EXCEPT !.cache = FALSE]
Review(d) ==
  /\ s.active /\ s.disposition = "unacknowledged" /\ d \in {"adopted", "superseded", "rejected"}
  /\ s' = [s EXCEPT !.disposition = d,
             !.held = IF Bug = "call-hold" THEN @ ELSE KeepHold(d, s.gap, s.relay)]
Apply ==
  /\ s.active /\ s.disposition = "adopted"
  /\ s' = [s EXCEPT !.disposition = "acknowledged", !.executions = @ + 1,
             !.held = IF Bug = "call-hold" THEN @ ELSE KeepHold("acknowledged", s.gap, s.relay)]
ImportGap ==
  /\ s.active /\ ~s.gapSeen /\ ~s.transferred
  /\ s' = [s EXCEPT !.gap = TRUE, !.gapSeen = TRUE]
ResolveGap ==
  /\ s.active /\ s.gap
  /\ s' = [s EXCEPT !.gap = FALSE, !.gapResolved = TRUE,
             !.held = IF Bug = "gap-hold" THEN @ ELSE KeepHold(s.disposition, FALSE, s.relay)]
StartRelay ==
  /\ s.active /\ s.relay = "none" /\ ~s.held /\ ~s.gap
  /\ s' = [s EXCEPT !.relay = "unknown"]
Transfer ==
  /\ s.active /\ ~s.transferred
  /\ s' = [s EXCEPT !.transferred = TRUE, !.held = Effects(s.disposition, s.gap, s.relay)]
OwnerReconcile(outcome) ==
  /\ s.active /\ s.relay = "unknown" /\ s.owner = "none"
  /\ outcome \in {"delivered", "not-delivered", "conflict-resolved"}
  /\ s' = [s EXCEPT !.owner = outcome, !.relay = "quiesced",
             !.sourceMarked = outcome = "delivered" /\ Bug # "owner-source",
             !.held = KeepHold(s.disposition, s.gap, "quiesced")]
Receipt(delivered) ==
  /\ s.active /\ s.relay \in {"unknown", "quiesced"} /\ ~s.receiptSeen
  /\ LET conflict == Bug # "owner-conflict" /\
                     ((s.owner = "not-delivered" /\ delivered) \/ (s.owner = "delivered" /\ ~delivered))
          result == IF conflict THEN "conflict"
                    ELSE IF s.owner # "none" /\ (Bug # "owner-agree" \/ delivered) THEN s.relay
                    ELSE IF delivered THEN "delivered" ELSE "unknown"
     IN s' = [s EXCEPT !.relay = result, !.receiptSeen = TRUE, !.receiptDelivered = delivered,
               !.ownerReceiptSeen = s.owner # "none",
               !.sourceMarked = @ \/ (~conflict /\ delivered /\ s.owner = "none"),
               !.held = KeepHold(s.disposition, s.gap, result)]
Done == UNCHANGED vars
Next == (\E known, original \in BOOLEAN: Inventory(known, original)) \/ LegacyDrain \/ Activate \/ PruneCache
        \/ (\E d \in {"adopted", "superseded", "rejected"}: Review(d))
        \/ Apply \/ ImportGap \/ ResolveGap \/ StartRelay \/ Transfer
        \/ (\E outcome \in {"delivered", "not-delivered", "conflict-resolved"}: OwnerReconcile(outcome))
        \/ (\E delivered \in BOOLEAN: Receipt(delivered)) \/ Done
MigrationCommittedOnce == s.executions <= 1
ActivationSettlesCommit == s.active /\ s.drained => s.disposition = "acknowledged"
SettledHoldsReleased == s.transferred /\ ~Effects(s.disposition, s.gap, s.relay) => ~s.held
OwnerDeliveryMarked == s.owner = "delivered" => s.sourceMarked
OpposedEvidenceConflicts == s.ownerReceiptSeen /\
  ((s.owner = "not-delivered" /\ s.receiptDelivered) \/ (s.owner = "delivered" /\ ~s.receiptDelivered))
  => s.relay = "conflict"
AgreedEvidencePreservesOwner == s.ownerReceiptSeen /\ s.owner # "none" /\
  ~((s.owner = "not-delivered" /\ s.receiptDelivered) \/ (s.owner = "delivered" /\ ~s.receiptDelivered))
  => s.relay = "quiesced"
=============================================================================
