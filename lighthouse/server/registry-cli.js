#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { makeRegistry, digest, secret, fail } = require('./registry');
const { makeEnrollment } = require('./enrollment');
const { writePrivate, assertPrivate } = require('./registry-files');

function argumentsOf(args) {
  const result = { command: null };
  for (let index = 0; index < args.length; index++) {
    const item = args[index];
    if (!item.startsWith('--')) {
      if (result.command) throw fail('only one registry command is accepted');
      result.command = item;
    } else {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw fail('an option requires a value');
      result[item.slice(2)] = args[++index];
    }
  }
  return result;
}

function read(file, privateFile = false) {
  if (!file) throw fail('a protected input file is required');
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw fail('input must be a regular file');
  if (privateFile) assertPrivate(file);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function run(args) {
  const options = argumentsOf(args),
    command = options.command;
  if (command === 'prepare') {
    if (!options.output || !options.request) throw fail('prepare requires --output and --request file paths');
    const prepared = {
      installationId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      proof: secret(),
      credential: secret(),
    };
    writePrivate(options.output, prepared);
    writePrivate(options.request, { installationId: prepared.installationId, proofVerifier: digest(prepared.proof) });
    return { installationId: prepared.installationId, prepared: true };
  }
  if (!options.config) throw fail('--config is required');
  const configPath = path.resolve(options.config);
  if (command === 'migrate') return require('./registry-migrate').migrate(configPath, { backup: options.backup });
  const cfg = require('./configuration').normalize(read(configPath), configPath);
  if (command === 'bootstrap' || command === 'grant' || command === 'reconcile') {
    const registry = makeRegistry(cfg, configPath);
    if (!registry.persistent) throw fail('offline registry migration required', 409);
    const enrollment = makeEnrollment(registry, cfg);
    if (command === 'bootstrap') {
      if (!options.output) throw fail('bootstrap requires a protected --output file');
      return enrollment.bootstrap(options.principal, value => writePrivate(options.output, value));
    }
    const admin = read(options['credential-file'], true);
    const who = enrollment.authenticate(admin.credential);
    if (!who?.hostAdmin) throw fail('host administrator credential required', 403);
    if (command === 'reconcile') return registry.reconcile();
    if (!options.output) throw fail('grant requires a protected --output file');
    return enrollment.issue(who, read(options.input), value => writePrivate(options.output, value));
  }
  const endpoint = new URL(options.endpoint || 'http://127.0.0.1:' + (cfg.port || 7700));
  const local = ['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname);
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/' ||
    !(endpoint.protocol === 'https:' || (endpoint.protocol === 'http:' && local))
  )
    throw fail('endpoint must use HTTPS off loopback and contain no credentials or query');
  const headers = { 'Content-Type': 'application/json' };
  let prepared, input, route;
  if (command === 'enroll') {
    if (!options.output) throw fail('enroll requires a protected binding --output file');
    prepared = read(options.prepared, true);
    const grant = read(options['grant-file'], true);
    input = { ...prepared, grant: grant.grant, scope: grant.scope };
    route = '/api/enrollment/consume';
  } else {
    if (
      !['create', 'rename', 'reorder', 'preview', 'archive', 'revoke', 'rotate', 'member', 'revoke-grant'].includes(
        command,
      )
    )
      throw fail('unknown registry command');
    const admin = read(options['credential-file'], true);
    headers.Authorization = 'Bearer ' + admin.credential;
    input = read(options.input, command === 'rotate');
    route = '/api/registry/' + command;
  }
  const response = await fetch(new URL(route, endpoint), {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw fail('registry request refused with HTTP ' + response.status, response.status);
  const result = await response.json();
  if (command === 'enroll') {
    const binding = { ...result, endpoint: endpoint.origin, credential: prepared.credential };
    if (fs.existsSync(options.output)) {
      const current = read(options.output, true);
      if (current.installationId !== binding.installationId || current.credential !== binding.credential)
        throw fail('binding output already exists and differs');
    } else writePrivate(options.output, binding);
  }
  return result;
}

if (require.main === module)
  run(process.argv.slice(2)).then(
    result => console.log(JSON.stringify(result)),
    error => {
      console.error(error.status ? error.message : 'registry command failed; credentials were not printed');
      process.exitCode = 1;
    },
  );

module.exports = { run, read, argumentsOf };
