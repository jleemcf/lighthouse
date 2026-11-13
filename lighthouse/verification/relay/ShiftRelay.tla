---- MODULE ShiftRelay ----
EXTENDS Naturals, TLC
\* Scope: the only external receiver is firstmate. Fleet-steward destinations are refused before a ticket/send.
\* The separate advice steward never enters this delivery protocol; journal and receipt invariants are unchanged.
CONSTANTS LoseRejected, FalseSuccess
VARIABLES sourceCurrent, shift, phase, delivered, recorded, journal, resultKnown, reportedSuccess, sendCount
vars == <<sourceCurrent, shift, phase, delivered, recorded, journal, resultKnown, reportedSuccess, sendCount>>

Init == /\ sourceCurrent = TRUE
        /\ shift = "off"
        /\ phase = "idle"
        /\ delivered = FALSE /\ recorded = FALSE /\ journal = FALSE
        /\ resultKnown = FALSE /\ reportedSuccess = FALSE /\ sendCount = 0

StartShift == /\ shift = "off" /\ shift' = "on"
              /\ UNCHANGED <<sourceCurrent, phase, delivered, recorded, journal, resultKnown, reportedSuccess, sendCount>>
StopShift == /\ shift = "on" /\ shift' = "off"
             /\ UNCHANGED <<sourceCurrent, phase, delivered, recorded, journal, resultKnown, reportedSuccess, sendCount>>
AuthorizeExactWords == /\ shift = "on" /\ phase = "idle"
                       /\ phase' = "authorized" /\ journal' = TRUE
                       /\ UNCHANGED <<sourceCurrent, shift, delivered, recorded, resultKnown, reportedSuccess, sendCount>>
StartSending == /\ phase = "authorized" /\ journal
                /\ phase' = "sending"
                /\ UNCHANGED <<sourceCurrent, shift, delivered, recorded, journal, resultKnown, reportedSuccess, sendCount>>
FirstmateReceives == /\ phase = "sending" /\ ~delivered /\ sendCount = 0
                    /\ delivered' = TRUE /\ sendCount' = sendCount + 1
                    /\ UNCHANGED <<sourceCurrent, shift, phase, recorded, journal, resultKnown, reportedSuccess>>
PersistDeliveryResult == /\ phase = "sending" /\ delivered
                         /\ phase' = "delivered-awaiting-record" /\ resultKnown' = TRUE
                         /\ UNCHANGED <<sourceCurrent, shift, delivered, recorded, journal, reportedSuccess, sendCount>>
PersistNonDeliveryResult == /\ phase = "sending" /\ ~delivered
                            /\ phase' = "delivered-awaiting-record" /\ resultKnown' = TRUE
                            /\ UNCHANGED <<sourceCurrent, shift, delivered, recorded, journal, reportedSuccess, sendCount>>
SendUncertain == /\ phase = "sending"
                 /\ phase' = "outcome-unknown"
                 /\ UNCHANGED <<sourceCurrent, shift, delivered, recorded, journal, resultKnown, reportedSuccess, sendCount>>
RestartInterrupted == /\ phase \in {"authorized", "sending"}
                      /\ phase' = "outcome-unknown"
                      /\ UNCHANGED <<sourceCurrent, shift, delivered, recorded, journal, resultKnown, reportedSuccess, sendCount>>

ReceiptPending == phase \in {"delivered-awaiting-record", "blocked"} /\ resultKnown
BoardAcceptsReceipt == /\ ReceiptPending /\ sourceCurrent
                       /\ phase' = "recorded" /\ recorded' = TRUE /\ reportedSuccess' = delivered
                       /\ UNCHANGED <<sourceCurrent, shift, delivered, journal, resultKnown, sendCount>>
AcceptedResponseLost == /\ ReceiptPending /\ sourceCurrent /\ ~recorded
                        /\ recorded' = TRUE
                        /\ UNCHANGED <<sourceCurrent, shift, phase, delivered, journal, resultKnown, reportedSuccess, sendCount>>
ReceiptRejected == /\ ReceiptPending
                   /\ phase' = "blocked"
                   /\ journal' = IF LoseRejected THEN FALSE ELSE journal
                   /\ reportedSuccess' = IF FalseSuccess /\ delivered THEN TRUE ELSE reportedSuccess
                   /\ UNCHANGED <<sourceCurrent, shift, delivered, recorded, resultKnown, sendCount>>
ReceiptPermanentlyRejected == /\ ReceiptPending
                              /\ phase' = "refused"
                              /\ journal' = IF LoseRejected THEN FALSE ELSE journal
                              /\ reportedSuccess' = IF FalseSuccess /\ delivered THEN TRUE ELSE reportedSuccess
                              /\ UNCHANGED <<sourceCurrent, shift, delivered, recorded, resultKnown, sendCount>>
BoardUnavailable == /\ ReceiptPending
                    /\ phase' = "delivered-awaiting-record"
                    /\ UNCHANGED <<sourceCurrent, shift, delivered, recorded, journal, resultKnown, reportedSuccess, sendCount>>
CaptainReconciles == /\ phase \in {"outcome-unknown", "blocked", "refused"}
                     /\ phase' = "reconciled"
                     /\ UNCHANGED <<sourceCurrent, shift, delivered, recorded, journal, resultKnown, reportedSuccess, sendCount>>
RetainReconciliation == /\ phase \in {"recorded", "outcome-unknown", "blocked", "refused", "reconciled"}
                        /\ UNCHANGED vars

PromptSuperseded == /\ sourceCurrent /\ ~recorded
                    /\ phase \in {"authorized", "sending", "delivered-awaiting-record", "blocked"}
                    /\ sourceCurrent' = FALSE
                    /\ UNCHANGED <<shift, phase, delivered, recorded, journal, resultKnown, reportedSuccess, sendCount>>

Next == PromptSuperseded \/ StartShift \/ StopShift \/ AuthorizeExactWords \/ StartSending \/ FirstmateReceives
        \/ PersistDeliveryResult \/ PersistNonDeliveryResult \/ SendUncertain \/ RestartInterrupted
        \/ BoardAcceptsReceipt \/ AcceptedResponseLost \/ ReceiptRejected \/ ReceiptPermanentlyRejected
        \/ BoardUnavailable \/ CaptainReconciles \/ RetainReconciliation

DeliveredResultNotSilentlyLost == ~delivered \/ recorded \/ journal
SuccessRequiresBoardReceipt == ~reportedSuccess \/ recorded
NoAutomaticResend == sendCount <= 1
SupersededSourceNotRecorded == ~sourceCurrent => ~recorded
UnknownStaysVisible == phase = "outcome-unknown" => journal
====
