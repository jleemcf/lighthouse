-------------------------- MODULE DispatchLedger --------------------------
EXTENDS Naturals, FiniteSets, TLC
CONSTANTS Bug, FeatureOn
Homes == {"A", "B"}
VARIABLES holder, phase, intent, spent, reply, journal, grants, running, delivered,
          live, crashed, transferred, expired, receiptDenied, settled,
          aliasIssued, gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, queue, applied,
                 reviewed
vars == <<holder, phase, intent, spent, reply, journal, grants, running, delivered,
          live, crashed, transferred, expired, receiptDenied, settled,
          aliasIssued, gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, queue, applied,
                 reviewed>>
Init ==
  /\ holder = "A" /\ phase = "working" /\ intent = "none" /\ spent = FALSE
  /\ reply = "none" /\ journal = [h \in Homes |-> "empty"]
  /\ grants = {} /\ running = {} /\ delivered = {} /\ live = Homes /\ crashed = {}
  /\ transferred = FALSE /\ expired = FALSE /\ receiptDenied = FALSE /\ settled = FALSE
  /\ aliasIssued = FALSE /\ gapSeen = FALSE /\ gapVisible = FALSE /\ gapResolved = FALSE
  /\ authorizedHome = "A" /\ reissued = FALSE /\ conflictIssued = FALSE
  /\ queue = "unacknowledged" /\ applied = FALSE /\ reviewed = FALSE

Issue ==
  /\ (FeatureOn \/ Bug = "off") /\ intent = "none"
  /\ intent' = "issued"
  /\ UNCHANGED <<holder, phase, spent, reply, journal, grants, running, delivered,
                 live, crashed, transferred, expired, receiptDenied, settled,
                 aliasIssued, gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, queue,
                 applied, reviewed>>
WriteBeforeConsume(h) ==
  /\ FeatureOn /\ h = holder /\ h \in live /\ ~expired /\ phase = "working"
  /\ intent = "issued" /\ journal[h] = "empty"
  /\ journal' = [journal EXCEPT ![h] = "requested"]
  /\ UNCHANGED <<holder, phase, intent, spent, reply, grants, running, delivered,
                 live, crashed, transferred, expired, receiptDenied, settled,
                 aliasIssued, gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, queue,
                 applied, reviewed>>
Consume(h) ==
  /\ FeatureOn /\ h = holder /\ h \in live /\ ~expired /\ phase = "working"
  /\ intent = "issued" /\ ~spent /\ authorizedHome = h /\ journal[h] = "requested" /\ ~gapVisible
  /\ intent' = "consumed" /\ spent' = TRUE /\ reply' = h
  /\ UNCHANGED <<holder, phase, journal, grants, running, delivered, live, crashed,
                 transferred, expired, receiptDenied, settled, aliasIssued,
                 gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, queue, applied, reviewed>>
ReceiveGrant(h) ==
  /\ reply = h /\ h \in live /\ journal[h] = "requested"
  /\ reply' = "none" /\ grants' = grants \cup {h}
  /\ journal' = [journal EXCEPT ![h] = "consumed"]
  /\ UNCHANGED <<holder, phase, intent, spent, running, delivered, live, crashed,
                 transferred, expired, receiptDenied, settled, aliasIssued,
                 gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, queue, applied, reviewed>>
LostAnswer ==
  /\ reply # "none" /\ reply' = "none"
  /\ UNCHANGED <<holder, phase, intent, spent, journal, grants, running, delivered,
                 live, crashed, transferred, expired, receiptDenied, settled,
                 aliasIssued, gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, queue,
                 applied, reviewed>>
Invoke(h) ==
  /\ h \in grants /\ h \in live /\ h \notin running /\ h \notin delivered
  /\ running' = running \cup {h} /\ grants' = grants \ {h}
  /\ journal' = [journal EXCEPT ![h] = "sending"]
  /\ UNCHANGED <<holder, phase, intent, spent, reply, delivered, live, crashed,
                 transferred, expired, receiptDenied, settled, aliasIssued,
                 gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, queue, applied, reviewed>>
ExternalDelivery(h) ==
  /\ h \in running /\ h \notin delivered
  /\ delivered' = delivered \cup {h} /\ running' = running \ {h}
  /\ UNCHANGED <<holder, phase, intent, spent, reply, journal, grants, live, crashed,
                 transferred, expired, receiptDenied, settled, aliasIssued,
                 gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, queue, applied, reviewed>>
Unknown ==
  /\ intent = "consumed" /\ intent' = "unknown"
  /\ UNCHANGED <<holder, phase, spent, reply, journal, grants, running, delivered,
                 live, crashed, transferred, expired, receiptDenied, settled,
                 aliasIssued, gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, queue,
                 applied, reviewed>>
Prepare ==
  /\ FeatureOn /\ holder = "A" /\ phase = "working" /\ ~expired
  /\ phase' = "draining"
  /\ UNCHANGED <<holder, intent, spent, reply, journal, grants, running, delivered,
                 live, crashed, transferred, expired, receiptDenied, settled,
                 aliasIssued, gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, queue,
                 applied, reviewed>>
Transfer ==
  /\ phase = "draining" /\ holder = "A" /\ ~transferred /\ ~expired
  /\ holder' = "B" /\ phase' = "working" /\ transferred' = TRUE
  /\ UNCHANGED <<intent, spent, reply, journal, grants, running, delivered,
                 live, crashed, expired, receiptDenied, settled, aliasIssued,
                 gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, queue, applied, reviewed>>
Crash(h) ==
  /\ h \in live /\ h \notin crashed
  /\ live' = live \ {h} /\ crashed' = crashed \cup {h} /\ grants' = grants \ {h}
  /\ reply' = IF reply = h THEN "none" ELSE reply
  /\ UNCHANGED <<holder, phase, intent, spent, journal, running, delivered,
                 transferred, expired, receiptDenied, settled, aliasIssued,
                 gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, queue, applied, reviewed>>
Restart(h) ==
  /\ h \notin live /\ live' = live \cup {h}
  /\ journal' = [journal EXCEPT ![h] = IF @ = "empty" THEN @ ELSE "unknown"]
  /\ UNCHANGED <<holder, phase, intent, spent, reply, grants, running, delivered,
                 crashed, transferred, expired, receiptDenied, settled, aliasIssued,
                 gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, queue, applied, reviewed>>
RetryConsumed ==
  /\ Bug = "resend" /\ spent /\ holder = "B" /\ "B" \in live
  /\ "B" \notin delivered /\ "B" \notin running /\ grants' = grants \cup {"B"}
  /\ reissued' = TRUE
  /\ UNCHANGED <<holder, phase, intent, spent, reply, journal, running, delivered,
                 live, crashed, transferred, expired, receiptDenied, settled,
                 aliasIssued, gapSeen, gapVisible, gapResolved, authorizedHome, conflictIssued, queue, applied,
                 reviewed>>
Receipt ==
  /\ "A" \in delivered /\ ~settled /\ ~receiptDenied
  /\ receiptDenied' = (Bug = "receipt-gate" /\ (holder # "A" \/ expired))
  /\ settled' = ~receiptDenied'
  /\ intent' = IF receiptDenied' THEN intent ELSE "delivered"
  /\ UNCHANGED <<holder, phase, spent, reply, journal, grants, running, delivered,
                 live, crashed, transferred, expired, aliasIssued,
                 gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, queue, applied, reviewed>>
Expire ==
  /\ FeatureOn /\ ~expired /\ expired' = TRUE
  /\ UNCHANGED <<holder, phase, intent, spent, reply, journal, grants, running, delivered,
                 live, crashed, transferred, receiptDenied, settled, aliasIssued,
                 gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, queue, applied, reviewed>>
AliasIssue ==
  /\ Bug = "alias" /\ intent \in {"issued", "consumed", "unknown"} /\ ~settled /\ ~aliasIssued
  /\ aliasIssued' = TRUE
  /\ UNCHANGED <<holder, phase, intent, spent, reply, journal, grants, running, delivered,
                 live, crashed, transferred, expired, receiptDenied, settled,
                 gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, queue, applied, reviewed>>
ImportGap ==
  /\ FeatureOn /\ transferred /\ ~gapSeen
  /\ gapSeen' = TRUE /\ gapVisible' = TRUE
  /\ UNCHANGED <<holder, phase, intent, spent, reply, journal, grants, running, delivered,
                 live, crashed, transferred, expired, receiptDenied, settled, aliasIssued,
                 gapResolved, authorizedHome, reissued, conflictIssued, queue, applied, reviewed>>
EmptyImport ==
  /\ Bug = "gap" /\ gapVisible /\ gapVisible' = FALSE
  /\ UNCHANGED <<holder, phase, intent, spent, reply, journal, grants, running, delivered,
                 live, crashed, transferred, expired, receiptDenied, settled, aliasIssued,
                 gapSeen, gapResolved, authorizedHome, reissued, conflictIssued, queue, applied, reviewed>>
ReviewQueue ==
  /\ FeatureOn /\ transferred /\ ~expired /\ queue = "unacknowledged"
  /\ queue' = "adopted" /\ reviewed' = TRUE
  /\ UNCHANGED <<holder, phase, intent, spent, reply, journal, grants, running, delivered,
                 live, crashed, transferred, expired, receiptDenied, settled, aliasIssued,
                 gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, applied>>
ApplyQueue ==
  /\ FeatureOn /\ ~expired /\ ~applied
  /\ (queue = "adopted" \/ (Bug = "queue" /\ transferred))
  /\ queue' = "acknowledged" /\ applied' = TRUE
  /\ UNCHANGED <<holder, phase, intent, spent, reply, journal, grants, running, delivered,
                 live, crashed, transferred, expired, receiptDenied, settled, aliasIssued,
                 gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, reviewed>>
Adopt ==
  /\ FeatureOn /\ holder = "B" /\ intent = "issued" /\ ~spent /\ authorizedHome = "A" /\ ~expired
  /\ authorizedHome' = "B"
  /\ UNCHANGED <<holder, phase, intent, spent, reply, journal, grants, running, delivered,
                 live, crashed, transferred, expired, receiptDenied, settled, aliasIssued,
                 gapSeen, gapVisible, gapResolved, reissued, conflictIssued, queue, applied, reviewed>>
ConflictDispatch ==
  /\ FeatureOn /\ spent /\ ~conflictIssued /\ holder \in live /\ ~expired /\ phase = "working"
  /\ (settled \/ Bug = "target") /\ ~gapVisible
  /\ (Bug # "settled-hold" \/ intent = "quiesced")
  /\ conflictIssued' = TRUE
  /\ UNCHANGED <<holder, phase, intent, spent, reply, journal, grants, running, delivered,
                 live, crashed, transferred, expired, receiptDenied, settled, aliasIssued,
                 gapSeen, gapVisible, gapResolved, authorizedHome, reissued, queue, applied, reviewed>>
Reconcile ==
  /\ FeatureOn /\ spent /\ ~settled /\ running = {} /\ grants = {} /\ reply = "none"
  /\ settled' = TRUE /\ intent' = "quiesced"
  /\ UNCHANGED <<holder, phase, spent, reply, journal, grants, running, delivered,
                 live, crashed, transferred, expired, receiptDenied, aliasIssued,
                 gapSeen, gapVisible, gapResolved, authorizedHome, reissued, conflictIssued, queue, applied, reviewed>>
ResolveGap ==
  /\ FeatureOn /\ gapVisible /\ ~gapResolved
  /\ gapResolved' = TRUE /\ gapVisible' = FALSE
  /\ UNCHANGED <<holder, phase, intent, spent, reply, journal, grants, running, delivered,
                 live, crashed, transferred, expired, receiptDenied, settled, aliasIssued,
                 gapSeen, authorizedHome, reissued, conflictIssued, queue, applied, reviewed>>
Done == UNCHANGED vars
Next == Issue \/ (\E h \in Homes: WriteBeforeConsume(h) \/ Consume(h) \/ ReceiveGrant(h)
        \/ Invoke(h) \/ ExternalDelivery(h) \/ Crash(h) \/ Restart(h))
        \/ LostAnswer \/ Unknown \/ Prepare \/ Transfer \/ RetryConsumed \/ Receipt \/ Expire
        \/ Adopt \/ ConflictDispatch \/ AliasIssue \/ ImportGap \/ EmptyImport \/ ReviewQueue \/ ApplyQueue
        \/ Reconcile \/ ResolveGap \/ Done
NoRelaySentTwice == Cardinality(delivered) <= 1
NoPermissionReissued == ~reissued
TargetHeld == conflictIssued => settled
SettledDispatchUnblocked ==
  FeatureOn /\ spent /\ settled /\ ~conflictIssued /\ holder \in live /\ ~expired
    /\ phase = "working" /\ ~gapVisible => ENABLED ConflictDispatch
LateEvidenceAccepted == ~receiptDenied
LogicalIntentSuppression == ~aliasIssued
ImportGapVisible == gapSeen /\ ~gapResolved => gapVisible
QueueRequiresReview == applied => reviewed
FeatureOffParity == ~FeatureOn => intent = "none" /\ ~spent /\ ~applied
=============================================================================
