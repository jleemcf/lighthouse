"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const discoveryPage = require("./discovery-page.cjs");

const names = page => Array.from(page.boardIds());
const board = name => ({ name, shift: { state: "on", lastSeen: new Date().toISOString() } });

test("page tabs, Home, counts and feed requests discover zero, one and many authorized boards", async () => {
  for (const ids of [[], ["solo"], ["zulu", "alpha", "delta", "echo", "foxtrot"]]) {
    const page = discoveryPage();
    assert.deepEqual(names(page), []);
    const boards = Object.fromEntries(ids.map(id => [id, board("Label " + id)]));
    const cards = Object.fromEntries(
      ids.map(id => [
        id,
        {
          id,
          board: id,
          status: "waiting",
          decisions: [{ id: "ask-" + id, ask: "Question " + id }],
        },
      ]),
    );
    await page.load({ boards, cards });
    assert.deepEqual(names(page), ids);
    page.state.feed = true;
    page.render();
    const tabs = page.elements.get("tabs").html;
    const html = page.elements.get("app").html;
    assert.equal((tabs.match(/role="tab"/g) || []).length, ids.length + 1);
    assert.equal((tabs.match(/class="count"/g) || []).length, ids.length);
    assert.equal((html.match(/class="fcol"/g) || []).length, ids.length);
    let previous = -1;
    for (const id of ids) {
      const position = tabs.indexOf("Label " + id);
      assert.ok(position > previous);
      previous = position;
      assert.ok(html.includes('aria-label="Label ' + id + ': the conversation"'));
    }
    await page.loadFeed();
    assert.deepEqual(
      page.requests.filter(url => url.endsWith("/transcript")),
      ids.map(id => "/api/boards/" + id + "/transcript"),
    );
    assert.equal(page.window.LighthouseScene.facts.anyUnopened(), ids.length);
  }
});

test("saved arbitrary boards survive startup until discovery; missing saved boards return Home", async () => {
  const page = discoveryPage("custom");
  assert.equal(page.state.view, "custom");
  page.render();
  assert.deepEqual(page.requests, [], "startup must not request an unverified saved board");
  await page.load({ boards: { custom: board("Custom") } });
  assert.equal(page.state.view, "custom");
  await page.load({ boards: { other: board("Other") } });
  assert.equal(page.state.view, null);
  assert.equal(page.storage.get("lh.view"), "null");
  const missing = discoveryPage("removed");
  await missing.load({ boards: {} });
  assert.equal(missing.state.view, null);
});

test("Home stays distinct from boards named home and null, including saved board views", async () => {
  const boards = { home: board("Local home"), null: board("Null board") };
  const page = discoveryPage();
  await page.load({ boards });
  page.render();
  assert.deepEqual(
    page.requests.filter(url => url.includes("general=true")),
    [],
  );
  const tabs = page.tabsHtml();
  const ids = Array.from(tabs.matchAll(/ id="([^"]+)"/g), match => match[1]);
  assert.equal(new Set(ids).size, 3);
  assert.equal((page.elements.get("app").html.match(/class="view(?: home)? active"/g) || []).length, 1);
  page.setView("home");
  assert.equal(page.window.LighthouseScene.facts.isHome(), false);
  assert.match(page.elements.get("app").html, /class="view active" id="board-home"/);
  assert.equal(page.storage.get("lh.view"), JSON.stringify("home"));
  const restored = discoveryPage(page.storage);
  await restored.load({ boards });
  restored.render();
  assert.equal(restored.state.view, "home");
  assert.equal(restored.window.LighthouseScene.facts.isHome(), false);
  restored.setView(null);
  assert.equal(restored.window.LighthouseScene.facts.isHome(), true);
  assert.equal((restored.tabsHtml().match(/aria-selected="true"/g) || []).length, 1);
  assert.equal(restored.storage.get("lh.view"), "null");
  const home = discoveryPage(restored.storage);
  await home.load({ boards });
  home.render();
  assert.equal(home.window.LighthouseScene.facts.isHome(), true);
  assert.deepEqual(
    home.requests.filter(url => url.includes("general=true")),
    [],
  );
  home.setView("null");
  assert.equal(home.window.LighthouseScene.facts.isHome(), false);
  assert.match(home.elements.get("app").html, /class="view active" id="board-null"/);
});

test("renames, display labels and explicit order reach every page label and the existing scene getter", async () => {
  const page = discoveryPage();
  const facts = page.window.LighthouseScene.facts;
  await page.load({ boards: { alpha: board("Old alpha"), beta: board("Beta") } });
  assert.deepEqual(Array.from(facts.boards), ["alpha", "beta"]);
  await page.load({
    boards: {
      alpha: { ...board("Renamed alpha"), displayName: "Short <alpha>", order: 1 },
      beta: { ...board("Beta"), order: 0 },
      gamma: { ...board("Gamma"), order: 2 },
    },
  });
  page.state.feed = true;
  page.render();
  assert.deepEqual(Array.from(facts.boards), ["beta", "alpha", "gamma"]);
  assert.equal(facts.label("alpha"), "Short <alpha>");
  assert.match(page.tabsHtml(), /Short &lt;alpha&gt;/);
  assert.match(page.homeHtml(), /Short &lt;alpha&gt;/);
  assert.doesNotMatch(page.elements.get("app").html, /Old alpha/);
  assert.match(page.elements.get("app").html, /Renamed alpha/);
});

test("removed boards cannot leak through cached globals, notification choices, counts or feed columns", async () => {
  const page = discoveryPage("hidden");
  await page.load({
    boards: { hidden: board("Hidden label"), visible: board("Visible label") },
    cards: {
      secret: { id: "secret", board: "hidden", status: "waiting", decisions: [{ id: "ask", ask: "Secret" }] },
    },
  });
  page.state.feed = true;
  page.state.panel = "secret";
  page.state.newTask = "hidden";
  page.state.talkBoard = "hidden";
  page.state.general = [{ text: "Hidden conversation" }];
  page.state.transcript = "hidden";
  page.state.tx = [{ text: "Hidden transcript" }];
  page.state.letter = { from: "visible", text: "A letter mentioning Hidden label" };
  page.state.demo.alarm = "hidden";
  page.state.globals = [{ id: "global", copies: [{ board: "hidden" }, { board: "visible" }] }];
  page.state.notify.boards = ["hidden", "visible"];
  await page.load({ boards: { visible: board("Visible label") } });
  page.render();
  assert.deepEqual(names(page), ["visible"]);
  assert.doesNotMatch(page.elements.get("app").html, /Hidden label|Hidden conversation|Secret|secret|fcol-hidden/);
  assert.doesNotMatch(page.deviceHtml({ id: "device", boards: {}, on: true }), /hidden/);
  assert.equal(page.window.LighthouseScene.facts.anyUnopened(), 0);
  assert.equal(page.state.panel, null);
  assert.equal(page.state.newTask, null);
  assert.equal(page.state.talkBoard, null);
  assert.equal(page.state.general.length, 0);
  assert.equal(page.state.transcript, null);
  assert.equal(page.state.tx.length, 0);
  assert.equal(page.state.letter, null);
  assert.equal(page.state.demo.alarm, false);
  await page.loadFeed();
  assert.deepEqual(
    page.requests.filter(url => url.endsWith("/transcript")),
    ["/api/boards/visible/transcript"],
  );
});

test("removed boards discard late transcript responses instead of restoring hidden feed data", async () => {
  const page = discoveryPage();
  await page.load({ boards: { hidden: board("Hidden"), visible: board("Visible") } });
  let finish;
  page.responses.set(
    "/api/boards/hidden/transcript",
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  const feed = page.data.feed("hidden");
  const transcript = page.data.transcript("hidden");
  await page.load({ boards: { visible: board("Visible") } });
  finish({ entries: [{ text: "Hidden conversation" }] });
  await Promise.all([feed, transcript]);
  assert.equal(page.state.feedTx.hidden, undefined);
  assert.equal(page.state.txBoard, null);
  assert.equal(page.state.tx.length, 0);
});

test("scene follows additions, renames, removals and zero boards without reattaching or a reload", async () => {
  const page = discoveryPage("home", true);
  const scene = page.window.LighthouseScene;
  await page.load({ boards: { alpha: board("Alpha"), beta: board("Beta") } });
  page.window.sceneProbe.drawScene(1000);
  assert.deepEqual(Object.keys(scene.stats().keepers), ["alpha", "beta"]);
  assert.equal(page.window.sceneProbe.operatorColor("alpha"), "#F2A93B");
  assert.equal(page.window.sceneProbe.operatorColor("beta"), "#6FB1FF");
  await page.load({ boards: { gamma: board("Gamma"), beta: board("Renamed beta") } });
  names(page).forEach((id, index) => {
    Object.assign(page.window.sceneProbe.keeper(id, index), {
      place: "ground",
      act: "rest",
      phase: null,
      until: Infinity,
    });
  });
  page.labels.length = 0;
  page.window.sceneProbe.drawScene(2000);
  const keepers = scene.stats().keepers;
  assert.deepEqual(Object.keys(keepers).sort(), ["beta", "gamma"]);
  assert.ok(page.labels.includes("RENAMED BETA"));
  assert.ok(page.labels.includes("GAMMA"));
  assert.ok(!page.labels.includes("ALPHA"));
  await page.load({ boards: {} });
  page.window.sceneProbe.drawScene(3000);
  assert.deepEqual(Object.keys(scene.stats().keepers), []);
});

test("page owner checks honor configured aliases without granting the neutral owner identity", async () => {
  const page = discoveryPage();
  await page.load({ ownerId: "captain-42", ownerAliases: ["old-captain"], boards: {} });
  assert.deepEqual(Array.from(page.state.ownerAliases), ["old-captain"]);
  const source = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../app/state.js"), "utf8");
  const check = source.slice(source.indexOf("const isOwnerName ="));
  const context = require("node:vm").createContext({ state: page.state });
  const matches = require("node:vm").runInContext(check + "\nisOwnerName", context);
  assert.ok(matches("captain-42"));
  assert.ok(matches("old-captain"));
  assert.equal(matches("owner"), false);
});

test("semantic owner transcript roles render correctly with a custom owner identity", async () => {
  for (const ownerId of ["owner", "captain-42"]) {
    const page = discoveryPage();
    await page.load({ ownerId, ownerName: "Captain Example", boards: { work: board("Work") } });
    const entry = { role: "owner", by: ownerId, text: "Proceed", t: "2026-01-01T00:00:00Z" };
    const html = page.txHtml(entry, "work", false);
    assert.match(html, /class="msg tx owner"/);
    assert.match(html, /Captain Example/);
    assert.doesNotMatch(page.txHtml({ ...entry, role: "operator" }, "work", false), /class="msg tx owner"/);
  }
});
