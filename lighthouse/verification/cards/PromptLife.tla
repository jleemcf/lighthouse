---- MODULE PromptLife ----
EXTENDS TLC
CONSTANTS AllowFinalApproval, AllowUnrelatedLineReceipt
VARIABLES prompt, approval, askOpen, cardOpen, ticket, ended, lineSource, creditedSource
vars == <<prompt, approval, askOpen, cardOpen, ticket, ended, lineSource, creditedSource>>

Init == /\ prompt = "offered" /\ approval = "none" /\ askOpen = TRUE
        /\ cardOpen = TRUE /\ ticket = FALSE /\ ended = FALSE
        /\ lineSource = "none" /\ creditedSource = "none"
Active == prompt \in {"offered", "approved"}
Approve(via) == /\ cardOpen /\ (prompt = "offered" \/ (AllowFinalApproval /\ ended))
                /\ prompt' = "approved" /\ approval' = via
                /\ askOpen' = IF via = "Send" THEN FALSE ELSE askOpen
                /\ lineSource' = IF via = "Send" THEN "prompt" ELSE lineSource
                /\ UNCHANGED <<cardOpen, ticket, ended, creditedSource>>
Send == Approve("Send")
Yolo == Approve("yolo")
HisWord == Approve("his word")
Authority == Approve("authority")
Decline == /\ prompt = "offered" /\ prompt' = "declined" /\ ended' = TRUE /\ askOpen' = FALSE
           /\ UNCHANGED <<approval, cardOpen, ticket, lineSource, creditedSource>>
SettleAsk == /\ askOpen /\ askOpen' = FALSE
             /\ prompt' = IF Active THEN "superseded" ELSE prompt
             /\ ended' = (ended \/ Active)
             /\ UNCHANGED <<approval, cardOpen, ticket, lineSource, creditedSource>>
Withdraw == SettleAsk
Replace == SettleAsk
HandledAnotherWay == SettleAsk
CloseCard == /\ cardOpen /\ ~askOpen /\ cardOpen' = FALSE
             /\ prompt' = IF Active THEN "superseded" ELSE prompt
             /\ ended' = (ended \/ Active)
             /\ UNCHANGED <<approval, askOpen, ticket, lineSource, creditedSource>>
IssueTicket == /\ prompt = "approved" /\ cardOpen /\ ~ticket /\ ticket' = TRUE
               /\ UNCHANGED <<prompt, approval, askOpen, cardOpen, ended, lineSource, creditedSource>>
ToolReceipt == /\ prompt = "approved" /\ cardOpen /\ ticket
               /\ prompt' = "relayed" /\ askOpen' = FALSE
               /\ UNCHANGED <<approval, cardOpen, ticket, ended, lineSource, creditedSource>>
CaptainOtherWord == /\ cardOpen /\ lineSource # "other" /\ lineSource' = "other"
                    /\ UNCHANGED <<prompt, approval, askOpen, cardOpen, ticket, ended, creditedSource>>
LineReceipt == /\ prompt = "approved" /\ cardOpen /\ approval = "Send"
               /\ (lineSource = "prompt" \/ AllowUnrelatedLineReceipt)
               /\ prompt' = "relayed" /\ askOpen' = FALSE
               /\ creditedSource' = lineSource
               /\ UNCHANGED <<approval, cardOpen, ticket, ended, lineSource>>
DelegatedLineReceipt == /\ prompt = "approved" /\ cardOpen
                        /\ prompt' = "relayed" /\ askOpen' = FALSE
                        /\ UNCHANGED <<approval, cardOpen, ticket, ended, lineSource, creditedSource>>
RefuseOrWait == UNCHANGED vars
Next == Send \/ Yolo \/ HisWord \/ Authority \/ Decline \/ Withdraw \/ Replace \/ HandledAnotherWay
        \/ CloseCard \/ IssueTicket \/ ToolReceipt \/ LineReceipt \/ DelegatedLineReceipt
        \/ CaptainOtherWord \/ RefuseOrWait

FinalIsFinal == ended => prompt \in {"declined", "superseded"}
RelayNeedsApproval == prompt = "relayed" => approval # "none"
ClosedCardHasNoActivePrompt == ~cardOpen => ~Active
OfferedPromptHasOpenAsk == prompt = "offered" => askOpen
LineReceiptMatchesSource == creditedSource \in {"none", "prompt"}
====
