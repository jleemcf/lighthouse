'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const generations = require('./helper-generation.cjs');

async function supervise({ home, board, session, kind, request, command, args, env = process.env, stdio = 'inherit' }) {
  const status = await request();
  if (kind === 'fmwatch' && !['same-home', 'same-machine'].includes(status.targetAvailability))
    throw new Error('original firstmate route unavailable here; fmwatch remains stopped');
  if (kind === 'fmwatch') require('./target-binding.cjs').verify(home, status.targetBinding);
  const helper = generations.create(home, board, session, status, kind);
  let child;
  let timer;
  let closed = false;
  let refreshing = false;
  const close = reason => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    if (reason === 'authority unconfirmed' || reason === 'spawn failed') {
      const detail =
        reason === 'spawn failed' ? 'process start failed; check runtime' : 'authority unconfirmed; re-arm';
      try {
        fs.writeSync(1, 'WATCH LEASE | ' + kind + ' stopped: ' + detail + '\n');
      } catch {}
      process.exitCode = 1;
    }
    generations.retire(helper);
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
  };
  try {
    child = spawn(command, args, {
      cwd: home,
      stdio,
      windowsHide: true,
      env: { ...env, LH_HELPER_LEASE: helper.file, LH_HELPER_ID: helper.id },
    });
    child.once('error', () => close('spawn failed'));
    child.once('exit', code => {
      if (!closed && code) process.exitCode = code;
      close();
    });
    timer = setInterval(async () => {
      if (refreshing || closed) return;
      refreshing = true;
      let current;
      try {
        current = await request();
      } catch {
        if (Date.now() >= helper.record.expiresAt) close('authority unconfirmed');
      } finally {
        refreshing = false;
      }
      if (!current || closed) return;
      try {
        if (kind === 'fmwatch') {
          if (!['same-home', 'same-machine'].includes(current.targetAvailability))
            throw new Error('original firstmate route unavailable');
          require('./target-binding.cjs').verify(home, current.targetBinding);
        }
        generations.refresh(helper, current);
      } catch (error) {
        if (['EPERM', 'EACCES', 'EBUSY'].includes(error.code) && Date.now() < helper.record.expiresAt) return;
        const newer = Number.isSafeInteger(current.ownership?.epoch) && current.ownership.epoch > session.epoch;
        close(newer ? 'generation retired' : 'authority unconfirmed');
      }
    }, 750);
    return { child, helper, close };
  } catch (error) {
    close();
    throw error;
  }
}

function statusRequest(server, board, session) {
  const url = new URL('/api/boards/' + encodeURIComponent(board) + '/handoff', server);
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('private session requires TLS outside loopback');
  return () =>
    new Promise((resolve, reject) => {
      const client = require(url.protocol === 'https:' ? 'node:https' : 'node:http');
      const request = client.get(url, { headers: session.headers, timeout: 2000 }, response => {
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 1024 * 1024) request.destroy(new Error('handoff status too large'));
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          try {
            if (response.statusCode !== 200) throw new Error('handoff status refused');
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (error) {
            reject(error);
          }
        });
      });
      request.on('timeout', () => request.destroy(new Error('ownership check timed out')));
      request.on('error', reject);
    });
}
module.exports = { supervise, statusRequest };

async function main() {
  const home = __dirname;
  const cfg = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  const identity = require('./session-identity.cjs').identity;
  const session = identity();
  if (!session) throw new Error('explicit authorized operator session required');
  const kind = process.argv[2];
  const board = process.env.LH_BOARD || cfg.board;
  const server = process.env.LH_SERVER || cfg.server;
  const env = { ...process.env, LH_TOKEN: session.credential };
  let command = process.execPath;
  let args;
  if (kind === 'collector') {
    const collector = identity({
      ...process.env,
      LH_SESSION_CREDENTIAL_FILE: process.env.LH_COLLECTOR_CREDENTIAL_FILE,
    });
    if (
      !collector ||
      collector.sessionId !== session.sessionId ||
      collector.epoch !== session.epoch ||
      collector.credential === session.credential
    )
      throw new Error('separate same-session collector credential and exact epoch required');
    env.LH_TOKEN = collector.credential;
    command = process.env.LH_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    args = [
      path.join(home, 'collector.py'),
      ...process.argv.slice(3),
      '--board',
      board,
      '--server',
      server,
      '--protocol',
      'tools',
    ];
  } else if (kind === 'boardwatch') args = [path.join(home, 'boardwatch.cjs'), '--board', board, '--server', server];
  else if (kind === 'fmwatch') args = [path.join(home, 'fmwatch.cjs')];
  else throw new Error('choose boardwatch, fmwatch or collector');
  const running = await supervise({
    home,
    board,
    session,
    kind,
    command,
    args,
    env,
    request: statusRequest(server, board, session),
  });
  const stop = () => {
    running.close();
    process.exitCode = 0;
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
if (require.main === module)
  main().catch(() => {
    process.stderr.write(
      'Helper not started: verify recovery readiness, explicit credentials and original target route.\n',
    );
    process.exitCode = 1;
  });
