// ---------- notifications on the phone and the computers: a switch per board on each device, easy to turn on or
// off; then the help and Clear notifications buttons ----------
const $bellBtn = document.getElementById("bellBtn"),
  $notify = document.getElementById("notify");
const isIOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => {
  try {
    return (
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true
    );
  } catch (e) {
    return false;
  }
};
const pushReady = () =>
  !!(
    data.push &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    window.isSecureContext
  );
function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "Device";
  const br = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "";
  return os + (br && os !== "iPhone" && os !== "iPad" ? " " + br : "");
}
const b64uToBytes = t => {
  const u = String(t || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const b = atob(u + "=".repeat((4 - (u.length % 4)) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
};
async function notifyLoad() {
  // what this browser holds, then what the board holds for every device
  if (!data.push) return;
  state.notify.perm = "Notification" in window ? Notification.permission : "unsupported";
  let ep = null;
  try {
    if (pushReady()) {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      state.notify.sub = sub || null;
      ep = sub ? sub.endpoint : null;
    }
  } catch (e) {}
  try {
    const r = await data.push.list(ep);
    state.notify.key = r.key;
    state.notify.devices = r.devices || [];
    state.notify.mine = r.mine || null;
    state.notify.boards = r.boards || boardIds();
    state.notify.err = null;
  } catch (e) {
    state.notify.err = e.message;
  }
  state.notify.loaded = true;
  renderNotify();
}
async function notifyOn() {
  const n = state.notify;
  n.busy = true;
  n.err = null;
  renderNotify();
  try {
    if (!pushReady())
      throw new Error(
        window.isSecureContext
          ? "This browser cannot receive pushes."
          : "Pushes need a secure address: open the board by its https link, or at localhost on the board machine.",
      );
    const perm = await Notification.requestPermission();
    n.perm = perm;
    if (perm !== "granted")
      throw new Error(
        perm === "denied"
          ? "This browser has notifications blocked for the board. Allow them in its site settings, then try again."
          : "Not allowed yet.",
      );
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub)
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(n.key) });
    const r = await data.push.subscribe(sub.toJSON(), deviceLabel());
    n.sub = sub;
    n.mine = r.mine;
    n.devices = r.devices || [];
  } catch (e) {
    n.err = e.message || String(e);
  }
  n.busy = false;
  renderNotify();
}
async function notifyOff(id) {
  const n = state.notify;
  n.busy = true;
  n.err = null;
  renderNotify();
  try {
    if (id === n.mine && n.sub) {
      try {
        await n.sub.unsubscribe();
      } catch (e) {}
      n.sub = null;
    }
    const r = await data.push.unsubscribe(id);
    n.devices = r.devices || [];
    if (id === n.mine) n.mine = null;
  } catch (e) {
    n.err = e.message;
  }
  n.busy = false;
  renderNotify();
}
async function notifySet(id, board, on) {
  const n = state.notify;
  n.err = null;
  const d = n.devices.find(x => x.id === id);
  if (d) d.boards[board] = on;
  renderNotify();
  try {
    const r = await data.push.settings(id, { [board]: on });
    n.devices = r.devices || [];
  } catch (e) {
    n.err = e.message;
  }
  renderNotify();
}
async function notifyTest(id) {
  const n = state.notify;
  n.busy = true;
  n.err = null;
  renderNotify();
  try {
    const r = await data.push.test(id);
    n.devices = r.devices || n.devices;
    if (!r.ok)
      throw new Error("The push service answered " + (r.status || "nothing") + (r.error ? ": " + r.error : ""));
  } catch (e) {
    n.err = e.message;
  }
  n.busy = false;
  renderNotify();
}
function deviceHtml(d, mine) {
  const boards = boardIds().filter(id => !state.notify.boards || state.notify.boards.includes(id));
  let h =
    '<div class="dev' +
    (mine ? " mine" : "") +
    '"><div class="dname">' +
    esc(d.device) +
    (mine ? '<span class="tag">this device</span>' : "") +
    '<span class="since" title="' +
    esc(
      d.lastError
        ? "last push failed: " + d.lastError
        : d.lastOk
          ? "last push reached it " + fmtTime(d.lastOk)
          : "no push sent yet",
    ) +
    '">' +
    (d.lastError ? "failing" : d.lastOk ? "ok " + ago(d.lastOk) : "since " + fmtTime(d.createdAt)) +
    "</span></div>";
  h +=
    '<div class="sws">' +
    boards
      .map(
        b =>
          '<label class="sw"><input type="checkbox" data-nact="board" data-id="' +
          esc(d.id) +
          '" data-board="' +
          esc(b) +
          '"' +
          (d.boards && d.boards[b] ? " checked" : "") +
          "> " +
          esc((state.boards[b] || {}).name || boardLabel(b) || b) +
          "</label>",
      )
      .join("") +
    "</div>";
  h +=
    '<div class="row"><button type="button" class="tiny" data-nact="test" data-id="' +
    esc(d.id) +
    '"' +
    (state.notify.busy ? " disabled" : "") +
    '>Send a test</button><button type="button" class="tiny" data-nact="off" data-id="' +
    esc(d.id) +
    '"' +
    (state.notify.busy ? " disabled" : "") +
    ">" +
    (mine ? "Turn off on this device" : "Remove") +
    "</button></div></div>";
  return h;
}
function renderNotify() {
  if (!data.push) {
    $bellBtn.hidden = true;
    return;
  }
  const n = state.notify;
  $bellBtn.hidden = false;
  $bellBtn.classList.toggle("on", !!n.mine);
  $bellBtn.setAttribute("aria-expanded", String(n.open));
  $notify.hidden = !n.open;
  if (!n.open) return;
  let h =
    "<h3>Notifications</h3><p>A push reaches a device when an operator opens an ask on a card, or the watch " +
    "leaves a notice. Each phone or computer has its own switches, one per board, and any device can set " +
    "another's.</p>";
  const mine = n.mine ? n.devices.find(d => d.id === n.mine) : null;
  if (mine) h += deviceHtml(mine, true);
  else if (!n.loaded) h += '<p class="hint">Reading this device.</p>';
  else if (isIOS && !standalone())
    h +=
      '<div class="step">On an iPhone, pushes work only from the Home Screen app. In Safari: Share, then ' +
      "<strong>Add to Home Screen</strong>. Open Lighthouse from there and press the bell again.</div>";
  else if (!pushReady())
    h +=
      '<p class="err">' +
      esc(
        window.isSecureContext
          ? "This browser cannot receive pushes."
          : "Pushes need a secure address: open the board by its https link, or at localhost on the board machine.",
      ) +
      "</p>";
  else if (n.perm === "denied")
    h +=
      '<p class="err">This browser has notifications blocked for the board. Allow them in its site settings, then ' +
      "press the bell again.</p>";
  else
    h +=
      '<div class="row"><button type="button" class="pill primary" data-nact="on"' +
      (n.busy ? " disabled" : "") +
      ">" +
      (n.busy ? "Turning on" : "Turn on notifications on this device") +
      "</button><span class='hint'>" +
      esc(deviceLabel()) +
      "</span></div>";
  const others = n.devices.filter(d => d.id !== n.mine);
  if (others.length) h += "<h3>Other devices</h3>" + others.map(d => deviceHtml(d, false)).join("");
  if (n.err) h += '<p class="err">' + esc(n.err) + "</p>";
  $notify.innerHTML = h;
}
$bellBtn.addEventListener("click", () => {
  state.notify.open = !state.notify.open;
  if (state.notify.open) {
    $help.hidden = true;
    $helpBtn.setAttribute("aria-expanded", "false");
    notifyLoad();
  }
  renderNotify();
});
$notify.addEventListener("click", ev => {
  const a = ev.target.closest("[data-nact]");
  if (!a || a.tagName === "INPUT") return;
  const act = a.getAttribute("data-nact"),
    id = a.getAttribute("data-id");
  if (act === "on") notifyOn();
  else if (act === "off") notifyOff(id);
  else if (act === "test") notifyTest(id);
});
$notify.addEventListener("change", ev => {
  const a = ev.target.closest("input[data-nact=board]");
  if (a) notifySet(a.getAttribute("data-id"), a.getAttribute("data-board"), a.checked);
});
document.addEventListener("click", ev => {
  if (state.notify.open && !$notify.contains(ev.target) && !$bellBtn.contains(ev.target)) {
    state.notify.open = false;
    renderNotify();
  }
});
// a tapped notification lands on its card or board: the url carries #card=<id> or #board=<id>
function openFromUrl(href) {
  let hash = "";
  try {
    hash = new URL(href || location.href, location.href).hash;
  } catch (e) {
    hash = location.hash;
  }
  const m = /^#(card|board)=([\w.-]+)$/.exec(hash || "");
  if (!m) return false;
  if (m[1] === "board") {
    if (state.boards[m[2]]) setView(m[2]);
  } else {
    const c = state.cards.find(x => x.id === m[2]);
    if (!c) return false;
    setView(c.board);
    state.folded.delete(c.board + ":" + c.status);
    expandCard(m[2]);
    setTimeout(() => {
      try {
        const el = document.getElementById("card-" + m[2]);
        if (el) el.scrollIntoView({ block: "nearest" });
      } catch (e) {}
    }, 50);
  }
  try {
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  } catch (e) {}
  return true;
}
window.addEventListener("hashchange", () => openFromUrl());
if ("serviceWorker" in navigator)
  navigator.serviceWorker.addEventListener("message", ev => {
    if (ev.data && ev.data.kind === "open") openFromUrl(ev.data.url);
  });
$helpBtn.addEventListener("click", () => {
  const open = $help.hidden;
  $help.hidden = !open;
  $helpBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    state.notify.open = false;
    renderNotify();
  }
});
$clearNotifications.addEventListener("click", () => {
  markSeen("notifications:all");
  render();
});
