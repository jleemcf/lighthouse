'use strict';
const assert = require('node:assert');
const { req, wait } = require('../helpers');

// The board end to end, second part: a PROMPT, Owner's Send, Send with edit and No; how asks pile up and settle; a
// prompt in answer to General; unsupported prompt destinations.
module.exports = async function prompts(ctx) {
  const { port } = ctx;
  let r;
  // PROMPT: a suggested prompt lands in the conversation with the prompt itself and waits on Owner
  {
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      {
        rows: [
          { label: 'TASK_CREATED', task: 'p1', title: 'Prompt_task', text: 'A task with a prompt.' },
          {
            label: 'PROMPT',
            task: 'p1',
            to: 'firstmate',
            text: 'Suggested prompt for firstmate, to land the branch.',
            body: '> Please land branch x now.\n> Then report.',
          },
        ],
      },
      'OPS',
    );
    assert.ok(r.body.results[0].ok && r.body.results[1].ok, JSON.stringify(r.body));
    r = await req(port, 'GET', '/api/comments?cardId=t-p1', null, 'OWNER');
    const pc = r.body.comments.find(c => c.prompt);
    assert.ok(pc, 'the prompt is a message in the card conversation');
    assert.equal(pc.prompt.to, 'firstmate');
    assert.equal(pc.prompt.text, 'Please land branch x now.\nThen report.', 'the prompt is the body, unquoted');
    assert.equal(pc.prompt.decision, null);
    r = await req(port, 'GET', '/api/state', null, 'OWNER');
    assert.equal(r.body.cards['t-p1'].status, 'waiting');
    assert.equal(
      r.body.cards['t-p1'].decisions.filter(d => !d.resolvedAt && d.kind === 'prompt').length,
      1,
      'a prompt opens a decision',
    );
    r = await req(port, 'POST', '/api/comments/' + pc.id + '/decide', { choice: 'send' }, 'OPS');
    assert.equal(r.status, 403, 'an api identity cannot decide');
    r = await req(port, 'POST', '/api/comments/' + pc.id + '/decide', { choice: 'send' }, 'OWNER');
    assert.equal(r.status, 200, r.raw);
    assert.equal(r.body.comment.prompt.decision, 'send');
    assert.ok(
      r.body.sent && r.body.sent.by === 'owner' && r.body.sent.handled === false && r.body.sent.kind === 'prompt-send',
    );
    assert.equal(
      r.body.sent.text,
      'Send this to the firstmate on my behalf, verbatim:\n\nPlease land branch x now.\nThen report.',
    );
    r = await req(port, 'GET', '/api/state', null, 'OWNER');
    assert.equal(r.body.cards['t-p1'].decisions.filter(d => !d.resolvedAt).length, 0, 'Send resolves the decision');
    r = await req(port, 'GET', '/api/comments?board=t&handled=false', null, 'OPS');
    assert.ok(
      r.body.comments.some(c => c.kind === 'prompt-send'),
      'the operator sees the instruction as an unanswered message',
    );
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'ACTION', task: 'p1', text: 'Decide the branch policy.' }] },
      'OPS',
    );
    assert.ok(r.body.results[0].ok);
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'RELAYED', task: 'p1', text: 'Sent to firstmate, verbatim.' }] },
      'OPS',
    );
    assert.ok(r.body.results[0].ok);
    r = await req(port, 'GET', '/api/state', null, 'OWNER');
    assert.equal(
      r.body.cards['t-p1'].decisions.filter(d => !d.resolvedAt).length,
      0,
      "RELAYED settles the card's open asks",
    );
    // two asks piled up: a REPLY to something else leaves them open; once Owner has answered, one REPLY settles both
    await wait(1100); // times are whole seconds: the Send above must be an earlier second than the asks below
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      {
        rows: [
          { label: 'ACTION', task: 'p1', text: 'First ask.' },
          { label: 'ACTION', task: 'p1', text: 'Second ask.' },
        ],
      },
      'OPS',
    );
    assert.ok(r.body.results[0].ok && r.body.results[1].ok);
    r = await req(port, 'GET', '/api/state', null, 'OWNER');
    assert.equal(r.body.cards['t-p1'].decisions.filter(d => !d.resolvedAt).length, 2);
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'REPLY', task: 'p1', text: 'Here is what is going on.' }] },
      'OPS',
    );
    assert.ok(r.body.results[0].ok);
    r = await req(port, 'GET', '/api/state', null, 'OWNER');
    assert.equal(
      r.body.cards['t-p1'].decisions.filter(d => !d.resolvedAt).length,
      2,
      'a REPLY Owner has not answered leaves his decisions open',
    );
    r = await req(port, 'POST', '/api/comments', { cardId: 't-p1', text: 'Fine, both.' }, 'OWNER');
    assert.equal(r.status, 201);
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'REPLY', task: 'p1', text: 'Both settled.' }] },
      'OPS',
    );
    assert.ok(r.body.results[0].ok);
    r = await req(port, 'GET', '/api/state', null, 'OWNER');
    assert.equal(
      r.body.cards['t-p1'].decisions.filter(d => !d.resolvedAt).length,
      0,
      'once he has answered, a REPLY settles every open ask',
    );
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'ACTION', task: 'p1', text: 'Third ask.' }] },
      'OPS',
    );
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'REPLY', task: 'p1', text: 'Withdrawn, not needed after all.' }] },
      'OPS',
    );
    r = await req(port, 'GET', '/api/state', null, 'OWNER');
    assert.equal(
      r.body.cards['t-p1'].decisions.filter(d => !d.resolvedAt).length,
      0,
      'a REPLY that withdraws settles without him',
    );
    // Owner acts off the board (a sign-in, a Send elsewhere): the REPLY that says so, or that nothing is needed,
    // settles the ask
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'ACTION', task: 'p1', text: 'Sign in to the pi once.' }] },
      'OPS',
    );
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'STATUS', task: 'p1', text: 'The new sign-in works; nothing more is needed from you.' }] },
      'OPS',
    );
    r = await req(port, 'GET', '/api/state', null, 'OWNER');
    assert.equal(r.body.cards['t-p1'].decisions.filter(d => !d.resolvedAt).length, 1, 'a STATUS closes nothing');
    r = await req(port, 'GET', '/api/boards/t/notes', null, 'OWNER');
    assert.equal(r.body.notes[r.body.notes.length - 1].rule, 'stale-ask', 'and the operator is told the words that do');
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'REPLY', task: 'p1', text: 'The new sign-in works; nothing more is needed from you.' }] },
      'OPS',
    );
    r = await req(port, 'GET', '/api/state', null, 'OWNER');
    assert.equal(
      r.body.cards['t-p1'].decisions.filter(d => !d.resolvedAt).length,
      0,
      'the REPLY that says nothing is needed settles it',
    );
    // an older ask and a prompt: Owner's Send settles both
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      {
        rows: [
          { label: 'ACTION', task: 'p1', text: 'Choose the policy.' },
          { label: 'PROMPT', task: 'p1', to: 'firstmate', text: 'Tell firstmate the policy.', body: '> Policy A.' },
        ],
      },
      'OPS',
    );
    r = await req(port, 'GET', '/api/comments?cardId=t-p1', null, 'OWNER');
    {
      const lp = r.body.comments.filter(c => c.prompt && !c.prompt.decision).pop();
      r = await req(port, 'POST', '/api/comments/' + lp.id + '/decide', { choice: 'send' }, 'OWNER');
      assert.equal(r.status, 200, r.raw);
    }
    r = await req(port, 'GET', '/api/state', null, 'OWNER');
    assert.equal(r.body.cards['t-p1'].decisions.filter(d => !d.resolvedAt).length, 0, 'Send settled the older ask too');
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'RELAYED', task: 'p1', text: 'Sent.' }] },
      'OPS',
    );
    // a PROMPT line written in answer to a general message: the prompt lives on the card, General gets a pointer, not
    // a second set of choices
    r = await req(port, 'POST', '/api/comments', { board: 't', text: 'anything I should send?' }, 'OWNER');
    const gq = r.body.id;
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      {
        rows: [
          {
            label: 'PROMPT',
            task: 'p1',
            to: 'firstmate',
            text: 'A prompt for firstmate.',
            body: '> Pause the pings.',
            re: ['general'],
          },
        ],
      },
      'OPS',
    );
    assert.ok(r.body.results[0].ok, JSON.stringify(r.body));
    r = await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER');
    const ptr = r.body.comments.find(c => c.replyTo === gq);
    assert.ok(
      ptr && !ptr.prompt && ptr.text.startsWith('Suggested a prompt for the firstmate, on task p1'),
      'General holds a pointer: ' + JSON.stringify(ptr),
    );
    r = await req(port, 'GET', '/api/comments?cardId=t-p1', null, 'OWNER');
    assert.equal(
      r.body.comments.filter(c => c.prompt && !c.prompt.decision).length,
      1,
      'the card holds the one live prompt',
    );
    r = await req(port, 'GET', '/api/comments?board=t&handled=false', null, 'OPS');
    assert.ok(!r.body.comments.some(c => c.kind === 'prompt-send'), 'the RELAYED line answers the instruction');
    r = await req(port, 'POST', '/api/comments/' + pc.id + '/decide', { choice: 'other' }, 'OWNER');
    assert.equal(r.status, 409, 'decided once');
    // a general prompt, declined
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'PROMPT', task: 'general', to: 'firstmate', text: 'Ask firstmate to pause.' }] },
      'OPS',
    );
    assert.ok(r.body.results[0].ok);
    r = await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER');
    const gp = r.body.comments.find(c => c.prompt);
    assert.ok(gp);
    assert.equal(gp.prompt.text, 'Ask firstmate to pause.', 'no body: the line text is the prompt');
    // Unknown destinations remain manual prompts, never another relay route.
    r = await req(
      port,
      'POST',
      '/api/boards/r/events',
      {
        rows: [
          { label: 'TASK_CREATED', task: 'rp', title: 'Retired', text: 'x' },
          { label: 'PROMPT', task: 'rp', to: 'unsupported', text: 'For another agent.', body: '> Land it.' },
        ],
      },
      'OPS',
    );
    {
      const rp = (await req(port, 'GET', '/api/comments?cardId=r-rp', null, 'OWNER')).body.comments.find(c => c.prompt);
      assert.ok(rp && rp.prompt.to === null, 'unsupported destinations cannot receive relays');
      const rn = (await req(port, 'GET', '/api/boards/r/notes', null, 'OWNER')).body.notes;
      assert.ok(
        rn.some(x => x.rule === 'prompt-destination'),
        'the operator is told only firstmate accepts relays',
      );
    }
    // framing prose around the quote block never travels: the quote is the prompt
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      {
        rows: [
          {
            label: 'PROMPT',
            task: 'general',
            to: 'firstmate',
            text: 'For your approval.',
            body:
              'You were right about the label.\n\n> Open a new task.\n> Tell me its id.\n\n' +
              'Say the word and it goes.',
          },
        ],
      },
      'OPS',
    );
    assert.ok(r.body.results[0].ok);
    r = await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER');
    {
      const fp = r.body.comments.filter(c => c.prompt).pop();
      assert.equal(fp.prompt.text, 'Open a new task.\nTell me its id.', 'only the quoted lines are the prompt');
    }
    const n0 = (await req(port, 'GET', '/api/comments?board=t&handled=false', null, 'OPS')).body.comments.length;
    r = await req(port, 'POST', '/api/comments/' + gp.id + '/decide', { choice: 'other' }, 'OWNER');
    assert.equal(r.body.comment.prompt.decision, 'other');
    assert.equal(r.body.sent, null);
    assert.equal(
      (await req(port, 'GET', '/api/comments?board=t&handled=false', null, 'OPS')).body.comments.length,
      n0,
      'No, something else sends nothing',
    );
    // Send with edit: the same instruction carrying Owner's version of the prompt
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      {
        rows: [
          {
            label: 'PROMPT',
            task: 'general',
            to: 'firstmate',
            text: 'Ask firstmate to land it.',
            body: '> Land branch y.',
          },
        ],
      },
      'OPS',
    );
    assert.ok(r.body.results[0].ok);
    r = await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER');
    const ep = r.body.comments.filter(c => c.prompt && !c.prompt.decision).pop();
    assert.ok(ep);
    r = await req(
      port,
      'POST',
      '/api/comments/' + ep.id + '/decide',
      { choice: 'send', text: 'Land branch y, then run the tests.' },
      'OWNER',
    );
    assert.equal(r.status, 200, r.raw);
    assert.equal(r.body.comment.prompt.decision, 'send');
    assert.equal(r.body.comment.prompt.edited, true);
    assert.equal(r.body.comment.prompt.text, 'Land branch y.', "the operator's prompt is kept");
    assert.equal(r.body.comment.prompt.sentText, 'Land branch y, then run the tests.');
    assert.equal(
      r.body.sent.text,
      'Send this to the firstmate on my behalf, verbatim:\n\nLand branch y, then run the tests.',
    );
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'RELAYED', task: 'general', text: 'Sent to firstmate, verbatim.' }] },
      'OPS',
    );
    assert.ok(r.body.results[0].ok);
  }
};
