'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { merge } = require('../lighthouse/server/configuration');
function applyProfile(configPath, profilePath, dryRun = false) {
  const input = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  const output = merge(profile.server, input);
  // Explicit profile application is the opt-in. Runtime compatibility defaults never add a coordinator.
  for (const [board, principals] of Object.entries(profile.coordinatorGrants || {})) {
    if (!input.boards?.[board]) continue;
    const access = output.boards[board].access || (output.boards[board].access = {});
    for (const principal of principals) {
      const previous = access[principal];
      const roles = Array.isArray(previous) ? previous : previous ? [previous] : [];
      access[principal] = [...new Set([...roles, 'coordinator'])];
    }
  }
  const folder = path.dirname(configPath);
  const policyPath = path.resolve(folder, input.rulingsFile || 'profile-policies.json');
  let policy;
  if (profile.policy && (!input.rulingsFile || !fs.existsSync(policyPath))) {
    const exists = fs.existsSync(policyPath);
    const selected = fs.readFileSync(path.resolve(path.dirname(profilePath), profile.policy.file));
    const digest = require('node:crypto').createHash('sha256').update(selected).digest('hex');
    if (digest !== profile.policy.sha256) throw new Error('Profile policy digest does not match');
    if (exists && JSON.stringify(JSON.parse(fs.readFileSync(policyPath))) !== JSON.stringify(JSON.parse(selected)))
      throw new Error('Profile policy content does not match');
    if (!exists) {
      // Citations hash bytes. Retain the running release's CRLF/LF spelling of identical policy content.
      const current = path.join(folder, 'current', 'rulings.json');
      const running = fs.existsSync(current) ? current : path.join(folder, 'rulings.json');
      const bytes = fs.existsSync(running) ? fs.readFileSync(running) : null;
      policy = bytes && JSON.stringify(JSON.parse(bytes)) === JSON.stringify(JSON.parse(selected)) ? bytes : selected;
    }
    output.rulingsFile = path.relative(folder, policyPath).replaceAll('\\', '/');
  }
  const changes = [];
  const conflicts = [];
  const visible = field =>
    /^(profile|owner(Id|Name)|timeZone(Label)?|windowsTimeZone|defaultBoard|crm\.(board|needsOwnerKind))$/.test(
      field,
    ) || /^boards\.[^.]+\.(displayName|order)$/.test(field);
  function conflicting(defaults, explicit, prefix = '') {
    for (const [key, value] of Object.entries(defaults)) {
      if (!Object.hasOwn(explicit, key)) continue;
      const field = prefix ? prefix + '.' + key : key;
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        explicit[key] &&
        typeof explicit[key] === 'object'
      )
        conflicting(value, explicit[key], field);
      else if (JSON.stringify(value) !== JSON.stringify(explicit[key]))
        conflicts.push({ key: field, kept: visible(field) ? explicit[key] : '<redacted>' });
    }
  }
  conflicting(profile.server, input);
  function differences(before, after, prefix = '') {
    for (const [key, value] of Object.entries(after)) {
      const field = prefix ? prefix + '.' + key : key;
      if (JSON.stringify(before?.[key]) === JSON.stringify(value)) continue;
      if (value && typeof value === 'object' && !Array.isArray(value)) differences(before?.[key] || {}, value, field);
      else {
        changes.push({ key: field, value: visible(field) ? value : '<redacted>' });
      }
    }
  }
  differences(input, output);
  if (!dryRun && (changes.length || policy)) {
    let sequence = 1;
    while (fs.existsSync(configPath + '.pre-profile.' + sequence)) sequence++;
    fs.copyFileSync(configPath, configPath + '.pre-profile.' + sequence, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(configPath + '.pre-profile.' + sequence, 0o600);
    if (policy) fs.writeFileSync(policyPath, policy, { flag: 'wx', mode: 0o600 });
    const temporary = configPath + '.profile.' + require('node:crypto').randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify(output, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, configPath);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  return { dryRun, changed: changes.length > 0, policyCreated: !!policy, changes, conflicts };
}
module.exports = { applyProfile };
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const config = args[args.indexOf('--config') + 1];
    const profile = args[args.indexOf('--profile') + 1];
    if (!args.includes('--config') || !args.includes('--profile'))
      throw new Error('Usage: --config FILE --profile FILE [--dry-run]');
    console.log(JSON.stringify(applyProfile(path.resolve(config), path.resolve(profile), args.includes('--dry-run'))));
  } catch {
    console.error('Profile application failed; check paths, JSON and policy integrity. Values withheld.');
    process.exitCode = 1;
  }
}
