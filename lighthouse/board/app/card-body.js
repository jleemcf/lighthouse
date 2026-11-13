// ---------- the card body, shared by the expanded card, the panel and the full-screen card ----------
function cardBodyHtml(c, where, split) {
  // split: the task and the talk apart, for the full-screen card's two columns
  const asks = openAsks(c),
    log = sortedLog(c),
    view = where === "panel" ? (state.panelView === "all" ? "all" : "current") : "current";
  const thread = (state.threads[c.id] || []).slice().sort((a, b) => (a.t || "").localeCompare(b.t || ""));
  const laneLabel = (COLS.find(x => x[0] === c.status) || ["", c.status])[1];
  let h = "",
    t = ""; // h: the task (its asks, the steward, its status); t: the talk (the conversation and the box to write in)
  if (c.lite) h += '<div class="hint">Loading the whole card&hellip;</div>';
  h +=
    '<div class="lane-tag ' +
    esc(c.status) +
    '">' +
    esc(laneLabel) +
    (asks.length ? " &middot; needs " + esc(ownerLabel()) : "");
  if (where !== "panel")
    h +=
      '<span class="jump" role="group" aria-label="Jump"><button type="button" data-act="jump" data-where="card" ' +
      'data-id="' +
      esc(c.id) +
      ('" data-dir="top" title="Jump to the top of this card">&#x2912;</button><button type="button" ' +
        'data-act="jump" data-where="card" data-id="') +
      esc(c.id) +
      '" data-dir="end" title="Jump to the newest, and the box to answer in">&#x2913;</button></span>';
  if (where === "panel")
    h +=
      '<span class="density" role="group" aria-label="Panel view"><button type="button" data-act="pview" ' +
      'data-v="current" aria-pressed="' +
      (view === "current") +
      '">Current</button><button type="button" data-act="pview" data-v="all" aria-pressed="' +
      (view === "all") +
      '">Everything in order</button></span>';
  h += "</div>";
  asks.forEach(d => {
    // the ask, with the detail the operator wrote beneath its line (options, a suggested prompt), so it reads whole
    // here without the full history
    const src = log.find(e => (e.kind === "ACTION" || e.kind === "PROMPT") && e.t === d.openedAt && e.body);
    // the operator's tags on the ask: its recommendation and a ping held for the digest; the steward's second opinion
    // never sees the recommendation, Owner always does
    const tags = [];
    if (d.options && d.options.length)
      tags.push(
        "<span>" +
          d.options.map((o, i) => "<b>" + String.fromCharCode(65 + i) + ".</b> " + esc(o)).join(" &middot; ") +
          "</span>",
      );
    if (d.recommendation)
      tags.push("<span><b>Operator recommends:</b> " + esc(String(d.recommendation).replace(/_/g, " ")) + "</span>");
    if (d.heldPing && !d.heldReleased)
      tags.push("<span><b>Not urgent:</b> your phone hears of it with the next digest</span>");
    {
      const v = stewardVerdict(c, d);
      if (v) tags.push(v);
    }
    h +=
      '<div class="ask">' +
      esc(d.ask || "See the latest ACTION entry.") +
      (tags.length ? '<div class="ask-tags">' + tags.join("") + "</div>" : "") +
      (src ? '<div class="ask-detail">' + fmt(src.body) + "</div>" : "") +
      (state.canTalk
        ? '<div class="decide"><button type="button" class="tiny" data-act="ask-done" data-id="' +
          esc(c.id) +
          '" data-did="' +
          esc(d.id || "") +
          '" title="You have dealt with this; take the red away">Handled</button></div>'
        : "") +
      "</div>";
  });
  h += stewardCardHtml(c);
  // full screen: the context heads the task column, whole
  if (split && c.context) h += "<h5>Context</h5>" + '<div class="desc context">' + fmt(c.context) + "</div>";
  if (view === "current") {
    // in the panel the context is pinned at the top instead
    if (c.context && where !== "panel") {
      const long = isLong(c.context) && !state.unfold.has("ctx:" + c.id);
      h +=
        "<h5>Context</h5>" +
        '<div class="desc context' +
        (long ? " folded" : "") +
        '">' +
        fmt(c.context) +
        "</div>" +
        (long
          ? '<button type="button" class="unfold" data-act="unfold" data-key="ctx:' + esc(c.id) + '">Show all</button>'
          : "");
    }
    h += "<h5>Status</h5>";
    h += c.description
      ? '<div class="desc">' + fmt(c.description) + "</div>"
      : '<div class="desc muted">No status from the operator yet.</div>';
    if (c.detail) h += '<div class="desc detail">' + fmt(c.detail) + "</div>";
    const hist = log.filter(e => e.kind === "STATUS").slice(1);
    if (hist.length)
      h +=
        '<details class="hist" id="hist-' +
        esc(c.id) +
        '"' +
        (state.histOpen ? " open" : "") +
        "><summary>earlier statuses (" +
        hist.length +
        ')</summary><div class="log">' +
        hist.map(entryHtml).join("") +
        "</div></details>";
    h += '<dl class="p-meta">';
    if (c.source) h += "<dt>opened by</dt><dd>" + esc(String(c.source).replace(/^operator:/, "")) + "</dd>";
    if (c.severity) h += "<dt>severity</dt><dd>" + esc(c.severity) + "</dd>";
    if (c.complexity) h += "<dt>complexity</dt><dd>" + esc(c.complexity) + "</dd>";
    if (c.nature) h += "<dt>nature</dt><dd>" + esc(c.nature) + "</dd>";
    if (c.updatedAt)
      h +=
        "<dt>updated</dt><dd>" +
        esc(fmtTime(c.updatedAt)) +
        (" " + (state.timeZoneLabel || state.timeZone || "UTC")) +
        (c.updatedBy ? " by " + esc(c.updatedBy) : "") +
        "</dd>";
    h += "</dl>";
    t += "<h5>Conversation</h5>";
    {
      // statuses ride in the conversation in time order, as slim teal notes between the messages, so the story reads
      // without the Everything view; the latest status still sits above. A STATUS that answered him is already a
      // message.
      const asMsg = new Set(thread.filter(m => m.label === "STATUS").map(m => m.t || ""));
      const items = thread
        .map(m => ({ t: m.t || "", html: msgHtml(m) }))
        .concat(
          log
            .filter(e => e.kind === "STATUS" && !asMsg.has(e.t || ""))
            .map(e => ({ t: e.t || "", html: statusNoteHtml(e) })),
          stewardTalk(c),
        )
        .sort((a, b) => a.t.localeCompare(b.t));
      const keep = where === "panel" ? 20 : 8,
        key = "card:" + c.id + ":" + where,
        all = state.unfold.has(key),
        shown = all || items.length <= keep ? items : items.slice(-keep);
      let fold = "";
      if (items.length > keep)
        fold = all
          ? '<div class="fold"><button type="button" class="unfold" data-act="fold" data-key="' +
            esc(key) +
            '">Show the newest ' +
            keep +
            " only</button></div>"
          : '<div class="fold"><button type="button" class="unfold" data-act="unfold" data-key="' +
            esc(key) +
            '">Show ' +
            (items.length - keep) +
            (' earlier</button><span class="hint">The latest status is above; the whole history is in Everything ' +
              "in order.</span></div>");
      const pend = pendingHtml("card:" + c.id),
        foot = stewardFoot(c);
      t +=
        items.length || pend || foot
          ? fold + '<div class="thread">' + shown.map(x => x.html).join("") + pend + foot + "</div>"
          : '<div class="thread-empty">Nothing yet. Write to the operator below.</div>';
    }
  } else {
    // a log line that is also a message shows once, as the message: an ACTION, PROMPT or RELAYED, and in tool mode a
    // REPLY too
    const inThread = new Set(thread.filter(m => m.label).map(m => m.label + "|" + (m.t || "")));
    const stream = log
      .filter(e => !inThread.has((e.kind || "") + "|" + (e.t || "")))
      .map(e => ({ t: e.t || "", html: entryHtml(e) }))
      .concat(
        thread.map(m => ({ t: m.t || "", html: msgHtml(m) })),
        stewardTalk(c),
      )
      .sort((a, b) => a.t.localeCompare(b.t));
    t += "<h5>Everything, oldest first</h5>";
    const pend = pendingHtml("card:" + c.id),
      foot = stewardFoot(c);
    t +=
      stream.length || pend || foot
        ? '<div class="stream">' + stream.map(x => x.html).join("") + pend + foot + "</div>"
        : '<div class="thread-empty">Nothing yet.</div>';
  }
  t += composerHtml("card:" + c.id, {
    form: "comment",
    placeholder: "Write to the operator: an answer, a steer, a question. Paste an image if it helps.",
    label: "Message to the operator about this task",
    note: "Posted under the identity this page was opened with; the server records who wrote it.",
  });
  return split ? { task: h, talk: t } : '<div class="cbody">' + h + t + "</div>";
}
const pirateShip =
  '<svg viewBox="0 0 36 24" aria-hidden="true"><path d="M2 17h32l-5 5H8z" fill="#49362f" stroke="#25333c" ' +
  'stroke-width="1"/><path d="M7 18h23l-2 2H9z" fill="#a16b43"/><path d="M17 2h2v16h-2z" fill="#523c32"/><path ' +
  'd="M16 4L5 14h11z" fill="#e6d4ad" stroke="#795c45" stroke-width="1"/><path d="M20 5h11v9H20z" ' +
  'fill="#25333c"/><path d="M23 7h5v4h-5z" fill="#f2e9d4"/><path d="M24 8h1v1h-1zm2 0h1v1h-1zm-1 2h1v1h-1z" ' +
  'fill="#25333c"/><path d="M18 2h9l-3 2h-6z" fill="#c8352b"/><path d="M29 15h5v2h-5z" fill="#25333c"/></svg>';
const paperBoat =
  '<svg viewBox="0 0 38 24" aria-hidden="true"><path d="M2 16h34l-6 6H8z" fill="#f7f2e7" stroke="#487db0" ' +
  'stroke-width="1.5"/><path d="M11 6h16v11H11z" fill="#fff9ed" stroke="#487db0" stroke-width="1"/><path d="M11 ' +
  '7l8 6 8-6" fill="none" stroke="#487db0" stroke-width="1"/><path d="M2 16l17 5 17-5" fill="none" ' +
  'stroke="#487db0" stroke-width="1"/><path d="M18 9h2v2h-2z" fill="#c9640f"/></svg>';
