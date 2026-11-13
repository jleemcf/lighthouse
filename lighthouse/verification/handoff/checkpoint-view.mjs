export const title = 'Continuous shift through checkpoint and pickup';
export const state = value => {
  const record = value.s;
  if (record.shiftId !== 'original') return 'Transfer reset the shift';
  if (record.epoch > 2) return 'Lost answer applied transfer twice';
  if (record.acceptOps.length && record.holder !== 'B') return 'Cancel rolled back accepted ownership';
  if (record.blindAccept) return 'Successor accepted without reading';
  if (record.usedLost) return 'Planned transfer bypassed loss approval';
  if (record.held && !record.unknown) return 'Missing context invented a dispatch hold';
  if (record.held && record.continued) return 'Compaction invented a dispatch hold';
  if (record.held && record.phase === 'cancelled') return 'Cancel retained new dispatch holds';
  if (record.stalePickup) return 'Pickup missed a newer ask';
  if (record.blockedWork) return 'Work began while draining or picking up';
  if (record.unknown && record.phase === 'sealed' && !record.degraded) return 'Unknown effects called clean';
  if (record.phase === 'working') return 'Original holder working';
  if (record.phase === 'draining') return record.saved ? 'Checkpoint saved; draining' : 'Original holder draining';
  if (record.phase === 'sealed') return record.degraded ? 'Degraded seal; targets held' : 'Clean checkpoint sealed';
  if (record.phase === 'pickup')
    return !record.continued && !record.successorLive
      ? 'Successor lost; captain recovery required'
      : record.continued
        ? 'Same session resuming pickup'
        : 'Successor at pickup barrier';
  if (record.phase === 'cancelled') return 'Original holder resumed; same epoch';
  return 'Pickup complete; same shift';
};
export const step = action =>
  ({
    Prepare: 'prepare successor',
    Checkpoint: 'save checkpoint',
    Continue: 'compact or reconnect without changing holder',
    UnknownWork: 'unknown work remains',
    ResolveEffects: 'same holder reconciles pending effects',
    Seal: 'seal explicitly',
    Read: 'read checkpoint and all live changes',
    LateAsk: 'new ask arrives',
    Accept: 'accept once with compare-and-swap',
    Pickup: 'acknowledge current revision',
    Cancel: 'cancel before commit',
    Work: 'begin ordinary work',
    Expire: 'holder loses its lease',
    Crash: 'session crashes; durable records remain',
    Retry: 'retry the same operation',
    ExpireSuccessor: 'successor loses its lease; no automatic recovery',
  })[action];
