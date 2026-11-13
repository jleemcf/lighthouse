#!/usr/bin/env node
// Lighthouse board server: a small, dependency-free Node service that holds the board's store in one JSON file,
// serves the board page, and gives scripts and browsers one API. It runs on a machine in the owner's private network.
//
//   node server.js --config config.json                  start (foreground)
//   node server.js --config config.json import x.json    load boards/cards/comments from a JSON export, then exit
//   node server.js --config config.json archive --board lighthouse [--days 7] [--out DIR]
//                                                        archive old Done cards, then exit
//
// Identity: every request carries a principal. A bearer token (Authorization header, or ?token= on the page's
// first visit) maps to a named principal in config.tokens; when the request arrives from Tailscale's own front door
// (loopback, config.trustTailscaleHeaders true) the Tailscale-User-Login header is the principal. Every write is
// stamped with the principal the SERVER resolved, never a name inside the payload. Roles per board come from
// config.boards[id].access: viewer < commenter < operator < owner.
//
// Change feed: every mutation bumps store.seq and appends {seq,t,kind,id,by,board}; GET /api/changes?since=N is
// the cheap poll for watcher scripts, GET /api/stream is server-sent events for the page.
//
// This file reads the command line and the config, makes the parts in order and starts the HTTP server. The parts:
// store.js (the store file, saving, the change feed), web.js (identity, roles, reading and answering a request),
// notify.js (push to the owner's devices), weather.js, transcript.js, grammar.js (the line grammar), notes.js (the
// board's notes to an operator), jev.js (Jev's judgments), replies.js (the conversation messages a line makes),
// crm.js (the CRM question lane), stale.js (stale-card reminders), doorbells.js (card wake-ups), events.js (one line
// applied), conduct.js (the conduct report), and the routes: routes.js, routes-messages.js, routes-cards.js,
// routes-operator.js, routes-steward.js and routes-shift.js. steward.js and toolcalls.js are made after the import
// and archive exits, alongside shift.js; the route handlers are joined afterward before the HTTP listener starts.
'use strict';
const http = require('http'),
  fs = require('fs'),
  path = require('path');

const args = process.argv.slice(2);
const argv = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--'))
    argv[args[i].slice(2)] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
  else argv._ = (argv._ || []).concat(args[i]);
}
const CONFIG_PATH = argv.config || path.join(__dirname, 'config.json');
const cfg = require('./configuration').normalize(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')), CONFIG_PATH);
const runtimeStore = path.resolve(path.dirname(CONFIG_PATH), cfg.storeFile || 'store.json');
const releaseRuntime = require('./registry-lease').acquire(runtimeStore + '.runtime.lock');
process.once('exit', releaseRuntime);
require('./release-check').compatible(__dirname, runtimeStore);
const localRulings = cfg.rulingsFile && path.resolve(path.dirname(CONFIG_PATH), cfg.rulingsFile);

// Every part is made from one shared context, ctx, and adds what it makes to it. A value a part takes from ctx when
// it is made is one that never changes afterwards (the store object, the config, a function); a part that needs
// something made after it reaches it through ctx when it is called (ctx.deliverReply in notes.js, and ctx.ST and
// ctx.TC, set below).
const ctx = { argv, cfg, CONFIG_PATH, compatibility: require('./compatibility').codec(cfg) };
ctx.registry = require('./registry').makeRegistry(cfg, CONFIG_PATH);
if (ctx.registry.persistent) {
  const differences = ctx.registry.reconcile().changes;
  if (differences.length)
    console.warn('registry configuration differs; use registry-cli reconcile: ' + JSON.stringify(differences));
}
ctx.registry.attach();
ctx.enrollment = require('./enrollment').makeEnrollment(ctx.registry, cfg);
const shifts = require('./shift');
Object.assign(ctx, require('./store')(ctx));
ctx.registry.ensureBoards(ctx.store);
ctx.lifecycle = require('./registry-lifecycle').makeLifecycle(ctx.registry, ctx);
const { STORE, ATTACH, store, now, newId, change, save, saveNow } = ctx;
// a stop (board.sh stop, a deploy) takes no new writes, lets the ones under way answer (up to three seconds), then
// saves and exits: a restart must not cut off the answer to a Send, or the page says "not sent" for a message that
// arrived, and it is sent again
let stopping = false,
  inflight = 0;
for (const sig of ['SIGTERM', 'SIGINT'])
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    const t0 = Date.now();
    const done = () => {
      ctx.closeDoorbells?.();
      try {
        saveNow();
      } catch (e) {
        console.log('save on stop failed: ' + e.message);
      }
      process.exit(0);
    };
    const tick = () => (inflight === 0 || Date.now() - t0 > 3000 ? done() : setTimeout(tick, 50));
    tick();
  });
Object.assign(ctx, require('./web')(ctx));
ctx.ownership = require('./ownership')(ctx);
ctx.handoff = require('./handoff')(ctx);
ctx.dispatchLedger = require('./dispatch-ledger')(ctx);
ctx.activation = require('./handoff-activation')(ctx);
ctx.mutations = require('./mutation-routes')(ctx);
Object.assign(ctx, require('./attachments')(ctx));
Object.assign(ctx, require('./doorbells')(ctx));
Object.assign(ctx, require('./notify')(ctx));
Object.assign(ctx, require('./weather')(ctx));
Object.assign(ctx, require('./transcript')(ctx));
Object.assign(ctx, require('./grammar')(ctx));
Object.assign(ctx, require('./notes')(ctx));
Object.assign(ctx, require('./jev')(ctx));
Object.assign(ctx, require('./replies')(ctx));
Object.assign(ctx, require('./crm')(ctx));
Object.assign(ctx, require('./stale')(ctx));
Object.assign(ctx, require('./events')(ctx));
Object.assign(ctx, require('./conduct')(ctx));
Object.assign(ctx, require('./routes-messages')(ctx));
Object.assign(ctx, require('./routes-cards')(ctx));
Object.assign(ctx, require('./routes-operator')(ctx));
Object.assign(ctx, require('./registry-routes').makeRegistryRoutes(ctx));
Object.assign(ctx, require('./routes')(ctx));
const { send, roleOn, notify, VAPID_FILE, typesafeKey, judgeComment, judgeCard, CRM, crmKey, crmSend } = ctx;
const { pushLog, pushActivity, slugOf, attsOf, noteOperatorMessage, handle } = ctx;
const { importData, archiveDone, ARCHIVE_DIR } = ctx;

if (argv._ && argv._[0] === 'import') {
  const data = ctx.compatibility.read(JSON.parse(fs.readFileSync(argv._[1], 'utf8')));
  const r = importData(data, 'import');
  saveNow();
  console.log(JSON.stringify(r));
  process.exit(0);
}

// the archive command (store.js archiveDone): board.sh archive and board.sh clear-cards stop the server first
if (argv._ && argv._[0] === 'archive') {
  const board = argv.board || cfg.defaultBoard;
  if (!board || !store.boards[board]) {
    console.error('archive: --board <id> required; known boards: ' + Object.keys(store.boards).join(', '));
    process.exit(2);
  }
  const moved = archiveDone(
    board,
    Number(argv.days || 7),
    argv.out || ARCHIVE_DIR(),
    argv.all ? 'clear-cards command' : 'archive command',
    !!argv.all,
  );
  saveNow();
  console.log(JSON.stringify({ archived: moved, out: argv.out || ARCHIVE_DIR() }));
  process.exit(0);
}

const ST = require('./steward')({
  store: () => store,
  registry: ctx.registry,
  cfg,
  now,
  newId,
  change,
  notify,
  save,
  saveNow,
  roleOn,
  attachDir: ATTACH,
  rulingsFile: localRulings && fs.existsSync(localRulings) ? localRulings : path.join(__dirname, 'rulings.json'),
  secrets: () => [
    CRM ? crmKey() : '',
    typesafeKey(),
    (() => {
      try {
        return JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8')).privateKey || '';
      } catch (e) {
        return '';
      }
    })(),
  ],
});
const TC = require('./toolcalls')({
  holdPing: (...a) => ST.holdPing(...a),
  store: () => store,
  cfg,
  now,
  newId,
  change,
  notify,
  crmSend,
  judgeComment,
  judgeCard,
  pushLog,
  pushActivity,
  slugOf,
  roleOn,
  canNotice: ctx.canNotice,
  ownership: ctx.ownership,
  dispatchLedger: ctx.dispatchLedger,
  authorizeCall: (board, who, payload) =>
    ctx.mutations.authorize({ p: '/api/boards/' + board + '/calls', who, payload }, {}, [board]),
  transact: ctx.transact,
  inTransaction: ctx.inTransaction,
  attsOf,
  attachmentError: ctx.attachmentError,
  noteOperatorMessage,
  saveNow,
  save,
});
ctx.ST = ST;
ctx.TC = TC;
shifts.watch(ctx);
const server = http.createServer((req, res) => {
  shifts.sweep(ctx);
  // while stopping, a write is told to come back; a write under way is counted, so the stop waits for its answer; a
  // slow one is logged
  if (stopping && req.method !== 'GET') {
    try {
      send(res, 503, { error: 'the board is restarting: send again in a few seconds' });
    } catch {}
    return;
  }
  if (req.method !== 'GET') {
    inflight++;
    let open = true;
    const t0 = Date.now();
    const end = () => {
      if (!open) return;
      open = false;
      inflight--;
      const ms = Date.now() - t0;
      if (ms > 3000) console.log(`slow: ${req.method} ${String(req.url || '').split('?')[0]} took ${ms} ms`);
    };
    res.on('finish', end);
    res.on('close', end);
  }
  handle(req, res).catch(e => {
    try {
      send(res, e.status || 500, { error: e.status ? e.message : 'board write failed; retry after recovery' });
    } catch {}
  });
});
// An idle connection stays open 65 s: Node's default of 5 s equals the board watch's poll interval, so a poll now and
// then would go down a connection the server was closing that instant (socket hang up, ECONNRESET).
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.listen(cfg.port || 7700, cfg.bind || '0.0.0.0', () =>
  console.log(
    `lighthouse board server listening on ${cfg.bind || '0.0.0.0'}:${
      cfg.port || 7700
    }, store ${STORE}, boards ${Object.keys(store.boards).join(', ')}`,
  ),
);
