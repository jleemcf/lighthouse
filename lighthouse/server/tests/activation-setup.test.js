'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('./ownership-http-fixture');
const { writePrivate } = require('../registry-files');
const cli = require('../activation-cli');

test('PrivateSetupCommands register, locate and retire without exposing credentials', async context => {
  const host = await fixture(context, false);
  const endpoint = 'http://127.0.0.1:' + host.port;
  const owner = path.join(host.directory, 'private-owner.json');
  const sessionFile = path.join(host.directory, 'private-session.json');
  writePrivate(owner, { credential: 'CAPTAIN' });
  const created = await cli.run(['new-session', '--endpoint', endpoint, '--board', 'beta', '--output', sessionFile]);
  const { sessionId, credential } = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  assert.deepEqual(created, { board: 'beta', sessionId }, 'no private credential in command output');
  await assert.rejects(
    cli.run(['new-session', '--endpoint', endpoint, '--board', 'beta', '--output', sessionFile]),
    /EEXIST/,
  );
  const run = async (request, extra = {}, auth = owner) => {
    const input = path.join(host.directory, crypto.randomUUID() + '.json');
    writePrivate(input, {
      endpoint,
      board: 'beta',
      request: { operationId: crypto.randomUUID(), ...request },
      ...extra,
    });
    const args = ['ownership', '--endpoint', endpoint, '--board', 'beta', '--credential-file', auth, '--input', input];
    const result = await cli.run([...args]);
    assert.ok(!JSON.stringify(result).includes(credential), 'output contains only the public ownership projection');
    assert.equal((await cli.run([...args])).duplicate, true, 'same private plan is retry-safe');
    return result;
  };
  await run({ action: 'register', sessionId, installationId: 'install-test', principal: 'beta' }, { sessionFile });
  const collector = path.join(host.directory, 'private-collector.json');
  assert.deepEqual(
    await cli.run([
      'new-session',
      '--endpoint',
      endpoint,
      '--board',
      'beta',
      '--session-file',
      sessionFile,
      '--output',
      collector,
    ]),
    created,
  );
  assert.notEqual(JSON.parse(fs.readFileSync(collector, 'utf8')).credential, credential);
  await run(
    { action: 'register', sessionId, installationId: 'install-test', principal: 'beta', scope: 'collector' },
    { sessionFile: collector },
  );
  const nominationId = crypto.randomUUID();
  await run({ action: 'nominate', sessionId, nominationId, expectedEpoch: 1, expiresAt: Date.now() + 600000 });
  const acquired = await run({ action: 'acquire', nominationId, expectedEpoch: 1 }, { epoch: 1 }, sessionFile);
  assert.equal(acquired.ownership.epoch, 2);
  await run({
    action: 'locate',
    sessionId,
    location: {
      machineId: 'machine-original',
      homeId: 'home-original',
      targetId: 'firstmate',
      targetInstallationId: 'install-test',
      routeHash: 'a'.repeat(64),
    },
  });
  await run({ action: 'detach', processId: host.processId, expectedEpoch: 2, confirmStopped: true });
  const bad = path.join(host.directory, 'wrong-board.json');
  writePrivate(bad, { endpoint, board: 'alpha', request: { action: 'detach' } });
  await assert.rejects(
    cli.run(['ownership', '--endpoint', endpoint, '--board', 'beta', '--credential-file', owner, '--input', bad]),
    /scope mismatch/,
  );
  const line = path.join(host.directory, 'line.json');
  writePrivate(line, { endpoint, board: 'alpha', request: { action: 'detach', operationId: crypto.randomUUID() } });
  const otherOwner = path.join(host.directory, 'other-owner.json');
  writePrivate(otherOwner, { credential: 'OWNER' });
  await assert.rejects(
    cli.run([
      'ownership',
      '--endpoint',
      endpoint,
      '--board',
      'alpha',
      '--credential-file',
      otherOwner,
      '--input',
      line,
    ]),
    /activation refused/,
  );
});
