'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { uptime } = require('node:os');
const file = process.env.LH_MONITOR_LEASE;
const token = process.env.LH_MONITOR_LEASE_TOKEN;
const generation = Boolean(process.env.LH_HELPER_LEASE);
const active = Boolean(file) || generation;
let checkedUntil = 0;
let lastGood;
let observed;
let loss = 'unreadable';
let reported = false;
function parentAlive(identity) {
  if (!Number.isSafeInteger(identity) || identity <= 1) return false;
  try {
    process.kill(identity, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
function remaining(lease) {
  return lease.expiresUptime === undefined
    ? lease.expires - Date.now()
    : Number.isFinite(lease.expiresUptime)
      ? (lease.expiresUptime - uptime()) * 1000
      : NaN;
}
function valid(lease) {
  if (!token || lease.token !== token) loss = 'replaced';
  else if (!(Number.isFinite(lease.expires) && remaining(lease) > 0)) loss = 'expired';
  else if (!Array.isArray(lease.parents) || !lease.parents.length || !lease.parents.every(parentAlive))
    loss = 'parent gone';
  else return true;
  return false;
}
function transient(error) {
  return error instanceof SyntaxError || ['EPERM', 'EACCES', 'EBUSY'].includes(error.code);
}
function readLease() {
  const retryFor = lastGood ? Math.max(0, Math.min(250, remaining(lastGood))) : 250;
  const deadline = performance.now() + retryFor;
  for (;;) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (!transient(error) || performance.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(10, deadline - performance.now()));
    }
  }
}
function alive(fresh = false) {
  if (!active) return true;
  if (generation) {
    const state = require('./helper-generation.cjs').state();
    if (state !== 'active') {
      loss = state === 'retired' ? 'generation retired' : 'authority unconfirmed';
      return false;
    }
  }
  if (!file) return true;
  const now = performance.now();
  if (!fresh && now < checkedUntil) return true;
  checkedUntil = 0;
  try {
    const lease = readLease();
    loss = 'invalid lease';
    if (!lease || typeof lease !== 'object') return false;
    if (lease.token === token) observed = lease;
    if (!valid(lease)) return false;
    lastGood = lease;
  } catch (error) {
    loss = error.code === 'ENOENT' ? 'removed' : 'unreadable';
    if (!transient(error) || !lastGood || !valid(lastGood)) return false;
  }
  const left = remaining(lastGood);
  checkedUntil = performance.now() + Math.min(100, left);
  if (left > 0) return true;
  loss = 'expired';
  return false;
}
function stopped(code) {
  if (!file) {
    if (generation && loss !== 'generation retired') {
      try {
        const watcher = path.basename(process.argv[1] || 'watcher');
        fs.writeSync(1, 'WATCH LEASE | ' + watcher + ' stopped: authority unconfirmed; re-arm\n');
      } catch {}
    }
    process.exit(generation && loss !== 'generation retired' ? 1 : code);
  }
  if (!reported) {
    reported = true;
    const watcher = path.basename(process.argv[1] || 'watcher');
    const name = path.basename(file);
    const event = { t: new Date().toISOString(), watcher, pid: process.pid, lease: name, reason: loss };
    try {
      fs.appendFileSync(path.join(path.dirname(file), 'watch-lease-events.jsonl'), JSON.stringify(event) + '\n', {
        mode: 0o600,
      });
    } catch {}
    const monitor = lastGood || observed;
    const identity = monitor?.pid || monitor?.parents?.[0];
    if (!Number.isSafeInteger(identity) || identity <= 1 || parentAlive(identity)) {
      const advice = loss === 'replaced' ? 'newer Monitor owns this source; no action' : 'check gap; re-arm if needed';
      try {
        fs.writeSync(1, 'WATCH LEASE | ' + watcher + ' [' + name + '] stopped: ' + loss + '; ' + advice + '\n');
      } catch {}
    }
  }
  process.exit(generation && loss === 'authority unconfirmed' ? 1 : code);
}
function check(fresh = false) {
  if (!alive(fresh)) stopped(0);
}
function load(home, source) {
  if (!active) return null;
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(home, 'watch-cursor-' + source + '.json'), 'utf8'));
    if (!generation && (!Number.isFinite(saved.savedAt) || Date.now() - saved.savedAt > 2 * 3600000)) return null;
    if (generation) delete saved.lockPid;
    return saved;
  } catch {
    return null;
  }
}
function save(home, source, value) {
  if (!active) return;
  check(true);
  const cursor = path.join(home, 'watch-cursor-' + source + '.json');
  const saved = { ...value, savedAt: Date.now() };
  if (generation) {
    delete saved.lockPid;
    saved.scope = require('./helper-cursors.cjs').scope();
  }
  fs.writeFileSync(cursor + '.tmp', JSON.stringify(saved), { mode: 0o600 });
  const deadline = performance.now() + 500;
  for (;;) {
    check(true);
    try {
      fs.renameSync(cursor + '.tmp', cursor);
      return;
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || performance.now() >= deadline) {
        fs.rmSync(cursor + '.tmp', { force: true });
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
}
module.exports = { active, alive, check, load, save, stopReason: () => (reported ? loss : null) };
if (require.main === module) {
  if (!alive()) stopped(1);
  if (process.argv[2] === 'wait') {
    setInterval(() => {
      if (!alive()) stopped(1);
    }, 100).unref();
    setTimeout(
      () => {
        if (!alive()) stopped(1);
        process.exit(0);
      },
      Number(process.argv[3]) * 1000,
    );
  } else process.exit(0);
} else if (active) setInterval(check, 100).unref();
