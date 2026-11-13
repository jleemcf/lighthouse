// ---------- Home: the scene, the live feed and Global; the tabs ----------
// Home's live feed: each operator's conversation with him, the whole of it in order (the transcript: his words, its
// chat words, what its tools put on the board, each on its card), what waits on him pinned at the top, and a box to
// write to it on its General, as on its board
// Reply on a feed entry or an ask: the column's box then writes to that card, once, instead of to General
function feedReplyHtml(board, cardId, title) {
  const on = state.feedTo[board] === cardId;
  return (
    '<button type="button" class="freply' +
    (on ? " on" : "") +
    '" data-act="feed-reply" data-board="' +
    esc(board) +
    '" data-id="' +
    esc(cardId) +
    '" title="Reply on ' +
    esc(title || "this card") +
    '" aria-pressed="' +
    on +
    '">Reply</button>'
  );
}
// the column's box: to the card he chose with Reply, or to the board's General
function feedComposerHtml(id, label) {
  const to = state.feedTo[id];
  if (!to)
    return composerHtml("feed:" + id, {
      form: "feed",
      placeholder: "Write to " + label + ". It lands on its General, in its inbox.",
      label: "Message to " + label + " on its General",
    });
  const card = state.cards.find(x => x.id === to) || {},
    title = card.title || to;
  return composerHtml("fcard:" + id + ":" + to, {
    form: "feedcard",
    before:
      '<div class="fto"><span>To <b>' +
      esc(title) +
      '</b></span><button type="button" data-act="feed-to-clear" data-board="' +
      esc(id) +
      '" title="Back to General" aria-label="Write to General instead">&#x2715;</button></div>',
    placeholder: "Write to " + label + " on this card. It lands on the card, in its inbox.",
    label: "Message to " + label + " on the card " + title,
  });
}
function feedColHtml(id) {
  const b = state.boards[id],
    p = presence(b),
    label = boardLabel(id) || id,
    rows = (state.feedTx[id] || []).slice(-200);
  const asks = unopenedAsks().filter(x => x.board === id);
  let h = '<section class="fcol" id="fcol-' + esc(id) + '" aria-label="' + esc(label) + ': the conversation">';
  h +=
    '<div class="fhead"><b>' +
    esc(label) +
    '</b><span class="p ' +
    p +
    '">' +
    (p === "on" ? "on shift" : p === "lost" ? "lost" : p === "stale" ? "no signal" : "off shift") +
    "</span>" +
    (p === "off" ? '<span class="note">what you write waits for its next shift</span>' : "") +
    '<button type="button" class="go" data-act="tab" data-id="' +
    esc(id) +
    '" title="Open the ' +
    esc(label) +
    ' board">Open board</button></div>';
  if (asks.length)
    h +=
      '<div class="fneed"><h4>Needs you &middot; ' +
      asks.length +
      "</h4>" +
      asks
        .slice(0, 4)
        .map(
          x =>
            '<div class="fneedrow"><button type="button" data-act="goto-card" data-id="' +
            esc(x.card.id) +
            '" data-board="' +
            esc(x.board) +
            '"><span><span class="ft">' +
            esc(x.card.title) +
            '</span> <span class="fa">' +
            esc(x.ask) +
            "</span></span><time>" +
            esc(fmtTime(x.t)) +
            "</time></button>" +
            (state.canTalk ? feedReplyHtml(id, x.card.id, x.card.title) : "") +
            "</div>",
        )
        .join("") +
      (asks.length > 4 ? '<span class="fa">and ' + (asks.length - 4) + " more on its board</span>" : "") +
      "</div>";
  // what he just sent, to General or to a card, until the feed has it
  const pend =
    pendingHtml("feed:" + id, true) +
    Object.keys(state.pending)
      .filter(k => k.startsWith("fcard:" + id + ":"))
      .map(k => pendingHtml(k, true))
      .join("");
  h +=
    '<div class="fbody" id="fbody-' +
    esc(id) +
    '">' +
    (rows.length || pend
      ? rows.map(e => txHtml(e, id, true)).join("") + pend
      : '<div class="empty">' +
        (state.feedTx[id]
          ? "Nothing yet. What you and " + esc(label) + " say to each other appears here as it happens."
          : "Loading&hellip;") +
        "</div>") +
    "</div>";
  h += '<div class="ffoot">' + feedComposerHtml(id, label) + "</div>";
  return h + "</section>";
}
// Global, one message to every operator at once (not any board's General): what he sent to all of them, and how each
// operator's copy stands
function gmsgHtml(g) {
  const st = c =>
    c.yolo
      ? ["ok", "the board switched /yolo " + c.yolo]
      : c.reply
        ? ["ok", "answered " + fmtTime(c.reply.t)]
        : c.noted
          ? ["dim", "noted, needs no answer"]
          : c.handled
            ? ["ok", "answered"]
            : c.holdAt
              ? ["", "holding, the answer is coming"]
              : ["", "waiting"];
  const copies = (g.copies || [])
    .filter(copy => boardIds().includes(copy.board))
    .sort((x, y) => boardIds().indexOf(x.board) - boardIds().indexOf(y.board))
    .map(c => {
      const s = st(c);
      return (
        '<div class="gcopy' +
        (c.reply ? " has" : "") +
        '"><span class="gb">' +
        esc(boardLabel(c.board) || c.board) +
        '</span><span><span class="st ' +
        s[0] +
        '">' +
        esc(s[1]) +
        "</span>" +
        (c.reply ? '<div class="ga">' + linkTasks(fmt(c.reply.text), c.board) + "</div>" : "") +
        "</span></div>"
      );
    })
    .join("");
  return (
    '<div class="gmsg" id="g-' +
    esc(g.id) +
    '"><div class="gtop"><span>Owner</span>' +
    whenHtml(g.t) +
    '</div><div class="gtext">' +
    fmt(g.text) +
    '</div><div class="gcopies">' +
    copies +
    "</div></div>"
  );
}
function globalHtml() {
  const list = (state.globals || []).slice(-6);
  let h = '<section class="gbar" id="gbar" aria-label="Global: one message to every operator">';
  h +=
    '<div class="fhead"><b>Global</b><span class="note">One message to every operator at once. It lands in each ' +
    "one's inbox, and each answers its own copy. /yolo here switches every board.</span></div>";
  h += '<div class="glist" id="glist">' + list.map(gmsgHtml).join("") + pendingHtml("global", true) + "</div>";
  h +=
    '<div class="ffoot">' +
    composerHtml("global", {
      form: "global",
      placeholder: "Write to every operator at once.",
      label: "Global message to every operator",
      send: "Send to all",
    }) +
    "</div>";
  return h + "</section>";
}
function homeHtml() {
  const asks = unopenedAsks();
  let h =
    '<section class="view home' +
    (state.view === null ? " active" : "") +
    (state.feed && !state.art ? " feeding" : "") +
    '" id="home-view" role="tabpanel" aria-labelledby="home-tab">';
  h +=
    '<canvas id="scene" width="960" height="540" data-act="scene" aria-label="The lighthouse over the sea through ' +
    'the day, the operators at work in its windows, firstmate at sea"></canvas>';
  if (state.letter) {
    const from = state.letter.from,
      name = boardLabel(from) || from;
    h +=
      '<div class="letter" role="dialog" aria-label="A letter from a bottle"><div class="paper"><div ' +
      'class="lhead">A bottle from the sea &middot; from the keeper of the ' +
      esc(name) +
      ' light</div><div class="ltext">' +
      esc(state.letter.text).replace(/\n/g, "<br>") +
      '</div><div class="lsign">&mdash; ' +
      esc(name) +
      '</div><button type="button" data-act="letter-close">Put it back in the sea</button></div></div>';
  }
  // only the art
  if (state.art)
    return (
      h +
      ('<div class="tools"><button type="button" class="hide show" data-act="art" title="Show the shift chips, the ' +
        'asks and the demo settings again">show</button></div></section>')
    );
  if (state.feed)
    h +=
      '<div class="feedwrap"><div class="fcols" id="fcols">' +
      boardIds().map(feedColHtml).join("") +
      "</div>" +
      globalHtml() +
      "</div>";
  else {
    h +=
      '<div class="overlay"><div class="hbox status">' +
      boardIds()
        .map(id => {
          const p = presence(state.boards[id]);
          return (
            "<span><b>" +
            esc(boardLabel(id)) +
            '</b> <span class="' +
            p +
            '">' +
            (p === "on" ? "on shift" : p === "lost" ? "lost" : p === "stale" ? "no signal" : "off shift") +
            "</span></span>"
          );
        })
        .join("") +
      "</div>";
    h +=
      '<div class="hbox"><h3' +
      (asks.length ? "" : ' class="calm"') +
      ">" +
      (asks.length ? "Needs you &middot; " + asks.length : "Nothing needs you") +
      "</h3>";
    h += asks
      .map(
        x =>
          '<div class="hask" data-act="goto-card" data-id="' +
          esc(x.card.id) +
          '" data-board="' +
          esc(x.board) +
          '"><span class="hb">' +
          esc(boardLabel(x.board) || x.board) +
          '</span><div><div class="ht">' +
          esc(x.card.title) +
          '</div><div class="ha">' +
          esc(x.ask) +
          "</div></div><time>" +
          esc(fmtTime(x.t)) +
          "</time></div>",
      )
      .join("");
    h += "</div></div>";
  }
  h +=
    '<div class="tools"><div class="row"><button type="button" class="hide" data-act="feed" aria-pressed="' +
    !!state.feed +
    ('" title="Every operator\'s conversation side by side, live, with a box to write to each, and Global to write ' +
      'to all of them">feed</button>');
  h +=
    '<button type="button" class="hide" data-act="lite" aria-pressed="' +
    !!state.lite +
    ('" title="Lite mode, for this device only: the scene shows the time of day, the weather and who is on shift, ' +
      'redrawn once a minute, with nothing moving">lite</button>');
  h += '<button type="button" class="hide" data-act="art" title="Hide everything but the art">hide</button></div>';
  h +=
    '<div class="demo"><span>demo</span><button type="button" data-act="demo" data-v="shift" aria-pressed="' +
    !!state.demo.shift +
    ('" title="Pretend every operator is on shift, to watch them">crew on shift</button><button type="button" ' +
      'data-act="demo" data-v="alarm" aria-pressed="') +
    !!state.demo.alarm +
    '" title="Pretend something needs you on one board, to watch that operator\'s alarm">alarm' +
    (state.demo.alarm ? " (" + esc(boardLabel(state.demo.alarm) || state.demo.alarm) + ")" : "") +
    "</button>";
  {
    const w = state.weather,
      liveKind = !w
        ? "none"
        : w.code >= 95
          ? "storm"
          : (w.code >= 71 && w.code <= 77) || w.code === 85 || w.code === 86
            ? "snow"
            : w.code >= 51
              ? "rain"
              : (w.code >= 2 && w.cloud > 60) || w.code >= 45
                ? "cloudy"
                : "clear";
    h +=
      '<span class="sep">season</span><button type="button" data-act="season" aria-pressed="' +
      (state.season !== "auto") +
      '" title="The season over the scene: auto follows the calendar; click to choose one">' +
      esc(state.season) +
      "</button>";
    h +=
      '<span class="sep">weather</span><button type="button" data-act="wx" aria-pressed="' +
      (state.wx !== "live") +
      ('" title="The sky over the scene: live follows the real weather over your area when the board server has ' +
        'it; click to choose one">') +
      (state.wx === "live" ? "live" + (w ? " &middot; " + liveKind : " &middot; not set up") : esc(state.wx)) +
      "</button>";
  }
  h += "</div></div>";
  return h + "</section>";
}
function tabsHtml() {
  const tab = (id, label, n, u) =>
    '<button class="tab" role="tab" id="' +
    (id === null ? "home-tab" : "tab-" + esc(id)) +
    '" data-act="tab"' +
    (id === null ? "" : ' data-id="' + esc(id) + '"') +
    ' aria-selected="' +
    (state.view === id) +
    '">' +
    esc(label) +
    (n ? ' <span class="count">' + n + "</span>" : "") +
    (u ? ' <span class="count new" title="lines since you last looked">' + u + "</span>" : "") +
    "</button>";
  return (
    tab(null, "Home", 0, 0) +
    boardIds()
      .map(id => tab(id, boardLabel(id), actionCount(id), unreadBoard(id)))
      .join("")
  );
}
