"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const page = require("./discovery-page.cjs");
const meta = () => ({
  enabled: true,
  signedIn: true,
  hostAdmin: true,
  principal: "captain",
  audit: [],
  grants: [],
  installations: [],
  boards: [{ id: "one", name: "First <board>", protocol: "tools", lifecycle: "active", members: { captain: "owner" } }],
});

test("ManagementScreensHaveLabeledFormsAndNoOwnerOnlyPrivilegeEscalation", () => {
  const browser = page();
  const input = meta();
  const html = browser.managementHtml(input);
  for (const action of ["create", "rename", "grant", "member", "preview"])
    assert.match(html, new RegExp('data-manage="' + action + '"'));
  assert.match(html, /First &lt;board&gt;/);
  assert.ok(html.includes('value="operator+coordinator"'));
  assert.ok(html.includes('value="owner+coordinator"'));
  assert.doesNotMatch(html, /First <board>/);
  input.hostAdmin = false;
  const owner = browser.managementHtml(input);
  assert.doesNotMatch(owner, /data-manage="(create|member)"/);
  assert.match(owner, /data-manage="grant"/);
  input.boards = [];
  input.hostAdmin = true;
  assert.match(browser.managementHtml(input), /Create your first board/);
  assert.match(browser.managementHtml({ signedIn: false }), /Administrator file/);
  const css = fs.readFileSync(path.join(__dirname, "../style/management.css"), "utf8");
  assert.match(css, /max-width: 720px/);
  assert.match(css, /min-width: 0/);
});

test("GrantPanelNeverCachesReplaysOrInsertsSecretsAsMarkup", () => {
  const browser = page();
  const handoff = { grant: "synthetic-once-only", scope: { boardId: "one" } };
  browser.displayGrantOnce(handoff);
  assert.ok(browser.elements.get("grantValue").value.includes(handoff.grant));
  assert.ok(!browser.elements.get("grantOnce").innerHTML.includes(handoff.grant));
  assert.ok(!JSON.stringify(browser.managementModel).includes(handoff.grant));
  assert.ok([...browser.storage.values()].every(value => !String(value).includes(handoff.grant)));
  browser.clearGrantOnce();
  assert.equal(browser.elements.get("grantValue").value, "");
  assert.equal(browser.elements.get("grantOnce").hidden, true);
  assert.equal(browser.elements.get("grantOnce").innerHTML, "");
});

test("ArchivePreviewRequiresFreshConfirmationAndExplainsPreservation", () => {
  const browser = page();
  browser.managementModel.meta = meta();
  browser.displayArchivePreview({
    id: "one",
    confirmation: "preview-digest",
    pending: { ownership: true, jobs: ["job"] },
  });
  const panel = browser.elements.get("archivePreview");
  assert.match(panel.innerHTML, /ownership: active; jobs: 1/);
  assert.match(panel.innerHTML, /Explicitly preserve unresolved work/);
  assert.equal(browser.managementModel.preview.confirmation, "preview-digest");
  browser.managementModel.meta.hostAdmin = false;
  browser.displayArchivePreview({ id: "one", pending: {} });
  assert.doesNotMatch(panel.innerHTML, /name="preserve"/);
});

test("CopyFailureClearsSecretAndExplainsReissue", async () => {
  const browser = page();
  browser.displayGrantOnce({ grant: "synthetic-copy-failure" });
  browser.navigator.clipboard = {
    async writeText() {
      assert.equal(browser.elements.get("grantValue").value, "");
      throw new Error("clipboard denied");
    },
  };
  await browser.managementClick({ dataset: { manage: "copy-grant" } });
  assert.match(browser.elements.get("managementFeedback").textContent, /Copy failed.*Revoke.*new one/);
  assert.equal(browser.elements.get("grantValue").value, "");
});
