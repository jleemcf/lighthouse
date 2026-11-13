// ---------- the overview: the steward's reading of the whole board, where a task shows its context and status;
// written every two hours of shift and when he presses; the newest whole, the earlier ones when opened ----------
const overviewsOf = id =>
  (state.advice || [])
    .filter(a => a.board === id && a.kind === "state" && !a.cardId)
    .sort(
      (a, b) =>
        (b.t || "").localeCompare(a.t || "") || Number(!!(b.overview || b.text)) - Number(!!(a.overview || a.text)),
    );
// the steward's other words in General: its answers, digests, reviews, flags
const generalNotes = id =>
  hasSteward(id) ? (state.advice || []).filter(a => a.board === id && !a.cardId && a.kind !== "state") : [];
function overviewBodyHtml(a0, live) {
  // live: the newest, whose advice he can put to the operator one piece at a time
  const a = Object.assign({}, a0, state.adviceFull[a0.id] || {}),
    o = a.overview;
  const cardLink = cid => {
    const c = cid && state.cards.find(x => x.id === cid);
    return c
      ? '<button type="button" class="tlink on-card" data-act="open-panel" data-id="' +
          esc(c.id) +
          '" title="Open this task">' +
          esc(c.title) +
          " &rarr;</button>"
      : "";
  };
  let h = '<p class="ov-lead">' + esc(a.oneLine || "") + "</p>";
  if (o) {
    if (o.stands)
      h += '<section class="ov-sec"><h5>Where things stand</h5><div class="desc">' + fmt(o.stands) + "</div></section>";
    h +=
      '<section class="ov-sec struggles"><h5>Struggle points <span class="n">' +
      o.struggles.length +
      "</span></h5>" +
      (o.struggles.length
        ? '<ul class="ov-list">' +
          o.struggles.map(x => "<li><span>" + esc(x.text) + "</span>" + cardLink(x.card) + "</li>").join("") +
          "</ul>"
        : '<div class="hint">None it could see.</div>') +
      "</section>";
    if (o.advice.length)
      h +=
        '<section class="ov-sec ov-adv"><h5>Advice</h5><ol class="ov-list">' +
        o.advice
          .map((x, i) => {
            const put = (a.puts || {})[i];
            return (
              "<li><span>" +
              esc(x.text) +
              "</span>" +
              cardLink(x.card) +
              (live && state.canTalk
                ? '<div class="decide">' +
                  (put
                    ? '<span class="decided">put to the operator ' + esc(fmtTime(put.t)) + "</span>"
                    : '<button type="button" class="tiny" data-act="st-put" data-id="' +
                      esc(a.id) +
                      '" data-item="' +
                      i +
                      '" title="Hand this piece of advice alone to the operator, quoted, ' +
                      (x.card ? "on its task" : "in General") +
                      ', to answer: your act, like Send">Put to the operator</button>') +
                  "</div>"
                : "") +
              "</li>"
            );
          })
          .join("") +
        "</ol></section>";
    if (o.since)
      h +=
        '<section class="ov-sec"><h5>Since ' +
        (a.since ? esc(fmtTime(a.since)) : "the last one") +
        '</h5><div class="desc">' +
        fmt(o.since) +
        "</div></section>";
  } else if (a.text)
    h += '<div class="desc">' + fmt(a.text) + "</div>"; // a steward on an older kit answers in its own words
  else if (a.more) h += '<div class="hint">Loading&hellip;</div>';
  const more = adviceMoreHtml(a, !o);
  if (!live) return h + more;
  if (more || a.more)
    h +=
      '<details class="more" data-adv="' +
      esc(a.id) +
      '"' +
      (state.adviceOpen.has(a.id) ? " open" : "") +
      "><summary>Why</summary>" +
      (more || '<div class="hint">Loading the reasons&hellip;</div>') +
      "</details>";
  return h;
}
function overviewHtml(id) {
  // full screen, in the column where a task has its context and status
  if (!hasSteward(id))
    return (
      '<div class="ov"><div class="ov-head"><h4>Overview</h4></div><p class="ov-empty">This machine has no steward, ' +
      "so there is no overview. The conversation is beside it.</p></div>"
    );
  const all = overviewsOf(id),
    a = all[0],
    sw = (state.stewards || {})[id] || {},
    busy = activeReq(id, null, "state");
  let h = '<div class="ov"><div class="ov-head"><h4>Overview</h4>';
  if (a)
    h +=
      '<span class="meta">' +
      esc(fmtTime(a.t)) +
      " &middot; " +
      (a.auto ? "on the two-hour clock" : "you asked") +
      "</span>";
  if (sw.overviewNext)
    h +=
      '<span class="meta" title="Every two hours of shift, counted from the last one; pressing Refresh now ' +
      'restarts the two hours">next about ' +
      esc(fmtTime(sw.overviewNext)) +
      "</span>";
  else if (!busy)
    h += '<span class="meta" title="None is written off shift; Refresh now still works">the next comes on shift</span>';
  if (state.canTalk)
    h +=
      '<button type="button" class="tiny" data-act="st-press" data-kind="state" data-board="' +
      esc(id) +
      '"' +
      (busy
        ? " disabled>Writing&hellip;"
        : ' title="A fresh overview now; the next automatic one comes two hours after it">Refresh now') +
      "</button>";
  h += stewardStateHtml(id) + "</div>" + requestsHtml(id, null, r => r.kind === "state");
  h += a
    ? overviewBodyHtml(a, true)
    : '<p class="ov-empty">No overview yet. The steward writes one twenty minutes into a shift and every two hours ' +
      "after it, or now when you press Refresh now.</p>";
  const old = all.slice(1, 13),
    k = "ov:" + id;
  if (old.length)
    h +=
      '<details class="ov-earlier" data-fold="' +
      esc(k) +
      '"' +
      (state.unfold.has(k) ? " open" : "") +
      "><summary>Earlier overviews (" +
      old.length +
      ")</summary>" +
      old
        .map(
          x =>
            '<details class="ov-old" data-adv="' +
            esc(x.id) +
            '"' +
            (state.adviceOpen.has(x.id) ? " open" : "") +
            "><summary>" +
            whenHtml(x.t) +
            "<span>" +
            esc(x.oneLine || "") +
            "</span></summary>" +
            (state.adviceOpen.has(x.id) ? '<div class="ov">' + overviewBodyHtml(x, false) + "</div>" : "") +
            "</details>",
        )
        .join("") +
      "</details>";
  return h + "</div>";
}
function overviewLineHtml(id) {
  // General in the side panel: the overview in one line, which opens it full screen
  if (!hasSteward(id)) return "";
  const a = overviewsOf(id)[0],
    busy = activeReq(id, null, "state"),
    n = a && a.overview ? a.overview.struggles.length : 0,
    fresh = !!a && (a.t || "") > seenSince("general:" + id);
  let h =
    '<div class="stew gstew"><div class="gstew-bar"><button type="button" class="ov-line' +
    (fresh ? " fresh" : "") +
    '" data-act="ov-open" title="Open the overview full screen"><span class="k">Overview</span>';
  h += a
    ? '<span class="at">' +
      esc(fmtTime(a.t)) +
      "</span>" +
      (n ? '<span class="sp">' + n + (n === 1 ? " struggle point" : " struggle points") + "</span>" : "") +
      '<span class="hl">' +
      esc(a.oneLine || "") +
      "</span>"
    : '<span class="hl">' + (busy ? "the first is being written" : "none yet") + "</span>";
  h += "</button>";
  if (state.canTalk)
    h +=
      '<button type="button" class="tiny" data-act="st-press" data-kind="state" data-board="' +
      esc(id) +
      '"' +
      (busy
        ? " disabled>Writing&hellip;"
        : ' title="A fresh overview now; the next automatic one comes two hours after it">Refresh') +
      "</button>";
  return h + stewardStateHtml(id) + "</div>" + requestsHtml(id, null, r => r.kind === "state") + "</div>";
}
function explainerHtml() {
  // the document he asked for: the skill's diagram and the explanation, laid out by the board itself (no page the
  // model wrote is ever shown)
  const a0 = (state.advice || []).find(x => x.id === state.explain);
  if (!a0) return "";
  const a = Object.assign({}, a0, state.adviceFull[a0.id] || {});
  const c = state.cards.find(x => x.id === a.cardId);
  return (
    '<div class="explainer-view" role="dialog" aria-modal="true" aria-label="Explainer"><div class="doc"><div ' +
    'class="p-head"><h3>' +
    esc(c ? c.title : "Explainer") +
    ('</h3><button class="close" type="button" data-act="st-close" aria-label="Close">&#x2715;</button></div><div ' +
      'class="aline">') +
    esc(a.oneLine || "") +
    "</div>" +
    (a.diagram
      ? '<a href="/api/attachments/' +
        esc(a.diagram) +
        '" target="_blank" rel="noopener" title="Open the diagram full size"><img src="/api/attachments/' +
        esc(a.diagram) +
        '" alt="The diagram"></a><div class="hint">Tap the diagram to open it full size.</div>'
      : "") +
    (a.text ? "" : '<div class="hint">Loading the explanation&hellip;</div>') +
    (a.text ? '<div class="desc">' + fmt(a.text) + "</div>" : "") +
    '<div class="hint">' +
    esc((a.skill || "diagram-design") + " · " + (a.model || "") + " · " + fmtTime(a.t)) +
    "</div></div></div>"
  );
}
