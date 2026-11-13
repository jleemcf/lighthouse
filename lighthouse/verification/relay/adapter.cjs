'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const SOURCE = path.join(__dirname, '../../operator-kit/scripts/lighthouse-mcp.cjs');
const text = 'Execute this synthetic task';
const ticket = {
  id: 'synthetic-ticket',
  to: 'firstmate',
  text,
  hash: crypto.createHash('sha256').update(text).digest('hex'),
};
const accepted = { status: 200, body: { results: [{ ok: true, summary: 'Relayed; recorded.' }] } };

function fixture(context) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-relay-'));
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.copyFileSync(path.join(path.dirname(SOURCE), 'kit-version.cjs'), path.join(home, 'kit-version.cjs'));
  fs.copyFileSync(path.join(path.dirname(SOURCE), 'session-identity.cjs'), path.join(home, 'session-identity.cjs'));
  fs.copyFileSync(path.join(path.dirname(SOURCE), 'handoff.cjs'), path.join(home, 'handoff.cjs'));
  for (const name of ['dispatch-client.cjs', 'dispatch-storage.cjs', 'mcp-setup.cjs', 'activation-client.cjs'])
    fs.copyFileSync(path.join(path.dirname(SOURCE), name), path.join(home, name));
  fs.writeFileSync(
    path.join(home, 'toolcalls-spec.json'),
    JSON.stringify({ tools: [{ name: 'board_relay' }, { name: 'board_status' }] }),
  );
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  fs.writeFileSync(
    path.join(home, 'KIT-MANIFEST.json'),
    JSON.stringify({
      release: 'unversioned+123456789abc',
      mcpVersion: hash(
        'kit-mcp-source-v1' + hash(fs.readFileSync(path.join(home, 'toolcalls-spec.json'))) + 'kit-helper-source-v1',
      ),
      files: Object.fromEntries(fs.readdirSync(home).map(name => [name, hash(fs.readFileSync(path.join(home, name)))])),
    }),
  );
  return home;
}

function adapter(home, options = {}) {
  const sends = options.sends || [];
  const requests = [];
  const transport = async (method, route, body) => {
    if (route.endsWith('/ownership')) return { status: 200, body: { ok: true } };
    if (route.endsWith('/activation'))
      return options.ledger ? options.ledger(method, body) : { status: 200, body: { ok: true } };
    if (route.endsWith('/dispatch-ledger'))
      return options.ledger ? options.ledger(method, body) : { status: 200, body: { enabled: false } };
    if (route.endsWith('/handoff')) return { status: 200, body: options.handoffState || { enabled: false } };
    const call = body.calls[0];
    requests.push(call);
    if (call.tool === 'board_relay')
      return { status: 200, body: { results: [{ ok: true }], ticket: options.ticket || ticket } };
    if (call.tool === '_relay_result') return options.receipt ? options.receipt(call) : acknowledgement(call);
    if (options.call) return options.call(call);
    return { status: 200, body: { results: [{ ok: true, summary: 'Status.' }] } };
  };
  const sandbox = {
    __dirname: home,
    require: name =>
      name === 'child_process'
        ? {
            spawnSync: (...args) => {
              sends.push(args);
              return options.send ? options.send(...args) : { status: 0, stdout: 'synthetic delivery', stderr: '' };
            },
          }
        : name === './session-identity.cjs' && options.session
          ? { ...require(path.join(home, name)), identity: () => ({ ...options.session }) }
          : name === './handoff.cjs' && options.session
            ? { fromHome: args => require(path.join(home, name)).fromHome({ ...args, request: transport }) }
            : name === 'fs' && options.fs
              ? options.fs
              : require(name.startsWith('./') ? path.join(home, name) : name),
    process: { env: {}, platform: 'linux', pid: process.pid, argv: [] },
    Buffer,
    URL,
    setInterval: () => ({ unref() {} }),
    setTimeout,
    console,
    transport,
  };
  const source = options.source || fs.readFileSync(process.env.LH_RELAY_MCP || SOURCE, 'utf8');
  const end = source.indexOf("if (process.argv[2] === 'call')");
  if (end < 0) throw new Error('MCP entry point changed; review the adapter boundary');
  vm.createContext(sandbox);
  vm.runInContext(
    source.slice(0, end) +
      (options.network ? '' : '\nrequest = transport;') +
      '\nglobalThis.adapter = { relay, drain, call, reconcile: ' +
      '(typeof reconcileRelay === "function" ? reconcileRelay : undefined) };',
    sandbox,
  );
  return { ...sandbox.adapter, sends, requests };
}

function journal(home) {
  const file = path.join(home, 'relay-results.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
}

function acknowledgement(call) {
  return {
    status: 200,
    body: {
      results: [
        {
          ok: true,
          summary: 'Relayed; recorded.',
          relay_receipt: { id: call.id, ticket: call.args.ticket, delivered: call.args.delivered },
        },
      ],
    },
  };
}

module.exports = { SOURCE, adapter, fixture, journal, ticket, accepted, acknowledgement };
