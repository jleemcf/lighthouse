'use strict';
const sources = [
  'fm_input',
  'fm_task',
  'fm_reply',
  'fm_waiting',
  'fm_wake',
  'record_check',
  'sweep',
  'board',
  'steward',
  'instrument',
  'human',
  'other',
];
const count = value =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value))
    : 0;

module.exports = function cleanUsage(usage) {
  if (!usage || typeof usage !== 'object' || !Array.isArray(usage.days)) return null;
  const days = usage.days
    .filter(day => day && /^\d{4}-\d{2}-\d{2}$/.test(day.day))
    .slice(-7)
    .map(day => ({
      day: day.day,
      requests: count(day.requests),
      cacheRead: count(day.cacheRead),
      cacheWrite: count(day.cacheWrite),
      output: count(day.output),
      avgPrompt: count(day.avgPrompt),
      turns: Object.fromEntries(sources.map(source => [source, count(day.turns?.[source])])),
    }));
  return { days, context: { prompt: count(usage.context?.prompt), window: count(usage.context?.window) } };
};
