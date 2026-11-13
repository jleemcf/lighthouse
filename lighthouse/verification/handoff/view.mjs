export const title = 'One durable holder and fenced sessions';
export const state = value => {
  const writes = JSON.stringify(value.writes);
  if (writes.includes('stale')) return 'Stale session changed the board';
  if (writes.includes('legacy')) return 'Legacy credential changed the board';
  if (value.acknowledged > value.durableEpoch) return 'Holder acknowledged only in memory';
  if (value.auditEpoch !== value.durableEpoch) return 'Ownership and audit disagree';
  if (value.shiftId !== 'shift-original') return 'Transfer reset the shift';
  if (value.nomination === 'invalid-acquired') return 'Invalid nomination acquired ownership';
  if (!value.leaseLive) return value.holder + ' lost acting rights; shift retained';
  if (value.holder === 'B') return 'B holds epoch two; A may settle its ticket';
  if (value.pending === 'A-at-1') return 'A request awaits commit';
  if (value.nomination === 'pending') return 'Captain nominated B';
  if (['cancelled', 'expired', 'superseded'].includes(value.nomination)) return 'Nomination invalidated';
  return 'A holds epoch one';
};
export const step = action =>
  ({
    Nominate: 'captain approves a successor',
    Invalidate: 'nomination expires or is cancelled or replaced',
    Acquire: 'one acceptor commits ownership and audit',
    Retry: 'same operation retries its saved result',
    Expire: 'server lease expires without ending the shift',
    Arrive: 'operator submits a request',
    Commit: 'request reaches durable commit',
    OldSessionActs: 'relieved session tries to act',
    LegacyActs: 'broad legacy credential tries to act',
    LateEvidence: 'A settles only its existing ticket',
    Done: 'nothing changes',
  })[action] || action;
