'use strict';
// Core-only installations keep credentials in a protected file referenced by config, never in generated scripts.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const check = (name, status, detail) => ({ name, status, detail });
function nodeCheck() {
  return check('node', Number(process.versions.node.split('.')[0]) >= 22 ? 'ok' : 'fault', process.version);
}
function nodeAdvisories() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (process.platform === 'win32' && (major < 24 || (major === 24 && minor < 16)))
    return [check('node', 'warning', process.version + '; below the supported Windows minimum of Node.js 24.16.0')];
  return [];
}
function privateStorage(home, file) {
  try {
    for (const target of [home, file]) {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) return false;
      if (process.platform !== 'win32') {
        if (stat.mode & 0o077) return false;
      } else {
        const command =
          '$ErrorActionPreference="Stop";$a=Get-Acl -LiteralPath $env:LH_PRIVATE_PATH;' +
          '$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;' +
          'if(!@($a.Access).Count){exit 3};foreach($e in @($a.Access)){' +
          'if($e.AccessControlType -ne "Allow" -or ' +
          '$e.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid){exit 3}}';
        const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
          env: { ...process.env, LH_PRIVATE_PATH: target },
          windowsHide: true,
          stdio: 'ignore',
          timeout: 15000,
        });
        if (result.status !== 0) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
async function doctor(home) {
  const checks = [nodeCheck()];
  const advisories = nodeAdvisories();
  let cfg, binding, credential, contactEndpoint;
  try {
    cfg = read(path.join(home, 'config.json'));
    if (cfg.credentialFile) {
      if (!privateStorage(home, path.resolve(home, cfg.credentialFile))) throw new Error();
      binding = read(path.join(home, 'binding.json'));
      credential = read(path.resolve(home, cfg.credentialFile)).credential;
      if (!credential || cfg.board !== binding.boardId || cfg.server !== binding.endpoint) throw new Error();
      checks.push(check('binding', 'ok', 'private installation binding and credential reference'));
    } else {
      const value = part => cfg[Object.keys(cfg).find(key => key.includes(part))];
      binding = { boardId: cfg.board || value('BOARD_ID'), endpoint: cfg.server || value('BOARD_SERVER') };
      credential = fs.readFileSync(path.join(home, 'LH-TOKEN.txt'), 'utf8').trim();
      if (!credential || !binding.boardId || !binding.endpoint) throw new Error();
      checks.push(check('binding', 'ok', 'legacy home; preserve existing credentials and use update'));
    }
  } catch {
    checks.push(check('binding', 'fault', 'missing or inconsistent private binding'));
    return { kind: 'operator', checks, advisories };
  }
  const python = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const pythonVersion = ((python.stdout || '') + (python.stderr || '')).match(/Python \d+\.\d+\.\d+/)?.[0];
  checks.push(check('python', python.status === 0 && pythonVersion ? 'ok' : 'fault', pythonVersion || 'unavailable'));
  try {
    const hooks = read(path.join(home, '.claude', 'settings.local.json')).hooks;
    for (const name of ['PreCompact', 'SessionStart']) {
      if (!hooks[name]?.some(item => item.hooks?.some(hook => String(hook.command).includes('lighthouse-mcp.cjs'))))
        throw new Error();
    }
    checks.push(check('hooks', 'ok', 'compaction hooks installed'));
  } catch {
    checks.push(check('hooks', 'fault', 'compaction hooks missing'));
  }
  try {
    let entry;
    if (fs.existsSync(path.join(home, '.mcp.json'))) entry = read(path.join(home, '.mcp.json')).mcpServers.lighthouse;
    else {
      const root = process.env.CLAUDE_CONFIG_DIR || require('node:os').homedir();
      const projects = read(path.join(root, '.claude.json')).projects || {};
      const fold = value => path.resolve(value).replace(/\\/g, '/').toLowerCase();
      entry = Object.entries(projects).find(([key]) => fold(key) === fold(home))?.[1]?.mcpServers?.lighthouse;
    }
    if (path.resolve(entry.args[0]) !== path.join(home, 'lighthouse-mcp.cjs')) throw new Error();
    const ready = await probe(entry.command, entry.args, home);
    checks.push(check('tool server', ready ? 'ok' : 'fault', ready ? 'MCP initialize answered' : 'MCP did not answer'));
  } catch {
    checks.push(check('tool server', 'fault', 'local registration missing'));
  }
  const manifest = path.join(home, 'KIT-MANIFEST.json');
  try {
    const verify = spawnSync(
      process.platform === 'win32' ? 'python' : 'python3',
      [path.join(home, 'kit-state.py'), home, manifest],
      { encoding: 'utf8', windowsHide: true },
    );
    checks.push(check('kit version', verify.status === 0 ? 'ok' : 'fault', 'installed manifest verification'));
  } catch {
    checks.push(check('kit version', 'fault', 'manifest unavailable'));
  }
  const monitors = fs.readdirSync(home).filter(name => /^monitor-.*\.json$/.test(name));
  let stale = false;
  for (const name of monitors) {
    try {
      const lease = read(path.join(home, name));
      if (lease.expires <= Date.now()) stale = true;
      process.kill(lease.pid, 0);
    } catch {
      stale = true;
    }
  }
  const helpers = fs.readdirSync(home).filter(name => /^(collector|fmwatch\.cjs|boardwatch\.cjs|lh)\.pid$/.test(name));
  for (const name of helpers) {
    try {
      const pid = Number(fs.readFileSync(path.join(home, name), 'utf8').trim());
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error();
      process.kill(pid, 0);
    } catch {
      stale = true;
    }
  }
  checks.push(
    check(
      'watchers and lease',
      stale ? 'warning' : 'ok',
      stale
        ? 'expired or stopped Monitor; re-arm after shift start'
        : monitors.length
          ? 'Monitor leases live'
          : 'optional; off',
    ),
  );
  try {
    const origin = new URL(binding.endpoint);
    if (
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== '/' ||
      !(
        origin.protocol === 'https:' ||
        (origin.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname))
      )
    )
      throw new Error();
    const response = await fetch(new URL('/api/state', origin), {
      headers: { Authorization: 'Bearer ' + credential },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error();
    const state = await response.json();
    if (!state.boards?.[binding.boardId]) throw new Error();
    contactEndpoint = origin;
    const contact = new Date().toISOString();
    if (cfg.guidedSetup)
      fs.writeFileSync(path.join(home, 'last-contact.json'), JSON.stringify({ at: contact }), { mode: 0o600 });
    checks.push(check('last board contact', 'ok', contact));
  } catch {
    let at = 'none';
    try {
      at = read(path.join(home, 'last-contact.json')).at;
    } catch {}
    checks.push(check('last board contact', 'fault', /^\d{4}-\d\d-\d\dT/.test(at) ? at : 'none'));
  }
  if (cfg?.guidedSetup && binding?.installationId && contactEndpoint) {
    try {
      await fetch(new URL('/api/enrollment/doctor', contactEndpoint), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' },
        body: JSON.stringify({ checks: checks.map(item => ({ name: item.name, status: item.status })) }),
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
    } catch {}
  }
  return {
    kind: 'operator',
    checks,
    advisories,
    next: 'Start Claude in this home, approve the local MCP registration, reconnect.',
  };
}
function probe(command, args, home) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: home,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
      env: { ...process.env, LH_SERVER: 'probe-only', LH_MCP_PROBE: '1' },
    });
    let buffer = '',
      initialized = false,
      done = false;
    const finish = value => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, 10000);
    child.on('error', () => finish(false));
    child.on('exit', () => finish(initialized));
    child.stdin.on('error', () => {
      initialized = false;
    });
    child.stdout.on('data', data => {
      buffer += data;
      if (buffer.length > 1024 * 1024) return child.stdin.end();
      for (;;) {
        const at = buffer.indexOf('\n');
        if (at < 0) break;
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        try {
          if (JSON.parse(line).result?.serverInfo?.name === 'lighthouse') {
            initialized = true;
            child.stdin.end();
          }
        } catch {}
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
  });
}
function update(home) {
  const repository = fs.readFileSync(path.join(home, 'REPO.txt'), 'utf8').split(/\r?\n/)[1];
  if (!repository) throw new Error();
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const options = {
    cwd: home,
    windowsHide: true,
    stdio: 'ignore',
    timeout: 120000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' },
  };
  const installed = spawnSync(
    python,
    [
      path.join(repository, 'lighthouse/operator-kit/install.py'),
      '--config',
      path.join(home, 'config.json'),
      '--out',
      home,
    ],
    options,
  );
  if (installed.status !== 0) throw new Error();
  const verified = spawnSync(
    python,
    [path.join(home, 'kit-state.py'), home, path.join(home, 'KIT-MANIFEST.json')],
    options,
  );
  if (verified.status !== 0) throw new Error();
  return { updated: true, next: 'Lighthouse tools changed: reconnect with /mcp, or restart the session.' };
}
async function main(home, action) {
  if (action === 'update') return update(home);
  if (action === 'doctor' || action === 'status') return doctor(home);
  if (!['start', 'stop', 'end'].includes(action)) throw new Error();
  if (action === 'start') {
    const result = await doctor(home);
    if (result.checks.some(item => item.status === 'fault')) throw new Error();
  }
  const result = spawnSync(
    process.execPath,
    [path.join(home, 'lighthouse-mcp.cjs'), 'shift', action === 'start' ? 'start' : 'end'],
    { cwd: home, windowsHide: true, encoding: 'utf8', timeout: 15000 },
  );
  if (result.status !== 0) throw new Error();
  return { shift: action === 'start' ? 'on' : 'off', adapters: 'optional integrations off' };
}
if (require.main === module)
  main(__dirname, process.argv[2] || 'doctor').then(
    result => {
      console.log(JSON.stringify(result));
      if (result.checks?.some(item => item.status === 'fault')) process.exitCode = 1;
    },
    () => {
      console.error('Core shift refused; run doctor and check the private binding.');
      process.exitCode = 1;
    },
  );
module.exports = { doctor, probe, privateStorage, nodeCheck, nodeAdvisories };
