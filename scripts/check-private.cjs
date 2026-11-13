'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { sharedFiles, exclusionReason } = require('./shared-files.cjs');
function patterns(terms, allowlist) {
  const allowed = new Set(allowlist.map(term => term.toLocaleLowerCase('en-US')));
  return [...new Set(terms.map(term => term.trim()).filter(Boolean))]
    .filter(term => !allowed.has(term.toLocaleLowerCase('en-US')))
    .map(term => {
      const escaped = term
        .normalize('NFKC')
        .replace(/\\/g, '/')
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/[\s\p{Pd}_/]+/gu, '[\\s\\p{Pd}_/]+');
      return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
    });
}

function violates(text, rules) {
  const normalized = text.normalize('NFKC').replace(/\\/g, '/');
  const identifiers = normalized
    .replace(/(data:image\/(?:png|jpeg|gif|webp);base64,)[A-Za-z\d+/=]+/gi, '$1')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2');
  const continued = identifiers.replace(/\r?\n[ \t]*(?:\/\/|#)[ \t]*/g, '\n');
  return rules.some(rule => rule.test(normalized) || rule.test(identifiers) || rule.test(continued));
}

function genericRules() {
  return [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{40,})\b/g,
    /\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.ts\.net\b/gi,
    /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g,
    /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g,
    new RegExp(
      '\\b[A-Z0-9._%+-]+@(?!(?:[A-Z0-9-]+\\.)*(?:example\\.(?:com|net|org)|invalid|example)' +
        '(?![A-Z0-9-]|\\.[A-Z0-9]))[A-Z0-9.-]+\\.[A-Z]{2,}\\b',
      'gi',
    ),
  ];
}

function locations(text, rules) {
  const normalized = text.normalize('NFKC').replace(/\\/g, '/');
  const identifiers = normalized
    .replace(/(data:image\/(?:png|jpeg|gif|webp);base64,)[A-Za-z\d+/=]+/gi, '$1')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2');
  const variants = [normalized, identifiers, identifiers.replace(/\r?\n[ \t]*(?:\/\/|#)[ \t]*/g, '\n')];
  const lines = new Set();
  for (const variant of variants)
    for (const rule of rules)
      for (const hit of variant.matchAll(
        new RegExp(rule.source, rule.flags.includes('g') ? rule.flags : rule.flags + 'g'),
      ))
        lines.add(variant.slice(0, hit.index).split('\n').length);
  return [...lines].sort((a, b) => a - b);
}

function publicFiles(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '.git') return [];
    const file = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error('Public symlinks are not supported');
    return entry.isDirectory() ? publicFiles(root, file + '/') : [file];
  });
}

function scan(root, options = {}) {
  const env = options.env || process.env;
  const dictionary = env.PRIVATE_TERMS_PATH ? fs.readFileSync(env.PRIVATE_TERMS_PATH, 'utf8') : env.PRIVATE_TERMS;
  if (dictionary && /[\u0000\uFFFD]/u.test(dictionary))
    throw new Error('The private dictionary must be valid UTF-8 text');
  const allowlist = JSON.parse(fs.readFileSync(path.join(__dirname, 'privacy-allowlist.json'), 'utf8'));
  const privateRules = dictionary?.trim() ? patterns(dictionary.split(/\r?\n/), allowlist) : [];
  if ((env.PRIVATE_TERMS_PATH || dictionary?.trim()) && !privateRules.length)
    throw new Error('The private dictionary has no active terms');
  const rules = [...genericRules(), ...privateRules];
  const safePath = file =>
    locations(file, rules).length
      ? '[path withheld ' + require('node:crypto').createHash('sha256').update(file).digest('hex').slice(0, 12) + ']'
      : file;
  const files = options.files || (options.publicTree ? publicFiles(root) : sharedFiles(root));
  const failures = [];
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(root, file));
    const pathHit = locations(file, rules).length > 0;
    const safe = safePath(file);
    const lines = locations(bytes.toString('utf8'), rules);
    if (pathHit || (options.publicTree && exclusionReason(file))) lines.unshift(1);
    for (const line of new Set(lines)) failures.push({ file: safe, line });
  }
  return {
    privateTerms: privateRules.length > 0,
    files: files.length,
    violations: failures,
    reportPaths: (options.reportPaths || []).map(safePath),
  };
}
function report(result) {
  for (const hit of result.violations) console.error(`${hit.file}:${hit.line}`);
  if (result.violations.length) process.exitCode = 1;
  else
    console.log('Privacy check passed (' + (result.privateTerms ? 'generic and private checks)' : 'generic checks)'));
}
module.exports = { patterns, violates, scan, locations, genericRules, report };
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--root' || !args[1])) throw new Error('Invalid arguments');
    report(scan(args.length ? path.resolve(args[1]) : path.resolve(__dirname, '..'), { publicTree: args.length > 0 }));
  } catch {
    console.error('Privacy check could not complete; check arguments, inventory and dictionary configuration');
    process.exitCode = 1;
  }
}
