'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { flushDirectory } = require('./registry-files');

function durableStore(file, fault = () => {}) {
  let failed = false;
  function write(value) {
    if (failed) throw new Error('store write failed; restart and recover before accepting writes');
    const temporary = file + '.tmp';
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'w', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(value));
      fault('written');
      fs.fsyncSync(descriptor);
      fault('flushed');
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporary, file);
      fault('renamed');
      flushDirectory(path.dirname(file));
      fault('committed');
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }
  return { write, healthy: () => !failed };
}

function restore(target, snapshot) {
  for (const key of Object.keys(target)) if (!Object.hasOwn(snapshot, key)) delete target[key];
  for (const [key, value] of Object.entries(snapshot)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    )
      restore(target[key], value);
    else target[key] = value;
  }
}

module.exports = { durableStore, restore };
