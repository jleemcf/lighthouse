// ---------- helpers: escaping, times, the message format, open asks, what is new, who is on shift ----------
const esc = s =>
  String(s == null ? "" : s).replace(
    /[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const enc = encodeURIComponent;
function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: state.timeZone || "UTC" });
  const today =
    new Date().toLocaleDateString("en-US", { timeZone: state.timeZone || "UTC" }) ===
    d.toLocaleDateString("en-US", { timeZone: state.timeZone || "UTC" });
  return today
    ? time
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: state.timeZone || "UTC" }) + " " + time;
}
// every message says how long ago it came, beside its clock time; the exact date sits on hover
function agoWords(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return "";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  if (h < 48) return h + " h ago";
  const d = Math.round(h / 24);
  if (d < 14) return d + " days ago";
  if (d < 60) return Math.round(d / 7) + " weeks ago";
  return Math.round(d / 30) + " months ago";
}
const exactWhen = iso => {
  const d = new Date(iso);
  return isNaN(d)
    ? String(iso || "")
    : d.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: state.timeZone || "UTC",
      }) +
        " " +
        (state.timeZoneLabel || state.timeZone || "UTC");
};
const whenHtml = iso =>
  '<time datetime="' +
  esc(iso || "") +
  '" title="' +
  esc(exactWhen(iso)) +
  '"><span class="at">' +
  esc(fmtTime(iso)) +
  '</span><span class="rel">' +
  esc(agoWords(iso)) +
  "</span></time>";
function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return "";
  const m = Math.round(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return m + "m";
  const h = Math.round(m / 60);
  if (h < 48) return h + "h";
  return Math.round(h / 24) + "d";
}
const fmtCache = new Map(); // the same text formats once, so long transcripts do not slow the page
function fmt(text) {
  const k = String(text || "");
  const hit = fmtCache.get(k);
  if (hit !== undefined) return hit;
  if (fmtCache.size > 4000) fmtCache.clear();
  const out = fmtRaw(k);
  fmtCache.set(k, out);
  return out;
}
// web addresses open in a new tab: a bare http(s) one, or a [text](address) link; only http and https, and a
// sentence's closing punctuation stays outside the link
const LINK_RE = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s()<>"']+)\)|https?:\/\/[^\s<>"']+/g;
function fmtRaw(text) {
  const marks = s =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  const inline = s => {
    let out = "",
      last = 0,
      m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(s))) {
      let url = m[2] || m[0],
        tail = "";
      if (!m[1]) {
        const t = /[.,;:!?)\]]+$/.exec(url);
        if (t) {
          tail = t[0];
          url = url.slice(0, -tail.length);
        }
      }
      out +=
        marks(s.slice(last, m.index)) +
        '<a class="ext" href="' +
        esc(url) +
        '" target="_blank" rel="noopener noreferrer">' +
        esc(m[1] || url) +
        "</a>" +
        esc(tail);
      last = m.index + m[0].length;
    }
    return out + marks(s.slice(last));
  };
  const lines = String(text || "").split("\n");
  let out = "",
    mode = null,
    buf = [];
  const flush = () => {
    if (mode === "ul") out += "<ul>" + buf.map(l => "<li>" + inline(l) + "</li>").join("") + "</ul>";
    else if (mode === "q") out += "<blockquote>" + buf.map(inline).join("<br>") + "</blockquote>";
    else if (mode === "pre") out += "<pre>" + buf.map(esc).join("\n") + "</pre>";
    else if (mode === "p") out += "<p>" + buf.map(inline).join("<br>") + "</p>";
    mode = null;
    buf = [];
  };
  for (const raw of lines) {
    const l = raw.replace(/\s+$/, "");
    let m;
    if (mode === "pre") {
      if (l.trim().startsWith("```")) flush();
      else buf.push(l);
      continue;
    }
    if (l.trim().startsWith("```")) {
      flush();
      mode = "pre";
      continue;
    }
    if (!l.trim()) {
      flush();
      continue;
    }
    if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) {
      if (mode !== "ul") {
        flush();
        mode = "ul";
      }
      buf.push(m[1]);
      continue;
    }
    if ((m = /^\s*>\s?(.*)$/.exec(l))) {
      if (mode !== "q") {
        flush();
        mode = "q";
      }
      buf.push(m[1]);
      continue;
    }
    if ((m = /^\s*#{1,4}\s+(.*)$/.exec(l))) {
      flush();
      out += "<p><strong>" + inline(m[1]) + "</strong></p>";
      continue;
    }
    if (mode !== "p") {
      flush();
      mode = "p";
    }
    buf.push(l);
  }
  flush();
  return out;
}
function openAsks(c) {
  if (c.status === "done") return []; // finished is never red, whatever asks it still holds
  if (Array.isArray(c.decisions) && c.decisions.length) return c.decisions.filter(d => !d.resolvedAt);
  return c.needsAction ? [{ id: "legacy", ask: c.ask || "" }] : [];
}
const actionCount = id => state.cards.filter(c => (!id || c.board === id) && openAsks(c).length > 0).length;
const cardsOf = id => state.cards.filter(c => c.board === id);
const sortedLog = c => (Array.isArray(c.log) ? c.log.slice() : []).sort((a, b) => (b.t || "").localeCompare(a.t || ""));
function markSeen(key) {
  state.seen[key] = new Date().toISOString();
  ls("lh.seen", JSON.stringify(state.seen));
}
const seenSince = key => {
  const own = state.seen[key] || "",
    all = state.seen["notifications:all"] || "";
  return own > all ? own : all;
};
// compared as instants: the server stamps seconds; the browser stamps milliseconds
const afterSeen = (t, since) => !!t && (!since || Date.parse(t) > Date.parse(since));
const unreadOperatorLog = (c, since) =>
  (Array.isArray(c.log) ? c.log : []).filter(e => e.kind !== "OWNER" && afterSeen(e.t, since)).length;
const unreadMessages = (c, since) =>
  (Array.isArray(c.messageTimes) ? c.messageTimes : []).filter(t => afterSeen(t, since)).length;
const unreadCard = c => {
  const since = seenSince(c.id);
  return unreadOperatorLog(c, since) + unreadMessages(c, since);
};
// a new overview marks General new, and never pings
const unreadGeneral = id => {
  if (state.talkBoard !== id) return 0;
  const since = seenSince("general:" + id);
  return (
    state.general.filter(m => !isOwnerName(m.by) && (m.t || "") > since).length +
    generalNotes(id).filter(a => (a.t || "") > since).length +
    ((overviewsOf(id)[0] || {}).t > since ? 1 : 0)
  );
};
// The tab's blue number: lines since Owner last looked at the board itself. The board is stamped seen while it is on
// screen, so the number counts only what landed while he was elsewhere. Cards keep their own new operator line and
// message badges inside the board, cleared per card when he opens it.
const unreadBoard = id => {
  const since = seenSince("board:" + id);
  const gen =
    state.talkBoard === id
      ? state.general.filter(m => !isOwnerName(m.by) && (m.t || "") > since && (m.t || "") > seenSince("general:" + id))
          .length
      : 0;
  return (
    cardsOf(id).reduce((n, c) => {
      const cardSince = seenSince(c.id),
        after = cardSince > since ? cardSince : since;
      return n + unreadOperatorLog(c, after) + unreadMessages(c, after);
    }, 0) + gen
  );
};
// the operator's housekeeping notes and the board's corrections to it, newest first
const opsOf = id => {
  const b = state.boards[id];
  return (b && Array.isArray(b.ops) ? b.ops : [])
    .concat(
      (b && Array.isArray(b.notes) ? b.notes : []).map(n => ({
        t: n.t,
        text: n.text,
        board: true,
        rule: n.rule,
        line: n.line,
      })),
    )
    .sort((x, y) => (y.t || "").localeCompare(x.t || ""));
};
const unreadOps = id => {
  const since = seenSince("ops:" + id);
  return opsOf(id).filter(e => (e.t || "") > since).length;
};
function liveness(b) {
  return ShiftPresence.presence(b, b && b.protocol);
}
const presence = b => liveness(b).p;
function showBanner(text, err) {
  $banner.textContent = text;
  $banner.classList.toggle("err", !!err);
  $banner.hidden = false;
}
function hideBanner() {
  $banner.hidden = true;
}
const ownerLabel = () => state.ownerName || "the captain";
