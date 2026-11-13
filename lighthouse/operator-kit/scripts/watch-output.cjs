'use strict';
const fs = require('node:fs');
const path = require('node:path');
const lease = require('./watch-lease.cjs');

module.exports = (home, source) => {
  const pending = path.join(home, 'watch-output-' + source + '.txt');
  const write = text => {
    const bytes = Buffer.from(text);
    let offset = 0;
    const deadline = Date.now() + 5000;
    while (offset < bytes.length) {
      lease.check(true);
      try {
        const written = fs.writeSync(1, bytes, offset, bytes.length - offset);
        if (!written) process.exit(1);
        offset += written;
      } catch (error) {
        if (error.code === 'EAGAIN' && Date.now() < deadline) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
          continue;
        }
        process.exit(1);
      }
    }
  };
  const replay = () => {
    try {
      if (!fs.existsSync(pending)) return;
      write(fs.readFileSync(pending, 'utf8'));
      lease.check(true);
      fs.unlinkSync(pending);
    } catch {
      process.exit(1);
    }
  };
  const output = line => {
    try {
      fs.writeFileSync(pending, line + '\n', { mode: 0o600 });
      write(line + '\n');
      lease.check(true);
      fs.unlinkSync(pending);
    } catch {
      process.exit(1);
    }
  };
  output.replay = replay;
  return output;
};
