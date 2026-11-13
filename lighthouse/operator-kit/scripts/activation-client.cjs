'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const storage = require('./dispatch-storage.cjs');
const version = 'handoff-activation-v1';
function pages(snapshot) {
  const parts = [];
  let page = { calls: [], relays: [] };
  let bytes = 0;
  for (const kind of ['calls', 'relays']) {
    for (const entry of snapshot[kind]) {
      const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
      if (size > 128000)
        throw new Error('journal entry exceeds the migration page limit; repair without discarding it');
      if (bytes + size > 128000 || page.calls.length + page.relays.length >= 1000) {
        parts.push(page);
        page = { calls: [], relays: [] };
        bytes = 0;
      }
      page[kind].push(entry);
      bytes += size;
    }
  }
  parts.push(page);
  const migration = { id: crypto.randomUUID(), hash: storage.hash(snapshot), parts: parts.length };
  return parts.map((part, index) => ({
    ...snapshot,
    ...part,
    migration: { ...migration, index },
  }));
}

async function prepare(session, request, board) {
  const { home, kit } = session.activation;
  const manifest = JSON.parse(fs.readFileSync(path.join(home, 'KIT-MANIFEST.json'), 'utf8'));
  const snapshot = storage.inventory(home, board);
  for (const page of pages(snapshot)) {
    const response = await request('POST', '/api/boards/' + encodeURIComponent(board) + '/activation', {
      action: 'inventory',
      operationId: crypto.randomUUID(),
      ...page,
    });
    if (response.status === 404) break;
    if (response.status !== 200)
      throw Object.assign(new Error('publish the migrated journal before attaching'), { status: response.status });
  }
  session.journalId = snapshot.journalId;
  return {
    kitVersion: version,
    journalVersion: 1,
    loadedMcp: kit.loaded,
    installedMcp: require('./kit-version.cjs').installed(home) === manifest.release ? manifest.mcpVersion : null,
  };
}

module.exports = { version, prepare, pages };
