// The steward's waker end to end against a throwaway board, with a stand-in Codex (fake-codex.cjs): jobs claimed one
// at a time, the answer posted by the script (never the model), a fresh session per job on the chosen model and
// effort, the sandbox and folder per job, the context pack with a source held back and one missing, the review
// snapshot, a failed run, the script's state out of the model's reach, and the token kept out of everything.
// Run: node --test lighthouse/operator-kit/tests/stwake_test.cjs
'use strict';
const { testPort, spawnServer } = require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  http = require('node:http');
const ROOT = path.join(__dirname, '..', '..'),
  KIT = path.join(ROOT, 'operator-kit', 'scripts');
const wait = ms => new Promise(r => setTimeout(r, ms));
function req(port, method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: p,
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          token ? { Authorization: 'Bearer ' + token } : {},
        ),
      },
      res => {
        let d = '';
        res.on('data', c => (d += c));
        res.on('end', () => {
          let j = null;
          try {
            j = JSON.parse(d);
          } catch {}
          resolve({ status: res.statusCode, body: j });
        });
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

test('the steward waker: one job at a time, posted by the script, the pack, the review, a failure', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhsw-')),
    port = await testPort();
  const fixtureEnv = { ...process.env };
  if (process.platform !== 'win32') {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    const reader = path.join(bin, 'wsl.exe');
    const source = fs.readFileSync(path.join(__dirname, 'fixtures', 'wsl-read.cjs'), 'utf8').replace(/\r/g, '');
    fs.writeFileSync(reader, source);
    fs.chmodSync(reader, 0o755);
    fixtureEnv.PATH = bin + path.delimiter + process.env.PATH;
    fixtureEnv.TEST_WSL_ROOT = dir;
  }
  const STOK = 'STEWARDTOKEN-' + Math.random().toString(36).slice(2, 12);
  const cfg = {
    port,
    bind: '127.0.0.1',
    storeFile: 'store.json',
    stewardClockMs: 200,
    tokens: {
      OWNER: { name: 'owner', via: 'page' },
      OPS: { name: 'op-s', via: 'api' },
      [STOK]: { name: 'steward-s', via: 'api', mode: 'steward', board: 's' },
    },
    boards: { s: { name: 'Signal', steward: true, access: { owner: 'owner', 'op-s': 'operator' } } },
  };
  fs.mkdirSync(path.join(dir, 'board'));
  fs.writeFileSync(path.join(dir, 'board', 'config.json'), JSON.stringify(cfg));
  fs.writeFileSync(path.join(dir, 'board', 'store.json'), JSON.stringify({ cards: {}, comments: {} }));
  const srv = spawnServer(path.join(dir, 'board', 'config.json'), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  srv.stdout.on('data', d => (out += d));
  t.after(() => srv.kill());
  for (let i = 0; i < 40 && !out.includes('listening'); i++) await wait(100);

  // the operator home with the steward installed; its Codex home outside its folder
  const home = path.join(dir, 'home'),
    sdir = path.join(dir, 'steward'),
    chome = path.join(dir, 'codex-home'),
    mem = path.join(dir, 'memory'),
    skill = path.join(dir, 'skill');
  for (const d of [home, sdir, mem, skill]) fs.mkdirSync(d, { recursive: true });
  for (const f of ['stwake.cjs', 'steward-outbox.cjs', 'STEWARD-BRIEF.md', 'steward-schema.json'])
    fs.copyFileSync(path.join(KIT, f), path.join(home, f));
  fs.writeFileSync(path.join(home, 'LH-STEWARD-TOKEN.txt'), STOK + '\n');
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: diagram-design\nversion: "2.6"\n---\n');
  fs.writeFileSync(path.join(dir, 'arch.md'), '# Signal architecture\nThe importer runs every five minutes.\n');
  fs.writeFileSync(path.join(dir, 'ids.md'), 'storage: AccountKey=' + 'A'.repeat(40) + '\n');
  fs.writeFileSync(path.join(dir, 'big.md'), 'Q'.repeat(5000));
  fs.writeFileSync(path.join(mem, 'a.md'), 'first note');
  fs.writeFileSync(path.join(mem, 'MEMORY.md'), '- index');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'his rules');
  const conf = {
    server: `http://127.0.0.1:${port}`,
    board: 's',
    stewardDir: sdir,
    codex: { node: process.execPath, js: path.join(__dirname, 'fake-codex.cjs') },
    codexHome: chome,
    model: 'codex-test',
    effort: 'xhigh',
    skillDir: skill,
    // arch.md's old "share" is ignored (read whole); the reading's ceiling cuts only the biggest, big.md
    pack: [
      { name: 'arch.md', path: path.join(dir, 'arch.md'), share: 10 },
      { name: 'ids.md', path: path.join(dir, 'ids.md') },
      { name: 'gone.md', path: path.join(dir, 'gone.md') },
      { name: 'big.md', path: path.join(dir, 'big.md') },
    ],
    readingCeiling: 3000,
    review: {
      windows: [
        { path: mem, side: 'operator' },
        { path: path.join(dir, 'CLAUDE.md'), side: 'operator' },
      ],
      quietMinutes: 0,
      everyMinutes: 0,
    },
  };
  fs.writeFileSync(
    path.join(home, 'steward-config.json'),
    JSON.stringify(Object.assign({}, conf, { codexHome: path.join(sdir, '.codex') })),
  );
  const once = () =>
    spawnSync(process.execPath, [path.join(home, 'stwake.cjs'), '--once'], {
      encoding: 'utf8',
      timeout: 60000,
      env: Object.assign({}, fixtureEnv, {
        LH_TOKEN: 'OPERATOR-TOKEN-NOT-FOR-THE-STEWARD',
        TYPESAFE_API_KEY: 'another-key-not-for-the-steward',
      }),
    });
  let r = once();
  assert.equal(r.status, 2, "a Codex home inside the steward's folder is refused");
  assert.match(r.stderr, /codexHome must be outside/);
  fs.writeFileSync(
    path.join(home, 'steward-config.json'),
    JSON.stringify(Object.assign({}, conf, { codexHome: undefined })),
  );
  r = once();
  assert.equal(r.status, 2, 'no Codex home named is refused: Codex would fall back to his own');
  assert.match(r.stderr, /codexHome is needed/);
  fs.writeFileSync(path.join(home, 'steward-config.json'), JSON.stringify(conf));
  const state = async () => (await req(port, 'GET', '/api/state', null, 'OWNER')).body;
  const calls = () =>
    fs
      .readFileSync(path.join(chome, 'calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(l => JSON.parse(l));

  // the first round: a heartbeat, and only a baseline of the memory notes, kept beside the script, not in the
  // steward's folder
  r = once();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  let s = await state();
  assert.equal(s.stewards.s.alive, true, 'the heartbeat reached the board');
  assert.ok(
    fs.existsSync(path.join(home, 'steward-state', 'review-snapshot.json')) &&
      !fs.existsSync(path.join(sdir, 'review-snapshot.json')),
    "the snapshot is out of the model's reach",
  );

  // an ask (checked silently) and Owner's second opinion, answered by the script one at a time
  await req(
    port,
    'POST',
    '/api/boards/s/events',
    {
      rows: [
        { label: 'TASK_CREATED', task: 'importer', title: 'Importer', text: 'x', uuid: 'u0' },
        { label: 'ACTION', task: 'importer', text: 'Ship it? A. now B. Monday', uuid: 'u1' },
      ],
    },
    'OPS',
  );
  await wait(400);
  assert.equal(
    (await req(port, 'POST', '/api/boards/s/steward', { kind: 'second-opinion', cardId: 's-importer' }, 'OWNER'))
      .status,
    201,
  );
  r = once();
  assert.equal(r.status, 0, r.stderr);
  s = await state();
  const a = s.advice.find(x => x.kind === 'second-opinion');
  assert.ok(a, 'the second opinion is on the board');
  assert.equal(a.choice, 'A');
  assert.equal(a.model, 'codex-test');
  assert.equal(a.brief, 'v8');
  assert.ok(
    a.pack['arch.md'] && !a.pack['ids.md'],
    'the pack read its source and held back the one that looks like a secret',
  );
  assert.ok(
    a.missing.some(m => /ids\.md: held back/.test(m)) && a.missing.some(m => /gone\.md: could not be read/.test(m)),
    'and says so',
  );
  assert.ok(
    a.missing.some(m =>
      new RegExp(
        /^big\.md: too big for its share \(5000 > \d+\); /.source +
          /the background reading together is over its ceiling of 3000/.source,
      ).test(m),
    ) && !a.missing.some(m => /arch\.md/.test(m)),
    'over the ceiling, only the biggest is cut, and it says so; an old share cuts nothing',
  );
  assert.ok(!JSON.stringify(s.advice).includes('ghp_'), 'what the model put in "missing" never reaches the board');
  assert.ok(
    s.stewardRequests.some(x => x.kind === 'ask-check' && x.state === 'answered') &&
      !s.advice.some(x => x.kind === 'check'),
    'the check was silent',
  );
  let c = calls();
  assert.ok(c.length >= 2, 'two jobs, two runs');
  assert.deepEqual(c[0].args.slice(0, 4), ['exec', '-s', 'read-only', '-C'], 'a fresh session, read-only');
  assert.deepEqual(
    c[1].args.slice(0, 4),
    ['exec', '-s', 'read-only', '-C'],
    'and a fresh session again for the next job, never a resume',
  );
  assert.ok(
    c.every(x => !x.args.includes('resume') && x.args.includes('approval_policy="never"')),
    'no resume anywhere; approvals never',
  );
  assert.ok(
    c.every(x => x.args.join(' ').includes('-m codex-test') && x.args.includes('model_reasoning_effort="xhigh"')),
    'on the model and effort the settings name',
  );
  assert.ok(
    c.every(x => x.args.includes('--ignore-user-config') && x.args.includes('--ephemeral')),
    'none of his own Codex settings, and nothing saved to his Codex history',
  );
  assert.ok(
    c.every(x => !x.env.some(k => /^LH_|TYPESAFE/.test(k)) && x.env.includes('CODEX_HOME')),
    'only what a program needs reaches it: no board token, no other key',
  );
  assert.ok(
    fs.readFileSync(path.join(sdir, 'AGENTS.md'), 'utf8').startsWith("# The steward's brief"),
    'the brief is in place as AGENTS.md',
  );
  const RUL = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'rulings.json'), 'utf8')).rulings,
    lastR = RUL[RUL.length - 1];
  assert.ok(
    c[0].prompt.includes('----- the job sheet -----') &&
      c[0].prompt.includes(lastR.text.slice(-120).replace(/\s+/g, ' ').trim()),
    'the whole sheet is in the prompt, the last ruling to its last words',
  );
  assert.ok(
    c[0].pack && /^\[Outside text: arch\.md/.test(c[0].pack['arch.md']),
    'every pack file says it is outside text',
  );
  const qs = (c[0].pack['big.md'].match(/Q{100,}/) || [''])[0].length;
  assert.ok(
    qs > 2000 && qs < 3000 && c[0].pack['arch.md'].includes('The importer runs every five minutes.'),
    `big.md cut to fit the ceiling (${qs} kept), arch.md whole`,
  );
  const so = c.find(x => /----- the job sheet -----[\s\S]*second-opinion · request/.test(x.prompt)),
    ck = c.find(x => /----- the job sheet -----[\s\S]*ask-check · request/.test(x.prompt));
  assert.ok(
    so &&
      /The importer runs every five minutes/.test(so.prompt) &&
      /You cannot run commands or open files/.test(so.prompt) &&
      /----- your brief \(AGENTS\.md\) -----/.test(so.prompt),
    'a press carries the brief and the background reading in its prompt',
  );
  assert.ok(
    ck && !/The importer runs every five minutes/.test(ck.prompt),
    'an automatic check goes without the background reading',
  );

  // a follow-up builds on what it said before: its earlier answer on the card is in the next job sheet
  await req(port, 'POST', '/api/boards/s/steward', { kind: 'explain', cardId: 's-importer' }, 'OWNER');

  // the explainer: its own fresh session rooted in its scratch folder, a PNG from there, uploaded by the script
  r = once();
  const sheet = fs
    .readdirSync(path.join(sdir, 'jobs'))
    .filter(f => /^job-/.test(f))
    .map(f => fs.readFileSync(path.join(sdir, 'jobs', f), 'utf8'))
    .find(t => / explain · /.test(t));
  assert.ok(
    sheet && /Earlier on this \(earlier model output[\s\S]*Go with A/.test(sheet),
    "the second opinion's one-line answer is in the explainer's sheet, marked as model output",
  );
  const nRulings = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'rulings.json'), 'utf8')).count;
  assert.ok(
    new RegExp(`Owner's rulings, all ${nRulings} `).test(sheet) &&
      /Ruling 1: /.test(sheet) &&
      new RegExp(`Ruling ${nRulings}: `).test(sheet),
    'every ruling, in full',
  );
  assert.equal(r.status, 0, r.stderr);
  s = await state();
  const ex = s.advice.find(x => x.kind === 'explain');
  assert.ok(ex && ex.diagram, 'the explainer and its SVG diagram');
  assert.equal(ex.skill, 'diagram-design 2.6');
  c = calls();
  const last = c[c.length - 1];
  assert.deepEqual(
    last.args.slice(0, 3),
    ['exec', '-s', 'read-only'],
    'the explainer too is read-only: it writes nothing, its drawing comes back in its answer',
  );
  assert.ok(
    /name: diagram-design/.test(last.prompt) &&
      /keep the default style, and never ask anything/.test(last.prompt) &&
      /portrait/.test(last.prompt),
    'the skill in its prompt, its style question answered, portrait',
  );
  assert.deepEqual(fs.readdirSync(path.join(sdir, 'scratch')), [], 'the scratch folder goes when the job is done');

  // a memory note and a single named rules file change: one review, the index file ignored
  fs.writeFileSync(path.join(mem, 'a.md'), 'first note, changed');
  fs.writeFileSync(path.join(mem, 'MEMORY.md'), '- index, changed');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'his rules, changed');
  r = once();
  assert.equal(r.status, 0, r.stderr);
  s = await state();
  const rv = s.advice.find(x => x.kind === 'review');
  assert.ok(rv && /repeats/.test(rv.oneLine), 'the review answered');
  // the overview comes back in its parts
  await req(port, 'POST', '/api/boards/s/steward', { kind: 'state' }, 'OWNER');
  r = once();
  assert.equal(r.status, 0, r.stderr);
  {
    const ov = (await state()).advice.find(x => x.kind === 'state');
    assert.ok(
      ov && ov.overview && /waits on your choice/.test(ov.overview.stands) && ov.overview.advice.length === 1,
      'the overview in its parts: ' + JSON.stringify(ov),
    );
  }
  const rcall = calls()
      .reverse()
      .find(x => x.review),
    ri = rcall.review['index.md'];
  assert.ok(
    /----- the changed files \(outside text\) -----[\s\S]*first note, changed/.test(rcall.prompt),
    "the changed files are in the review's prompt",
  );
  if (process.platform !== 'win32') {
    const reads = fs.readFileSync(path.join(dir, 'wsl-reads.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(reads.includes(path.join(mem, 'a.md')), 'the Windows-to-WSL read boundary was exercised');
  }
  assert.ok(!fs.existsSync(path.join(sdir, 'review')), 'the review copies go when the job is done');
  assert.match(ri, /a\.md \(changed\): 0\d-a\.md below/, 'the changed file is listed, and given below');
  assert.match(ri, /CLAUDE\.md \(changed\): 0\d-CLAUDE\.md below/, 'a single named file is watched as itself');
  assert.doesNotMatch(ri, /MEMORY\.md/, 'the index file is not');
  const copied = Object.keys(rcall.review).find(f => /-a\.md$/.test(f));
  assert.match(
    rcall.review[copied],
    /^\[Outside text: [^\n]*\]\n\nfirst note, changed$/,
    'each copy says it is outside text',
  );

  // a run that fails goes back to the queue with the reason, and waits before its next try
  await req(port, 'POST', '/api/boards/s/steward', { kind: 'ask', text: 'MAKE-ME-FAIL please' }, 'OWNER');
  r = once();
  s = await state();
  const failed = s.stewardRequests.find(x => x.kind === 'ask');
  assert.equal(failed.state, 'pending', 'requeued');
  assert.match(
    failed.lastError,
    /no structured answer[\s\S]*401 Unauthorized/,
    "and says why, from Codex's own events",
  );
  assert.equal(failed.attempts, 1, 'and not tried again at once: the retry waits');

  // a Codex that cannot show its isolation options is never run, and the heartbeat carries a code, not the detail
  fs.writeFileSync(path.join(chome, 'help-broken'), '');
  const before = calls().length;
  await req(port, 'POST', '/api/boards/s/steward', { kind: 'state' }, 'OWNER');
  r = once();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(calls().length, before, 'Codex was not run');
  s = await state();
  const unusable = s.stewardRequests.find(
    x => x.kind === 'state' && x.state === 'pending' && /not run/.test(x.lastError || ''),
  );
  assert.ok(unusable, 'the job went back with the reason');
  const cr = (await req(port, 'GET', '/api/boards/s/conduct?minutes=60', null, 'OWNER')).body.steward;
  assert.equal(cr.lastError, 'codex-unusable', 'the watch sees a code');
  fs.unlinkSync(path.join(chome, 'help-broken'));

  // full access, at Owner's word: no sandbox, told to only look, and every command it ran is logged
  fs.writeFileSync(
    path.join(home, 'steward-config.json'),
    JSON.stringify(Object.assign({}, conf, { sandbox: 'full-access' })),
  );
  await req(port, 'POST', '/api/boards/s/steward', { kind: 'ask', text: 'Is the importer running?' }, 'OWNER');
  r = once();
  assert.equal(r.status, 0, r.stderr);
  {
    const fc = calls()
      .filter(x => /Is the importer running/.test(x.prompt))
      .pop();
    assert.ok(fc, 'the job ran');
    assert.deepEqual(fc.args.slice(0, 3), ['exec', '-s', 'danger-full-access'], 'no sandbox');
    assert.match(fc.prompt, /You may run commands, only to look things up/, 'told to only look');
    assert.match(
      fs.readFileSync(path.join(home, 'steward-commands.log'), 'utf8'),
      /ask [a-f0-9]{16} exit 0: Get-Content pack\/arch\.md/,
      'every command it ran is logged',
    );
    // it opens the background files itself: listed, not pasted, whole, and the board
    // is told only of the ones it opened
    assert.ok(
      !/The importer runs every five minutes/.test(fc.prompt) &&
        /open the ones this job needs/.test(fc.prompt) &&
        /arch\.md \([^)]*pack[\\/]arch\.md\)/.test(fc.prompt),
      'the files are listed with their paths, not pasted in',
    );
    assert.equal(
      (fc.pack['big.md'].match(/Q{100,}/) || [''])[0].length,
      5000,
      'and each copy is whole: no ceiling for what it opens itself',
    );
    const fa = (await state()).advice.find(x => x.kind === 'ask' && /importer running/.test(x.question || ''));
    assert.ok(
      fa && JSON.stringify(Object.keys(fa.pack)) === '["arch.md"]',
      'the board hears only of the source it opened: ' + JSON.stringify(fa && fa.pack),
    );
    assert.ok(!fa.missing.some(m => /too big/.test(m)), 'nothing is cut, so nothing is reported trimmed');
  }
  fs.writeFileSync(path.join(home, 'steward-config.json'), JSON.stringify(conf));

  // the token is nowhere the model or a log could show it
  const everywhere = [fs.readFileSync(path.join(home, 'stwake.log'), 'utf8')]
    .concat(
      fs.readdirSync(path.join(sdir, 'jobs')).map(f => fs.readFileSync(path.join(sdir, 'jobs', f), 'utf8')),
      fs.readdirSync(path.join(sdir, 'pack')).map(f => fs.readFileSync(path.join(sdir, 'pack', f), 'utf8')),
      [fs.readFileSync(path.join(chome, 'calls.jsonl'), 'utf8')],
    )
    .join('\n');
  assert.ok(!everywhere.includes(STOK), 'no token in the log, the jobs, the pack or what the model was given');
});
