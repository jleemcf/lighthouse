// ---------- pieces: the shift chip, log lines, messages, the transcript box, the composer ----------
function promptStateLabel(prompt) {
  if (prompt.state === "declined") return "declined; suggest a new prompt";
  if (prompt.state === "superseded") return "superseded: replaced, withdrawn or settled";
  const via = (prompt.approval || {}).via;
  const edited = prompt.edited ? ", edited" : "";
  const basis =
    via === "on-word"
      ? "on your word"
      : via === "yolo"
        ? "under /yolo"
        : via === "authority"
          ? "under your standing authority"
          : "on your Send";
  if (prompt.state === "approved") return "approved " + basis + edited + "; awaiting delivery";
  if (prompt.state === "relayed") return "received by the " + (prompt.to || "target") + " " + basis + edited;
  return "suggested; awaiting your decision";
}

function presenceHtml(id, b) {
  const s = (b && b.shift) || {},
    lv = liveness(b),
    p = lv.p,
    quiet = lv.quiet && lv.quiet !== "never" ? lv.quiet : null;
  // the operator beside the chip: asleep off shift, panicking while an ask waits for Owner
  const mood =
    p === "off"
      ? "sleep"
      : p === "stale" || p === "lost"
        ? "stale"
        : unopenedAsks().some(x => x.board === id)
          ? "panic"
          : "idle";
  const label =
    p === "on"
      ? lv.quiet
        ? "on shift, quiet" + (quiet ? " since " + fmtTime(quiet) : "")
        : "on shift"
      : p === "stale"
        ? "on shift, no signal"
        : p === "lost"
          ? "lost"
          : "off shift";
  const who = s.operator ? esc(s.operator) : "no operator";
  const seen = lv.quiet
    ? "machine checked in " + agoWords(b.instruments.t)
    : s.lastSeen
      ? "seen " + fmtTime(s.lastSeen) + " (" + ago(s.lastSeen) + ")"
      : "never seen";
  const tip = lv.quiet
    ? ' title="Nothing posted for a while, but its machine checks in every minute: the machine and its helpers are ' +
      'running. It does not show that the session is answering."'
    : "";
  const yolo =
    b && b.yolo
      ? '<span class="chip yolo" title="' +
        esc(
          "The operator prompts firstmate without your Send" +
            (b.yolo.scope ? " on " + b.yolo.scope + " only; anything else waits for your Send" : "") +
            ", since " +
            fmtTime(b.yolo.since) +
            ". Critical direction decisions still come to you as asks. Type /yolo off to end it.",
        ) +
        '">/yolo on' +
        (b.yolo.scope ? ": " + esc(b.yolo.scope) : "") +
        "</span>"
      : "";
  return (
    '<span class="chip ' +
    p +
    '"' +
    tip +
    '><canvas class="opchip" data-op="' +
    esc(id) +
    '" data-mood="' +
    mood +
    '" width="22" height="18" aria-hidden="true"></canvas><span class="dot"></span>' +
    who +
    " &middot; " +
    label +
    "</span>" +
    yolo +
    '<span class="seen">' +
    seen +
    "</span>"
  );
}
function usageHtml(board, id) {
  const usage = board.instruments?.usage;
  if (!Array.isArray(usage?.days) || !usage.days.length) return "";
  const numeric = value => (Number.isFinite(value) && value >= 0 ? Math.floor(value).toLocaleString("en-US") : "0");
  const days = usage.days.slice().sort((left, right) => String(right.day).localeCompare(String(left.day)));
  const latest = days[0];
  const labels = {
    fm_input: "FM input",
    fm_task: "FM task",
    fm_reply: "FM reply",
    fm_waiting: "FM waiting",
    fm_wake: "FM wake",
    record_check: "record check",
    sweep: "sweep",
    board: "board",
    steward: "steward",
    instrument: "instrument",
    human: "typed here",
    other: "other",
  };
  let html =
    '<details class="usage" data-fold="usage:' +
    esc(id) +
    '"' +
    (state.unfold.has("usage:" + id) ? " open" : "") +
    "><summary>Daily usage (UTC) · " +
    esc(latest.day) +
    " · " +
    numeric(latest.requests) +
    " API requests</summary>";
  for (const day of days) {
    html += '<div class="usage-day"><strong>' + esc(day.day) + "</strong><dl>";
    for (const [field, label] of Object.entries({
      requests: "API requests",
      cacheRead: "Cache read",
      cacheWrite: "Cache write",
      output: "Output",
      avgPrompt: "Average prompt",
    }))
      html += "<div><dt>" + label + "</dt><dd>" + numeric(day[field]) + "</dd></div>";
    html +=
      "</dl><p>Turns by wake source: " +
      Object.entries(labels)
        .filter(([source]) => day.turns?.[source] > 0)
        .map(([source, label]) => label + " " + numeric(day.turns[source]))
        .join(" · ") +
      "</p></div>";
  }
  const context = usage.context;
  if (context?.window > 0)
    html +=
      "<p>Context: " +
      numeric(context.prompt) +
      " / " +
      numeric(context.window) +
      " (" +
      numeric((context.prompt / context.window) * 100) +
      "% of the compaction window)</p>";
  return html + "</details>";
}
function entryHtml(e) {
  const kind = KINDS.includes(e.kind) ? e.kind : "FYI";
  return (
    '<div class="entry">' +
    whenHtml(e.t) +
    '<span class="kind ' +
    kind +
    '">' +
    kind +
    '</span><div class="text">' +
    fmt(e.text) +
    (e.who ? '<span class="who">&middot; ' + esc(e.who) + "</span>" : "") +
    "</div>" +
    (e.body ? '<div class="ebody">' + fmt(e.body) + "</div>" : "") +
    picsHtml(e.attachments) +
    "</div>"
  );
}
// Owner's pictures and the operator's: a picture shows; a CSV, text or PDF is a chip to open
const picsHtml = atts =>
  Array.isArray(atts) && atts.length
    ? '<div class="pics">' +
      atts
        .map(a =>
          /^image\//.test(a.type || "")
            ? '<a href="/api/attachments/' +
              esc(a.id) +
              '" target="_blank" rel="noopener"><img src="/api/attachments/' +
              esc(a.id) +
              '" alt="' +
              esc(a.name || "image") +
              '" loading="lazy"></a>'
            : '<a class="filechip" href="/api/attachments/' +
              esc(a.id) +
              '" target="_blank" rel="noopener" title="' +
              esc(a.type || "") +
              '">&#x1F4C4; ' +
              esc(a.name || "file") +
              (a.size ? " &middot; " + Math.round(a.size / 1024) + " KB" : "") +
              "</a>",
        )
        .join("") +
      "</div>"
    : "";
function statusNoteHtml(e) {
  // a STATUS line from the card's log, as a note in the conversation
  return (
    '<div class="msg note"><div class="who"><span class="lbl STATUS">STATUS</span>' +
    whenHtml(e.t) +
    (e.who ? "<span>" + esc(e.who) + "</span>" : "") +
    '</div><div class="body">' +
    fmt(e.text) +
    "</div>" +
    (e.body
      ? '<details class="more"><summary>detail</summary><div class="ebody">' + fmt(e.body) + "</div></details>"
      : "") +
    "</div>"
  );
}
const isLong = t => {
  const x = String(t || "");
  return x.length > 700 || (x.match(/\n/g) || []).length > 9;
};
function msgHtml(m) {
  const coordinator = m.author === "coordinator",
    owner = !coordinator && isOwnerName(m.by),
    staff = m.kind === "staff"; // staff: a question from the CRM, never Owner's word
  const pics = picsHtml(m.attachments);
  let tags = "";
  if (coordinator) {
    tags += '<span class="lbl NOTICE">NOTICE &middot; coordinator, not the owner</span>';
    if (!m.handled) tags += '<span class="pending">waiting for the operator</span>';
  }
  if (staff) {
    const s = m.staff || {};
    tags +=
      '<span class="lbl STAFF" title="' +
      esc("scope: " + (s.scope || "")) +
      '">via CRM #' +
      esc(s.id || "?") +
      "</span>";
    if (!m.handled) tags += '<span class="pending">waiting for the operator</span>';
  }
  if (m.label && !owner && !m.prompt)
    tags +=
      (m.forOwner
        ? '<span class="lbl CHAT" title="Written in the operator\'s own chat for you, as you asked there: open its ' +
          'chat for the files and links">in its chat, for you</span>'
        : m.chatReply
          ? '<span class="lbl CHAT" title="The operator\'s answer in its own chat, to what you typed there">in its ' +
            "chat, to you</span>"
          : '<span class="lbl ' + esc(m.label) + '">' + esc(m.label) + "</span>") +
      (m.about
        ? ' <a class="tlink" data-act="goto-card" data-id="' +
          esc(m.board + "-" + m.about) +
          '" data-board="' +
          esc(m.board) +
          '" title="Open this task">' +
          esc(cardTitle(m.board, m.about)) +
          "</a>"
        : "");
  if (m.global)
    tags +=
      '<span class="lbl global" title="Sent with Global: the same message went to every operator, and each ' +
      'answers its own copy">Global</span>';
  if (m.kind === "task-request") tags += '<span class="lbl">task request</span>';
  if (m.kind === "prompt-send") tags += '<span class="lbl">approved at your click</span>';
  if (m.kind === "advice-put") tags += '<span class="lbl ADVICE">steward\'s advice, put to the operator by you</span>';
  if (m.prompt && !owner)
    tags += '<span class="lbl PROMPT">PROMPT' + (m.prompt.to ? " for the " + esc(m.prompt.to) : "") + "</span>";
  if (m.bundleId)
    tags +=
      '<span class="lbl" title="part of a bundled message">bundle' +
      (m.bundleSize ? " of " + m.bundleSize : "") +
      "</span>";
  if (m.untagged)
    tags +=
      '<span class="pending" title="the operator wrote this without a timed line; the collector posted it as ' +
      'general">untagged</span>';
  // one the operator answered "I'm on it" (a held answer) is still open, but not unanswered
  if (owner && !m.handled)
    tags += m.holdAt
      ? '<span class="pending held" title="The operator has answered that it is on this; it stays open until done">' +
        (m.kind === "prompt-send" ? "not sent yet: the operator is holding it" : "the operator is on it") +
        ", since " +
        esc(fmtTime(m.holdAt)) +
        "</span>"
      : '<span class="pending">waiting for the operator</span>';
  let decide = "";
  if (m.prompt && !owner) {
    const d = m.prompt.state,
      key = m.cardId ? "card:" + m.cardId : "general:" + m.board;
    if (d !== "offered")
      decide =
        '<div class="decide"><span class="decided">' +
        esc(promptStateLabel(m.prompt)) +
        ((d === "relayed" ? m.prompt.relayedAt : m.prompt.decidedAt)
          ? " &middot; " + esc(fmtTime(d === "relayed" ? m.prompt.relayedAt : m.prompt.decidedAt))
          : "") +
        "</span></div>";
    else if (state.canTalk && state.editPrompt === m.id) {
      // Send with edit: his version of the prompt, the same instruction
      const ek = "prompt:" + m.id;
      if (state.drafts[ek] == null) state.drafts[ek] = m.prompt.text || "";
      decide =
        '<div class="decide edit"><textarea data-draft="' +
        esc(ek) +
        '" aria-label="The prompt, to edit before sending">' +
        esc(state.drafts[ek]) +
        ('</textarea><div class="row"><button type="button" class="tiny primary" data-act="prompt-send-edited" ' +
          'data-id="') +
        esc(m.id) +
        '" data-key="' +
        esc(key) +
        '" title="The operator is told, in your name, to send your version on your behalf, exactly as written">Send' +
        (m.prompt.to ? " to the " + esc(m.prompt.to) : "") +
        '</button><button type="button" class="tiny" data-act="prompt-edit-cancel" data-id="' +
        esc(m.id) +
        '">Cancel</button></div></div>';
    } else if (state.canTalk)
      decide =
        '<div class="decide"><button type="button" class="tiny primary" data-act="prompt-send" data-id="' +
        esc(m.id) +
        '" data-key="' +
        esc(key) +
        '" title="The operator is told, in your name, to send this on your behalf, exactly as written">Send' +
        (m.prompt.to ? " to the " + esc(m.prompt.to) : "") +
        '</button><button type="button" class="tiny" data-act="prompt-edit" data-id="' +
        esc(m.id) +
        ('" title="Change the prompt first, then send it the same way">Send with edit</button><button ' +
          'type="button" class="tiny" data-act="prompt-other" data-id="') +
        esc(m.id) +
        '" data-key="' +
        esc(key) +
        '" title="Take the choices away and answer as you like">No, something else</button></div>';
  }
  if (m.prompt && !owner && m.prompt.state === "offered")
    decide = '<div class="decided">' + esc(promptStateLabel(m.prompt)) + "</div>" + decide;
  // a long operator message shows its first lines; the rest is a click away
  const long = !owner && isLong(m.text) && !state.unfold.has("msg:" + m.id);
  const body = m.text
    ? '<div class="body' +
      (long ? " folded" : "") +
      '">' +
      fmt(m.text) +
      "</div>" +
      (long
        ? '<button type="button" class="unfold" data-act="unfold" data-key="msg:' + esc(m.id) + '">Show all</button>'
        : "")
    : "";
  // an ask carries the operator's recommendation where he reads the ask, in the conversation too, not only in the box
  // at the top of the card
  const ask =
    m.askId && m.label === "ACTION"
      ? ((state.cards.find(c => c.id === m.cardId) || {}).decisions || []).find(d => d.id === m.askId)
      : null;
  const rec =
    ask && ask.recommendation
      ? '<div class="rec"><b>Operator recommends:</b> ' + esc(String(ask.recommendation).replace(/_/g, " ")) + "</div>"
      : "";
  return (
    '<div class="msg' +
    (owner ? " owner" : coordinator ? " coordinator" : staff ? " staff" : "") +
    '" id="msg-' +
    esc(m.id) +
    '"><div class="who"><span>' +
    (owner
      ? ownerLabel()
      : staff
        ? "Staff &middot; " + esc((m.staff || {}).name || "") + " (" + esc((m.staff || {}).role || "staff") + ")"
        : esc(m.by || "operator")) +
    "</span>" +
    whenHtml(m.t) +
    tags +
    "</div>" +
    body +
    rec +
    pics +
    decide +
    "</div>"
  );
}
// the transcript: the operator's own chat, naked; Owner's words carry no tag beyond where they came from
const cardTitle = (board, slug) => {
  const c = state.cards.find(x => x.id === board + "-" + slug);
  return c && c.title ? c.title : slug;
};
function linkTasks(html, board) {
  // every task slug a line names becomes a link to its card: the card's plain title stands in for the slug, the slug
  // on hover
  cardsOf(board)
    .map(c => ({ c, slug: c.id.slice(board.length + 1) }))
    .sort((a, b) => b.slug.length - a.slug.length)
    .forEach(({ c, slug }) => {
      const key = " &middot; " + esc(slug);
      if (html.indexOf(key) < 0) return;
      html = html
        .split(key)
        .join(
          ' &middot; <a class="tlink" data-act="open-full" data-id="' +
            esc(c.id) +
            '" title="' +
            esc(slug) +
            ': open the task full screen">' +
            esc(c.title || slug) +
            "</a>",
        );
    });
  return html;
}
// an entry names where it was said: its card's title, linked to the card, or General; what the operator's tools put on
// the board carries its label
// inFeed: an entry in Home's feed, which carries a Reply button when it belongs to a card
function txHtml(e, board, inFeed) {
  const owner = e.role === "owner" || isOwnerName(e.role),
    title = e.card ? (state.cards.find(x => x.id === e.card) || {}).title || e.cardTitle || e.card : "";
  const reply = inFeed && e.card && state.canTalk ? feedReplyHtml(board, e.card, title) : "";
  const kind = e.kind
    ? '<span class="lbl ' + esc(e.kind) + '" title="put on the board by its tools">' + esc(e.kind) + "</span>"
    : "";
  const where = e.card
    ? '<a class="tlink" data-act="open-full" data-id="' +
      esc(e.card) +
      '" title="Open this task full screen">' +
      esc(title) +
      "</a>"
    : e.global || e.via === "global"
      ? '<span class="lbl global" title="Global: the message that went to every operator, and its answer to ' +
        'it">Global</span>'
      : e.general || e.via === "general"
        ? '<span class="lbl dim">General</span>'
        : owner && e.via && e.via !== "direct" && e.via !== "chat"
          ? '<span class="lbl dim" title="written on the board, here">' + esc(e.via) + "</span>"
          : "";
  return (
    '<div class="msg tx' +
    (owner ? " owner" : "") +
    '"><div class="who"><span>' +
    (owner ? ownerLabel() : esc(e.by || "operator")) +
    "</span>" +
    whenHtml(e.t) +
    kind +
    where +
    reply +
    '</div><div class="body">' +
    (owner ? fmt(e.text) : linkTasks(fmt(e.text), board)) +
    "</div></div>"
  );
}
function transcriptHtml(id) {
  // the newest 200; the page stays light
  const rows =
    state.txBoard === id
      ? state.tx
          .slice()
          .sort((x, y) => (x.t || "").localeCompare(y.t || ""))
          .slice(-200)
      : [];
  let h =
    '<aside class="side transcript' +
    (state.wide ? " wide" : "") +
    '" id="transcript-' +
    esc(id) +
    '" aria-label="The operator\'s transcript">';
  h +=
    '<div class="dhead"><h3>Transcript</h3><span class="n">' +
    rows.length +
    "</span>" +
    wideBtn() +
    '<button type="button" class="close" data-act="transcript" data-id="' +
    esc(id) +
    '" aria-label="Close the transcript">&#x2715;</button></div>';
  const pend = pendingHtml("direct:" + id, true);
  h +=
    '<div class="dthread" id="txthread-' +
    esc(id) +
    '">' +
    (rows.length || pend
      ? rows.map(e => txHtml(e, id)).join("") + pend
      : '<div class="thread-empty">Nothing yet. Everything the operator says to you, in its chat or through its ' +
        "tools, and everything you say to it by any route, appears here as it happens.</div>") +
    "</div>";
  h +=
    '<div class="dfoot">' +
    (state.canTalk
      ? composerHtml("direct:" + id, {
          form: "direct",
          placeholder: "Say it to the operator as you would in its chat.",
          label: "Direct message to the operator",
          note: "Reaches the operator like anything typed in its chat. Nothing else on the board shows it.",
        })
      : '<div class="hint">Talking works on the self-hosted board.</div>') +
    "</div>";
  return h + "</aside>";
}
function composerHtml(key, opts) {
  if (!state.canTalk)
    return '<div class="hint">' + esc(opts.hint || "Writing works on the self-hosted board.") + "</div>";
  const files = state.files[key] || [];
  let h =
    '<form class="compose' +
    (opts.cls ? " " + opts.cls : "") +
    '" data-form="' +
    esc(opts.form) +
    '" data-key="' +
    esc(key) +
    '">';
  if (opts.before) h += opts.before;
  h +=
    '<textarea data-draft="' +
    esc(key) +
    '" placeholder="' +
    esc(opts.placeholder || "") +
    '" aria-label="' +
    esc(opts.label || "Message") +
    '">' +
    esc(state.drafts[key] || "") +
    "</textarea>";
  if (files.length)
    h +=
      '<div class="files">' +
      files
        .map(
          (f, i) =>
            '<span class="fthumb" title="' +
            esc(f.name) +
            '"><img src="/api/attachments/' +
            esc(f.id) +
            '" alt="' +
            esc(f.name) +
            '"><button type="button" data-act="file-remove" data-key="' +
            esc(key) +
            '" data-i="' +
            i +
            '" aria-label="Remove this image">&#x2715;</button></span>',
        )
        .join("") +
      "</div>";
  h +=
    '<div class="row"><button type="submit"' +
    (state.posting ? " disabled" : "") +
    ">" +
    (state.posting ? "Sending" : esc(opts.send || "Send")) +
    "</button>" +
    (opts.noAttach
      ? ""
      : '<button type="button" class="attach" data-act="attach" data-key="' +
        esc(key) +
        '">Attach image</button><input type="file" accept="image/*" multiple hidden data-file="' +
        esc(key) +
        '">') +
    (opts.note ? '<span class="note">' + opts.note + "</span>" : "") +
    "</div></form>";
  return h;
}
// what he just sent, shown at once where it will land until the board has it, so he sees it land and does not send it
// twice
function pendingHtml(key, tx) {
  const p = state.pending[key];
  if (!p) return "";
  return (
    '<div class="msg ' +
    (tx ? "tx " : "") +
    "owner pending" +
    (p.landing ? " landing" : "") +
    '" data-pending="' +
    esc(key) +
    '"><div class="who"><span>' +
    esc(ownerLabel()) +
    '</span><span class="sending">sending&hellip;</span></div><div class="body">' +
    fmt(p.text) +
    (p.files ? '<div class="hint">+ ' + p.files + (p.files === 1 ? " image" : " images") + "</div>" : "") +
    "</div></div>"
  );
}
