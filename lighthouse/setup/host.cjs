'use strict';
const { fs, path, run, directory, writePrivate, flushDirectory } = require('./common.cjs');
const { gitArgs: repositoryGitArgs } = require('../../scripts/git-args.cjs');
const repository = path.resolve(__dirname, '../..');
function gitArgs() {
  return repositoryGitArgs(repository);
}

function prerequisites() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22 or newer is required.');
  if (process.platform !== 'linux')
    throw new Error('Run host init inside Linux or WSL. On Windows use wsl.exe -d DISTRO -e node.');
  for (const name of ['bash', 'flock', 'setsid', 'curl', 'git'])
    run('bash', ['-c', 'command -v "$1" >/dev/null', 'lighthouse-prerequisite', name]);
}
function pinnedRelease(destination, revision) {
  const head = run('git', [...gitArgs(), 'rev-parse', 'HEAD']);
  if (revision && revision !== head) throw new Error('Use a checkout at the requested full release commit.');
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('A pinned Git release is required.');
  const prefix = 'lighthouse/server/';
  const names = run('git', [...gitArgs(), 'ls-tree', '-r', '--name-only', head, '--', prefix]).split('\n');
  fs.mkdirSync(destination, { recursive: true });
  for (const name of names) {
    const relative = name.slice(prefix.length);
    if (
      !(
        relative.startsWith('public/') ||
        (!relative.includes('/') &&
          (/\.js$/.test(relative) || ['rulings.json', 'board.sh', 'release.json'].includes(relative)))
      )
    )
      continue;
    const result = require('node:child_process').spawnSync('git', [...gitArgs(), 'show', head + ':' + name], {
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    if (result.status !== 0) throw new Error('Pinned release could not be read.');
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const bytes = relative.endsWith('.sh') ? result.stdout.toString().replace(/\r\n/g, '\n') : result.stdout;
    fs.writeFileSync(target, bytes);
  }
  return head;
}
async function init(options) {
  prerequisites();
  const home = path.resolve(options.home || path.join(require('node:os').homedir(), 'lighthouse-board'));
  const port = Number(options.port || 7700);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('A valid port is required.');
  // Refusal precedes every write, including permission changes. An interrupted initializer is never an upgrade.
  directory(home, true);
  writePrivate(path.join(home, '.initializing.json'), { format: 1 });
  const release = path.join(home, 'releases', 'initial');
  const revision = pinnedRelease(release, options.release);
  const cfg = {
    profile: 'core',
    bind: '127.0.0.1',
    port,
    storeFile: 'store.json',
    boards: {},
    tokens: {},
    ownerId: 'owner',
    ownerName: 'the captain',
    timeZone: 'UTC',
    trustTailscaleHeaders: false,
    jevEnabled: false,
    enrollment: { enabled: true },
  };
  writePrivate(path.join(home, 'config.json'), cfg);
  writePrivate(path.join(home, 'store.json'), { seq: 0, boards: {}, cards: {}, comments: {}, changes: [] });
  // This is a new empty store: initialize directly, without invoking the legacy conversion/backup workflow.
  const registry = require(path.join(release, 'registry.js')).makeRegistry(cfg, path.join(home, 'config.json'), {
    initialize: true,
  });
  require(path.join(release, 'enrollment.js'))
    .makeEnrollment(registry, cfg)
    .bootstrap('host-admin', value => {
      writePrivate(path.join(home, 'admin.json'), value);
    });
  const store = path.join(home, 'store.json');
  writePrivate(store + '.initialized', { schemaVersion: 2, seq: 0, boards: {}, cards: {}, comments: {}, changes: [] });
  fs.renameSync(store + '.initialized', store);
  fs.symlinkSync(path.relative(home, release), path.join(home, 'current'));
  fs.copyFileSync(path.join(release, 'board.sh'), path.join(home, 'board.sh'));
  writePrivate(path.join(home, 'INITIAL-RELEASE.json'), { revision, schema: 2 });
  fs.unlinkSync(path.join(home, '.initializing.json'));
  flushDirectory(home);
  return {
    initialized: true,
    schema: 2,
    release: revision,
    administrator: 'protected file',
    enrollment: 'enabled for this new host',
    listening: false,
  };
}
module.exports = { init, prerequisites, gitArgs };
