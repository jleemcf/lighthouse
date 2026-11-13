'use strict';
require('../../tests/sandbox.cjs');
const { migrate } = require('../registry-migrate');
const [configPath, backup, stage] = process.argv.slice(2);
migrate(configPath, {
  backup,
  fault: current => {
    if (current === stage) process.exit(87);
  },
}).then(
  () => process.exit(0),
  () => process.exit(2),
);
