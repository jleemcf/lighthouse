// ---------- the Home scene (board/scene/ or board/scene.js, inlined into the served page by the build) ----------
function sceneXY(cv, ev) {
  // a point on the canvas element to a point in the 960x540 picture (object-fit cover, centred, 62% down)
  const r = cv.getBoundingClientRect(),
    scale = Math.max(r.width / 960, r.height / 540),
    ox = (r.width - 960 * scale) / 2,
    oy = (r.height - 540 * scale) * 0.62;
  const x = (ev.clientX - r.left - ox) / scale,
    y = (ev.clientY - r.top - oy) / scale;
  return x >= 0 && x <= 960 && y >= 0 && y <= 540 ? { x, y } : null;
}
function startScene() {
  if (!window.LighthouseScene) return;
  window.LighthouseScene.start();
  const cv = document.getElementById("scene");
  if (cv && !cv.dataset.bound) {
    cv.dataset.bound = "1";
    cv.addEventListener("mousemove", ev => {
      const p = sceneXY(cv, ev);
      cv.style.cursor = p && window.LighthouseScene.hit(p.x, p.y) ? "pointer" : "";
    });
  }
}
if (window.LighthouseScene)
  window.LighthouseScene.attach({
    get timeZone() {
      return state.timeZone || "UTC";
    },
    get boards() {
      return boardIds();
    },
    label: boardLabel,
    presence: id => presence(state.boards[id]),
    unopened: id => unopenedAsks().filter(x => x.board === id).length,
    anyUnopened: () => unopenedAsks().length,
    isHome: () => state.view === null,
    weather: () => ({ mode: state.wx, live: state.weather, season: state.season }),
    onLetter: l => {
      state.letter = l;
      render();
    },
    live: () => state.live,
  });
// lite mode is this device's own choice
if (window.LighthouseScene && window.LighthouseScene.setLite) window.LighthouseScene.setLite(state.lite);

// ---------- boot ----------
render();
Promise.resolve()
  .then(() => managementLoad().catch(() => true))
  .then(signedIn => (signedIn ? data.connect().then(() => refresh()) : null))
  .then(() => {
    renderNotify();
    openFromUrl();
    if (data.push && pushReady())
      navigator.serviceWorker
        .getRegistration("/")
        .then(reg => {
          if (reg) notifyLoad();
        })
        .catch(() => {});
  })
  .catch(e => showBanner("No access: " + (e && e.message ? e.message : e), true));
window.__lh = { state, render, refresh, refreshSoon };
// a page error is reported to the server's log, so the chief developer can see what Owner's browser saw
{
  let lastReport = 0;
  const report = text => {
    if (Date.now() - lastReport < 5000) return;
    lastReport = Date.now();
    try {
      fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: String(text).slice(0, 800),
          ua: navigator.userAgent.slice(0, 120),
          view: state.view,
          panel: state.panel || null,
        }),
        credentials: "same-origin",
      }).catch(() => {});
    } catch (e) {}
  };
  window.addEventListener("error", e =>
    report((e.message || "error") + " @ " + (e.filename || "") + ":" + (e.lineno || 0)),
  );
  window.addEventListener("unhandledrejection", e =>
    report("rejection: " + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)),
  );
}
