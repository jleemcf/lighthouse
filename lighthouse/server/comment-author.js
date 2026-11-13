'use strict';
const { isOwnerName } = require('./configuration');
module.exports = (cfg, message) =>
  message.author ||
  (message.kind === 'staff' || message.via === 'crm'
    ? 'staff'
    : message.kind === 'notice' || message.kind === 'notice-sent'
      ? 'watch'
      : message.via === 'api'
        ? 'operator'
        : message.via === 'chat'
          ? 'owner'
          : isOwnerName(cfg, message.by)
            ? 'owner'
            : 'person');
