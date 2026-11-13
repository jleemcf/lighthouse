'use strict';
const os = require('node:os');
const { fs, path, run, read, endpoint, directory, request, writePrivate, assertPrivate } = require('./common.cjs');
const { discover, configuration } = require('./discovery.cjs');

async function setup(options) {
  const home = path.resolve(options.home || path.join(os.homedir(), 'lighthouse-operator'));
  if (!options.host || !options.trust) throw new Error('Host address and explicit trust approval are required.');
  const origin = endpoint(options.host);
  const found = discover(home, options.distro);
  const marker = path.join(home, 'SETUP-PENDING.json');
  if (fs.existsSync(home) && fs.readdirSync(home).length) {
    if (!fs.existsSync(marker)) throw new Error('Existing home refused.');
    if (read(marker, true).endpoint !== origin) throw new Error('Prepared host differs; do not retarget setup.');
    assertPrivate(home, true);
  } else {
    directory(home, true);
    writePrivate(marker, { endpoint: origin });
  }
  const preparedFile = path.join(home, 'prepared.json');
  if (!fs.existsSync(preparedFile))
    await require('../server/registry-cli').run([
      'prepare',
      '--output',
      preparedFile,
      '--request',
      path.join(home, 'installation-request.json'),
    ]);
  const requestFile = path.join(home, 'installation-request.json');
  if (!fs.existsSync(requestFile)) {
    const saved = read(preparedFile, true);
    writePrivate(requestFile, {
      installationId: saved.installationId,
      proofVerifier: require('../server/registry').digest(saved.proof),
    });
  }
  if (!options['grant-file'])
    return {
      prepared: true,
      request: 'installation-request.json',
      next: 'Transfer the request privately to the host. Rerun setup with --grant-file PATH and --trust.',
    };
  const grant = read(path.resolve(options['grant-file']), true);
  const prepared = read(preparedFile, true);
  if (
    grant.scope?.installationId !== prepared.installationId ||
    grant.scope?.role !== 'operator' ||
    grant.scope?.protocol !== 'tools'
  )
    throw new Error('An installation-scoped tools operator grant is required.');
  const bindingFile = path.join(home, 'binding.json');
  const credentialFile = path.join(home, 'credential.json');
  // Persist the generated credential before making the request. A lost response is retried with the same proof.
  if (!fs.existsSync(credentialFile)) writePrivate(credentialFile, { credential: prepared.credential });
  else if (read(credentialFile, true).credential !== prepared.credential) throw new Error('Credential differs.');
  const result = await request(origin, '/api/enrollment/consume', '', {
    ...prepared,
    grant: grant.grant,
    scope: grant.scope,
  });
  if (
    result.installationId !== prepared.installationId ||
    result.boardId !== grant.scope.boardId ||
    result.protocol !== grant.scope.protocol
  )
    throw new Error('Enrollment result differs from the approved grant.');
  const binding = { ...result, endpoint: origin, credentialFile: 'credential.json' };
  if (!fs.existsSync(bindingFile)) writePrivate(bindingFile, binding);
  else if (read(bindingFile, true).installationId !== result.installationId) throw new Error('Binding differs.');
  const configFile = path.join(home, 'setup-config.json');
  if (!fs.existsSync(configFile)) writePrivate(configFile, configuration(found, binding));
  run(found.python, [path.join(__dirname, '../operator-kit/install.py'), '--config', configFile, '--out', home], {
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' },
  });
  const mcpFile = path.join(home, '.mcp.json');
  const mcp = fs.existsSync(mcpFile) ? read(mcpFile) : { mcpServers: {} };
  if (
    mcp.mcpServers?.lighthouse &&
    JSON.stringify(mcp.mcpServers.lighthouse.args) !== JSON.stringify([path.join(home, 'lighthouse-mcp.cjs')])
  )
    throw new Error('A different local Lighthouse tool registration already exists.');
  mcp.mcpServers = {
    ...mcp.mcpServers,
    lighthouse: {
      command: process.execPath,
      args: [path.join(home, 'lighthouse-mcp.cjs')],
    },
  };
  fs.writeFileSync(mcpFile, JSON.stringify(mcp, null, 2), { mode: 0o600 });
  run(process.execPath, [path.join(home, 'lighthouse-mcp.cjs'), 'install-hooks', '--project', home]);
  if (!fs.existsSync(path.join(home, 'SETUP.json')))
    writePrivate(path.join(home, 'SETUP.json'), { format: 1, completed: true });
  fs.unlinkSync(marker);
  return require('./doctor.cjs').doctor(home);
}
module.exports = { setup };
