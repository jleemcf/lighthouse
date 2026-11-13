'use strict';

function childRpc(child) {
  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  let failure = null;
  let closing = null;
  let closingTimer;
  const diagnostic = reason => {
    const detail = 'exit code: ' + child.exitCode + ', signal: ' + child.signalCode;
    const observed = child.exitCode !== null || child.signalCode !== null;
    const error = new Error('MCP child ' + reason + ' (' + detail + (observed ? '' : '; exit not observed') + ')');
    error.exitCode = child.exitCode;
    error.signalCode = child.signalCode;
    return error;
  };
  const fail = reason => {
    if (failure) return;
    failure = diagnostic(reason);
    clearTimeout(closingTimer);
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(failure);
    }
    pending.clear();
  };
  const pipeClosed = reason => {
    if (failure || closing) return;
    closing = reason;
    if (child.exitCode !== null || child.signalCode !== null) return fail(reason);
    closingTimer = setTimeout(() => fail(reason), 100);
  };
  child.once('exit', () => fail('exited'));
  child.once('close', () => fail('closed'));
  child.once('error', error => fail('process error: ' + error.message));
  for (const [name, stream] of [
    ['stdin', child.stdin],
    ['stdout', child.stdout],
  ]) {
    stream.once('error', error => pipeClosed(name + ' error: ' + error.message));
    stream.once('close', () => pipeClosed(name + ' closed'));
  }
  child.stdin.once('finish', () => pipeClosed('stdin finished'));
  child.stdout.once('end', () => pipeClosed('stdout ended'));
  child.stderr.resume();
  child.stdout.on('data', data => {
    buffer += data;
    let boundary;
    while ((boundary = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        fail('invalid JSON response: ' + error.message);
        return;
      }
      const call = pending.get(message.id);
      if (!call) continue;
      clearTimeout(call.timer);
      pending.delete(message.id);
      call.resolve(message);
    }
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (failure) return reject(failure);
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(diagnostic('response timed out: ' + method));
      }, 20000);
      pending.set(id, { resolve, reject, timer });
      if (closing) return;
      try {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', error => {
          if (error) pipeClosed('stdin error: ' + error.message);
        });
      } catch (error) {
        pipeClosed('stdin error: ' + error.message);
      }
    });
}

module.exports = { childRpc };
