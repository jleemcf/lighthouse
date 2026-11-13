// The wake gate.
// Sits between an operator's watchers and its Monitor: every line a watcher prints passes through here; what comes out
// wakes the operator. Design: lighthouse/JEV-GATE-DESIGN.md. Rules in code decide first; Jev (TypeSafe's System One
// model) judges only what the rules leave; nothing is ever dropped without being logged, and nothing held is ever lost.
//
//   <watcher> | node gate.cjs [--source fmwatch|sweep|mixed] [--home DIR]
//                             [--mode off|rules|observe|shadow|hold]
//
// Modes (the file gate-mode beside this script overrides the installed default, live, no restart):
//   off      everything passes, nothing is judged or logged (also the release-window setting)
//   rules    stage 0 only: the code rules wake or drop, nothing is sent to Jev
//   observe  everything passes; the log records what the rules and Jev would have done (the measuring week)
//   shadow   the rule drops are real and Jev judges and logs every remaining line, but nothing is held yet (the last
//            step before hold)
//   hold     the running state: routine lines wait in the digest, everything else wakes now
//
// Stage 0, in order, first match decides: (0) Owner's lines and the board route always pass; (1) danger and
// production words wake; (2) claims wake (turn-ends, "done", "verified"); (3) a line shape never seen on this machine
// wakes and is remembered; (4) an instrument's line about itself wakes; (5) known bookkeeping echoes are dropped; (6) a
// stateful line restating the same state as last time is dropped. Stage 1: one Jev request with the line, the last ten
// events and the tracked cards; code applies the thresholds. A held line goes to digest.txt verbatim and is printed,
// verbatim, at the next wake for any reason, after --flush-minutes, at --flush-lines, or when the same routine thing
// repeats --repeat-n times in --repeat-minutes. Any Jev error, timeout, 429 or missing key: fail-open, the line wakes,
// one "GATE | fail-open" line per ten minutes. A production word turns the gate off for --release-minutes (0
// disables).
// Every judgment writes gate-heartbeat.json; the sweep alarms when it goes silent.
'use strict';
const quiet = require('./gate-policy.cjs');
const http = require('http'),
  https = require('https'),
  fs = require('fs'),
  path = require('path'),
  os = require('os'),
  readline = require('readline');
const args = process.argv.slice(2),
  argv = {};
for (let i = 0; i < args.length; i++)
  if (args[i].startsWith('--'))
    argv[args[i].slice(2)] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
const num = (v, d) => (v === undefined || v === true || isNaN(Number(v)) ? d : Number(v));
const HOME = argv.home || process.env.GATE_HOME || __dirname;
const SERVER = argv.server || '__BOARD_SERVER__',
  BOARD = argv.board || '__BOARD_ID__';
const MODES = ['off', 'rules', 'observe', 'shadow', 'hold'];
const DEFAULT_MODE = MODES.includes(argv.mode) ? argv.mode : MODES.includes('__GATE_MODE__') ? '__GATE_MODE__' : 'off';
const JEV_URL = process.env.GATE_JEV_URL || 'https://api.typesafe.ai/v1/systemone';
const OPT = {
  flushMinutes: num(argv['flush-minutes'], 30),
  flushLines: num(argv['flush-lines'], 40),
  repeatN: num(argv['repeat-n'], 5),
  repeatMinutes: num(argv['repeat-minutes'], 15),
  // the gate's own clock: flushes, the heartbeat, the registry and the rules' reload run once a tick
  tickMs: num(argv['tick-ms'], 5000),
  // 4 s: 2 s is tight from a machine with a slower path to the API.
  jevTimeoutMs: num(argv['jev-timeout-ms'], 4000),
  releaseMinutes: num(argv['release-minutes'], 60),
  trackedRefreshS: num(argv['tracked-refresh-s'], 180),
  recent: 10,
};
const F = n => path.join(HOME, n);
const MODEF = F('gate-mode'),
  RULESF = path.join(__dirname, 'gate-rules.json'),
  LOCALF = F('gate-rules.local.json'),
  SHAPESF = F('gate-shapes.json'),
  LASTF = F('gate-last.json'),
  LOGF = F('gate-log.jsonl'),
  DIGESTF = F('digest.txt'),
  HBF = F('gate-heartbeat.json'),
  TOKENF = F('LH-TOKEN.txt');
// several gates in one home need distinct --source values; a new gate with the same one replaces the old
const SOURCE_KEY = argv.source && argv.source !== true ? String(argv.source) : 'default';
const outputKey = require('node:crypto').createHash('sha256').update(SOURCE_KEY).digest('hex').slice(0, 16);
const out = require('./watch-output.cjs')(HOME, 'gate-' + outputKey);
const lease = require('./watch-lease.cjs');
const INPUTF = F('gate-input-' + outputKey + '.json');
let pendingInput = [];
let stopReason = null;
process.on('exit', code => {
  const lostLease = lease.stopReason();
  const reason = lostLease ? 'lease ' + lostLease : stopReason || 'process exit ' + code;
  const event = { t: new Date().toISOString(), pid: process.pid, source: SOURCE_KEY, reason, code };
  try {
    fs.appendFileSync(F('gate-stop-events.jsonl'), JSON.stringify(event) + '\n', { mode: 0o600 });
  } catch {}
  if (!lostLease) {
    const advice = reason.startsWith('cannot replace previous gate:')
      ? 'stop old Monitor; run bash shift.sh kill-watchers; then re-arm'
      : reason === 'replaced by same source'
        ? 'newer gate owns this source; no action'
        : 'check gap; re-arm if needed';
    try {
      fs.writeSync(1, 'GATE | ' + SOURCE_KEY + ' stopped: ' + reason + '; ' + advice + '\n');
    } catch {}
  }
});
function saveInput() {
  try {
    fs.writeFileSync(INPUTF + '.tmp', JSON.stringify(pendingInput), { mode: 0o600 });
    fs.renameSync(INPUTF + '.tmp', INPUTF);
  } catch {
    stopReason = 'cannot save pending input';
    process.exit(1);
  }
}
const readJson = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    return d;
  }
};
const writeJson = (f, v, requireLease = true) => {
  if (requireLease) lease.check(true);
  try {
    fs.writeFileSync(f + '.tmp', JSON.stringify(v));
    fs.renameSync(f + '.tmp', f);
    return true;
  } catch (e) {
    return false;
  }
};
const hhmm = t => {
  const d = new Date(t);
  return (
    `${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')} ` +
    `${d.getHours() < 12 ? 'AM' : 'PM'}`
  );
};

// ---- rules: the kit's table, plus the operator's own additions in gate-rules.local.json (never overwritten by an
// update) ----
function loadRules() {
  const base = readJson(RULESF, {}),
    local = readJson(LOCALF, {});
  const r = {
    wake: [],
    release: [],
    releaseNot: [],
    routineReplies: [],
    claims: [],
    instrument: [],
    drop: {},
    quietDrop: {},
    digest: {},
    stateful: {},
    thresholds: {},
  };
  for (const src of [base, local]) {
    for (const k of ['wake', 'release', 'releaseNot', 'routineReplies', 'claims', 'instrument'])
      r[k] = r[k].concat(src[k] || []);
    Object.assign(r.drop, src.drop || {});
    Object.assign(r.quietDrop, src.quietDrop || {});
    Object.assign(r.digest, src.digest || {});
    Object.assign(r.stateful, src.stateful || {});
    Object.assign(r.thresholds, src.thresholds || {});
  }
  const rx = (list, flags) => (list.length ? new RegExp(list.join('|'), flags) : null);
  return {
    wake: rx(
      r.wake.map(w => `\\b(?:${w})\\b`),
      'i',
    ),
    // release: production evidence with an action word, and no negation
    release: rx(r.release, 'i'),
    releaseNot: rx(r.releaseNot, 'i'),
    routineReplies: rx(r.routineReplies, 'i'),
    claims: rx(r.claims, 'i'),
    instrument: rx(r.instrument, ''),
    drop: Object.entries(r.drop).map(([name, p]) => ({ name, rx: new RegExp(p, 'i') })),
    quietDrop: quiet.patterns(r.quietDrop),
    digest: quiet.patterns(r.digest),
    stateful: Object.entries(r.stateful).map(([name, p]) => ({ name, rx: new RegExp(p, '') })),
    thresholds: Object.assign({ attention: 0.5, confidence: 0.6, repeat: 0.5 }, r.thresholds),
  };
}
let rules = loadRules();
const consumedRelays = readJson(F('gate-relays.json'), {});

// ---- the key: the environment, else the operator's private env file; never printed, never on a command line ----
// each machine keeps its own key where it already is: a file path in the machine config, or "default"
const KEYFILE = '__TYPESAFE_ENV__';
function apiKey() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY.trim();
  const homes = [process.env.USERPROFILE, process.env.HOME, os.homedir()].filter(Boolean);
  const files = (/^[A-Za-z]:|^\//.test(KEYFILE) ? [KEYFILE] : []).concat(
    [F('typesafe.env')],
    homes.map(h => path.join(h, '.config', 'typesafe', 'typesafe.env')),
  );
  for (const f of files) {
    try {
      const m = /^\s*TYPESAFE_API_KEY\s*=\s*"?([^"\r\n]+)"?/m.exec(fs.readFileSync(f, 'utf8'));
      if (m) return m[1].trim();
    } catch (e) {}
  }
  return '';
}

// ---- shapes and states ----
const shapeOf = line =>
  line
    .replace(/\s*\[key [^\]]*\]\s*$/, '')
    .toLowerCase()
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/g, '#')
    .replace(/\b\d{4}-\d{2}-\d{2}(?:t[\d:.]+z?)?\b/g, '#')
    .replace(/[a-z]:[\\/][^\s|]+|\/[^\s|]+/g, '#')
    .replace(/\b[0-9a-f]{6,}\b/g, '#')
    .replace(/\b\d+(?:[.,]\d+)?\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
const routeOwner = readJson(F('config.json'), {}).ownerName || 'the captain';
const sourceOf = line =>
  line.startsWith(routeOwner + ' (') || /^BOARD WATCH \||^BOARD \||^Staff \(|^NOTICE from /.test(line)
    ? 'route'
    : /^FM /.test(line)
      ? 'fmwatch'
      : /^STEWARD WATCH/.test(line)
        ? 'stwatch'
        : /^(LIGHTHOUSE|RECORD CHECK)/.test(line)
          ? 'sweep'
          : /^GATE \||\.cjs: /.test(line)
            ? 'instrument'
            : argv.source && argv.source !== 'mixed'
              ? argv.source
              : 'other';
let shapes = readJson(SHAPESF, {}),
  last = readJson(LASTF, {});
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
const REGF = F('gate-pids.json');
async function registerGate() {
  const announcements = [];
  let reg = readJson(REGF, {});
  const me = String(process.pid);
  for (const [pid, r] of Object.entries(reg)) {
    const p = Number(pid);
    if (!p || p === process.pid) {
      delete reg[pid];
      continue;
    }
    if (!alive(p)) {
      delete reg[pid];
      continue;
    }
    if ((r && r.source) === SOURCE_KEY) {
      try {
        reg[pid].stop = 'replaced by same source';
        reg[pid].stopRequestedBy = process.pid;
        let published = writeJson(REGF, reg);
        for (let attempt = 0; attempt < 50 && !published; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 10));
          published = writeJson(REGF, reg);
        }
        if (!published) throw new Error('cannot request previous gate stop');
        for (let attempt = 0; attempt < 200 && alive(p); attempt++) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        if (alive(p)) throw new Error('previous gate did not exit');
        announcements.push(`gate.cjs: replaced a leftover gate (pid ${p}, source ${r.source || '?'})`);
      } catch (error) {
        if (alive(p)) {
          const current = readJson(REGF, {});
          if (current[pid]?.stopRequestedBy === process.pid) {
            delete current[pid].stop;
            delete current[pid].stopRequestedBy;
            writeJson(REGF, current);
          }
          throw error;
        }
      }
      delete reg[pid];
    }
  }
  const temporary = REGF + '.' + process.pid + '.tmp';
  const deadline = Date.now() + 500;
  for (;;) {
    try {
      lease.check(true);
      reg = readJson(REGF, {});
      for (const pid of Object.keys(reg)) if (!alive(Number(pid))) delete reg[pid];
      reg[me] = { source: SOURCE_KEY, ppid: process.ppid, startedAt: new Date().toISOString(), home: HOME };
      fs.writeFileSync(temporary, JSON.stringify(reg));
      fs.renameSync(temporary, REGF);
      break;
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || Date.now() >= deadline) {
        fs.rmSync(temporary, { force: true });
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  for (const line of announcements)
    log({ t: new Date().toISOString(), kind: 'startup', decision: 'drop', reason: 'watcher replacement', line });
}
const STARTED_AT = new Date().toISOString();
function reregister() {
  // every tick: a cleared home, a deleted file or a crash mid-write loses the entry for at most one tick (in a wrapper
  // arrangement the registry is the only layer that can see a gate)
  try {
    const reg = readJson(REGF, {}),
      me = String(process.pid);
    if (!reg[me]) {
      reg[me] = { source: SOURCE_KEY, ppid: process.ppid, startedAt: STARTED_AT, home: HOME };
      writeJson(REGF, reg);
    }
  } catch (e) {}
}
const unregister = () => {
  try {
    const reg = readJson(REGF, {});
    delete reg[String(process.pid)];
    writeJson(REGF, reg, false);
  } catch (e) {}
};
process.on('exit', unregister);
process.on('SIGINT', () => {
  stopReason = 'signal SIGINT';
  unregister();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopReason = 'signal SIGTERM';
  unregister();
  process.exit(0);
});

// ---- mode, live ----
let modeSeen = { text: null, mtime: 0 },
  offUntil = 0,
  offSetAtMtime = 0;
function currentMode() {
  try {
    const st = fs.statSync(MODEF);
    const m = st.mtimeMs;
    if (m !== modeSeen.mtime) {
      modeSeen = { text: fs.readFileSync(MODEF, 'utf8').trim().split(/\s+/)[0], mtime: m };
    }
  } catch (e) {
    modeSeen = { text: null, mtime: 0 };
  }
  const mode = MODES.includes(modeSeen.text) ? modeSeen.text : DEFAULT_MODE;
  // the operator wrote the mode file after the window opened: the window ends
  if (offUntil && modeSeen.mtime > offSetAtMtime) offUntil = 0;
  return mode;
}
const effective = (mode, now) => (offUntil && now < offUntil && mode !== 'off' ? 'off' : mode);

// ---- the digest: held lines, verbatim, on disk as well as in memory so a dead gate loses nothing ----
let held = [];
try {
  held = fs
    .readFileSync(DIGESTF, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(s => {
      try {
        return JSON.parse(s);
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);
} catch (e) {}
function hold(ev) {
  lease.check(true);
  held.push(ev);
  try {
    fs.appendFileSync(DIGESTF, JSON.stringify(ev) + '\n');
  } catch (e) {}
}
function flush(reason, now) {
  if (!held.length) return;
  const since = hhmm(held[0].t),
    n = held.length;
  for (const ev of held) out(ev.line);
  out(`GATE | ${n} line${n === 1 ? '' : 's'} held since ${since}, flushed because ${reason}`);
  counters.flushed += n;
  lease.check(true);
  held = [];
  try {
    fs.writeFileSync(DIGESTF, '');
  } catch (e) {}
  log({ t: new Date(now).toISOString(), kind: 'flush', n, reason });
}
function repetition(ev, now) {
  const windowMs = OPT.repeatMinutes * 60000;
  const same = held.filter(
    h =>
      !h.ruleDigest &&
      now - h.t <= windowMs &&
      (h.shape === ev.shape || (h.source === ev.source && h.jevKind === ev.jevKind)),
  );
  return same.length >= OPT.repeatN
    ? `repetition: ${same.length} × "${ev.shape.slice(0, 40)}" in ${OPT.repeatMinutes} min`
    : null;
}

// ---- log, heartbeat, counters ----
const counters = {
  judged: 0,
  woke: 0,
  held: 0,
  dropped: 0,
  passed: 0,
  failed: 0,
  flushed: 0,
  started: new Date().toISOString(),
};
let seq = 0,
  failOpenSince = null,
  lastFailNote = 0,
  lastEventAt = null,
  lastFail = null; // lastFail: the reason of the last fail-open, for the heartbeat and the conduct report
function log(rec) {
  // rotated at 5 MB like the collector's outbox
  try {
    if (fs.statSync(LOGF).size > 5 * 1024 * 1024)
      fs.renameSync(LOGF, LOGF + '.' + new Date().toISOString().slice(0, 10));
  } catch (e) {}
  try {
    fs.appendFileSync(LOGF, JSON.stringify(rec) + '\n');
  } catch (e) {}
}
function heartbeat(now, mode) {
  writeJson(
    HBF,
    Object.assign(
      {
        t: new Date(now).toISOString(),
        pid: process.pid,
        mode,
        effective: effective(mode, now),
        offUntil: offUntil ? new Date(offUntil).toISOString() : null,
        failOpenSince,
        lastFail,
        lastEventAt,
        heldNow: held.length,
        tracked: tracked.length,
      },
      counters,
    ),
  );
}
function failOpen(reason, now) {
  counters.failed++;
  if (!failOpenSince) failOpenSince = new Date(now).toISOString();
  lastFail = { t: new Date(now).toISOString(), reason: String(reason).slice(0, 160) };
  if (now - lastFailNote > 10 * 60000) {
    out(`GATE | fail-open: ${reason}; every line wakes until Jev answers again`);
    lastFailNote = now;
  }
}

// ---- the board's open cards, for the model's state ----
let tracked = [],
  trackedAt = 0;
function token() {
  try {
    return fs
      .readFileSync(TOKENF, 'utf8')
      .replace(/[\r\n]/g, '')
      .trim();
  } catch (e) {
    return '';
  }
}
function refreshTracked(now) {
  lease.check(true);
  if (now - trackedAt < OPT.trackedRefreshS * 1000) return Promise.resolve();
  trackedAt = now;
  const tok = token();
  if (!/^https?:\/\//.test(SERVER) || !tok) return Promise.resolve();
  return new Promise(resolve => {
    let u;
    try {
      u = new URL('/api/state', SERVER);
    } catch (e) {
      return resolve();
    }
    const mod = u.protocol === 'https:' ? https : http;
    const r = mod.get(u, { headers: { Authorization: 'Bearer ' + tok }, timeout: 3000 }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const s = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const cards = Object.values(s.cards || {}).filter(c => c.board === BOARD && c.status !== 'done');
          tracked = cards.slice(0, 30).map(c => ({
            task: String(c.title || c.id).slice(0, 120),
            state: String(c.description || '').slice(0, 200),
            open_ask: ((c.decisions || []).find(x => !x.resolvedAt) || {}).ask || null,
          }));
        } catch (e) {}
        resolve();
      });
      res.on('error', () => resolve());
    });
    r.on('error', () => resolve());
    r.on('timeout', () => {
      r.destroy();
      resolve();
    });
  });
}

// ---- Jev: one request, three questions, a hard timeout; any failure is the caller's fail-open ----
const QUESTIONS = {
  attention: {
    type: 'noul',
    instructions:
      'Does `event` report something the operator must look at now: a failure, a block, a stop, a question or a ' +
      'request, or a change in what one of the `tracked` tasks needs? Answer no for routine housekeeping, timers, ' +
      'rechecks, and for a restatement of a fact already present in `recent`.',
  },
  repeat: {
    type: 'noul',
    instructions: 'Is `event` a restatement of a fact already present in `recent`, carrying nothing new?',
  },
  kind: {
    type: 'choice',
    instructions: 'What kind of event is `event`, given `recent` and `tracked`?',
    criteria: {
      needs_attention_now: 'a failure, a block, a stop, a question or request, or a change of state on a tracked task',
      progress: 'new work or output on a tracked task; nothing needs anyone',
      routine: 'housekeeping, timers, rechecks, heartbeats, a repeated status with nothing new',
      unclear: 'none of these fits, or the event cannot be read',
    },
  },
};
let recent = [];
function judge(ev, key) {
  lease.check(true);
  const state = {
    source: ev.source,
    event: ev.line.slice(0, 1500),
    recent: recent.slice(-OPT.recent).map(r => ({ at: hhmm(r.t), source: r.source, line: r.line.slice(0, 300) })),
    tracked,
  };
  const body = JSON.stringify({ state, model: 'jev-latest', questions: QUESTIONS });
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(JEV_URL);
    } catch (e) {
      return reject(new Error('bad Jev url'));
    }
    const mod = u.protocol === 'https:' ? https : http,
      started = Date.now();
    const req = mod.request(
      u,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: OPT.jevTimeoutMs,
      },
      res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const d = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) return reject(new Error(`Jev answered ${res.statusCode}`));
          try {
            const a = JSON.parse(d).answers || {};
            const v = {
              attention: Number(a.attention && a.attention.noul),
              repeat: Number(a.repeat && a.repeat.noul),
              kind: String(a.kind && a.kind.choice),
              confidence: Number(a.kind && a.kind.confidence),
              ms: Date.now() - started,
            };
            if ([v.attention, v.repeat, v.confidence].some(isNaN) || !QUESTIONS.kind.criteria[v.kind])
              return reject(new Error('Jev answer unreadable'));
            resolve(v);
          } catch (e) {
            reject(new Error('Jev answer unreadable'));
          }
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`Jev took longer than ${OPT.jevTimeoutMs} ms`)));
    req.on('error', reject);
    req.end(body);
  });
}
function policy(v) {
  const T = rules.thresholds;
  if (v.kind === 'needs_attention_now' || v.kind === 'unclear') return ['wake', 'kind ' + v.kind];
  if (v.attention >= T.attention) return ['wake', `attention ${v.attention.toFixed(2)}`];
  if (v.confidence < T.confidence) return ['wake', `confidence ${v.confidence.toFixed(2)} below ${T.confidence}`];
  if (v.kind === 'progress' && v.repeat < T.repeat) return ['wake', 'new progress'];
  return ['hold', v.kind === 'progress' ? 'repeated progress' : 'routine'];
}

// ---- one line ----
async function handle(raw) {
  lease.check();
  const line = raw.replace(/\r$/, '');
  if (!line.trim()) return;
  const now = Date.now();
  lastEventAt = new Date(now).toISOString();
  const mode = currentMode(),
    eff = effective(mode, now);
  if (mode === 'off') {
    out(line);
    return;
  }
  const ev = { id: `e${++seq}`, t: now, line, source: sourceOf(line), shape: shapeOf(line) };
  const rec = {
    id: ev.id,
    t: new Date(now).toISOString(),
    mode,
    effective: eff,
    source: ev.source,
    shape: ev.shape,
    line,
  };
  let st = null;
  for (const s of rules.stateful) {
    const k = s.rx.exec(line);
    if (k) {
      st = { key: s.name + ':' + (k[1] || '').trim(), val: ev.shape + '|' + line.replace(/\d/g, '#').slice(0, 300) };
      break;
    }
  }
  const finish = (decision, stage, reason, extra) => {
    lease.check(true);
    Object.assign(rec, { decision, stage, reason }, extra || {});
    log(rec);
    recent.push(ev);
    if (recent.length > 50) recent = recent.slice(-50);
    if (st && reason !== 'unchanged state') {
      last[st.key] = st.val;
      writeJson(LASTF, last);
    } // the state is remembered whichever rule spoke, so a repeat of it is a repeat
    heartbeat(now, mode);
  };
  const wake = (stage, reason, extra) => {
    flush('a wake for another reason', now);
    out(line);
    counters.woke++;
    finish('wake', stage, reason, extra);
  };
  const pass = (stage, reason, would, extra) => {
    flush('a wake for another reason', now);
    out(line);
    counters.passed++;
    finish('pass', stage, reason, Object.assign({ would }, extra || {}));
  };
  const drop = reason => {
    lease.check();
    counters.dropped++;
    finish('drop', 'rules', reason);
  };
  // stage 0
  if (ev.source === 'route') return wake('rules', 'Owner or the board route');
  if (eff === 'off') return pass('release', 'release window', null);
  let m;
  if ((m = rules.wake && rules.wake.exec(quiet.dangerText(line)))) {
    const word = m[0].toLowerCase();
    const rel = rules.release && !(rules.releaseNot && rules.releaseNot.test(line)) && rules.release.exec(line);
    if (
      rel &&
      OPT.releaseMinutes > 0 &&
      ['observe', 'shadow', 'hold'].includes(mode) &&
      !(offUntil && now < offUntil)
    ) {
      offUntil = now + OPT.releaseMinutes * 60000;
      offSetAtMtime = modeSeen.mtime;
      flush('a wake for another reason', now);
      out(line);
      counters.woke++;
      out(
        `GATE | off for ${OPT.releaseMinutes} min: a production action is under way ("${rel[0].slice(0, 60)}"); ` +
          `bash shift.sh gate ${mode} ends it early`,
      );
      return finish('wake', 'rules', `release window opened: "${rel[0].slice(0, 60)}"`);
    }
    return wake('rules', `word "${word}"`);
  }
  const relay = quiet.ownRelay(line, quiet.relayEvidence(HOME), consumedRelays, now);
  const rule = quiet.quietRule(line, rules, relay);
  if (rule) {
    const rememberRelay = () => {
      if (!rule.relay) return;
      lease.check(true);
      consumedRelays[rule.relay] = now;
      for (const [id, at] of Object.entries(consumedRelays)) if (now - at > 30 * 60000) delete consumedRelays[id];
      writeJson(F('gate-relays.json'), consumedRelays);
    };
    if (rule.decision === 'wake') return wake('rules', rule.reason);
    if (mode === 'observe') {
      pass('rules', rule.reason, rule.decision);
      rememberRelay();
      return;
    }
    rememberRelay();
    if (rule.decision === 'drop') return drop(rule.reason);
    ev.ruleDigest = true;
    hold(ev);
    counters.held++;
    return finish('hold', 'rules', rule.reason);
  }
  if (rules.claims && rules.claims.test(line) && !(rules.routineReplies && rules.routineReplies.test(line)))
    return wake('rules', 'a claim or a turn-end'); // a bare "shipshape" reply claims nothing: Jev judges it
  if (!shapes[ev.shape]) {
    wake('rules', 'a shape never seen here');
    shapes[ev.shape] = new Date(now).toISOString();
    writeJson(SHAPESF, shapes);
    return;
  }
  if (ev.source === 'instrument' || (rules.instrument && rules.instrument.test(line)))
    return wake('rules', 'an instrument about itself');
  for (const d of rules.drop)
    if (d.rx.test(line)) return mode === 'observe' ? pass('rules', `echo: ${d.name}`, 'drop') : drop(`echo: ${d.name}`);
  if (st && last[st.key] === st.val)
    return mode === 'observe' ? pass('rules', 'unchanged state', 'drop') : drop('unchanged state');
  if (mode === 'rules') return pass('rules', 'not a rule; rules mode sends nothing to Jev', null);
  // stage 1
  const key = apiKey();
  if (!key) {
    failOpen('no TYPESAFE_API_KEY in the environment or typesafe.env', now);
    return pass('jev', 'fail-open: no key', null);
  }
  await refreshTracked(now);
  let v;
  try {
    v = await judge(ev, key);
  } catch (e) {
    failOpen(e.message, now);
    return pass('jev', 'fail-open: ' + e.message, null);
  }
  if (failOpenSince) {
    failOpenSince = null;
    out('GATE | judging again');
  }
  counters.judged++;
  lease.check();
  ev.jevKind = v.kind;
  const [decision, why] = policy(v),
    jev = { attention: v.attention, repeat: v.repeat, kind: v.kind, confidence: v.confidence, ms: v.ms };
  if (mode !== 'hold') return pass('jev', why, decision, { jev });
  if (decision === 'wake') return wake('jev', why, { jev });
  hold(ev);
  counters.held++;
  finish('hold', 'jev', why, { jev });
  const rep = repetition(ev, now);
  if (rep) flush(rep, now);
  else if (held.length >= OPT.flushLines) flush(`${held.length} lines held`, now);
}

setInterval(() => {
  const requested = readJson(REGF, {})[process.pid];
  if (
    requested?.stop === 'replaced by same source' &&
    Number.isSafeInteger(requested.stopRequestedBy) &&
    requested.stopRequestedBy > 1 &&
    alive(requested.stopRequestedBy)
  ) {
    stopReason = requested.stop;
    process.exit(0);
  }
}, 100).unref();
function tick() {
  lease.check();
  const now = Date.now(),
    mode = currentMode();
  const ruleDue = held.some(ev => ev.ruleDigest && now - ev.t >= Math.min(30, OPT.flushMinutes) * 60000);
  if (ruleDue || (held.length && mode === 'hold' && now - held[0].t >= OPT.flushMinutes * 60000))
    flush(`${ruleDue ? Math.min(30, OPT.flushMinutes) : OPT.flushMinutes} minutes passed`, now);
  if (held.length && mode !== 'hold' && (['off', 'observe'].includes(mode) || held.some(ev => !ev.ruleDigest)))
    flush(`the gate left hold mode (${mode})`, now);
  if (offUntil && now >= offUntil) {
    offUntil = 0;
    out('GATE | the release window closed; holding again');
  }
  try {
    rules = loadRules();
  } catch (e) {}
  reregister();
  heartbeat(now, mode);
}
let chain = registerGate()
  .then(async () => {
    out.replay();
    pendingInput = readJson(INPUTF, []);
    for (const line of [...pendingInput]) {
      await handle(line);
      lease.check(true);
      pendingInput.shift();
      saveInput();
    }
    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.on('line', line => {
      pendingInput.push(line);
      saveInput();
      chain = chain.then(async () => {
        try {
          await handle(line);
        } catch (error) {
          out(line);
          log({ t: new Date().toISOString(), kind: 'gate-error', error: String(error.message || error) });
        }
        lease.check(true);
        pendingInput.shift();
        saveInput();
      });
    });
    rl.on('close', () => {
      chain.then(() => {
        stopReason = 'input ended';
        const now = Date.now();
        if (held.length) flush('the gate is stopping', now);
        heartbeat(now, currentMode());
        clearInterval(timer);
        process.exit(0);
      });
    });
  })
  .catch(error => {
    const detail = String(error?.message || error);
    stopReason = ['previous gate did not exit', 'cannot request previous gate stop'].includes(detail)
      ? 'cannot replace previous gate: ' + detail
      : 'startup failed; inspect input journal and gate home before re-arm';
    process.exit(1);
  });
const timer = setInterval(() => {
  chain = chain.then(tick).catch(() => {});
}, OPT.tickMs);
heartbeat(Date.now(), currentMode());
