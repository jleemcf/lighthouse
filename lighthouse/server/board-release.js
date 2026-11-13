'use strict';
// Code-only board deployment: stage and validate -> back up -> quiet/stop -> snapshot -> activate -> health -> commit.
// The host's deploy command owns activation; rollback/recover restore a retained release without migrating data.
// Refuse foreign targets, incompatible stores and unfinished journals; failed recovery retains evidence for the host.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const check = require('./release-check');

function atomic(file, content) {
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function copyRelease(source, destination, legacy = false) {
  fs.mkdirSync(destination, { recursive: true });
  for (const name of fs.readdirSync(source)) {
    if (!name.endsWith('.js') && !['rulings.json', 'board.sh', 'release.json'].includes(name)) continue;
    const from = path.join(source, name);
    if (!fs.lstatSync(from).isFile()) throw new Error('release code must be regular files');
    let content = fs.readFileSync(from);
    if (name.endsWith('.sh')) content = Buffer.from(content.toString().replace(/\r\n/g, '\n'));
    fs.writeFileSync(path.join(destination, name), content);
  }
  if (legacy && !fs.existsSync(path.join(destination, 'release.json')))
    fs.writeFileSync(path.join(destination, 'release.json'), JSON.stringify(check.legacyManifest));
  fs.mkdirSync(path.join(destination, 'public'));
  for (const name of fs.readdirSync(path.join(source, 'public'))) {
    const from = path.join(source, 'public', name);
    if (!fs.lstatSync(from).isFile()) throw new Error('release assets must be regular files');
    fs.copyFileSync(from, path.join(destination, 'public', name));
  }
}

function releasePath(home, target) {
  // A rollback target must be this home's retained code, not an arbitrary directory reached through a symlink.
  const directory = fs.realpathSync(target);
  const releases = path.join(home, 'releases');
  if (path.dirname(directory) !== releases) throw new Error('target must be a retained release in this board home');
  return directory;
}

function activeRelease(home) {
  const current = path.join(home, 'current');
  let link;
  try {
    link = fs.lstatSync(current);
  } catch (error) {
    if (error.code === 'ENOENT') return home;
    throw error;
  }
  if (!link.isSymbolicLink()) throw new Error('current must be a release symlink');
  return releasePath(home, current);
}

function switchRelease(home, release) {
  const target = releasePath(home, release);
  const next = path.join(home, '.current-' + crypto.randomUUID());
  fs.symlinkSync(path.relative(home, target), next);
  fs.renameSync(next, path.join(home, 'current'));
}

function manager(home, action) {
  const result = spawnSync('bash', [path.join(home, 'board.sh'), action], {
    env: { ...process.env, LH_CONFIG: path.join(home, 'config.json'), LH_CONTROL_LOCKED: '1', NODE: process.execPath },
    encoding: 'utf8',
    timeout: 20000,
  });
  if (result.status !== 0) throw new Error('board ' + action + ' failed; inspect board.log and board.pid');
}

function logOffset(home) {
  const log = path.join(home, 'board.log');
  return fs.existsSync(log) ? fs.statSync(log).size : 0;
}

async function restore(home, record, timing) {
  // Check the old code against today's store before stopping anything; rollback never rolls back user data.
  const settings = check.config(home);
  const previous = releasePath(home, record.previous);
  check.compatible(previous, settings.storeFile);
  if (check.running(home)) manager(home, 'stop');
  if (check.running(home)) throw new Error('recovery stop timed out; release pointer unchanged');
  if (fs.existsSync(path.join(record.backup, 'board.sh')))
    atomic(path.join(home, 'board.sh'), fs.readFileSync(path.join(record.backup, 'board.sh'), 'utf8'));
  const current = path.join(home, 'current');
  if (fs.existsSync(current)) {
    if (record.legacy) fs.unlinkSync(current);
    else switchRelease(home, previous);
  } else if (!record.legacy) switchRelease(home, previous);
  const release = activeRelease(home);
  if (record.wasRunning) {
    const offset = logOffset(home);
    const before = check.storeState(settings.storeFile);
    manager(home, 'start');
    await check.healthy(home, release, settings, before, offset, timing, previous);
  }
}

async function run({ action, source, home, target, checkpoint = async () => {}, timing = {} }) {
  home = fs.realpathSync(home);
  const journal = path.join(home, '.board-deploy.json');
  const stage = async (name, operation) => {
    await checkpoint(name + '.before');
    const result = await operation();
    await checkpoint(name + '.after');
    return result;
  };
  if (action === 'recover') {
    if (!fs.existsSync(journal)) throw new Error('no interrupted deployment to recover');
    await restore(home, check.json(journal), timing);
    fs.unlinkSync(journal);
    console.log('previous release restored; deployment journal cleared');
    return;
  }
  if (fs.existsSync(journal)) throw new Error('unfinished deployment; run deploy-board.sh recover before retrying');
  if (!['deploy', 'rollback'].includes(action)) throw new Error('expected deploy, rollback or recover');
  const overlay = path.resolve(source || __dirname, '../../private/compatibility/profile.json');
  if (action === 'deploy' && fs.existsSync(overlay)) {
    const profile = check.json(overlay);
    const configured = check.json(path.join(home, 'config.json'));
    if (
      JSON.stringify(Object.keys(configured.boards || {}).sort()) === JSON.stringify([...profile.matchBoardIds].sort())
    ) {
      if (!configured.profile)
        throw new Error('Apply the compatibility profile with backup before deploying this board set');
      if (!configured.pushSubject)
        throw new Error('Preserve the existing pushSubject in host configuration before deploying this board set');
    }
  }
  const active = activeRelease(home);
  const settings = check.config(home);
  const wasRunning = Boolean(check.running(home));
  if (wasRunning && check.running(home) !== path.join(active, 'server.js'))
    throw new Error('running release differs from current; recover manually before deploying');
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8);
  const releases = path.join(home, 'releases');
  fs.mkdirSync(releases, { recursive: true });
  let candidate;
  let record;
  let stopped = false;
  let activated = false;
  try {
    candidate = await stage('stage', () => {
      if (action === 'rollback') return releasePath(home, target);
      const directory = path.join(releases, id);
      copyRelease(source, directory);
      return directory;
    });
    await stage('validate', () => check.validate(candidate, home));
    const previous = await stage('backup', () => {
      if (check.storeState(settings.storeFile).schema === 2) {
        try {
          check.compatible(active, settings.storeFile);
        } catch {
          const receipt = check.json(settings.storeFile + '.registry-migration.json');
          const fallback = releasePath(home, receipt.rollbackRelease);
          check.validate(fallback, home);
          return fallback;
        }
      }
      if (active !== home) return active;
      // The first managed deploy retains a runnable copy of the flat installation before replacing its manager.
      const directory = path.join(releases, 'legacy-' + id);
      copyRelease(home, directory, true);
      fs.copyFileSync(path.join(directory, 'board.sh'), path.join(directory, 'legacy-manager.sh'));
      const managerSource = fs.readFileSync(path.join(source, 'board.sh'), 'utf8').replace(/\r\n/g, '\n');
      fs.writeFileSync(path.join(directory, 'board.sh'), managerSource);
      check.validate(directory, home);
      return directory;
    });
    record = {
      previous,
      candidate,
      wasRunning,
      legacy: active === home && path.basename(previous).startsWith('legacy-'),
      stage: 'prepared',
      backup: path.join(home, 'backups', id),
    };
    // Record recovery intent before stopping the board or changing its active pointer.
    atomic(journal, JSON.stringify(record));
    await stage('quiet', () => check.quiet(settings.storeFile, timing));
    await stage('stop', () => {
      manager(home, 'stop');
      if (check.running(home)) throw new Error('board stop timed out; release pointer unchanged');
      stopped = true;
    });
    await stage('snapshot', () => {
      // Recheck both code contracts after quiescence; a code-only deploy must remain reversible on this store.
      check.compatible(candidate, settings.storeFile);
      check.compatible(previous, settings.storeFile);
      fs.mkdirSync(record.backup, { recursive: true, mode: 0o700 });
      fs.copyFileSync(path.join(record.legacy ? home : previous, 'board.sh'), path.join(record.backup, 'board.sh'));
      if (fs.existsSync(settings.storeFile))
        fs.copyFileSync(settings.storeFile, path.join(record.backup, 'store.json'));
      atomic(path.join(record.backup, 'release.json'), JSON.stringify({ release: previous }));
    });
    const before = check.storeState(settings.storeFile);
    await stage('migrate', () => {
      atomic(path.join(home, 'board.sh'), fs.readFileSync(path.join(candidate, 'board.sh'), 'utf8'));
      if (active === home) switchRelease(home, previous);
    });
    await stage('switch', () => {
      record.stage = 'activating';
      atomic(journal, JSON.stringify(record));
      switchRelease(home, candidate);
      activated = true;
    });
    const offset = logOffset(home);
    await stage('start', () => manager(home, 'start'));
    await stage('health', () => check.healthy(home, candidate, settings, before, offset, timing));
    await stage('commit', () => {
      atomic(path.join(home, 'previous-release.json'), JSON.stringify({ release: previous }));
    });
    fs.unlinkSync(journal);
    console.log('active release: ' + path.basename(candidate));
    console.log('retained previous release: ' + path.basename(previous));
    console.log('store safety copy: ' + record.backup);
  } catch (error) {
    // Before activation nothing live changed; after stopping, restore service or keep the journal for recovery.
    if (record && (stopped || activated)) {
      try {
        await restore(home, record, timing);
        if (fs.existsSync(journal)) fs.unlinkSync(journal);
      } catch (recovery) {
        throw new Error(error.message + '; recovery refused/failed: ' + recovery.message + '; journal retained');
      }
    } else if (record && fs.existsSync(journal)) fs.unlinkSync(journal);
    throw error;
  }
}

if (require.main === module) {
  const [action, source, home, target] = process.argv.slice(2);
  run({ action, source, home, target }).catch(error => {
    console.error('deployment failed: ' + error.message);
    process.exitCode = 1;
  });
}

module.exports = { run, activeRelease, switchRelease, copyRelease };
