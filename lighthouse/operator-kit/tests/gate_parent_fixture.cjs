'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const scripts = path.join(__dirname, '../scripts');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const read = file => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};
const json = file => {
  try {
    return JSON.parse(read(file));
  } catch {
    return null;
  }
};
const alive = identity => {
  if (!Number.isSafeInteger(identity) || identity <= 1) return false;
  try {
    process.kill(identity, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};
async function until(predicate, label, milliseconds = 12000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await pause(20);
  }
  throw new Error(label);
}
function fixture(context) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-parent-'));
  const children = [];
  for (const name of [
    'monitor.cjs',
    'watch-lease.cjs',
    'watch-output.cjs',
    'gate.cjs',
    'gate-policy.cjs',
    'gate-rules.json',
    'fmwatch.cjs',
  ])
    fs.copyFileSync(path.join(scripts, name), path.join(home, name));
  const fmwatch = path.join(home, 'fmwatch.cjs');
  fs.writeFileSync(
    fmwatch,
    fs
      .readFileSync(fmwatch, 'utf8')
      .replace("const HOME = '//wsl.localhost/__WSL_DISTRO__/home/__WSL_USER__';", 'const HOME = __dirname;')
      .replaceAll('__FM_CONV_DIR__', 'fixture')
      .replaceAll('__FM_HOME_REL__', '/fixture'),
  );
  const environment = { ...process.env };
  for (const name of [
    'TYPESAFE_API_KEY',
    'LH_MONITOR_LEASE',
    'LH_MONITOR_LEASE_TOKEN',
    'NODE_OPTIONS',
    'GATE_HOME',
    'GATE_JEV_URL',
  ])
    delete environment[name];
  const start = (command, args, extra = {}) => {
    const child = spawn(command, args, {
      cwd: home,
      env: { ...environment, ...extra },
      stdio: 'pipe',
      windowsHide: true,
    });
    children.push(child);
    let output = '',
      errors = '';
    child.stdout.setEncoding('utf8').on('data', text => (output += text));
    child.stderr.setEncoding('utf8').on('data', text => (errors += text));
    child.stdin.on('error', () => {});
    return { child, output: () => output, errors: () => errors };
  };
  const registry = () => json(path.join(home, 'gate-pids.json')) || {};
  const gate = async source => {
    const entry = await until(
      () => Object.entries(registry()).find(([, record]) => record.source === source),
      'gate did not register: ' + source,
    );
    return { pid: Number(entry[0]), ...entry[1] };
  };
  const write = (name, contents) => fs.writeFileSync(path.join(home, name), contents);
  write(
    'watcher.cjs',
    [
      'const fs = require("node:fs");',
      'fs.writeFileSync("watcher.json", JSON.stringify({pid:process.pid, ppid:process.ppid}));',
      'const timer = setInterval(() => {',
      '  if (fs.existsSync("emit")) { fs.unlinkSync("emit"); console.log("Owner (general): later decision"); }',
      '  if (fs.existsSync("end-input")) { clearInterval(timer); process.exit(0); }',
      '}, 30);',
      'require("./watch-lease.cjs");',
      'console.log("Owner (general): watcher ready");',
    ].join('\n'),
  );
  write(
    'all-watch.sh',
    [
      'cd "$(dirname "$0")" || exit 1',
      'node watcher.cjs | node gate.cjs --source mixed --mode off --tick-ms 200',
      'printf "WRAPPER | pipeline exited\\n"',
    ].join('\n') + '\n',
  );
  const monitor = arrangement => {
    if (arrangement === 'fmwatch')
      write('all-watch.sh', 'node fmwatch.cjs | node gate.cjs --source mixed --mode off\n');
    const command = !arrangement.startsWith('documented')
      ? [bash, 'all-watch.sh']
      : [bash, '-c', 'node watcher.cjs | node gate.cjs --source mixed --mode off --tick-ms 200'];
    return start(process.execPath, ['monitor.cjs', '--source', 'mixed', '--', ...command]);
  };
  const leaseFile = () => fs.readdirSync(home).find(name => /^monitor-.*\.json$/.test(name));
  const heartbeat = () => json(path.join(home, 'gate-heartbeat.json'));
  const tree = identities => {
    if (process.platform !== 'win32') return [];
    const script = identities
      .filter(identity => identity > 1)
      .map(identity => 'Get-CimInstance Win32_Process -Filter "ProcessId = ' + identity + '"')
      .join(';');
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '@(' + script + ') | Select-Object Name,ProcessId,ParentProcessId | ConvertTo-Json -Compress',
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 },
    );
    return JSON.parse(result.stdout);
  };
  context.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
    await until(
      () => Object.keys(registry()).every(identity => !alive(Number(identity))),
      'fixture gates stop after their launchers',
    );
    await pause(250);
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { home, start, gate, registry, write, monitor, leaseFile, heartbeat, tree };
}
module.exports = { fixture, alive, pause, read, json, until };
