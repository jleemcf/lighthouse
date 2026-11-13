'use strict';
// Jev (TypeSafe's System One model) judges each operator line as it lands: is an untagged note planning said aloud,
// does an ACTION ask him anything, is a card line about its card, is a new card the same task as an open one, does a
// busy card hold more than one piece of work. Asynchronous after the line is filed, never blocking a post; any error
// leaves the line unjudged. The key comes from the machine (cfg.typesafeEnvFile, a file holding TYPESAFE_API_KEY=...,
// or the environment), never from the store or the page. The conduct report counts the verdicts.
const fs = require('fs'),
  http = require('http'),
  https = require('https');

module.exports = function makeJev(ctx) {
  const { cfg, store, now, slugOf } = ctx;
  const enabled = cfg.jevEnabled !== false;
  const judgeActive = () => enabled && !!typesafeKey();
  const JEV_URL = process.env.LH_JEV_URL || 'https://api.typesafe.ai/v1/systemone';
  let jevKeyCache = { t: 0, key: '' };
  function typesafeKey() {
    if (Date.now() - jevKeyCache.t < 60000) return jevKeyCache.key;
    let key = (process.env.TYPESAFE_API_KEY || '').trim();
    if (!key && cfg.typesafeEnvFile) {
      try {
        const m = /^\s*TYPESAFE_API_KEY\s*=\s*"?([^"\r\n]+)"?/m.exec(fs.readFileSync(cfg.typesafeEnvFile, 'utf8'));
        if (m) key = m[1].trim();
      } catch (e) {}
    }
    jevKeyCache = { t: Date.now(), key };
    return key;
  }
  function jev(state, questions) {
    const key = typesafeKey();
    if (!key) return Promise.reject(new Error('no key'));
    const body = JSON.stringify({ state, model: 'jev-latest', questions });
    return new Promise((resolve, reject) => {
      let u;
      try {
        u = new URL(JEV_URL);
      } catch (e) {
        return reject(new Error('bad url'));
      }
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request(
        u,
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + key,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 4000,
        },
        res => {
          let d = '';
          res.setEncoding('utf8');
          res.on('data', c => (d += c));
          res.on('end', () => {
            if (res.statusCode !== 200) return reject(new Error('Jev answered ' + res.statusCode));
            try {
              resolve(JSON.parse(d).answers || {});
            } catch (e) {
              reject(new Error('unreadable'));
            }
          });
          res.on('error', reject);
          res.on('aborted', () => reject(new Error('response aborted')));
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end(body);
    });
  }
  const noul = v => (v && typeof v.noul === 'number' ? v.noul : null);
  function judgeComment(rid) {
    if (ctx.inTransaction?.()) return ctx.afterCommit(() => judgeComment(rid));
    const c = store.comments[rid];
    // a copy delivered to where Owner wrote is about another card by design: never judged against this one
    if (!enabled || !c || c.via !== 'api' || c.kind || c.copy || !typesafeKey()) return;
    const card = c.cardId ? store.cards[c.cardId] : null,
      text = String(c.text || '').slice(0, 1500),
      questions = {},
      state = { text };
    if (c.untagged)
      questions.planning = {
        type: 'noul',
        instructions:
          'Is `text` a private planning note, a list of what to fetch or check next, or narration about what the ' +
          'writer is about to do, rather than something said to a reader?',
      };
    if ((c.label || '') === 'ACTION')
      questions.asking = {
        type: 'noul',
        instructions:
          'Does `text` ask the reader to decide, approve, choose or do something, as opposed to telling the reader a ' +
          'status or explaining a situation?',
      };
    if (card) {
      state.task = {
        title: String(card.title || ''),
        description: String(card.context || card.description || '').slice(0, 600),
      };
      questions.on_task = {
        type: 'noul',
        instructions: 'Is `text` about the task described in `task`, as opposed to some other matter?',
      };
    }
    if (!Object.keys(questions).length) return;
    jev(state, questions)
      .then(a => {
        c.judge = { t: now(), planning: noul(a.planning), asking: noul(a.asking), on_task: noul(a.on_task) };
      })
      .catch(e => {
        c.judge = { t: now(), error: String(e.message || e) };
      });
  }
  // what "the same task" means to Jev: two cards that share only a word are not the same task, and the narrower pieces
  // split off a broad card are not the card they came from
  const SAME_TASK =
    'Is `new_task` the same piece of work as one of the tasks in the options, or is it a new one? ' +
    'The same piece of work means the same goal, so that finishing one would finish the other. ' +
    'Sharing a topic, a client or a word (statements, readings, a release) is not enough, ' +
    'and a narrower piece split off a broad task is a new task.';
  function judgeCard(cid) {
    if (ctx.inTransaction?.()) return ctx.afterCommit(() => judgeCard(cid));
    const card = store.cards[cid];
    if (!enabled || !card || !typesafeKey()) return;
    // the watch keeps one card per watched board by its brief; their titles differ only by the board's name
    if (/^watch-/.test(slugOf(card.board, cid))) return;
    const others = Object.values(store.cards)
      .filter(
        x => x.board === card.board && x.id !== cid && x.status !== 'done' && !/^watch-/.test(slugOf(x.board, x.id)),
      )
      .slice(0, 30);
    if (!others.length) return;
    const criteria = { none: 'a task not already on the list' };
    for (const o of others)
      criteria[o.id] =
        String(o.title || o.id).slice(0, 120) + (o.context ? ': ' + String(o.context).slice(0, 200) : '');
    jev(
      { new_task: { title: String(card.title || ''), description: String(card.context || '').slice(0, 600) } },
      { same_as: { type: 'choice', instructions: SAME_TASK, criteria } },
    )
      .then(a => {
        const v = a.same_as || {};
        card.judge = {
          t: now(),
          sameAs: v.choice && v.choice !== 'none' ? v.choice : null,
          confidence: typeof v.confidence === 'number' ? v.confidence : null,
        };
      })
      .catch(e => {
        card.judge = { t: now(), error: String(e.message || e) };
      });
  }
  // a busy card is a catch-all only when its posts cover more than one piece of work: one narrow task with many posts
  // is not. Jev reads the card's posts in the window once, and again only when an hour has passed and new posts have
  // come; a failed reading is tried again after ten minutes
  const SPREAD =
    'Do the posts in `posts` work on more than one separate piece of work, as opposed to the steps, findings and ' +
    'status of the one task described in `task`? ' +
    'Separate pieces of work have separate goals, so that finishing one would not finish the other.';
  const spreadPending = new Set();
  function judgeSpread(card, entries) {
    if (!enabled || !entries.length || spreadPending.has(card.id) || !typesafeKey()) return;
    const sp = card.spread,
      last = entries[entries.length - 1].t || '',
      ago = sp ? Date.now() - Date.parse(sp.t) : Infinity;
    if (sp && (sp.error ? ago < 600000 : ago < 3600000 || (sp.upTo || '') >= last)) return;
    spreadPending.add(card.id);
    const posts = entries.slice(-20).map(e => (e.kind ? e.kind + ': ' : '') + String(e.text || '').slice(0, 200));
    jev(
      { task: { title: String(card.title || ''), description: String(card.context || '').slice(0, 600) }, posts },
      { many: { type: 'noul', instructions: SPREAD } },
    )
      .then(a => {
        card.spread = { t: now(), upTo: last, posts: posts.length, many: noul(a.many) };
      })
      .catch(e => {
        card.spread = { t: now(), upTo: last, error: String(e.message || e) };
      })
      .finally(() => spreadPending.delete(card.id));
  }

  return { typesafeKey, judgeActive, judgeComment, judgeCard, judgeSpread, spreadPending };
};
