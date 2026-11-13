---- MODULE NoticeInbox ----
EXTENDS Naturals, TLC
CONSTANTS TrustCoordinator, DropNotice, RepeatNotice
VARIABLES notice, announced, wakes, ownerSpoke, authoritySource, approvalSource, answeredBy
vars == <<notice, announced, wakes, ownerSpoke, authoritySource, approvalSource, answeredBy>>

Init == /\ notice = "absent" /\ announced = FALSE /\ wakes = 0 /\ ownerSpoke = FALSE
        /\ authoritySource = "none" /\ approvalSource = "none" /\ answeredBy = "none"
PostNotice == /\ notice = "absent" /\ notice' = "pending"
              /\ authoritySource' = IF TrustCoordinator THEN "coordinator" ELSE authoritySource
              /\ approvalSource' = IF TrustCoordinator THEN "coordinator" ELSE approvalSource
              /\ answeredBy' = IF TrustCoordinator THEN "coordinator" ELSE answeredBy
              /\ UNCHANGED <<announced, wakes, ownerSpoke>>
OwnerWords == /\ ~ownerSpoke /\ ownerSpoke' = TRUE /\ authoritySource' = "owner"
              /\ approvalSource' = "owner" /\ answeredBy' = "owner"
              /\ UNCHANGED <<notice, announced, wakes>>
PollInbox == /\ notice = "pending" /\ (~announced \/ (RepeatNotice /\ wakes < 2))
             /\ announced' = TRUE /\ wakes' = IF DropNotice THEN 0 ELSE wakes + 1
             /\ UNCHANGED <<notice, ownerSpoke, authoritySource, approvalSource, answeredBy>>
ReplyOnInboxCard == /\ notice = "pending" /\ announced /\ notice' = "handled"
                    /\ UNCHANGED <<announced, wakes, ownerSpoke, authoritySource, approvalSource, answeredBy>>
ReadFailsOrRetry == UNCHANGED vars
Next == PostNotice \/ OwnerWords \/ PollInbox \/ ReplyOnInboxCard \/ ReadFailsOrRetry

NoticeNeverGrantsAuthority == authoritySource # "coordinator"
NoticeNeverApprovesRelay == approvalSource # "coordinator"
NoticeNeverAnswersOwnerAsk == answeredBy # "coordinator"
AnnouncedNoticeWakes == announced => wakes > 0
NoticeWakesOnce == wakes <= 1
====
