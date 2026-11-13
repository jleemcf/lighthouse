export const title = 'Host policies stay outside immutable releases';
export const state = value => value.mode + ': ' + value.phase + ' / ' + value.selected;
export const step = action =>
  ({
    StageRelease: 'copy candidate code without changing host policy data',
    StartRelease: 'start using config-relative policy, or the unchanged bundled fallback',
    ManualRestart: 'restart from the staged executable with the same configuration',
    Done: 'release remains selected',
  })[action] || action;
