'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const archived = 'private/lighthouse/handoffs/';
const watcher =
  /(?:^|[ |])(?:node|bash) (?:fmwatch[.]cjs|boardwatch[.]cjs|route[.]sh|watch[.]sh|lighthouse-sweep[.]sh|gate[.]cjs)/;
const launcher = /^node monitor[.]cjs --source [a-z-]+ -- /;

function violations(markdown) {
  const invalid = [];
  for (const [index, line] of markdown.split('\n').entries()) {
    const commands = [...line.matchAll(/\x60([^\x60\n]+)\x60/g)].map(match => match[1]);
    if (/^\s*(?:node|bash) /.test(line)) commands.push(line.trim());
    for (const command of commands) {
      if (watcher.test(command) && !launcher.test(command)) invalid.push(index + 1);
      if (launcher.test(command) && command.includes(' | ') && !command.includes("-- bash -c '"))
        invalid.push(index + 1);
    }
  }
  return invalid;
}

function documents(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['.git', 'node_modules', '__pycache__'].includes(entry.name)) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? documents(file) : entry.name.endsWith('.md') ? [file] : [];
  });
}

test('every active watcher launch instruction uses the foreground Monitor launcher', () => {
  const invalid = [];
  for (const file of documents(root)) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (relative.startsWith(archived)) continue;
    for (const line of violations(fs.readFileSync(file, 'utf8'))) invalid.push(relative + ':' + line);
  }
  assert.deepEqual(invalid, []);
});

test('instruction guard catches plain, piped and incorrectly wrapped launch commands', () => {
  const quote = String.fromCharCode(96);
  for (const command of [
    'node fmwatch.cjs',
    'bash route.sh',
    'bash lighthouse-sweep.sh',
    'node gate.cjs --source fmwatch',
    'node fmwatch.cjs | node gate.cjs --source fmwatch',
    'node monitor.cjs --source fmwatch -- node fmwatch.cjs | node gate.cjs --source fmwatch',
  ])
    assert.deepEqual(violations(quote + command + quote), [1]);
  assert.deepEqual(violations('node monitor.cjs --source fmwatch -- node fmwatch.cjs'), []);
});
