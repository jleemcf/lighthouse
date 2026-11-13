export const title = 'Cards close safely and only task completion triggers afterDone';
const phases = {
  'not posted': 'Not posted',
  posted: 'Captain posted work',
  working: 'Task in progress',
  'step finished': 'Step complete, task unfinished',
  asking: 'Waiting for captain',
  'answer written': 'Captain answered, awaiting receipt',
  settled: 'Ask settled',
  held: 'Waiting on someone else',
  reopened: 'Completed task reopened',
  'tool closed': 'Task closed',
  'legacy closed': 'Task closed',
  'line closed': 'Task closed',
  'crm closed': 'Task closed',
};
export const state = value => {
  if (value.staff !== 'none') return 'Staff answer ' + value.staff + '; card ' + value.card;
  if (value.alarm && value.card !== 'done') return 'New ask after task completion';
  if (value.phase === 'asking' && value.hint) return 'Waiting with an uncertain step-only hint';
  return phases[value.phase];
};
const steps = {
  CaptainPosts: 'captain posts work',
  OperatorOpens: 'operator opens a card',
  ReportsIntermediateStep: 'operator reports preflight complete',
  AsksCaptain: 'operator asks for remaining work',
  CaptainAnswers: 'captain answers',
  OperatorSettlesAnswer: 'operator records the answer',
  CaptainSettles: 'captain settles the ask',
  Withdraw: 'operator withdraws the ask',
  Hold: 'operator holds the card',
  GuardedClose: 'close with no open ask',
  LegacyWriterCloses: 'close with no open ask',
  LineCloses: 'TASK_FINISHED settles asks and closes',
  CrmQuestion: 'staff asks a question',
  CrmWorks: 'operator investigates',
  CrmSends: 'operator replies or retries',
  CrmRefuses: 'CRM refuses the answer',
  CrmAccepts: 'CRM accepts the answer',
  CrmCloses: 'close after delivery with no open ask',
  LegacyReopens: 'legacy writer reopens the card',
  Done: 'remain closed',
};
export const step = action => steps[action] || action;
