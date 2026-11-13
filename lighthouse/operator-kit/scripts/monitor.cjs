'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { uptime } = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const args = process.argv.slice(2);
const separator = args.indexOf('--');
const sourceAt = args.indexOf('--source');
if (sourceAt < 0 || sourceAt + 1 >= separator || separator < 0 || !args[separator + 1]) {
  console.error('usage: node monitor.cjs --source NAME -- COMMAND [ARGS...]');
  process.exit(2);
}
function ancestors() {
  if (process.platform === 'win32') {
    const script =
      '$identity=' +
      process.ppid +
      ';$seen=@{};$ids=@();' +
      'while($identity -gt 4 -and -not $seen.ContainsKey($identity)){' +
      '$seen[$identity]=$true;$row=Get-CimInstance Win32_Process -Filter "ProcessId = $identity";' +
      'if(-not $row){break};$ids+=@([int]$identity);$identity=[int]$row.ParentProcessId};' +
      'ConvertTo-Json -Compress -InputObject @($ids)';
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    });
    if (result.status !== 0) throw new Error('cannot identify the native Monitor ancestry');
    return JSON.parse(result.stdout);
  }
  const identities = [];
  let identity = process.ppid;
  while (identity > 1 && !identities.includes(identity)) {
    identities.push(identity);
    const stat = fs.readFileSync('/proc/' + identity + '/stat', 'utf8');
    identity = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
  }
  return identities;
}
const source = args[sourceAt + 1];
const name = createHash('sha256').update(source).digest('hex').slice(0, 16);
const file = path.join(__dirname, 'monitor-' + name + '.json');
const token = randomBytes(16).toString('hex');
let parents;
try {
  parents = ancestors();
  if (!Array.isArray(parents) || !parents.length) throw new Error('no foreground Monitor parent');
} catch (error) {
  console.error('WATCH LEASE | ' + error.message + '; command not started');
  process.exit(1);
}
process.env.LH_MONITOR_LEASE = file;
process.env.LH_MONITOR_LEASE_TOKEN = token;
const lease = require('./watch-lease.cjs');
let expires = 0;
const temporary = file + '.' + token + '.tmp';
const publish = () => {
  const expiresUptime = uptime() + 15;
  fs.writeFileSync(
    temporary,
    JSON.stringify({
      token,
      parents: [process.pid, ...parents],
      pid: process.pid,
      expires: Date.now() + 15000,
      expiresUptime,
    }),
    { mode: 0o600 },
  );
  const deadline = performance.now() + 500;
  for (;;) {
    try {
      fs.renameSync(temporary, file);
      expires = expiresUptime;
      return;
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || performance.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
};
process.on('exit', () => {
  try {
    fs.unlinkSync(temporary);
  } catch {}
  try {
    if (JSON.parse(fs.readFileSync(file, 'utf8')).token === token) fs.unlinkSync(file);
  } catch {}
});
try {
  publish();
} catch {
  process.exit(1);
}
lease.check(true);
const child = spawn(args[separator + 1], args.slice(separator + 2), { stdio: 'inherit', windowsHide: true });
const timer = setInterval(() => {
  lease.check(true);
  try {
    publish();
  } catch {
    try {
      fs.unlinkSync(temporary);
    } catch {}
    if (uptime() >= expires) process.exit(1);
  }
}, 1000);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));
child.on('error', error => {
  console.error('WATCH LEASE | cannot start command: ' + error.message);
  process.exit(1);
});
child.on('exit', code => {
  clearInterval(timer);
  process.exit(code === 0 ? 0 : 1);
});
