// ---------- a board's tab: its head, its lanes and its side box ----------
function boardHtml(id) {
  const b = state.boards[id] || {},
    cards = cardsOf(id);
  const act = Array.isArray(b.activity) ? b.activity.slice().sort((x, y) => (y.t || "").localeCompare(x.t || "")) : [];
  let h =
    '<section class="view' +
    (state.view === id ? " active" : "") +
    '" id="board-' +
    id +
    '" role="tabpanel" aria-labelledby="tab-' +
    id +
    '">';
  h +=
    '<div class="board-head"><h2>' +
    esc(b.name || boardLabel(id)) +
    "</h2>" +
    (b.machine ? '<span class="machine">' + esc(b.machine) + "</span>" : "") +
    presenceHtml(id, b);
  if (state.canTalk)
    h += '<button type="button" class="pill primary" data-act="newtask" data-id="' + id + '">New task</button>';
  {
    const nu = unreadGeneral(id),
      which = sideOf(id),
      n = Object.keys(state.bundle.parts).length + (state.bundle.general ? 1 : 0);
    h +=
      '<button type="button" class="pill" data-act="drawer" data-id="' +
      id +
      '" aria-pressed="' +
      (which === "general") +
      '">General' +
      (nu ? ' <span class="badge new">' + nu + "</span>" : "") +
      "</button>";
    {
      // on a phone the secondary controls fold behind one button, so the head stays uncluttered
      const tucked = unreadOps(id) + unreadTranscript(id) + n,
        open = state.more.has(id);
      h +=
        '<button type="button" class="pill more-btn" data-act="more" data-id="' +
        id +
        '" aria-pressed="' +
        open +
        '" title="Bundle, Ops, Transcript, detail and card controls">' +
        (open ? "Less" : "More") +
        (tucked && !open ? ' <span class="badge dim">' + tucked + "</span>" : "") +
        "</button>";
      h += '<span class="tools2' + (open ? " open" : "") + '">';
    }
    if (state.canTalk)
      h +=
        '<button type="button" class="pill bundle-btn" data-act="bundle-toggle" data-id="' +
        id +
        '" aria-pressed="' +
        (which === "bundle") +
        ('" title="One message addressing several tasks: pick the tasks, write a comment for each, attach images ' +
          'to each, send once">Bundle') +
        (state.bundle.on && state.bundle.board === id && n ? ' <span class="badge">' + n + "</span>" : "") +
        "</button>";
    {
      const no = unreadOps(id);
      h +=
        '<button type="button" class="pill ops-btn" data-act="ops" data-id="' +
        id +
        '" aria-pressed="' +
        (which === "ops") +
        ('" title="The operator\'s notes about its own machinery: watchers, sweeps, restarts. Nothing here needs ' +
          'you.">Ops') +
        (no ? ' <span class="badge dim">' + no + "</span>" : "") +
        "</button>";
    }
    h +=
      '<button type="button" class="pill tx-btn" data-act="transcript" data-id="' +
      id +
      '" aria-pressed="' +
      (which === "transcript") +
      ('" title="Everything you and the operator say to each other, in order: its chat, and on a tool board what ' +
        'its tools put on the board, each with its card. Write there to talk to it directly.">Transcript') +
      (unreadTranscript(id) ? ' <span class="badge new">new</span>' : "") +
      "</button>";
  }
  h +=
    '<span class="density" role="group" aria-label="Card detail"><button type="button" data-act="density" ' +
    'data-v="0" aria-pressed="' +
    !state.detailed +
    '">Compact</button><button type="button" data-act="density" data-v="1" aria-pressed="' +
    state.detailed +
    '">Detailed</button></span>';
  {
    const mine = cards.map(c => c.id),
      openN = mine.filter(x => state.expanded.has(x)).length;
    h +=
      '<span class="density cardctl" role="group" aria-label="Open or collapse every card"><button type="button" ' +
      'data-act="cards-open" data-id="' +
      id +
      ('" title="Open every card on this board">Open all</button><button type="button" data-act="cards-collapse" ' +
        'data-id="') +
      id +
      '" title="Collapse every open card on this board (Escape does the same)"' +
      (openN ? "" : " disabled") +
      ">Collapse all" +
      (openN ? " (" + openN + ")" : "") +
      "</button></span>";
  }
  h += "</span>";
  if (act.length)
    h +=
      '<div class="activity">' +
      whenHtml(act[0].t) +
      '<span class="latest" title="' +
      esc(act[0].text) +
      '">' +
      actHtml(act[0].text) +
      '</span><button class="pill" type="button" data-act="hist" data-id="' +
      id +
      '">' +
      (state.activityOpen === id ? "hide" : "history") +
      "</button></div>";
  h += "</div>";
  h += usageHtml(b, id);
  h += handoffHtml(id, b);
  if (state.activityOpen === id && act.length)
    h +=
      '<div class="activity-list" id="actlist-' +
      id +
      '">' +
      act
        .slice(0, 12)
        .map(a => "<div>" + whenHtml(a.t) + "<span>" + actHtml(a.text) + "</span></div>")
        .join("") +
      "</div>";
  h += conductHtml(id);
  h += '<div class="board-body" id="body-' + id + '"><div class="lanes" id="lanes-' + id + '">';
  const num = v => (v == null || v === "" || isNaN(Number(v)) ? Infinity : Number(v));
  COLS.forEach(([key, label]) => {
    let list = cards.filter(c => c.status === key);
    if (key === "done") list.sort((a, b2) => (b2.updatedAt || "").localeCompare(a.updatedAt || ""));
    else list.sort((a, b2) => num(a.order) - num(b2.order) || (b2.updatedAt || "").localeCompare(a.updatedAt || ""));
    const cap = COL_CAP[key],
      colKey = id + ":" + key,
      capped = cap && list.length > cap && !state.expandedCols.has(colKey);
    const shown = capped ? list.slice(0, cap) : list;
    const folded = state.folded.has(colKey),
      hasAsk = list.some(c => openAsks(c).length);
    h +=
      '<div class="lane ' +
      key +
      (folded ? " folded" : "") +
      '" id="lane-' +
      id +
      "-" +
      key +
      '"><div class="lane-head" data-act="lane" data-id="' +
      esc(colKey) +
      '" role="button" tabindex="0" aria-expanded="' +
      !folded +
      '" title="' +
      (folded ? "Open this lane" : "Fold this lane to a strip") +
      '"><h3>' +
      label +
      '</h3><span class="n">' +
      list.length +
      "</span>" +
      (folded && hasAsk ? '<span class="dot" title="an ask waits in this lane"></span>' : "") +
      '<span class="chev" aria-hidden="true">' +
      (folded ? "&#x25B8;" : "&#x25BE;") +
      '</span></div><div class="lane-body" id="lb-' +
      id +
      "-" +
      key +
      '">';
    h += shown.length ? shown.map(cardHtml).join("") : '<div class="col-empty">none</div>';
    if (cap && list.length > cap)
      h +=
        '<button class="more-col" type="button" data-act="col" data-id="' +
        esc(colKey) +
        '">' +
        (capped ? "Show all " + list.length : "Show fewer") +
        "</button>";
    h += "</div></div>";
  });
  h += "</div></div>" + sideHtml(id);
  return h + "</section>";
}
function unopenedAsks() {
  // Home shows only the ACTION items he has not opened yet, newest first, at most ten.
  const items = [];
  state.cards
    .filter(c => c.status !== "done")
    .forEach(c =>
      openAsks(c).forEach(d => {
        const seen = state.seen[c.id] || "";
        if (!d.openedAt || d.openedAt > seen)
          items.push({ board: c.board, card: c, ask: d.ask || "", t: d.openedAt || c.updatedAt || "" });
      }),
    );
  return items.sort((a, b) => (b.t || "").localeCompare(a.t || "")).slice(0, 10);
}
