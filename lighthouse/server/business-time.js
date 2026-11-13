'use strict';
const zone = cfg => cfg.timeZone || 'UTC';
function clock(cfg, iso) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone(cfg),
  });
}
function parts(cfg, milliseconds) {
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone: zone(cfg),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(new Date(milliseconds));
  const value = type => values.find(item => item.type === type)?.value;
  return {
    day: value('year') + '-' + value('month') + '-' + value('day'),
    sec: (Number(value('hour')) % 24) * 3600 + Number(value('minute')) * 60 + Number(value('second')),
  };
}
module.exports = { clock, parts };
