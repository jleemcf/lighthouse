"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const page = require("./discovery-page.cjs");
test("HandoffStatusIsEscapedOwnerOnlyAndFeatureOffIsEmpty", () => {
  const browser = page();
  assert.equal(browser.handoffHtml("one", {}), "");
  const handoff = {
    enabled: true,
    canManage: false,
    ownership: { holderSessionId: "holder<script>", phase: "draining" },
    since: "2026-01-01T00:00:00Z",
    checkpoint: { createdAt: Date.now(), completeness: ["helpers"] },
    transfer: { status: "sealed", heldTargets: ["firstmate"], seal: { degraded: true, blockers: ["unknown<work>"] } },
  };
  const html = browser.handoffHtml("one", { handoff });
  assert.match(html, /holder&lt;script&gt;/);
  assert.match(html, /unknown&lt;work&gt;/);
  assert.match(html, /degraded/);
  assert.doesNotMatch(html, /data-handoff=/);
  handoff.canManage = true;
  const owner = browser.handoffHtml("one", { handoff });
  assert.match(owner, /data-handoff="accept"/);
  assert.match(owner, /data-handoff="cancel"/);
  assert.doesNotMatch(owner, /data-handoff="prepare"/);
  handoff.ownership.phase = "working";
  assert.match(browser.handoffHtml("one", { handoff }), /data-handoff="prepare"/);
  assert.doesNotMatch(browser.handoffHtml("one", { handoff }), /data-handoff="recover"/);
  handoff.recoveryAvailable = true;
  handoff.presence = "lost";
  handoff.targetAvailability = "different-machine";
  handoff.transfer.recovery = { warnings: ["Old disk unavailable<script>"] };
  const lost = browser.handoffHtml("one", { handoff });
  assert.match(lost, /data-handoff="recover"/);
  assert.match(lost, /Presence: lost \(not an ownership change\)/);
  assert.match(lost, /Holder: holder&lt;script&gt;/);
  assert.match(lost, /Old disk unavailable&lt;script&gt;/);
});
