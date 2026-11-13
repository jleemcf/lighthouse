export const title = 'Board administration refuses unauthorized changes and clears invitations';
export const state = value =>
  value.changed && value.actor !== 'admin'
    ? 'A non-administrator changed membership'
    : value.changed && !value.csrf
      ? 'An unprotected form changed membership'
      : value.changed && !value.audited
        ? 'Membership changed without an audit'
        : value.phase !== 'private invitation' && value.secretVisible
          ? 'The invitation stayed after copying or leaving'
          : value.replayVisible
            ? 'A later read exposed the invitation'
            : value.phase === 'ready'
              ? 'An administration request is ready'
              : value.phase === 'private invitation'
                ? 'An authorized invitation is visible once'
                : value.changed
                  ? 'The authorized membership change is audited'
                  : 'No secret remains on the page';
export const step = action =>
  ({
    SaveMembership: 'submit membership [administrator, protected form and schema 2 required]',
    IssueGrant: 'issue an invitation [owner or administrator, protected form required]',
    ReadContext: 'read management again',
    CopyOrLeave: 'copy once or leave the page',
    Done: 'nothing changes',
  })[action] || action;
