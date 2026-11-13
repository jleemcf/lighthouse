export const title = 'Fetched updater and persistent reconnect state';
export const state = value =>
  value.phase +
  (value.windows === 'new'
    ? value.notice
      ? ' / reconnect required'
      : value.newReported
        ? ' / current tools reported'
        : ' / notice absent'
    : '');
export const step = action =>
  ({
    StageFetched: 'snapshot fetched kit and render its updater',
    RecordTarget: 'persist changed-tools target before replacing files',
    Install: 'replace Windows scripts; connected session keeps old tools',
    Activate: 'activate pending files and verify Windows',
    CopyAndVerify: 'copy and verify twin; report success',
    Interrupt: 'phase interrupted; never report success',
    DisconnectOld: 'old connected session exits',
    ReportNew: 'new tool server reports its captured loaded version',
    ReportAgain: 'current tool server reports after last old session exits',
    ForgetOnRerun: 'broken rerun forgets the reconnect target',
    Done: 'update command exits',
  })[action] || action;
