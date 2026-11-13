'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { spawnServer, testPort } = require('../../tests/sandbox.cjs');
const { fixture, linuxOnly, source } = require('./deploy-fixture.cjs');

const policy = { rulings: [{ n: 8, title: 'Local policy sentinel', text: 'Keep a verified backup.' }] };
const tokens = {
  fixture: { name: 'captain', via: 'page' },
  steward: { name: 'steward', via: 'api', mode: 'steward', board: 'fixture' },
};

async function checkPolicy(port, raw) {
  const base = 'http://127.0.0.1:' + port;
  const headers = { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' };
  const response = await fetch(base + '/api/state', { headers });
  assert.equal(response.status, 200);
  const state = await response.json();
  const expected = JSON.parse(raw).rulings;
  assert.deepEqual(state.rulings, Object.fromEntries(expected.map(record => [record.n, record.title])));
  const request = await fetch(base + '/api/boards/fixture/steward', {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'state' }),
  });
  assert.ok([200, 201].includes(request.status));
  const next = await fetch(base + '/api/steward/next', { headers: { Authorization: 'Bearer steward' } });
  const { job } = await next.json();
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
  assert.ok(job.text.includes('record ' + hash), 'jobs cite the exact selected policy bytes');
  const completed = await fetch(base + '/api/steward/result', {
    method: 'POST',
    headers: { ...headers, Authorization: 'Bearer steward' },
    body: JSON.stringify({
      request: job.request,
      oneLine: 'Fixture check',
      text: 'Policies checked.',
      model: 'fixture',
    }),
  });
  assert.equal(completed.status, 200, 'finish the job so the next release creates a fresh citation');
}

for (const location of ['legacy', 'configured', 'fallback']) {
  test('policy selection from the configuration directory: ' + location, async context => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-policy-'));
    context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
    const port = await testPort();
    const config = {
      port,
      bind: '127.0.0.1',
      storeFile: 'store.json',
      tokens,
      boards: { fixture: { steward: true, access: { captain: 'owner' } } },
    };
    const filename = location === 'configured' ? 'policies/local.json' : 'rulings.json';
    if (location !== 'legacy') config.rulingsFile = filename;
    const local = path.join(scratch, filename);
    const expected =
      location === 'configured'
        ? Buffer.from(JSON.stringify(policy))
        : fs.readFileSync(path.join(source, 'rulings.json'));
    if (location !== 'fallback') {
      fs.mkdirSync(path.dirname(local), { recursive: true });
      fs.writeFileSync(local, JSON.stringify(policy));
    }
    const configPath = path.join(scratch, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config));
    const child = spawnServer(configPath, { stdio: ['ignore', 'pipe', 'pipe'] });
    context.after(async () => {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('scratch server did not start')), 10000);
      child.stdout.on('data', data => {
        if (String(data).includes('listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('scratch server exited'));
      });
    });
    await checkPolicy(port, expected);
  });
}

test('custom policy numbers do not inherit historical metadata', () => {
  const script = [
    'import importlib.util,json,sys',
    'spec=importlib.util.spec_from_file_location("rulings",sys.argv[1])',
    'module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)',
    'text="## Owner\'s rulings\\n8. **Backups.** Local rule.\\n15. **Recovery.** Local rule.\\n"',
    'print(json.dumps(module.parse(text)))',
  ].join('\n');
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const result = spawnSync(python, ['-c', script, path.join(source, 'make-rulings.py')], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  const records = JSON.parse(result.stdout);
  assert.equal(records.length, 2);
  assert.ok(records.every(record => !record.scene && !record.supersededBy));
});

test('staged releases keep configuration-relative policies across deploy and restart', linuxOnly, async context => {
  const board = await fixture(context);
  const configPath = path.join(board.home, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath));
  config.rulingsFile = 'policies/host.json';
  config.tokens = tokens;
  config.boards = { fixture: { steward: true, access: { captain: 'owner' } } };
  fs.writeFileSync(configPath, JSON.stringify(config));
  fs.mkdirSync(path.join(board.home, 'policies'));
  const raw = JSON.stringify(policy);
  fs.writeFileSync(path.join(board.home, config.rulingsFile), raw);
  fs.copyFileSync(path.join(source, 'server.js'), path.join(board.candidate, 'server.js'));
  for (const action of [() => board.deploy(), () => board.manager('restart'), () => board.deploy()]) {
    const result = await action();
    assert.equal(result.code, 0, result.output);
    await checkPolicy(config.port, raw);
    assert.equal(fs.readFileSync(path.join(board.home, config.rulingsFile), 'utf8'), raw);
  }
});

test('legacy flat policies do not shadow bundled policies in staged releases', linuxOnly, async context => {
  const board = await fixture(context, { legacyManager: true });
  const configPath = path.join(board.home, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath));
  config.tokens = tokens;
  config.boards = { fixture: { steward: true, access: { captain: 'owner' } } };
  fs.writeFileSync(configPath, JSON.stringify(config));
  const previous = fs.readFileSync(path.join(board.home, 'rulings.json'), 'utf8');
  fs.copyFileSync(path.join(source, 'server.js'), path.join(board.candidate, 'server.js'));
  for (const title of ['First candidate policy', 'Next candidate policy']) {
    const raw = JSON.stringify({ rulings: [{ ...policy.rulings[0], title }] });
    fs.writeFileSync(path.join(board.candidate, 'rulings.json'), raw);
    const result = await board.deploy();
    assert.equal(result.code, 0, result.output);
    await checkPolicy(config.port, raw);
    const restarted = await board.manager('restart');
    assert.equal(restarted.code, 0, restarted.output);
    await checkPolicy(config.port, raw);
    assert.equal(fs.readFileSync(path.join(board.home, 'rulings.json'), 'utf8'), previous);
  }
});
