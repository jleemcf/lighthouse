'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

async function refreshEpoch(session, request, board, saveEpoch) {
  const result = await request('GET', '/api/boards/' + encodeURIComponent(board) + '/handoff');
  const owner = result.body?.ownership;
  if (
    result.status === 200 &&
    result.body?.enabled &&
    owner?.holderSessionId === session.sessionId &&
    owner.epoch > session.epoch
  ) {
    saveEpoch(owner.epoch);
    return true;
  }
  return false;
}
function client({ session, request, board, inventory, saveEpoch, checkpointInput, rules = '' }) {
  const endpoint = '/api/boards/' + encodeURIComponent(board) + '/handoff';
  async function supported() {
    if (!session) return false;
    const result = await request('GET', endpoint);
    return result.status === 200 && result.body?.enabled === true;
  }
  async function send(input) {
    const result = await request('POST', endpoint, input);
    if (result.status !== 200 || !result.body?.ok)
      return {
        isError: true,
        text:
          (result.body?.error || 'Handoff unavailable; retry the same operationId.') +
          '\nOperation: ' +
          input.operationId,
      };
    const body = result.body;
    if (input.action === 'accept' && body.epoch) saveEpoch(body.epoch);
    return { text: JSON.stringify(body, null, 2) };
  }
  async function call(tool, args = {}) {
    if (!session) return { isError: true, text: 'Explicit logical session credentials required for handoff.' };
    if (tool === 'board_pickup' && args.action === 'status') {
      const result = await request('GET', endpoint);
      const owner = result.body?.ownership;
      if (result.body?.enabled && owner?.holderSessionId === session.sessionId && owner.epoch > session.epoch)
        saveEpoch(owner.epoch);
      return { isError: result.status !== 200, text: JSON.stringify(result.body) };
    }
    if (tool === 'board_transfer' && !Number.isSafeInteger(args.expectedEpoch))
      return {
        isError: true,
        text: 'Supply expectedEpoch explicitly and retain it for every retry of this operation.',
      };
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(args.operationId || ''))
      return { isError: true, text: 'Supply a stable operationId and reuse it after a lost answer.' };
    let input = { ...args, action: tool === 'board_checkpoint' ? 'checkpoint' : args.action };
    if (tool === 'board_checkpoint') {
      const build = () => {
        const local = inventory();
        return {
          ...input,
          checkpoint: { ...args.checkpoint, version: 1, ...local },
        };
      };
      try {
        input = checkpointInput ? checkpointInput(input, build) : build();
      } catch (error) {
        return { isError: true, text: error.message };
      }
    }
    return send(input);
  }
  async function compact(args = {}, legacy) {
    const state = await request('GET', endpoint);
    if (!state.body?.enabled) return null;
    if (args.action === 'compacted') {
      const id = state.body.transfer?.id;
      if (!id || state.body.ownership.phase !== 'pickup')
        return { text: 'No pending checkpoint pickup. Read board_status(detail: "full").' };
      const result = await call('board_pickup', { action: 'read', transferId: id, operationId: crypto.randomUUID() });
      if (result.isError) return result;
      const pickup = JSON.parse(result.text).live?.board?.pickup;
      return {
        text: [result.text, '', 'RULES', rules, '', 'YOUR PICKUP NOTE', pickup?.note || 'None.'].join(
          String.fromCharCode(10),
        ),
      };
    }
    if (legacy) {
      const result = await legacy();
      if (result.isError) return result;
    }
    const fresh = value => ({ freshness: 'fresh', observedAt: Date.now(), value });
    const missing = value => ({ freshness: 'missing', observedAt: Date.now(), value });
    const transferId = crypto.randomUUID();
    const previous = state.body.checkpointRecord || {};
    const context = Object.fromEntries(
      ['goal', 'nextStep', 'decisions', 'constraints', 'commitments', 'helpers', 'cursors']
        .filter(field => previous[field])
        .map(field => [field, previous[field]]),
    );
    const original = state.body.targetBinding || {
      id: null,
      installationId: null,
      freshness: 'missing',
    };
    return call('board_checkpoint', {
      operationId: 'compact-' + transferId,
      transferId,
      reason: 'compaction',
      checkpoint: {
        version: 1,
        goal: missing(args.note || ''),
        nextStep: missing('Read live board state'),
        decisions: missing([]),
        constraints: missing([]),
        commitments: missing([]),
        helpers: missing([]),
        cursors: missing([]),
        queue: fresh([]),
        relays: fresh([]),
        ...context,
        ...(args.note?.trim() ? { goal: fresh(args.note.trim()) } : {}),
        targetBinding: original,
      },
    });
  }
  async function intercept(tool, args, legacy) {
    if (tool === 'board_shift' && args?.dry_run) return null;
    if (tools.some(entry => entry.name === tool)) return call(tool, args);
    if (session && tool === 'board_shift' && ['compacting', 'compacted'].includes(args?.action) && (await supported()))
      return compact(args, legacy);
    return null;
  }
  async function paused() {
    if (!session) return false;
    const result = await request('GET', endpoint);
    return result.status === 200 && result.body?.enabled === true && result.body.ownership?.phase !== 'working';
  }
  return { call, compact, supported, intercept, paused };
}
function fromHome({ session, request, board, home }) {
  function checkpointInput(input, build) {
    const key = crypto
      .createHash('sha256')
      .update(JSON.stringify([board, session.sessionId, input.operationId]))
      .digest('hex');
    const directory = path.join(home, 'handoff-checkpoints');
    const file = path.join(directory, key + '.json');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    let reused = fs.existsSync(file);
    if (!reused) {
      const temporary = file + '.' + crypto.randomUUID() + '.tmp';
      try {
        const descriptor = fs.openSync(temporary, 'wx', 0o600);
        try {
          fs.writeFileSync(descriptor, JSON.stringify({ args: input, input: build() }));
          fs.fsyncSync(descriptor);
        } finally {
          fs.closeSync(descriptor);
        }
        try {
          fs.linkSync(temporary, file);
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          reused = true;
        }
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    }
    if (process.platform !== 'win32') {
      const descriptor = fs.openSync(directory, 'r');
      try {
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    }
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!require('node:util').isDeepStrictEqual(saved.args, input))
      throw new Error('Checkpoint operationId reused with different input; retain the original arguments.');
    if (reused && !['compaction', 'reconnect'].includes(input.reason)) {
      const effects = value =>
        ['queue', 'relays'].map(field =>
          value.checkpoint[field].value.map(entry =>
            ['id', 'state', 'hash', 'ticket', 'target'].map(key => entry[key] ?? null),
          ),
        );
      if (!require('node:util').isDeepStrictEqual(effects(saved.input), effects(build())))
        throw new Error('Checkpoint journals changed; write a new checkpoint with a new operationId before sealing.');
    }
    return saved.input;
  }
  function read(name, convert) {
    try {
      const file = path.join(home, name);
      const items = fs.existsSync(file)
        ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
        : [];
      return {
        freshness: fs.existsSync(path.join(home, 'calls-outbox.jsonl.lock')) ? 'stale' : 'fresh',
        observedAt: Date.now(),
        value: items.map(convert),
      };
    } catch {
      return { freshness: 'missing', observedAt: Date.now(), value: [] };
    }
  }
  return client({
    session,
    request,
    board,
    checkpointInput,
    inventory: () => ({
      ...(process.env.LH_HELPER_LEASE || fs.existsSync(path.join(home, 'helper-generations'))
        ? {
            helpers: {
              freshness: 'fresh',
              observedAt: Date.now(),
              value: require('./helper-generation.cjs').references(home, board),
            },
            cursors: {
              freshness: 'fresh',
              observedAt: Date.now(),
              value: require('./helper-cursors.cjs').references(home, board),
            },
          }
        : {}),
      queue: read('calls-outbox.jsonl', item => ({
        id: item.id,
        state: 'unacknowledged',
        hash: crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex'),
        originSessionId: item.originSessionId || null,
        originEpoch: item.originEpoch || null,
      })),
      relays: read('relay-results.jsonl', item => ({
        id: item.id,
        state: item.state || 'unknown',
        ticket: item.intent?.ticket || item.args?.ticket || null,
        target: item.intent?.to || null,
      })),
    }),
    saveEpoch: epoch => require('./session-identity.cjs').adoptEpoch(session, epoch),
    rules: fs.existsSync(path.join(home, 'toolcalls-spec.json'))
      ? JSON.parse(fs.readFileSync(path.join(home, 'toolcalls-spec.json'), 'utf8')).instructions || ''
      : '',
  });
}
const tools = [
  {
    name: 'board_checkpoint',
    description:
      'Write a version 1 checkpoint during draining or before compaction. ' +
      'References and explicit freshness only; no secrets. ' +
      'Local queue and relay references are inventoried automatically. The server pins the original firstmate ' +
      'target to the authenticated installation; retain targetBinding from the prior checkpoint, never migrate it.',
    inputSchema: {
      type: 'object',
      required: ['operationId', 'transferId', 'checkpoint'],
      properties: {
        operationId: { type: 'string' },
        transferId: { type: 'string' },
        reason: { enum: ['handoff', 'compaction', 'reconnect'] },
        checkpoint: { type: 'object' },
      },
    },
  },
  {
    name: 'board_transfer',
    description:
      'Prepare, seal, accept or cancel a tools-only handoff. Reuse operationId ' +
      'after a lost answer. Accept requires a sealed readId; it retains the shift and leaves pickup pending.',
    inputSchema: {
      type: 'object',
      required: ['operationId', 'transferId', 'action', 'expectedEpoch'],
      properties: {
        operationId: { type: 'string' },
        transferId: { type: 'string' },
        action: { enum: ['prepare', 'seal', 'accept', 'cancel'] },
        expectedEpoch: { type: 'integer' },
        successorSessionId: { type: 'string' },
        readId: { type: 'string' },
        degraded: { type: 'boolean' },
        pendingDigest: { type: 'string' },
      },
    },
  },
  {
    name: 'board_pickup',
    description:
      'Read status or the sealed checkpoint, full live records and every retained ' +
      'change; acknowledge that exact revision with pickup before acting. ' +
      'Never blindly acknowledge an unread revision.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { enum: ['status', 'read', 'pickup'] },
        operationId: { type: 'string' },
        transferId: { type: 'string' },
        readId: { type: 'string' },
        revision: { type: 'integer' },
      },
    },
  },
];
module.exports = { client, tools, fromHome, refreshEpoch };
