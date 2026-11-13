'use strict';

module.exports = function makeAttachments({ store, roleOn }) {
  function canReadAttachment(who, attachment, snapshot = store) {
    if (!who || !attachment) return false;
    if (attachment.steward) return who.via === 'page' && roleOn(who, attachment.board) >= 4;
    let referenced = false;
    for (const collection of [snapshot.comments, snapshot.cards]) {
      for (const record of Object.values(collection || {})) {
        if (
          !(record.attachments || []).some(
            reference => (typeof reference === 'string' ? reference : reference?.id) === attachment.id,
          )
        )
          continue;
        referenced = true;
        if (roleOn(who, record.board) >= 1) return true;
      }
    }
    return !referenced && attachment.by === who.name;
  }

  function attachmentError(ids, who, snapshot = store) {
    if (ids === undefined) return null;
    if (!Array.isArray(ids)) return 'attachments must be a list of uploaded attachment ids.';
    for (const identity of ids) {
      if (typeof identity !== 'string' || !Object.hasOwn(snapshot.attachments, identity))
        return (
          'Unknown attachment ' + JSON.stringify(identity) + '. Upload the file before posting; nothing was posted.'
        );
      if (!canReadAttachment(who, snapshot.attachments[identity], snapshot))
        return 'Attachment access denied. Reference a file you can read, or upload it yourself.';
    }
    return null;
  }

  return { canReadAttachment, attachmentError };
};
