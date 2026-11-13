"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("coordinator notices show the principal, distinct styling and an explicit non-owner label", () => {
  const context = {
    state: { cards: [], unfold: new Set() },
    esc: value => String(value).replaceAll("<", "&lt;"),
    fmt: value => String(value),
    whenHtml: () => "",
    isOwnerName: () => false,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/messages.js"), "utf8"), context);
  const html = context.msgHtml({
    id: "test",
    by: "coord<login>",
    author: "coordinator",
    kind: "notice",
    text: "Review the inbox.",
    handled: false,
  });
  assert.match(html, /class="msg coordinator"/);
  assert.match(html, /coord&lt;login>/);
  assert.match(html, /NOTICE &middot; coordinator, not the owner/);
  assert.match(html, /waiting for the operator/);
  assert.doesNotMatch(html, /class="msg owner"|data-act="prompt-send"/);
  const css = fs.readFileSync(path.join(__dirname, "../style/messages.css"), "utf8");
  assert.match(css, /\.msg\.coordinator\s*\{/);
});
