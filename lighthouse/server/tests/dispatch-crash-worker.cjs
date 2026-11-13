'use strict';
const fs = require('node:fs');
const [config, fault, requestFile] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(config));
const request = JSON.parse(fs.readFileSync(requestFile));
const ctx = {
  cfg,
  CONFIG_PATH: config,
  storeFault: point => {
    if (point === fault) process.exit(19);
  },
};
Object.assign(ctx, require('../store')(ctx));
Object.assign(ctx, require('../web')(ctx));
ctx.ownership = require('../ownership')(ctx);
ctx.handoff = require('../handoff')(ctx);
ctx.dispatchLedger = require('../dispatch-ledger')(ctx);
const who = ctx.ownership.authenticate(request.credential);
who.epoch = 1;
ctx.dispatchLedger.control('tools', who, request.body);
process.exit(20);
