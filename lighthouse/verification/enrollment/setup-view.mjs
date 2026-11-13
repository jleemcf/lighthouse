export const title = 'A fresh installation requires trust and a checked private binding';
export const state = v =>
  v.existing && v.written
    ? 'Existing home overwritten'
    : v.enrolled && !v.trust
      ? 'Bound without host approval'
      : v.embedded
        ? 'Credential embedded in a script'
        : v.phase === 'complete' && !v.checked
          ? 'Completed without doctor'
          : v.phase;
export const step = action =>
  ({
    Initialize: 'initialize the empty home',
    Refuse: 'refuse an existing home',
    Prepare: 'prepare the private installation request',
    TrustHost: 'approve the host',
    Enroll: 'consume the approved scoped grant',
    Install: 'install tools with a credential reference',
    Doctor: 'check the installed home',
    Finish: 'report completion',
    Done: 'nothing changes',
  })[action] || action;
