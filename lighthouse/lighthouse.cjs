#!/usr/bin/env node
'use strict';
const path = require('node:path');
const readline = require('node:readline/promises');
const { endpoint } = require('./setup/common.cjs');

function optionsOf(args) {
  const result = {};
  const allowed = ['home', 'port', 'release', 'host', 'grant-file', 'trust', 'prepare', 'distro'];
  for (let index = 0; index < args.length; index++) {
    const key = args[index].replace(/^--/, '');
    if (!args[index].startsWith('--') || !allowed.includes(key) || result[key] !== undefined)
      throw new Error('Unknown or repeated setup option. Credentials are accepted only through protected files.');
    if (['trust', 'prepare'].includes(key)) result[key] = true;
    else if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('An option needs a value.');
    else result[key] = args[++index];
  }
  return result;
}
async function main(args) {
  const command = args.shift();
  if (command === 'operator' && args.shift() !== 'setup') throw new Error('Use operator setup.');
  if (!['init', 'operator', 'doctor'].includes(command))
    throw new Error('Use init, operator setup, or doctor. See lighthouse/setup/README.md.');
  const options = optionsOf(args);
  if (command === 'init') return require('./setup/host.cjs').init(options);
  if (command === 'doctor') return require('./setup/doctor.cjs').doctor(path.resolve(options.home || '.'));
  // Only unresolved choices are prompted. Grant secrets themselves are never read on an echoing terminal.
  const terminal = process.stdin.isTTY
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null;
  try {
    if (!options.host && terminal) options.host = await terminal.question('Board host address: ');
    if (options.host) options.host = endpoint(options.host);
    if (!options.trust && terminal && options.host)
      options.trust = (await terminal.question('Trust this host to bind this installation? Type yes: ')) === 'yes';
    if (!options.prepare && !options['grant-file'] && terminal)
      options['grant-file'] = await terminal.question('Protected grant file path (blank to prepare a request): ');
    return require('./setup/operator.cjs').setup(options);
  } finally {
    terminal?.close();
  }
}
if (require.main === module)
  main(process.argv.slice(2)).then(
    result => {
      console.log(JSON.stringify(result));
      if (result?.checks?.some(check => check.status === 'fault')) process.exitCode = 1;
    },
    error => {
      // Even malformed input/JSON/network failures can contain credentials. Never echo exception text.
      console.error('Setup failed. Check prerequisites, protected inputs, trust and home state; details withheld.');
      if (/Existing home refused/.test(error.message)) console.error('Existing home: use deploy or shift.sh update.');
      if (/WSL/.test(error.message)) console.error('Host initialization requires Linux or WSL.');
      process.exitCode = 1;
    },
  );
module.exports = { main, optionsOf };
