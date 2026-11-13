'use strict';
const { ownerId } = require('./configuration');
const { presence } = require('./shift-presence');
// The board's tool-call engine (TOOLCALL-DESIGN.md). Operators act on the board through validated calls, and every
// call returns a receipt of what the operator owes. A board runs either this or the line protocol in grammar.js
// (cfg.boards[id].protocol). Authority comes only from a person; nothing settles implicitly; nothing is dropped
// silently; untrusted text is quoted and labelled; the server enforces. Nothing awaits inside a call; a batch or a dry
// run is rehearsed on a copy and the real store is never swapped; every id is checked against the board it is used on.
//
// This file holds the staging, the short ids, the shared helpers and the receipt, and joins the other parts:
// toolcalls-tools.js (cards, replies, asks, Ops, the shift, notices), toolcalls-relay.js (prompts and relays),
// toolcalls-authority.js (standing authorities, the handoff, /yolo) and toolcalls-request.js (one request: a call or
// a batch). The parts share one object, tc.
const crypto = require('crypto');
const lifecycle = require('./card-transitions');
const { questionState } = require('./crm-state');

module.exports = function makeToolcalls(ctx) {
  const { cfg, now, newId } = ctx;
  // what the parts share: the context, the helpers below, and the state of the call being applied
  const tc = {
    ctx,
    cfg,
    now,
    newId,
    // the copy of the store a batch or a dry run is rehearsed on, while it runs
    REHEARSAL: null,
    // the asks made earlier in the batch being applied: a prompt after one on its card is its follow-through
    BATCH_ASKS: null,
    // effects (change feed, push, CRM, judges) of the call being applied, released only if it is kept
    FX: null,
  };

  // ---------- staging ----------
  // Every tool runs synchronously, so no other request runs between a call's first write and its answer: a wait inside
  // a staged call would let a refusal wipe other requests' writes. Single calls validate everything before their first
  // write. A batch or a dry run is first rehearsed on a copy of the parts the tools touch; the real store is never
  // replaced, so whatever else holds its objects (a judge in flight, the CRM outbox, a push) writes into live ones.
  const S = () => tc.REHEARSAL || ctx.store();
  const STAGED = ['comments', 'cards', 'boards', 'tickets', 'authorities'];
  const fx = fn => {
    if (tc.FX) tc.FX.push(fn);
    else fn();
  };
  const change = (...a) => fx(() => ctx.change(...a));
  const notify = (...a) => fx(() => ctx.notify(...a));
  const crmSend = (...a) => fx(() => ctx.crmSend(...a));
  const judge = rid =>
    fx(() =>
      setImmediate(() => {
        try {
          ctx.judgeComment(rid);
        } catch (e) {}
      }),
    );
  function rehearse(fn) {
    const real = ctx.store(),
      copy = Object.assign({}, real);
    for (const k of STAGED) copy[k] = structuredClone(real[k] || {});
    const saved = { INDEX, indexed, FX: tc.FX };
    tc.REHEARSAL = copy;
    INDEX = new Map();
    indexed = false;
    tc.FX = [];
    try {
      return fn();
    } finally {
      tc.REHEARSAL = null;
      INDEX = saved.INDEX;
      indexed = saved.indexed;
      tc.FX = saved.FX;
    }
  }
  // times compared as instants: "…:48Z" and "…:48.123Z" do not sort as strings
  const tms = iso => {
    const v = Date.parse(iso || '');
    return isNaN(v) ? 0 : v;
  };

  // ---------- ids: short, non-sequential, with a check letter ----------
  const B32 = 'abcdefghjkmnpqrstuvwxyz23456789';
  // the check letter catches any one mistyped letter and any two swapped neighbours (weights by place in the
  // alphabet, mod 31)
  const check = body => {
    let s = 0;
    for (const ch of body) s = (s * 7 + B32.indexOf(ch) + 1) % B32.length;
    return B32[s];
  };
  function makeSid(prefix, id, len = 4) {
    const h = crypto.createHash('sha1').update(String(id)).digest();
    let s = '';
    for (let i = 0; i < len; i++) s += B32[h[i] % B32.length];
    return prefix + s + check(prefix + s);
  }
  const sidOk = s =>
    typeof s === 'string' &&
    /^[a-z][a-z2-9]{5,6}$/.test(s) &&
    [...s].every(ch => B32.includes(ch)) &&
    check(s.slice(0, -1)) === s.slice(-1);
  // INDEX: sid -> { type, ref, card }; dirty: an id was given out that is not saved yet
  let INDEX = new Map(),
    indexed = false,
    dirty = false;
  function put(obj, prefix, type, card) {
    const cur = obj.sid ? INDEX.get(obj.sid) : null;
    if (cur && cur.ref === obj) {
      if (card) cur.card = card;
      return obj.sid;
    }
    let sid = obj.sid && !cur && sidOk(obj.sid) ? obj.sid : makeSid(prefix, obj.id || JSON.stringify(obj).slice(0, 80)),
      n = 4;
    while (INDEX.has(sid) && INDEX.get(sid).ref !== obj) sid = makeSid(prefix, (obj.id || '') + ':' + ++n, 5);
    if (obj.sid !== sid) {
      obj.sid = sid;
      dirty = true;
    }
    INDEX.set(sid, { type, ref: obj, card: card || null });
    return sid;
  }
  // who wrote a message, from facts the server set (never from its text)
  const authorOf = message => require('./comment-author')(ctx.cfg, message);
  function kindOf(m) {
    const a = authorOf(m);
    if (['owner', 'staff', 'advice', 'coordinator'].includes(a)) return ['m', 'message'];
    if (m.kind === 'notice') return ['n', 'notice'];
    if (m.prompt) return ['p', 'prompt'];
    return null;
  }
  function reindex() {
    const st = S(),
      items = [];
    for (const m of Object.values(st.comments || {})) {
      const k = kindOf(m);
      if (k) items.push([m, k[0], k[1], null]);
    }
    for (const c of Object.values(st.cards || {})) for (const d of c.decisions || []) items.push([d, 'a', 'ask', c]);
    for (const t of Object.values(st.authorities || {})) items.push([t, 't', 'authority', null]);
    INDEX = new Map();
    // ids already given out keep their holders: claimed first, so a new id can never take one an operator was shown
    for (const [o, , type, card] of items)
      if (o.sid && sidOk(o.sid) && !INDEX.has(o.sid)) INDEX.set(o.sid, { type, ref: o, card });
    for (const [o, p, type, card] of items) put(o, p, type, card);
    indexed = true;
  }
  const ensureIndex = () => {
    if (!indexed) reindex();
  };
  const assign = (obj, prefix, type, card) => {
    ensureIndex();
    return put(obj, prefix, type, card);
  };
  function alive(hit) {
    // the item is still on the board (archiving and edits remove or replace objects)
    const st = S();
    if (hit.type === 'ask')
      return !!(hit.card && st.cards[hit.card.id] === hit.card && (hit.card.decisions || []).includes(hit.ref));
    if (hit.type === 'authority') return (st.authorities || {})[hit.ref.id] === hit.ref;
    return st.comments[hit.ref.id] === hit.ref;
  }
  const NOUN = { message: 'message', ask: 'ask', notice: 'notice', prompt: 'prompt', authority: 'standing authority' };
  const an = w => (/^[aeiou]/.test(w) ? 'an ' : 'a ') + w;
  function lookup(sid, types, board) {
    ensureIndex();
    const want = types ? [].concat(types) : null,
      noun = want ? want.map(t => NOUN[t]).join(' or ') : 'item';
    if (!sidOk(sid))
      return { err: `${q(sid, 20)} is not a valid id (ids look like m7k3qa; check for a mistyped letter).` };
    let hit = INDEX.get(sid);
    if (!hit || !alive(hit)) {
      reindex();
      hit = INDEX.get(sid);
      if (hit && !alive(hit)) hit = null;
    }
    const owner = hit ? (hit.type === 'ask' ? hit.card.board : hit.ref.board) : null;
    // another board's id is refused like a missing one
    if (!hit || (board && owner !== board)) return { err: `There is no ${noun} ${sid} on this board.` };
    if (want && !want.includes(hit.type)) return { err: `${sid} is ${an(NOUN[hit.type])}, not ${an(noun)}.` };
    return { ref: hit.ref, card: hit.card };
  }
  // short ids for messages a route shows (Owner's, staff, notices, prompts); new ids are saved, never only in memory
  function ensureSid(m) {
    ensureIndex();
    const k = kindOf(m);
    if (k) put(m, k[0], k[1]);
    if (dirty && !tc.FX && !tc.REHEARSAL) {
      dirty = false;
      if (ctx.save) ctx.save();
    }
    return m;
  }

  // ---------- helpers ----------
  const q = (s, n = 160) =>
    '«' +
    String(s == null ? '' : s)
      .replace(/[«»]/g, character => (character === '«' ? '‹' : '›'))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, n) +
    (String(s == null ? '' : s).length > n ? '…' : '') +
    '»';
  const et = iso => {
    try {
      return new Date(iso).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: ctx.cfg.timeZone || 'UTC',
      });
    } catch (e) {
      return String(iso);
    }
  };
  // a slug as the receipt prints it: never a line break or a quote from outside
  const sl = (board, id) => String(ctx.slugOf(board, id) || '').replace(/[^A-Za-z0-9._-]/g, '');
  const STOP = new Set(['the', 'for', 'and', 'with', 'from', 'into', 'this', 'that', 'our', 'new', 'card', 'task']);
  const words = t =>
    new Set(
      String(t || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(w => w.length > 2 && !STOP.has(w)),
    );
  // shared words over the shorter title: 'Importer upload choices' is 'Upload choices for the importer'
  const similar = (a, b) => {
    const A = words(a),
      B = words(b);
    if (!A.size || !B.size) return 0;
    let k = 0;
    for (const w of A) if (B.has(w)) k++;
    return k < 2 && Math.min(A.size, B.size) > 1 ? k / Math.max(A.size, B.size) : k / Math.min(A.size, B.size);
  };
  const cardsOf = board => Object.values(S().cards).filter(c => c.board === board);
  const openAsks = lifecycle.openAsks;
  // a card opened with the board's name already in its slug is stored doubled, as board-board-x, and the name the
  // receipt gives it (board-x) reaches it on every path: a lookup, a reply's card, a relay's
  const cardId = (board, ref) => {
    const r = String(ref),
      id = r.startsWith(board + '-') ? r : board + '-' + r,
      dbl = board + '-' + r;
    return !S().cards[id] && S().cards[dbl] ? dbl : id;
  };
  function resolveCard(board, ref) {
    if (!ref) return { err: 'Name the card (its slug).' };
    const c = S().cards[cardId(board, ref)];
    if (c && c.board === board) return { card: c };
    const near = cardsOf(board)
      .filter(x => x.status !== 'done')
      .map(x => [similar(ref, ctx.slugOf(board, x.id) + ' ' + x.title), x])
      .sort((a, b) => b[0] - a[0])
      .slice(0, 3)
      .filter(x => x[0] > 0)
      .map(x => `${sl(board, x[1].id)} (${q(x[1].title, 60)})`);
    return {
      err:
        `There is no card ${q(ref, 60)} on this board.` +
        (near.length ? ` Nearest: ${near.join('; ')}.` : ' board_open makes a new one.'),
    };
  }
  function laneFollows(card, stateArg) {
    if (!stateArg && card.status === 'waiting' && !openAsks(card).length) lifecycle.move(card, 'inflight');
  }
  function message(fields) {
    const st = S(),
      id = newId(),
      t = fields.t || now();
    const m = Object.assign(
      { id, t, via: 'api', handled: true, replyTo: null, attachments: [], author: 'operator' },
      fields,
      { id, t },
    );
    st.comments[id] = m;
    change('comment', id, m.by, m.board);
    if (m.cardId && st.cards[m.cardId] && m.author === 'operator') ctx.noteOperatorMessage(st.cards[m.cardId], t);
    return m;
  }
  function logLine(card, kind, text, by, extra) {
    ctx.pushLog(card, Object.assign({ t: now(), kind, who: by, text: String(text || '').slice(0, 4000) }, extra || {}));
    card.updatedAt = now();
    card.updatedBy = by;
    change('card', card.id, by, card.board);
  }
  const staffOpen = card =>
    Object.values(S().comments).find(m => m.cardId === card.id && m.kind === 'staff' && !m.handled);
  function crmWorking(card) {
    // the CRM hears "working" at the operator's first act on a question's card, as on the line protocol
    if (questionState(card, S()) !== 'asked' || !staffOpen(card)) return;
    card.crm.working = now();
    card.crm.state = 'working';
    crmSend('ack', card.crm.id, card.id, { state: 'working', note: 'the operator is looking into it' });
  }

  // ---------- the receipt ----------
  function receipt(board, who, detail) {
    ensureIndex();
    const st = S(),
      b = st.boards[board] || {},
      sh = b.shift || {},
      shiftPresence = presence(b, cfg.boards?.[board]?.protocol).p,
      mode = ((cfg.boards || {})[board] || {}).protocol === 'tools' ? 'tool mode' : 'line mode';
    const owed = Object.values(st.comments)
      .filter(m => m.board === board && !m.handled && ['owner', 'staff', 'advice', 'coordinator'].includes(authorOf(m)))
      .sort((x, y) => tms(x.t) - tms(y.t));
    const notices = Object.values(st.comments).filter(
      m => m.board === board && m.kind === 'notice' && authorOf(m) !== 'coordinator' && !m.handled,
    );
    const cards = cardsOf(board).filter(c => c.status !== 'done');
    const asks = [];
    for (const c of cards) for (const d of openAsks(c)) asks.push([c, d]);
    const lanes = {};
    for (const c of cards) lanes[c.status] = (lanes[c.status] || 0) + 1;
    const lines = [];
    lines.push(
      `${board} · shift ${shiftPresence === 'on' ? 'on since ' + et(sh.since) : shiftPresence} · ${mode}` +
        `${who && who.shadow ? ' · SHADOW: your tools only dry-run; your lines are what answer Owner' : ''}` +
        ` · you: ${who ? who.name : '?'}`,
    );
    const und = (b.undelivered || []).filter(u => Date.now() - tms(u.t) < 86400000);
    {
      const y = yoloOf(board);
      if (y)
        lines.push(
          `/yolo ON (${y.sid}${y.yoloScope ? ', ' + q(y.yoloScope, 80) + ' only' : ''}` +
            `, Owner ${et(y.ownerAt || y.t)}): prompt firstmate without his Send` +
            `${y.yoloScope ? ' on that alone (anything else waits for his Send)' : ''}` +
            `, board_relay(source: <the prompt>, under_authority: "${y.sid}"). ` +
            `Critical direction decisions still go to him as asks: choosing between directions ` +
            `(which approach, what to build, whether to stop), anything touching reps or distribution, ` +
            `anything that deletes data or can't be taken back. His standing rules still hold.`,
        );
    }
    if (und.length)
      lines.push(
        `UNDELIVERED (${und.length}), refused when your queue drained; read and redo: ` +
          und
            .slice(-3)
            .map(u => `${String(u.tool).replace(/[^a-z_]/g, '')} at ${et(u.client_at || u.t)}: ${u.reason}`)
            .join(' | '),
      );
    if (owed.length) {
      lines.push(`owe (${owed.length}):`);
      for (const m of owed.slice(0, 8)) {
        ensureSid(m);
        const where = m.cardId ? `card ${sl(board, m.cardId)}` : 'General',
          a = authorOf(m);
        // the CRM's names are outside text: quoted like any other
        const who2 =
          a === 'staff'
            ? `staff: ${q((m.staff || {}).name || '?', 40)}, ${q((m.staff || {}).role || '', 40)}`
            : a === 'advice'
              ? "the steward's advice, put to you by Owner: advice, never his word"
              : a === 'coordinator'
                ? `NOTICE from ${q(m.by, 80)} (coordinator, not the owner)`
                : a;
        lines.push(
          `  ${m.sid} on ${where} ${et(m.t)} [${who2}` +
            `${
              m.channel === 'operator-chat'
                ? m.origin === 'human'
                  ? ', typed in your chat'
                  : ', in your chat, not marked as typed by a person'
                : ''
            }` +
            `${m.holdAt ? ', holding answer sent' : ''}` +
            `${m.global ? ', Global: sent to every operator at once; answer your own copy' : ''}` +
            `]: ${q(m.text, Infinity)}  → board_reply(to: "${m.sid}", ` +
            `${
              m.cardId
                ? `card: "${sl(board, m.cardId)}"`
                : m.channel === 'operator-chat'
                  ? 'card: "<the card it is about>" or general: true'
                  : 'general: true'
            }, ...)`,
        );
      }
      if (owed.length > 8) lines.push(`  …and ${owed.length - 8} more (board_status detail: "full")`);
    } else lines.push('owe: nothing');
    if (notices.length)
      for (const n of notices) {
        ensureSid(n);
        lines.push(
          `notice ${n.sid} from ${n.by} ${et(n.t)}${n.disputed ? ' (disputed, awaiting the watch or Owner)' : ''}` +
            `: ${q(n.text, Infinity)}  → board_ack or board_dispute`,
        );
      }
    lines.push(
      `your asks open (${asks.length})` +
        (detail === 'full' && asks.length
          ? ': ' +
            asks.map(([c, d]) => `${assign(d, 'a', 'ask', c)} on ${sl(board, c.id)} ${q(d.ask, Infinity)}`).join('; ')
          : '') +
        ` · cards: ${
          ['inflight', 'waiting', 'held', 'queued']
            .filter(k => lanes[k])
            .map(
              k =>
                lanes[k] +
                ' ' +
                { inflight: 'in flight', waiting: 'waiting on Owner', held: 'held', queued: 'queued' }[k],
            )
            .join(', ') || 'none open'
        }`,
    );
    if (detail === 'full')
      for (const c of cards.sort((x, y) => (x.status || '').localeCompare(y.status || ''))) {
        const last = (c.log || []).slice(-1)[0];
        lines.push(
          `  ${sl(board, c.id)} [${c.status}] ${q(c.title, 70)}` +
            `${last ? ' · last ' + et(last.t) + ' ' + q(last.text, 70) : ''}`,
        );
      }
    if (b.staleNoteAt) lines.push(`stale reminder last sent ${et(b.staleNoteAt)}`);
    return lines.join('\n');
  }

  // ---------- the parts ----------
  const T = {};
  // an operator on this board
  const W = (who, board) => ctx.roleOn(who, board) >= 3;
  Object.assign(tc, {
    S,
    fx,
    change,
    notify,
    crmSend,
    judge,
    rehearse,
    tms,
    authorOf,
    assign,
    lookup,
    ensureSid,
    q,
    et,
    sl,
    similar,
    cardsOf,
    openAsks,
    cardId,
    resolveCard,
    laneFollows,
    message,
    logLine,
    staffOpen,
    crmWorking,
    receipt,
    T,
    W,
  });
  const { yoloOf, yoloSwitch, createAuthority } = Object.assign(tc, require('./toolcalls-authority')(tc));
  require('./toolcalls-tools')(tc);
  require('./toolcalls-relay')(tc);
  const { handleCalls } = require('./toolcalls-request')(tc);

  function revalidateRelay(board, who, ticket, input) {
    const source = S().comments[ticket.promptId || ticket.messageId];
    const word = ticket.wordId && S().comments[ticket.wordId];
    if (!source) return { ok: false, reason: 'original source is unavailable' };
    const sourceId = ensureSid(source).sid;
    const wordId = word && ensureSid(word).sid;
    tc.VALIDATE_RELAY = true;
    try {
      const result = rehearse(() =>
        T.board_relay(board, who, {
          source: sourceId,
          to: ticket.to,
          again: ticket.again,
          ...(wordId ? { on_word: wordId } : {}),
          ...(ticket.underAuthority ? { under_authority: ticket.underAuthority } : {}),
          seen: input.seen || ticket.seen,
          dispatchProtocol: 'dispatch-ledger-v1',
        }),
      );
      return { ok: result.ok && result.hash === ticket.hash, reason: result.reason || 'exact instruction changed' };
    } finally {
      tc.VALIDATE_RELAY = false;
    }
  }

  return {
    handleCalls,
    revalidateRelay,
    settleRelaySource: (...args) => tc.settleRelaySource(...args),
    createAuthority,
    yoloSwitch,
    yoloOf,
    receipt,
    ensureSid,
    authorOf,
    sidOk,
    makeSid,
    reindex: () => {
      indexed = false;
      INDEX.clear();
    },
  };
};
