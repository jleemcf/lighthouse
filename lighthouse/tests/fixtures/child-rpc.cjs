'use strict';
const readline = require('node:readline');
const mode = process.argv[2];
const keepAlive = setInterval(() => {}, 1000);
let received = 0;
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (mode === 'reply') {
    const response = JSON.stringify({ jsonrpc: '2.0', id: message.id, result: message.params });
    process.stdout.write(response.slice(0, 10));
    process.stdout.write(response.slice(10) + '\n');
    return;
  }
  received++;
  if (received !== 2) return;
  if (mode === 'exit') process.exit(23);
  if (mode === 'clean-exit') process.exit(0);
  if (mode === 'signal') process.stderr.write('ready\n');
});
process.stdin.on('end', () => {
  if (mode === 'reply') clearInterval(keepAlive);
});
