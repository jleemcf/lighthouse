'use strict';
const { presence, active } = require('./shift-presence');
// The steward as Owner's decision assistant: the board side (STEWARD-ASSISTANT-DESIGN.md).
// The steward is a Codex session on the operator's machine, run one job at a time by the kit's stwake.cjs, which
// claims a job here, runs it, and posts the structured answer back. The model never holds a board token. The board
// owns everything that must not depend on the steward being up: the requests and their states, the digest clock, the
// held phone pings. Advice lives in its own store, never among the messages, so nothing mistakes it for Owner's word.
//
// This file holds the helpers, the rulings, the requests, the held pings and the digest clock, the overview's clock,
// the steward's health and what the page shows, and joins the other parts: steward-job.js (the job the steward reads,
// and the next one it claims), steward-result.js (its answers, checked at the door) and steward-routes.js (the
// routes). The parts share one object, stw.
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto');

module.exports = function makeSteward(ctx) {
  const { cfg, now, newId } = ctx;
  const S = () => ctx.store();
  const on = board => !!((cfg.boards || {})[board] || {}).steward;
  const st0 = S();
  st0.stewardRequests = st0.stewardRequests || {};
  st0.advice = st0.advice || {};
  st0.stewards = st0.stewards || {};
  const tms = iso => {
    const v = Date.parse(iso || '');
    return isNaN(v) ? 0 : v;
  };
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
  // a quote the text inside cannot close
  const q = (s, n = 400) =>
    '«' +
    String(s == null ? '' : s)
      .replace(/[«»]/g, ch => (ch === '«' ? '‹' : '›'))
      .replace(/[\s\u2028\u2029\u0085]+/g, ' ')
      .trim()
      .slice(0, n) +
    (String(s == null ? '' : s).length > n ? '…' : '') +
    '»';
  // an id or a name in the job: never a line break, never a quote mark
  const sid = s =>
    String(s == null ? '' : s)
      .replace(/[^A-Za-z0-9._:-]/g, '_')
      .slice(0, 120);
  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

  // ---------- rulings selected by server.js: host policy file, or the bundled compatibility fallback ----------
  // the hash names the exact file every job read, so a changed rulings.json shows on his page and in each job. It is
  // shown, not pinned: anyone who can write it on the board machine can also write server.js, so a pin adds nothing
  let RUL = { at: 0, list: [], byN: new Map(), hash: null };
  function rulings() {
    try {
      const f = ctx.rulingsFile,
        m = fs.statSync(f).mtimeMs;
      if (m !== RUL.at) {
        const raw = fs.readFileSync(f),
          j = JSON.parse(raw.toString('utf8'));
        RUL = {
          at: m,
          list: j.rulings || [],
          byN: new Map((j.rulings || []).map(r => [r.n, r])),
          hash: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12),
        };
      }
    } catch (e) {}
    return RUL;
  }

  // ---------- requests ----------
  const PRESS = new Set(['second-opinion', 'explain', 'ask', 'state']);
  const ASKED = {
    'second-opinion': 'your second opinion',
    explain: 'your explainer',
    ask: 'your question',
    state: 'the overview',
  };
  const PRIORITY = { 'second-opinion': 0, explain: 0, ask: 0, state: 0, 'ask-check': 1, review: 2, digest: 3 };
  // the time settings exist so a test can run the clock in seconds
  const MAX_TRIES = 3,
    triesOf = r => (r.kind === 'explain' ? 2 : MAX_TRIES),
    RUN_LIMIT = Number(cfg.stewardRunLimitMs) || 30 * 60000,
    RETRY_MS = cfg.stewardRetryMs != null ? Number(cfg.stewardRetryMs) : 2 * 60000;
  function request(board, kind, fields, by) {
    const st = S(),
      id = newId();
    const r = Object.assign(
      { id, board, kind, t: now(), by: by || 'board', state: 'pending', attempts: 0, priority: PRIORITY[kind] },
      fields || {},
    );
    st.stewardRequests[id] = r;
    ctx.change('steward', id, by || 'board', board);
    return r;
  }
  const decisionOf = (card, askId) => (card && askId ? (card.decisions || []).find(d => d.id === askId) || null : null);
  function settled(r) {
    // the ask a request is about was settled (or its card closed) before the steward ran
    if (!r.askId) return false;
    const card = S().cards[r.cardId],
      d = decisionOf(card, r.askId);
    return !card || card.status === 'done' || !d || !!d.resolvedAt;
  }
  function prune() {
    const st = S(),
      cut = Date.now() - 14 * 86400000;
    for (const [k, v] of Object.entries(st.stewardRequests))
      if (
        cfg.boards?.[v.board]?.lifecycle !== 'archived' &&
        ['answered', 'failed', 'skipped'].includes(v.state) &&
        tms(v.t) < cut
      )
        delete st.stewardRequests[k];
    for (const v of Object.values(st.stewardRequests))
      if (
        cfg.boards?.[v.board]?.lifecycle !== 'archived' &&
        v.state === 'pending' &&
        Date.now() - tms(v.t) > 7 * 86400000
      ) {
        v.state = 'failed';
        v.lastError = 'expired: the steward never took it in a week';
      }
    const adv = Object.values(st.advice)
      .filter(a => !(a.forDigest && !a.digestedIn) && !a.put && !(a.puts && Object.keys(a.puts).length))
      .sort((a, b) => tms(a.t) - tms(b.t));
    const dropFile = id => {
      const att = st.attachments[id];
      if (!att || !att.steward) return;
      try {
        fs.unlinkSync(path.join(ctx.attachDir, id + (att.type === 'image/svg+xml' ? '.svg' : '.png')));
      } catch (e) {}
      delete st.attachments[id];
    };
    if (adv.length > 3000)
      for (const a of adv.slice(0, adv.length - 3000)) {
        if (a.diagram) dropFile(a.diagram);
        delete st.advice[a.id];
      }
    // a diagram no advice holds (its result failed, or was withheld) goes after a day
    const used = new Set(
      Object.values(st.advice)
        .map(a => a.diagram)
        .filter(Boolean),
    );
    for (const [id, att] of Object.entries(st.attachments || {}))
      if (att && att.steward && !used.has(id) && Date.now() - tms(att.t) > 86400000) dropFile(id);
  }

  // a new ask on a steward board is checked; only asks opened after the steward came on, so turning it on is not a
  // flood. Automatic checks spend his plan, so a board gets a few an hour and a card one an hour, however many asks one
  // post opens; an ask past the limit is marked unchecked, and its ping, if held, still goes with the digest
  const CHECKS_PER_HOUR = Number(cfg.stewardChecksPerHour) || 6;
  function scanAsks() {
    const st = S(),
      hourAgo = Date.now() - 3600000;
    for (const board of Object.keys(st.boards)) {
      if (!on(board)) continue;
      const sw = (st.stewards[board] = st.stewards[board] || {});
      if (!sw.since) sw.since = now();
      const recent = Object.values(st.stewardRequests).filter(
        r => r.board === board && r.kind === 'ask-check' && tms(r.t) > hourAgo,
      );
      let left = CHECKS_PER_HOUR - recent.length;
      const cardsDone = new Set(recent.map(r => r.cardId));
      for (const c of Object.values(st.cards)) {
        if (c.board !== board || c.status === 'done') continue;
        // the board's own "your move" asks (kind waiting) are not the operator's questions
        for (const d of c.decisions || [])
          if (!d.resolvedAt && !d.stewardCheck && d.kind !== 'waiting' && tms(d.openedAt) >= tms(sw.since)) {
            if (left <= 0 || cardsDone.has(c.id)) {
              d.stewardCheck = 'over-limit';
              sw.unchecked = (sw.unchecked || 0) + 1;
              continue;
            }
            d.stewardCheck = request(board, 'ask-check', { cardId: c.id, askId: d.id }).id;
            left--;
            cardsDone.add(c.id);
          }
      }
    }
  }

  // ---------- held pings and the digest clock (the board's, never the steward's) ----------
  const PROD = /\bprod(uction)?\b|\blive site\b|\bgo[- ]live\b/i;
  // an ask's phone ping waits for the next digest only when the operator marked it not urgent, nothing says it cannot
  // be undone (the operator's own "no", or the steward's check, which releases it at once), it is not a prompt and it
  // does not name Production; everything else pings at once (design section 4). No "can be undone" tag is needed
  function holdPing(board, card, fresh) {
    if (!on(board) || !fresh.length) return false;
    if (
      !fresh.every(
        d =>
          d.urgent === false &&
          d.kind !== 'prompt' &&
          d.reversible !== 'no' &&
          !d.irreversible &&
          !PROD.test(String(d.ask || '') + ' ' + String(card.title || '')),
      )
    )
      return false;
    const t = now();
    for (const d of fresh) d.heldPing = t;
    return true;
  }
  const etParts = ms => require('./business-time').parts(cfg, ms);
  const DIGEST_SEC = (Number(cfg.stewardDigestMinutes) || 240) * 60;
  // every 4 hours from midnight Eastern: 12, 4 and 8 o'clock, AM and PM
  const slotOf = ms => {
    const e = etParts(ms);
    return `${e.day}/${Math.floor(e.sec / DIGEST_SEC)}`;
  };
  function releaseHeld(board, why) {
    const st = S(),
      b = st.boards[board] || {},
      held = [];
    for (const c of Object.values(st.cards))
      if (c.board === board)
        for (const d of c.decisions || [])
          if (d.heldPing && !d.heldReleased && !d.resolvedAt) {
            d.heldReleased = now();
            held.push([c, d]);
          }
    if (held.length)
      ctx.notify(board, {
        kind: 'ask',
        title: 'Needs you: ' + (b.name || board),
        body: (held.length === 1
          ? held[0][0].title + ': ' + held[0][1].ask
          : `${held.length} questions waiting (${why}): ` + held.map(([c]) => c.title).join('; ')
        ).slice(0, 200),
        url: '/#board=' + board,
        tag: 'held-' + board,
      });
    return held;
  }
  // ---------- the overview ----------
  // the steward's reading of the whole board, at the head of General, while the operator is on shift: due two hours
  // of shift after the last one, his own press included, so a press restarts the two hours; the first of a shift
  // twenty minutes in, once the start is written; none off shift. One the clock asks for never pings: General marks
  // it as new instead
  const OVERVIEW_MS = (Number(cfg.stewardOverviewMinutes) || 120) * 60000,
    OVERVIEW_FIRST_MS =
      (cfg.stewardOverviewFirstMinutes != null ? Number(cfg.stewardOverviewFirstMinutes) : 20) * 60000;
  // newest first; within a second, the later written
  const overviews = board =>
    Object.values(S().advice)
      .filter(a => a.board === board && a.kind === 'state' && !a.cardId)
      .map((a, i) => [a, i])
      .sort((x, y) => tms(y[0].t) - tms(x[0].t) || y[1] - x[1])
      .map(x => x[0]);
  function overviewNext(board) {
    // when the next automatic one is due; null off shift, without a steward, or while one is under way
    const st = S(),
      sh = (st.boards[board] || {}).shift || {};
    if (!on(board) || !active(st.boards[board], cfg.boards?.[board]?.protocol)) return null;
    const reqs = Object.values(st.stewardRequests).filter(r => r.board === board && r.kind === 'state' && !r.cardId);
    if (reqs.some(r => r.state === 'pending' || r.state === 'running')) return null;
    const last = Math.max(
      0,
      ...reqs.map(r => tms(r.t)),
      ...overviews(board)
        .slice(0, 1)
        .map(a => tms(a.t)),
    );
    return new Date(
      Math.max(last + OVERVIEW_MS, (tms(sh.since) || tms(sh.lastSeen)) + OVERVIEW_FIRST_MS),
    ).toISOString();
  }
  function clock() {
    ctx.registry?.refresh();
    const st = S(),
      nowMs = Date.now(),
      slot = slotOf(nowMs);
    for (const [board, b] of Object.entries(st.boards)) {
      if (cfg.boards?.[board]?.lifecycle === 'archived') continue;
      // a hold never outlives the steward that justified it
      if (!on(board)) {
        releaseHeld(board, 'the board has no steward now');
        continue;
      }
      const sw = (st.stewards[board] = st.stewards[board] || {}),
        shiftPresence = presence(b, cfg.boards?.[board]?.protocol, nowMs).p,
        shiftOn = active(b, cfg.boards?.[board]?.protocol, nowMs);
      // nothing is held past the end of a shift
      if (sw.lastShift && sw.lastShift !== 'off' && shiftPresence === 'off') releaseHeld(board, 'the shift ended');
      sw.lastShift = shiftPresence;
      // the clock's overview, counted from anything he pressed
      {
        const due = overviewNext(board);
        if (due && tms(due) <= nowMs) request(board, 'state', { cardId: null, askId: null, priority: 2 });
      }
      if (sw.slot === slot) continue;
      const first = !sw.slot;
      sw.slot = slot;
      // every held ping goes at the slot's turn, steward or not
      const released = first ? [] : releaseHeld(board, 'the 4-hour digest');
      if (!shiftOn || first) continue;
      const reviews = Object.values(st.advice).filter(
        a => a.board === board && a.kind === 'review' && a.forDigest && !a.digestedIn,
      );
      // an empty digest is never written, and never pings
      if (!released.length && !reviews.length) continue;
      // a steward away for a day gets one digest, not six
      const open = Object.values(st.stewardRequests).find(
        x => x.board === board && x.kind === 'digest' && x.state === 'pending',
      );
      if (open) {
        open.asks = (open.asks || []).concat(released.map(([c, d]) => ({ cardId: c.id, askId: d.id })));
        open.reviews = [...new Set((open.reviews || []).concat(reviews.map(a => a.id)))];
        continue;
      }
      request(board, 'digest', {
        asks: released.map(([c, d]) => ({ cardId: c.id, askId: d.id })),
        reviews: reviews.map(a => a.id),
      });
    }
    scanAsks();
    prune();
  }

  // a steward's health, for the board's conduct report and so for the watch: counts and ages only, never the advice or
  // his questions, which are Owner's alone
  function health(board) {
    if (!on(board)) return null;
    const st = S(),
      nowMs = Date.now(),
      day = nowMs - 86400000,
      sw = st.stewards[board] || {},
      b = st.boards[board] || {};
    const reqs = Object.values(st.stewardRequests).filter(r => r.board === board),
      pending = reqs.filter(r => r.state === 'pending');
    const alive = !!sw.at && nowMs - tms(sw.at) < 3 * 60000,
      shiftOn = active(b, cfg.boards?.[board]?.protocol, nowMs);
    const flags = Object.values(st.advice).filter(a => a.board === board && a.kind === 'flag' && tms(a.t) > day);
    // stalled: jobs ready to run, and neither a claim nor an answer for this long, counted only while the shift is on
    // and from its 15th minute; the queue's age alone is no fault, since a press after the shift or a busy steward at
    // xhigh is not stuck. A steward never seen is not installed yet: no alarm (SETUP: install, then turn on)
    const ready = pending.filter(r => !r.notBefore || tms(r.notBefore) <= nowMs),
      shiftFrom = tms((b.shift || {}).since) + 15 * 60000;
    const since = Math.max(
      tms(sw.lastClaim),
      tms(sw.lastAnswer),
      shiftFrom,
      ...ready
        .map(r => tms(r.t))
        .sort((x, y) => x - y)
        .slice(0, 1),
    );
    return {
      installed: !!sw.at,
      alive,
      lastSeen: sw.at || null,
      offMin: shiftOn && sw.at && !alive ? Math.round((nowMs - tms(sw.at)) / 60000) : 0,
      pending: pending.length,
      ready: ready.length,
      stalledMin: shiftOn && ready.length && since < nowMs ? Math.round((nowMs - since) / 60000) : 0,
      running: reqs.filter(r => r.state === 'running').length,
      failed24h: reqs.filter(r => r.state === 'failed' && tms(r.failedAt || r.t) > day).length,
      withheld24h: flags.filter(a => /withheld/.test(a.oneLine)).length,
      lastError: sw.error || null,
      unchecked: sw.unchecked || 0,
      answered24h: reqs.filter(r => r.state === 'answered' && tms(r.answeredAt) > day).length,
    };
  }

  // what the page shows: advice, open requests and the steward's state, for the boards this identity reads
  function forPage(all, who) {
    const boards = {};
    // the steward's words are Owner's: an operator or the watch reading the board never sees them
    for (const id of Object.keys(all)) if (person(who, id)) boards[id] = all[id];
    const st = S(),
      since = Date.now() - 3 * 86400000;
    // summaries only: the full text and the claims come when he opens one (/api/advice/<id>), since the page fetches
    // this on every change and whole answers would ride on each operator line. The newest overview of each board rides
    // whole but for its claims, since General shows it open; earlier ones come when opened
    const newest = {};
    for (const id of Object.keys(boards)) newest[id] = overviews(id)[0];
    const lite = a => {
      const o = Object.assign({}, a),
        keep = newest[a.board] === a;
      if (!keep) {
        delete o.text;
        delete o.overview;
      }
      delete o.claims;
      o.more = (!keep && (!!(a.text && a.text !== a.oneLine) || !!a.overview)) || !!(a.claims && a.claims.length);
      return o;
    };
    const advice = Object.values(st.advice)
      .filter(a => boards[a.board])
      .sort((a, b) => tms(b.t) - tms(a.t))
      .slice(0, 400)
      .map(lite);
    const requests = Object.values(st.stewardRequests)
      .filter(r => boards[r.board] && (['pending', 'running'].includes(r.state) || tms(r.t) > since))
      .map(r => ({
        id: r.id,
        board: r.board,
        kind: r.kind,
        cardId: r.cardId,
        askId: r.askId,
        state: r.state,
        t: r.t,
        attempts: r.attempts,
        runningSince: r.runningSince,
        lastError: r.lastError,
        skippedWhy: r.skippedWhy,
        adviceId: r.adviceId,
        by: r.by,
        items: r.kind === 'digest' ? (r.asks || []).length + (r.reviews || []).length : undefined,
      }));
    const stewards = {};
    for (const id of Object.keys(boards))
      if (on(id)) {
        const sw = st.stewards[id] || {};
        stewards[id] = {
          at: sw.at || null,
          alive: !!sw.at && Date.now() - tms(sw.at) < 3 * 60000,
          model: sw.model || null,
          error: sw.error || null,
          overviewNext: overviewNext(id),
        };
      }
    return {
      advice,
      stewardRequests: requests,
      stewards,
      rulings: Object.keys(stewards).length ? Object.fromEntries(rulings().list.map(r => [r.n, r.title])) : {},
    };
  }

  // ---------- the parts ----------
  // Owner himself, on his page
  const person = (who, board) => who && who.via === 'page' && ctx.roleOn(who, board) >= 4;
  const stw = {
    ctx,
    cfg,
    now,
    newId,
    S,
    on,
    tms,
    et,
    q,
    sid,
    has,
    clip,
    rulings,
    PRESS,
    ASKED,
    PRIORITY,
    triesOf,
    RUN_LIMIT,
    RETRY_MS,
    request,
    decisionOf,
    settled,
    scanAsks,
    overviews,
    person,
  };
  const { secretIn } = Object.assign(stw, require('./steward-result')(stw));
  const { jobText } = Object.assign(stw, require('./steward-job')(stw));
  const { route, cleanSvg } = require('./steward-routes')(stw);

  setInterval(
    () => {
      try {
        clock();
      } catch (e) {
        console.log('steward clock: ' + e.message);
      }
    },
    Number(cfg.stewardClockMs) || 60000,
  ).unref();
  return { route, holdPing, forPage, clock, jobText, scanAsks, secretIn, rulings, on, health, overviewNext, cleanSvg };
};
