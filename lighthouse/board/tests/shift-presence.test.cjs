"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

test("shift chip uses canonical presence: lost, legacy no signal, and off", () => {
  const root = path.join(__dirname, "../..");
  const source = ["server/shift-presence.js", "board/app/helpers.js", "board/app/messages.js"]
    .map(file => fs.readFileSync(path.join(root, file), "utf8"))
    .join("\n");
  const context = { unopenedAsks: () => [], state: { cards: [] } };
  vm.createContext(context);
  vm.runInContext(source, context);
  const old = new Date(Date.now() - 3600000).toISOString();
  context.board = { protocol: "tools", shift: { state: "on", since: old, lastSeen: old, heartbeat: { t: old } } };
  assert.match(vm.runInContext("presenceHtml('t', board)", context), /chip lost/);
  assert.ok(vm.runInContext("presenceHtml('t', board)", context).includes("lost</span>"));
  delete context.board.shift.heartbeat;
  assert.match(vm.runInContext("presenceHtml('t', board)", context), /on shift, no signal/);
  context.board.shift.state = "off";
  assert.match(vm.runInContext("presenceHtml('t', board)", context), /off shift/);
  const built = fs.readFileSync(path.join(root, "server/public/index.html"), "utf8");
  const presenceSource = fs
    .readFileSync(path.join(root, "server/shift-presence.js"), "utf8")
    .split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith("//"))
    .join("\n")
    .trim();
  assert.ok(built.includes(presenceSource));
});
