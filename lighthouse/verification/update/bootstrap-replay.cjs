'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { gitArgs } = require('../../../scripts/git-args.cjs');
const root = path.resolve(__dirname, '../../..');
const kit = path.join(root, 'lighthouse/operator-kit');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const python = process.platform === 'win32' ? 'python' : 'python3';
const env = { ...process.env };
delete env.TYPESAFE_API_KEY;
delete env.WSL_DISTRO_NAME;
const location = env.KIT_TEST_HISTORY ? ['-C', root, '--git-dir', env.KIT_TEST_HISTORY] : gitArgs(root);
const historical =
  spawnSync('git', [...location, 'cat-file', '-e', '5cd7cf3^{commit}'], {
    env,
    stdio: 'pipe',
  }).status === 0;
const git = args => {
  const result = spawnSync('git', [...location, ...args], { encoding: 'utf8', env });
  if (result.status !== 0) throw new Error('historical fixture unavailable');
  return result.stdout;
};

function fixture(legacy = '5cd7cf3') {
  if (!historical) return require('./public-bootstrap.cjs').fixture(legacy === 'ceb65aa' ? 'unsupported' : 'supported');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-bootstrap spaces-'));
  const home = path.join(scratch, 'home');
  const source = path.join(scratch, 'source/lighthouse/operator-kit');
  const old = path.join(scratch, 'old/lighthouse/operator-kit');
  fs.cpSync(kit, source, { recursive: true });
  fs.mkdirSync(path.join(old, 'scripts'), { recursive: true });
  for (const name of git(['ls-tree', '-r', '--name-only', legacy, 'lighthouse/operator-kit']).trim().split('\n')) {
    if (name !== 'lighthouse/operator-kit/install.py' && !name.startsWith('lighthouse/operator-kit/scripts/')) continue;
    const destination = path.join(scratch, 'old', name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, git(['show', legacy + ':' + name]));
  }
  const config = Object.fromEntries(
    Object.keys(JSON.parse(fs.readFileSync(path.join(kit, 'config.example.json'), 'utf8'))).map(key => [
      key,
      'fixture',
    ]),
  );
  config.__OPERATOR_WSL_DIR__ = path.join(scratch, 'twin').replace(/\\/g, '/');
  config.__BOARD_SERVER__ = 'http://127.0.0.1:17789';
  config.__MACHINE_NAME__ = 'fixture';
  config.__CODEX_EXE__ = 'none-yet';
  config.__STEWARD_THREAD_ID__ = 'none-yet';
  const configPath = path.join(scratch, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const installed = spawnSync(python, [path.join(old, 'install.py'), '--config', configPath, '--out', home], {
    env,
    encoding: 'utf8',
  });
  if (installed.status !== 0) throw new Error('historical installer failed: ' + installed.stderr);
  fs.cpSync(path.join(home, 'wsl'), config.__OPERATOR_WSL_DIR__, { recursive: true });
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
      'import importlib.util, json, pathlib, subprocess, sys',
      'spec = importlib.util.spec_from_file_location("bootstrap", sys.argv[1])',
      'module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)',
      'location = json.loads(sys.argv[4])',
      'def fixture_git(repo, *args):',
      '    if args[0] == "pull": return ""',
      '    result = subprocess.run(["git", *location, *args], capture_output=True, text=True, encoding="utf-8")',
      '    if result.returncode: raise ValueError("historical fixture unavailable")',
      '    return result.stdout.strip()',
      'module.git = fixture_git',
      'if sys.argv[5] == "staging": module.shutil.copytree = lambda *args, **kw: (_ for _ in ()).throw(OSError())',
      'sys.argv = [sys.argv[0], "--home", sys.argv[2], "--bash", sys.argv[3]]',
      'sys.exit(module.main())',
    ].join('\n'),
  );
  function run(fault = 'none', bootstrap = 'bootstrap.py') {
    return spawnSync(python, [launcher, path.join(source, bootstrap), home, bash, JSON.stringify(location), fault], {
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
    runLegacy: () => {
      fs.writeFileSync(
        path.join(source, 'bootstrap-v0.py'),
        git(['show', 'f8fff1ab64b1289b77e798b72d17787806d53237:lighthouse/operator-kit/bootstrap.py']),
      );
      return run('none', 'bootstrap-v0.py');
    },
    cleanup: () => fs.rmSync(scratch, { recursive: true, force: true }),
  };
}

module.exports = { fixture, bash, python, env, git, historical };
