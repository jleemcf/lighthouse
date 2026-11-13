export const title = 'Manual maintenance preserves the safety copy and the command result';
export const state = value => {
  if (!value.targetValid && !value.running) return 'BUG: invalid target stopped the board';
  if (value.command === 'clear-cards' && value.cleared && !value.copied) return 'BUG: cards cleared without backup';
  if (value.phase === 'reported' && value.result !== 0 && value.exitCode !== value.result)
    return 'BUG: restart hid maintenance failure';
  if (value.phase === 'reported') return value.exitCode === 0 ? 'Maintenance succeeded' : 'Failure reported';
  if (value.phase === 'restarting') return value.result === 0 ? 'Archive finished; restart' : 'Failure kept; restart';
  return {
    serving: 'Board serving',
    'target selected': 'Target selected',
    'copying configured store': 'Copy configured store',
    archiving: 'Archive cards',
  }[value.phase];
};
const labels = {
  ValidateTarget: 'select explicit or validated default board before stopping',
  RefuseTarget: 'refuse the target without stopping the board',
  Stop: 'stop and flush the board',
  Copy: 'copy succeeds or fails',
  Archive: 'archive succeeds or fails',
  Restart: 'restart without replacing the maintenance result',
  Done: 'retain the reported result',
};
export const step = action => labels[action] || action;
