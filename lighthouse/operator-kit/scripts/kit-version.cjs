'use strict';
// Installed and loaded kit identity: complete/incomplete files, live MCP receipts and a persistent reconnect marker.
// The installer owns target hashes; each tool process reports its loaded code; only matching live processes clear it.
// Unknown, unreadable or unreachable copies stay unknown, never a false claim that an update or reconnect succeeded.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const HELPER_SOURCE = 'kit-helper-source-v1';
const read = file => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const safeVersion = value => /^[a-f0-9]{40}(\+[a-f0-9]{12})?$|^unversioned\+[a-f0-9]{12}$/.test(value || '');
function installed(home) {
  const manifest = read(path.join(home, 'KIT-MANIFEST.json'));
  if (!manifest || !safeVersion(manifest.release)) return 'unknown (no versioned manifest)';
  try {
    for (const [name, expected] of Object.entries(manifest.files)) {
      // A locked file staged as .new is still an incomplete installation, even when the old file remains readable.
      const target = path.join(home, name);
      if (fs.existsSync(target + '.new') || hash(fs.readFileSync(target)) !== expected) {
        return 'incomplete (target ' + manifest.release + ')';
      }
    }
    return manifest.release;
  } catch {
    return 'incomplete (target ' + manifest.release + ')';
  }
}
function running(home) {
  const directory = path.join(home, 'mcp-loaded');
  try {
    return fs.readdirSync(directory).flatMap(name => {
      if (!/^\d+\.json$/.test(name)) return [];
      const record = read(path.join(directory, name));
      if (!record || !/^[a-f0-9]{64}$/.test(record.version)) return [];
      try {
        // Dead process receipts are evidence of an old load, not a session that still needs reconnecting.
        process.kill(record.pid, 0);
        return [record];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}
function connect(home, mcpSource, specSource) {
  // Hash what this process loaded, not files that an updater may have replaced after startup.
  const loaded = hash(mcpSource + hash(specSource) + HELPER_SOURCE);
  const receipt = path.join(home, 'mcp-loaded', process.pid + '.json');
  const marker = path.join(home, 'MCP-RECONNECT.json');
  const target = () => read(path.join(home, 'KIT-MANIFEST.json'))?.mcpVersion;
  const notice = () => {
    const expected = target();
    const mismatched = expected && (loaded !== expected || running(home).some(item => item.version !== expected));
    return fs.existsSync(marker) || mismatched
      ? 'Lighthouse tools changed: reconnect the lighthouse MCP server with /mcp, or restart the session. ' +
          'A running session keeps the old tools until you do.'
      : '';
  };
  function report() {
    // A diagnostic initialize is not an attached Claude session and cannot acknowledge a reconnect.
    if (process.env.LH_MCP_PROBE === '1') return;
    try {
      fs.mkdirSync(path.dirname(receipt), { recursive: true });
      fs.writeFileSync(receipt + '.tmp', JSON.stringify({ pid: process.pid, version: loaded }));
      fs.renameSync(receipt + '.tmp', receipt);
      const expected = target();
      if (
        loaded === expected &&
        (!read(marker) || read(marker).target === expected) &&
        running(home).every(item => item.version === expected)
      ) {
        // Do not clear a newer update's intent or hide an older tool server still loaded in another session.
        fs.rmSync(marker, { force: true });
      }
    } catch {}
  }
  process.once('exit', () => {
    try {
      fs.rmSync(receipt, { force: true });
    } catch {}
  });
  return { loaded, report, notice, status: () => status(home, loaded) };
}

function status(home, loaded) {
  const manifest = read(path.join(home, 'KIT-MANIFEST.json'));
  let repository = 'unknown';
  let twin = 'unknown (unreachable or unverified)';
  try {
    const repo = fs.readFileSync(path.join(home, 'REPO.txt'), 'utf8').split(/\r?\n/)[1];
    // Repository, installed Windows and verified WSL versions are separate facts; one cannot stand in for another.
    const result = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0 && /^[a-f0-9]{40}$/.test(result.stdout.trim())) repository = result.stdout.trim();
    const config = read(path.join(home, 'config.json')) || {};
    const key = name => ['__', name, '__'].join('');
    const distro = config[key('WSL_DISTRO')];
    const directory = config[key('OPERATOR_WSL_DIR')];
    const mounted = home.replace(/\\/g, '/').replace(/^([a-z]):\//i, (_, drive) => '/mnt/' + drive.toLowerCase() + '/');
    const copied = spawnSync(
      'wsl',
      [
        '-d',
        distro,
        '-e',
        'python3',
        mounted + '/kit-state.py',
        directory,
        directory + '/KIT-MANIFEST.json',
        '--side',
        'wsl',
        '--describe',
      ],
      { encoding: 'utf8', timeout: 10000 },
    );
    const value = copied.status === 0 ? JSON.parse(copied.stdout) : null;
    if (safeVersion(value?.release)) twin = value.release;
  } catch {}
  const records = running(home);
  const versions = [...new Set(records.map(item => item.version))];
  const required =
    fs.existsSync(path.join(home, 'MCP-RECONNECT.json')) ||
    versions.some(version => version !== manifest?.mcpVersion) ||
    (loaded && loaded !== manifest?.mcpVersion);
  return [
    'Repository: ' + repository,
    'Installed Windows: ' + installed(home),
    'Installed WSL: ' + twin,
    'Target MCP: ' + (/^[a-f0-9]{64}$/.test(manifest?.mcpVersion || '') ? manifest.mcpVersion : 'unknown'),
    'Loaded MCP: ' + (versions.length ? versions.join(', ') : 'unknown (no reporting server)'),
    ...(loaded ? ['This MCP: ' + loaded] : []),
    'Reconnect required: ' +
      (required
        ? 'yes; use /mcp or restart the session'
        : versions.length
          ? 'no reported mismatch'
          : 'unknown; connect MCP to report its loaded version'),
  ].join('\n');
}

module.exports = { connect, installed, running, status };
if (require.main === module) {
  const home = process.argv[2] || __dirname;
  if (process.argv[3] === 'notice') {
    if (
      fs.existsSync(path.join(home, 'MCP-RECONNECT.json')) ||
      running(home).some(item => item.version !== read(path.join(home, 'KIT-MANIFEST.json'))?.mcpVersion)
    ) {
      console.log(
        'Lighthouse tools changed: reconnect the lighthouse MCP server with /mcp, or restart the session. ' +
          'A running session keeps the old tools until you do.',
      );
    }
  } else console.log(status(home));
}
