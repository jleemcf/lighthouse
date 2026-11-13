'use strict';
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

function runScenario(options) {
  const { timeout, ...settings } = options;
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['scripts/ci-check.cjs'], {
      ...settings,
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    let error;
    const interruptions = new Map();
    const finish = result => {
      clearTimeout(timer);
      for (const [signal, listener] of interruptions) process.removeListener(signal, listener);
      resolve(result);
    };
    const stop = reason => {
      if (error) return;
      error = reason;
      try {
        if (process.platform === 'win32') {
          const killed = spawnSync(
            path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'),
            ['/pid', String(child.pid), '/t', '/f'],
            { encoding: 'utf8', windowsHide: true, timeout: 10000 },
          );
          if (killed.error || killed.status !== 0) {
            const detail = [killed.error?.message, killed.stdout, killed.stderr].filter(Boolean).join(' ').trim();
            throw new Error('taskkill exit ' + killed.status + ': ' + detail);
          }
        } else {
          process.kill(-child.pid, 'SIGKILL');
        }
      } catch (failure) {
        if (failure.code !== 'ESRCH') {
          error.message += '; cleanup failed: ' + failure.message;
          child.unref();
          finish({ status: null, error });
        }
      }
    };
    const timer = setTimeout(() => {
      stop(Object.assign(new Error('Scenario timed out after ' + timeout + 'ms'), { code: 'ETIMEDOUT' }));
    }, timeout);
    if (process.platform !== 'win32') {
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        const listener = () => stop(new Error('Scenario interrupted by ' + signal));
        interruptions.set(signal, listener);
        process.on(signal, listener);
      }
    }
    child.once('error', failure => {
      finish({ status: null, error: error || failure });
    });
    child.once('close', (status, signal) => {
      finish({ status: error ? null : status, signal, error });
    });
  });
}

module.exports = { runScenario };
