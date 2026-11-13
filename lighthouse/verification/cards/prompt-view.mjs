export const title = 'No ends a prompt. Only approval can become delivery';
export const state = values => {
  if (values.creditedSource === 'other') return 'Wrong instruction credited as delivered';
  if (values.ended) return values.prompt + (values.cardOpen ? '' : '; card closed');
  if (values.prompt === 'approved') {
    if (values.lineSource === 'other') return 'Approved; newer captain words are separate';
    return values.ticket ? 'Approved; delivery ticket issued' : 'Approved; not sent';
  }
  if (values.prompt === 'relayed') return 'Delivery recorded';
  return 'Offered; waiting for a choice';
};
export const step = action =>
  ({
    Send: 'captain clicks Send',
    Yolo: 'approve under yolo',
    HisWord: 'approve on his word',
    Authority: 'approve under standing authority',
    Approve: 'an approval is attempted',
    Decline: 'captain chooses No',
    Withdraw: 'operator withdraws the ask',
    Replace: 'operator replaces the ask',
    HandledAnotherWay: 'ask is handled another way',
    SettleAsk: 'ask is replaced, withdrawn or settled',
    CloseCard: 'card closes',
    IssueTicket: 'board authorizes the exact words',
    ToolReceipt: 'tool reports delivery against its ticket',
    LineReceipt: 'ordinary line credits its captain source',
    CaptainOtherWord: 'captain writes a separate instruction',
    DelegatedLineReceipt: 'operator reports delegated prompt delivery',
    RefuseOrWait: 'stale choice refused or delivery waits',
  })[action] || action;
