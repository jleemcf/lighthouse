export const title = 'Board releases: validate, drain, switch, recover';
const labels = {
  'serving old': 'Previous release serving',
  staged: 'Candidate prepared away from active code',
  validated: 'Code, assets, config and schema checked',
  'backed up': 'Previous code retained',
  quiet: 'Store quiet; ready to drain',
  stopped: 'Previous process exited',
  snapshotted: 'Final store saved beside retained code',
  switched: 'Current release switched with no process running',
  checking: 'Candidate running; checking health',
  'serving new': 'Candidate accepted',
  'stopping candidate': 'Failed candidate must exit before restoration',
  restoring: 'No process running; restoring previous pointer',
  restored: 'Previous code selected; ready for manual manager',
  'deployment failed': 'Deployment refused or previous release restored',
  'needs recovery': 'Stop timed out; journal retained for manual recovery',
};
export const state = value => {
  if (value.running !== 'none' && value.running !== value.disk) return 'BUG: running process and active disk differ';
  if (value.phase === 'deployment failed' && value.disk !== 'old')
    return 'BUG: failed validation left unsafe restart target';
  return labels[value.phase];
};
const steps = {
  Stage: 'prepare candidate',
  Reject: 'reject invalid code or unsupported store schema',
  Validate: 'accept candidate checks',
  Backup: 'retain previous code without overwriting it',
  Quiet: 'wait until store is quiet',
  FailBeforeStop: 'fault or quiet/stop timeout; leave previous process alone',
  Stop: 'stop and flush previous process',
  Snapshot: 'save final store safety copy',
  Switch: 'atomically rename current release link',
  Start: 'start pinned candidate path',
  HealthPass: 'accept running process, HTTP 200, cards and clean log',
  FailAfterStop: 'fault or failed startup; enter restoration',
  HealthFail: 'reject health check',
  StopCandidate: 'confirm candidate process exited',
  RecoveryStopTimeout: 'refuse switch while candidate still runs',
  Restore: 'restore retained previous release',
  RestartOld: 'start previous release; report deployment failure',
  Done: 'remain in final state',
};
export const step = action => steps[action] || action;
