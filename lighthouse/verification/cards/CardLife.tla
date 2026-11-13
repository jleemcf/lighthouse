---- MODULE CardLife ----
EXTENDS TLC
VARIABLES staff, phase, card, completionEvent, openAsk, alarm, taskFinished, proseMarker, hint
vars == <<staff, phase, card, completionEvent, openAsk, alarm, taskFinished, proseMarker, hint>>

Init == /\ staff = "none" /\ phase = "not posted" /\ card = "none" /\ completionEvent = FALSE
        /\ openAsk = FALSE /\ alarm = FALSE /\ taskFinished = FALSE /\ proseMarker = FALSE /\ hint = FALSE
CaptainPosts == /\ phase = "not posted" /\ phase' = "posted"
                /\ UNCHANGED <<staff, card, completionEvent, openAsk, alarm, taskFinished, proseMarker, hint>>
OperatorOpens == /\ phase = "posted" /\ phase' = "working" /\ card' = "inflight"
                 /\ UNCHANGED <<staff, completionEvent, openAsk, alarm, taskFinished, proseMarker, hint>>
ReportsIntermediateStep == /\ phase = "working" /\ phase' = "step finished" /\ proseMarker' = TRUE
                           /\ UNCHANGED <<staff, card, completionEvent, openAsk, alarm, taskFinished, hint>>
AsksCaptain == /\ phase \in {"working", "step finished", "held", "reopened"} /\ phase' = "asking"
               /\ card' = "waiting" /\ openAsk' = TRUE /\ alarm' = completionEvent
               /\ hint' = (proseMarker /\ ~completionEvent)
               /\ UNCHANGED <<staff, completionEvent, taskFinished, proseMarker>>
CaptainAnswers == /\ phase = "asking" /\ phase' = "answer written"
                  /\ UNCHANGED <<staff, card, completionEvent, openAsk, alarm, taskFinished, proseMarker, hint>>
OperatorSettlesAnswer == /\ phase = "answer written" /\ phase' = "settled"
                        /\ card' = "inflight" /\ openAsk' = FALSE
                        /\ UNCHANGED <<staff, completionEvent, alarm, taskFinished, proseMarker, hint>>
CaptainSettles == /\ phase = "asking" /\ phase' = "settled"
                  /\ card' = "inflight" /\ openAsk' = FALSE
                  /\ UNCHANGED <<staff, completionEvent, alarm, taskFinished, proseMarker, hint>>
Withdraw == /\ openAsk /\ phase' = "settled" /\ card' = "inflight" /\ openAsk' = FALSE
            /\ UNCHANGED <<staff, completionEvent, alarm, taskFinished, proseMarker, hint>>
Hold == /\ phase \in {"working", "step finished"} /\ phase' = "held" /\ card' = "held"
        /\ UNCHANGED <<staff, completionEvent, openAsk, alarm, taskFinished, proseMarker, hint>>
CanClose == ~openAsk /\ staff \in {"none", "done"}
Close(nextPhase) == /\ phase \in {"working", "step finished", "asking", "settled", "held", "reopened"}
                    /\ CanClose /\ phase' = nextPhase /\ card' = "done" /\ taskFinished' = TRUE
                    /\ completionEvent' = TRUE /\ UNCHANGED <<staff, openAsk, alarm, proseMarker, hint>>
GuardedClose == Close("tool closed")
LegacyWriterCloses == Close("legacy closed")
LineCloses == /\ phase \in {"working", "step finished", "asking", "answer written", "settled", "held", "reopened"}
              /\ staff \in {"none", "done"}
              /\ phase' = "line closed" /\ card' = "done" /\ taskFinished' = TRUE /\ openAsk' = FALSE
              /\ completionEvent' = TRUE /\ UNCHANGED <<staff, alarm, proseMarker, hint>>
CrmQuestion == /\ phase = "not posted" /\ staff = "none"
               /\ phase' = "working" /\ card' = "inflight" /\ staff' = "asked"
               /\ UNCHANGED <<completionEvent, openAsk, alarm, taskFinished, proseMarker, hint>>
CrmWorks == /\ staff = "asked" /\ staff' = "working"
            /\ UNCHANGED <<phase, card, completionEvent, openAsk, alarm, taskFinished, proseMarker, hint>>
ReopenedCard == IF card = "done" THEN "inflight" ELSE card
CrmSends == /\ staff \in {"asked", "working", "failed", "done"} /\ staff' = "sending"
            /\ card' = ReopenedCard
            /\ phase' = IF card = "done" THEN "working" ELSE phase
            /\ UNCHANGED <<completionEvent, openAsk, alarm, taskFinished, proseMarker, hint>>
CrmRefuses == /\ staff = "sending" /\ staff' = "failed" /\ card' = ReopenedCard
              /\ UNCHANGED <<phase, completionEvent, openAsk, alarm, taskFinished, proseMarker, hint>>
CrmAccepts == /\ staff = "sending" /\ staff' = "done"
              /\ UNCHANGED <<phase, card, completionEvent, openAsk, alarm, taskFinished, proseMarker, hint>>
CrmCloses == /\ staff = "done" /\ Close("crm closed")
LegacyReopens == /\ card = "done" /\ phase' = "reopened" /\ card' = ReopenedCard
                 /\ UNCHANGED <<staff, completionEvent, openAsk, alarm, taskFinished, proseMarker, hint>>
Done == /\ card = "done" /\ UNCHANGED vars
Next == CaptainPosts \/ OperatorOpens \/ ReportsIntermediateStep \/ AsksCaptain
        \/ CaptainAnswers \/ OperatorSettlesAnswer \/ CaptainSettles \/ Withdraw \/ Hold
        \/ GuardedClose \/ LegacyWriterCloses \/ LineCloses \/ CrmQuestion \/ CrmWorks \/ CrmSends \/ CrmRefuses \/ CrmAccepts \/ CrmCloses \/ LegacyReopens \/ Done
ClosedCardsHaveNoOpenAsks == card # "done" \/ ~openAsk
ClosedStaffCardsHaveDelivery == card # "done" \/ staff \in {"none", "done"}
OnlyTaskCompletionTriggersAfterDone == alarm => taskFinished
====
