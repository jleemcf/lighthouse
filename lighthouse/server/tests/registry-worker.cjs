'use strict';
require('../../tests/sandbox.cjs');
const fs = require('node:fs');
const { makeRegistry } = require('../registry');
const { makeEnrollment } = require('../enrollment');
const [configPath, requestFile, stage] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(configPath));
const registry = makeRegistry(cfg, configPath, {
  fault: current => {
    if (current === stage) process.exit(87);
  },
});
const enrollment = makeEnrollment(registry, cfg);
process.stdin.once('data', () => {
  try {
    const result = enrollment.consume(JSON.parse(fs.readFileSync(requestFile)));
    process.stdout.write(JSON.stringify({ accepted: true, repeated: !!result.repeated }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ accepted: false, busy: !error.status, status: error.status || 503 }));
  }
});
process.stdout.write('ready\n');
