export const title = 'One board dispatch permission across homes';
export const state = v =>
  [
    `${v.holder} holds ${v.phase}; ${v.intent}; ${v.spent ? 'spent' : 'unspent'}; authorized ${v.authorizedHome}`,
    `journal A ${v.journal.A}, B ${v.journal.B}; answer ${v.reply}; grants ${v.grants.join(',') || 'none'}`,
    `running ${v.running.join(',') || 'none'}; delivered ${v.delivered.join(',') || 'none'}`,
    `live ${v.live.join(',')}; crashed ${v.crashed.join(',') || 'none'}; ${v.expired ? 'expired' : 'live lease'}`,
    `${v.reissued ? 'BUG grant reissued' : 'single permission'}; ${v.aliasIssued ? 'BUG duplicate id' : 'one intent'}`,
    v.conflictIssued ? (v.settled ? 'next instruction issued' : 'BUG conflicting target issued') : 'next work pending',
    `${v.receiptDenied ? 'BUG receipt refused' : v.settled ? 'receipt settled' : 'receipt pending'}`,
    `${v.gapVisible ? 'import gap held' : v.gapResolved ? 'gap resolved by owner' : v.gapSeen ? 'BUG gap hidden' : 'no gap'}; ${v.queue}`,
  ].join(' / ');
export const step = action =>
  ({
    Issue: 'authorize exact instruction',
    WriteBeforeConsume: 'save local request before consume',
    Consume: 'durably consume permission once',
    ReceiveGrant: 'save first positive grant locally',
    LostAnswer: 'lose consume answer',
    Invoke: 'invoke external route',
    ExternalDelivery: 'old route completes',
    Unknown: 'retain unknown outcome',
    Prepare: 'drain outgoing session',
    Transfer: 'transfer without shift reset',
    Crash: 'lose caller process',
    Restart: 'read journal without replay',
    RetryConsumed: 'BUG: issue grant again',
    Receipt: 'settle scoped receipt',
    Expire: 'lease or ordinary ticket expires',
    AliasIssue: 'BUG: new id bypasses intent',
    ImportGap: 'import incomplete evidence',
    EmptyImport: 'BUG: empty home clears missing evidence',
    ReviewQueue: 'review and adopt original call',
    ApplyQueue: 'commit deduplicated call',
    Adopt: 'explicitly adopt an undispatched intent',
    ConflictDispatch: 'issue next instruction after settlement (or BUG target bypass)',
    Reconcile: 'owner records independent evidence and quiescence',
    ResolveGap: 'owner resolves missing evidence',
  })[action] || action;
