// ---------- the side boxes: General, Bundle, Ops and the transcript ----------
// General and Bundle are overlays on the right: General a large chat box; Bundle its own composer, one row per picked
// task with its own images, a General part only if he drags the chip in. One shows at a time; opening one never moves
// the lanes.
function sideOf(id) {
  const open = {
    bundle: state.bundle.on && state.bundle.board === id,
    general: state.drawer,
    ops: state.ops === id,
    transcript: state.transcript === id,
  };
  if (state.side && open[state.side]) return state.side;
  return open.bundle ? "bundle" : open.general ? "general" : open.ops ? "ops" : open.transcript ? "transcript" : null;
}
function sideHtml(id) {
  const w = sideOf(id);
  return w === "bundle"
    ? bundleHtml(id)
    : w === "general"
      ? generalHtml(id)
      : w === "ops"
        ? opsHtml(id)
        : w === "transcript"
          ? transcriptHtml(id)
          : "";
}
const unreadTranscript = id => {
  const b = state.boards[id] || {},
    since = seenSince("transcript:" + id);
  return b.transcriptLast && b.transcriptLastRole === "operator" && b.transcriptLast > since;
};
const hasUnreadNotifications = () =>
  state.cards.some(c => unreadCard(c) > 0) ||
  boardIds().some(id => unreadGeneral(id) > 0 || unreadOps(id) > 0 || unreadTranscript(id));
function opsHtml(id) {
  // the Ops box: the operator's housekeeping, in a small box closed by default
  const rows = opsOf(id);
  let h =
    '<aside class="side ops" id="ops-' +
    esc(id) +
    '" aria-label="Operator notes"><div class="dhead"><h3>Ops</h3><span class="n">' +
    rows.length +
    '</span><button type="button" class="close" data-act="ops" data-id="' +
    esc(id) +
    '" aria-label="Close Ops">&#x2715;</button></div>';
  h +=
    '<div class="dbody"><p class="hint">The operator\'s notes about its own machinery: watchers, sweeps, ' +
    "restarts. And, marked <span class=\"badge dim\">board</span>, the board's own corrections to the operator's " +
    "lines. Nothing here needs you.</p>";
  h += rows.length
    ? rows
        .map(
          e =>
            '<div class="opsrow' +
            (e.board ? " bnote" : "") +
            '">' +
            whenHtml(e.t) +
            "<div>" +
            (e.board ? '<span class="badge dim" title="' + esc(e.rule || "") + '">board</span> ' : "") +
            fmt(e.text) +
            (e.line ? '<div class="bline">' + esc(e.line) + "</div>" : "") +
            (e.task ? ' <span class="badge dim">' + esc(e.task.replace(id + "-", "")) + "</span>" : "") +
            "</div></div>",
        )
        .join("")
    : '<div class="thread-empty">Nothing yet.</div>';
  return h + "</div></aside>";
}
function generalHtml(id) {
  const thread =
    state.talkBoard === id ? state.general.slice().sort((x, y) => (x.t || "").localeCompare(y.t || "")) : [];
  // full: one task list on the page at a time, so a task opened from here covers it
  const open = thread.filter(m => isOwnerName(m.by) && !m.handled).length,
    nu = unreadGeneral(id),
    full = state.wide && id === state.view && !state.panel;
  const total = state.talkBoard === id ? Math.max(state.generalTotal || 0, thread.length) : thread.length,
    waiting = state.talkBoard === id && state.generalWaiting != null ? state.generalWaiting : open;
  const count =
    '<span class="n">' +
    total +
    (waiting ? " &middot; " + waiting + " waiting" : "") +
    "</span>" +
    (nu ? '<span class="badge new">' + nu + " new</span>" : "");
  const close =
    '<button type="button" class="close" data-act="drawer" data-id="' +
    esc(id) +
    '" aria-label="Close General">&#x2715;</button>';
  // full screen has a task's frame: the task list, the overview where a task has its context and status, the
  // conversation beside it; the side panel keeps the overview to one line
  let h =
    '<aside class="side general' +
    (full ? " gfull" : "") +
    '" id="general-' +
    esc(id) +
    '" data-drop="' +
    esc(id) +
    '" aria-label="General conversation">';
  if (full)
    h +=
      '<div class="pw-head"><h3>General <span class="on">&middot; ' +
      esc((state.boards[id] || {}).name || boardLabel(id) || id) +
      "</span></h3>" +
      count +
      wideBtn() +
      close +
      '</div><div class="pw-main">' +
      railHtml({ id: null, board: id }) +
      '<div class="pw-body"><section class="pw-task" aria-label="The steward\'s overview">' +
      overviewHtml(id) +
      '</section><section class="pw-talk" aria-label="The conversation">';
  else h += '<div class="dhead"><h3>General</h3>' + count + wideBtn() + close + "</div>" + overviewLineHtml(id);
  // the steward's other words in General sit in the conversation at the time they came, as on a task
  const items = thread
    .map(m => ({ t: m.t || "", html: msgHtml(m) }))
    .concat(generalNotes(id).map(a => ({ t: a.t || "", html: adviceHtml(a, null) })))
    .sort((x, y) => x.t.localeCompare(y.t));
  // the newest 30; the rest a click away
  const GKEEP = 30,
    gkey = "gen:" + id,
    gall = state.unfold.has(gkey),
    gshown = gall || items.length <= GKEEP ? items : items.slice(-GKEEP);
  // the ones not shown, loaded or not
  const earlier = Math.max(0, items.length - GKEEP) + Math.max(0, total - thread.length);
  const gfold = (gall ? items.length > GKEEP : earlier > 0)
    ? '<div class="fold">' +
      (gall
        ? '<button type="button" class="unfold" data-act="fold" data-key="' +
          esc(gkey) +
          '">Show the newest ' +
          GKEEP +
          " only</button>"
        : '<button type="button" class="unfold" data-act="unfold" data-key="' +
          esc(gkey) +
          '">Show ' +
          earlier +
          " earlier</button>") +
      "</div>"
    : "";
  const pend = pendingHtml("general:" + id),
    rq = hasSteward(id) ? requestsHtml(id, null, r => r.kind !== "state") : "",
    foot = rq ? '<div class="stew">' + rq + "</div>" : "";
  // its own id in each layout: the page's redraw cannot move one box into a deeper place and then clear it from the
  // old one
  h +=
    '<div class="dthread" id="dthread-' +
    (full ? "full-" : "") +
    esc(id) +
    '">' +
    (items.length || pend || foot
      ? gfold + gshown.map(x => x.html).join("") + pend + foot
      : '<div class="thread-empty">Nothing yet. Your words here reach the operator tagged general; everything it ' +
        "says that is not about a task appears here.</div>") +
    "</div>";
  h += '<div class="dfoot">';
  if (!state.canTalk) h += '<div class="hint">General works on the self-hosted board.</div>';
  else {
    const stew = hasSteward(id),
      mode = stew && state.genMode[id] === "stew" ? "stew" : "op";
    const toggle = stew
      ? '<div class="gmode" role="group" aria-label="Whom this goes to"><button type="button" data-act="gmode" ' +
        'data-board="' +
        esc(id) +
        '" data-v="op" aria-pressed="' +
        (mode === "op") +
        '">To the operator</button><button type="button" data-act="gmode" data-board="' +
        esc(id) +
        '" data-v="stew" aria-pressed="' +
        (mode === "stew") +
        '">Ask the steward</button></div>'
      : "";
    if (mode === "stew")
      h += composerHtml("stask:" + id, {
        form: "steward-ask",
        cls: "stewmode",
        before: toggle,
        placeholder: "Ask the steward: a concept, a decision, a doubt.",
        label: "A question for the steward",
        send: "Ask",
        note: "Advice only; it never acts.",
        noAttach: true,
      });
    else
      h += composerHtml("general:" + id, {
        form: "general",
        before: toggle,
        placeholder: "Say anything. Paste or attach an image. Drop a card here to start a bundle.",
        label: "General message to the operator",
        note: "Tagged general.",
      });
  }
  return h + "</div>" + (full ? "</section></div></div>" : "") + "</aside>";
}
function bundleHtml(id) {
  const n = Object.keys(state.bundle.parts).length;
  let h =
    '<aside class="side bundle' +
    (state.wide ? " wide" : "") +
    '" id="bundle-' +
    esc(id) +
    '" data-drop="' +
    esc(id) +
    '" aria-label="Bundled message">';
  h +=
    '<div class="dhead"><h3>Bundle</h3><span class="n">' +
    (n ? n + (n === 1 ? " task" : " tasks") : "no tasks yet") +
    "</span>";
  if (state.canTalk && !state.bundle.general)
    h +=
      '<span class="gchip" draggable="true" data-drag="general" data-act="bundle-general" title="Drag into the ' +
      'bundle, or click, to add a part not about one task">General &#x2295;</span>';
  h +=
    wideBtn() +
    '<button type="button" class="close" data-act="bundle-toggle" data-id="' +
    esc(id) +
    '" aria-label="Cancel the bundle">&#x2715;</button></div>';
  h +=
    '<div class="dbody">' +
    (state.canTalk ? bundleFormHtml(id) : '<div class="hint">Bundles work on the self-hosted board.</div>') +
    "</div>";
  return h + "</aside>";
}
function bundleFormHtml(id) {
  const ids = Object.keys(state.bundle.parts),
    key = "bundle:" + id;
  const thumbs = (k, fs) =>
    fs
      .map(
        (f, i) =>
          '<span class="fthumb" title="' +
          esc(f.name) +
          '"><img src="/api/attachments/' +
          esc(f.id) +
          '" alt="' +
          esc(f.name) +
          '"><button type="button" data-act="file-remove" data-key="' +
          esc(k) +
          '" data-i="' +
          i +
          '" aria-label="Remove this image">&#x2715;</button></span>',
      )
      .join("");
  const pfiles = k => {
    const fs = state.files[k] || [];
    return (
      '<div class="pfiles">' +
      (fs.length ? '<span class="files">' + thumbs(k, fs) + "</span>" : "") +
      '<button type="button" class="attach" data-act="attach" data-key="' +
      esc(k) +
      '">Attach image</button><input type="file" accept="image/*" multiple hidden data-file="' +
      esc(k) +
      '"></div>'
    );
  };
  let h = '<form class="compose bundle" data-form="bundle" data-key="' + esc(key) + '"><div class="bparts">';
  if (!ids.length && !state.bundle.general)
    h +=
      '<div class="hint">Drop cards here, or press the plus on a card, to add tasks. Drag the General chip in for ' +
      "a part not about one task. Each part takes its own images: paste into its box or attach.</div>";
  ids.forEach(cid => {
    const c = state.cards.find(x => x.id === cid),
      pk = key + ":" + cid;
    h +=
      '<div class="bpart" id="bpart-' +
      esc(cid) +
      '"><div class="bchip"><span>' +
      esc(c ? c.title : cid) +
      '</span><button type="button" data-act="bundle-remove" data-id="' +
      esc(cid) +
      '" aria-label="Remove from the bundle">&#x2715;</button></div><textarea data-bpart="' +
      esc(cid) +
      '" data-fkey="' +
      esc(pk) +
      '" placeholder="Your comment on this task; paste an image here to attach it to this task">' +
      esc(state.bundle.parts[cid] || "") +
      "</textarea>" +
      pfiles(pk) +
      "</div>";
  });
  if (state.bundle.general)
    h +=
      '<div class="bpart general" id="bpart-general"><div class="bchip"><span>General</span><button type="button" ' +
      'data-act="bundle-general-remove" aria-label="Remove the general part">&#x2715;</button></div><textarea ' +
      'data-draft="' +
      esc(key) +
      '" placeholder="Not about one task">' +
      esc(state.drafts[key] || "") +
      "</textarea>" +
      pfiles(key) +
      "</div>";
  h += "</div>";
  h +=
    '<div class="row"><button type="submit"' +
    (state.posting ? " disabled" : "") +
    ">" +
    (state.posting ? "Sending" : "Send bundle") +
    ('</button><span class="note">One message; each part reaches the operator labelled with its task, with its own ' +
      "images.</span></div></form>");
  return h;
}
