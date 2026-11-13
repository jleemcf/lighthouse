'use strict';
// One read-only presence rule for the page, conduct, reminders and jobs: on, lost, stale or off.
// The operator owns explicit on/off edges; tool heartbeat loss derives lost and a 12-hour lapse for the board to apply.
// Old tool clients and line clients keep their activity/instrument fallback; missing heartbeats do not end them.
const ShiftPresence = (() => {
  const HEARTBEAT_MS = 60000;
  const LOST_AFTER_MS = 3 * HEARTBEAT_MS;
  const LAPSE_AFTER_MS = 12 * 3600000;
  const milliseconds = time => Date.parse(time || '') || 0;
  const lastHeartbeat = board => Math.max(milliseconds(board.shift?.since), milliseconds(board.shift?.heartbeat?.t));
  function presence(board, protocol, nowMs = Date.now()) {
    const shift = board?.shift || {};
    if (shift.state !== 'on') return { p: 'off' };
    if (protocol === 'tools' && board?.ownership?.enforced) {
      const lostAt = board.ownership.leaseUntil;
      if (nowMs >= lostAt + LAPSE_AFTER_MS) return { p: 'off', lapsedAt: lostAt + LAPSE_AFTER_MS };
      return nowMs >= lostAt ? { p: 'lost', lostAt } : { p: 'on' };
    }
    // A new shift fences off an old session's heartbeat, even before the first heartbeat of this shift arrives.
    if (protocol === 'tools' && shift.heartbeat?.t) {
      const lostAt = lastHeartbeat(board) + LOST_AFTER_MS;
      if (nowMs >= lostAt + LAPSE_AFTER_MS) return { p: 'off', lapsedAt: lostAt + LAPSE_AFTER_MS };
      return nowMs >= lostAt ? { p: 'lost', lostAt } : { p: 'on' };
    }
    // Live instruments distinguish a quiet legacy operator from a stale one without changing its explicit shift.
    const staleMin = typeof shift.staleAfterMin === 'number' && shift.staleAfterMin > 0 ? shift.staleAfterMin : 30;
    if (nowMs - milliseconds(shift.lastSeen) < staleMin * 60000) return { p: 'on' };
    return nowMs - milliseconds(board?.instruments?.t) < 5 * 60000
      ? { p: 'on', quiet: shift.lastSeen || 'never' }
      : { p: 'stale' };
  }
  // Stale legacy activity still owns the shift; a lost heartbeat session does not count as an available operator.
  const active = (board, protocol, nowMs) => ['on', 'stale'].includes(presence(board, protocol, nowMs).p);
  return { HEARTBEAT_MS, LOST_AFTER_MS, LAPSE_AFTER_MS, presence, active };
})();
if (typeof module !== 'undefined') module.exports = ShiftPresence;
