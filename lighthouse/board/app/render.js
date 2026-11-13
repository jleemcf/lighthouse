// ---------- render: patch in place ----------
function renderDoorbells() {
  const banner = document.getElementById("doorbell-status");
  const failed = Object.values(state.doorbells || {}).filter(wake =>
    ["retrying", "unconfigured"].includes(wake.status),
  );
  banner.hidden = !failed.length;
  const text = failed
    .map(wake => {
      const card = state.cards.find(candidate => candidate.id === wake.card);
      const status = wake.status === "unconfigured" ? "needs receiver configuration" : "retrying automatically";
      return (card?.title || wake.card) + ": inbox wake " + status + " (revision " + wake.revision + ").";
    })
    .join(" ");
  if (banner.textContent !== text) banner.textContent = text;
}
let rendering = false,
  rerender = false;
let lastFeedOn = false; // the feed was on screen at the last render
let lastThreadId = null,
  lastThreadHad = false; // the side box shown at the last render, and whether it had messages yet
function render() {
  if (rendering) {
    rerender = true;
    return;
  }
  rendering = true;
  // the board on screen is being looked at
  if (state.view !== null && state.boards[state.view] && document.visibilityState === "visible") {
    state.seen["board:" + state.view] = new Date().toISOString();
    ls("lh.seen", JSON.stringify(state.seen));
  }
  try {
    renderDoorbells();
    if (state.view !== null && state.boards[state.view] && state.talkBoard !== state.view)
      data
        .general(state.view)
        .then(render)
        .catch(() => {});
    $top.classList.toggle("red", unopenedAsks().length > 0);
    $asof.textContent = state.live
      ? "updated " +
        fmtTime(state.updatedAt || new Date().toISOString()) +
        " " +
        (state.timeZoneLabel || state.timeZone || "UTC")
      : "no signal yet";
    $clearNotifications.disabled = !hasUnreadNotifications();
    morph($tabs, '<nav class="tabs" role="tablist" id="tabs">' + tabsHtml() + "</nav>");
    morph(
      $app,
      '<main id="app">' +
        homeHtml() +
        boardIds().map(boardHtml).join("") +
        panelHtml() +
        newTaskHtml() +
        explainerHtml() +
        "</main>",
    );
    {
      const dw = document.querySelector(".view.active .dthread");
      if (dw) {
        // opened, switched board, or its messages just arrived: the box opens at the newest message
        const fresh = dw.id !== lastThreadId || !lastThreadHad;
        if (fresh) {
          state.pinned[dw.id] = false;
          const go = () => {
            try {
              if (!state.pinned[dw.id]) dw.scrollTop = dw.scrollHeight;
            } catch (e) {}
          };
          go();
          setTimeout(go, 0);
          setTimeout(go, 400); // again after images have laid out
        }
        const h = String(dw.scrollHeight);
        if (!fresh && state.heights[dw.id] !== h && !state.pinned[dw.id]) dw.scrollTop = dw.scrollHeight;
        state.heights[dw.id] = h;
        lastThreadId = dw.id;
        lastThreadHad = !!dw.querySelector(".msg");
      } else {
        lastThreadId = null;
        lastThreadHad = false;
      }
    }
    try {
      // a task panel opens at its newest messages and follows new ones until Owner scrolls up; the scrolling happens
      // after the paint, only when the content grew, and can never stop the page. In full screen the conversation
      // column is the one that scrolls.
      const p = document.getElementById("panel-talk") || document.getElementById("panel");
      const reset = state.panelReset;
      state.panelReset = false;
      if (!scrollPhonePanel(reset) && p) {
        // a timer, not requestAnimationFrame: the frame callback never fires in a hidden tab
        setTimeout(() => {
          try {
            // a card picked from the task list opens at its top, with its row in view
            if (reset) {
              state.pinned.panel = false;
              const tk = document.querySelector("#panel .pw-task"),
                on = document.querySelector("#pw-rail .rail-item.on");
              if (tk) tk.scrollTop = 0;
              if (on) on.scrollIntoView({ block: "nearest" });
            }
            const h = String(p.scrollHeight);
            if ((reset || state.heights.panel !== h) && !state.pinned.panel) {
              p.scrollTop = p.scrollHeight;
            }
            state.heights.panel = h;
          } catch (e) {}
        }, 0);
      }
      if (state.scrollTo) {
        const id = state.scrollTo;
        state.scrollTo = null;
        setTimeout(() => {
          try {
            const card = document.getElementById("card-" + id);
            const box = card && (card.querySelector(".compose textarea") || card.querySelector(".thread"));
            if (box) box.scrollIntoView({ block: "end" });
          } catch (e) {}
        }, 0);
      }
    } catch (e) {}
    if (state.focusKey) {
      const ta = document.querySelector('[data-draft="' + state.focusKey + '"]');
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
      state.focusKey = null;
    }
    {
      const feedOn = state.view === null && state.feed && !state.art,
        fresh = feedOn && !lastFeedOn; // Home just came on screen with the feed, or the feed was just switched on
      if (feedOn)
        document.querySelectorAll(".view.active .fbody, .view.active #glist").forEach(fb => {
          try {
            // every box starts at its newest and follows new lines until he scrolls up; a hidden Home loses its
            // scroll, so each return starts at the newest again
            if (fresh) state.pinned[fb.id] = false;
            const go = () => {
                try {
                  if (!state.pinned[fb.id]) fb.scrollTop = fb.scrollHeight;
                } catch (e) {}
              },
              h = String(fb.scrollHeight);
            if (fresh || state.heights[fb.id] !== h) {
              go();
              setTimeout(go, 0);
              setTimeout(go, 400); // again after images and fonts have laid out
            }
            state.heights[fb.id] = h;
          } catch (e) {}
        });
      lastFeedOn = feedOn;
    }
    // Home runs the scene; in lite mode elsewhere, the header's lighthouse redraws on a change
    if (state.view === null) startScene();
    else if (state.lite && window.LighthouseScene && window.LighthouseScene.poke) window.LighthouseScene.poke();
  } finally {
    rendering = false;
    if (rerender) {
      rerender = false;
      render();
    }
  }
}
function morph(el, html) {
  if (typeof morphdom === "function") {
    morphdom(el, html, {
      getNodeKey: n => (n.nodeType === 1 && n.id ? n.id : undefined),
      onBeforeElUpdated: (from, to) => {
        if (
          from === document.activeElement &&
          (from.tagName === "TEXTAREA" || from.tagName === "INPUT" || from.tagName === "SELECT")
        )
          return false; // never touch what Owner is typing in
        if (from.id === "scene") return false;
        if (from.tagName === "DETAILS" && from.open !== to.open) {
          to.open = from.open;
        }
        if (from.isEqualNode(to)) return false;
        return true;
      },
    });
  } else {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    el.innerHTML = tmp.firstElementChild.innerHTML;
  }
}
let refreshTimer = null,
  lastRefresh = 0,
  lastKey = 0;
// a refresh waits while he types, as a render then can lock the page; eight seconds since the last key counts as
// typing, since a pause to think is not a pause in typing
const typing = () => {
  const a = document.activeElement;
  return !!a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT") && Date.now() - lastKey < 8000;
};
// the conduct strip: counts over the last hour; red for what needs a hand, amber for manners, green when clean
const CONDUCT = [
  ["openNotices", "notice open", "bad", "a correction from the watch operator not yet answered with OPS"],
  ["waitingNoAsk", "waiting, no ask", "bad", "a card in Waiting with nothing said: local policy"],
  ["misfiled", "task in task", "bad", "a TASK_CREATED naming a card that already existed"],
  ["gateFailOpen", "gate fail-open", "bad", "the wake gate is passing everything; Jev is not judging there"],
  ["outboxSilent", "outbox silent", "bad", "no telemetry from the collector for five minutes while the shift is on"],
  ["general", "general", "warn", "labelled lines on general: only SHIFT and OPS say general"],
  ["untagged", "untagged", "warn", "prose before the first timed line"],
  ["unlabelled", "unlabelled", "warn", "timed lines with no label"],
  ["slugTitled", "slug titles", "warn", "cards opened by a stray line, still titled by their slug"],
  ["catchAll", "catch-all", "warn", "one card holding a third of the shift's lines"],
  ["duplicates", "duplicates", "warn", "Jev read a new card as the same task as an open one"],
  ["planning", "planning aloud", "warn", "Jev read an untagged note as planning said aloud"],
  ["falseAsks", "empty asks", "warn", "Jev read an ACTION as not asking anything"],
  ["offTask", "off task", "warn", "Jev read a card line as not about its card"],
  ["gateSilent", "gate silent", "warn", "the wake gate's heartbeat is twenty minutes old"],
  ["silenceMin", "silent", "warn", "shift on, no line for an hour"],
  ["flood", "flood", "warn", "lines far above the operator's norm in the last ten minutes"],
  ["compacted", "compacted", "warn", "the operator's session was compacted in the last hour: read its next lines"],
];
function conductHtml(id) {
  const c = state.conduct[id];
  if (!c || !c.signals) return "";
  const pills = CONDUCT.filter(([k]) => c.signals[k]).map(
    ([k, name, cls, tip]) =>
      '<span class="cpill ' +
      cls +
      '" title="' +
      esc(tip) +
      '">' +
      esc(name) +
      " " +
      esc(String(c.signals[k])) +
      (k === "silenceMin" ? " min" : "") +
      "</span>",
  );
  return (
    '<div class="conduct" title="conduct over the last ' +
    esc(String(c.minutes)) +
    " minutes: " +
    esc(String(c.lines)) +
    ' lines">' +
    (pills.length
      ? pills.join("")
      : '<span class="cpill ok" title="no fault the brief forbids in the last hour">conduct clean</span>') +
    "</div>"
  );
}
let refreshing = false,
  refreshAgain = false;
// one at a time; a change during one brings one more, straight after
async function refresh() {
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  try {
    await refreshOnce();
  } finally {
    refreshing = false;
    if (refreshAgain) {
      refreshAgain = false;
      refresh().catch(() => {});
    }
  }
}
async function refreshOnce() {
  try {
    await data.load();
    state.updatedAt = new Date().toISOString();
  } catch (e) {
    showBanner("The board could not be read (" + e.message + "). Retrying.", true);
    return;
  }
  if (Date.now() - state.conductAt > 60000) {
    state.conductAt = Date.now();
    for (const id of Object.keys(state.boards)) {
      try {
        await data.conduct(id);
      } catch (e) {}
    }
  }
  const need = new Set(state.expanded);
  if (state.panel) need.add(state.panel);
  for (const id of need) {
    try {
      await data.thread(id);
      if ((state.cards.find(c => c.id === id) || {}).lite) await data.card(id);
    } catch (e) {}
  }
  if (state.talkBoard) {
    try {
      await data.general(state.talkBoard);
    } catch (e) {}
  }
  if (state.transcript) {
    try {
      await data.transcript(state.transcript);
    } catch (e) {}
  }
  if (state.feed && state.view === null) await loadFeed();
  render();
}
async function loadFeed() {
  await Promise.all(
    boardIds()
      .filter(id => state.boards[id])
      .map(id => data.feed(id).catch(() => {}))
      .concat([data.globals().catch(() => {})]),
  );
}
function refreshSoon() {
  // bursts of changes collapse into one refresh, at most every two seconds, deferred while he types
  clearTimeout(refreshTimer);
  const tick = () => {
    if (typing()) {
      refreshTimer = setTimeout(tick, 1000);
      return;
    }
    lastRefresh = Date.now();
    refresh().catch(() => {});
  };
  refreshTimer = setTimeout(tick, Math.max(150, 2000 - (Date.now() - lastRefresh)));
}
