#!/usr/bin/env node
'use strict';
// The Lighthouse tool-call server for one operator home (TOOLCALL-DESIGN.md). It speaks MCP over stdio to the
// operator's session and HTTP to the board. Credentials and the local outbox stay private.
//   node lighthouse-mcp.cjs shift start|end
//   node lighthouse-mcp.cjs relay-reconcile <id> --delivered|--not-delivered --evidence '<evidence>'
const fs = require('fs'),
  os = require('os'),
  path = require('path'),
  http = require('http'),
  https = require('https'),
  crypto = require('crypto'),
  { spawnSync } = require('child_process');

const HERE = __dirname;
const readJson = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));
  } catch (e) {
    return d;
  }
};
const CFG = readJson('config.json', {});
const SESSION = require('./session-identity.cjs').identity();
const KIT_SOURCE = 'kit-mcp-source-v1';
const SPEC_SOURCE = (() => {
  try {
    return fs.readFileSync(path.join(HERE, 'toolcalls-spec.json'), 'utf8');
  } catch {
    return '{"tools":[]}';
  }
})();
const SPEC = (() => {
  try {
    return JSON.parse(SPEC_SOURCE);
  } catch {
    return { tools: [] };
  }
})();
const KIT = require('./kit-version.cjs').connect(HERE, KIT_SOURCE, SPEC_SOURCE);
if (SESSION) SESSION.activation = { home: HERE, kit: KIT };
// the installer stamps the home's values here, as in every kit script (a value read from CFG by its placeholder name
// would break the installer)
const SERVER = process.env.LH_SERVER || CFG.server || '__BOARD_SERVER__';
const BOARD = process.env.LH_BOARD || CFG.board || '__BOARD_ID__';
const HANDOFF = require('./handoff.cjs').fromHome({ session: SESSION, request, board: BOARD, home: HERE });
const DISPATCH = require('./dispatch-client.cjs').client({
  session: SESSION,
  request: (...args) => request(...args),
  board: BOARD,
  home: HERE,
  updateRelay,
  locked,
  deliverTicket: ticket => deliverTicket(ticket),
});
// its folder name is the session folder's path, as Claude Code encodes it
const TRANSCRIPTS = process.env.LH_TRANSCRIPTS || CFG.transcripts || '__OPERATOR_TRANSCRIPT_DIR__';
// The one setting may name the operator's session folder itself, so a new operator can start in a clean folder that
// has no transcript folder yet; the transcript folder is then that path as Claude Code encodes it, under its projects
// folder
const PROJECTS = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
const SESSION_DIR =
  /^__/.test(String(TRANSCRIPTS)) ||
  /[\\/]\.claude[\\/]projects[\\/][^\\/]+[\\/]?$/.test(String(TRANSCRIPTS)) ||
  path.dirname(path.resolve(String(TRANSCRIPTS))).toLowerCase() === PROJECTS.toLowerCase()
    ? null
    : path.resolve(String(TRANSCRIPTS));
const TRANSCRIPT_DIR = SESSION_DIR
  ? path.join(PROJECTS, SESSION_DIR.replace(/[^a-zA-Z0-9]/g, '-'))
  : String(TRANSCRIPTS);
const SHADOW_FILE = path.join(HERE, 'LH-SHADOW-TOKEN.txt');
const QUEUE = path.join(HERE, 'calls-outbox.jsonl');
// queued calls a board route refused outright (not the tool: the route), kept and told
const DEAD = path.join(HERE, 'calls-undelivered.jsonl');
const RESULTS = path.join(HERE, 'relay-results.jsonl');
const MAX_ARGS = 200 * 1024; // a call larger than this would never reach the board: refused here, never queued
function token() {
  if (SESSION) return SESSION.credential;
  if (CFG.credentialFile) {
    try {
      const file = path.resolve(HERE, CFG.credentialFile),
        stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && stat.mode & 0o077)) return '';
      return JSON.parse(fs.readFileSync(file, 'utf8')).credential || '';
    } catch {
      return '';
    }
  }
  if (process.env.LH_TOKEN) return process.env.LH_TOKEN.trim();
  const files =
    process.argv[2] === 'shift'
      ? ['LH-TOKEN.txt', 'lh-token.txt']
      : ['LH-SHADOW-TOKEN.txt', 'LH-TOKEN.txt', 'lh-token.txt'];
  for (const f of files) {
    try {
      const t = fs.readFileSync(path.join(HERE, f), 'utf8').trim();
      if (t) return t;
    } catch (e) {}
  }
  return '';
}
const scrub = s => {
  const t = token();
  return t ? String(s).split(t).join('<token>') : String(s);
}; // never echo the token

// ---------- the board ----------
function request(method, p, body, headers = {}) {
  return new Promise(resolve => {
    let u;
    try {
      u = new URL(p, SERVER);
    } catch (e) {
      return resolve({ status: 0, error: 'no board address configured' });
    }
    const mod = u.protocol === 'https:' ? https : http,
      data = Buffer.isBuffer(body) ? body : body ? Buffer.from(JSON.stringify(body)) : null;
    const req = mod.request(
      u,
      {
        method,
        agent: false,
        headers: Object.assign(
          { Authorization: 'Bearer ' + token(), Accept: 'application/json' },
          SESSION ? SESSION.headers : {},
          data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
          headers,
        ),
      },
      res => {
        const chunks = [];
        res.on('aborted', () => resolve({ status: 0, error: 'board response interrupted' }));
        res.on('error', () => resolve({ status: 0, error: 'board response interrupted' }));
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const d = Buffer.concat(chunks).toString('utf8');
          let j = null;
          try {
            j = d ? JSON.parse(d) : {};
          } catch (e) {
            j = { error: d.slice(0, 200) };
          }
          resolve({ status: res.statusCode, body: j });
        });
      },
    );
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.setTimeout(Buffer.isBuffer(body) ? 60000 : 20000, () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}
const callsPath = () => `/api/boards/${encodeURIComponent(BOARD)}/calls`;

const FILE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
};
async function uploadAttachments(args, dryRun = args.dry_run) {
  if (args.attachments === undefined) return args;
  if (!Array.isArray(args.attachments)) throw new Error('attachments must be a list of file paths or ids');
  const entries = [];
  for (const file of args.attachments) {
    try {
      if (typeof file !== 'string' || !file) throw new Error('expected a file path or attachment id');
      if (/^[a-f0-9]{16}$/.test(file)) {
        entries.push({ id: file });
        continue;
      }
      if (dryRun || shadowNow())
        throw new Error('local files cannot upload in a dry run or shadow session; use an existing attachment id');
      const type = FILE_TYPES[path.extname(file).toLowerCase()];
      if (!type) throw new Error('unsupported file type (png, jpg, jpeg, gif, webp, svg, csv, txt or pdf only)');
      const info = fs.statSync(file);
      if (!info.isFile()) throw new Error('not a readable file');
      if (info.size > 10 * 1024 * 1024) throw new Error('over 10 MB');
      const data = fs.readFileSync(file);
      if (data.length > 10 * 1024 * 1024) throw new Error('over 10 MB');
      entries.push({ file, type, data });
    } catch (e) {
      throw new Error('Attachment ' + JSON.stringify(file) + ' could not be sent: ' + e.message);
    }
  }
  const attachments = [];
  for (const entry of entries) {
    if (entry.id) {
      attachments.push(entry.id);
      continue;
    }
    const result = await request('POST', '/api/attachments', entry.data, {
      'Content-Type': entry.type,
      'X-Name': encodeURIComponent(path.basename(entry.file)),
    });
    if (result.status !== 201 || !result.body || !/^[a-f0-9]{16}$/.test(result.body.id || ''))
      throw new Error(
        'Attachment ' +
          JSON.stringify(entry.file) +
          ' could not be sent: ' +
          ((result.body && result.body.error) || result.error || 'upload refused') +
          ' (HTTP ' +
          result.status +
          ')',
      );
    attachments.push(result.body.id);
  }
  return Object.assign({}, args, { attachments });
}

// ---------- the queue: calls the board did not receive, sent in order when it is back ----------
const readLines = f => {
  try {
    return fs
      .readFileSync(f, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => {
        try {
          return JSON.parse(l);
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
};
const writeLines = (f, items) => {
  const tmp = f + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, items.map(x => JSON.stringify(x)).join('\n') + (items.length ? '\n' : ''));
  fs.renameSync(tmp, f);
};
const queued = () => readLines(QUEUE);
const LOCK = QUEUE + '.lock';
// One process at a time reads and rewrites a file here (two sessions in one home must not lose each other's calls). The
// lock is held only for the read-modify-write, never across a request to the board, so it never goes stale while held.
async function locked(fn) {
  for (let i = 0; i < 100; i++) {
    try {
      const fd = fs.openSync(LOCK, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      break;
    } catch (e) {
      try {
        if (Date.now() - fs.statSync(LOCK).mtimeMs > 10000) fs.unlinkSync(LOCK);
      } catch (e2) {}
      await new Promise(r => setTimeout(r, 50));
    }
    if (i === 99) throw new Error('the call outbox is locked by another process');
  }
  try {
    return await fn();
  } finally {
    try {
      fs.unlinkSync(LOCK);
    } catch (e) {}
  }
}
const appendTo = (f, item) => locked(async () => writeLines(f, readLines(f).concat([item])));
const removeFrom = (f, id) =>
  locked(async () =>
    writeLines(
      f,
      readLines(f).filter(x => x.id !== id),
    ),
  );
function relayJournal() {
  try {
    return fs
      .readFileSync(RESULTS, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const item = JSON.parse(line);
        if (!item.id || (!item.state && typeof item.args?.delivered !== 'boolean'))
          throw new Error('invalid relay journal entry');
        return { ...item, state: item.state || (item.args.delivered ? 'delivered-awaiting-record' : 'blocked') };
      });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Cannot read relay-results.jsonl; reconcile it before relaying. Do not relay again.');
  }
}
function saveRelayJournal(items) {
  const temporary = RESULTS + '.tmp.' + process.pid;
  const descriptor = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(descriptor, items.map(item => JSON.stringify(item)).join('\n') + '\n');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, RESULTS);
}
async function updateRelay(id, update) {
  return locked(async () => {
    const items = relayJournal();
    const item = items.find(entry => entry.id === id);
    if (!item) throw new Error('Missing relay journal entry; do not relay again.');
    if (!['recorded', 'reconciled', 'superseded'].includes(item.state))
      Object.assign(item, update, { updated_at: new Date().toISOString() });
    saveRelayJournal(items);
    return item;
  });
}
function acceptedRelay(item, response) {
  const receipt = response.body?.results?.[0]?.relay_receipt;
  return (
    response.status >= 200 &&
    response.status < 300 &&
    response.body?.results?.length === 1 &&
    response.body.results[0].ok === true &&
    receipt?.id === item.id &&
    receipt.ticket === item.args.ticket &&
    receipt.delivered === item.args.delivered
  );
}
async function recordRelay(item) {
  const response = await request('POST', callsPath(), {
    calls: [
      {
        id: item.id,
        tool: '_relay_result',
        args: {
          ...item.args,
          ...(item.originSessionId ? { originSessionId: item.originSessionId, originEpoch: item.originEpoch } : {}),
        },
        sent_at: new Date().toISOString(),
      },
    ],
  });
  const accepted = acceptedRelay(item, response);
  const detail = scrub(
    response.body?.results?.[0]?.reason || response.body?.error || response.error || 'HTTP ' + response.status,
  ).slice(0, 400);
  await updateRelay(item.id, {
    state: accepted
      ? 'recorded'
      : response.status === 0 || response.status >= 500
        ? 'delivered-awaiting-record'
        : 'blocked',
    receipt_error: accepted ? null : detail,
    receipt_refused: response.status >= 200 && response.status < 300 && response.body?.results?.[0]?.ok === false,
  });
  return { accepted, response };
}
function relayNotice() {
  let pending;
  try {
    pending = relayJournal().filter(item => !['recorded', 'reconciled', 'superseded'].includes(item.state));
  } catch (error) {
    return '\n\nRELAY RECONCILIATION: relay journal unreadable; do not relay. Preserve relay-results.jsonl.';
  }
  return pending.length
    ? '\n\nRELAY RECONCILIATION: ' +
        pending
          .map(
            item =>
              item.id +
              ': ' +
              item.state +
              (item.args?.delivered === false ? ' (not delivered)' : '') +
              (item.receipt_error ? ' (' + item.receipt_error + ')' : ''),
          )
          .join('; ') +
        '. Kept in relay-results.jsonl. Only receipts retry; no command is sent again. Do not relay it again.'
    : '';
}
async function reconcileRelay(args) {
  if ((await DISPATCH.status()).enabled)
    throw new Error('Use the board ledger and an owner decision with independent evidence; local closure is disabled.');
  const [id, outcome, flag, ...evidenceWords] = args;
  const evidence = scrub(evidenceWords.join(' ').trim());
  if (!id || !['--delivered', '--not-delivered'].includes(outcome) || flag !== '--evidence' || !evidence)
    throw new Error('Usage: relay-reconcile <id> --delivered|--not-delivered --evidence <captain-approved evidence>');
  return locked(async () => {
    const items = relayJournal();
    const item = items.find(entry => entry.id === id);
    if (!item || !['outcome-unknown', 'blocked'].includes(item.state))
      throw new Error('Only an outcome-unknown or blocked relay can be reconciled; no entry was changed.');
    if (item.state === 'outcome-unknown' && Date.now() - Date.parse(item.updated_at) < 70000)
      throw new Error('The send may still be running. Wait 70 seconds after its last update before reconciling.');
    item.reconciliation = { delivered: outcome === '--delivered', evidence };
    item.reconciled_at = new Date().toISOString();
    item.state = 'reconciled';
    saveRelayJournal(items);
    return 'Reconciled locally: ' + id + '. Audit retained; nothing sent or posted; not a board acknowledgement.';
  });
}
let draining = false;
async function drain() {
  // in order; a call the board answered (applied, or refused and recorded by it as undelivered) leaves the queue
  if (draining) return;
  draining = true;
  try {
    let receipts = [];
    try {
      receipts = relayJournal();
    } catch (error) {}
    for (const item of receipts) {
      if (['recorded', 'reconciled', 'superseded'].includes(item.state) || item.receipt_refused) continue;
      if (item.args) {
        const { response } = await recordRelay(item);
        if (response.status === 0 || response.status >= 500) break;
      } else if (['authorized', 'sending', 'permission-requested', 'permission-consumed'].includes(item.state))
        await updateRelay(item.id, { state: 'outcome-unknown' });
    }
    if (await HANDOFF.paused()) return;
    if (await DISPATCH.drain(queued())) return;
    for (;;) {
      const item = queued()[0];
      if (!item) break;
      const r = await request('POST', callsPath(), {
        calls: [Object.assign({}, item, { queued: true, sent_at: new Date().toISOString() })],
      });
      if (r.status === 0 || r.status >= 500) break; // still away: keep the order, try later
      if (r.status === 409) {
        const view = await DISPATCH.status();
        if ((await HANDOFF.paused()) || view.enabled || view.unknown) break;
      }
      if (r.status >= 400)
        await appendTo(DEAD, {
          id: item.id,
          t: new Date().toISOString(),
          status: r.status,
          error: String((r.body && r.body.error) || '').slice(0, 300),
          tool: item.tool,
          args: item.args,
          client_at: item.client_at,
          told: false,
        }); // the route refused it: kept and told, never dropped
      await removeFrom(QUEUE, item.id);
    }
  } finally {
    draining = false;
  }
}
async function untold() {
  // queued calls a board route refused, told once in the next answer
  const dead = readLines(DEAD).filter(x => !x.told);
  if (!dead.length) return '';
  await locked(async () =>
    writeLines(
      DEAD,
      readLines(DEAD).map(x => Object.assign(x, { told: true })),
    ),
  );
  return (
    `\n\nQUEUE: ${dead.length} queued call${dead.length > 1 ? 's were' : ' was'} refused by the board before it was ` +
    `read (${dead.map(x => `${x.tool} queued ${x.client_at}: ${x.status} ${x.error}`).join('; ')}). ` +
    `Nothing of ${dead.length > 1 ? 'them' : 'it'} is on the board; redo what still matters. ` +
    'Kept in calls-undelivered.jsonl.'
  );
}
setInterval(() => {
  drain().catch(() => {});
}, 30000).unref();

// ---------- the relay: authorised by the board, which issues a single-use ticket with the exact text ----------
// read at every relay, as the key is read at every call: a session that started in shadow would otherwise go on
// dry-running its relays after the switch to tool mode, until it restarted
const shadowNow = () => process.env.LH_SHADOW === '1' || !!CFG.shadow || fs.existsSync(SHADOW_FILE);
const SHADOW = shadowNow(); // for the one-shot commands below (check, the hooks), each a process of its own
// relay.sh runs under Git for Windows' bash, as every kit script does. A bare "bash" from a process the Claude app
// started finds C:\Windows\System32\bash.exe first, which is WSL's: it reads the script's Windows path as a shell would
// and loses its backslashes. The paths go with forward slashes, which Git's bash reads as given
const fwd = p => String(p).replace(/\\/g, '/');
let BASH = null;
function bashExe() {
  if (BASH) return BASH;
  if (process.platform !== 'win32') return (BASH = 'bash');
  const tried = [process.env.LH_BASH, process.env.CLAUDE_CODE_GIT_BASH_PATH];
  try {
    for (const g of String(spawnSync('where', ['git'], { encoding: 'utf8', windowsHide: true }).stdout || '')
      .split(/\r?\n/)
      .filter(Boolean))
      tried.push(path.join(path.dirname(path.dirname(g)), 'bin', 'bash.exe'));
  } catch (e) {}
  for (const root of [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
  ])
    if (root) tried.push(path.join(root, 'Git', 'bin', 'bash.exe'));
  return (BASH =
    tried.find(p => p && !/[\\/]system32[\\/]|[\\/]WindowsApps[\\/]/i.test(p) && fs.existsSync(p)) || 'bash');
}
async function relay(args) {
  // a shadow session's relay is a dry run: the board checks it and records it for the trial, and nothing is sent
  const inShadow = shadowNow();
  if (SESSION && (await DISPATCH.status()).enabled) args = { ...args, dispatchProtocol: 'dispatch-ledger-v1' };
  if (inShadow) args = Object.assign({}, args, { dry_run: true });
  const r = await request('POST', callsPath(), {
    calls: [{ id: crypto.randomUUID(), tool: 'board_relay', args, sent_at: new Date().toISOString() }],
  });
  if (r.status === 0 || r.status >= 500)
    return {
      isError: true,
      text:
        `The board is out of reach (${scrub(r.error || r.status)}). ` +
        'A relay is never queued: nothing was sent. Try again when the board is back.',
    };
  const res = (r.body && r.body.results && r.body.results[0]) || {};
  if (!res.ok) return { isError: true, text: scrub(res.reason || (r.body && r.body.error) || 'refused') };
  // a dry run carries no ticket: it was checked before the ticket test, or every dry run read as refused
  if (args.dry_run)
    return {
      isError: false,
      text: scrub(
        res.summary +
          (inShadow ? '\nSHADOW: nothing was relayed; your lines and relay.sh still do that.' : '') +
          '\n\n' +
          (r.body.receipt || ''),
      ),
    };
  if (!r.body.ticket) return { isError: true, text: 'The board gave no relay ticket; nothing was sent.' };
  return deliverTicket(r.body.ticket);
}
async function deliverTicket(tk) {
  if (crypto.createHash('sha256').update(tk.text).digest('hex') !== tk.hash)
    return { isError: true, text: 'The relay ticket did not check out; nothing was sent.' };
  const id = 'relay-result-' + tk.id;
  const previous = await locked(async () => {
    const items = relayJournal();
    if (tk.ledgerVersion === 1)
      for (const item of items)
        if (item.intent?.id === tk.intentId && item.intent.attemptId !== tk.attemptId) {
          item.state = 'superseded';
          item.supersededByAttempt = tk.attemptId;
        } else if (
          item.intent?.ledgerVersion === 1 &&
          item.intent.id !== tk.intentId &&
          item.intent.to === tk.to &&
          item.intent.hash === tk.hash
        ) {
          item.state = 'reconciled';
          item.reconciledByIntent = tk.intentId;
        }
    const existing = items.find(
      item =>
        item.id === id ||
        (tk.ledgerVersion !== 1 &&
          !['recorded', 'reconciled', 'superseded'].includes(item.state) &&
          (!item.intent || (item.intent.to === tk.to && item.intent.hash === tk.hash))),
    );
    if (existing) return existing;
    items.push(require('./session-identity.cjs').relayEntry(SESSION, id, tk));
    saveRelayJournal(items);
    return null;
  });
  if (previous)
    return {
      isError: true,
      text:
        'This delivery already has a journal entry (' +
        previous.id +
        ': ' +
        previous.state +
        '). Reconcile relay-results.jsonl. Do not relay it again.',
    };
  try {
    await DISPATCH.consume(tk, id);
  } catch (error) {
    return { isError: true, text: scrub(error.message) + relayNotice() };
  }
  // one file per relay: concurrent relays never send each other's text
  const f = path.join(HERE, 'inbox', `relay-${tk.id}.txt`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, tk.text);
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    SYSTEMROOT: process.env.SYSTEMROOT,
  }; // no token in the relay's environment
  await updateRelay(id, { state: 'sending' });
  let sh;
  try {
    sh = spawnSync(bashExe(), [fwd(path.join(HERE, 'relay.sh'))].concat(tk.again ? ['--again'] : [], [tk.to, fwd(f)]), {
      encoding: 'utf8',
      timeout: 60000,
      env,
    });
  } catch (error) {
    sh = { status: null, stderr: 'The delivery process did not return a result.' };
  }
  const output = ((sh.stdout || '') + (sh.stderr || '')).trim();
  const delivered = sh.status === 0 && !sh.error && !sh.signal;
  const notDelivered =
    Number.isInteger(sh.status) &&
    sh.status !== 0 &&
    !sh.error &&
    !sh.signal &&
    /^(?:FAILED \(exit \d+\): )?(?:SKIPPED|REFUSED|NO ROUTE YET|usage)\b/.test(output);
  const detail = scrub(output.slice(-400));
  try {
    fs.unlinkSync(f);
  } catch (e) {}
  let receipt;
  try {
    if (!delivered && !notDelivered) {
      await updateRelay(id, { state: 'outcome-unknown', detail });
      return { isError: true, text: 'Delivery outcome unknown: ' + detail + relayNotice() };
    }
    const item = await updateRelay(id, {
      state: 'delivered-awaiting-record',
      args: {
        ticket: tk.id,
        delivered,
        detail,
        ...(tk.evidenceCapability ? { evidenceCapability: tk.evidenceCapability } : {}),
      },
    });
    receipt = await recordRelay(item);
  } catch (error) {
    return {
      isError: true,
      text:
        'Delivery may have completed, but its receipt could not be saved. ' +
        'Reconcile relay-results.jsonl (' +
        id +
        '). Do not relay it again.',
    };
  }
  const r2 = receipt.response;
  const res2 = r2.body?.results?.[0] || {};
  if (!receipt.accepted)
    return {
      isError: true,
      text: scrub(
        (delivered ? 'Delivered' : 'Not delivered') + ', but the board has not accepted its receipt.' + relayNotice(),
      ),
    };
  if (!delivered) return { isError: true, text: detail };
  return {
    isError: false,
    text: scrub((res2.summary || 'Relayed; recorded.') + '\n\n' + (r2.body?.receipt || '')),
  };
}

// ---------- one call ----------
async function call(tool, args, bypassHandoff = false) {
  if (tool === 'board_kit_status') return { text: KIT.status() };
  if (tool === 'board_dispatch') return DISPATCH.tool(args || {});
  const special = !bypassHandoff && (await HANDOFF.intercept(tool, args, () => call(tool, args, true)));
  if (special) return special;
  const spec = SPEC.tools.find(t => t.name === tool);
  if (!spec)
    return {
      isError: true,
      text: `There is no tool ${tool}. The tools are: ${SPEC.tools.map(t => t.name).join(', ')}.`,
    };
  const size = Buffer.byteLength(JSON.stringify(args || {}));
  if (size > MAX_ARGS)
    return {
      isError: true,
      text:
        `The call is ${Math.round(size / 1024)} KB; the board takes up to ${MAX_ARGS / 1024} KB. ` +
        'Shorten it, or put the long part in a file and attach it.',
    };
  if (tool === 'board_relay') return relay(args || {});
  if (tool === 'board_post' || tool === 'board_reply' || tool === 'board_batch') {
    try {
      if (tool === 'board_batch' && Array.isArray(args?.calls)) {
        const calls = [];
        for (const entry of args.calls) {
          if (entry && (entry.tool === 'board_post' || entry.tool === 'board_reply')) {
            const uploaded = await uploadAttachments(entry.args || {}, args.dry_run || entry.args?.dry_run);
            calls.push({ ...entry, args: uploaded });
          } else calls.push(entry);
        }
        args = { ...args, calls };
      } else args = await uploadAttachments(args || {});
    } catch (e) {
      return { isError: true, text: scrub(e.message) };
    }
  }
  const id = crypto.randomUUID();
  const item = require('./session-identity.cjs').queuedCall(SESSION, id, tool, args);
  await drain().catch(() => {});
  const told =
    (await untold().catch(() => '')) +
    relayNotice() +
    (DISPATCH.enabled() && queued().length
      ? '\nQUEUE REVIEW: retained calls require board_dispatch inventory and explicit adoption or supersession.'
      : '');
  const ledgerQueue = queued().length && (await DISPATCH.status()).enabled;
  if (queued().length && tool !== 'board_status' && !ledgerQueue) {
    await appendTo(QUEUE, item);
    return { isError: false, text: `Queued behind earlier calls (they go in order). Call id ${id}.${told}` };
  }
  let r;
  for (let tries = 0; ; tries++) {
    // to: "chat" waits for the collector to report his words: a few short retries here, never a wait on the board
    r = await request('POST', callsPath(), { calls: [Object.assign({}, item, { sent_at: new Date().toISOString() })] });
    const rs = (r.body && r.body.results && r.body.results[0]) || {};
    if (!(rs.ok === false && rs.retry && tries < 3)) break;
    await new Promise(res => setTimeout(res, rs.retry * 1000));
  }
  if (r.status === 0 || r.status >= 500) {
    if (tool === 'board_status')
      return { isError: true, text: `The board is out of reach (${scrub(r.error || r.status)}).${told}` };
    await appendTo(QUEUE, item);
    return {
      isError: false,
      text:
        (DISPATCH.enabled()
          ? `The board is out of reach. Retained as ${id}; review and adopt it with board_dispatch after reconnect.`
          : `The board is out of reach (${scrub(r.error || r.status)}). Queued as ${id}; ` +
            'it goes when the board is back, ' +
            'and the board will tell you if it refuses it then. Nothing to repeat.') + told,
    };
  }
  const res = (r.body && r.body.results && r.body.results[0]) || {};
  const receipt = ((r.body && r.body.receipt) || '') + told;
  if (r.status >= 400 || res.ok === false)
    return {
      isError: true,
      text: scrub(`${res.reason || (r.body && r.body.error) || 'refused'}${receipt ? '\n\n' + receipt : ''}`),
    };
  if (tool === 'board_handoff' && r.body.handoff && !(args || {}).dry_run) {
    fs.writeFileSync(path.join(HERE, 'handoff.md'), r.body.handoff);
  }
  const rules =
    tool === 'board_shift' && args && args.action === 'compacted'
      ? '\n\nRULES\n' +
        (SPEC.instructions || '') +
        (res.pickup && res.pickup.note
          ? '\n\nYOUR PICKUP NOTE (' + (res.pickup.noteAt || res.pickup.t) + ')\n' + res.pickup.note
          : '\n\nNo pickup note was written before this compaction: read board_status(detail: "full").')
      : '';
  return {
    isError: false,
    text: scrub(
      `${res.summary || 'done'}${tool === 'board_handoff' ? ' Written to handoff.md in your home.' : ''}` +
        `${receipt ? '\n\n' + receipt : ''}${rules}`,
    ),
  };
}

const { check, here, installHooks, hook } = require('./mcp-setup.cjs')({
  HERE,
  TRANSCRIPTS,
  SESSION_DIR,
  TRANSCRIPT_DIR,
  SPEC,
  SHADOW,
  call,
});

// ---------- MCP over stdio ----------
const out = msg => process.stdout.write(JSON.stringify(msg) + '\n');
async function onMessage(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    KIT.report();
    return out({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'lighthouse', version: (SPEC.version || '0') + '+' + KIT.loaded },
        instructions: (SPEC.instructions || '') + '\n' + KIT.notice(),
      },
    });
  }
  if (method === 'notifications/initialized' || (method && method.startsWith('notifications/'))) return;
  if (method === 'ping') return out({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list')
    return out({
      jsonrpc: '2.0',
      id,
      result: {
        tools: SPEC.tools
          .concat((await DISPATCH.status()).available ? require('./dispatch-client.cjs').tools : [])
          .concat((await HANDOFF.supported()) ? require('./handoff.cjs').tools : [])
          .map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      },
    });
  if (method === 'tools/call') {
    let r;
    try {
      KIT.report();
      r = await call(params && params.name, (params && params.arguments) || {});
      const notice = KIT.notice();
      if (notice) r.text += '\n' + notice;
    } catch (e) {
      r = { isError: true, text: scrub('The tool failed: ' + e.message) };
    }
    return out({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: r.text }], isError: !!r.isError } });
  }
  if (id !== undefined) out({ jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown method ' + method } });
}

if (process.argv[2] === 'call') {
  let args = {};
  try {
    args = process.argv[4] ? JSON.parse(process.argv[4]) : {};
  } catch (e) {
    console.error('the arguments must be JSON');
    process.exit(2);
  }
  call(process.argv[3], args)
    .then(r => {
      console.log(r.text);
      process.exit(r.isError ? 1 : 0);
    })
    .catch(error => {
      console.error(scrub(error.message));
      process.exit(1);
    });
} else if (process.argv[2] === 'shift') {
  require('./shift-session.cjs')
    .edge(request, BOARD, process.argv[3])
    .then(message => console.log(message))
    .catch(error => {
      console.error(scrub(error.message));
      process.exitCode = 1;
    });
} else if (['dispatch-export', 'dispatch-import'].includes(process.argv[2])) {
  (async () => {
    const view = await DISPATCH.status();
    if (!view.available || !view.targetBinding) throw new Error('connect to the board ledger before evidence transfer');
    const [file, keyFile] = process.argv.slice(3);
    if (!file || !keyFile) throw new Error('supply the evidence file path and a separate private key file path');
    const transfer = require('./dispatch-transfer.cjs');
    const result = await locked(() =>
      process.argv[2] === 'dispatch-export'
        ? transfer.exportEvidence({
            home: HERE,
            board: BOARD,
            destination: file,
            keyFile,
            targetBinding: view.targetBinding,
            includeCursors: view.recoveryEnabled === true,
          })
        : transfer.importEvidence({
            home: HERE,
            board: BOARD,
            source: file,
            keyFile,
            targetBinding: view.targetBinding,
          }),
    );
    if (process.argv[2] === 'dispatch-import') await DISPATCH.inventory();
    console.log(JSON.stringify(result));
  })().catch(error => {
    console.error(scrub(error.message));
    process.exitCode = 1;
  });
} else if (process.argv[2] === 'relay-reconcile') {
  reconcileRelay(process.argv.slice(3))
    .then(message => console.log(message))
    .catch(error => {
      console.error(scrub(error.message));
      process.exitCode = 1;
    });
} else if (process.argv[2] === 'check') {
  process.exit(check(process.argv.slice(3)));
} else if (process.argv[2] === 'here') {
  process.exit(here());
} else if (process.argv[2] === 'install-hooks') {
  process.exit(installHooks(process.argv.slice(3)));
} else if (process.argv[2] === 'hook') {
  hook(process.argv[3])
    .catch(() => 0)
    .then(() => process.exit(0));
} else {
  const stopHeartbeat = require('./shift-session.cjs').watch({
    request,
    board: BOARD,
    shadow: shadowNow,
    identity: SESSION,
  });
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        continue;
      }
      onMessage(msg).catch(() => {});
    }
  });
  process.stdin.on('end', () => {
    stopHeartbeat();
    process.exit(0);
  });
}
