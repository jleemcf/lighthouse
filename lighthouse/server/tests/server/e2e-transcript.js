'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { req } = require('../helpers');

// The board end to end, third part: the transcript and direct messages; claim codes that hand an operator its token.
module.exports = async function transcript(ctx) {
  const { port, dir } = ctx;
  let r;
  // the transcript: the operator's own words and Owner's, by every route, readable naked; a direct message reaches
  // the operator and lives nowhere else
  {
    r = await req(
      port,
      'POST',
      '/api/boards/t/transcript',
      {
        rows: [
          { role: 'operator', t: '2026-09-16T15:00:00.000Z', text: 'I am reading the clock.' },
          { role: 'owner', t: '2026-09-16T15:00:05.000Z', text: 'start shift' },
          { role: 'operator', text: '' },
        ],
      },
      'OPS',
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.added, 2, 'empty rows are dropped');
    r = await req(
      port,
      'POST',
      '/api/boards/t/transcript',
      {
        rows: [
          { role: 'owner', text: '[Request interrupted by user]' },
          { role: 'owner', text: '(Re-invocation of /reorient — the skill instructions were previously loaded.)' },
          { role: 'operator', text: '[Request interrupted by user] was my mistake' },
        ],
      },
      'OPS',
    );
    assert.equal(
      r.body.added,
      1,
      "Claude Code's own marks never reach his transcript as his words, from an older collector too",
    );
    r = await req(port, 'POST', '/api/boards/t/transcript', { rows: [{ role: 'operator', text: 'x' }] }, 'VIEW');
    assert.equal(r.status, 403, 'a viewer cannot feed the transcript');
    r = await req(port, 'POST', '/api/comments', { board: 't', text: 'just between us', kind: 'direct' }, 'OWNER');
    assert.equal(r.status, 201);
    assert.equal(r.body.kind, 'direct');
    assert.equal(r.body.handled, false);
    r = await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER');
    assert.ok(!r.body.comments.some(c => c.kind === 'direct'), 'a direct message is not in General');
    r = await req(port, 'GET', '/api/comments?board=t&handled=false', null, 'OPS');
    assert.ok(
      r.body.comments.some(c => c.kind === 'direct'),
      'but the operator gets it',
    );
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'FYI', task: 'general', text: 'Understood, just between us.' }] },
      'OPS',
    );
    assert.ok(r.body.results[0].ok);
    r = await req(port, 'GET', '/api/comments?board=t&handled=false', null, 'OPS');
    assert.ok(
      !r.body.comments.some(c => c.kind === 'direct'),
      "the operator's next general line answers a direct message",
    );
    r = await req(port, 'GET', '/api/boards/t/transcript', null, 'VIEW');
    const tx = r.body.entries;
    assert.ok(tx.some(e => e.role === 'operator' && e.text === 'I am reading the clock.'));
    assert.ok(tx.some(e => e.role === 'owner' && e.text === 'start shift' && e.via === 'chat'));
    assert.ok(
      tx.some(e => e.role === 'owner' && e.text === 'just between us' && e.via === 'direct'),
      'a direct message is in the transcript',
    );
    assert.ok(
      tx.some(e => e.role === 'owner' && e.text === 'Merge it.' && e.via === 'card task1'),
      'a card message Owner wrote earlier is in the transcript too',
    );
    assert.ok(
      tx.some(e => e.role === 'owner' && e.text.startsWith('Send this to the firstmate on my behalf')),
      'and the prompt he sent',
    );
    r = await req(port, 'GET', '/api/state', null, 'OWNER');
    assert.equal(r.body.boards.t.transcript, undefined, 'the state carries no transcript');
    assert.ok(r.body.boards.t.transcriptCount >= 4);
    assert.ok(r.body.boards.t.transcriptLast);
  }

  // a claim code: one-time, fifteen minutes, hands an operator its token
  {
    const claims = path.join(dir, 'claims');
    fs.mkdirSync(claims, { recursive: true });
    fs.writeFileSync(path.join(claims, 'ABCD2345.json'), JSON.stringify({ name: 'op-test', exp: Date.now() + 60000 }));
    fs.writeFileSync(path.join(claims, 'OLDCODE1.json'), JSON.stringify({ name: 'op-test', exp: Date.now() - 1 }));
    fs.writeFileSync(path.join(claims, 'NOBODY22.json'), JSON.stringify({ name: 'nobody', exp: Date.now() + 60000 }));
    r = await req(port, 'POST', '/api/claim', { code: 'abcd2345' });
    assert.equal(r.status, 200, r.raw);
    assert.equal(r.body.name, 'op-test');
    assert.equal(r.body.token, 'OPS', 'the code hands over the operator token, no identity needed');
    r = await req(port, 'POST', '/api/claim', { code: 'ABCD2345' });
    assert.equal(r.status, 404, 'a code is spent on first use');
    fs.writeFileSync(
      path.join(claims, 'STEW2345.json'),
      JSON.stringify({ name: 'op-test', kind: 'steward', exp: Date.now() + 60000 }),
    );
    r = await req(port, 'POST', '/api/claim', { code: 'STEW2345' });
    assert.equal(r.status, 404, "a steward claim hands over only a steward token, never the operator's");
    assert.match(r.body.error, /no steward token/);
    r = await req(port, 'POST', '/api/claim', { code: 'OLDCODE1' });
    assert.equal(r.status, 404, 'an expired code is refused');
    assert.ok(!fs.existsSync(path.join(claims, 'OLDCODE1.json')), 'and removed');
    r = await req(port, 'POST', '/api/claim', { code: 'NOBODY22' });
    assert.equal(r.status, 404, 'a code for an identity with no token is refused');
    r = await req(port, 'POST', '/api/claim', { code: 'x' });
    assert.equal(r.status, 400);
  }
};
