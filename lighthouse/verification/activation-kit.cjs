'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: wait } = require('node:timers/promises');
const { write } = require('./upgrade-fixture.cjs');
const repository = path.resolve(__dirname, '../..');
const kit = path.join(repository, 'lighthouse/operator-kit');

function install(host, board, session, protocol = 'tools') {
  const home = path.join(host.root, 'kit-' + session.sessionId);
  const cfg = Object.fromEntries(
    Object.keys(JSON.parse(fs.readFileSync(path.join(kit, 'config.example.json')))).map(key => [key, 'fixture']),
  );
  Object.assign(cfg, {
    __BOARD_ID__: board,
    __MACHINE_NAME__: 'fixture-' + board,
    __BOARD_SERVER__: host.endpoint,
    __OPERATOR_WSL_DIR__: path.join(home, 'wsl'),
    __OPERATOR_TRANSCRIPT_DIR__: path.join(home, 'transcripts'),
    protocol,
  });
  const input = path.join(host.root, session.sessionId + '-kit-input.json');
  write(input, cfg);
  const result = spawnSync(
    process.platform === 'win32' ? 'python' : 'python3',
    [
      path.join(kit, 'install.py'),
      '--config',
      input,
      '--out',
      home,
      '--repository',
      repository,
      '--release',
      '2'.repeat(40),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  require('../server/registry-files').protect(home, true);
  const credential = path.join(home, 'session-private.json');
  write(credential, session);
  return { home, credential };
}
async function connect(host, board, session, epoch, cleanup, standby = false) {
  const installed = install(host, board, session);
  const child = spawn(process.execPath, [path.join(installed.home, 'lighthouse-mcp.cjs')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      LH_OPERATOR_SESSION_ID: session.sessionId,
      LH_SESSION_CREDENTIAL_FILE: installed.credential,
      LH_SESSION_EPOCH: String(epoch),
    },
  });
  const pending = new Map();
  let next = 0;
  let buffer = '';
  let errors = '';
  child.stderr.on('data', bytes => {
    errors += bytes;
  });
  child.stdout.on('data', bytes => {
    buffer += bytes;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const value = JSON.parse(line);
      const resolve = pending.get(value.id);
      pending.delete(value.id);
      resolve?.(value);
    }
  });
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
  };
  cleanup.push(close);
  async function rpc(method, params) {
    const id = ++next;
    const answer = new Promise(resolve => pending.set(id, resolve));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    let timer;
    try {
      return await Promise.race([
        answer,
        new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('MCP response timed out: ' + errors)), 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'fixture', version: '1' },
  });
  async function call(name, args) {
    const value = await rpc('tools/call', { name, arguments: args });
    assert.ok(!value.error, JSON.stringify(value.error));
    const text = value.result?.content?.map(item => item.text || '').join('') || '';
    assert.ok(!value.result?.isError, text);
    return text;
  }
  if (standby) return { ...installed, child, call, close };
  await call('board_status', { detail: 'full' });
  for (let count = 0; count < 100; count++) {
    const view = (await host.request(board, 'activation', null, host.owner, undefined, 'GET')).body;
    if (view.processes?.some(process => process.sessionId === session.sessionId && process.kitVersion))
      return { ...installed, child, call, close };
    await wait(20);
  }
  throw new Error('real MCP did not publish readiness: ' + errors);
}
module.exports = { connect, install };
