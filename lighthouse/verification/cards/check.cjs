'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const server = path.resolve(__dirname, '../../server');
const env = { ...process.env };
delete env.TYPESAFE_API_KEY;
function run(args) {
  return spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 60000 });
}
const passed = run([
  '--test',
  path.join(server, 'tests/card-lifecycle.test.js'),
  path.join(server, 'tests/known-cards.test.js'),
  path.join(server, 'tests/card-completion.test.js'),
  path.join(server, 'tests/crm-delivery.test.js'),
  path.join(server, 'tests/after-done.test.js'),
  path.join(server, 'tests/prompt-lifecycle.test.js'),
  path.join(server, 'tests/prompt-transitions.test.js'),
  path.join(server, 'tests/prompt-compatibility.test.js'),
  path.join(__dirname, 'sequences.test.cjs'),
]);
process.stdout.write(passed.stdout || '');
process.stderr.write(passed.stderr || '');
assert.equal(passed.status, 0, 'card verification must pass before the mutation exercise');

if (process.argv.includes('--mutate')) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'card-guard-mutation-'));
  try {
    const copy = path.join(scratch, 'server');
    fs.cpSync(server, copy, { recursive: true });
    fs.cpSync(path.join(server, '../tests'), path.join(scratch, 'tests'), { recursive: true });
    const modulePath = path.join(copy, 'card-transitions.js');
    const original = fs.readFileSync(modulePath, 'utf8');
    const guard = "if (card.status === 'done' && (openAsks(card).length || card.needsAction))";
    assert.equal(original.split(guard).length, 2, 'review the mutation when the guard changes');
    fs.writeFileSync(modulePath, original.replace(guard, guard.replace('if (', 'if (false && ')));
    const broken = run([
      '--test',
      '--test-reporter=tap',
      '--test-name-pattern=authorized legacy PATCH',
      path.join(copy, 'tests/card-lifecycle.test.js'),
    ]);
    assert.equal(broken.status, 1, 'removing the unresolved-ask guard must fail the real route replay');
    assert.match(broken.stdout, /actual: 200/);
    assert.match(broken.stdout, /expected: 409/);
    console.log('Mutation caught: authorized legacy PATCH accepted a closed card with an unresolved ask.');
    fs.writeFileSync(modulePath, original);
    const deliveryGuard = "  if (card.status === 'done' && crmCloseReason(card)) return crmCloseReason(card);";
    assert.equal(original.split(deliveryGuard).length, 2, 'review the CRM guard mutation');
    fs.writeFileSync(modulePath, original.replace(deliveryGuard, ''));
    const undelivered = run([
      '--test',
      '--test-reporter=tap',
      '--test-name-pattern=CRM t:',
      path.join(copy, 'tests/crm-delivery.test.js'),
    ]);
    assert.equal(undelivered.status, 1, 'a manual close cannot bypass CRM acceptance');
    assert.match(undelivered.stdout, /manual close cannot bypass delivery/);
    console.log('Mutation caught: a card closed before its staff answer reached the CRM.');
    fs.writeFileSync(modulePath, original);
    const eventsPath = path.join(copy, 'events.js');
    const events = fs.readFileSync(eventsPath, 'utf8');
    const promptClose = 'const closed = prompts.close(store, card, t);';
    assert.equal(events.split(promptClose).length, 2, 'review the explicit prompt close mutation');
    fs.writeFileSync(eventsPath, events.replace(promptClose, 'const closed = lifecycle.close(card, t);'));
    const stalePrompt = run([
      '--test',
      '--test-reporter=tap',
      '--test-name-pattern=line explicit finish',
      path.join(copy, 'tests/prompt-lifecycle.test.js'),
    ]);
    assert.equal(stalePrompt.status, 1, 'explicit line close must supersede undelivered approval');
    assert.match(stalePrompt.stdout, /actual: 'approved'/);
    assert.match(stalePrompt.stdout, /expected: 'superseded'/);
    console.log('Mutation caught: explicit line close left its prompt awaiting delivery.');
    fs.writeFileSync(eventsPath, events);
    const promptsPath = path.join(copy, 'prompt-transitions.js');
    const promptOwner = fs.readFileSync(promptsPath, 'utf8');
    const sourceMatch = ": candidates.find(entry => source?.kind === 'prompt-send' && source.promptOf === entry.id);";
    assert.equal(promptOwner.split(sourceMatch).length, 2, 'review the line source mutation');
    fs.writeFileSync(
      promptsPath,
      promptOwner.replace(sourceMatch, ": candidates.filter(entry => stateOf(entry.prompt) === 'approved').pop();"),
    );
    const wrongReceipt = run([
      '--test',
      '--test-reporter=tap',
      '--test-name-pattern=ordinary line receipt credits',
      path.join(copy, 'tests/prompt-compatibility.test.js'),
    ]);
    assert.equal(wrongReceipt.status, 1, 'ordinary delivery cannot credit an unrelated approved prompt');
    assert.match(wrongReceipt.stdout, /an unrelated approval stays untouched/);
    console.log('Mutation caught: a separate captain instruction credited an unrelated approved prompt.');
    fs.writeFileSync(promptsPath, promptOwner);
    const conductPath = path.join(copy, 'conduct.js');
    const conduct = fs.readFileSync(conductPath, 'utf8');
    const explicit = "const afterDone = asksAfter(entry => entry.event === 'task_finished');";
    assert.equal(conduct.split(explicit).length, 2, 'review the mutation when completion detection changes');
    const heuristic =
      'const afterDone = asksAfter(' +
      'entry => WORK_KINDS.has(entry.kind) && LEGACY_FINISHED.test(String(entry.text || "")));';
    fs.writeFileSync(conductPath, conduct.replace(explicit, heuristic));
    const ambiguous = run([
      '--test',
      '--test-reporter=tap',
      '--test-name-pattern=OnlyTaskCompletionTriggersAfterDone',
      path.join(copy, 'tests/known-cards.test.js'),
    ]);
    assert.equal(ambiguous.status, 1, 'guessing completion from prose must fail the real route replay');
    assert.match(ambiguous.stdout, /actual: 1/);
    assert.match(ambiguous.stdout, /expected: 0/);
    console.log('Mutation caught: completed preflight raised an authoritative afterDone alarm.');
    const anchored = /const LEGACY_FINISHED = new RegExp\([\s\S]*?\);/;
    assert.ok(anchored.test(conduct), 'review the mutation when the legacy phrase matcher changes');
    const unanchored = 'const LEGACY_FINISHED = /\\b(finished|done|delivered|closed[- ]out|completed?)\\b/i;';
    fs.writeFileSync(conductPath, conduct.replace(anchored, unanchored));
    const relayPhrase = run([
      '--test',
      '--test-reporter=tap',
      '--test-name-pattern=relaying merge instructions',
      path.join(copy, 'tests/after-done.test.js'),
    ]);
    assert.equal(relayPhrase.status, 1, 'the retained relay-phrase regression must reject an unanchored hint');
    assert.match(relayPhrase.stdout, /actual: 1/);
    assert.match(relayPhrase.stdout, /expected: 0/);
    console.log('Mutation caught: a relay verb became an uncertain task-finished hint.');
  } finally {
    assert.equal(path.dirname(path.resolve(scratch)), path.resolve(os.tmpdir()));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
