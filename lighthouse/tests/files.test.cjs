// Every code file stays small enough to read whole: at most 1,000 lines, each at most 120 characters wide.
// Built and vendored files are left out. Run: node --test lighthouse/tests/files.test.cjs
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAX_LINES = 1000;
const MAX_WIDTH = 120;
const CODE = /\.(js|cjs|mjs|py|sh|ps1|css|html)$/;
const SKIP = new Set(['node_modules', 'public', 'vendor', '__pycache__', '.git']);

function codeFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...codeFiles(full));
    else if (CODE.test(entry.name)) out.push(full);
  }
  return out;
}

// the tool's own code: the board, its server, the operator kit, these tests and the scripts beside them
const AREAS = ['board', 'server', 'operator-kit', 'setup', 'tests'];
const TOP = fs.readdirSync(ROOT).filter(n => CODE.test(n) && !n.endsWith('.html'));

test('code files are at most 1,000 lines and 120 characters wide', () => {
  const problems = [];
  const files = AREAS.flatMap(a => codeFiles(path.join(ROOT, a))).concat(TOP.map(n => path.join(ROOT, n)));
  for (const file of files) {
    const name = path.relative(ROOT, file).replace(/\\/g, '/');
    const lines = fs.readFileSync(file, 'utf8').replace(/\n$/, '').split('\n');
    if (lines.length > MAX_LINES) problems.push(`${name}: ${lines.length} lines`);
    const wide = lines.map((l, i) => [i + 1, l.replace(/\r$/, '').length]).filter(([, n]) => n > MAX_WIDTH);
    if (wide.length)
      problems.push(`${name}: ${wide.length} lines wider than ${MAX_WIDTH} (first at line ${wide[0][0]})`);
  }
  assert.deepStrictEqual(problems, [], '\n' + problems.join('\n'));
});
