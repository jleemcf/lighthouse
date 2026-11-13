// A stand-in for `codex exec` in stwake_test.cjs: it reads the job the way the steward would, answers in the output
// schema's shape, and records how it was called (in its CODEX_HOME), so the test can check sandbox, resume, the folder
// it ran in, its environment and that no token reached it. A resume of the session "dead" fails, as a pruned one would.
'use strict';
const fs = require('fs'),
  path = require('path');
const args = process.argv.slice(2);
if (
  args.includes('--help') &&
  process.env.CODEX_HOME &&
  fs.existsSync(path.join(process.env.CODEX_HOME, 'help-broken'))
) {
  process.stderr.write('help unavailable');
  process.exit(1);
} // a test of a Codex that cannot say what it supports
if (args.includes('--help')) {
  console.log(
    'Usage: codex exec [OPTIONS] [PROMPT]\n  -s, --sandbox <MODE>\n  --output-schema <FILE>\n' +
      '  --output-last-message <FILE>\n  --ignore-user-config\n  --ephemeral\n  --json',
  );
  process.exit(0);
}
let prompt = '';
process.stdin.on('data', d => (prompt += d));
process.stdin.on('end', () => {
  const home = process.env.CODEX_HOME || process.cwd();
  fs.mkdirSync(home, { recursive: true });
  const id = (/request ([a-f0-9]{16})/.exec(prompt) || [])[1];
  // what the review folder held while it ran (the script removes it after the job)
  const rdir = path.join(process.cwd(), 'review'),
    review = fs.existsSync(rdir)
      ? Object.fromEntries(fs.readdirSync(rdir).map(f => [f, fs.readFileSync(path.join(rdir, f), 'utf8')]))
      : null;
  const packDir = path.join(process.cwd(), 'pack'),
    pack = fs.existsSync(packDir)
      ? Object.fromEntries(fs.readdirSync(packDir).map(f => [f, fs.readFileSync(path.join(packDir, f), 'utf8')]))
      : null;
  fs.appendFileSync(
    path.join(home, 'calls.jsonl'),
    JSON.stringify({ args, cwd: process.cwd(), env: Object.keys(process.env), prompt, review, pack }) + '\n',
  );
  if (args[1] === 'resume' && args[2] === 'dead') {
    process.stderr.write('error: no session dead');
    process.exit(1);
  }
  const cut = prompt.indexOf('----- the job sheet -----'),
    job = cut >= 0 ? prompt.slice(cut) : ''; // the sheet comes whole in the prompt
  const kind = (/\] ([a-z-]+) · request/.exec(job) || [])[1];
  if (/MAKE-ME-FAIL/.test(job)) {
    console.log(JSON.stringify({ type: 'error', message: 'unexpected status 401 Unauthorized' }));
    console.log(JSON.stringify({ type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized' } }));
    process.exit(1);
  } // as the real Codex: the reason is an event on stdout, stderr empty
  const a = {
    request: id,
    silent: false,
    oneLine: '',
    text: '',
    choice: '',
    irreversible: false,
    category: 'none',
    cites: [],
    claims: [],
    svg: '',
    missing: ['ghp_' + 'x'.repeat(36)],
  }; // a model trying to sneak text through "missing"
  if (kind === 'ask-check') a.silent = true;
  else if (kind === 'second-opinion')
    Object.assign(a, {
      choice: 'A',
      oneLine: 'Go with A: it can be undone.',
      text: 'Because.',
      cites: [54],
      claims: [{ text: 'the card is open', record: (/card:([^\s,]+)/.exec(job) || [])[0] || '' }],
    });
  else if (kind === 'explain')
    Object.assign(a, {
      oneLine: 'It moves leads. It retries. Nothing is lost.',
      text: 'Plainly.',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
    });
  // the drawing comes back in the answer: the steward writes no file
  else if (kind === 'review')
    Object.assign(a, { category: 'duplicate', oneLine: 'a.md repeats what b.md already says.' });
  else if (kind === 'state')
    Object.assign(a, {
      oneLine: 'One task open, and it waits on you.',
      overview: {
        stands: 'The importer waits on your choice.',
        struggles: [{ text: 'Stuck on its test.', card: (/^-- ([^\s]+) \[/m.exec(job) || [])[1] || '' }],
        advice: [{ text: 'Choose today.', card: '' }],
        since: 'The shift began.',
      },
    });
  // the overview in its parts
  else Object.assign(a, { oneLine: 'Answered.', text: 'x' });
  if (args.includes('danger-full-access'))
    console.log(
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_1', type: 'command_execution', command: 'Get-Content pack/arch.md', exit_code: 0 },
      }),
    ); // a look, with full access
  console.log(
    JSON.stringify({
      type: 'thread.started',
      thread_id: 'fake-thread-' + (args[1] === 'resume' ? args[2] : Date.now()),
    }),
  );
  const out = args.indexOf('--output-last-message');
  if (out >= 0) fs.writeFileSync(args[out + 1], JSON.stringify(a));
  else
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(a) } }));
});
