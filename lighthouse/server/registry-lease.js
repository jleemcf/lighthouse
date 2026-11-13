'use strict';
const fs = require('node:fs');
const { flushDirectory, processOwner, ownerActive } = require('./registry-files');
const path = require('node:path');

function acquire(file) {
  const recovery = file + '.recovery';
  const repair = 'stop all board writers, verify their exit, then remove only the stale lock: ' + file;
  if (fs.existsSync(recovery)) throw new Error('offline lock recovery requires local repair; ' + repair);
  try {
    const descriptor = fs.openSync(file, 'wx', 0o600);
    try {
      fs.writeFileSync(descriptor, JSON.stringify(processOwner()));
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const recorded = fs.readFileSync(file, 'utf8');
    const owner = JSON.parse(recorded);
    if (!ownerActive(owner)) {
      const descriptor = fs.openSync(recovery, 'wx', 0o600);
      fs.closeSync(descriptor);
      try {
        if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === recorded) fs.unlinkSync(file);
      } finally {
        fs.unlinkSync(recovery);
      }
      return acquire(file);
    }
    throw new Error('board runtime or migration is active; stop it first; ' + repair);
  }
  flushDirectory(path.dirname(file));
  let released = false;
  return () => {
    if (!released) fs.unlinkSync(file);
    released = true;
  };
}

module.exports = { acquire };
