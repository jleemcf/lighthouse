'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const kit = path.resolve(__dirname, '../../operator-kit');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const python = process.platform === 'win32' ? 'python' : 'python3';
const safeEnv = { ...process.env };
delete safeEnv.TYPESAFE_API_KEY;

function runUpdate({ fault = 'none', layout = 'current', source } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-kit-update-'));
  const repo = path.join(home, 'repo');
  const candidate = path.join(repo, 'lighthouse/operator-kit');
  fs.cpSync(kit, candidate, { recursive: true });
  const config = Object.fromEntries(
    Object.keys(JSON.parse(fs.readFileSync(path.join(kit, 'config.example.json'), 'utf8'))).map(key => [
      key,
      'fixture',
    ]),
  );
  config.__MACHINE_NAME__ = 'fixture';
  config.__OPERATOR_WSL_DIR__ = path.join(home, 'twin');
  config.__BOARD_SERVER__ = 'http://127.0.0.1:17789';
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(config));
  const installed = spawnSync(
    python,
    [path.join(candidate, 'install.py'), '--config', path.join(home, 'config.json'), '--out', home],
    { env: safeEnv, encoding: 'utf8' },
  );
  if (installed.status !== 0) throw new Error('fixture install failed: ' + installed.stderr);
  fs.cpSync(path.join(home, 'wsl'), path.join(home, 'twin'), { recursive: true });
  if (layout === 'old') fs.rmSync(path.join(home, 'KIT-MANIFEST.json'), { force: true });
  const previous = fs.readFileSync(path.join(home, 'lighthouse-mcp.cjs'), 'utf8');
  const previousTwin = fs.readFileSync(path.join(home, 'twin/lh-probe.sh'), 'utf8');
  fs.writeFileSync(path.join(home, 'collector.err'), 'synthetic-private-value');
  fs.writeFileSync(path.join(home, 'twin/lh-probe.sh.new'), 'obsolete pending file');
  fs.appendFileSync(path.join(candidate, 'scripts/lighthouse-mcp.cjs'), '\n');
  fs.appendFileSync(path.join(candidate, 'scripts/lh-probe.sh'), '\n');
  fs.writeFileSync(path.join(home, 'REPO.txt'), 'fixture\n' + repo.replace(/\\/g, '/') + '\n');
  const shift = (source || fs.readFileSync(path.join(kit, 'scripts/shift.sh'), 'utf8')).replace(/\r/g, '');
  const update = shift.slice(shift.indexOf('  update)\n'), shift.indexOf('\n  claim)'));
  const swap = shift.slice(shift.indexOf('swap_new() {'), shift.indexOf('\nrules()'));
  const alive = shift.slice(shift.indexOf('outbox_alive() {'), shift.indexOf('\nkill_watchers()'));
  const platformPaths = process.platform === 'win32' ? 'command cygpath "$@"' : 'printf "%s\\n" "$2"';
  const script = [
    'set -u',
    'HERE="$PWD"; SHIFT_HOME="$HERE"; MACHINE=fixture; DISTRO=fixture; KIT_UPDATE_DRIVER=1',
    'WSL_HOME=' + JSON.stringify(path.join(home, 'twin').replace(/\\/g, '/')),
    'fault="$1"; export fault',
    'if [[ "$fault" == updater-* ]]; then SHIFT_HOME=""; fi',
    'mktemp() { [ "$fault" != updater-temp ] || return 20; command mktemp; }',
    'cp() { [ "$fault" != updater-copy ] || return 20; command cp "$@"; }',
    'git() { [ "$fault" != pull ]; }',
    'cygpath() { [ "$fault" != paths ] || return 21; ' + platformPaths + '; }',
    'python() {',
    '  if [[ "$1" == */install.py ]]; then',
    '    [ "$fault" != installer ] || { echo synthetic-private-value >&2; return 23; }',
    '    if [ "$fault" = installer-partial ]; then printf partial > "$HERE/lighthouse-mcp.cjs"; return 23; fi',
    '    command ' + python + ' "$@" || return',
    '    if [ "$fault" = activation ]; then cp "$HERE/lighthouse-mcp.cjs" "$HERE/lighthouse-mcp.cjs.new";',
    '      printf stale > "$HERE/lighthouse-mcp.cjs"; fi',
    '    if [ "$fault" = windows-verify ]; then printf corrupt > "$HERE/lighthouse-mcp.cjs"; fi',
    '  else command ' + python + ' "$@"; fi',
    '}',
    'mv() { [ "$fault" != activation ] || return 24; command mv "$@"; }',
    'wsl() {',
    '  [ "$3" = -e ] || return 25',
    '  [ "$fault" != wsl-launch ] || return 25',
    '  shift 4',
    '  mkdir() { [ "$fault" != mkdir ] || return 26; command mkdir "$@"; }; export -f mkdir',
    '  python3() { [ "$fault" != twin-verify ] || return 26; command ' + python + ' "$@"; }',
    '  export -f python3',
    '  args=(); for arg in "$@"; do',
    '    if [[ "$arg" == /mnt/?/* ]]; then arg="$(printf "%s" "$arg" | sed "s|^/mnt/||;s|^.|&:|")"; fi',
    '    args+=("$arg"); done',
    '  cp() { [ "$fault" != copy ] || return 26; command cp "$@"; }; export -f cp',
    '  chmod() { [ "$fault" != chmod ] || return 27; command chmod "$@"; }; export -f chmod',
    '  bash "${args[@]}"',
    '}',
    'outbox() { [ "$fault" != "outbox-$1" ] || return 28;',
    '  if [ "$1" = status ]; then',
    '    if [ "$fault" = outbox-alive ] && [ -f "$HERE/restarted" ]; then echo "not running";',
    '    else echo running; fi; else echo "$1"; touch "$HERE/restarted"; fi; }',
    'steward() { [ "$fault" != "steward-$1" ] || return 29;',
    '  if [ "$1" = status ]; then echo running; else echo "$1"; fi; }',
    'sleep() { :; }',
    alive,
    swap,
    'case update in',
    update,
    'esac',
  ].join('\n');
  const replay = path.join(home, 'replay.sh');
  fs.writeFileSync(replay, script);
  const result = spawnSync(bash, [replay, fault], {
    cwd: home,
    env: safeEnv,
    encoding: 'utf8',
    timeout: 30000,
  });
  return { ...result, home, previous, previousTwin, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}

module.exports = { runUpdate };
