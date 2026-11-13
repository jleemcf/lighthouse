'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { fixture, grantFor } = require('./registry-fixture');
const { makeRegistry } = require('../registry');
const { makeEnrollment } = require('../enrollment');
const { writePrivate } = require('../registry-files');

async function worker(context, request, stage = '') {
  const input = path.join(context.directory, crypto.randomUUID() + '.json');
  writePrivate(input, request);
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
  const processChild = spawn(
    process.execPath,
    [path.join(__dirname, 'registry-worker.cjs'), context.configPath, input, stage],
    { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let output = '';
  let errors = '';
  processChild.stderr.on('data', bytes => {
    errors += bytes;
  });
  const ready = new Promise((resolve, reject) => {
    processChild.stdout.on('data', bytes => {
      output += bytes;
      if (output.startsWith('ready\n')) resolve();
    });
    processChild.once('error', reject);
    processChild.once('exit', () => {
      if (!output.startsWith('ready\n')) reject(new Error('worker did not start'));
    });
  });
  const exited = once(processChild, 'exit');
  await ready;
  return {
    start: () => processChild.stdin.end('go'),
    result: async () => {
      const [code] = await exited;
      assert.equal(errors, '');
      return { code, value: output.slice('ready\n'.length) ? JSON.parse(output.slice('ready\n'.length)) : null };
    },
  };
}

test('process death at every flush never splits consumption from installation', async context => {
  for (const stage of ['metadata-flushed', 'credentials-flushed', 'pointer-flushed', 'pointer-renamed', 'committed']) {
    await context.test(stage, async child => {
      const ctx = fixture(child);
      const request = grantFor(ctx, {
        scope: { action: 'create', role: 'owner', principal: 'new-owner' },
        board: { name: 'Created once', access: { 'new-owner': 'owner' } },
      });
      const runner = await worker(ctx, request, stage);
      runner.start();
      assert.equal((await runner.result()).code, 87);
      const registry = makeRegistry(ctx.cfg, ctx.configPath);
      const enrollment = makeEnrollment(registry, ctx.cfg);
      const committed = ['pointer-renamed', 'committed'].includes(stage);
      assert.equal(!!registry.credentials().installations[request.installationId], committed);
      assert.equal(!!registry.board(request.scope.boardId), committed);
      assert.equal(!!registry.credentials().operations[request.operationId], committed);
      const retry = enrollment.consume(request);
      assert.equal(!!retry.repeated, committed);
      assert.equal(Object.keys(registry.metadata().boards).length, 3);
      assert.equal(Object.keys(registry.credentials().installations).length, 1);
      assert.throws(() => enrollment.consume({ ...request, operationId: crypto.randomUUID() }), /unavailable/);
    });
  }
});

test('competing consumers install once; same-operation retries converge', async context => {
  const ctx = fixture(context);
  const request = grantFor(ctx);
  const runners = await Promise.all([
    worker(ctx, request),
    worker(ctx, { ...request, operationId: crypto.randomUUID() }),
  ]);
  runners.forEach(runner => runner.start());
  const results = await Promise.all(runners.map(runner => runner.result()));
  assert.ok(results.every(result => result.code === 0));
  assert.equal(results.filter(result => result.value.accepted).length, 1);
  const registry = makeRegistry(ctx.cfg, ctx.configPath);
  assert.equal(Object.keys(registry.credentials().installations).length, 1);
  const operationId = Object.keys(registry.credentials().operations)[0];
  const retry = makeEnrollment(registry, ctx.cfg).consume({ ...request, operationId });
  assert.equal(retry.repeated, true);
  const same = await Promise.all([worker(ctx, { ...request, operationId }), worker(ctx, { ...request, operationId })]);
  same.forEach(runner => runner.start());
  const retries = await Promise.all(same.map(runner => runner.result()));
  assert.ok(retries.every(result => result.value.accepted || result.value.busy));
  assert.equal(Object.keys(makeRegistry(ctx.cfg, ctx.configPath).credentials().installations).length, 1);
});
