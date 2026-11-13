'use strict';
const fs = require('node:fs');
const { normalize } = require('./configuration');
function target(cfg, explicit) {
  const board = explicit || cfg.defaultBoard;
  if (!board || !Object.hasOwn(cfg.boards || {}, board))
    throw new Error('Select a configured board explicitly or set defaultBoard');
  return board;
}
module.exports = { target };
if (require.main === module) {
  try {
    const filename = process.argv[2];
    console.log(target(normalize(JSON.parse(fs.readFileSync(filename, 'utf8')), filename), process.argv[3]));
  } catch (error) {
    console.error(error instanceof SyntaxError ? 'Invalid configuration JSON' : error.message);
    process.exitCode = 2;
  }
}
