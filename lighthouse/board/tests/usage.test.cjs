"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const cleanUsage = require("../../server/usage");

test("usage stays numeric and renders daily totals without private source keys", () => {
  const clean = cleanUsage({
    days: [
      {
        day: "2026-11-10",
        requests: 12,
        cacheRead: 700000,
        cacheWrite: -1,
        output: Infinity,
        avgPrompt: 900,
        turns: { fm_reply: 3, human: 1, PRIVATE: 7 },
        text: "PRIVATE",
      },
    ],
    context: { prompt: 900, window: 1000, path: "PRIVATE" },
  });
  assert.equal(clean.days[0].cacheWrite, 0);
  assert.equal(clean.days[0].output, 0);
  assert.ok(!JSON.stringify(clean).includes("PRIVATE"));
  const root = path.join(__dirname, "../..");
  const context = { state: { unfold: new Set() } };
  vm.createContext(context);
  vm.runInContext(
    ["helpers.js", "messages.js"].map(file => fs.readFileSync(path.join(root, "board/app", file), "utf8")).join("\n"),
    context,
  );
  context.board = { instruments: { usage: clean } };
  const html = vm.runInContext('usageHtml(board, "sample")', context);
  assert.match(html, /data-fold="usage:sample"/);
  context.state.unfold.add("usage:sample");
  assert.match(vm.runInContext('usageHtml(board, "sample")', context), /data-fold="usage:sample" open/);
  assert.match(html, /Daily usage \(UTC\).*2026-11-10.*12 API requests/);
  assert.match(html, /Cache read<\/dt><dd>700,000/);
  assert.match(html, /Average prompt<\/dt><dd>900/);
  assert.match(html, /FM reply 3 · typed here 1/);
  assert.match(html, /90% of the compaction window/);
  context.board = {};
  assert.equal(vm.runInContext("usageHtml(board)", context), "", "old boards need no usage field");
  assert.equal(cleanUsage({ days: "PRIVATE" }), null);
  assert.deepEqual(cleanUsage({ days: [{ day: "<script>PRIVATE</script>" }] }).days, []);
  const built = fs.readFileSync(path.join(root, "server/public/index.html"), "utf8");
  assert.ok(
    built.includes(fs.readFileSync(path.join(root, "board/app/messages.js"), "utf8").replace(/\r\n/g, "\n").trim()),
  );
  assert.ok(built.includes("h += usageHtml(b, id)"));
});
