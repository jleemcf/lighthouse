'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const makeRequests = require('../toolcalls-request');

test('an accepted legacy receipt gains a matching acknowledgement without reapplying delivery', async () => {
  const id = 'relay-result-existing-ticket';
  const store = {
    boards: { test: {} },
    calls: { ['test|operator|' + id]: { tool: '_relay_result', ok: true, summary: 'Recorded.' } },
    tickets: {
      'existing-ticket': { id: 'existing-ticket', board: 'test', by: 'operator', used: true, delivered: true },
    },
  };
  const requests = makeRequests({
    ctx: { store: () => store, roleOn: () => 2 },
    cfg: {},
    receipt: () => 'Receipt.',
  });
  const invoke = args =>
    requests.handleCalls(
      'test',
      { name: 'operator' },
      {
        calls: [{ id, tool: '_relay_result', args }],
      },
    );
  const result = await invoke({ ticket: 'existing-ticket', delivered: true });
  assert.equal(result.body.results[0].duplicate, true);
  assert.deepEqual(result.body.results[0].relay_receipt, { id, ticket: 'existing-ticket', delivered: true });
  const mismatch = await invoke({ ticket: 'existing-ticket', delivered: false });
  assert.equal(mismatch.body.results[0].relay_receipt, undefined);
  const other = await invoke({ ticket: 'another-ticket', delivered: true });
  assert.equal(other.body.results[0].relay_receipt, undefined);
});
