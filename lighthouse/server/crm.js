'use strict';
const lifecycle = require('./card-transitions');
const prompts = require('./prompt-transitions');
const { active } = require('./shift-presence');
// The CRM question lane (the design is in CRM-QUESTION-LANE.md). The CRM keeps the questions and this server fetches
// them, every pollSec, with one key the CRM issued for Lighthouse (cfg.crm = { base, keyFile, board, pollSec }; the
// key file is machine-local and never in the repository). Each question becomes a card crm-q-<id> on the lane's board
// with a message of kind 'staff' that the operator's board watch prints as "Staff (name, role) via CRM #id, scope:
// ...". The CRM is told "received" at once (and, off shift, that the answer comes in working hours), "working" at the
// operator's first line on the card, and gets the operator's REPLY as the answer, with a file when the line names
// one. An ACTION on the card is a change request: the CRM hears "needs_owner". Every ack and reply carries an id made
// once and reused on retry, so a timeout never doubles an answer. What a line on the card does to the lane is in
// events.js.
const fs = require('fs'),
  path = require('path'),
  http = require('http'),
  https = require('https');
const { questionState } = require('./crm-state');

module.exports = function makeCrm(ctx) {
  const { cfg, CONFIG_PATH, store, ATTACH, IMAGE_EXT, now, newId, change, save, pushLog, pushActivity, slugOf } = ctx;
  const { firstClause, etClock, boardNote } = ctx;
  // files: false until the CRM accepts a file on a reply
  const CRM =
    cfg.crm && cfg.crm.base
      ? Object.assign({ pollSec: 60, files: false }, cfg.crm, {
          keyFile: path.resolve(path.dirname(CONFIG_PATH), String(cfg.crm.keyFile || 'crm.key')),
        })
      : null;
  function crmKey() {
    if (process.env.LH_CRM_KEY) return process.env.LH_CRM_KEY.trim();
    try {
      const line =
        fs
          .readFileSync(CRM.keyFile, 'utf8')
          .split(/\r?\n/)
          .map(x => x.trim())
          .find(x => x && !x.startsWith('#')) || '';
      return line.includes('=')
        ? line
            .slice(line.indexOf('=') + 1)
            .trim()
            .replace(/^"|"$/g, '')
        : line;
    } catch (e) {
      return '';
    }
  }
  function crmCall(method, p, body) {
    return new Promise((resolve, reject) => {
      let u;
      try {
        u = new URL(p, CRM.base);
      } catch (e) {
        return reject(e);
      }
      const mod = u.protocol === 'http:' ? http : https,
        data = body ? Buffer.from(JSON.stringify(require('./compatibility').codec(cfg).write(body))) : null;
      const req = mod.request(
        u,
        {
          method,
          headers: Object.assign(
            { Authorization: 'Bearer ' + crmKey(), Accept: 'application/json' },
            data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
          ),
        },
        res => {
          let d = '';
          res.setEncoding('utf8');
          res.on('data', c => (d += c));
          res.on('end', () => {
            let j = null;
            try {
              j = d ? JSON.parse(d) : {};
            } catch (e) {
              j = { raw: d.slice(0, 200) };
            }
            resolve({ status: res.statusCode, body: j });
          });
          res.on('error', reject);
          res.on('aborted', () => reject(new Error('response aborted')));
        },
      );
      req.on('error', reject);
      req.setTimeout(20000, () => req.destroy(new Error('timeout')));
      if (data) req.write(data);
      req.end();
    });
  }
  const crmSlug = id =>
    'crm-q-' +
    String(id)
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .slice(0, 60);
  function crmDeliver(q) {
    const board = CRM.board,
      b = store.boards[board];
    if (!b || !q || q.id == null || store.crm.delivered[String(q.id)]) return;
    const t = now(),
      asker = q.asker || {},
      scope = (q.scope && q.scope.summary) || (typeof q.scope === 'string' ? q.scope : '') || 'as the CRM allows',
      text = String(q.text || '').slice(0, 8000);
    const cid = board + '-' + crmSlug(q.id),
      staff = {
        id: String(q.id),
        name: String(asker.name || 'unknown').slice(0, 80),
        role: String(asker.role || 'staff').slice(0, 80),
        scope: String(scope).slice(0, 600),
        askedAt: q.askedAt || t,
        state: 'asked',
      };
    store.cards[cid] = lifecycle.open({
      ...store.cards[cid],
      id: cid,
      board,
      title: firstClause(text) || 'CRM question #' + staff.id,
      status: 'queued',
      source: 'crm',
      createdAt: t,
      updatedAt: t,
      updatedBy: 'crm',
      decisions: [],
      log: [],
      context: `Staff question from ${staff.name} (${staff.role}) via CRM #${
        staff.id
      }, asked ${etClock(staff.askedAt)}. Scope stated by the CRM: ${staff.scope}\n\n${text}`,
      crm: staff,
    }).card;
    const rid = newId();
    store.comments[rid] = {
      id: rid,
      board,
      cardId: cid,
      cardTitle: store.cards[cid].title,
      t,
      text,
      by: 'staff:' + staff.name,
      via: 'crm',
      kind: 'staff',
      handled: false,
      replyTo: null,
      attachments: [],
      staff,
    };
    pushLog(store.cards[cid], {
      t,
      kind: 'FYI',
      who: 'crm',
      text: `Question from ${staff.name} (${staff.role}) via CRM #${staff.id}`,
    });
    pushActivity(b, `CRM question #${staff.id} from ${staff.name}: ${text.slice(0, 120)}`, t);
    store.crm.delivered[String(q.id)] = cid;
    change('card', cid, 'crm', board);
    change('comment', rid, 'crm', board);
    const on = active(b, cfg.boards?.[board]?.protocol);
    crmSend('ack', staff.id, cid, {
      state: 'received',
      note: on ? 'with the operator' : 'answered during working hours',
    });
  }
  // id is the one id field, since the CRM accepts only the fields it lists; the board keeps its own retry id on the
  // outbox item
  function crmSend(kind, qid, cid, body, options = {}) {
    // one id per act, reused on every retry: the CRM's ingestion is idempotent by it
    const id = newId();
    const card = store.cards[cid];
    const item = { id, kind, qid, cid, body: Object.assign({}, body, { id }), t: now(), attempts: 0 };
    if (kind === 'reply' && card?.crm) {
      item.closeOnDelivery = options.closeOnDelivery !== false && body.kind !== 'needs_owner';
      card.crm.state = 'sending';
      card.crm.deliveryId = id;
      delete card.crm.failure;
      lifecycle.reopen(card);
    }
    store.crm.outbox.push(item);
    save();
    setImmediate(() => crmFlush().catch(e => console.log('crm: ' + e.message)));
  }
  let crmFlushing = false;
  function replyAccepted(card, item) {
    const at = now();
    card.updatedAt = at;
    card.updatedBy = 'crm';
    questionState(card, store);
    if (card.crm?.deliveryId === item.id) {
      card.crm.state = item.body.kind === 'needs_owner' ? 'working' : 'done';
      card.crm.deliveredAt = at;
      delete card.crm.failure;
      if (item.body.kind !== 'needs_owner' && item.closeOnDelivery !== false) {
        const closed = prompts.close(store, card, at);
        if (closed.ok)
          pushLog(card, {
            ...closed.completion,
            kind: 'FYI',
            who: 'crm',
            text: 'Finished: the staff question is answered.',
          });
      }
    }
    pushLog(card, { t: at, kind: 'FYI', who: 'crm', text: (item.body.kind || 'answer') + ' sent to the CRM' });
    change('card', card.id, 'crm', card.board);
  }
  function replyFailed(card, item, status, retrying) {
    questionState(card, store);
    if (card.crm?.deliveryId !== item.id) return;
    const at = now();
    card.updatedAt = at;
    card.updatedBy = 'crm';
    card.crm.state = 'failed';
    card.crm.failure = { status, attempts: item.attempts, retrying, at };
    lifecycle.reopen(card);
    if (!item.failureReported || !retrying) {
      const next = retrying
        ? 'Retrying automatically. No action is needed; another note will follow if retries stop.'
        : 'Retries stopped; send the answer again once the cause is known.';
      const text =
        'The CRM has not seen your answer on ' +
        slugOf(card.board, card.id) +
        ' (delivery ' +
        (status || 'unreachable') +
        '). ' +
        next;
      pushLog(card, { t: at, kind: 'FYI', who: 'crm', text });
      boardNote(
        card.board,
        item.body.by || 'operator',
        retrying ? 'crm-delivery' : 'crm-refused',
        text +
          (retrying
            ? ''
            : ' Use ' +
              (((cfg.boards || {})[card.board] || {}).protocol === 'tools'
                ? 'board_reply(follow_up: true).'
                : 'a REPLY.')),
        null,
        at,
      );
      item.failureReported = true;
    }
    change('card', card.id, 'crm', card.board);
  }
  async function crmFlush() {
    if (!CRM || crmFlushing || cfg.boards?.[CRM.board]?.lifecycle === 'archived') return;
    crmFlushing = true;
    try {
      for (const item of store.crm.outbox.slice()) {
        const body = Object.assign({}, item.body);
        // an SVG stays on the board: the CRM is another system's page, and what it does with an SVG is not ours to know
        if (item.attachment && (store.attachments[item.attachment] || {}).type === 'image/svg+xml') {
          console.log('crm: the SVG for #' + item.qid + ' stays on the board');
          item.attachment = null;
          const c0 = store.cards[item.cid];
          if (c0)
            pushLog(c0, {
              t: now(),
              kind: 'FYI',
              who: 'board',
              text: 'The CRM gets this answer without its SVG: an SVG stays on the board. Send a PNG for the CRM.',
            });
        }
        if (item.attachment) {
          const a = store.attachments[item.attachment];
          try {
            if (a)
              body.file = {
                name: a.name,
                type: a.type,
                base64: fs.readFileSync(path.join(ATTACH, a.id + '.' + IMAGE_EXT[a.type])).toString('base64'),
              };
          } catch (e) {
            console.log('crm: file for #' + item.qid + ' not read: ' + e.message);
          }
        }
        let r;
        try {
          r = await crmCall('POST', `/api/operator-questions/${encodeURIComponent(item.qid)}/${item.kind}`, body);
        } catch (e) {
          r = { status: 0, body: { error: e.message } };
        }
        const card = store.cards[item.cid];
        questionState(card, store);
        if ((r.status >= 200 && r.status < 300) || r.status === 409) {
          store.crm.outbox = store.crm.outbox.filter(x => x.id !== item.id);
          if (card && item.kind === 'reply') {
            replyAccepted(card, item);
          }
        } else if (r.status >= 400 && r.status < 500) {
          item.attempts++;
          item.lastError = `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`;
          if (item.attempts >= 3) {
            store.crm.outbox = store.crm.outbox.filter(x => x.id !== item.id);
            console.log(
              `crm: ${item.kind} for #${item.qid} refused ${item.lastError}; dropped after ${item.attempts} tries`,
            );
            if (card && item.kind !== 'reply') {
              pushLog(card, {
                t: now(),
                kind: 'FYI',
                who: 'crm',
                text: `the CRM refused the ${item.kind} (${r.status}); it did not reach the asker`,
              });
            }
          }
          if (card && item.kind === 'reply') replyFailed(card, item, r.status, item.attempts < 3);
        } else {
          item.attempts++;
          item.lastError = `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`;
          if (item.attempts >= 60) {
            store.crm.outbox = store.crm.outbox.filter(x => x.id !== item.id);
            console.log(`crm: ${item.kind} for #${item.qid} given up after ${item.attempts} tries: ${item.lastError}`);
          }
          if (card && item.kind === 'reply') replyFailed(card, item, r.status, item.attempts < 60);
        }
        save();
      }
    } finally {
      crmFlushing = false;
    }
  }
  async function crmPoll() {
    ctx.registry?.refresh();
    if (!CRM || !store.boards[CRM.board] || cfg.boards?.[CRM.board]?.lifecycle === 'archived') return;
    if (!crmKey()) {
      if (!store.crm.fault) {
        store.crm.fault = 'no CRM key on this machine';
        console.log('crm: ' + store.crm.fault);
      }
      return;
    }
    // the first fetch carries no since
    let r;
    try {
      r = await crmCall(
        'GET',
        '/api/operator-questions' + (store.crm.cursor ? '?since=' + encodeURIComponent(store.crm.cursor) : ''),
      );
    } catch (e) {
      r = { status: 0, body: { error: e.message } };
    }
    if (r.status !== 200) {
      const f = `fetch answered ${r.status}${r.body && r.body.error ? ' ' + r.body.error : ''}`;
      if (store.crm.fault !== f) console.log('crm: ' + f);
      store.crm.fault = f;
      store.crm.faultSince = store.crm.faultSince || now();
      save();
      return;
    }
    store.crm.fault = null;
    store.crm.faultSince = null;
    for (const q of Array.isArray(r.body.questions) ? r.body.questions : [])
      try {
        crmDeliver(q);
      } catch (e) {
        console.log('crm: question ' + (q && q.id) + ': ' + e.message);
      }
    if (r.body.cursor != null) store.crm.cursor = String(r.body.cursor);
    store.crm.lastPollAt = now();
    save();
    await crmFlush();
  }
  if (CRM) {
    setTimeout(() => crmPoll().catch(e => console.log('crm: ' + e.message)), 2000);
    setInterval(() => crmPoll().catch(e => console.log('crm: ' + e.message)), Math.max(1, CRM.pollSec) * 1000).unref();
    console.log(`crm question lane: ${CRM.base} -> board ${CRM.board}, every ${CRM.pollSec} s`);
  }

  return { CRM, crmKey, crmSend };
};
