'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { httpFixture } = require('./registry-http-fixture.cjs');
const { writePrivate, assertPrivate } = require('../registry-files');

function cli(args) {
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../registry-cli.js'), ...args], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', bytes => {
      output += bytes;
    });
    child.stderr.on('data', bytes => {
      output += bytes;
    });
    child.once('error', reject);
    child.once('exit', code => resolve({ code, output }));
  });
}

test('SchemaTwoHostCommandAdoptsChangesAndRemovesAuditedMembership', async context => {
  const ctx = await httpFixture(context, cfg => ({ ...cfg, enrollment: { enabled: false } }));
  const adminFile = path.join(ctx.directory, 'administrator.json');
  writePrivate(adminFile, ctx.adminFile);
  for (const role of ['coordinator', 'viewer', null]) {
    const inputFile = path.join(ctx.directory, 'membership-' + role + '.json');
    writePrivate(inputFile, { id: 'alpha', principal: 'adopted', role });
    const result = await cli([
      'member',
      '--config',
      ctx.configPath,
      '--endpoint',
      ctx.endpoint,
      '--credential-file',
      adminFile,
      '--input',
      inputFile,
    ]);
    assert.equal(result.code, 0);
    assert.ok(!result.output.includes(ctx.adminFile.credential));
    assert.equal(JSON.parse(result.output).role, role);
  }
  const state = ctx.registry.files.read();
  assert.equal(state.metadata.boards.alpha.members.adopted, null);
  assert.deepEqual(
    state.metadata.membershipAudit.map(entry => entry.role),
    ['coordinator', 'viewer', null],
  );
  ctx.privateOutput([ctx.adminFile.credential]);
});

test('real host CLI uses protected handoffs and redacted durable enrollment', async context => {
  const ctx = await httpFixture(context);
  ctx.registry.transact(state => {
    state.credentials.admins = {};
  });
  const file = name => path.join(ctx.directory, name + '.json');
  const config = ['--config', ctx.configPath];
  let result = await cli(['bootstrap', ...config, '--principal', 'host-administrator', '--output', file('admin')]);
  assert.equal(result.code, 0);
  const admin = JSON.parse(fs.readFileSync(file('admin')));
  assertPrivate(file('admin'));
  const outputs = [result.output];
  result = await cli(['prepare', '--output', file('prepared'), '--request', file('public-request')]);
  assert.equal(result.code, 0);
  outputs.push(result.output);
  const prepared = JSON.parse(fs.readFileSync(file('prepared')));
  const request = JSON.parse(fs.readFileSync(file('public-request')));
  writePrivate(file('grant-request'), {
    proofVerifier: request.proofVerifier,
    scope: {
      boardId: 'alpha',
      installationId: request.installationId,
      action: 'bind',
      principal: 'new-operator',
      role: 'operator',
      protocol: 'tools',
    },
  });
  result = await cli([
    'grant',
    ...config,
    '--credential-file',
    file('admin'),
    '--input',
    file('grant-request'),
    '--output',
    file('grant'),
  ]);
  assert.equal(result.code, 0);
  outputs.push(result.output);
  const grant = JSON.parse(fs.readFileSync(file('grant')));
  for (let attempt = 0; attempt < 2; attempt++) {
    result = await cli([
      'enroll',
      ...config,
      '--endpoint',
      ctx.endpoint,
      '--prepared',
      file('prepared'),
      '--grant-file',
      file('grant'),
      '--output',
      file('binding'),
    ]);
    assert.equal(result.code, 0);
    outputs.push(result.output);
  }
  const binding = JSON.parse(fs.readFileSync(file('binding')));
  assertPrivate(file('binding'));
  assert.ok(binding.credential === prepared.credential);
  assert.equal(binding.boardId, 'alpha');
  writePrivate(file('rename'), { id: 'alpha', name: 'CLI renamed' });
  result = await cli([
    'rename',
    ...config,
    '--endpoint',
    ctx.endpoint,
    '--credential-file',
    file('admin'),
    '--input',
    file('rename'),
  ]);
  assert.equal(result.code, 0);
  outputs.push(result.output);
  const state = await ctx.request('GET', '/api/state', undefined, 'fixtureLegacy');
  assert.equal(state.body.boards.alpha.name, 'CLI renamed');
  for (const value of [admin.credential, prepared.credential, prepared.proof, grant.grant])
    assert.ok(
      outputs.every(output => !output.includes(value)),
      'CLI output is redacted',
    );
  ctx.privateOutput([admin.credential, prepared.credential, prepared.proof, grant.grant]);
  result = await cli([
    'enroll',
    ...config,
    '--endpoint',
    'http://example.test',
    '--prepared',
    file('prepared'),
    '--grant-file',
    file('grant'),
    '--output',
    file('unsafe'),
  ]);
  assert.equal(result.code, 1);
  assert.match(result.output, /HTTPS off loopback/);
});
