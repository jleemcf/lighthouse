'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const {
  SOURCE,
  adapter,
  fixture,
  journal,
  ticket,
  accepted,
  acknowledgement,
} = require('../../verification/relay/adapter.cjs');

test('DeliveredResultNotSilentlyLost: refused immediate receipt remains in the journal', async context => {
  const home = fixture(context);
  const client = adapter(home, { receipt: async () => ({ status: 401 }) });
  await client.relay({ source: 'm1' });
  assert.equal(client.sends.length, 1);
  assert.equal(journal(home).length, 1);
  assert.equal(journal(home)[0].args.delivered, true);
});

test('SuccessRequiresBoardReceipt: a refused receipt is not unqualified success', async context => {
  const client = adapter(fixture(context), { receipt: async () => ({ status: 401 }) });
  const result = await client.relay({ source: 'm1' });
  assert.equal(result.isError, true);
  assert.match(result.text, /Do not relay.*again/i);
});

test('DeliveredResultNotSilentlyLost: retry 401 retains the legacy receipt id', async context => {
  const home = fixture(context);
  const item = { id: 'relay-result-' + ticket.id, args: { ticket: ticket.id, delivered: true } };
  fs.writeFileSync(path.join(home, 'relay-results.jsonl'), JSON.stringify(item) + '\n');
  const client = adapter(home, { receipt: async () => ({ status: 401 }) });
  await client.drain();
  assert.equal(journal(home).length, 1);
  assert.equal(journal(home)[0].id, item.id);
  assert.equal(client.sends.length, 0);
});

for (const [name, response] of [
  ['401', { status: 401 }],
  ['403', { status: 403 }],
  ['200 with refusal', { status: 200, body: { results: [{ ok: false, reason: 'refused' }] } }],
  ['200 without acknowledgement', accepted],
  ['5xx', { status: 503 }],
  ['receipt timeout', { status: 0, error: 'timeout' }],
  ['lost response', { status: 0, error: 'socket hang up' }],
]) {
  test('receipt ' + name + ': restart retries only the same receipt, never the command', async context => {
    const home = fixture(context);
    const sends = [];
    const client = adapter(home, { sends, receipt: async () => response });
    const result = await client.relay({ source: 'm1' });
    assert.equal(result.isError, true);
    const before = journal(home)[0];
    assert.equal(before.args.delivered, true);
    assert.notEqual(before.state, 'recorded');
    const restarted = adapter(home, { sends, receipt: async () => response });
    await restarted.drain();
    assert.notEqual(journal(home)[0].state, 'recorded');
    const status = await restarted.call('board_status', {});
    assert.match(status.text, /RELAY RECONCILIATION/);
    assert.match(status.text, /Do not relay it again/);
    const retry = await restarted.relay({ source: 'm1' });
    assert.equal(retry.isError, true);
    assert.equal(sends.length, 1);
    const recovered = adapter(home, { sends });
    await recovered.drain();
    await recovered.drain();
    assert.equal(journal(home)[0].state, name === '200 with refusal' ? 'blocked' : 'recorded');
    if (name === '200 with refusal') assert.equal(recovered.requests.length, 0);
    assert.equal(journal(home)[0].id, before.id);
    assert.equal(sends.length, 1);
    const receipts = [...client.requests, ...restarted.requests, ...recovered.requests].filter(
      call => call.tool === '_relay_result',
    );
    assert.ok(receipts.every(call => call.id === before.id));
    assert.ok(receipts.every(call => call.args.ticket === ticket.id));
  });
}

test('journal has sending intent before the external boundary and retains the recorded audit', async context => {
  const home = fixture(context);
  const client = adapter(home, {
    send: () => {
      const item = journal(home)[0];
      assert.equal(item.state, 'sending');
      assert.equal(item.intent.ticket, ticket.id);
      assert.equal(item.intent.hash, ticket.hash);
      return { status: 0, stdout: 'synthetic delivery' };
    },
  });
  assert.equal((await client.relay({ source: 'm1' })).isError, false);
  assert.equal(journal(home)[0].state, 'recorded');
  assert.equal(journal(home)[0].args.delivered, true);
  assert.equal((await client.relay({ source: 'm1' })).isError, true);
  assert.equal(client.sends.length, 1);
});

test('duplicate accepted receipt after response loss records once and sends once', async context => {
  const home = fixture(context);
  const sends = [];
  const boardIds = new Set();
  let reports = 0;
  let first = true;
  const receipt = async call => {
    if (!boardIds.has(call.id)) {
      boardIds.add(call.id);
      reports++;
    }
    if (first) {
      first = false;
      return { status: 0, error: 'response lost after commit' };
    }
    const response = acknowledgement(call);
    response.body.results[0].duplicate = true;
    return response;
  };
  assert.equal((await adapter(home, { sends, receipt }).relay({ source: 'm1' })).isError, true);
  const restarted = adapter(home, { sends, receipt });
  await restarted.drain();
  await restarted.drain();
  assert.equal(journal(home)[0].state, 'recorded');
  assert.equal(reports, 1);
  assert.equal(sends.length, 1);
});

for (const outcome of [
  { status: null, error: { code: 'ETIMEDOUT' }, stdout: '' },
  { status: 1, stderr: 'route exited after possibly sending' },
  { status: 1, stdout: 'FAILED (exit 1): FAILED (exit 1): uncertain transport result' },
  { status: null, signal: 'SIGTERM', stdout: 'SKIPPED: interrupted' },
  { status: 4, error: { code: 'ETIMEDOUT' }, stdout: 'SKIPPED: timed out' },
]) {
  test('uncertain external send stays outcome-unknown across restarts', async context => {
    const home = fixture(context);
    const sends = [];
    const client = adapter(home, { sends, send: () => outcome });
    const result = await client.relay({ source: 'm1' });
    assert.equal(result.isError, true);
    assert.match(result.text, /outcome unknown/i);
    assert.equal(journal(home)[0].state, 'outcome-unknown');
    assert.equal(client.requests.filter(call => call.tool === '_relay_result').length, 0);
    const restarted = adapter(home, { sends });
    await restarted.drain();
    assert.equal((await restarted.relay({ source: 'm1', again: true })).isError, true);
    assert.equal(sends.length, 1);
  });
}

test('interruption after send keeps a sending marker that restart never replays', async context => {
  const home = fixture(context);
  const sends = [];
  let interrupt = false;
  const guardedFs = Object.create(fs);
  guardedFs.renameSync = (...args) => {
    if (interrupt && args[1].endsWith('relay-results.jsonl')) throw new Error('simulated process interruption');
    return fs.renameSync(...args);
  };
  const client = adapter(home, {
    sends,
    fs: guardedFs,
    send: () => {
      interrupt = true;
      return { status: 0, stdout: 'synthetic delivery' };
    },
  });
  assert.equal((await client.relay({ source: 'm1' })).isError, true);
  assert.equal(journal(home)[0].state, 'sending');
  const restarted = adapter(home, { sends });
  await restarted.drain();
  assert.equal(journal(home)[0].state, 'outcome-unknown');
  assert.equal(restarted.requests.length, 0);
  assert.equal((await restarted.relay({ source: 'm1' })).isError, true);
  assert.equal(sends.length, 1);
});

test('failed intent persistence fails closed before any external send', async context => {
  const home = fixture(context);
  const guardedFs = Object.create(fs);
  guardedFs.fsyncSync = () => {
    throw new Error('simulated disk failure');
  };
  const client = adapter(home, { fs: guardedFs });
  await assert.rejects(client.relay({ source: 'm1' }), /disk failure/);
  assert.equal(client.sends.length, 0);
});

test('corrupt journal fails closed rather than silently discarding delivered evidence', async context => {
  const home = fixture(context);
  fs.writeFileSync(path.join(home, 'relay-results.jsonl'), '{invalid journal\n');
  const client = adapter(home);
  await assert.rejects(client.relay({ source: 'm1' }), /Cannot read relay-results/);
  fs.writeFileSync(
    path.join(home, 'calls-outbox.jsonl'),
    JSON.stringify({ id: 'queued', tool: 'board_status' }) + '\n',
  );
  const status = await client.call('board_status', {});
  assert.equal(status.isError, false);
  assert.match(status.text, /relay journal unreadable; do not relay/i);
  assert.ok(client.requests.some(call => call.id === 'queued'));
  assert.equal(client.sends.length, 0);
});

for (const [status, output] of [
  [3, 'SKIPPED: already relayed; use --again'],
  [4, 'FAILED (exit 4): SKIPPED: composer is not empty; send again at a seam'],
  [5, 'FAILED (exit 5): REFUSED: is firstmate running?'],
]) {
  test('pre-send refusal exit ' + status + ' records non-delivery and permits a new ticket', async context => {
    const home = fixture(context);
    const client = adapter(home, { send: () => ({ status, stdout: output }) });
    const result = await client.relay({ source: 'm1' });
    assert.equal(result.isError, true);
    assert.match(result.text, /SKIPPED|REFUSED/);
    assert.doesNotMatch(result.text, /Do not relay.*again/i);
    assert.equal(journal(home)[0].state, 'recorded');
    assert.equal(journal(home)[0].args.delivered, false);
    const retry = adapter(home, { ticket: { ...ticket, id: 'retry-ticket', again: true } });
    assert.equal((await retry.relay({ source: 'm1', again: true })).isError, false);
    assert.equal(retry.sends.length, 1);
  });
}

test('local captain reconciliation preserves evidence and never sends or posts', async context => {
  const home = fixture(context);
  const client = adapter(home, { send: () => ({ status: null, error: new Error('timeout') }) });
  await client.relay({ source: 'm1' });
  const before = journal(home)[0];
  await assert.rejects(client.reconcile([before.id, '--not-delivered']), /evidence/);
  before.updated_at = new Date(Date.now() - 71000).toISOString();
  fs.writeFileSync(path.join(home, 'relay-results.jsonl'), JSON.stringify(before) + '\n');
  await client.reconcile([before.id, '--not-delivered', '--evidence', 'Captain checked recipient history.']);
  const item = journal(home)[0];
  assert.equal(item.state, 'reconciled');
  assert.equal(item.reconciliation.delivered, false);
  assert.ok(item.reconciliation.evidence);
  assert.ok(item.reconciled_at);
  assert.deepEqual(item.intent, before.intent);
  const requests = client.requests.length;
  await client.drain();
  assert.equal(client.requests.length, requests);
  assert.equal(client.sends.length, 1);
  assert.doesNotMatch((await client.call('board_status', {})).text, /RELAY RECONCILIATION/);
  const retry = adapter(home, { ticket: { ...ticket, id: 'captain-approved-retry', again: true } });
  assert.equal((await retry.relay({ source: 'm1', again: true })).isError, false);
});

test('permanent board refusal can be locally closed without claiming board acceptance', async context => {
  const home = fixture(context);
  const client = adapter(home, {
    receipt: async () => ({ status: 200, body: { results: [{ ok: false, reason: 'expired ticket' }] } }),
  });
  await client.relay({ source: 'm1' });
  const before = journal(home)[0];
  await client.drain();
  assert.equal(client.requests.filter(call => call.tool === '_relay_result').length, 1);
  await client.reconcile([before.id, '--delivered', '--evidence', 'Captain checked delivery; ticket expired.']);
  assert.equal(journal(home)[0].state, 'reconciled');
  assert.equal(journal(home)[0].reconciliation.delivered, true);
  assert.deepEqual(journal(home)[0].args, before.args);
  await client.drain();
  assert.equal(client.requests.filter(call => call.tool === '_relay_result').length, 1);
});

test('local reconciliation rejects active and recorded entries', async context => {
  const home = fixture(context);
  const client = adapter(home);
  for (const state of ['authorized', 'sending', 'recorded', 'reconciled']) {
    const item = { id: 'untouchable', state, intent: { ticket: 'untouchable' } };
    fs.writeFileSync(path.join(home, 'relay-results.jsonl'), JSON.stringify(item) + '\n');
    await assert.rejects(
      client.reconcile([item.id, '--not-delivered', '--evidence', 'Must not close an active send.']),
      /Only an outcome-unknown or blocked/,
    );
    assert.deepEqual(journal(home)[0], item);
  }
  assert.equal(client.sends.length, 0);
  assert.equal(client.requests.length, 0);
});

test('local reconciliation waits past the active send deadline before closing an unknown result', async context => {
  const home = fixture(context);
  const item = { id: 'recent-send', state: 'outcome-unknown', updated_at: new Date().toISOString() };
  fs.writeFileSync(path.join(home, 'relay-results.jsonl'), JSON.stringify(item) + '\n');
  const client = adapter(home);
  await assert.rejects(
    client.reconcile([item.id, '--not-delivered', '--evidence', 'A concurrent drain saw a sending marker.']),
    /send may still be running/,
  );
  assert.deepEqual(journal(home)[0], item);
  assert.equal(client.requests.length, 0);
  assert.equal(client.sends.length, 0);
});

test('pending non-delivery notice identifies the confirmed result', async context => {
  const client = adapter(fixture(context), {
    send: () => ({ status: 4, stdout: 'SKIPPED: composer occupied' }),
    receipt: async () => ({ status: 503 }),
  });
  const result = await client.relay({ source: 'm1' });
  assert.equal(result.isError, true);
  assert.match(result.text, /delivered-awaiting-record \(not delivered\)/);
});

test('relay-reconcile CLI closes a scratch audit and reports invalid input safely', context => {
  const home = fixture(context);
  const script = path.join(home, 'lighthouse-mcp.cjs');
  fs.copyFileSync(SOURCE, script);
  fs.writeFileSync(
    path.join(home, 'relay-results.jsonl'),
    JSON.stringify({
      id: 'scratch-cli',
      state: 'outcome-unknown',
      updated_at: new Date(Date.now() - 71000).toISOString(),
    }) + '\n',
  );
  const environment = { ...process.env };
  delete environment.TYPESAFE_API_KEY;
  delete environment.LH_TOKEN;
  const run = args =>
    spawnSync(process.execPath, [script, 'relay-reconcile', ...args], {
      env: environment,
      encoding: 'utf8',
      timeout: 5000,
    });
  const invalid = run(['scratch-cli', '--delivered']);
  assert.equal(invalid.status, 1, invalid.stderr);
  assert.match(invalid.stderr, /Usage: relay-reconcile/);
  const valid = run(['scratch-cli', '--not-delivered', '--evidence', 'Captain checked; no delivery.']);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /nothing sent or posted/);
  assert.equal(journal(home)[0].state, 'reconciled');
});

test('receipt outage stops the backlog before the next receipt', async context => {
  const home = fixture(context);
  const items = ['first', 'second'].map(id => ({
    id,
    state: 'delivered-awaiting-record',
    args: { ticket: id, delivered: true },
  }));
  fs.writeFileSync(path.join(home, 'relay-results.jsonl'), items.map(JSON.stringify).join('\n') + '\n');
  const client = adapter(home, { receipt: async () => ({ status: 503 }) });
  await client.drain();
  assert.deepEqual(
    client.requests.map(call => call.id),
    ['first'],
  );
});

test('concurrent clients with the same authorized words send only once', async context => {
  const home = fixture(context);
  const sends = [];
  const first = adapter(home, { sends, receipt: async () => ({ status: 401 }) });
  const second = adapter(home, { sends, receipt: async () => ({ status: 403 }) });
  await Promise.all([first.relay({ source: 'm1' }), second.relay({ source: 'm1' })]);
  assert.equal(sends.length, 1);
  assert.equal(journal(home).length, 1);
});

for (const changed of [{ id: 'another-receipt' }, { ticket: 'another-ticket' }, { delivered: false }]) {
  test(
    'acceptance must match the receipt id, ticket and delivered outcome ' + JSON.stringify(changed),
    async context => {
      const home = fixture(context);
      const client = adapter(home, {
        receipt: async call => {
          const response = acknowledgement(call);
          Object.assign(response.body.results[0].relay_receipt, changed);
          return response;
        },
      });
      assert.equal((await client.relay({ source: 'm1' })).isError, true);
      assert.notEqual(journal(home)[0].state, 'recorded');
      await client.drain();
      assert.notEqual(journal(home)[0].state, 'recorded');
    },
  );
}

test('legacy receipts retain their ids and never authorize a new send during migration', async context => {
  const home = fixture(context);
  const item = { id: 'legacy-receipt', args: { ticket: 'legacy-ticket', delivered: true } };
  fs.writeFileSync(path.join(home, 'relay-results.jsonl'), JSON.stringify(item) + '\n');
  const client = adapter(home, { receipt: async () => ({ status: 403 }) });
  await client.drain();
  assert.equal((await client.relay({ source: 'm1' })).isError, true);
  assert.equal(journal(home)[0].id, item.id);
  assert.equal(client.sends.length, 0);
});

test(
  'HTTP response lost mid-body retains receipt and retries its id without a second send',
  { timeout: 5000 },
  async context => {
    const home = fixture(context);
    let interrupted = false;
    const receiptIds = [];
    const server = http.createServer((request, response) => {
      let data = '';
      request.on('data', chunk => {
        data += chunk;
      });
      request.on('end', () => {
        const call = JSON.parse(data).calls[0];
        response.setHeader('Content-Type', 'application/json');
        if (call.tool === 'board_relay') return response.end(JSON.stringify({ results: [{ ok: true }], ticket }));
        receiptIds.push(call.id);
        if (!interrupted) {
          interrupted = true;
          response.writeHead(200);
          response.write('{');
          setImmediate(() => response.destroy());
        } else response.end(JSON.stringify(acknowledgement(call).body));
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    context.after(() => new Promise(resolve => server.close(resolve)));
    const port = server.address().port;
    assert.notEqual(port, 7700);
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ server: 'http://127.0.0.1:' + port }));
    const client = adapter(home, { network: true });
    assert.equal((await client.relay({ source: 'm1' })).isError, true);
    assert.equal(journal(home)[0].state, 'delivered-awaiting-record');
    await client.drain();
    assert.equal(journal(home)[0].state, 'recorded');
    assert.equal(client.sends.length, 1);
    assert.equal(receiptIds.length, 2);
    assert.equal(receiptIds[0], receiptIds[1]);
  },
);
