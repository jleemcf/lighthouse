'use strict';
require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adapter, fixture, journal, ticket } = require('../../verification/relay/adapter.cjs');

test('relay: SuccessRequiresBoardReceipt [scout flow: relay]', async context => {
  const client = adapter(fixture(context), {
    receipt: async () => ({ status: 401, body: { error: 'sample receipt refused' } }),
  });
  const result = await client.relay({ source: 'sample-message' });
  assert.equal(client.sends.length, 1, 'only the synthetic external delivery ran');
  assert.equal(client.requests.length, 2, 'the board refused the receipt after issuing the ticket');
  const qualified = JSON.stringify(result).includes('board did not hear');
  assert.ok(result.isError || qualified, 'a refused receipt must not report unqualified success');
});

test('relay: DeliveredResultNotSilentlyLost [scout flow: relay]', async context => {
  const home = fixture(context);
  const item = { id: 'sample-receipt', args: { ticket: ticket.id, delivered: true } };
  fs.writeFileSync(path.join(home, 'relay-results.jsonl'), JSON.stringify(item) + '\n');
  const client = adapter(home, {
    receipt: async () => ({ status: 401, body: { error: 'sample receipt refused' } }),
  });
  await client.drain();
  assert.equal(client.requests.length, 1);
  assert.ok(
    journal(home).some(receipt => receipt.id === item.id && receipt.args.delivered),
    'a refused retry must retain the reconciliation obligation',
  );
});
