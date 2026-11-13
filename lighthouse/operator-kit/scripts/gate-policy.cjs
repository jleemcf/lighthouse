'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const flat = text => String(text).replace(/\s+/g, ' ').trim();
const inputOf = line => /^FM INPUT [^|]*\|\s*(.*?)\s+\[key input:[^\]]+\]\s*$/.exec(line)?.[1];
const hash = text =>
  crypto
    .createHash('md5')
    .update('firstmate:' + text)
    .digest('hex')
    .slice(0, 12);

function relayEvidence(home) {
  let ledger = '';
  let latest = '';
  try {
    ledger = fs.readFileSync(path.join(home, 'relay-ledger.tsv'), 'utf8');
  } catch {}
  try {
    latest = fs.readFileSync(path.join(home, 'relay-last.txt'), 'utf8').replace(/\r?\n+$/, '');
  } catch {}
  return ledger.split('\n').flatMap(line => {
    const [time, digest, target] = line.replace(/\r$/, '').split('\t');
    const at = Date.parse(time);
    if (target !== 'firstmate' || !/^[a-f0-9]{12}$/.test(digest) || !Number.isFinite(at)) return [];
    return [
      { id: time + ':' + digest, at, hash: digest, flat: latest && hash(latest) === digest ? flat(latest) : null },
    ];
  });
}

function ownRelay(line, evidence, consumed, now) {
  const input = inputOf(line);
  if (!input) return null;
  return (
    evidence.find(
      entry =>
        now >= entry.at &&
        now - entry.at <= 30 * 60000 &&
        !consumed[entry.id] &&
        (hash(input) === entry.hash || (entry.flat && flat(input) === entry.flat)),
    )?.id || null
  );
}

function quietRule(line, rules, relay) {
  const asking =
    '^FM WAITING\\b|\\basks you:|\\b(?:can|could|would) you\\b|\\bplease\\b|' +
    '\\b(?:waiting (?:on|for) you|still waiting|needs? you to|needs? your go-ahead|send me|package id)\\b|' +
    '\\bupload\\b.*\\bfor me\\b|\\byour (?:go(?!-)|call|word|decision|approval|answer)\\b';
  if (rules.instrument && rules.instrument.test(line))
    return { decision: 'wake', reason: 'an instrument about itself' };
  if (relay) return { decision: 'drop', reason: 'own relay echo', relay };
  if (new RegExp(asking, 'i').test(line)) return { decision: 'wake', reason: 'an ask from firstmate' };
  if (/^FM INPUT\b/.test(line)) return { decision: 'wake', reason: 'input without a proven own relay' };
  for (const rule of rules.quietDrop || []) if (rule.rx.test(line)) return { decision: 'drop', reason: rule.name };
  for (const rule of rules.digest || []) if (rule.rx.test(line)) return { decision: 'hold', reason: rule.name };
  return null;
}

function dangerText(line) {
  return line.replace(/\bquestion is answered\b/gi, '');
}

function patterns(table) {
  return Object.entries(table || {}).map(([name, pattern]) => ({ name, rx: new RegExp(pattern, 'i') }));
}

module.exports = { dangerText, ownRelay, patterns, quietRule, relayEvidence };
