export const title = 'Inbox doorbell: keep the latest committed wake until acknowledgment';
export function state(variables) {
  if (variables.sent > variables.revision) return 'Wake invented an uncommitted revision';
  if (!variables.running) return 'Board stopped; unanswered revision saved';
  if (!variables.revision) return 'Inbox quiet';
  if (variables.sent && variables.revision > variables.sent) return 'Wake in flight; newer update saved';
  if (variables.sent) return 'Sending the latest saved revision';
  if (variables.acknowledged === variables.revision) return 'Receiver acknowledged the latest revision';
  return variables.queued ? 'Latest saved revision awaits delivery or retry' : 'Unanswered wake stranded without retry';
}
const labels = {
  CaptainWrites: 'a card log or conversation update commits',
  SendLatest: 'the initial, trailing or retry timer sends',
  Http2xx: 'HTTP 2xx acknowledges the revision sent',
  ReceiverFailsOrTimesOut: 'receiver refuses, disconnects or times out',
  ResponseLost: 'receiver accepts but its response is lost',
  Crash: 'the board stops before acknowledgment',
  Startup: 'startup reconciles the persisted latest revision',
  Idle: 'the board waits',
};
export const step = action => labels[action] || action;
