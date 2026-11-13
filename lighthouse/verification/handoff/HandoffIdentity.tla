------------------------- MODULE HandoffIdentity -------------------------
EXTENDS Naturals, FiniteSets, TLC
CONSTANT Bug
Sessions == {"A", "B"}
VARIABLES holder, epoch, leaseLive, nomination, pending, writes, receipts,
          durableEpoch, auditEpoch, operations, acknowledged, shiftId, since
vars == <<holder, epoch, leaseLive, nomination, pending, writes, receipts,
          durableEpoch, auditEpoch, operations, acknowledged, shiftId, since>>

Init ==
  /\ holder = "A" /\ epoch = 1 /\ leaseLive = TRUE
  /\ nomination = "none" /\ pending = "none"
  /\ writes = {} /\ receipts = {} /\ operations = {}
  /\ durableEpoch = 1 /\ auditEpoch = 1 /\ acknowledged = 1
  /\ shiftId = "shift-original" /\ since = "original-time"

Nominate ==
  /\ nomination \in {"none", "lost"}
  /\ nomination' = "pending"
  /\ UNCHANGED <<holder, epoch, leaseLive, pending, writes, receipts, durableEpoch,
                 auditEpoch, operations, acknowledged, shiftId, since>>
Invalidate ==
  /\ nomination = "pending"
  /\ nomination' \in {"cancelled", "expired", "superseded"}
  /\ UNCHANGED <<holder, epoch, leaseLive, pending, writes, receipts, durableEpoch,
                 auditEpoch, operations, acknowledged, shiftId, since>>
Acquire(operation) ==
  /\ epoch = 1 /\ operation \in {"accept-one", "accept-two"}
  /\ nomination = "pending" \/
       (Bug = "stale-nomination" /\ nomination \in {"cancelled", "expired", "superseded"})
  /\ epoch' = 2 /\ holder' = "B" /\ leaseLive' = TRUE
  /\ nomination' = IF nomination = "pending" THEN "acquired" ELSE "invalid-acquired"
  /\ operations' = operations \cup {operation}
  /\ durableEpoch' = IF Bug = "nondurable" THEN durableEpoch ELSE 2
  /\ auditEpoch' = IF Bug = "split-audit" THEN auditEpoch ELSE 2
  /\ acknowledged' = 2
  /\ shiftId' = IF Bug = "shift-reset" THEN "new-shift" ELSE shiftId
  /\ UNCHANGED <<pending, writes, receipts, since>>
Retry ==
  /\ operations # {} /\ UNCHANGED vars
Expire ==
  /\ leaseLive /\ leaseLive' = FALSE
  /\ nomination' = IF nomination = "pending" THEN "lost" ELSE nomination
  /\ UNCHANGED <<holder, epoch, pending, writes, receipts, durableEpoch,
                 auditEpoch, operations, acknowledged, shiftId, since>>
Arrive ==
  /\ pending = "none" /\ holder = "A" /\ leaseLive
  /\ pending' = "A-at-1"
  /\ UNCHANGED <<holder, epoch, leaseLive, nomination, writes, receipts, durableEpoch,
                 auditEpoch, operations, acknowledged, shiftId, since>>
Commit ==
  /\ pending = "A-at-1"
  /\ (holder = "A" /\ epoch = 1 /\ leaseLive) \/ Bug = "arrival-only"
  /\ writes' = writes \cup {IF holder = "A" /\ epoch = 1 /\ leaseLive THEN "valid" ELSE "stale"}
  /\ pending' = "committed"
  /\ UNCHANGED <<holder, epoch, leaseLive, nomination, receipts, durableEpoch,
                 auditEpoch, operations, acknowledged, shiftId, since>>
OldSessionActs ==
  /\ holder = "B" /\ Bug = "no-fence"
  /\ writes' = writes \cup {"stale"}
  /\ UNCHANGED <<holder, epoch, leaseLive, nomination, pending, receipts, durableEpoch,
                 auditEpoch, operations, acknowledged, shiftId, since>>
LegacyActs ==
  /\ Bug = "legacy-bypass" /\ writes' = writes \cup {"legacy"}
  /\ UNCHANGED <<holder, epoch, leaseLive, nomination, pending, receipts, durableEpoch,
                 auditEpoch, operations, acknowledged, shiftId, since>>
LateEvidence ==
  /\ holder = "B" /\ receipts' = receipts \cup {"A-ticket-at-1"}
  /\ UNCHANGED <<holder, epoch, leaseLive, nomination, pending, writes, durableEpoch,
                 auditEpoch, operations, acknowledged, shiftId, since>>
Done == UNCHANGED vars
Next == Nominate \/ Invalidate \/ (\E operation \in {"accept-one", "accept-two"}: Acquire(operation))
        \/ Retry \/ Expire \/ Arrive \/ Commit \/ OldSessionActs \/ LegacyActs \/ LateEvidence \/ Done
Spec == Init /\ [][Next]_vars

FencedWrites == writes \subseteq {"valid"}
DurableAcknowledgement == acknowledged <= durableEpoch
AuditAndOperationAtomic == durableEpoch = auditEpoch /\ (epoch = 2 => Cardinality(operations) = 1)
SingleCASWinner == Cardinality(operations) <= 1
ValidNomination == nomination # "invalid-acquired"
ShiftContinuous == shiftId = "shift-original" /\ since = "original-time"
=============================================================================
