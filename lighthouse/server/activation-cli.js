#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const { assertPrivate, writePrivate } = require('./registry-files');

function optionsOf(args) {
  const command = args.shift();
  if (!['inspect', 'activate', 'verify', 'deactivate', 'ownership', 'new-session', 'resolve-gap'].includes(command))
    throw new Error('unknown command');
  const options = { command };
  const flags = ['confirm-all-writers', 'confirm-quiesced'];
  const values = ['endpoint', 'board', 'credential-file', 'input', 'output', 'expect', 'session-file'];
  for (let index = 0; index < args.length; index++) {
    const key = args[index].replace(/^--/, '');
    if (!args[index].startsWith('--') || options[key] !== undefined) throw new Error('invalid option');
    if (flags.includes(key)) options[key] = true;
    else if (values.includes(key) && args[index + 1] && !args[index + 1].startsWith('--')) options[key] = args[++index];
    else throw new Error('invalid option');
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(options.board || '')) throw new Error('one explicit board required');
  return options;
}
function read(file) {
  assertPrivate(file);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
async function run(args) {
  const options = optionsOf(args);
  const url = new URL(options.endpoint);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))
    )
  )
    throw new Error('HTTPS required off loopback');
  if (options.command === 'new-session') {
    const sessionId = options['session-file'] ? read(options['session-file']).sessionId : crypto.randomUUID();
    const credential = crypto.randomBytes(32).toString('base64url');
    writePrivate(options.output, { endpoint: url.origin, board: options.board, sessionId, credential });
    return { board: options.board, sessionId };
  }
  const credential = read(options['credential-file']).credential;
  if (typeof credential !== 'string' || !credential) throw new Error('private owner credential required');
  const endpoint = new URL('/api/boards/' + encodeURIComponent(options.board) + '/activation', url);
  const request = async (body, epoch, ownership = false) => {
    const target = ownership ? new URL(endpoint.href.replace(/activation$/, 'ownership')) : endpoint;
    const response = await fetch(target, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: 'Bearer ' + credential,
        'Content-Type': 'application/json',
        ...(epoch === undefined ? {} : { 'X-Lighthouse-Epoch': String(epoch) }),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('activation refused; inspect readiness and quiescence');
    return response.json();
  };
  if (options.command === 'inspect' || options.command === 'verify') {
    const view = await request();
    if (options.command === 'verify') {
      if (!['active', 'inactive'].includes(options.expect)) throw new Error('explicit expected mode required');
      if (view.enabled !== (options.expect === 'active')) throw new Error('verification failed');
      return { board: options.board, verified: options.expect, epoch: view.epoch };
    }
    if (options.output)
      writePrivate(options.output, {
        endpoint: url.origin,
        board: options.board,
        activation: {
          action: 'activate',
          operationId: crypto.randomUUID(),
          expectedEpoch: view.epoch,
          readiness: view.readiness,
          processIds: view.processIds,
          confirmAllWriters: true,
        },
        deactivation: {
          action: 'deactivate',
          operationId: crypto.randomUUID(),
          expectedEpoch: view.epoch,
          processIds: view.attachedProcessIds,
          confirmQuiesced: true,
        },
      });
    return view;
  }
  const plan = read(options.input);
  if (plan.board !== options.board || plan.endpoint !== url.origin) throw new Error('plan scope mismatch');
  if (options.command === 'resolve-gap') {
    if (plan.resolution?.action !== 'resolve-gap') throw new Error('explicit independent gap resolution required');
    return request(plan.resolution);
  }
  if (options.command === 'ownership') {
    if (!['register', 'nominate', 'acquire', 'locate', 'detach'].includes(plan.request?.action))
      throw new Error('unsupported ownership setup action');
    let body = plan.request;
    if (body.action === 'register') {
      const session = read(plan.sessionFile);
      if (session.sessionId !== body.sessionId) throw new Error('session file binding mismatch');
      body = { ...body, credential: session.credential };
    }
    await request();
    const result = await request(body, plan.epoch, true);
    return { board: options.board, action: plan.request.action, ...result };
  }
  const activate = options.command === 'activate';
  if (!options[activate ? 'confirm-all-writers' : 'confirm-quiesced']) throw new Error('explicit attestation required');
  const body = plan[activate ? 'activation' : 'deactivation'];
  if (body?.action !== options.command) throw new Error('plan action mismatch');
  const result = await request(body);
  const view = await request();
  if (view.enabled !== activate || result.enabled !== activate) throw new Error('verification failed; inspect');
  return { ...result, verified: activate ? 'active' : 'inactive' };
}
if (require.main === module)
  run(process.argv.slice(2)).then(
    result => console.log(JSON.stringify(result, null, 2)),
    () => {
      console.error(
        'Activation command failed. Inspect the named board; retain the plan for a retry. Details withheld.',
      );
      process.exitCode = 1;
    },
  );
module.exports = { run, optionsOf };
