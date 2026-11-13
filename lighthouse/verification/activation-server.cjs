'use strict';
require('../tests/sandbox.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { assertTestConfig } = require('../tests/sandbox.cjs');
const [config, arm, entry] = process.argv.slice(2);
assertTestConfig(config);
const clock = path.join(path.dirname(arm), 'clock.json');
if (fs.existsSync(clock)) {
  const now = Date.now;
  const elapsed = JSON.parse(fs.readFileSync(clock)).elapsed;
  Date.now = () => now() + elapsed;
}
const http = require('node:http');
const original = http.createServer;
let selected;
http.createServer = function (listener) {
  return original.call(this, (request, response) => {
    selected = request.headers['x-fixture-operation'];
    listener(request, response);
  });
};
const durable = require(path.join(path.dirname(entry), 'durable-store'));
const create = durable.durableStore;
durable.durableStore = file =>
  create(file, stage => {
    if (!fs.existsSync(arm)) return;
    const fault = JSON.parse(fs.readFileSync(arm));
    if (fault.operationId === selected && fault.stage === stage) {
      fs.writeFileSync(arm + '.hit', stage);
      process.exit(91);
    }
  });
process.argv = [process.execPath, entry, '--config', config];
require(entry);
