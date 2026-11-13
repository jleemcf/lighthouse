'use strict';

function locate(ownership, board, sessionId, input) {
  const entry = ownership.session(board, sessionId);
  if (!entry || entry.revoked) ownership.refuse('registered operator session required', 409);
  const keys = ['machineId', 'homeId', 'targetId', 'targetInstallationId'];
  if (
    !input ||
    keys.some(key => !ownership.validId(input[key])) ||
    !/^[a-f0-9]{64}$/.test(input.routeHash || '') ||
    Object.keys(input).length !== keys.length + 1
  )
    ownership.refuse('opaque location identities and verified original route hash required', 400);
  keys.push('routeHash');
  if (entry.location && keys.some(key => entry.location[key] !== input[key]))
    ownership.refuse('session location is immutable; target migration is a separate owner decision', 409);
  entry.location = structuredClone(input);
  pin(ownership.ctx, board);
}

function pin(ctx, board) {
  if (!ctx || !(ctx.activation ? ctx.activation.active(board) : ctx.cfg.boards[board]?.recoveryEnabled === true))
    return;
  const owner = ctx.ownership.record(board);
  const holder = ctx.ownership.session(board, owner.holderSessionId);
  const location = holder?.location;
  for (const binding of [ctx.dispatchLedger?.record(board)?.targetBinding, ctx.store.handoffs?.bindings?.[board]]) {
    if (
      binding &&
      !binding.machineId &&
      holder?.installationId === binding.installationId &&
      location?.targetId === binding.id &&
      location.targetInstallationId === binding.installationId
    ) {
      binding.machineId = location.machineId;
      binding.homeId = location.homeId;
      binding.routeHash = location.routeHash;
    }
  }
}

function availability(service, board, who, binding) {
  if (binding?.freshness !== 'fresh') return 'unknown';
  const location = service.ownership.session(board, who?.sessionId)?.location;
  if (!location || !binding.machineId) return 'unknown';
  if (
    location.targetId !== binding.id ||
    location.targetInstallationId !== binding.installationId ||
    location.routeHash !== binding.routeHash
  )
    return 'target-mismatch';
  if (location.machineId !== binding.machineId) return 'different-machine';
  return location.homeId === binding.homeId ? 'same-home' : 'same-machine';
}

module.exports = { locate, availability, pin };
