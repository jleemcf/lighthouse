// ---------- cards: the card on its lane, the side panel, the full-screen task list, New task ----------
function cardSignalHtml(kind) {
  if (kind === "raid")
    return (
      '<div class="card-signal raid" aria-hidden="true"><span class="sea"></span><span class="ship port">' +
      pirateShip +
      '</span><span class="ship starboard">' +
      pirateShip +
      ('</span><span class="target">!</span><span class="shot port"></span><span class="shot ' +
        'starboard"></span><span class="burst"></span></div>')
    );
  if (kind === "mail")
    return (
      '<div class="card-signal mail" aria-hidden="true"><span class="sea"></span><span ' +
      'class="mail-ripple"></span><span class="paper-boat">' +
      paperBoat +
      '</span><span class="mail-label">new from operator</span></div>'
    );
  return "";
}
function crmDeliveryHtml(c) {
  if (!c.crm?.state) return "";
  const label =
    c.crm.state === "failed" ? "failed: " + (c.crm.failure?.retrying ? "retrying" : "retries stopped") : c.crm.state;
  return (
    '<span class="badge ' +
    (c.crm.state === "failed" ? "red" : "dim") +
    '" role="status">CRM answer: ' +
    esc(label) +
    "</span>"
  );
}
function cardHtml(c) {
  const asks = openAsks(c),
    open = state.expanded.has(c.id),
    log = sortedLog(c),
    nu = unreadCard(c);
  const signal = asks.length ? "raid" : nu ? "mail" : "";
  const cls = ["card", c.status];
  if (asks.length) cls.push("action");
  if (signal) cls.push("attention-" + signal);
  if (open) cls.push("open");
  // a card drags only while the bundle box is open on its board: a draggable card swallows the mouse, and its text
  // cannot be selected or copied
  const drag = state.bundle.on && state.bundle.board === c.board;
  let h =
    '<article id="card-' +
    esc(c.id) +
    '" class="' +
    cls.join(" ") +
    '" data-card="' +
    esc(c.id) +
    '" tabindex="0" role="button" aria-expanded="' +
    open +
    '"' +
    (drag ? ' draggable="true"' : "") +
    ">";
  if (state.canTalk)
    h +=
      '<button type="button" class="badd" data-act="bundle-add" data-id="' +
      esc(c.id) +
      '" title="Add this task to a bundled message" aria-label="Add to bundle">+</button>';
  h += "<h4>" + esc(c.title) + "</h4>";
  {
    asks.forEach(d => {
      h += '<div class="ask">' + esc(d.ask || "See the latest ACTION entry.") + "</div>";
    });
    if (state.detailed && c.description) h += '<div class="inline-desc">' + esc(c.description) + "</div>";
    const badges = [crmDeliveryHtml(c)];
    if (asks.length > 1) badges.push('<span class="badge red">' + asks.length + " asks</span>");
    if (nu)
      badges.push(
        '<span class="badge new" title="operator lines or messages since you last opened this card">' +
          nu +
          " new</span>",
      );
    if (c.severity) badges.push('<span class="badge dim" title="severity">' + esc(c.severity) + "</span>");
    {
      const n = c.lite ? c.logN || 0 : log.length;
      if (n) badges.push('<span class="badge dim">' + n + " log</span>");
    }
    if (badges.length) h += '<div class="badges">' + badges.join("") + "</div>";
    if (state.detailed && log.length) {
      const e = log[0],
        kind = KINDS.includes(e.kind) ? e.kind : "FYI";
      h +=
        '<div class="badges"><span class="badge ' +
        kind +
        '">' +
        kind +
        '</span><span class="badge dim">' +
        esc(fmtTime(e.t)) +
        "</span></div>";
    }
  }
  h += cardSignalHtml(signal);
  h += '<div class="cx" id="cx-' + esc(c.id) + '"><div class="cxi">';
  if (open)
    h +=
      '<div class="cx-bar"><button type="button" class="pill" data-act="open-panel" data-id="' +
      esc(c.id) +
      '">Open in panel</button><button type="button" class="pill" data-act="collapse" data-id="' +
      esc(c.id) +
      '">Collapse</button></div>' +
      cardBodyHtml(c, "card");
  h += "</div></div></article>";
  return h;
}
function panelHtml() {
  const c = state.cards.find(x => x.id === state.panel);
  if (!c) return "";
  const jump =
    '<span class="jump" role="group" aria-label="Jump"><button type="button" data-act="jump" data-where="panel" ' +
    'data-dir="top" title="Jump to the top">&#x2912;</button><button type="button" data-act="jump" ' +
    'data-where="panel" data-dir="end" title="Jump to the newest">&#x2913;</button></span>';
  if (state.wide || state.panelWide) {
    const b = cardBodyHtml(c, "panel", true);
    return (
      '<div class="backdrop" data-act="close-panel" id="backdrop"></div><aside class="panel wide" id="panel" ' +
      'role="dialog" aria-modal="true" aria-label="' +
      esc(c.title) +
      '"><div class="pw-head"><h3 title="' +
      esc(c.title) +
      '">' +
      esc(c.title) +
      "</h3>" +
      wideBtn(true) +
      jump +
      ('<button class="close" type="button" data-act="close-panel" aria-label="Close">&#x2715;</button></div><div ' +
        'class="pw-main">') +
      railHtml(c) +
      '<div class="pw-body"><section class="pw-task" aria-label="The task">' +
      crmDeliveryHtml(c) +
      b.task +
      '</section><section class="pw-talk" id="panel-talk" aria-label="The conversation">' +
      b.talk +
      "</section></div></div></aside>"
    );
  }
  // the title and the task's context stay pinned at the top while the panel scrolls
  return (
    '<div class="backdrop" data-act="close-panel" id="backdrop"></div><aside class="panel" id="panel" ' +
    'role="dialog" aria-modal="true" aria-label="' +
    esc(c.title) +
    '"><div class="p-top"><div class="p-head"><h3>' +
    esc(c.title) +
    "</h3>" +
    wideBtn() +
    ('<span class="jump" role="group" aria-label="Jump"><button type="button" data-act="jump" data-where="panel" ' +
      'data-dir="top" title="Jump to the top">&#x2912;</button><button type="button" data-act="jump" ' +
      'data-where="panel" data-dir="end" title="Jump to the newest">&#x2913;</button></span><button class="close" ' +
      'type="button" data-act="close-panel" aria-label="Close">&#x2715;</button></div>') +
    crmDeliveryHtml(c) +
    (c.context
      ? '<div class="context-pin"><h5>Context</h5><div class="desc context">' + fmt(c.context) + "</div></div>"
      : "") +
    "</div>" +
    cardBodyHtml(c, "panel") +
    "</aside>"
  );
}
function railHtml(c) {
  // a machine's open tasks by lane, Done left out; the open card marked, a red dot where an ask waits
  // the machine shown is the open card's, until he picks another at the top
  const rb = boardIds().includes(state.railBoard) ? state.railBoard : c.board,
    name = id => (state.boards[id] || {}).name || boardLabel(id) || id;
  const cards = state.cards.filter(x => x.board === rb && x.status !== "done");
  if (!state.rail)
    return (
      '<nav class="pw-rail shut" id="pw-rail" aria-label="Tasks"><button type="button" class="rail-btn" ' +
      'data-act="rail" aria-expanded="false" title="Show the task list">&#x00BB;</button>' +
      (state.cards.some(x => x.id !== c.id && x.status !== "done" && openAsks(x).length)
        ? '<span class="rail-dot" title="an ask waits on another task"></span>'
        : "") +
      "</nav>"
    );
  const num = v => (v == null || v === "" || isNaN(Number(v)) ? Infinity : Number(v));
  // the machine is a dropdown in the list's header, with a red dot on it while an ask waits on another machine
  const waits = id => (n => (n ? ", " + n + (n === 1 ? " ask waits" : " asks wait") : ""))(actionCount(id)),
    elsewhere = boardIds().some(id => id !== rb && actionCount(id));
  let h =
    '<nav class="pw-rail" id="pw-rail" aria-label="Tasks"><div class="rail-top"><div class="rail-pick"><button ' +
    'type="button" class="rail-pick-btn" data-act="rail-menu" aria-haspopup="true" aria-expanded="' +
    !!state.railMenu +
    '" title="Switch machine' +
    (elsewhere ? "; an ask waits on another machine" : "") +
    '"><span class="nm">' +
    esc(name(rb)) +
    " tasks</span>" +
    (elsewhere ? '<span class="dot" aria-label="an ask waits on another machine"></span>' : "") +
    '<span class="caret" aria-hidden="true">&#x25BE;</span></button>';
  if (state.railMenu)
    h +=
      '<div class="rail-menu" role="menu" aria-label="Machine">' +
      boardIds()
        .map(id => {
          const n = actionCount(id),
            on = id === rb;
          return (
            '<button type="button" role="menuitemradio" aria-checked="' +
            on +
            '" data-act="rail-board" data-id="' +
            id +
            '" title="' +
            esc(name(id)) +
            "'s tasks" +
            waits(id) +
            '"><span class="tick" aria-hidden="true">' +
            (on ? "&#x2713;" : "") +
            '</span><span class="nm">' +
            esc(name(id)) +
            "</span>" +
            (n ? '<span class="count">' + n + "</span>" : "") +
            "</button>"
          );
        })
        .join("") +
      "</div>";
  h +=
    '</div><button type="button" class="rail-btn" data-act="rail" aria-expanded="true" title="Fold the task ' +
    'list">&#x00AB;</button></div>';
  // General pinned above the lanes, to go between it and the tasks; c.id is null while General is the one open
  {
    const on = !c.id && c.board === rb,
      nu = on ? 0 : unreadGeneral(rb);
    h +=
      '<button type="button" class="rail-item rail-gen' +
      (on ? " on" : "") +
      '" data-act="rail-general" data-id="' +
      esc(rb) +
      '"' +
      (on ? ' aria-current="page"' : "") +
      ' title="' +
      esc(name(rb)) +
      ('\'s General: the steward\'s overview and the conversation"><span class="gdot" ' +
        'aria-hidden="true"></span><span class="t">General</span>') +
      (nu ? '<span class="badge new">' + nu + "</span>" : "") +
      "</button>";
  }
  if (!cards.length) h += '<p class="rail-none">No open tasks on ' + esc(name(rb)) + ".</p>";
  COLS.filter(([k]) => k !== "done").forEach(([key, label]) => {
    const list = cards
      .filter(x => x.status === key)
      .sort((a, b) => num(a.order) - num(b.order) || (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    if (!list.length) return;
    h +=
      '<div class="rail-group ' +
      key +
      '"><h5>' +
      label +
      '<span class="n">' +
      list.length +
      "</span></h5>" +
      list
        .map(x => {
          const on = x.id === c.id,
            nu = on ? 0 : unreadCard(x);
          return (
            '<button type="button" class="rail-item' +
            (on ? " on" : "") +
            '" data-act="open-panel" data-id="' +
            esc(x.id) +
            '"' +
            (on ? ' aria-current="page"' : "") +
            ' title="' +
            esc(x.title) +
            '">' +
            (openAsks(x).length ? '<span class="ask-dot" aria-label="an ask waits"></span>' : "") +
            '<span class="t">' +
            esc(x.title) +
            "</span>" +
            (nu ? '<span class="badge new">' + nu + "</span>" : "") +
            "</button>"
          );
        })
        .join("") +
      "</div>";
  });
  return h + "</nav>";
}
const wideBtn = (on = state.wide) =>
  '<button type="button" class="wide-btn" data-act="wide" aria-pressed="' +
  on +
  '" title="' +
  (on ? "Back to a box on the side" : "Fill the screen, to see more at once") +
  '">' +
  (on ? "Side panel" : "Full screen") +
  "</button>";
function newTaskHtml() {
  const id = state.newTask;
  if (!id) return "";
  const nt = state.nt,
    sel = (name, opts) =>
      "<label>" +
      name +
      '<select data-nt="' +
      name +
      '">' +
      opts
        .map(o => '<option value="' + o + '"' + (nt[name] === o ? " selected" : "") + ">" + o + "</option>")
        .join("") +
      "</select></label>";
  const before =
    '<div class="field"><label>Title<input type="text" data-nt="title" value="' +
    esc(nt.title) +
    '" placeholder="A short plain name for the task"></label></div><div class="fields">' +
    sel("severity", ["low", "medium", "high"]) +
    sel("complexity", ["small", "medium", "large"]) +
    sel("nature", ["ops", "feature", "bug", "design", "docs", "test"]) +
    "</div>";
  return (
    '<div class="backdrop" data-act="newtask-close" id="backdrop"></div><aside class="panel" id="newtask" ' +
    'role="dialog" aria-modal="true" aria-label="New task"><div class="p-head"><h3>New task on ' +
    esc(boardLabel(id)) +
    ('</h3><button class="close" type="button" data-act="newtask-close" ' +
      'aria-label="Close">&#x2715;</button></div><p class="desc muted">This goes to the operator as a ready-made ' +
      "request to open the task in its own words; the card appears when it does.</p>") +
    composerHtml("newtask:" + id, {
      form: "newtask",
      before: before,
      placeholder: "What the task is, in your words: what you want, why, what done looks like.",
      label: "Task description",
      send: "Send the request",
      note: "Sent to the operator, tagged general.",
    }) +
    "</aside>"
  );
}
