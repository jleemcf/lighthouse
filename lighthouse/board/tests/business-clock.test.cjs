"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("scene clock refreshes when configuration arrives after its neutral first render", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../scene/core.js"), "utf8");
  const clock = source.slice(source.indexOf("let etFmt ="), source.indexOf("function season("));
  const facts = { timeZone: "UTC" };
  const fixed = Date.parse("2026-01-15T12:00:00Z");
  class FixedDate extends Date {
    static now() {
      return fixed;
    }
  }
  const context = vm.createContext({ facts, Date: FixedDate });
  vm.runInContext(clock + "\nglobalThis.readClock = etHour;", context);
  assert.equal(context.readClock(), 12);
  facts.timeZone = "Europe/Paris";
  assert.equal(context.readClock(), 13);
  facts.timeZone = "Asia/Tokyo";
  assert.equal(context.readClock(), 21);
});
