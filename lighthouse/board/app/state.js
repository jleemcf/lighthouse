const COLS = [
  ["waiting", "Waiting on Owner"],
  ["inflight", "In flight"],
  ["held", "Held"],
  ["queued", "Queued"],
  ["done", "Done"],
];
const COL_CAP = { queued: 12, done: 8 };
const KINDS = [
  "ACTION",
  "FYI",
  "REPLY",
  "SHIFT",
  "RELAYED",
  "STATUS",
  "CONTEXT",
  "TASK_CREATED",
  "TASK_FINISHED",
  "PROMPT",
  "OPS",
  "NOTICE",
  "OWNER",
];
// the activity line's leading label, coloured
const actHtml = text => {
  const m = /^([A-Z_]+) ([\s\S]*)$/.exec(text || "");
  return m && KINDS.includes(m[1])
    ? '<span class="kind ' + m[1] + '">' + m[1] + "</span>" + esc(m[2])
    : esc(text || "");
};
const $root = document.getElementById("root"),
  $app = document.getElementById("app"),
  $tabs = document.getElementById("tabs"),
  $top = document.getElementById("top");
const $asof = document.getElementById("asof"),
  $clearNotifications = document.getElementById("clearNotifications"),
  $help = document.getElementById("help"),
  $helpBtn = document.getElementById("helpBtn"),
  $banner = document.getElementById("banner");
const state = {
  view: null,
  boards: {},
  cards: [],
  recent: [],
  live: false,
  canTalk: false,
  updatedAt: null,
  conduct: {},
  conductAt: 0,
  folded: new Set(),
  more: new Set(),
  // per scroll box: whether Owner scrolled up (then the box never follows new content), and its last content height
  pinned: {},
  heights: {},
  detailed: false,
  expandedCols: new Set(),
  activityOpen: false,
  expanded: new Set(),
  panel: null,
  panelView: "current",
  histOpen: false,
  threads: {},
  general: [],
  talkBoard: null,
  drafts: {},
  files: {},
  posting: false,
  bundle: { on: false, board: null, parts: {}, general: false },
  drawer: !(window.matchMedia && window.matchMedia("(max-width: 720px)").matches),
  side: null,
  ops: null,
  transcript: null,
  tx: [],
  txBoard: null,
  editPrompt: null,
  demo: { shift: false, alarm: false },
  art: false,
  weather: null,
  wx: "live",
  season: "auto",
  letter: null,
  newTask: null,
  nt: { title: "", severity: "low", complexity: "small", nature: "ops" },
  seen: {},
  focusKey: null,
  adviceFull: {},
  adviceOpen: new Set(),
  sendIds: {},
  genMode: {},
  cardFull: {},
  generalTotal: 0,
  generalWaiting: null,
  // Home's live feed and Global; lite mode, per device
  feed: false,
  feedTx: {},
  // per feed column, the card his next message goes to (Reply on an entry); unset, it goes to the board's General
  feedTo: {},
  globals: [],
  lite: false,
  // "card:<id>" the whole conversation, "msg:<id>" a long message shown whole, "ctx:<id>" a long context
  unfold: new Set(),
  // this device's push subscription and every device's switches
  notify: {
    open: false,
    key: null,
    devices: [],
    mine: null,
    boards: null,
    perm: "default",
    busy: false,
    err: null,
    sub: null,
    loaded: false,
  },
};
const boardIds = () =>
  Object.keys(state.boards).sort(
    (left, right) => (state.boards[left].order ?? Infinity) - (state.boards[right].order ?? Infinity),
  );
const boardLabel = id => state.boards[id]?.displayName || state.boards[id]?.name || id;
const ls = (k, v) => {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch (e) {
    return null;
  }
};
// folded lanes survive a reload
try {
  state.folded = new Set(JSON.parse(ls("lh.folded") || "[]"));
} catch (e) {
  state.folded = new Set();
}
const saveFolded = () => ls("lh.folded", JSON.stringify(Array.from(state.folded)));
state.art = ls("lh.art") === "1"; // Home showing only the art, remembered on this browser
state.feed = ls("lh.feed") === "1"; // Home showing the live feed, remembered on this browser
state.lite = ls("lh.lite") === "1"; // lite mode: this device's own switch, off until he turns it on
document.documentElement.classList.toggle("lite", state.lite);
try {
  state.seen = JSON.parse(ls("lh.seen") || "{}") || {};
} catch (e) {
  state.seen = {};
}
try {
  const savedView = ls("lh.view"),
    legacyView = ls("lh.tab");
  state.view = savedView === null ? (legacyView === "home" ? null : legacyView) : JSON.parse(savedView);
  if (typeof state.view !== "string") state.view = null;
} catch (e) {
  state.view = null;
}
// the sky over the scene: live (the real weather over Owner's area, when the server has it) or a chosen one
state.wx = ls("lh.weather") || "live";
state.season = ls("lh.season") || "auto";
state.detailed = ls("lh.detailed") === "1";
state.panelView = ls("lh.panelView") || "current";
state.drawer = ls("lh.drawer") !== "0";
state.wide = ls("lh.wide") === "1";
state.rail = ls("lh.rail") !== "0";
state.pending = {};
const isOwnerName = name => name === (state.ownerId || "owner") || (state.ownerAliases || []).includes(name);
