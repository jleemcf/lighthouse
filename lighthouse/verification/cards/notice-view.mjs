export const title = 'A coordinator notice wakes the operator without becoming the owner';
export const state = v =>
  v.authoritySource === 'coordinator'
    ? 'Notice mistaken for owner approval'
    : v.notice === 'absent'
      ? 'No notice'
      : v.notice === 'handled'
        ? 'Answered on the inbox card'
        : v.announced
          ? v.wakes === 0
            ? 'Notice silenced'
            : v.wakes > 1
              ? 'Notice repeated'
              : 'Operator woken once'
          : 'Notice waits in inbox';
export const step = action =>
  ({
    PostNotice: 'Coordinator posts a notice',
    PollInbox: 'Inbox read succeeds and passes the wake gate',
    ReplyOnInboxCard: 'Operator replies on the inbox card',
    OwnerWords: 'Owner supplies approval independently',
    ReadFailsOrRetry: 'Read fails or a retry changes nothing',
  })[action] || action;
