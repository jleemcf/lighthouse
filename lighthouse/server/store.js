'use strict';
// The board's store: one JSON file beside the config, with the paths and limits it is kept by; saving, the change
// feed, ids and times; the record helpers every part uses; and the import and archive commands.
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto');
const prompts = require('./prompt-transitions');

module.exports = function makeStore(ctx) {
  const { cfg, CONFIG_PATH } = ctx;
  const compatibility = ctx.compatibility || require('./compatibility').codec(cfg);
  const STORE = path.resolve(path.dirname(CONFIG_PATH), cfg.storeFile || 'store.json');
  const PUBLIC = path.join(__dirname, 'public');
  // the files attached to conversations, beside the store
  const ATTACH = path.resolve(path.dirname(CONFIG_PATH), cfg.attachmentsDir || 'attachments');
  // the file types an attachment may have: images, and the files an answer may carry
  const IMAGE_EXT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'text/csv': 'csv',
    'text/plain': 'txt',
    'application/pdf': 'pdf',
  };
  // one-time claim codes written by `board.sh claim <name>`: {name, exp}; each file is spent on first use
  const CLAIMS = path.resolve(path.dirname(CONFIG_PATH), 'claims');
  const CHANGES_KEEP = 5000,
    LOG_KEEP = 40,
    ACTIVITY_KEEP = 40,
    OPS_KEEP = 200,
    TRANSCRIPT_KEEP = 400;

  // ---------- store ----------
  let store = { seq: 0, boards: {}, cards: {}, comments: {}, changes: [] };
  if (fs.existsSync(STORE))
    store = Object.assign(store, compatibility.read(JSON.parse(fs.readFileSync(STORE, 'utf8'))));
  prompts.load(store);
  store.attachments = store.attachments || {};
  store.cardRevisions = store.cardRevisions || {};
  // the owner's phones and computers, each with its own board switches
  store.push = store.push || { subs: {} };
  // the CRM question lane: the fetch cursor, the questions handed over, the acks and replies not yet accepted
  store.crm = store.crm || { cursor: '', delivered: {}, outbox: [] };
  for (const card of Object.values(store.cards)) require('./crm-state').questionState(card, store);
  // the lines already applied, by the collector's entry id and the line itself, so a replayed line never re-opens an
  // answered ask
  store.rowKeys = store.rowKeys || [];
  const ROW_SEEN = new Set(store.rowKeys);
  const ROWKEYS_KEEP = 40000;
  const rowKey = (board, r) =>
    r && r.uuid
      ? crypto
          .createHash('sha1')
          .update(
            [board, r.uuid, String(r.label || '').toUpperCase(), r.task || '', String(r.text || '').slice(0, 400)].join(
              '|',
            ),
          )
          .digest('hex')
          .slice(0, 16)
      : null;
  for (const id of Object.keys(cfg.boards || {})) {
    if (!store.boards[id])
      store.boards[id] = {
        id,
        name: cfg.boards[id].name || id,
        machine: cfg.boards[id].machine || '',
        project: cfg.boards[id].project || '',
        shift: { state: 'off', operator: null, since: null, lastSeen: null },
        activity: [],
      };
  }
  let saveTimer = null;
  let transaction = null;
  let commitGuards = null;
  const disk = require('./durable-store').durableStore(STORE, ctx.storeFault);
  function afterCommit(effect) {
    if (transaction) transaction.push(effect);
    else effect();
  }
  function beforeCommit(guard) {
    if (!commitGuards) throw new Error('commit guard requires a store transaction');
    commitGuards.push(guard);
  }
  function transact(authorize, mutate) {
    if (transaction) throw new Error('nested store transaction');
    if (!disk.healthy()) throw new Error('store unavailable; restart required');
    authorize();
    const pendingSave = saveTimer !== null;
    clearTimeout(saveTimer);
    saveTimer = null;
    const snapshot = structuredClone(store);
    transaction = [];
    commitGuards = [];
    let effects;
    let result;
    try {
      result = mutate();
      if (result && typeof result.then === 'function') throw new Error('store transaction must be synchronous');
      authorize();
      for (const guard of commitGuards) guard();
      disk.write(compatibility.write(store));
      clearTimeout(saveTimer);
      effects = transaction;
    } catch (error) {
      require('./durable-store').restore(store, snapshot);
      ROW_SEEN.clear();
      for (const key of store.rowKeys) ROW_SEEN.add(key);
      ctx.TC?.reindex();
      if (pendingSave && disk.healthy()) saveTimer = setTimeout(saveNow, 150);
      throw error;
    } finally {
      transaction = null;
      commitGuards = null;
    }
    for (const effect of effects) effect();
    return result;
  }
  // a tool call is answered only after its change is on disk (TOOLCALL-DESIGN §8)
  function saveNow() {
    if (transaction) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    disk.write(compatibility.write(store));
  }
  function save() {
    if (transaction) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 150);
  }
  // a send whose answer was lost on the way back may have arrived: the page sends the same sendId when it tries the
  // same words again, and the board answers with what it already made instead of making it twice. Kept an hour, in
  // the store, so a restart in between does not forget it
  const sentKey = (who, b) =>
    who && b && typeof b.sendId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.sendId)
      ? who.name + '|' + b.sendId
      : null;
  function sentBefore(who, b) {
    const k = sentKey(who, b),
      e = k && (store.sentIds || {})[k];
    if (!e || Date.now() - Date.parse(e.at) > 3600000) return null;
    const body =
      e.kind === 'bundle'
        ? (() => {
            const parts = Object.values(store.comments).filter(c => c.bundleId === e.id);
            return parts.length ? { bundleId: e.id, parts } : null;
          })()
        : e.kind === 'global'
          ? (() => {
              const copies = Object.values(store.comments).filter(c => c.global === e.id);
              return copies.length ? { global: e.id, copies } : null;
            })()
          : store.comments[e.id] || null;
    if (body) console.log(`a repeated send was caught: ${who.name}, ${e.kind} ${e.id}`);
    return body ? { status: 200, body } : null;
  }
  function remember(who, b, kind, id, body) {
    const k = sentKey(who, b);
    if (!k) return body;
    store.sentIds = store.sentIds || {};
    store.sentIds[k] = { at: new Date().toISOString(), kind, id };
    for (const [key, e] of Object.entries(store.sentIds))
      if (Date.now() - Date.parse(e.at) > 3600000) delete store.sentIds[key];
    return body;
  }
  const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const newId = () => crypto.randomBytes(8).toString('hex');
  const sseClients = new Set();
  function wakeCard(card) {
    if (!card) return;
    const revision = (store.cardRevisions[card.id] || 0) + 1;
    store.cardRevisions[card.id] = revision;
    afterCommit(() => ctx.ringCard?.(card, revision));
  }
  function change(kind, id, by, board) {
    store.seq += 1;
    const rec = { seq: store.seq, t: now(), kind, id, by, board: board || null };
    store.changes.push(rec);
    ctx.handoff?.recordChange(rec);
    if (kind === 'comment') wakeCard(store.cards[store.comments[id]?.cardId]);
    if (kind === 'bundle')
      for (const comment of Object.values(store.comments))
        if (comment.bundleId === id) wakeCard(store.cards[comment.cardId]);
    if (store.changes.length > CHANGES_KEEP) store.changes.splice(0, store.changes.length - CHANGES_KEEP);
    const line = `event: change\ndata: ${JSON.stringify(rec)}\n\n`;
    afterCommit(() => {
      for (const client of sseClients) {
        if (rec.board && ctx.roleOn(client.who, rec.board) < 1) continue;
        try {
          client.res.write(line);
        } catch {
          sseClients.delete(client);
        }
      }
    });
    save();
  }

  // ---------- card and board records ----------
  const slugOf = (board, id) => (id && id.startsWith(board + '-') ? id.slice(board.length + 1) : id);
  const isStandingCard = card => (cfg.standingCards || []).includes(slugOf(card.board, card.id));
  function pushLog(card, entry) {
    card.log = (card.log || []).concat([entry]);
    if (card.log.length > LOG_KEEP) card.log = card.log.slice(-LOG_KEEP);
    if (store.cards[card.id] === card) wakeCard(card);
  }
  function noteOperatorMessage(card, t) {
    card.messageTimes = (card.messageTimes || []).concat([t]).slice(-LOG_KEEP);
  }
  // Older replies delivered from another conversation had no card log entry. Recover their unread timestamps on start.
  function recoverOperatorMessages() {
    const byCard = new Map();
    for (const m of Object.values(store.comments))
      if (m.cardId && m.via === 'api' && m.author !== 'coordinator' && m.t && store.cards[m.cardId]) {
        if (!byCard.has(m.cardId)) byCard.set(m.cardId, []);
        byCard.get(m.cardId).push(m);
      }
    for (const [id, messages] of byCard) {
      const card = store.cards[id],
        logged = new Set((card.log || []).map(e => e.t));
      const recorded = Array.isArray(card.messageTimes) ? card.messageTimes : [];
      const counts = new Map();
      for (const t of recorded) counts.set(t, (counts.get(t) || 0) + 1);
      const recovered = [];
      for (const m of messages) {
        if (logged.has(m.t)) continue;
        const n = counts.get(m.t) || 0;
        if (n) counts.set(m.t, n - 1);
        else recovered.push(m.t);
      }
      if (recovered.length) card.messageTimes = recorded.concat(recovered).sort().slice(-LOG_KEEP);
    }
  }
  recoverOperatorMessages();
  function pushActivity(b, text, t) {
    b.activity = (b.activity || []).concat([{ t: t || now(), text }]);
    if (b.activity.length > ACTIVITY_KEEP) b.activity = b.activity.slice(-ACTIVITY_KEEP);
  }

  // ---------- import and archive ----------
  function importData(b, by) {
    if (Object.values(store.sessionOwnership?.boards || {}).some(board => board.enforced))
      throw new Error('activated ownership requires a separate fenced import migration');
    if (b.sessionOwnership || (b.boards || []).some(board => (board.data || board).ownership))
      throw new Error('imports cannot replace session ownership');
    let n = 0;
    for (const x of b.boards || []) {
      const id = x.id;
      store.boards[id] = Object.assign(store.boards[id] || { id }, x.data || x);
      n++;
    }
    for (const x of b.cards || []) {
      const id = x.id;
      store.cards[id] = Object.assign({ decisions: [], log: [] }, x.data || x, { id });
      n++;
    }
    for (const x of b.comments || []) {
      const id = x.id;
      store.comments[id] = Object.assign({}, x.data || x, { id });
      n++;
    }
    change('import', String(n), by, null);
    return { imported: n };
  }

  // Archive on Done (PLAN 1.4): Done cards older than N days leave the store, each as one JSON file with its
  // comments, under <archiveDir>/<board>/<card id>.json. Nothing is lost; the store stays small. Two doors: the API
  // route (safe while the server runs) and the archive command in server.js (board.sh archive stops the server first,
  // since two writers on one store file lose data).
  //   node server.js --config config.json archive --board lighthouse [--days 7] [--out DIR] [--all]
  // --all clears a board's whole card list so the operator can remake it: every card of the board, whatever its
  // state or age, goes to the archive with its conversation; the General box and the transcript stay. board.sh
  // clear-cards.
  function archiveDone(board, days, out, by, all) {
    if (store.sessionOwnership?.boards?.[board]?.enforced && !transaction)
      throw new Error('activated boards require the fenced archive HTTP route');
    const cutoff = Date.now() - days * 86400000;
    const moved = [];
    for (const c of Object.values(store.cards)) {
      if (c.board !== board) continue;
      if (!all) {
        if (c.status !== 'done') continue;
        const t = Date.parse(c.updatedAt || '');
        if (isNaN(t) || t > cutoff) continue;
      }
      const comments = Object.values(store.comments).filter(x => x.cardId === c.id);
      const dir = path.join(out, board);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, c.id + '.json'),
        JSON.stringify(compatibility.write({ archivedAt: now(), archivedBy: by, card: c, comments }), null, 1) + '\n',
      );
      for (const x of comments) delete store.comments[x.id];
      delete store.cards[c.id];
      change('card-archived', c.id, by, board);
      moved.push(c.id);
    }
    // the General box too: messages older than the cutoff leave as one file per run (never with --all: a cleared board
    // keeps its General)
    const gen = all
      ? []
      : Object.values(store.comments).filter(x => x.board === board && !x.cardId && Date.parse(x.t || '') <= cutoff);
    if (gen.length) {
      const dir = path.join(out, board);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'general-' + now().replace(/:/g, '-') + '.json'),
        JSON.stringify(compatibility.write({ archivedAt: now(), archivedBy: by, messages: gen }), null, 1) + '\n',
      );
      for (const x of gen) delete store.comments[x.id];
      change('general-archived', String(gen.length), by, board);
      moved.push('general:' + gen.length);
    }
    return moved;
  }
  const ARCHIVE_DIR = () => cfg.archiveDir || path.join(path.dirname(STORE), 'archive');

  // store is the one store object for the life of the process: the Object.assign above loads the file into it, and
  // nothing replaces it, so every module may hold it
  return {
    STORE,
    PUBLIC,
    ATTACH,
    IMAGE_EXT,
    CLAIMS,
    CHANGES_KEEP,
    LOG_KEEP,
    ACTIVITY_KEEP,
    OPS_KEEP,
    TRANSCRIPT_KEEP,
    store,
    ROW_SEEN,
    ROWKEYS_KEEP,
    rowKey,
    saveNow,
    save,
    transact,
    afterCommit,
    beforeCommit,
    inTransaction: () => !!transaction,
    sentBefore,
    remember,
    now,
    newId,
    sseClients,
    change,
    slugOf,
    isStandingCard,
    pushLog,
    noteOperatorMessage,
    pushActivity,
    importData,
    archiveDone,
    ARCHIVE_DIR,
  };
};
