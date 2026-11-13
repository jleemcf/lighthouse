'use strict';
require('../tests/sandbox.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: wait } = require('node:timers/promises');
const { testPort, assertNoPaidKey } = require('../tests/sandbox.cjs');
const { create, write } = require('./upgrade-fixture.cjs');
const id = () => crypto.randomUUID();

async function fixture(context) {
  assertNoPaidKey();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-activation-'));
  const port = await testPort();
  const host = create(root, port);
  const arm = path.join(root, 'fault.json');
  const owner = 'synthetic-rehearsal-browser';
  const cfg = host.cfg;
  cfg.tokens['synthetic-steward'] = { name: 'steward', mode: 'steward', board: 'harbor' };
  for (const board of ['harbor', 'studio', 'ledger'])
    cfg.tokens['legacy-' + board] = { name: board + '-operator', mode: cfg.boards[board].protocol };
  write(host.config, cfg);
  const initial = JSON.parse(fs.readFileSync(path.join(host.home, 'store.json')));
  for (const [board, value] of Object.entries(initial.boards)) {
    value.machine = cfg.boards[board].machine;
    value.project = cfg.boards[board].project;
  }
  Object.assign(initial.boards.harbor.shift, {
    state: 'on',
    id: 'continuous-fixture-shift',
    lastSeen: new Date().toISOString(),
  });
  write(path.join(host.home, 'store.json'), initial);
  let child;
  let drop;
  const proxy = http.createServer((request, response) => {
    const upstream = http.request(
      { host: '127.0.0.1', port, method: request.method, path: request.url, headers: request.headers },
      incoming => {
        if (drop && drop === request.headers['x-fixture-operation'] && incoming.statusCode === 200) {
          drop = undefined;
          incoming.resume();
          incoming.once('end', () => response.destroy());
        } else {
          response.writeHead(incoming.statusCode, incoming.headers);
          incoming.pipe(response);
        }
      },
    );
    upstream.on('error', () => response.destroy());
    request.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const endpoint = 'http://127.0.0.1:' + proxy.address().port;
  const disk = () => JSON.parse(fs.readFileSync(path.join(host.home, 'store.json')));
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
  async function start() {
    let output = '';
    const entry = path.join(require('../server/board-release').activeRelease(host.home), 'server.js');
    child = spawn(process.execPath, [path.join(__dirname, 'activation-server.cjs'), host.config, arm, entry], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', bytes => {
      output += bytes;
    });
    child.stderr.on('data', bytes => {
      output += bytes;
    });
    for (let count = 0; count < 200 && !output.includes('listening'); count++) {
      if (child.exitCode !== null) throw new Error('scratch server exited: ' + output);
      await wait(20);
    }
    assert.match(output, /listening/, 'scratch server listening');
  }
  async function request(board, service, body, credential = owner, epoch, method = 'POST') {
    const response = await fetch(endpoint + '/api/boards/' + board + '/' + service, {
      method,
      headers: {
        Authorization: 'Bearer ' + credential,
        'Content-Type': 'application/json',
        ...(epoch ? { 'X-Lighthouse-Epoch': String(epoch) } : {}),
        ...(body?.operationId ? { 'X-Fixture-Operation': body.operationId } : {}),
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, body: await response.json() };
  }
  async function ok(board, service, body, credential = owner, epoch) {
    const result = await request(board, service, body, credential, epoch);
    assert.equal(result.status, 200, service + ': ' + JSON.stringify(result.body));
    return result.body;
  }
  async function inject(stage, board, service, body, credential = owner, epoch) {
    if (stage === 'ack') drop = body.operationId;
    else write(arm, { stage, operationId: body.operationId });
    await assert.rejects(request(board, service, body, credential, epoch), 'fault must interrupt the actual request');
    if (stage !== 'ack') {
      for (let count = 0; count < 100 && child.exitCode === null; count++) await wait(10);
      assert.equal(child.exitCode, 91, 'real process exited at the durable boundary');
      assert.equal(fs.readFileSync(arm + '.hit', 'utf8'), stage);
      fs.unlinkSync(arm);
      await start();
    }
    const result = await ok(board, service, body, credential, epoch);
    assert.equal(
      Boolean(service === 'calls' ? result.results[0].duplicate : result.duplicate),
      ['renamed', 'committed', 'ack'].includes(stage),
      'first retry distinguishes an uncommitted operation from its durable duplicate',
    );
    const repeated = await ok(board, service, body, credential, epoch);
    assert.equal(
      service === 'calls' ? repeated.results[0].duplicate : repeated.duplicate,
      true,
      'stable operation retry returns its committed result',
    );
    return result;
  }
  context.after(async () => {
    await stop();
    await new Promise(resolve => proxy.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await start();
  const elapse = async elapsed => {
    await stop();
    write(path.join(root, 'clock.json'), { elapsed });
    await start();
  };
  return { ...host, root, endpoint, owner, disk, start, stop, elapse, request, ok, inject, id };
}
module.exports = { fixture, id, write };
