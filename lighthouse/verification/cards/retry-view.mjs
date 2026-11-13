export const title = 'Retry checks its basis. Repeating does not decide again';
export const state = values => {
  if (values.staleTicket) return 'Ticket issued without current authority';
  if (values.repeatChanged) return 'Repeat changed the original approval';
  if (values.ticket === 'first' && values.approval !== values.basis) return 'Ticket records an outdated approval';
  if (values.approval !== 'Send' && !values.followOpen) return 'Operator settled the captain follow-through ask';
  if (values.ticket === 'repeat') return 'Repeat ticket issued';
  if (values.ticket === 'first') return 'First ticket issued';
  if (values.prompt === 'relayed')
    return values.basisCurrent ? 'Received. Repeat checks its basis' : 'Received. Basis ended';
  return values.basisCurrent ? 'Approved. Ticket checks its basis' : 'Approved. Basis ended';
};
export const step = action =>
  ({
    EndBasis: 'authority ends or his word expires or is overtaken',
    FreshBasis: 'captain gives fresh words or a new authority covers the retry',
    NewAsk: 'captain has a new unanswered ask',
    IssueTicket: 'issue a ticket with Send or a checked current basis',
    Failed: 'delivery fails without a receipt',
    Receipt: 'record delivery without deciding another ask',
    RefuseOrWait: 'refuse a stale basis or wait',
  })[action] || action;
