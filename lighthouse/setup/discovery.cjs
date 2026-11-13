'use strict';
const os = require('node:os');
const { fs, path, run } = require('./common.cjs');
function discover(home, distro) {
  const windows = process.platform === 'win32';
  const python = windows ? 'python' : 'python3';
  run(python, ['-c', 'import sys; assert sys.version_info >= (3,10)']);
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22 or newer is required.');
  let wsl = null;
  if (windows) {
    try {
      const list = run('wsl.exe', ['--list', '--quiet'], { encoding: 'utf16le' })
        .replace(/\0/g, '')
        .split(/\r?\n/)
        .map(value => value.trim())
        .filter(Boolean);
      wsl = distro && list.includes(distro) ? distro : list[0] || null;
    } catch {
      /* Core tools need no firstmate adapter or WSL. */
    }
  }
  const projects = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  const transcripts = path.join(projects, home.replace(/[^a-zA-Z0-9]/g, '-'));
  const route = path.join(os.homedir(), 'firstmate');
  return {
    python,
    platform: process.platform,
    wsl,
    transcripts,
    transcriptPresent: fs.existsSync(transcripts),
    routePresent: fs.existsSync(path.join(route, 'bin', 'firstmate')),
    home,
  };
}
function configuration(found, binding) {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../operator-kit/config.example.json'), 'utf8'));
  for (const key of Object.keys(cfg)) cfg[key] = 'none';
  const forward = value => value.replace(/\\/g, '/');
  return {
    ...cfg,
    __WSL_DISTRO__: found.wsl || 'none',
    __WSL_USER__: os.userInfo().username,
    __WINDOWS_USER__: path.basename(os.homedir()),
    __WINDOWS_NODE_EXE__: forward(process.execPath),
    __OPERATOR_WSL_DIR__: '/tmp/lighthouse-adapter-disabled',
    __FM_HOME__: '/nonexistent/lighthouse-disabled',
    __FM_HOME_REL__: '/firstmate',
    __FM_CONV_DIR__: 'none',
    __STEWARD_HOME__: 'none',
    __MACHINE_NAME__: 'workstation',
    __BOARD_ID__: binding.boardId,
    __BOARD_SERVER__: binding.endpoint,
    __OPERATOR_TRANSCRIPT_DIR__: forward(found.home),
    __FM_SEND__: 'none-yet',
    __GATE_MODE__: 'off',
    __WATCH_BOARDS__: 'none',
    __TYPESAFE_ENV__: 'default',
    __OWNER_ID__: 'owner',
    __OWNER_NAME__: 'the captain',
    __TIME_ZONE__: 'UTC',
    __WINDOWS_TIME_ZONE__: 'UTC',
    __TIME_ZONE_LABEL__: 'UTC',
    protocol: 'tools',
    credentialFile: 'credential.json',
    guidedSetup: true,
    adapters: { collector: false, firstmate: false, steward: false, watchers: false },
    discovery: {
      platform: found.platform,
      wsl: !!found.wsl,
      transcripts: found.transcriptPresent,
      firstmateRoute: found.routePresent,
    },
    server: binding.endpoint,
    board: binding.boardId,
  };
}
module.exports = { discover, configuration };
