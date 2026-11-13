#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
assert.equal(args.length, 6);
assert.equal(args[0], '-d');
assert.deepEqual(args.slice(2, 5), ['-e', 'cat', '--']);
const root = fs.realpathSync(process.env.TEST_WSL_ROOT);
const file = fs.realpathSync(args[5]);
const relative = path.relative(root, file);
assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
fs.appendFileSync(path.join(root, 'wsl-reads.jsonl'), JSON.stringify(file) + '\n');
process.stdout.write(fs.readFileSync(file));
