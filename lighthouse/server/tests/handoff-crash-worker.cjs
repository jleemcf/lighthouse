'use strict';
const fs = require('node:fs');
const path = require('node:path');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const ctx = {
  cfg: input.cfg,
  CONFIG_PATH: path.join(input.home, 'config.json'),
  storeFault(stage) {
    if (stage === input.stage) process.kill(process.pid, 'SIGKILL');
  },
};
Object.assign(ctx, require('../store')(ctx), require('../web')(ctx));
ctx.ownership = require('../ownership')(ctx);
ctx.handoff = require('../handoff')(ctx);
ctx.dispatchLedger = require('../dispatch-ledger')(ctx);
ctx.handoff.control('tools', input.who, input.body);
throw new Error('fault point not reached');
