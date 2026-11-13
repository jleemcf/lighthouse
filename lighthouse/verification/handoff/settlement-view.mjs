export const title = 'Migration commits and settlement after transfer';
export const state = ({ s }) =>
  [
    s.active ? 'ledger active' : 'readiness window',
    s.inventoried ? s.disposition : 'not inventoried',
    (s.originKnown ? 'known origin' : 'legacy origin unknown') +
      '; importer ' +
      (s.importerOriginal ? 'original principal' : 'successor principal'),
    s.ownerReceiptSeen
      ? s.receiptDelivered
        ? 'late delivery evidence'
        : 'late non-delivery evidence'
      : 'no late evidence',
    'executed ' + s.executions + '; ' + (s.cache ? 'legacy cache' : 'no cache'),
    s.transferred ? (s.held ? 'transfer hold retained' : 'transfer hold released') : 'no transfer',
    s.gap ? 'import gap' : s.gapResolved ? 'owner resolved gap' : 'no gap',
    'relay ' + s.relay + '; owner ' + s.owner + '; source ' + (s.sourceMarked ? 'marked' : 'unmarked'),
  ].join(' / ');
export const step = action =>
  ({
    Inventory: 'inventory original call',
    LegacyDrain: 'commit during readiness',
    Activate: 'activate ledger',
    PruneCache: 'prune temporary legacy cache',
    Review: 'review exact queued call',
    Apply: 'apply adopted call',
    ImportGap: 'retain missing evidence',
    ResolveGap: 'owner resolves gap',
    StartRelay: 'dispatch outcome unknown',
    Transfer: 'accept degraded transfer',
    OwnerReconcile: 'owner reconciles with independent evidence',
    Receipt: 'receive scoped outcome evidence',
  })[action] || action;
