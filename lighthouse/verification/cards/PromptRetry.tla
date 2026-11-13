---- MODULE PromptRetry ----
EXTENDS TLC, Naturals
CONSTANTS ReuseStoredApproval, ReapproveRepeat, SettleFollowThrough, KeepStaleProvenance
VARIABLES prompt, approval, basis, basisCurrent, ownAskOpen, followOpen, ticket, deliveries, staleTicket, repeatChanged
VARIABLE failedDelivery
vars == <<prompt, approval, basis, basisCurrent, ownAskOpen, followOpen, ticket, deliveries,
          staleTicket, repeatChanged, failedDelivery>>

Init == /\ prompt = "approved" /\ approval \in {"Send", "yolo", "his word", "authority"}
        /\ basis = approval /\ basisCurrent = TRUE
        /\ ownAskOpen = (approval # "Send") /\ followOpen = (approval # "Send")
        /\ ticket = "none" /\ deliveries = 0 /\ staleTicket = FALSE /\ repeatChanged = FALSE
        /\ failedDelivery = FALSE
EndBasis == /\ basis # "Send" /\ basisCurrent /\ basisCurrent' = FALSE
            /\ UNCHANGED <<prompt, approval, basis, ownAskOpen, followOpen, ticket, deliveries,
                           staleTicket, repeatChanged, failedDelivery>>
FreshBasis == /\ prompt = "approved" /\ ticket = "none" /\ ~basisCurrent /\ failedDelivery /\ deliveries = 0
              /\ basis' \in {"yolo", "his word", "authority"} \ {basis} /\ basisCurrent' = TRUE
              /\ UNCHANGED <<prompt, approval, ownAskOpen, followOpen, ticket, deliveries,
                             staleTicket, repeatChanged, failedDelivery>>
NewAsk == /\ prompt = "relayed" /\ ~followOpen /\ followOpen' = TRUE
          /\ UNCHANGED <<prompt, approval, basis, basisCurrent, ownAskOpen, ticket, deliveries,
                         staleTicket, repeatChanged, failedDelivery>>
IssueTicket == /\ ticket = "none" /\ deliveries < 2
               /\ (basis = "Send" \/ basisCurrent \/ ReuseStoredApproval)
               /\ ticket' = IF prompt = "relayed" THEN "repeat" ELSE "first"
               /\ staleTicket' = (basis # "Send" /\ ~basisCurrent)
               /\ approval' = IF prompt = "approved" /\ ~KeepStaleProvenance THEN basis ELSE approval
               /\ failedDelivery' = FALSE
               /\ repeatChanged' = (repeatChanged \/ (ReapproveRepeat /\ prompt = "relayed"))
               /\ prompt' = IF ReapproveRepeat THEN "approved" ELSE prompt
               /\ followOpen' = IF ReapproveRepeat /\ prompt = "relayed" /\ approval = "Send"
                                 THEN FALSE ELSE followOpen
               /\ UNCHANGED <<basis, basisCurrent, ownAskOpen, deliveries>>
Failed == /\ ticket # "none" /\ ticket' = "none" /\ failedDelivery' = TRUE
          /\ UNCHANGED <<prompt, approval, basis, basisCurrent, ownAskOpen, followOpen, deliveries,
                         staleTicket, repeatChanged>>
Receipt == /\ ticket # "none"
           /\ ((prompt = "approved" /\ (ownAskOpen \/ approval = "Send"))
               \/ (prompt = "relayed" /\ ticket = "repeat"))
           /\ prompt' = "relayed" /\ ownAskOpen' = FALSE /\ ticket' = "none" /\ deliveries' = deliveries + 1
           /\ followOpen' = IF SettleFollowThrough THEN FALSE ELSE followOpen
           /\ UNCHANGED <<approval, basis, basisCurrent, staleTicket, repeatChanged, failedDelivery>>
RefuseOrWait == /\ ticket = "none" /\ (deliveries = 2 \/ (basis # "Send" /\ ~basisCurrent))
               /\ UNCHANGED vars
Next == EndBasis \/ FreshBasis \/ NewAsk \/ IssueTicket \/ Failed \/ Receipt \/ RefuseOrWait

TicketRevalidates == ~staleTicket
RepeatKeepsApproval == ~repeatChanged
FollowThroughStaysCaptains == approval # "Send" => followOpen
TicketRecordsCheckedBasis == ticket = "first" => approval = basis
====
