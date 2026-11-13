export const title = 'Kit update: stop before reporting an incomplete release as installed';
export const state = value =>
  value.layout +
  ' layout: ' +
  value.phase +
  (value.filledValue !== 'retained' ? ' (BUG: filled setting replaced)' : '') +
  (value.success ? ' (Windows ' + value.windows + ', WSL ' + value.twin + ')' : '');
export const step = action =>
  ({
    Refresh: 'refresh repository and resolve paths',
    ResolveProfile: 'resolve selected profile and installed settings',
    ValidateScripts: 'render literal values and validate all generated languages before home writes',
    RejectScripts: 'reject invalid generated syntax without touching the home',
    SkipValidation: 'broken installer skips validation and permits home writes',
    InstallNewKit: 'installer writes scripts and target manifest',
    InstallerFails: 'installer fails',
    ActivateAndVerify: 'activate pending scripts and verify Windows manifest',
    CopyTwin: 'copy, chmod and verify WSL scripts',
    TwinCopyFails: 'WSL copy or verification fails',
    PhaseFails: 'command boundary fails; report partial state',
    FinishUpdate: 'helpers activated; report success',
    Done: 'command exits',
  })[action] || action;
