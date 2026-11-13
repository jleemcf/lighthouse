'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');

const source = path.resolve(__dirname, '..');
const linuxOnly = { skip: process.platform !== 'linux' && 'deployment requires Linux /proc and flock' };
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function copyCode(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (/\.(js|sh)$/.test(name) || ['rulings.json', 'release.json'].includes(name)) {
      const content = fs.readFileSync(path.join(from, name), 'utf8').replace(/\r\n/g, '\n');
      fs.writeFileSync(path.join(to, name), content);
    }
  }
  fs.cpSync(path.join(from, 'public'), path.join(to, 'public'), { recursive: true });
}

function run(command, args, options = {}) {
  const env = { ...process.env, NODE: process.execPath, ...options.env };
  delete env.TYPESAFE_API_KEY;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, env });
    let output = '';
    child.stdout.on('data', data => (output += data));
    child.stderr.on('data', data => (output += data));
    child.on('error', reject);
    child.on('close', code => resolve({ code, output }));
  });
}

async function fixture(context, { legacyManager = false, bind = '127.0.0.1' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-deploy-'));
  const home = path.join(root, 'home');
  const candidate = path.join(root, 'candidate');
  copyCode(source, candidate);
  copyCode(source, home);
  if (legacyManager) {
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'legacy-board.sh'), path.join(home, 'board.sh'));
    fs.rmSync(path.join(home, 'release.json'));
  }
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  if (port === 7700) throw new Error('unsafe test port');
  const config = { port, bind, tokens: {}, boards: {}, storeFile: 'store.json' };
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(home, 'store.json'), JSON.stringify({ cards: { kept: { board: 'test' } } }));
  const server = version =>
    [
      "const fs = require('node:fs'), http = require('node:http');",
      "const config = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--config') + 1]));",
      'const server = http.createServer((request, response) => response.end(' + JSON.stringify(version) + '));',
      "server.listen(config.port, config.bind || '0.0.0.0');",
      "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
    ].join('\n');
  fs.writeFileSync(path.join(home, 'server.js'), server('old'));
  fs.writeFileSync(path.join(candidate, 'server.js'), server('new'));
  const pids = new Set();
  const pidFile = path.join(home, 'board.pid');
  const remember = () => {
    if (fs.existsSync(pidFile)) pids.add(Number(fs.readFileSync(pidFile, 'utf8').trim()));
  };
  const manager = async action => {
    const result = await run('bash', [path.join(home, 'board.sh'), action], { env: { LH_HOME: home } });
    remember();
    return result;
  };
  context.after(async () => {
    remember();
    for (const processId of pids) {
      try {
        process.kill(processId, 'SIGKILL');
      } catch {}
    }
    await pause(30);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const started = await manager('start');
  if (started.code !== 0) throw new Error(started.output);
  const active = () => (fs.existsSync(path.join(home, 'current')) ? fs.realpathSync(path.join(home, 'current')) : home);
  const request = () =>
    new Promise((resolve, reject) => {
      http
        .get({ host: bind, port, path: '/api/whoami' }, response => {
          let body = '';
          response.on('data', data => (body += data));
          response.on('end', () => resolve({ status: response.statusCode, body }));
        })
        .on('error', reject);
    });
  const deploy = async () => {
    const result = await run('bash', [path.join(candidate, 'deploy-board.sh')], { env: { LH_HOME: home } });
    remember();
    return result;
  };
  const controlled = async (options = {}) => {
    const script = [
      "const fs = require('node:fs'), path = require('node:path');",
      'const options = JSON.parse(process.argv[1]);',
      'const rename = fs.renameSync;',
      'fs.renameSync = (...args) => {',
      '  const result = rename(...args);',
      '  if (options.fault === "manager-written" && args[1] === path.join(options.home, "board.sh"))',
      '    process.exit(87);',
      '  if (options.fault === "migration-pointer" && args[1] === path.join(options.home, "current"))',
      '    process.exit(87);',
      '  return result;',
      '};',
      'const engine = require(path.join(options.source, "board-release.js"));',
      'engine.run({ ...options, timing: { quietMs: 20, quietTimeoutMs: 150, pollMs: 10, healthTimeoutMs: 100 },',
      'checkpoint: async stage => {',
      '  if (stage === options.fault) {',
      '    if (options.crash) process.exit(87);',
      '    throw new Error("injected " + stage);',
      '  }',
      '}}).catch(error => { console.error(error.message); process.exitCode = 1; });',
    ].join('\n');
    const settings = { action: 'deploy', source: candidate, home, ...options };
    const result = await run('flock', [
      '-n',
      path.join(home, '.board-control.lock'),
      process.execPath,
      '-e',
      script,
      JSON.stringify(settings),
    ]);
    remember();
    return result;
  };
  return { root, home, candidate, port, manager, active, request, deploy, controlled, remember, server };
}

module.exports = { source, linuxOnly, pause, fixture, run, copyCode };
