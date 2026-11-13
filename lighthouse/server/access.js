'use strict';
// Board memberships can add coordinator without replacing an existing operator role.
// Installation credentials remain capped to their enrolled role; a grant never widens another login.
const ranks = { viewer: 1, commenter: 2, operator: 3, owner: 4, watch: 1, coordinator: 1 };
const rolesOf = value => (Array.isArray(value) ? value : value ? [value] : []);
const hasRole = (value, role) => rolesOf(value).includes(role);
const rank = value => Math.max(0, ...rolesOf(value).map(role => (Object.hasOwn(ranks, role) ? ranks[role] : 0)));
const valid = value => rolesOf(value).length > 0 && rolesOf(value).every(role => Object.hasOwn(ranks, role));
module.exports = { ranks, rolesOf, hasRole, rank, valid };
