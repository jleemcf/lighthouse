'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const source = path.resolve(__dirname, '../../server');
const env = { ...process.env };
delete env.TYPESAFE_API_KEY;
const cases = [
  {
    name: 'tool-notice-name-only',
    file: 'toolcalls-tools.js',
    suite: 'registry-notices.test.js',
    test: 'installation notices stay on the granted board',
    old: '!ctx.canNotice(who, board, target)',
    replacement: "(((ctx.cfg.boards || {})[target] || {}).access || {})[who.name] !== 'watch'",
  },
  {
    name: 'line-notice-name-only',
    file: 'events.js',
    suite: 'registry-notices.test.js',
    test: 'installation notices stay on the granted board',
    old: '!canNotice(principal, board, target)',
    replacement: "(((cfg.boards || {})[target] || {}).access || {})[by] !== 'watch'",
  },
  {
    name: 'inherited-installation-watch',
    file: 'web.js',
    suite: 'registry-notices.test.js',
    test: 'installation notices require an explicit watch grant',
    old: "if (principal.installationId && principal.installationRole !== 'watch') return false;",
    replacement: '',
  },
  {
    name: 'archived-notice-source',
    file: 'toolcalls-request.js',
    suite: 'registry-notices.test.js',
    test: 'archived notice sources refuse calls',
    old: 'if (archived) {',
    replacement: 'if (false) {',
  },
  {
    name: 'archived-relay-settlement-blocked',
    file: 'toolcalls-request.js',
    suite: 'registry-notices.test.js',
    test: 'archived boards settle preserved relay evidence',
    old: "call.tool !== '_relay_result' ||",
    replacement: 'true ||',
  },
  {
    name: 'archived-relay-touches-shift',
    file: 'toolcalls-request.js',
    suite: 'registry-notices.test.js',
    test: 'archived boards settle preserved relay evidence',
    old: '!dry && !archived &&',
    replacement: '!dry &&',
  },
  {
    name: 'archived-notice-target',
    file: 'web.js',
    suite: 'registry-notices.test.js',
    test: 'archived notice targets refuse tools and legacy lines',
    old: "if (boards[source]?.lifecycle === 'archived' || boards[target]?.lifecycle === 'archived') return false;",
    replacement: '',
  },
  {
    name: 'admin-board-rank',
    file: 'web.js',
    suite: 'registry-http.test.js',
    test: 'host administration never grants',
    old: 'let rank = access.rank(r);',
    replacement: 'let rank = p.hostAdmin ? 4 : access.rank(r);',
  },
  {
    name: 'silent-configuration-drift',
    file: 'server.js',
    suite: 'registry-http.test.js',
    test: 'migrated startup reports configuration drift',
    old: "console.warn('registry configuration differs; use registry-cli reconcile: ' + JSON.stringify(differences));",
    replacement: 'void differences;',
  },
  {
    name: 'prototype-installation',
    test: 'installation administration rejects prototype',
    old: [
      'const record =',
      '        operationValue(input.installationId) &&',
      '        Object.hasOwn(state.credentials.installations, input.installationId) &&',
      '        state.credentials.installations[input.installationId];',
    ].join('\n'),
    replacement: 'const record = state.credentials.installations[input.installationId];',
  },
  {
    name: 'strict-legacy-startup',
    file: 'registry.js',
    suite: 'registry.test.js',
    test: 'schema-1 projection tolerates legacy values',
    old: 'definition(id, input, index, true, !persistent)',
    replacement: 'definition(id, input, index, true)',
  },
  {
    name: 'getter-pointer-reads',
    file: 'registry-files.js',
    suite: 'registry.test.js',
    test: 'registry refresh observes another writer',
    old: 'current: () => snapshot',
    replacement: 'current: () => read()',
  },
  {
    name: 'reused-pid-lockout',
    file: 'registry-files.js',
    suite: 'registry-lease.test.js',
    test: 'Linux runtime and writer leases reclaim',
    old: "if (owner.stamp && process.platform === 'linux') return owner.stamp === processStamp(pid);",
    replacement: '',
    linux: true,
  },
  {
    name: 'split',
    test: 'a lost reply retries durably',
    old: 'state.credentials.installations[scope.installationId] = {',
    replacement: 'state.credentials.discardedInstallation = {',
  },
  {
    name: 'retry',
    test: 'a lost reply retries durably',
    old: 'operation.proofVerifier !== proofVerifier ||',
    replacement: '',
  },
  { name: 'expiry', test: 'unconsumed grants expire', old: ' || grant.expiresAt <= clock()', replacement: '' },
  {
    name: 'scope',
    test: 'every grant scope field',
    old: 'JSON.stringify(grant.scope) !== JSON.stringify(scope)',
    replacement: 'false',
  },
  {
    name: 'replay',
    test: 'consumed bind grants cannot authorize',
    old: 'grant.consumed || ',
    replacement: '',
    additional:
      "if (state.credentials.installations[scope.installationId]) throw fail('installation already exists', 409);",
  },
];

function run(directory, pattern, suite = 'enrollment.test.js') {
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', '--test-name-pattern=' + pattern, path.join(directory, 'tests', suite)],
    { env, encoding: 'utf8', timeout: 90000 },
  );
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

assert.equal(run(source, '.').status, 0, 'unmodified acceptance tests must pass first');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-enrollment-mutations-'));
try {
  for (const variant of cases) {
    if (variant.linux && process.platform !== 'linux') {
      console.log('Linux-only mutation requires Linux replay: ' + variant.name);
      continue;
    }
    const folder = path.join(scratch, variant.name);
    fs.mkdirSync(path.join(folder, 'tests'), { recursive: true });
    fs.copyFileSync(path.join(source, '../tests/sandbox.cjs'), path.join(folder, 'tests/sandbox.cjs'));
    const copy = path.join(folder, 'server');
    fs.cpSync(source, copy, { recursive: true });
    const file = path.join(copy, variant.file || 'enrollment.js');
    let content = fs.readFileSync(file, 'utf8');
    assert.equal(content.split(variant.old).length, 2, 'mutation anchor must occur once: ' + variant.name);
    content = content.replace(variant.old, variant.replacement);
    if (variant.additional) {
      const boundary = content.indexOf('function consume(input)');
      const before = content.slice(0, boundary);
      const consume = content.slice(boundary);
      assert.ok(consume.includes(variant.additional));
      content = before + consume.replace(variant.additional, '');
    }
    fs.writeFileSync(file, content);
    const result = run(copy, variant.test, variant.suite);
    assert.notEqual(result.status, 0, 'broken implementation escaped: ' + variant.name);
    assert.match(result.output, /not ok/);
    assert.doesNotMatch(result.output, /Cannot find module|SyntaxError/);
    console.log('caught real-code mutation: ' + variant.name);
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
assert.equal(run(source, '.').status, 0, 'restored acceptance tests must pass');
console.log('restored enrollment passes');
