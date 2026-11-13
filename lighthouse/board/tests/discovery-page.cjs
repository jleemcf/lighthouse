"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sceneSource = require("./scene-source.cjs");
const boardRoot = path.join(__dirname, "..");

module.exports = function discoveryPage(saved = "home", realScene = false) {
  const storage = new Map(saved instanceof Map ? saved : [["lh.tab", saved]]),
    elements = new Map(),
    requests = [],
    responses = new Map(),
    labels = [];
  const gradient = { addColorStop() {} };
  const pixels = (left, top, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) });
  const ink = new Proxy(
    {
      fillText: text => labels.push(text),
      getImageData: pixels,
      createImageData: (width, height) => pixels(0, 0, width, height),
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
    },
    { get: (target, key) => target[key] || (() => {}) },
  );
  const element = id => ({
    id,
    dataset: {},
    style: {},
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {},
    replaceChildren() {
      this.innerHTML = "";
    },
    scrollIntoView() {},
    getContext: () => ink,
    querySelector: () => null,
  });
  const document = {
    visibilityState: "visible",
    documentElement: element("html"),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => element(""),
    addEventListener() {},
  };
  let snapshot = {};
  const window = {
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    LighthouseScene: {
      attach(facts) {
        this.facts = facts;
      },
      syncBoards() {},
      start() {},
      setLite() {},
    },
  };
  const context = vm.createContext({
    window,
    document,
    navigator: { userAgent: "test", platform: "test" },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    location: { href: "http://localhost/", search: "", pathname: "/", hash: "" },
    history: { replaceState() {} },
    URL,
    URLSearchParams,
    Image: class {
      constructor() {
        this.complete = false;
      }
    },
    Path2D: class {
      constructor() {
        return new Proxy({}, { get: () => () => {} });
      }
    },
    performance: { now: () => 0 },
    requestAnimationFrame() {},
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    morphdom: (target, html) => {
      target.html = html;
    },
    fetch: async url => {
      requests.push(url);
      return { ok: true, json: async () => responses.get(url) || (url === "/api/state" ? snapshot : {}) };
    },
  });
  if (realScene) {
    const source = sceneSource();
    vm.runInContext(
      source.replace(/\}\)\(\);\s*$/, "window.sceneProbe={drawScene,keeper,operatorColor};})();"),
      context,
    );
  }
  const source = fs
    .readFileSync(path.join(boardRoot, "app/parts.txt"), "utf8")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"))
    .map(name => {
      if (name === "@data-layer") return fs.readFileSync(path.join(boardRoot, "server-layer.js"), "utf8");
      if (name === "@shift-presence")
        return fs.readFileSync(path.join(boardRoot, "../server/shift-presence.js"), "utf8");
      const text = fs.readFileSync(path.join(boardRoot, "app", name), "utf8");
      return name === "boot.js" ? text.split("// ---------- boot ----------")[0] : text;
    })
    .join("\n");
  vm.runInContext(source, context);
  const page = vm.runInContext(
    "({state,data,boardIds,boardLabel,tabsHtml,homeHtml,loadFeed,render,deviceHtml,railHtml,setView,txHtml," +
      "managementHtml,managementModel,displayGrantOnce,clearGrantOnce,displayArchivePreview," +
      "managementClick,managementSubmit,handoffHtml,navigator})",
    context,
  );
  return {
    ...page,
    context,
    window,
    elements,
    storage,
    requests,
    responses,
    labels,
    async load(next) {
      snapshot = next;
      await page.data.load();
    },
  };
};
