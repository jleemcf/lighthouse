// The operator's tool server end to end: MCP over stdio to a sandbox board, a relay through a stand-in relay.sh,
// and the outbox while the board is down. Run: node --test lighthouse/operator-kit/tests/mcp_test.cjs
'use strict';
const { testPort, spawnServer } = require('../../tests/sandbox.cjs');
const { childRpc } = require('../../tests/child-rpc.cjs');
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  http = require('node:http');
const ROOT = path.join(__dirname, '..', '..');
const MCP = path.join(ROOT, 'operator-kit', 'scripts', 'lighthouse-mcp.cjs'),
  SPEC = path.join(ROOT, 'operator-kit', 'scripts', 'toolcalls-spec.json');
const wait = ms => new Promise(r => setTimeout(r, ms));
function assertNudgeGuidance(text) {
  assert.match(text, /harness asks for a few words/);
  assert.match(text, /board_post\(kind: "status"\) on the card in hand/);
  assert.match(text, /or nothing if its status already says so/);
  assert.match(text, /type nothing in chat/);
}
function req(port, method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: p,
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          token ? { Authorization: 'Bearer ' + token } : {},
        ),
      },
      res => {
        let d = '';
        res.on('data', c => (d += c));
        res.on('end', () => {
          let j = null;
          try {
            j = JSON.parse(d);
          } catch {}
          resolve({ status: res.statusCode, body: j });
        });
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

test('the MCP tool server: protocol, a relay by ticket, the outbox', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhmcp-'));
  const port = await testPort();
  const cfg = {
    port,
    bind: '127.0.0.1',
    storeFile: 'store.json',
    tokens: {
      OWNER: { name: 'owner', via: 'page' },
      OPS: { name: 'op-test', via: 'api', mode: 'tools' },
      LINES: { name: 'op-test', via: 'api' },
      'shd-7Qx2': { name: 'op-test', via: 'api', mode: 'tools', shadow: true },
    },
    boards: {
      t: { name: 'Test', protocol: 'tools', access: { owner: 'owner', 'op-test': 'operator' } },
      l: { name: 'Lines', access: { owner: 'owner', 'op-test': 'operator' } },
    },
  };
  fs.mkdirSync(path.join(dir, 'board'));
  fs.writeFileSync(path.join(dir, 'board', 'config.json'), JSON.stringify(cfg));
  fs.writeFileSync(
    path.join(dir, 'board', 'store.json'),
    JSON.stringify({
      cards: { 'l-work': { id: 'l-work', board: 'l', title: 'Line work', status: 'inflight', decisions: [], log: [] } },
      comments: {},
    }),
  );
  let srv = null,
    out = '';
  const startBoard = async () => {
    out = '';
    srv = spawnServer(path.join(dir, 'board', 'config.json'), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    srv.stdout.on('data', d => (out += d));
    for (let i = 0; i < 40 && !out.includes('listening'); i++) await wait(100);
  };
  await startBoard();
  t.after(() => {
    try {
      srv.kill();
    } catch (e) {}
  });
  // the operator home
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  fs.copyFileSync(MCP, path.join(home, 'lighthouse-mcp.cjs'));
  fs.copyFileSync(path.join(path.dirname(MCP), 'shift-session.cjs'), path.join(home, 'shift-session.cjs'));
  fs.copyFileSync(path.join(path.dirname(MCP), 'session-identity.cjs'), path.join(home, 'session-identity.cjs'));
  fs.copyFileSync(path.join(path.dirname(MCP), 'handoff.cjs'), path.join(home, 'handoff.cjs'));
  for (const name of ['dispatch-client.cjs', 'dispatch-storage.cjs', 'mcp-setup.cjs'])
    fs.copyFileSync(path.join(path.dirname(MCP), name), path.join(home, name));
  fs.copyFileSync(SPEC, path.join(home, 'toolcalls-spec.json'));
  fs.copyFileSync(path.join(path.dirname(MCP), 'kit-version.cjs'), path.join(home, 'kit-version.cjs'));
  // the operator's session runs in a folder of its own (not the home); its transcript folder's name is that path,
  // encoded
  const proj = path.join(dir, 'session folder'),
    ccfg = path.join(dir, 'claude-config');
  fs.mkdirSync(proj);
  fs.mkdirSync(ccfg);
  fs.writeFileSync(
    path.join(home, 'config.json'),
    JSON.stringify({
      server: `http://127.0.0.1:${port}`,
      board: 't',
      transcripts: path.join(ccfg, 'projects', proj.replace(/[^a-zA-Z0-9]/g, '-')),
    }),
  );
  fs.writeFileSync(path.join(home, 'LH-TOKEN.txt'), 'OPS\n');
  const relayed = path.join(dir, 'relayed.txt');
  fs.writeFileSync(
    path.join(home, 'relay.sh'),
    `#!/bin/bash\ncat "$2" > "${relayed.replace(/\\/g, '/')}"\necho "SENT to $1"\n`,
  );
  // started as the Claude app starts it on Windows, where System32 comes first on the PATH and its bash.exe is WSL's,
  // which strips a Windows path's backslashes (C:\Users\me\home\relay.sh would arrive as C:Usersmehomerelay.sh)
  const isolatedEnv = { ...process.env, CLAUDE_CONFIG_DIR: ccfg };
  const appEnv =
    process.platform === 'win32'
      ? Object.assign({}, isolatedEnv, {
          PATH: path.join(process.env.SystemRoot || 'C:/Windows', 'System32') + path.delimiter + process.env.PATH,
        })
      : isolatedEnv;
  const mcp = spawn(process.execPath, [path.join(home, 'lighthouse-mcp.cjs')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: appEnv,
  });
  t.after(() => mcp.kill());
  const rpc = childRpc(mcp);
  const tool = async (name, args) => {
    const m = await rpc('tools/call', { name, arguments: args });
    return { text: m.result.content[0].text, isError: m.result.isError };
  };

  // the protocol
  let m = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  });
  assert.equal(m.result.serverInfo.name, 'lighthouse');
  assert.match(m.result.instructions, /board_relay/);
  assertNudgeGuidance(m.result.instructions);
  assert.match(m.result.instructions, /When Owner types in this chat, answer him here/);
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  m = await rpc('tools/list', {});
  assert.ok(
    m.result.tools.some(x => x.name === 'board_reply'),
    'the tools are listed',
  );
  assert.ok(!m.result.tools.some(x => x.name.startsWith('_')), 'no internal tool is listed');
  assertNudgeGuidance(m.result.tools.find(tool => tool.name === 'board_post').description);
  let r = await tool('board_status', {});
  assert.ok(!r.isError, r.text);
  assert.match(r.text, /owe: nothing/);
  assert.ok(!r.text.includes('OPS'), 'the token never appears');

  // a card, a prompt, Owner's Send, the relay by ticket through relay.sh
  r = await tool('board_open', { title: 'Release notes', context: 'notes for the release', slug: 'notes' });
  assert.ok(!r.isError, r.text);
  r = await tool('board_prompt', {
    card: 'notes',
    to: 'firstmate',
    purpose: 'Draft the notes.',
    prompt: 'Write the release notes, plainly; quote "$HOME" and `ls` as text.',
  });
  assert.ok(!r.isError, r.text);
  const ps = (await req(port, 'GET', '/api/comments?board=t&cardId=t-notes', null, 'OWNER')).body.comments.find(
    c => c.prompt,
  );
  r = await tool('board_relay', { source: ps.sid });
  assert.ok(r.isError, 'not before his Send');
  assert.match(r.text, /has not clicked Send/);
  assert.equal((await req(port, 'POST', `/api/comments/${ps.id}/decide`, { choice: 'send' }, 'OWNER')).status, 200);
  r = await tool('board_relay', { source: ps.sid });
  assert.ok(!r.isError, r.text);
  assert.match(r.text, /Relayed to the firstmate/);
  assert.equal(
    fs.readFileSync(relayed, 'utf8'),
    'Write the release notes, plainly; quote "$HOME" and `ls` as text.',
    'exactly his words, no shell expansion',
  );
  const st = (await req(port, 'GET', '/api/state', null, 'OWNER')).body;
  assert.ok(
    st.cards['t-notes'].log.some(e => e.kind === 'RELAYED'),
    'RELAYED recorded',
  );
  // a dry run is checked and answered, never sent: it carries no ticket, and it does not read as "refused"
  fs.unlinkSync(relayed);
  r = await tool('board_relay', { source: ps.sid, again: true, dry_run: true });
  assert.ok(!r.isError, r.text);
  assert.match(r.text, /^DRY RUN/);
  assert.ok(!fs.existsSync(relayed), 'relay.sh never ran');

  // the board goes down: a write is queued, a relay is not; the queue drains in order when it is back
  srv.kill();
  await wait(500);
  r = await tool('board_post', { card: 'notes', kind: 'status', text: 'Drafting, offline.' });
  assert.ok(!r.isError);
  assert.match(r.text, /Queued as/);
  r = await tool('board_relay', { source: ps.sid, again: true });
  assert.ok(r.isError);
  assert.match(r.text, /never queued/);
  assert.ok(fs.readFileSync(path.join(home, 'calls-outbox.jsonl'), 'utf8').includes('Drafting, offline.'));
  await startBoard();
  r = await tool('board_status', {});
  assert.ok(!r.isError, r.text);
  const st2 = (await req(port, 'GET', '/api/state', null, 'OWNER')).body;
  assert.ok(
    st2.cards['t-notes'].log.some(e => e.text === 'Drafting, offline.'),
    'the queued post arrived',
  );
  assert.equal(fs.readFileSync(path.join(home, 'calls-outbox.jsonl'), 'utf8').trim(), '', 'the outbox is empty');

  // a call too large for the board is refused here, never queued
  r = await tool('board_post', { card: 'notes', kind: 'status', text: 'x'.repeat(300 * 1024) });
  assert.ok(r.isError);
  assert.match(r.text, /the board takes up to 200 KB/);
  assert.equal(fs.readFileSync(path.join(home, 'calls-outbox.jsonl'), 'utf8').trim(), '', 'nothing queued');

  // compaction: the rules come back with the pickup note; the handoff is written in the home
  await tool('board_shift', { action: 'compacting', note: 'Waiting on the notes draft.' });
  r = await tool('board_shift', { action: 'compacted' });
  assert.match(r.text, /RULES[\s\S]*board_relay[\s\S]*YOUR PICKUP NOTE[\s\S]*Waiting on the notes draft/);
  r = await tool('board_handoff', { people: 'Alex' });
  assert.ok(!r.isError, r.text);
  assert.match(fs.readFileSync(path.join(home, 'handoff.md'), 'utf8'), /# Handoff: Test[\s\S]*Alex/);

  // the switch: registered at local scope for the session's folder, the two hooks in
  const env = Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: ccfg }),
    self = path.join(home, 'lighthouse-mcp.cjs');
  const run = (args, input) =>
    spawnSync(process.execPath, [self].concat(args), { encoding: 'utf8', env, input: input || '', timeout: 30000 });
  const claudeJson = o => fs.writeFileSync(path.join(ccfg, '.claude.json'), JSON.stringify(o));
  claudeJson({ projects: { [proj]: { mcpServers: {} } } });
  let x = run(['check']);
  assert.equal(x.status, 3, x.stdout);
  assert.match(x.stdout, /not registered at local scope/);
  claudeJson({
    projects: { [proj]: { mcpServers: { lighthouse: { type: 'stdio', command: 'node', args: [self] } } } },
  });
  x = run(['check']);
  assert.equal(x.status, 3, x.stdout);
  assert.ok(!/not registered/.test(x.stdout), x.stdout);
  assert.match(x.stdout, /PreCompact hook is missing[\s\S]*SessionStart hook is missing/);
  fs.mkdirSync(path.join(proj, '.claude'));
  fs.writeFileSync(
    path.join(proj, '.claude', 'settings.local.json'),
    JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }),
  );
  assert.equal(run(['install-hooks']).status, 0);
  assert.equal(run(['install-hooks']).status, 0);
  const sl = JSON.parse(fs.readFileSync(path.join(proj, '.claude', 'settings.local.json'), 'utf8'));
  assert.deepEqual(sl.permissions, { allow: ['Bash(ls)'] }, 'what was there is kept');
  assert.equal(sl.hooks.PreCompact.length, 1, 'installed twice, written once');
  assert.equal(sl.hooks.SessionStart[0].matcher, 'compact');
  x = run(['check']);
  assert.equal(x.status, 0, x.stdout);
  assert.match(x.stdout, /registered at local scope/);
  // the same folder listed twice, with \ and with /: registered under either spelling counts, and the folder is found
  // once
  {
    const back = proj.replace(/\//g, '\\'),
      fwd = proj.replace(/\\/g, '/');
    claudeJson({
      projects: {
        [back]: { mcpServers: {} },
        [fwd]: { mcpServers: { lighthouse: { type: 'stdio', command: 'node', args: [self] } } },
      },
    });
    x = run(['check']);
    if (process.platform === 'win32') {
      assert.equal(x.status, 0, x.stdout);
      assert.match(x.stdout, /registered at local scope/, 'either Windows spelling counts');
    } else {
      assert.equal(x.status, 3, x.stdout);
      assert.match(x.stdout, /several session folders/, 'backslashes name a different POSIX path');
    }
  }
  claudeJson({
    mcpServers: { lighthouse: { command: 'node', args: [self] } },
    projects: { [proj]: { mcpServers: { lighthouse: { type: 'stdio', command: 'node', args: [self] } } } },
  });
  x = run(['check']);
  assert.equal(x.status, 3);
  assert.match(x.stdout, /also registered at user scope/, 'user scope gives firstmate the tools');
  // the hooks: after a compaction the rules come back; the PreCompact mark keeps the operator's own note
  x = run(['hook', 'sessionstart'], JSON.stringify({ source: 'compact' }));
  assert.equal(x.status, 0);
  assert.match(x.stdout, /board_shift\(action: "compacted"\)[\s\S]*RULES[\s\S]*board_relay/);
  assertNudgeGuidance(x.stdout);
  x = run(['hook', 'sessionstart'], JSON.stringify({ source: 'startup' }));
  assert.equal(x.stdout.trim(), '', 'only after a compaction');
  x = run(['hook', 'precompact'], JSON.stringify({ trigger: 'auto' }));
  assert.equal(x.status, 0, x.stderr);
  r = await tool('board_shift', { action: 'compacted' });
  assert.match(r.text, /YOUR PICKUP NOTE[\s\S]*Waiting on the notes draft/, 'the hook kept the note');

  // a shadow trial: LH-SHADOW-TOKEN.txt beside the line token; refused on a board in tool mode, dry runs beside the
  // lines
  fs.writeFileSync(path.join(home, 'LH-SHADOW-TOKEN.txt'), 'shd-7Qx2\n');
  x = run(['call', 'board_status', '{}']);
  assert.equal(x.status, 1);
  assert.match(x.stdout, /shadow runs only while the board stays in line mode/);
  const lenv = Object.assign({}, env, { LH_BOARD: 'l' });
  fs.writeFileSync(path.join(home, 'LH-TOKEN.txt'), 'LINES' + String.fromCharCode(10));
  for (const [action, state] of [
    ['start', 'on'],
    ['end', 'off'],
  ]) {
    x = spawnSync(process.execPath, [self, 'shift', action], { encoding: 'utf8', env: lenv, timeout: 30000 });
    assert.equal(x.status, 0, x.stderr);
    assert.equal((await req(port, 'GET', '/api/state', null, 'OWNER')).body.boards.l.shift.state, state);
    assert.ok(!x.stdout.includes('shd-7Qx2'), 'shell edges never expose the shadow token');
  }
  x = spawnSync(
    process.execPath,
    [self, 'call', 'board_post', JSON.stringify({ card: 'work', kind: 'status', text: 'SHADOW-MARK' })],
    { encoding: 'utf8', env: lenv, timeout: 30000 },
  );
  assert.equal(x.status, 0, x.stdout);
  assert.match(x.stdout, /DRY RUN[\s\S]*SHADOW: your tools only dry-run/);
  assert.ok(!x.stdout.includes('shd-7Qx2'), 'the token never appears');
  assert.ok(
    !(await req(port, 'GET', '/api/state', null, 'OWNER')).body.cards['l-work'].log.some(e => e.text === 'SHADOW-MARK'),
    'nothing posted',
  );
  // a shadow relay goes to the board as a dry run: checked and recorded for the trial, never sent
  await req(port, 'POST', '/api/comments', { board: 'l', text: 'Tell firstmate to pause.' }, 'OWNER');
  {
    const lm = (await req(port, 'GET', '/api/comments?board=l', null, 'OWNER')).body.comments.find(
      c => c.by === 'owner' && /pause/.test(c.text),
    ).sid;
    x = spawnSync(process.execPath, [self, 'call', 'board_relay', JSON.stringify({ source: lm, to: 'firstmate' })], {
      encoding: 'utf8',
      env: lenv,
      timeout: 30000,
    });
    assert.equal(x.status, 0, x.stdout);
    assert.match(x.stdout, /DRY RUN[\s\S]*SHADOW: nothing was relayed/);
    assert.ok(!fs.existsSync(relayed), 'relay.sh never ran');
  }
  x = run(['hook', 'precompact'], '{}');
  assert.equal(x.status, 0);
  x = run(['hook', 'sessionstart'], JSON.stringify({ source: 'compact' }));
  assert.match(x.stdout, /SHADOW TRIAL[\s\S]*timed lines are still what answer Owner/);
  fs.unlinkSync(path.join(home, 'LH-SHADOW-TOKEN.txt'));
  fs.writeFileSync(path.join(home, 'LH-TOKEN.txt'), 'OPS' + String.fromCharCode(10));

  // here: is the session that runs shift.sh writing in the configured folder? A session in another folder goes silent
  // while check stays green
  const tdir = path.join(ccfg, 'projects', proj.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(tdir, { recursive: true });
  x = run(['here']);
  assert.equal(x.status, 4, x.stdout);
  assert.match(x.stdout, /NOT HERE/);
  const sess = path.join(tdir, 'abc.jsonl');
  fs.writeFileSync(sess, '{}\n');
  x = run(['here']);
  assert.equal(x.status, 0, x.stdout);
  assert.match(x.stdout, /session: here \(abc\.jsonl/);
  const old = new Date(Date.now() - 10 * 60000);
  fs.utimesSync(sess, old, old);
  x = run(['here']);
  assert.equal(x.status, 4, x.stdout);
  assert.match(x.stdout, /its newest, abc\.jsonl, 10 min ago/);
  // the one setting may name the session folder itself: the transcript folder is derived, and check finds the folder
  // by it
  fs.utimesSync(sess, new Date(), new Date());
  const run2 = args =>
    spawnSync(process.execPath, [self].concat(args), {
      encoding: 'utf8',
      env: Object.assign({}, env, { LH_TRANSCRIPTS: proj }),
      timeout: 30000,
    });
  x = run2(['here']);
  assert.equal(x.status, 0, 'derived from the session folder: ' + x.stdout);
  claudeJson({}); // Claude Code's own list no longer names it: the setting does
  x = run2(['check']);
  assert.ok(!/name it with --project|name the folder with --project/.test(x.stdout), x.stdout);
});
