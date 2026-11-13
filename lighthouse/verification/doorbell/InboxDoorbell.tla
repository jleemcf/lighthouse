---- MODULE InboxDoorbell ----
EXTENDS Naturals, TLC
CONSTANTS MaxUpdates, RetryFailures, InventRevision, AcknowledgeLatest
VARIABLES revision, acknowledged, observed, queued, sent, running, restarts
vars == <<revision, acknowledged, observed, queued, sent, running, restarts>>

Init ==
  /\ revision = 0 /\ acknowledged = 0 /\ observed = 0
  /\ queued = FALSE /\ sent = 0 /\ running = TRUE /\ restarts = 0

CaptainWrites ==
  /\ running /\ revision < MaxUpdates
  /\ revision' = revision + 1 /\ queued' = TRUE
  /\ UNCHANGED <<acknowledged, observed, sent, running, restarts>>

SendLatest ==
  /\ running /\ queued /\ sent = 0
  /\ sent' = IF InventRevision THEN revision + 1 ELSE revision
  /\ UNCHANGED <<revision, acknowledged, observed, queued, running, restarts>>

Http2xx ==
  /\ running /\ sent > 0
  /\ observed' = IF sent > observed THEN sent ELSE observed
  /\ acknowledged' = IF AcknowledgeLatest THEN revision ELSE sent
  /\ queued' = (revision > acknowledged') /\ sent' = 0
  /\ UNCHANGED <<revision, running, restarts>>

ReceiverFailsOrTimesOut ==
  /\ running /\ sent > 0
  /\ queued' = RetryFailures /\ sent' = 0
  /\ UNCHANGED <<revision, acknowledged, observed, running, restarts>>

ResponseLost ==
  /\ running /\ sent > 0
  /\ observed' = IF sent > observed THEN sent ELSE observed
  /\ queued' = RetryFailures /\ sent' = 0
  /\ UNCHANGED <<revision, acknowledged, running, restarts>>

Crash ==
  /\ running /\ restarts = 0
  /\ running' = FALSE /\ queued' = FALSE /\ sent' = 0
  /\ UNCHANGED <<revision, acknowledged, observed, restarts>>

Startup ==
  /\ ~running /\ restarts = 0
  /\ running' = TRUE /\ restarts' = 1 /\ queued' = (revision > acknowledged)
  /\ UNCHANGED <<revision, acknowledged, observed, sent>>

Idle == sent = 0 /\ UNCHANGED vars
Next == CaptainWrites \/ SendLatest \/ Http2xx \/ ReceiverFailsOrTimesOut \/ ResponseLost \/ Crash \/ Startup \/ Idle

NoSilentLostWake == revision <= acknowledged \/ ~running \/ queued
CoalescingNeverInventsUpdates == acknowledged <= revision /\ observed <= revision /\ sent <= revision
AcknowledgmentIsForSentRevision == acknowledged <= observed
====
