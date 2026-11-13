'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function protect(file, directory = false) {
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('private storage must not be a symbolic link');
  if (process.platform !== 'win32') return fs.chmodSync(file, directory ? 0o700 : 0o600);
  const command = [
    '$ErrorActionPreference="Stop";',
    '$id=[Security.Principal.WindowsIdentity]::GetCurrent().User;',
    '$acl=Get-Acl -LiteralPath $env:LH_PRIVATE_PATH;',
    '$acl.SetAccessRuleProtection($true,$false);',
    'foreach($entry in @($acl.Access)){$acl.RemoveAccessRuleSpecific($entry);}',
    directory
      ? '$rule=New-Object Security.AccessControl.FileSystemAccessRule' +
        '($id,"FullControl","ContainerInherit,ObjectInherit","None","Allow");'
      : '$rule=New-Object Security.AccessControl.FileSystemAccessRule($id,"FullControl","Allow");',
    '$acl.AddAccessRule($rule);Set-Acl -LiteralPath $env:LH_PRIVATE_PATH -AclObject $acl;',
  ].join('');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, LH_PRIVATE_PATH: path.resolve(file) },
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error('could not protect private storage');
}

function flushDirectory(directory) {
  if (process.platform === 'win32') return;
  const descriptor = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertPrivate(file, directory = false) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error('private storage must not be a symbolic link');
  if (process.platform !== 'win32') {
    if (stat.mode & 0o077) throw new Error('private storage permits another account');
    return;
  }
  const command = [
    '$ErrorActionPreference="Stop";$acl=Get-Acl -LiteralPath $env:LH_PRIVATE_PATH;',
    '$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;',
    directory ? 'if(!$acl.AreAccessRulesProtected){exit 3};' : '',
    'if(!@($acl.Access).Count){exit 3};foreach($entry in @($acl.Access)){',
    'if($entry.AccessControlType -ne "Allow" -or ',
    '$entry.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid){exit 3}};',
  ].join('');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, LH_PRIVATE_PATH: path.resolve(file) },
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error('private storage permissions require local repair');
}

function writePrivate(file, value, inherit = false) {
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try {
    if (!inherit) protect(file);
    fs.writeFileSync(descriptor, JSON.stringify(value));
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  flushDirectory(path.dirname(file));
}

function processOwner() {
  return { pid: process.pid, stamp: processStamp(process.pid) };
}

function processStamp(pid) {
  if (process.platform !== 'linux') return null;
  const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
  const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() + ':' + start;
}

function ownerActive(owner) {
  const pid = typeof owner === 'number' ? owner : owner?.pid;
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('lock owner requires local repair');
  try {
    if (owner.stamp && process.platform === 'linux') return owner.stamp === processStamp(pid);
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (['ESRCH', 'ENOENT'].includes(error.code)) return false;
    return true;
  }
}

function openFiles(directory, fault = () => {}) {
  const existed = fs.existsSync(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (existed) assertPrivate(directory, true);
  else protect(directory, true);
  const pointer = path.join(directory, 'current.json');
  const lock = path.join(directory, 'writer.lock');
  const recovery = path.join(directory, 'recovery.lock');
  const repair = 'stop all board writers, verify their exit, then remove only the stale lock: ' + lock;
  let snapshot, selectedGeneration;
  function read() {
    if (!fs.existsSync(pointer)) return null;
    const manifest = JSON.parse(fs.readFileSync(pointer, 'utf8'));
    if (manifest.format !== 1 || !/^[a-f0-9]{32}$/.test(manifest.generation))
      throw new Error('unsupported registry format');
    if (snapshot && selectedGeneration === manifest.generation) return snapshot;
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, manifest.generation + '.json'), 'utf8'));
    const credentials = JSON.parse(
      fs.readFileSync(path.join(directory, manifest.generation + '.credentials.json'), 'utf8'),
    );
    if (metadata.format !== 1 || credentials.format !== 1) throw new Error('unsupported registry format');
    snapshot = { metadata, credentials };
    selectedGeneration = manifest.generation;
    return snapshot;
  }
  function acquire() {
    if (fs.existsSync(recovery)) throw new Error('registry lock recovery is busy; ' + repair);
    try {
      const descriptor = fs.openSync(lock, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(processOwner()));
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const recorded = fs.readFileSync(lock, 'utf8');
      const owner = JSON.parse(recorded);
      if (!ownerActive(owner)) {
        const descriptor = fs.openSync(recovery, 'wx', 0o600);
        fs.closeSync(descriptor);
        try {
          if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8') === recorded) fs.unlinkSync(lock);
        } finally {
          fs.unlinkSync(recovery);
        }
        return acquire();
      }
      throw new Error('registry is busy; retry the same operation; ' + repair);
    }
  }
  function transact(mutate) {
    acquire();
    try {
      const next = structuredClone(read() || { metadata: null, credentials: null });
      const result = mutate(next);
      const generation = crypto.randomBytes(16).toString('hex');
      writePrivate(path.join(directory, generation + '.json'), next.metadata, true);
      fault('metadata-flushed');
      writePrivate(path.join(directory, generation + '.credentials.json'), next.credentials, true);
      fault('credentials-flushed');
      const temporary = path.join(directory, generation + '.current.tmp');
      writePrivate(temporary, { format: 1, generation }, true);
      fault('pointer-flushed');
      fs.renameSync(temporary, pointer);
      fault('pointer-renamed');
      flushDirectory(directory);
      snapshot = next;
      selectedGeneration = generation;
      fault('committed');
      return result;
    } finally {
      fs.unlinkSync(lock);
    }
  }
  return { read, transact, current: () => snapshot, directory };
}

module.exports = { openFiles, protect, assertPrivate, writePrivate, flushDirectory, processOwner, ownerActive };
