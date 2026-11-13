"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function render(prompt) {
  const context = {
    state: { cards: [], drafts: {}, unfold: new Set(), canTalk: true },
    esc: value => String(value),
    fmt: value => String(value),
    fmtTime: value => String(value),
    picsHtml: () => "",
    whenHtml: () => "",
    isOwnerName: value => value === "owner",
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/messages.js"), "utf8"), context);
  return context.msgHtml({ id: "test-prompt", by: "operator", board: "t", text: "Exact words.", prompt });
}

test("offered alone has Send controls; final prompts have one plain state label", () => {
  const offered = render({ state: "offered", to: "firstmate" });
  assert.match(offered, /awaiting your decision/);
  assert.match(offered, /data-act="prompt-send"/);
  for (const state of ["declined", "superseded", "approved", "relayed"]) {
    const html = render({ state, to: "firstmate", approval: { via: "send" } });
    assert.doesNotMatch(html, /data-act="prompt-send"/);
    assert.equal((html.match(/class="decided"/g) || []).length, 1);
  }
});

test("approval is never called sent, and delivery shows firstmate receipt time with its approval basis", () => {
  for (const via of ["send", "yolo", "on-word", "authority"]) {
    const prompt = { to: "firstmate", approval: { via }, decidedAt: "APPROVAL-TIME" };
    const approved = render({ ...prompt, state: "approved" });
    assert.match(approved, /awaiting delivery/);
    assert.doesNotMatch(approved, /sent on your behalf|received by/);
    const relayed = render({ ...prompt, state: "relayed", relayedAt: "RECEIPT-TIME" });
    assert.match(relayed, /received by the firstmate/);
    assert.match(relayed, /RECEIPT-TIME/);
    assert.doesNotMatch(relayed, /APPROVAL-TIME|handled another way/);
    if (via === "on-word") assert.match(relayed, /on your word/);
    assert.match(render({ ...prompt, state: "approved", edited: true }), /, edited/);
    assert.match(render({ ...prompt, state: "relayed", edited: true }), /, edited/);
  }
});
