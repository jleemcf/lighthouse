const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

test("staff cards show sending, failed retrying and failed stopped separately from done", () => {
  const context = { esc: value => String(value).replaceAll("<", "&lt;") };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/cards.js"), "utf8"), context);
  for (const state of ["asked", "working", "sending", "done"]) {
    context.card = { crm: { state } };
    assert.match(vm.runInContext("crmDeliveryHtml(card)", context), new RegExp("CRM answer: " + state));
  }
  for (const retrying of [true, false]) {
    context.card = { crm: { state: "failed", failure: { retrying } } };
    const html = vm.runInContext("crmDeliveryHtml(card)", context);
    assert.match(html, /badge red/);
    assert.match(html, retrying ? /failed: retrying/ : /failed: retries stopped/);
    assert.match(html, /role="status"/);
  }
  context.card = {};
  assert.equal(vm.runInContext("crmDeliveryHtml(card)", context), "");
});
