export const title = 'A delivered command waits for the board to accept its receipt';
export const state = values => {
  const labels = {
    idle: 'Ready',
    authorized: 'Intent saved; not sent',
    sending: values.delivered ? 'Firstmate received; result not yet saved' : 'Sending; outcome not yet known',
    'delivered-awaiting-record': values.delivered
      ? 'Delivered; receipt awaiting acceptance'
      : 'Not delivered; receipt awaiting acceptance',
    blocked: values.journal ? 'Receipt refused; evidence kept' : 'Receipt refused; evidence deleted',
    'outcome-unknown': 'Outcome unknown; reconcile without resending',
    recorded: 'Board accepted; journal records completion',
    refused: values.journal ? 'Permanent refusal; evidence kept for captain' : 'Permanent refusal; evidence deleted',
    reconciled: 'Captain reconciled; audit kept; nothing sent',
  };
  return (
    labels[values.phase] +
    (!values.sourceCurrent ? '; prompt superseded' : '') +
    (values.reportedSuccess && !values.recorded ? '; falsely reported success' : '')
  );
};
export const step = action =>
  ({
    StartShift: 'operator starts shift',
    StopShift: 'operator ends shift',
    AuthorizeExactWords: 'captain authorizes words; intent is saved',
    StartSending: 'save sending marker before invoking the route',
    FirstmateReceives: 'firstmate receives the words once',
    PersistDeliveryResult: 'save delivered result before requesting a receipt',
    PersistNonDeliveryResult: 'save a definite pre-send refusal as non-delivery',
    SendUncertain: 'route returns an uncertain outcome',
    RestartInterrupted: 'restart finds an interrupted attempt',
    BoardAcceptsReceipt: 'board accepts matching receipt, including duplicate',
    AcceptedResponseLost: 'board accepts but its response is lost',
    ReceiptRejected: 'board refuses receipt or gives no matching acknowledgement',
    ReceiptPermanentlyRejected: 'board permanently refuses; stop automatic receipt retries',
    PromptSuperseded: 'prompt ask is replaced, withdrawn, settled or its card closes',
    BoardUnavailable: 'receipt request times out or returns 5xx',
    RetainReconciliation: 'retain the audit or reconciliation item',
    CaptainReconciles: 'captain confirms evidence; close locally without sending or posting',
  })[action] || action;
