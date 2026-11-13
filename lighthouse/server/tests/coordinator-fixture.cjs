'use strict';
const { cardFixture } = require('./card-fixture');

async function noticeFixture(context) {
  const access = {
    owner: 'owner',
    operator: 'operator',
    watch: 'watch',
    coordinator: 'coordinator',
    dual: ['operator', 'coordinator'],
    'chief developer': 'operator',
  };
  const fixture = await cardFixture(context, undefined, {
    tokens: {
      CAPTAIN: { name: 'owner', via: 'page' },
      OPS: { name: 'operator', via: 'api', mode: 'tools' },
      LEGACY: { name: 'operator', via: 'api' },
      COLLECTOR: { name: 'operator', via: 'api', mode: 'collector' },
      WATCH: { name: 'watch', via: 'api' },
      COORD: { name: 'coordinator', via: 'api' },
      COORDPAGE: { name: 'coordinator', via: 'page' },
      COORD2: { name: 'coordinator', via: 'api' },
      DUAL: { name: 'dual', via: 'api' },
      CHIEF: { name: 'chief developer', via: 'api' },
    },
    boards: {
      t: { name: 'Test', protocol: 'tools', access },
      lines: { name: 'Lines', access },
      other: { name: 'Other', access: { owner: 'owner', coordinator: 'operator' } },
    },
  });
  const comments = async (board = 't') =>
    (await fixture.request('GET', '/api/comments?board=' + board, null, 'CAPTAIN')).body.comments;
  const snapshot = async () => (await fixture.request('GET', '/api/state', null, 'CAPTAIN')).body;
  const notice = (body = {}, token = 'COORD') =>
    fixture.request(
      'POST',
      '/api/comments',
      { board: 't', text: 'Review existing work.', kind: 'notice', ...body },
      token,
    );
  return { ...fixture, comments, snapshot, notice };
}
module.exports = { noticeFixture };
