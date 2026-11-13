'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function routeHash(home) {
  const hash = crypto.createHash('sha256');
  for (const name of ['relay.sh', 'fmwatch.cjs']) {
    const file = path.join(home, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('original target adapter must be a regular file');
    hash.update(name + '\0').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
  }
  return hash.digest('hex');
}
function verify(home, binding) {
  if (!/^[a-f0-9]{64}$/.test(binding?.routeHash || '') || routeHash(home) !== binding.routeHash)
    throw new Error('original firstmate route differs here; dispatch and fmwatch remain paused');
}
module.exports = { routeHash, verify };
if (require.main === module) process.stdout.write(routeHash(__dirname) + '\n');
