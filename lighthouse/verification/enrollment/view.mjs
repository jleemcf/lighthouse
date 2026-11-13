export const title = 'One-use enrollment survives a lost reply';
export const state = value =>
  value.unsafeReply
    ? 'Reply acknowledged a missing installation'
    : value.spent && !value.installed
      ? 'Grant spent; installation missing'
      : value.commits > 1
        ? 'Grant used more than once'
        : value.leakedReceipt
          ? 'Receipt leaked to a bare id'
          : value.expiryViolation
            ? 'Expired grant accepted'
            : value.scopeViolation
              ? 'Wrong scope installed'
              : value.phase === 'idle'
                ? value.spent
                  ? 'Installed; reply may be lost'
                  : value.expired
                    ? 'Unused grant expired'
                    : 'Grant available'
                : value.phase === 'reply delivered'
                  ? value.leakedReceipt
                    ? 'Receipt leaked to a bare id'
                    : 'Installation confirmed'
                  : value.phase === 'committed without reply'
                    ? 'Installed durably; reply pending'
                    : 'Preparing private transaction';
export const step = (action, from, to) =>
  ({
    Begin: 'an installation submits its scoped grant',
    FlushMetadata: 'private board data is flushed',
    FlushCredentials: 'private credential data is flushed',
    FlushPointer: 'the selection is flushed',
    Commit: 'the complete transaction becomes current',
    Reply: 'the host confirms the installation',
    LoseReply: 'the reply is lost',
    Crash: 'the process stops and restarts',
    Retry: to.leakedReceipt ? 'a bare operation id is retried' : 'the installation retries with its original proof',
    Expire: 'the unused grant expires',
    Done: 'nothing changes',
  })[action] || action;
