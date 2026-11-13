// Firstmate live watch for the operator: reads conversation files, task status files and the lock from Windows.
// Prints changed facts every 2 s, tagged with a stable event key for the operator and wake gate.
// Never relays, wakes another agent or writes firstmate's records. Read-only.
'use strict';
// One instance only (a Monitor's expiry can leave the script running underneath): a new start finds the pid file
// beside this script, stops the leftover copy, and takes over.
if (!process.env?.LH_HELPER_LEASE) {
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
const fs = require('fs'),
  path = require('path');
const HOME = '//wsl.localhost/__WSL_DISTRO__/home/__WSL_USER__';
const CONV = HOME + '/.claude/projects/__FM_CONV_DIR__';
const STATE = HOME + '__FM_HOME_REL__/state';
const LOCK = STATE + '/.lock'; // holds only the owning firstmate process id
const POLL_MS = 2000,
  RECENT_MS = 24 * 3600000;
const lease = require('./watch-lease.cjs');
const resume = lease.load(__dirname, 'fmwatch');
const started = resume ? resume.started : new Date().toISOString();

const offsets = new Map(); // conversation file -> bytes read
const lastLine = new Map(); // status file -> last non-empty line
const seen = new Set(),
  order = []; // entry uuids: forked conversation files copy earlier entries
let blind = false,
  first = true,
  lockPid;
// the model per transcript file: a side transcript on another model is not firstmate switching
const models = new Map();

const output = require('./watch-output.cjs')(__dirname, 'fmwatch');
const say = (s, cap = 600) => output(s.replace(/\s+/g, ' ').trim().slice(0, cap));
// a line with a body that may be long: the body is shortened, never the key at its end
const sayKeyed = (head, body, key, cap = 600) => {
  const flat = String(body).replace(/\s+/g, ' ').trim(),
    room = cap - head.length - key.length - 2;
  say(`${head}${flat.length > room ? flat.slice(0, Math.max(0, room - 1)) + '…' : flat} ${key}`, cap);
};
function saveReply(key, text) {
  const directory = path.join(__dirname, 'fm-replies');
  const name = require('node:crypto').createHash('sha256').update(String(key)).digest('hex');
  const file = path.join(directory, name + '.txt');
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, text, { mode: 0o600 });
    return file.split(path.sep).join('/');
  } catch {
    say('FM WATCH | cannot save full reply; the printed reply may be shortened');
    return null;
  }
}
// What firstmate asks the operator for: its asking sentences go first on the FM REPLY line ("asks you: «...»"), so
// a line cut short for length still carries them; and while firstmate has had no input since, an FM WAITING line
// reminds the operator 15 and 60 minutes after the ask.
const ASKING = new RegExp(
  '\\b(' +
    [
      'waiting on you',
      'waiting for you',
      'still waiting',
      'needs? you to',
      'needs? your go-ahead',
      'please',
      'can you',
      'could you',
      'would you',
      'upload\\b.*\\bfor me',
      'send me',
      'package id',
      'your (go(?!-)|call|word|decision|approval|answer)',
    ].join('|') +
    ')\\b',
  'i',
);
const REPORTED_ASK = /\b(?:will ask you|\w+['’]ll ask you|asked you)\b/i;
const REMIND_MIN = [15, 60];
let waiting = null; // the newest reply that asked something: { key, ms, at, asks, told }
function asksIn(t) {
  let fence = null;
  return String(t)
    .split(/\r?\n/)
    .filter(line => {
      if (/^\s*>/.test(line)) return false;
      const marker = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        if (
          marker &&
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length &&
          !line.slice(marker[0].length).trim()
        )
          fence = null;
        return false;
      }
      if (marker && !(marker[1][0] === '`' && line.slice(marker[0].length).includes('`'))) {
        fence = marker[1];
        return false;
      }
      return true;
    })
    .join('\n')
    .trim()
    .replace(/\s+/g, ' ')
    .split(/(?<=[.?!])\s+/)
    .filter(s => /\?\s*$/.test(s) || (!REPORTED_ASK.test(s) && ASKING.test(s)))
    .join(' ')
    .slice(0, 300);
}
function remind() {
  if (!waiting) return;
  const due = REMIND_MIN[waiting.told];
  if (due === undefined || Date.now() - waiting.ms < due * 60000) return;
  waiting.told++;
  sayKeyed(
    `FM WAITING ${hhmm(new Date(Date.now()).toISOString())} | firstmate asked you at ${waiting.at} ` +
      `and has had no input in ${due} min: `,
    '«' + waiting.asks + '»',
    `[key waiting:${waiting.key}:${due}]`,
  );
}
const hhmm = ts => {
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '?';
  }
};
const remember = id => {
  if (!id) return false;
  if (seen.has(id)) return true;
  seen.add(id);
  order.push(id);
  if (order.length > 20000) seen.delete(order.shift());
  return false;
};

function text(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  if (content.some(x => x && x.type === 'tool_result')) return null; // tool output, not a person
  return content
    .filter(x => x && x.type === 'text')
    .map(x => x.text)
    .join(' ');
}

// fmwatch-ignore.txt beside this script, one rule a line: a conversation id (the transcript's file name without
// .jsonl), or "prompt: <words>" matching the first thing typed in a conversation. Those conversations are not
// firstmate answering Owner: a supervision side conversation of firstmate's can run on another model, and its model
// and replies are not firstmate's
const IGNORE = (() => {
  try {
    return fs
      .readFileSync(path.join(__dirname, 'fmwatch-ignore.txt'), 'utf8')
      .split(/\r?\n/)
      .map(x => x.trim())
      .filter(x => x && !x.startsWith('#'));
  } catch {
    return [];
  }
})();
const firstPrompt = new Map();
function ignored(file) {
  if (!IGNORE.length || !file) return false;
  const id = path.basename(file).replace(/\.jsonl$/, '');
  if (IGNORE.includes(id)) return true;
  if (!firstPrompt.has(file)) {
    // read once: the first user entry's words
    let t = '';
    try {
      const fd = fs.openSync(file, 'r'),
        buf = Buffer.alloc(262144),
        n = fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      for (const line of buf.slice(0, n).toString('utf8').split('\n')) {
        let o;
        try {
          o = JSON.parse(line);
        } catch {
          continue;
        }
        if (o.type === 'user' && o.message) {
          const c = o.message.content;
          t = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => (x && x.text) || '').join(' ') : '';
          if (t.trim()) break;
        }
      }
    } catch {
      /* unreadable: not ignored */
    }
    firstPrompt.set(file, t);
  }
  const t = firstPrompt.get(file) || '';
  return IGNORE.some(r => /^prompt:/i.test(r) && t.includes(r.replace(/^prompt:\s*/i, '')));
}

function handle(o, file) {
  lease.check();
  if (o.uuid && seen.has(o.uuid)) return;
  if (deliver(o, file) === false) return;
  lease.check(true);
  remember(o.uuid);
}
function deliver(o, file) {
  // a subagent's or a side session's transcript, or one named in fmwatch-ignore.txt
  const side = !!o.isSidechain || /^agent-/.test(path.basename(file || '')) || ignored(file);
  const ts = o.timestamp || '';
  if (ts && ts < started) return; // never replay history
  if (o.type === 'system' && o.subtype === 'compact_boundary') {
    const pre = (o.compactMetadata || {}).preTokens;
    return say(
      `FM COMPACTED ${hhmm(ts)} | ${o.compactMetadata?.trigger || ''} compaction from ${pre || '?'} tokens ` +
        `[key compact:${o.uuid}]`,
    );
  }
  if (o.type === 'assistant' && o.message) {
    const m = o.message.model,
      was = models.get(file);
    if (!side && m && m !== '<synthetic>' && m !== was) {
      if (was) say(`FM MODEL ${hhmm(ts)} | firstmate now answering on ${m} (was ${was}) [key model:${m}]`);
      models.set(file, m);
    }
    if (side) return false;
    if (o.message.stop_reason === 'end_turn') {
      const t = text(o.message.content);
      if (t && t.trim()) {
        const key = o.message.id || o.uuid,
          asks = asksIn(t);
        if (asks) waiting = { key, ms: Date.parse(ts) || Date.now(), at: hhmm(ts), asks, told: 0 };
        const file = saveReply(key, t);
        sayKeyed(
          `FM REPLY ${hhmm(ts)} | ${asks ? 'asks you: «' + asks + '» · ' : ''}`,
          t,
          `${file ? '[exact text saved: ' + file + '] ' : ''}[key reply:${key}]`,
          16000,
        );
      }
    }
    return;
  }
  // Owner typing while firstmate is mid-turn is stored as a queued_command attachment, not a user entry,
  // and is missed if only user entries are read.
  if (o.type === 'attachment' && o.attachment && o.attachment.type === 'queued_command') {
    const q = String(o.attachment.prompt || '').trim();
    const who = (o.attachment.origin && o.attachment.origin.kind) || 'unknown';
    if (q && !/^<(task-notification|system-reminder)/.test(q)) {
      if (!side) waiting = null; // firstmate has input: no reminder
      say(`FM INPUT ${hhmm(ts)} (typed while busy, ${who}) | ${q} [key input:${o.uuid}]`);
    }
    return;
  }
  if (o.type !== 'user' || o.isMeta) return;
  const t = text(o.message && o.message.content);
  if (t === null || !t.trim()) return;
  const s = t.trim();
  if (/Stop hook feedback|firstmate watcher wake/.test(s)) {
    const m = s.match(/\b(signal|stale|check|heartbeat): [^\n<]{0,200}/);
    if (m && m[1] !== 'heartbeat') say(`FM WAKE ${hhmm(ts)} | ${m[0]} [key fmwake:${o.uuid}]`);
    return;
  }
  const cmd = s.match(/<command-name>(\/[\w:-]+)<\/command-name>/);
  if (cmd) {
    if (!side) waiting = null;
    return say(`FM COMMAND ${hhmm(ts)} | ${cmd[1]} [key command:${o.uuid}]`);
  }
  if (/^<(local-command|system-reminder|task-notification)/.test(s) || s.startsWith('Base directory for this skill'))
    return;
  if (s.startsWith('This session is being continued'))
    return say(`FM COMPACTED ${hhmm(ts)} | conversation continued from a summary [key compact:${o.uuid}]`);
  if (!side) waiting = null;
  say(`FM INPUT ${hhmm(ts)} | ${s} [key input:${o.uuid}]`);
}

function readNew(f, size) {
  const from = offsets.get(f);
  if (size <= from) {
    if (size < from) offsets.set(f, size);
    return;
  }
  const fd = fs.openSync(f, 'r');
  try {
    const buf = Buffer.alloc(size - from);
    fs.readSync(fd, buf, 0, buf.length, from);
    const cut = buf.lastIndexOf(10) + 1; // keep a torn last line for later
    for (const line of buf.subarray(0, cut).toString('utf8').split('\n')) {
      if (!line) continue;
      try {
        handle(JSON.parse(line), f);
      } catch {
        /* partial or foreign line */
      }
    }
    lease.check(true);
    offsets.set(f, from + cut);
  } finally {
    fs.closeSync(fd);
  }
}

function pollConversations() {
  let error = null;
  for (const n of fs.readdirSync(CONV)) {
    if (!n.endsWith('.jsonl')) continue;
    const f = path.join(CONV, n);
    let st;
    try {
      st = fs.statSync(f);
    } catch (failure) {
      error ||= failure;
      continue;
    }
    if (!offsets.has(f)) {
      if (first) {
        // learn the model firstmate is currently answering on from the newest file, quietly
        if (Date.now() - st.mtimeMs < RECENT_MS && !/^agent-/.test(n) && !ignored(f)) {
          // the model is kept per file, in models
          try {
            const fd = fs.openSync(f, 'r'),
              len = Math.min(st.size, 1048576),
              buf = Buffer.alloc(len);
            fs.readSync(fd, buf, 0, len, st.size - len);
            fs.closeSync(fd);
            for (const line of buf.toString('utf8').split('\n').reverse()) {
              const mm = line.match(/"model":"(claude-[^"]+)"/);
              if (mm) {
                models.set(f, mm[1]);
                break;
              }
            }
          } catch {
            /* optional */
          }
        }
        offsets.set(f, st.size);
        continue;
      }
      offsets.set(f, 0); // new file: read it; timestamps gate replay
    }
    try {
      readNew(f, st.size);
    } catch (failure) {
      error ||= failure;
    }
  }
  if (error) throw error;
}

function pollStatus() {
  for (const n of fs.readdirSync(STATE)) {
    if (!n.endsWith('.status')) continue;
    const f = path.join(STATE, n);
    let body;
    try {
      body = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const line = body.trimEnd().split('\n').pop() || '';
    const prev = lastLine.get(f);
    if (first || prev === line || /^(working|note):/i.test(line)) {
      lastLine.set(f, line);
      continue;
    }
    const task = n.replace(/\.status$/, ''),
      verb = (line.match(/^([a-z-]+)/i) || [, 'line'])[1].toLowerCase();
    say(
      `FM TASK ${hhmm(new Date().toISOString())} | ${task}${prev === undefined ? ' (new task)' : ''} | ${line} ` +
        `[key task:${task}:${verb}]`,
    );
    lastLine.set(f, line);
  }
}

function pollLock() {
  let pid = null;
  try {
    pid = fs.readFileSync(LOCK, 'utf8').trim() || null;
  } catch {
    pid = null;
  }
  if (first) {
    lockPid = pid;
    return;
  }
  if (pid === lockPid) return;
  const now = hhmm(new Date().toISOString());
  if (pid && lockPid)
    say(
      `FM RESTART ${now} | firstmate lock moved from process ${lockPid} to ${pid} (restart or relaunch) ` +
        `[key restart:${pid}]`,
    );
  else if (pid) say(`FM RESTART ${now} | firstmate lock taken by process ${pid} [key restart:${pid}]`);
  else
    say(
      `FM LOCK ${now} | firstmate lock released by process ${lockPid} (firstmate may have exited) ` +
        `[key lockgone:${lockPid}]`,
    );
  lockPid = pid;
}

function poll() {
  lease.check(true);
  // each part in its own try: a failure in one never skips another's first, silent baseline (else an old 'ready'
  // and a 'restart' with the same pid would be reported as new on every start)
  let err = null;
  for (const part of [pollConversations, pollStatus, pollLock]) {
    try {
      part();
    } catch (e) {
      err = err || e;
    }
  }
  if (err) {
    if (!blind) {
      say(`FM WATCH | cannot read some firstmate files (${err.code || err.message}); affected files are blind`);
      blind = true;
    }
  } else if (blind) {
    say('FM WATCH | firstmate files readable again');
    blind = false;
  }
  remind();
  first = false;
  lease.save(__dirname, 'fmwatch', {
    started,
    offsets: [...offsets],
    lastLine: [...lastLine],
    models: [...models],
    order,
    lockPid,
    waiting,
  });
}

if (resume) {
  for (const [key, value] of resume.offsets) offsets.set(key, value);
  for (const [key, value] of resume.lastLine) lastLine.set(key, value);
  for (const [key, value] of resume.models) models.set(key, value);
  for (const identity of resume.order) remember(identity);
  lockPid = resume.lockPid;
  waiting = resume.waiting;
  first = false;
}
output.replay();
poll();
setInterval(poll, POLL_MS);
