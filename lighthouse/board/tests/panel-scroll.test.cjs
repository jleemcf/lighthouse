"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const page = require("./discovery-page.cjs");

function fixture(width, wide = true) {
  const browser = page(),
    context = browser.context,
    timers = [],
    observers = [],
    listeners = new Map();
  const element = (id, classes) => ({
    id,
    children: [{}, {}],
    scrollTop: 0,
    scrollHeight: 1600,
    clientHeight: 600,
    classList: { contains: name => classes.includes(name) },
    scrollTo({ top }) {
      this.scrollTop = top;
    },
  });
  const panel = element("panel", ["panel"]),
    body = element("", ["pw-body"]),
    talk = element("panel-talk", ["pw-talk"]),
    task = element("", ["pw-task"]);
  context.window.matchMedia = query => {
    assert.equal(query, "(max-width: 720px)");
    return { matches: width <= 720 };
  };
  context.setTimeout = callback => timers.push(callback);
  context.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
      observers.push(this);
    }
    observe(target) {
      this.targets.push(target);
    }
    disconnect() {
      this.targets = [];
    }
  };
  const getElement = context.document.getElementById;
  context.document.getElementById = id => {
    if (id === "panel") return browser.state.panel ? panel : null;
    if (id === "panel-talk") return browser.state.panel && wide ? talk : null;
    return getElement(id);
  };
  context.document.querySelector = selector => {
    if (selector === "#panel .pw-body") return wide ? body : null;
    if (selector === "#panel .pw-task") return task;
    return null;
  };
  vm.runInContext(
    "$root.addEventListener = captureListener",
    Object.assign(context, {
      captureListener: (type, callback) => listeners.set(type, callback),
    }),
  );
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/events.js"), "utf8"), context);
  const actions = vm.runInContext("({openPanel,closeOverlays})", context);
  let finishThread;
  browser.data.thread = () =>
    new Promise(resolve => {
      finishThread = resolve;
    });
  return {
    ...browser,
    ...actions,
    panel,
    body,
    talk,
    task,
    observers,
    setWidth(value) {
      width = value;
    },
    flush() {
      while (timers.length) timers.shift()();
    },
    resize() {
      for (const observer of observers) if (observer.targets.length) observer.callback();
    },
    scroll(box, top) {
      box.scrollTop = top;
      listeners.get("scroll")({ target: box });
    },
    async finishThread() {
      finishThread();
      await Promise.resolve();
    },
  };
}

for (const wide of [false, true]) {
  test("PhonePanelOpensAtBottomAndFollowsLateContent " + wide, async () => {
    const browser = fixture(390, wide),
      box = wide ? browser.body : browser.panel;
    browser.openPanel("first");
    browser.flush();
    assert.equal(box.scrollTop, box.scrollHeight);
    box.scrollHeight = 2400;
    await browser.finishThread();
    browser.flush();
    assert.equal(box.scrollTop, 2400);
    box.scrollHeight = 3200;
    browser.resize();
    assert.equal(box.scrollTop, 3200);
    assert.equal(browser.observers.at(-1).targets.length, box.children.length);
  });

  test("PhoneReaderScrollingUpIsNotResetByLateThreadOrImage " + wide, async () => {
    const browser = fixture(720, wide),
      box = wide ? browser.body : browser.panel;
    browser.openPanel("first");
    browser.flush();
    browser.scroll(box, 100);
    box.scrollHeight = 2400;
    await browser.finishThread();
    browser.flush();
    browser.resize();
    assert.equal(box.scrollTop, 100);
    browser.openPanel("second");
    browser.flush();
    assert.equal(box.scrollTop, 2400);
  });
}

for (const width of [721, 1280]) {
  test("DesktopPanelKeepsExistingScrollTargetAndLateThreadReset " + width, async () => {
    const browser = fixture(width);
    browser.task.scrollTop = 100;
    browser.openPanel("first");
    browser.flush();
    assert.equal(browser.talk.scrollTop, 1600);
    assert.equal(browser.task.scrollTop, 0);
    assert.equal(browser.body.scrollTop, 0);
    browser.scroll(browser.talk, 100);
    browser.talk.scrollHeight = 2400;
    await browser.finishThread();
    browser.flush();
    assert.equal(browser.talk.scrollTop, 2400);
    assert.equal(browser.observers.length, 0);
  });
}

test("PhoneCloseDisconnectsObserversAndInvalidatesPendingScroll", () => {
  const browser = fixture(390);
  browser.openPanel("first");
  browser.closeOverlays();
  browser.flush();
  browser.resize();
  assert.equal(browser.body.scrollTop, 0);
  assert.ok(browser.observers.every(observer => !observer.targets.length));
});

test("PhoneUserScrollBeforeFirstTimerWinsAndJumpUsesStackedBody", () => {
  const browser = fixture(390);
  browser.openPanel("first");
  browser.scroll(browser.body, 100);
  browser.flush();
  assert.equal(browser.body.scrollTop, 100);
  const target = vm.runInContext("taskPanelScrollBox()", browser.context);
  assert.equal(target, browser.body);
});

test("PhoneRotationKeepsTheReaderPinnedThroughDesktopWidth", () => {
  const browser = fixture(390);
  browser.openPanel("first");
  browser.flush();
  browser.scroll(browser.body, 100);
  browser.setWidth(844);
  vm.runInContext("render()", browser.context);
  browser.flush();
  browser.setWidth(390);
  vm.runInContext("render()", browser.context);
  browser.flush();
  browser.body.scrollHeight = 2400;
  browser.resize();
  assert.equal(browser.body.scrollTop, 100);
  assert.equal(browser.state.pinned.panel, true);
});
