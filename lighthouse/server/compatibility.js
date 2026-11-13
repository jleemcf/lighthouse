'use strict';
function codec(cfg) {
  const options = cfg.stateCompatibility || {};
  const keys = options.keys || {};
  const reverse = Object.fromEntries(Object.entries(keys).map(([key, value]) => [value, key]));
  const legacyRole = options.ownerRole || 'owner';
  const legacyKind = cfg.crm?.needsOwnerKind || 'needs_owner';
  const legacyLogKind = options.ownerLogKind || 'OWNER';
  if (!Object.keys(keys).length && legacyRole === 'owner' && legacyKind === 'needs_owner' && legacyLogKind === 'OWNER')
    return { read: value => value, write: value => value, wire: value => value };
  function convert(value, direction, wire = false, field = '', message = false) {
    if (Array.isArray(value)) return value.map(item => convert(item, direction, wire, field));
    if (value && typeof value === 'object') {
      const result = {};
      const isMessage = typeof value.text === 'string' && (Object.hasOwn(value, 'by') || Object.hasOwn(value, 't'));
      for (const [key, item] of Object.entries(value)) {
        const mapped = (direction === 'read' ? reverse[key] : keys[key]) || key;
        const nextField = field === 'log' ? 'log.' + key : direction === 'read' ? mapped : key;
        result[mapped] = convert(item, direction, wire, nextField, isMessage || field === 'transcript');
        if (wire && mapped !== key) result[key] = result[mapped];
      }
      return result;
    }
    if (typeof value !== 'string') return value;
    const from = direction === 'read' ? legacyKind : 'needs_owner';
    const to = direction === 'read' ? 'needs_owner' : legacyKind;
    if (field === 'kind' && value === from) return to;
    if (field === 'log.kind' && value === (direction === 'read' ? legacyLogKind : 'OWNER'))
      return direction === 'read' || wire ? 'OWNER' : legacyLogKind;
    if (field === 'log.text' && value === from + ' sent to the CRM') return to + ' sent to the CRM';
    if ((message && ['author', 'role'].includes(field)) || field === 'transcriptLastRole') {
      if (direction === 'read' && value === legacyRole) return 'owner';
      if (direction === 'write' && value === 'owner') return legacyRole;
    }
    return value;
  }
  return {
    read: value => convert(value, 'read'),
    write: value => convert(value, 'write'),
    wire: value => convert(value, 'write', true),
  };
}
module.exports = { codec };
