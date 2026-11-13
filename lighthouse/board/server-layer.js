// ==== DATA LAYER: server ====
// The self-hosted page talks to the board server: its API and its event stream. The page build (make-page.py) puts
// this file where board/app/parts.txt says "@data-layer".
let TOKEN = "";
// A ?token= link signs the page in, and the token leaves the address. A link never silently swaps who he is: a
// different token than the one the page has asks first.
try {
  const qs = new URLSearchParams(location.search),
    had = localStorage.getItem("lh.token") || "";
  if (
    qs.get("token") &&
    (!had ||
      had === qs.get("token") ||
      confirm("This link signs this page in as a different identity than the one it has. Switch?"))
  ) {
    TOKEN = qs.get("token");
    localStorage.setItem("lh.token", TOKEN);
    history.replaceState(null, "", location.pathname);
  } else {
    TOKEN = had;
    if (qs.get("token")) history.replaceState(null, "", location.pathname);
  }
} catch (e) {}
async function api(method, path, body) {
  const h = { Accept: "application/json" };
  if (TOKEN) h["Authorization"] = "Bearer " + TOKEN;
  if (body) h["Content-Type"] = "application/json";
  const r = await fetch(path, {
    method: method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  let j = null;
  try {
    j = await r.json();
  } catch (e) {
    j = null;
  }
  if (!r.ok) throw new Error((j && j.error) || r.status + " " + r.statusText);
  return j;
}
const data = {
  async load() {
    const s = await api("GET", "/api/state");
    state.ownerId = s.ownerId || "owner";
    state.ownerName = s.ownerName || "the captain";
    state.ownerAliases = s.ownerAliases || [];
    state.timeZone = s.timeZone || "UTC";
    state.timeZoneLabel = s.timeZoneLabel || state.timeZone;
    COLS[0][1] = "Waiting on " + state.ownerName;
    const previousBoards = boardIds();
    state.boards = s.boards || {};
    if (previousBoards.some(id => !boardIds().includes(id))) state.letter = null;
    if (state.view !== null && !boardIds().includes(state.view)) {
      state.view = null;
      ls("lh.view", "null");
    }
    if (!boardIds().includes(state.talkBoard)) {
      state.talkBoard = null;
      state.general = [];
      state.generalTotal = 0;
      state.generalWaiting = null;
    }
    if (!boardIds().includes(state.transcript)) {
      state.transcript = null;
      state.txBoard = null;
      state.tx = [];
    }
    if (!boardIds().includes(state.demo.alarm)) state.demo.alarm = false;
    if (state.newTask && !boardIds().includes(state.newTask)) state.newTask = null;
    if (state.letter && !boardIds().includes(state.letter.from)) state.letter = null;
    if (window.LighthouseScene) window.LighthouseScene.syncBoards();
    // an old finished card comes light; one he opened stays whole
    state.cards = Object.values(s.cards || {}).map(c =>
      c.lite && state.cardFull[c.id] && state.cardFull[c.id].updatedAt === c.updatedAt ? state.cardFull[c.id] : c,
    );
    if (state.panel && !state.cards.some(card => card.id === state.panel)) state.panel = null;
    state.recent = s.recent || [];
    state.doorbells = s.doorbells || {};
    state.weather = s.weather || null;
    state.advice = s.advice || [];
    state.stewardReq = s.stewardRequests || [];
    state.stewards = s.stewards || {};
    state.rulingTitles = s.rulings || {};
    state.live = true;
    hideBanner();
  },
  async thread(cardId) {
    const r = await api("GET", "/api/comments?cardId=" + encodeURIComponent(cardId));
    state.threads[cardId] = r.comments || [];
  },
  // General's newest 200, unless he asked for the earlier ones: a busy board's whole General is too much to fetch at
  // every refresh
  async general(board) {
    state.talkBoard = board;
    const all = state.unfold.has("gen:" + board),
      r = await api(
        "GET",
        "/api/comments?board=" + encodeURIComponent(board) + "&general=true" + (all ? "" : "&last=200"),
      );
    if (state.talkBoard !== board) return;
    state.general = r.comments || [];
    state.generalTotal = r.total || state.general.length;
    state.generalWaiting = r.waiting == null ? null : r.waiting;
  },
  // one card whole
  async card(id) {
    const r = await api("GET", "/api/cards/" + encodeURIComponent(id));
    if (!r || !r.card) return;
    state.cardFull[id] = r.card;
    state.cards = state.cards.map(c => (c.id === id ? r.card : c));
  },
  postComment: (cardId, text, files, sendId) =>
    api("POST", "/api/comments", { cardId: cardId, text: text, attachments: files, sendId: sendId }),
  postGeneral: (board, text, files, kind, sendId) =>
    api("POST", "/api/comments", {
      board: board,
      text: text,
      attachments: files,
      kind: kind || undefined,
      sendId: sendId,
    }),
  postBundle: (board, parts, files, sendId) =>
    api("POST", "/api/bundles", { board: board, parts: parts, attachments: files, sendId: sendId }),
  async transcript(board) {
    const r = await api("GET", "/api/boards/" + encodeURIComponent(board) + "/transcript");
    if (!boardIds().includes(board)) return;
    state.txBoard = board;
    state.tx = r.entries || [];
  },
  // a column of Home's feed
  async feed(board) {
    const r = await api("GET", "/api/boards/" + encodeURIComponent(board) + "/transcript");
    if (!boardIds().includes(board)) return;
    state.feedTx[board] = r.entries || [];
  },
  async globals() {
    const r = await api("GET", "/api/global?last=20");
    state.globals = r.globals || [];
  },
  // one message to every operator
  postGlobal: (text, files, sendId) => api("POST", "/api/global", { text: text, attachments: files, sendId: sendId }),
  async conduct(board) {
    state.conduct[board] = await api("GET", "/api/boards/" + encodeURIComponent(board) + "/conduct?minutes=60");
  },
  postDirect: (board, text, files, sendId) =>
    api("POST", "/api/comments", { board: board, text: text, attachments: files, kind: "direct", sendId: sendId }),
  decide: (id, choice, text) =>
    api("POST", "/api/comments/" + encodeURIComponent(id) + "/decide", { choice: choice, text: text || undefined }),
  resolveAsk: (cardId, decision) =>
    api("POST", "/api/cards/" + encodeURIComponent(cardId) + "/resolve", { decision: decision }),
  // Owner presses a steward button or asks it a question
  steward: (board, body) => api("POST", "/api/boards/" + encodeURIComponent(board) + "/steward", body),
  // item: one piece of an overview's advice
  advicePut: (id, item) =>
    api("POST", "/api/advice/" + encodeURIComponent(id) + "/put", item == null ? {} : { item: item }),
  // the page holds summaries; one advice comes whole when he opens it
  async advice(id) {
    const r = await api("GET", "/api/advice/" + encodeURIComponent(id));
    if (r && r.advice) state.adviceFull[id] = r.advice;
    return r && r.advice;
  },
  // Owner's devices and their switches
  push: {
    list: ep => api("GET", "/api/push" + (ep ? "?endpoint=" + encodeURIComponent(ep) : "")),
    subscribe: (subscription, device, oldEndpoint) =>
      api("POST", "/api/push/subscribe", {
        subscription: subscription,
        device: device,
        oldEndpoint: oldEndpoint || null,
      }),
    settings: (id, boards, device) =>
      api("POST", "/api/push/settings", { id: id, boards: boards, device: device || undefined }),
    unsubscribe: id => api("POST", "/api/push/unsubscribe", { id: id }),
    test: id => api("POST", "/api/push/test", { id: id }),
  },
  async upload(file) {
    const h = {
      "Content-Type": file.type || "application/octet-stream",
      "X-Name": encodeURIComponent(file.name || "image"),
    };
    if (TOKEN) h["Authorization"] = "Bearer " + TOKEN;
    const r = await fetch("/api/attachments", { method: "POST", headers: h, body: file, credentials: "same-origin" });
    let j = null;
    try {
      j = await r.json();
    } catch (e) {
      j = null;
    }
    if (!r.ok) throw new Error((j && j.error) || r.status + " " + r.statusText);
    return j;
  },
  async connect() {
    state.canTalk = true;
    let es = null,
      connected = false;
    // a phone or a hidden tab can miss the feed
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshSoon();
    });
    function subscribe() {
      es = new EventSource("/api/stream" + (TOKEN ? "?token=" + encodeURIComponent(TOKEN) : ""));
      es.addEventListener("change", () => refreshSoon());
      // back after a drop: what changed meanwhile
      es.addEventListener("hello", () => {
        if (connected) refreshSoon();
        connected = true;
      });
      es.onerror = () => {
        es.close();
        setTimeout(subscribe, 5000);
      };
    }
    subscribe();
    setInterval(() => refreshSoon(), 60000);
  },
};
// ==== END DATA LAYER ====
