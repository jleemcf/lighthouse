'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function run(root = path.resolve(__dirname, '..'), environment = process.env) {
  const env = { ...environment };
  delete env.TYPESAFE_API_KEY;
  delete env.NODE_TEST_CONTEXT;
  // Check the complete current tree. A first push has no previous commit; deleted paths need no special case.
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const python = env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const commands = [
    ['privacy', process.execPath, ['scripts/check-private.cjs']],
    ['tests', bash, ['lighthouse/test-all.sh']],
    ['page', python, ['lighthouse/server/make-page.py']],
    ['rulings', python, ['lighthouse/server/make-rulings.py']],
    [
      'generated-content',
      'git',
      ['diff', '--exit-code', '--', 'lighthouse/server/public/index.html', 'lighthouse/server/rulings.json'],
    ],
  ];
  for (const [label, executable, args] of commands) {
    const stepEnv = { ...env };
    if (label !== 'privacy') {
      delete stepEnv.PRIVATE_TERMS;
      delete stepEnv.PRIVATE_TERMS_PATH;
    }
    const result = spawnSync(executable, args, { cwd: root, env: stepEnv, stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error('CI check failed: ' + label);
    console.log('CI check: ' + label + ' -> pass');
  }
}
module.exports = { run };
if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error.message.startsWith('CI check failed: ') ? error.message : 'CI check could not complete');
    process.exitCode = 1;
  }
}
