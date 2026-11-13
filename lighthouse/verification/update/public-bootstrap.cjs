'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const kit = path.join(root, 'lighthouse/operator-kit');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const python = process.platform === 'win32' ? 'python' : 'python3';
const env = { ...process.env };
delete env.TYPESAFE_API_KEY;
delete env.WSL_DISTRO_NAME;
function fixture(legacy = 'supported') {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-bootstrap spaces-'));
  const home = path.join(scratch, 'home');
  const source = path.join(scratch, 'source/lighthouse/operator-kit');
  const history = path.join(scratch, 'source');
  const old = path.join(scratch, 'old/lighthouse/operator-kit');
  fs.cpSync(kit, source, { recursive: true });
  fs.cpSync(kit, old, { recursive: true });
  const originals = new Map();
  for (const name of ['install.py', 'shift.sh', 'lighthouse-mcp.cjs', 'toolcalls-spec.json']) {
    const relative = name === 'install.py' ? name : 'scripts/' + name;
    const template = fs
      .readFileSync(path.join(kit, 'tests/fixtures/legacy-kit', name + '.txt'), 'utf8')
      .replace(/\r\n/g, '\n');
    fs.writeFileSync(path.join(old, relative), template);
    if (name !== 'install.py') {
      originals.set(relative, fs.readFileSync(path.join(source, relative)));
      fs.writeFileSync(path.join(source, relative), template);
    }
  }
  const gitEnv = {
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  const git = args => {
    const result = spawnSync('git', ['-C', history, ...args], { encoding: 'utf8', env: gitEnv });
    if (result.status !== 0) throw new Error('scratch history failed: ' + result.stderr);
    return result.stdout.trim();
  };
  git(['init', '-b', 'main']);
  git(['add', '.']);
  git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Legacy fixture']);
  const floor = git(['rev-parse', 'HEAD']);
  for (const [relative, template] of originals) fs.writeFileSync(path.join(source, relative), template);
  const bootstrap = path.join(source, 'bootstrap.py');
  fs.writeFileSync(
    bootstrap,
    fs.readFileSync(bootstrap, 'utf8').replace('b4942b98fa438c4a2b9bfd99801532d30fa35a0d', floor),
  );
  git(['add', '.']);
  git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Fetched fixture']);
  const config = Object.fromEntries(
    Object.keys(JSON.parse(fs.readFileSync(path.join(kit, 'config.example.json'), 'utf8'))).map(key => [
      key,
      'fixture',
    ]),
  );
  config.__OPERATOR_WSL_DIR__ = path.join(scratch, 'twin').replace(/\\/g, '/');
  config.__BOARD_SERVER__ = 'http://127.0.0.1:17789';
  config.__MACHINE_NAME__ = 'fixture';
  const configPath = path.join(scratch, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const installed = spawnSync(python, [path.join(old, 'install.py'), '--config', configPath, '--out', home], {
    env,
    encoding: 'utf8',
  });
  if (installed.status !== 0) throw new Error('historical installer failed: ' + installed.stderr);
  fs.cpSync(path.join(home, 'wsl'), config.__OPERATOR_WSL_DIR__, { recursive: true });
  if (legacy === 'unsupported') fs.appendFileSync(path.join(home, 'shift.sh'), '\nunsupported-old-driver\n');
  const hooks = path.join(scratch, 'hooks.sh');
  fs.writeFileSync(
    hooks,
    [
      'fault="$KIT_TEST_FAULT"',
      'grep() { if [[ "$*" == *microsoft* ]]; then return 1; fi; command grep "$@"; }',
      'cygpath() { ' + (process.platform === 'win32' ? 'command cygpath "$@";' : 'printf "%s\\n" "$2";') + ' }',
      'powershell() { echo stopped; }',
      'python() {',
      '  if [[ "$1" == */install.py ]]; then',
      '    [ "$fault" != before-install ] || exit 99',
      '    command ' + python + ' "$@" || return',
      '    if [ "$fault" = install-partial ]; then',
      '      rm -f "$SHIFT_HOME/KIT-MANIFEST.json"; return 43',
      '    fi',
      '    if [ "$fault" = activation ]; then',
      '      command cp "$SHIFT_HOME/lighthouse-mcp.cjs" "$SHIFT_HOME/lighthouse-mcp.cjs.new"',
      '      printf stale > "$SHIFT_HOME/lighthouse-mcp.cjs"',
      '    fi',
      '    return 0',
      '  else command ' + python + ' "$@"; fi',
      '}',
      'mv() { [ "$fault" != activation ] || return 42; command mv "$@"; }',
      'wsl() {',
      '  [ "$3" = -e ] || return 40',
      '  [ "$fault" != copy ] || return 41',
      '  shift 4; args=()',
      '  for arg in "$@"; do',
      process.platform === 'win32'
        ? '    if [[ "$arg" == /mnt/?/* ]]; then arg="$(cygpath -am "/' + '\u0001{arg:5}' + '")"; fi'
        : '    :',
      '    args+=("$arg"); done',
      '  bash "\u0001{args[@]}"',
      '}',
    ]
      .join('\n')
      .replaceAll('\\u0001', '$')
      .replaceAll('\u0001', '$'),
  );
  const launcher = path.join(scratch, 'launch.py');
  fs.writeFileSync(
    launcher,
    [
      'import importlib.util, pathlib, subprocess, sys',
      'spec = importlib.util.spec_from_file_location("bootstrap", sys.argv[1])',
      'module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)',
      'history, mode = sys.argv[4], sys.argv[6]',
      'def fixture_git(repo, *args):',
      '    if args[0] == "pull": return ""',
      '    location = ["--git-dir", history] if mode == "gitdir" else ["-C", history]',
      '    result = subprocess.run(["git", *location, *args], capture_output=True, text=True, encoding="utf-8")',
      '    if result.returncode: raise module.BootstrapFailure("historical fixture unavailable")',
      '    return result.stdout.strip()',
      'module.git = fixture_git',
      'if sys.argv[5] == "staging": module.shutil.copytree = lambda *args, **kw: (_ for _ in ()).throw(OSError())',
      'sys.argv = [sys.argv[0], "--home", sys.argv[2], "--bash", sys.argv[3]]',
      'sys.exit(module.main())',
    ].join('\n'),
  );
  function run(fault = 'none') {
    return spawnSync(python, [launcher, path.join(source, 'bootstrap.py'), home, bash, history, fault, 'root'], {
      env: { ...env, BASH_ENV: hooks.replace(/\\/g, '/'), KIT_TEST_FAULT: fault },
      encoding: 'utf8',
      timeout: 45000,
    });
  }
  return {
    home,
    source,
    twin: config.__OPERATOR_WSL_DIR__,
    run,
    cleanup: () => fs.rmSync(scratch, { recursive: true, force: true }),
  };
}

module.exports = { fixture, bash, python, env };
