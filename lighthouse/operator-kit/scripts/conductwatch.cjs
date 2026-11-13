// The watch operator's instrument: reads each watched board's conduct report from the server and prints one line
// when a signal crosses its line or changes, in the same shape as every other instrument line, so the watch operator
// wakes only when there is something to look at. Read-only; it never writes the board.
//   node conductwatch.cjs --server http://host:7700 --boards signal,sample [--token T | LH_TOKEN] [--interval 60]
//                         [--minutes 60]
// Prints:  CONDUCT <board> | <signal>: <count> in the last <n> min (<the brief's rule>) · e.g. "<first example>"
//          CONDUCT <board> | notice unanswered <n> min: "<text>"      a NOTICE the operator has not answered with OPS
//          CONDUCT <board> | gate silent <n> min in mode <m> / gate fail-open since <t> / outbox telemetry <n> min old
//                            / shift on, no line for <n> min
//          CONDUCT <board> | quiet again: <signal>                     a signal that had fired is back to zero
//          CONDUCT WATCH | board server unreachable / reachable again
'use strict';
{
  const fs0 = require('fs'),
    path0 = require('path');
  const PIDF = path0.join(__dirname, path0.basename(__filename) + '.pid');
  try {
    const old = parseInt(fs0.readFileSync(PIDF, 'utf8'), 10);
    if (old && old !== process.pid) {
      try {
        process.kill(old, 0);
        process.kill(old);
        fs0.appendFileSync(
          path0.join(__dirname, 'watcher-starts.jsonl'),
          JSON.stringify({
            t: new Date().toISOString(),
            line: path0.basename(__filename) + ': replaced a leftover copy (pid ' + old + ')',
          }) + '\n',
        );
      } catch (e) {}
    }
  } catch (e) {}
  try {
    fs0.writeFileSync(PIDF, String(process.pid));
  } catch (e) {}
  const bye = () => {
    try {
      if (fs0.readFileSync(PIDF, 'utf8').trim() === String(process.pid)) fs0.unlinkSync(PIDF);
    } catch (e) {}
  };
  process.on('exit', bye);
  process.on('SIGINT', () => {
    bye();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    bye();
    process.exit(0);
  });
}
const http = require('http'),
  https = require('https'),
  fs = require('fs'),
  path = require('path');
const args = process.argv.slice(2),
  argv = {};
for (let i = 0; i < args.length; i++)
  if (args[i].startsWith('--'))
    argv[args[i].slice(2)] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
const SERVER = argv.server,
  BOARDS = String(argv.boards || '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s && s !== 'none'),
  TOKEN = argv.token || process.env.LH_TOKEN || '';
const INTERVAL = (Number(argv.interval) || 60) * 1000,
  MINUTES = Number(argv.minutes) || 60,
  STATEF = path.join(__dirname, 'conductwatch-state.json');
if (!SERVER || !BOARDS.length) {
  console.error('usage: conductwatch.cjs --server URL --boards a,b [--token T]');
  process.exit(2);
}
const output = require('./watch-output.cjs')(__dirname, 'conductwatch');
const lease = require('./watch-lease.cjs');
const say = s => output(s.replace(/\s+/g, ' ').slice(0, 2000));
let state = {};
try {
  state = JSON.parse(fs.readFileSync(STATEF, 'utf8'));
} catch (e) {
  state = {};
}
const save = () => {
  lease.check(true);
  try {
    fs.writeFileSync(STATEF, JSON.stringify(state));
  } catch (e) {}
};
function get(p) {
  lease.check(true);
  const u = new URL(p, SERVER),
    mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const r = mod.get(u, { headers: { Authorization: 'Bearer ' + TOKEN }, timeout: 15000 }, res => {
      const chunks = [];
      res.on('error', reject);
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch (e) {
          reject(e);
        }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => r.destroy(new Error('timeout')));
  });
}
// the rule each signal breaks, in the brief's words, so the notice can quote it
const RULES = {
  untagged: 'nothing goes before the first timed line; plan in your thinking',
  general: 'only SHIFT and OPS say general',
  saidInChat:
    'a tool board: once your tools have said it, end the turn with only (quiet); anything more you write in the ' +
    'chat reaches the board a second time, as a note. When Owner types in your chat, answer him there and ' +
    'board_reply the same words; what he asked to have in the chat (a file, an artifact, a chart) opens with ' +
    '"For you:". The nudge from the app in a long turn ("The user has not heard from you in a while") is ' +
    'answered with a board_post status on the card in hand, never in the chat',
  unlabelled: 'every line carries a label',
  misfiled: 'TASK_CREATED names the task it opens, never an existing card',
  slugTitled: 'a card opened by a stray line still carries its slug as a title; title= it on any later line',
  waitingNoAsk: 'local policy',
  catchAll:
    "one card per task; a card taking a third of the shift's work news, which Jev read as more than one piece " +
    'of work, is holding other tasks',
  afterDone: 'one card per task; new work after a card said its task was finished belongs on a card of its own',
  flood: "lines far above the operator's norm",
  planning: 'Jev read this as a planning note said aloud',
  falseAsks: 'Jev read this ACTION as not asking Owner anything',
  offTask: 'Jev read this line as not about the card it names',
  duplicates: 'Jev read this new card as the same task as an open one',
};
let blind = false;
async function poll() {
  lease.check(true);
  let anyOk = false;
  for (const board of BOARDS) {
    let r;
    try {
      r = await get(`/api/boards/${encodeURIComponent(board)}/conduct?minutes=${MINUTES}`);
    } catch (e) {
      continue;
    }
    if (r.status !== 200) {
      say(`CONDUCT ${board} | the conduct report answered ${r.status}`);
      continue;
    }
    anyOk = true;
    const c = r.body,
      sg = c.signals || {},
      ex = c.examples || {},
      prev = state[board] || {};
    const fired = {};
    for (const k of Object.keys(RULES)) {
      const n = sg[k] || 0;
      fired[k] = n;
      if (n && !(prev[k] > 0)) {
        const e = (ex[k] || [])[0];
        say(
          `CONDUCT ${board} | ${k}: ${n} in the last ${MINUTES} min (${RULES[k]})` +
            `${e ? ` · e.g. "${String(e.text || '').slice(0, 120)}"` : ''}`,
        );
      } else if (!n && prev[k] > 0) say(`CONDUCT ${board} | quiet again: ${k}`);
    }
    const ins = c.instruments || {},
      g = ins.gate,
      o = ins.outbox;
    const now = {
      gateSilent: !!(g && g.silent),
      gateFailOpen: !!(g && g.failOpen),
      outboxSilent: !!(o && o.silent),
      silence: (sg.silenceMin || 0) > 0,
      compacted: !!sg.compacted,
    };
    if (now.gateSilent && !prev.gateSilent)
      say(
        `CONDUCT ${board} | gate silent ${g.heartbeatAgeMin} min in mode ${g.mode}: ` +
          'if the watchers are printing, nothing reaches the operator',
      );
    if (now.gateFailOpen && !prev.gateFailOpen)
      say(`CONDUCT ${board} | gate fail-open since ${g.failOpenSince}: every line wakes, Jev is not judging there`);
    if (now.outboxSilent && !prev.outboxSilent)
      say(
        `CONDUCT ${board} | outbox telemetry ${o.telemetryAgeMin} min old while the shift is on: ` +
          'the collector may be dead; nothing the operator says reaches the board',
      );
    if (now.silence && !prev.silence) say(`CONDUCT ${board} | shift on, no line for ${sg.silenceMin} min`);
    if (now.compacted && !prev.compacted)
      say(
        `CONDUCT ${board} | the operator's session was compacted at ${ins.compactedAt}: ` +
          'the next lines are where drift begins; read them',
      );
    for (const k of ['gateSilent', 'gateFailOpen', 'outboxSilent', 'silence'])
      if (!now[k] && prev[k]) say(`CONDUCT ${board} | quiet again: ${k}`);
    // the board's steward: off during the shift, ready jobs that nobody takes, failures, a withheld answer. It reads
    // progress, not the queue's age; nothing for a steward never installed; when the outbox is silent too the machine
    // itself is likely off, which is one fault (the outbox's), not two
    const sw = c.steward;
    if (sw && sw.installed) {
      const codes = {
        'board-unreachable': 'it cannot reach the board',
        'claim-refused': 'the board refused its claim',
        'result-refused': 'the board refused an answer',
        'job-failed': 'a job failed',
        'codex-unusable': 'Codex would not show its options',
        other: 'an unknown error',
      };
      const why = sw.lastError ? ' (' + (codes[sw.lastError] || 'an unknown error') + ')' : '';
      const s = {
        stewardOff: (sw.offMin || 0) >= 5 && !now.outboxSilent,
        stewardStalled: (sw.stalledMin || 0) >= 45 && !now.outboxSilent,
      };
      if (s.stewardOff && !prev.stewardOff)
        say(
          `CONDUCT ${board} | the steward has been off ${sw.offMin} min while the shift is on${why}: ` +
            'its operator runs bash shift.sh steward restart',
        );
      if (s.stewardStalled && !prev.stewardStalled)
        say(
          `CONDUCT ${board} | the steward has taken no job and given no answer for ${sw.stalledMin} min ` +
            `while ${sw.ready} wait${why}: its operator looks with bash shift.sh steward status, ` +
            'and restarts it only if no job is running',
        );
      if ((sw.failed24h || 0) > (prev.stewardFailed || 0))
        say(
          `CONDUCT ${board} | the steward failed a job (${sw.failed24h} in 24 h): Owner has been shown it on the board`,
        );
      if ((sw.withheld24h || 0) > (prev.stewardWithheld || 0))
        say(
          `CONDUCT ${board} | the board withheld a steward answer that looked like it held a secret ` +
            `(${sw.withheld24h} in 24 h): Owner has been shown it on the board`,
        );
      for (const k of ['stewardOff', 'stewardStalled'])
        if (!s[k] && prev[k]) say(`CONDUCT ${board} | quiet again: ${k}`);
      Object.assign(now, s, { stewardFailed: sw.failed24h || 0, stewardWithheld: sw.withheld24h || 0 });
    }
    const openN = (c.notices || {}).open || [];
    const nowNotice = openN.filter(n => (n.ageMin || 0) >= 30).map(n => n.id);
    for (const n of openN)
      if ((n.ageMin || 0) >= 30 && !(prev.noticed || []).includes(n.id))
        say(
          `CONDUCT ${board} | notice unanswered ${n.ageMin} min: "${String(n.text || '').slice(0, 120)}" ` +
            '(an unanswered notice is itself a finding)',
        );
    state[board] = Object.assign({}, fired, now, { noticed: nowNotice, at: new Date().toISOString() });
    save();
  }
  if (!anyOk && !blind) {
    say('CONDUCT WATCH | board server unreachable; blind to every board');
    blind = true;
  } else if (anyOk && blind) {
    say('CONDUCT WATCH | board server reachable again');
    blind = false;
  }
}
output.replay();
async function next() {
  await poll();
  setTimeout(next, INTERVAL);
}
next();
