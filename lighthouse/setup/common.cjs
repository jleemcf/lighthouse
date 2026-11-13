'use strict';
// Setup accepts paths to private files, never secret arguments. Diagnostics contain fixed phrases only.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const privateFiles = require('../server/registry-files');

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) throw new Error('A prerequisite or installation command failed; output withheld.');
  return result.stdout.trim();
}
function read(file, protectedFile = false) {
  if (protectedFile) privateFiles.assertPrivate(file);
  if (!fs.lstatSync(file).isFile()) throw new Error('A regular input file is required.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function endpoint(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))
    )
  )
    throw new Error('Use HTTPS off loopback, without URL credentials, query or fragment.');
  return url.origin;
}
function directory(home, empty = false) {
  if (fs.existsSync(home)) {
    if (!fs.lstatSync(home).isDirectory() || fs.lstatSync(home).isSymbolicLink())
      throw new Error('Home must be a regular directory.');
    if (empty && fs.readdirSync(home).length)
      throw new Error('Existing home refused. Use the normal deploy or shift.sh update path.');
  } else fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  privateFiles.protect(home, true);
}
async function request(origin, route, credential, body) {
  const response = await fetch(new URL(route, endpoint(origin)), {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error('Board request refused; HTTP ' + response.status + '.');
  return response.json();
}
module.exports = { fs, path, run, read, endpoint, directory, request, ...privateFiles };
