const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

test("the board keeps wake failures visible until acknowledgment, without rendering receiver configuration", () => {
  let content = "",
    writes = 0;
  const banner = {
    hidden: true,
    get textContent() {
      return content;
    },
    set textContent(value) {
      content = value;
      writes++;
    },
  };
  const state = {
    cards: [{ id: "t-inbox", title: "<Inbox>" }],
    doorbells: { inbox: { card: "t-inbox", revision: 7, status: "retrying" } },
  };
  const context = { state, document: { getElementById: () => banner } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app", "render.js"), "utf8"), context);
  vm.runInContext("renderDoorbells()", context);
  assert.equal(banner.hidden, false);
  assert.equal(banner.textContent, "<Inbox>: inbox wake retrying automatically (revision 7).");
  vm.runInContext("renderDoorbells()", context);
  assert.equal(writes, 1, "unchanged status must not repeat a live-region announcement");
  state.doorbells.inbox.status = "unconfigured";
  vm.runInContext("renderDoorbells()", context);
  assert.match(banner.textContent, /needs receiver configuration/);
  state.doorbells.inbox.status = "acknowledged";
  vm.runInContext("renderDoorbells()", context);
  assert.equal(banner.hidden, true);
  assert.equal(banner.textContent, "");
});

test("wake status and message banners share a vertical stack instead of overlapping", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "style", "home.css"), "utf8");
  assert.match(html, /<div class="banners">[^]*?id="banner"[^]*?id="doorbell-status"[^]*?<\/div>\s*<\/div>/);
  assert.match(css, /\.banners\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/);
  assert.doesNotMatch(css.match(/\.banner\s*\{([^}]*)\}/)[1], /position:\s*fixed/);
});

test("a failed wake-status render does not leave the board render locked", () => {
  const context = {
    state: { doorbells: {}, cards: [], view: null },
    document: { getElementById: () => null },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app", "render.js"), "utf8"), context);
  assert.throws(() => vm.runInContext("render()", context));
  assert.equal(vm.runInContext("rendering", context), false);
});
