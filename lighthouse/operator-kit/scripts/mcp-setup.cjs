'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
module.exports = function setup({ HERE, TRANSCRIPTS, SESSION_DIR, TRANSCRIPT_DIR, SPEC, SHADOW, call }) {
  // ---------- the switch: registration, hooks (TOOLCALL-DESIGN §3, §9) ----------
  const SELF = path.join(HERE, 'lighthouse-mcp.cjs').replace(/\\/g, '/');
  const fold = p => path.resolve(String(p)).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const claudeJson = () => path.join(process.env.CLAUDE_CONFIG_DIR || os.homedir(), '.claude.json');
  const hookCmd = kind => `node "${SELF}" hook ${kind}`;
  const isOurs = h => (h.hooks || []).some(x => /lighthouse-mcp\.cjs"? hook /.test(String(x.command || '')));
  function sessionFolder(argv) {
    // the folder the operator's session runs in: named, or found by its transcript folder's name in Claude Code's own
    // list
    const i = argv.indexOf('--project');
    if (i >= 0 && argv[i + 1]) return { dir: path.resolve(argv[i + 1]) };
    if (SESSION_DIR) return { dir: SESSION_DIR }; // the setting names it
    let cj;
    try {
      cj = JSON.parse(fs.readFileSync(claudeJson(), 'utf8'));
    } catch (e) {
      return { err: `cannot read ${claudeJson()} (${e.message}); name the folder with --project` };
    }
    const want = path.basename(String(TRANSCRIPTS).replace(/[\\/]+$/, '')).toLowerCase();
    // one folder can be listed twice, once with \ and once with / (an older Claude Code wrote \): one folder
    const hits = [
      ...new Map(
        Object.keys(cj.projects || {})
          .filter(k => k.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() === want)
          .map(k => [fold(k), k]),
      ).values(),
    ];
    if (hits.length !== 1)
      return {
        err:
          `${hits.length ? 'several' : 'no'} session folder${hits.length ? 's' : ''} in Claude Code's list ` +
          `match${hits.length ? '' : 'es'} the transcript folder ${want}; name it with --project`,
      };
    return { dir: path.resolve(hits[0]) };
  }
  function check(argv) {
    const sf = sessionFolder(argv);
    if (sf.err) {
      console.log('tools: ' + sf.err);
      return 3;
    }
    const problems = [];
    let cj = {};
    try {
      cj = JSON.parse(fs.readFileSync(claudeJson(), 'utf8'));
    } catch (e) {
      problems.push(`cannot read ${claudeJson()}`);
    }
    // the registered file is compared by its real path: a short name and the long one are the same file
    const real = p => {
      try {
        return fold(fs.realpathSync.native(p));
      } catch (e) {
        return fold(p);
      }
    };
    const mine = s =>
      !!s &&
      [s.command]
        .concat(s.args || [])
        .some(a => /lighthouse-mcp\.cjs$/i.test(String(a)) && real(String(a)) === real(SELF));
    // every spelling of the folder is read: registered under any of them counts (current Claude Code writes the / one)
    const local = Object.keys(cj.projects || {})
      .filter(k => fold(k) === fold(sf.dir))
      .map(k => (cj.projects[k].mcpServers || {}).lighthouse)
      .filter(Boolean)
      .sort((x, y) => (mine(y) ? 1 : 0) - (mine(x) ? 1 : 0))[0];
    if (!mine(local))
      problems.push(
        `the lighthouse tools are not registered at local scope for ${sf.dir}` +
          `${local ? ' (a registration there runs another file)' : ''}. ` +
          `In that folder: claude mcp add --scope local lighthouse -- node "${SELF}"`,
      );
    if ((cj.mcpServers || {}).lighthouse)
      problems.push(
        'lighthouse is also registered at user scope, so firstmate and every other session ' +
          'of this user get the tools: ' +
          'claude mcp remove --scope user lighthouse',
      );
    let st = {};
    try {
      st = JSON.parse(fs.readFileSync(path.join(sf.dir, '.claude', 'settings.local.json'), 'utf8'));
    } catch (e) {}
    for (const ev of ['PreCompact', 'SessionStart'])
      if (!((st.hooks || {})[ev] || []).some(isOurs))
        problems.push(
          `the ${ev} hook is missing: node "${SELF}" install-hooks --project "${sf.dir.replace(/\\/g, '/')}"`,
        );
    if (problems.length) {
      console.log('tools: NOT READY\n' + problems.map(p => '  - ' + p).join('\n'));
      return 3;
    }
    console.log(
      `tools: registered at local scope for ${sf.dir}; hooks in place${SHADOW ? '; SHADOW (dry runs only)' : ''}. ` +
        'A session started before the registration has no tools: restart it.',
    );
    return 0;
  }
  // Is the session that runs this writing in the configured folder? shift.sh start runs it from the operator's own
  // session, whose command has just been written to its transcript; nothing written there means the session runs in
  // another folder, where the collector cannot read its lines and its tools may not be registered, though `check` is
  // green for the configured one
  function here() {
    let newest = 0,
      name = null;
    try {
      for (const f of fs.readdirSync(TRANSCRIPT_DIR))
        if (f.endsWith('.jsonl')) {
          const m = fs.statSync(path.join(TRANSCRIPT_DIR, f)).mtimeMs;
          if (m > newest) {
            newest = m;
            name = f;
          }
        }
    } catch (e) {}
    const age = Date.now() - newest,
      where = SESSION_DIR || `the folder ${path.basename(TRANSCRIPT_DIR)} encodes`;
    if (!name || age > 180000) {
      console.log(
        `session: NOT HERE: nothing has written to ${TRANSCRIPT_DIR} in the last 3 minutes` +
          `${name ? ` (its newest, ${name}, ${Math.round(age / 60000)} min ago)` : ''}. ` +
          'This session seems to run in another folder, where the collector cannot read it. ' +
          `Start the operator in ${where}, or set the transcript directory in this home's config.json and run ` +
          'shift.sh update (SETUP.md, "Moving an operator to a new folder").',
      );
      return 4;
    }
    console.log(`session: here (${name}, written ${Math.round(age / 1000)} s ago)`);
    return 0;
  }
  function installHooks(argv) {
    // only this home's two hooks are added or replaced; everything else in the file is kept as it was
    const sf = sessionFolder(argv);
    if (sf.err) {
      console.log(sf.err);
      return 2;
    }
    const f = path.join(sf.dir, '.claude', 'settings.local.json');
    let st = {};
    if (fs.existsSync(f)) {
      try {
        st = JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch (e) {
        console.log(`${f} is not valid JSON; fix it by hand first (nothing written)`);
        return 2;
      }
    }
    st.hooks = st.hooks || {};
    st.hooks.PreCompact = (st.hooks.PreCompact || [])
      .filter(h => !isOurs(h))
      .concat([{ hooks: [{ type: 'command', command: hookCmd('precompact') }] }]);
    st.hooks.SessionStart = (st.hooks.SessionStart || [])
      .filter(h => !isOurs(h))
      .concat([{ matcher: 'compact', hooks: [{ type: 'command', command: hookCmd('sessionstart') }] }]);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(st, null, 2) + '\n');
    fs.renameSync(tmp, f);
    console.log(
      `hooks written to ${f}: PreCompact marks the compaction on the board; ` +
        'SessionStart (after a compaction) puts the rules back in front of the operator. ' +
        'They take effect in the next session.',
    );
    return 0;
  }
  async function hook(kind) {
    // never blocks a compaction or a start: always exit 0
    let ev = {};
    try {
      ev = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    } catch (e) {}
    if (kind === 'precompact') {
      // a shadow session is on a line-mode board, where the collector marks the compaction
      if (!SHADOW) {
        const r = await call('board_shift', { action: 'compacting' }).catch(e => ({ text: e.message }));
        process.stderr.write('lighthouse: ' + String(r.text).split('\n')[0] + '\n');
      }
      return 0;
    }
    if (kind === 'sessionstart' && (!ev.source || ev.source === 'compact')) {
      console.log(
        SHADOW
          ? 'LIGHTHOUSE, after a compaction (SHADOW TRIAL): the summary kept your work and dropped your manners. ' +
              'Your timed lines are still what answer Owner on this board: read OPERATOR-BRIEF.md again before you ' +
              'write one. Alongside each act, make the matching lighthouse tool call; ' +
              'it only dry-runs.\n\nTHE TOOLS\n' +
              (SPEC.instructions || '')
          : 'LIGHTHOUSE, after a compaction: the summary kept your work and dropped your manners. ' +
              'Before anything else call board_shift(action: "compacted"): it returns the full picture and your ' +
              'pickup note.\n\nRULES\n' +
              (SPEC.instructions || ''),
      );
    }
    return 0;
  }

  return { check, here, installHooks, hook };
};
