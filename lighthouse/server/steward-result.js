'use strict';
// The steward's answers, checked at the door (see steward.js): nothing that looks like a secret is posted, a claim is
// marked verified only against a record the job offered, and the board, never the steward, decides what pings Owner.

module.exports = function makeStewardResult(stw) {
  const { ctx, cfg, now, newId, S, has, clip, rulings, PRESS, ASKED, triesOf, RETRY_MS, decisionOf } = stw;

  function secretsKnown() {
    const out = [];
    for (const k of Object.keys(cfg.tokens || {})) if (k.length >= 8) out.push(k);
    for (const f of ctx.secrets ? ctx.secrets() : []) if (f && f.length >= 8) out.push(f);
    return out;
  }
  // spaces, punctuation and invisible characters cannot split a key past the check
  const flat = s =>
    String(s || '')
      .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
      .replace(/[^A-Za-z0-9]/g, '');
  function decodedViews(s) {
    // the same text with any long base64 or hex run decoded, so an encoded key is seen too
    const out = [s];
    for (const m of String(s).match(/[A-Za-z0-9+/=_-]{16,}/g) || []) {
      try {
        out.push(Buffer.from(m.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1'));
      } catch (e) {}
    }
    for (const m of String(s).match(/(?:[0-9a-fA-F]{2}){16,}/g) || []) {
      try {
        out.push(Buffer.from(m, 'hex').toString('latin1'));
      } catch (e) {}
    }
    return out;
  }
  const SECRET_SHAPES = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{20,}/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    /AccountKey=[A-Za-z0-9+/=]{20,}/i,
    /SharedAccessSignature|[?&]sig=[A-Za-z0-9%+/=]{20,}/i,
    /\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["']?[A-Za-z0-9_\-+/=]{16,}/i,
  ];
  // the board's own keys are looked for in any case, backwards, and with up to two characters slipped between each of a
  // piece's characters, so an uppercased, reversed or padded key is caught too. This is a net, not a wall: the
  // steward's separate Windows account is the wall, and a secret shaped like nothing known still passes
  const esc = c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function secretIn(text) {
    const views = decodedViews(String(text || '')),
      flats = [];
    for (const v of views) {
      const f = flat(v).toLowerCase();
      flats.push(f, [...f].reverse().join(''));
    }
    for (const k of secretsKnown()) {
      const fk = flat(k).toLowerCase();
      if (fk.length < 12) continue;
      for (let i = 0; i + 12 <= fk.length; i += 6) {
        const piece = fk.slice(i, i + 12),
          gapped = new RegExp([...piece].map(esc).join('[a-z0-9]{0,2}'));
        if (flats.some(f => f.includes(piece) || gapped.test(f))) return "part of one of the board's own keys";
      }
    }
    for (const v of views)
      for (const w of [v, [...v].reverse().join('')])
        for (const re of SECRET_SHAPES) if (re.test(w)) return 'something shaped like a secret';
    return null;
  }
  const SAFE_NAME = /^[A-Za-z0-9 ._:+-]{1,40}$/;
  function resolveRecord(rec, r) {
    // verified only for a record the job offered, on its own board, that still exists
    const st = S(),
      s = String(rec || ''),
      m = /^(card|msg|ruling):(.+)$/.exec(s);
    if (!m || !(r.citable || []).includes(s)) return false;
    if (m[1] === 'card') return has(st.cards, m[2]) && st.cards[m[2]].board === r.board;
    if (m[1] === 'ruling') return rulings().byN.has(Number(m[2]));
    return Object.values(st.comments).some(c => c.board === r.board && c.sid === m[2]);
  }
  function flag(board, text, cardId) {
    const id = newId();
    S().advice[id] = {
      id,
      board,
      cardId: cardId || null,
      kind: 'flag',
      oneLine: text,
      text: '',
      t: now(),
      model: 'the board',
    };
    ctx.change('advice', id, 'board', board);
    return id;
  }
  function result(principal, body) {
    const st = S(),
      r = st.stewardRequests[String(body.request || '')];
    if (!r || r.board !== principal.board) return { status: 404, body: { error: 'no such request for this steward' } };
    if (r.state === 'answered') {
      ctx.dispatchLedger?.releaseHolds(r.board);
      return { status: 200, body: { ok: true, duplicate: true, advice: r.adviceId } };
    }
    const late = !body.failed && r.attempts > 0 && ['pending', 'failed'].includes(r.state);
    if (r.state !== 'running' && !late)
      return { status: 409, body: { error: `the request is ${r.state}, not running` } };
    const t = now();
    // an answer or a failure is progress; the watch's alarm reads it
    (st.stewards[r.board] = st.stewards[r.board] || {}).lastAnswer = t;
    if (body.failed) {
      // the flag says what the request says: a withheld detail is withheld everywhere
      const hidden = !!secretIn(body.detail);
      r.lastError = hidden
        ? 'the steward failed (its detail was withheld: it looked like it held a secret)'
        : clip(body.detail, 400);
      r.runningSince = null;
      delete r.job;
      delete r.lease;
      if (r.attempts >= triesOf(r) && PRESS.has(r.kind) && r.by !== 'board') {
        const c = r.cardId ? st.cards[r.cardId] : null;
        ctx.notify(r.board, {
          kind: 'advice',
          title: 'The steward could not answer',
          body: ((c ? c.title + ': ' : '') + (ASKED[r.kind] || r.kind)).slice(0, 200),
          url: c ? '/#card=' + c.id : '/#board=' + r.board,
          tag: 'advice-' + (c ? c.id : r.board),
        });
      }
      if (r.attempts >= triesOf(r)) {
        r.state = 'failed';
        r.failedAt = t;
        flag(
          r.board,
          `The steward could not answer (${r.kind}${r.cardId ? ' on ' + r.cardId : ''}) after ${r.attempts} tries: ` +
            `${
              hidden
                ? 'its detail was withheld, it looked like it held a secret'
                : clip(body.detail, 200) || 'no detail'
            }.`,
          r.cardId,
        );
      } else {
        // a pause that grows with each try, so one outage does not spend all three
        r.state = 'pending';
        r.notBefore = new Date(Date.now() + RETRY_MS * r.attempts).toISOString();
      }
      ctx.dispatchLedger?.releaseHolds(r.board);
      ctx.change('steward', r.id, principal.name, r.board);
      return { status: 200, body: { ok: true, state: r.state, notBefore: r.notBefore } };
    }
    const one = clip(body.oneLine, 300).trim(),
      text = clip(body.text, 8000).trim(),
      claims = Array.isArray(body.claims) ? body.claims.slice(0, 40) : [];
    // every field the steward sent, whatever it is called (missing, pack, model, choice, records...)
    const leak = secretIn(JSON.stringify(body));
    if (leak) {
      r.state = 'failed';
      r.failedAt = t;
      r.lastError = 'withheld: ' + leak;
      flag(r.board, `The steward's answer was withheld: it held ${leak}. Nothing of it was posted.`, r.cardId);
      ctx.dispatchLedger?.releaseHolds(r.board);
      ctx.change('steward', r.id, principal.name, r.board);
      return { status: 422, body: { error: 'withheld: ' + leak } };
    }
    r.state = 'answered';
    r.answeredAt = t;
    r.runningSince = null;
    delete r.job;
    delete r.lease;
    ctx.dispatchLedger?.releaseHolds(r.board);
    // a check with nothing to say says nothing (design section 1)
    const silent = !!body.silent && (r.kind === 'ask-check' || r.kind === 'review');
    const card = r.cardId ? st.cards[r.cardId] : null,
      d = decisionOf(card, r.askId);
    if (r.kind === 'ask-check' && body.irreversible && d) {
      d.irreversible = true;
      if (d.heldPing && !d.heldReleased) {
        d.heldReleased = t;
        ctx.notify(r.board, {
          kind: 'ask',
          title: 'Needs you: ' + ((st.boards[r.board] || {}).name || r.board),
          body: (card.title + ': ' + d.ask).slice(0, 200),
          url: '/#card=' + card.id,
          tag: card.id,
        });
      }
    }
    if (silent) {
      ctx.change('steward', r.id, principal.name, r.board);
      return { status: 200, body: { ok: true, silent: true } };
    }
    const cites = (Array.isArray(body.cites) ? body.cites : [])
      .map(Number)
      .filter(n => Number.isInteger(n))
      .slice(0, 12);
    const unknown = cites.filter(n => !rulings().byN.has(n));
    const a = {
      id: newId(),
      board: r.board,
      cardId: r.cardId || null,
      askId: r.askId || null,
      requestId: r.id,
      kind: r.kind === 'ask-check' ? 'check' : r.kind,
      t,
      oneLine: one || clip(text, 160),
      text,
      question: r.kind === 'ask' ? clip(r.text, 2000) : undefined,
      line: r.line || undefined,
      cites: cites.filter(n => rulings().byN.has(n)),
      unknownCites: unknown.length ? unknown : undefined,
      claims: claims
        .map(c => ({ text: clip(c && c.text, 600), record: resolveRecord(c && c.record, r) ? String(c.record) : null }))
        .filter(c => c.text),
      model: SAFE_NAME.test(String(body.model || '')) ? String(body.model) : 'Codex',
      brief: /^v[0-9?]{1,4}$/.test(String(body.brief || '')) ? body.brief : undefined,
      pack:
        body.pack && typeof body.pack === 'object'
          ? Object.fromEntries(
              Object.entries(body.pack)
                .slice(0, 20)
                .filter(([k, v]) => /^[A-Za-z0-9._-]{1,60}$/.test(k) && /^[0-9a-f]{6,16}$/.test(String(v))),
            )
          : undefined,
      missing: Array.isArray(body.missing) ? body.missing.slice(0, 10).map(x => clip(x, 120)) : undefined,
      late: !!(d && d.resolvedAt) || undefined,
    };
    if (r.kind === 'second-opinion' || (r.kind === 'ask-check' && body.choice)) {
      // the board compares; the steward never saw the operator's recommendation
      a.choice = clip(body.choice, 300) || undefined;
      const letter = s => {
        const x = /^\s*\(?([A-F])\b/.exec(String(s || ''));
        return x ? x[1] : null;
      };
      // compared only when both name an option; otherwise Owner reads the steward's choice as it stands
      if (d && d.recommendation && letter(a.choice) && letter(d.recommendation))
        a.agrees = letter(a.choice) === letter(d.recommendation);
    }
    if (r.kind === 'explain') {
      const att = body.diagram ? st.attachments[String(body.diagram)] : null;
      if (!att || !att.steward || att.board !== r.board || att.type !== 'image/svg+xml') {
        r.state = 'running';
        return (
          result(principal, { request: r.id, failed: true, detail: 'the explainer came without its diagram' }) && {
            status: 422,
            body: { error: 'the explainer needs its SVG diagram, uploaded first' },
          }
        );
      }
      a.diagram = att.id;
      a.skill = SAFE_NAME.test(String(body.skill || '')) ? String(body.skill) : undefined;
    }
    if (r.kind === 'review') {
      a.category = ['duplicate', 'conflict', 'stale', 'scope', 'bloat', 'secret'].includes(body.category)
        ? body.category
        : 'other';
      a.forDigest = !(a.category === 'conflict' || a.category === 'secret');
    }
    if (r.kind === 'digest') for (const id of r.reviews || []) if (st.advice[id]) st.advice[id].digestedIn = a.id;
    if (r.kind === 'state' && !r.cardId) {
      // the overview's parts; a card it names is one the job offered, on this board, or none
      const ov = body.overview && typeof body.overview === 'object' ? body.overview : {};
      const cardOf = x => {
        const s = String(x || '').replace(/^card:/, '');
        return s && (r.citable || []).includes('card:' + s) && has(st.cards, s) && st.cards[s].board === r.board
          ? s
          : null;
      };
      const items = (xs, n, len) =>
        (Array.isArray(xs) ? xs : [])
          .slice(0, n)
          .map(x => ({ text: clip(x && x.text, len).trim(), card: cardOf(x && x.card) }))
          .filter(x => x.text);
      const o = {
        stands: clip(ov.stands, 3000).trim(),
        struggles: items(ov.struggles, 8, 500),
        advice: items(ov.advice, 6, 700),
        since: clip(ov.since, 2000).trim(),
      };
      if (o.stands || o.struggles.length || o.advice.length) {
        a.overview = o;
        if (!a.oneLine) a.oneLine = clip(o.stands, 160);
      }
      a.auto = r.by === 'board' || undefined;
      a.since = r.since || undefined;
    }
    st.advice[a.id] = a;
    r.adviceId = a.id;
    // what he asked for has come: one ping to his devices; the board's own checks, reviews and digests never ping
    if (PRESS.has(r.kind) && r.by !== 'board')
      ctx.notify(r.board, {
        kind: 'advice',
        title: 'Steward answered: ' + (ASKED[r.kind] || r.kind),
        body: ((card ? card.title + ': ' : '') + a.oneLine).slice(0, 200),
        url: card ? '/#card=' + card.id : '/#board=' + r.board,
        tag: 'advice-' + (card ? card.id : r.board),
      });
    ctx.change('advice', a.id, principal.name, r.board);
    ctx.change('steward', r.id, principal.name, r.board);
    return { status: 200, body: { ok: true, advice: a.id } };
  }

  return { secretIn, SAFE_NAME, flag, result };
};
