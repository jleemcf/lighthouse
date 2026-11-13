// ---------- the steward (STEWARD-ASSISTANT-DESIGN.md): advice in its own frame, Owner's buttons, the explainer laid
// out by the board ----------
const hasSteward = board => !!(state.stewards || {})[board];
function stewardStateHtml(board) {
  const sw = (state.stewards || {})[board];
  if (!sw || sw.alive) return "";
  return (
    '<span class="stale" title="the steward\'s machine has not checked in; what you press waits for it">steward off' +
    (sw.at ? " since " + esc(fmtTime(sw.at)) : ", not started yet") +
    "</span>"
  );
}
const REQ_DOING = {
  "second-opinion": "your second opinion",
  explain: "your explainer",
  ask: "your question",
  state: "the overview",
  "ask-check": "a check of this ask",
  review: "a memory review",
  digest: "the digest",
};
const activeReq = (board, cardId, kind) =>
  (state.stewardReq || []).find(
    r =>
      r.board === board &&
      (r.cardId || null) === (cardId || null) &&
      r.kind === kind &&
      (r.state === "pending" || r.state === "running"),
  );
function requestsHtml(board, cardId, only) {
  // only: which of them, where General shows the overview's apart from the rest
  const day = Date.now() - 86400000;
  const rs = (state.stewardReq || []).filter(
    r =>
      r.board === board &&
      (r.cardId || null) === (cardId || null) &&
      (!only || only(r)) &&
      (r.state === "pending" ||
        r.state === "running" ||
        ((r.state === "failed" || (r.state === "skipped" && isOwnerName(r.by))) && new Date(r.t).getTime() > day)),
  );
  return rs
    .map(r => {
      const what = REQ_DOING[r.kind] || r.kind,
        sw = (state.stewards || {})[board] || {};
      // the clock's own overview never pings, so it promises no alert
      if (r.state === "running")
        return (
          '<div class="progress"><span class="dot" aria-hidden="true"></span><span>The steward is working on ' +
          esc(what) +
          (r.attempts > 1 ? " (try " + r.attempts + ")" : "") +
          ", since " +
          whenHtml(r.runningSince || r.t) +
          (r.by === "board" ? "." : ". You get an alert when it lands.") +
          "</span></div>"
        );
      if (r.state === "pending")
        return (
          '<div class="progress"><span class="dot" aria-hidden="true"></span><span>' +
          esc(what.charAt(0).toUpperCase() + what.slice(1)) +
          " is queued, since " +
          whenHtml(r.t) +
          (sw.alive === false
            ? ": the steward is off, so it waits for it to come back."
            : r.lastError
              ? ": the last try failed, and it tries again shortly."
              : ": the steward takes it next.") +
          "</span></div>"
        );
      if (r.state === "failed")
        return (
          '<div class="progress failed"><span class="dot" aria-hidden="true"></span><span>The steward could not ' +
          "answer " +
          esc(what) +
          (r.lastError ? " (" + esc(String(r.lastError).slice(0, 160)) + ")" : "") +
          ". Press again to retry.</span></div>"
        );
      return (
        '<div class="progress failed"><span class="dot" aria-hidden="true"></span><span>' +
        esc(what.charAt(0).toUpperCase() + what.slice(1)) +
        " was skipped: " +
        esc(r.skippedWhy || "") +
        "</span></div>"
      );
    })
    .join("");
}
function adviceHtml(a0, card) {
  const a = Object.assign({}, a0, state.adviceFull[a0.id] || {}),
    whole = !!state.adviceFull[a0.id];
  let line = a.oneLine || "";
  if (a.agrees === true) line = "Steward agrees. " + line;
  else if (a.agrees === false) line = "Steward would choose differently. " + line;
  const kindWord =
    {
      "second-opinion": "second opinion",
      explain: "explainer",
      ask: "answer",
      state: "overview",
      check: "on this ask",
      review: "memory and skills",
      digest: "digest",
      flag: "from the board",
    }[a.kind] || a.kind;
  let h =
    '<div class="advice' +
    (a.kind === "flag" ? " flag" : "") +
    '" id="adv-' +
    esc(a.id) +
    '"><div class="who"><span class="lbl ADVICE">' +
    (a.kind === "flag" ? "STEWARD &middot; FLAG" : "STEWARD") +
    "</span><span>" +
    esc(kindWord) +
    "</span>" +
    whenHtml(a.t) +
    '<span title="the model that wrote it">' +
    esc(a.model || "") +
    "</span>";
  if (a.late) h += '<span class="stale">arrived after the ask was settled</span>';
  h += "</div>";
  if (a.question) h += '<div class="body"><b>You asked:</b> ' + esc(a.question) + "</div>";
  if (a.line) h += '<div class="body"><b>Still unclear:</b> ' + esc(a.line) + "</div>";
  h += '<div class="aline">' + esc(line) + "</div>";
  const more = adviceMoreHtml(a);
  if (more || a.more)
    h +=
      '<details class="more" data-adv="' +
      esc(a.id) +
      '"' +
      (state.adviceOpen.has(a.id) ? " open" : "") +
      "><summary>Why</summary>" +
      (whole || !a.more ? more : '<div class="hint">Loading the reasons&hellip;</div>' + more) +
      "</details>";
  const btns = [];
  if (a.kind === "explain" && a.diagram)
    btns.push(
      '<button type="button" class="tiny primary" data-act="st-open" data-id="' + esc(a.id) + '">Open</button>',
    );
  if (state.canTalk && a.kind === "explain" && a.cardId)
    btns.push(
      '<button type="button" class="tiny" data-act="st-unclear" data-id="' +
        esc(a.cardId) +
        '" data-board="' +
        esc(a.board) +
        '">Still unclear</button>',
    );
  if (state.canTalk && a.kind !== "flag" && a.kind !== "digest")
    btns.push(
      a.put
        ? '<span class="decided">put to the operator ' + esc(fmtTime(a.put.t)) + "</span>"
        : '<button type="button" class="tiny" data-act="st-put" data-id="' +
            esc(a.id) +
            ('" title="Hand this advice to the operator, quoted, to answer on the card: your act, like Send">Put ' +
              "to the operator</button>"),
    );
  if (btns.length) h += '<div class="decide">' + btns.join("") + "</div>";
  return h + "</div>";
}
function adviceMoreHtml(a, noText) {
  // the reasons under an advice: its words, the facts it leans on (checked or reported), its rulings, what it read
  const titles = state.rulingTitles || {};
  return (
    (a.text && a.text !== a.oneLine && !noText ? fmt(a.text) : "") +
    (a.claims && a.claims.length
      ? '<ul class="claims">' +
        a.claims
          .map(
            c =>
              "<li>" +
              (c.record
                ? '<span class="mark v" title="the board opened this record">checked: ' +
                  esc(
                    c.record
                      .replace(/^card:/, "card ")
                      .replace(/^msg:/, "message ")
                      .replace(/^ruling:/, "ruling "),
                  ) +
                  "</span>"
                : '<span class="mark r" title="the board could not open a record for this">reported</span>') +
              esc(c.text) +
              "</li>",
          )
          .join("") +
        "</ul>"
      : "") +
    (a.cites && a.cites.length
      ? '<div class="hint">Rulings: ' +
        a.cites.map(n => "ruling " + n + (titles[n] ? " (" + esc(titles[n]) + ")" : "")).join("; ") +
        "</div>"
      : "") +
    (a.unknownCites && a.unknownCites.length
      ? '<div class="stale">cited ruling ' + a.unknownCites.map(esc).join(", ") + ", which does not exist</div>"
      : "") +
    // a source over its share was read, only not all of it: it is not called "Could not read", which reads as a fault
    (a.missing && a.missing.length
      ? '<div class="hint">Background reading: ' +
        a.missing
          .map(m =>
            esc(
              String(m).replace(
                /^(.+?): too big for its share \((\d+) > (\d+)\).*$/,
                (x, n, len, share) =>
                  n +
                  ": read in part (the first " +
                  Number(share).toLocaleString("en-US") +
                  " of " +
                  Number(len).toLocaleString("en-US") +
                  " characters)",
              ),
            ),
          )
          .join("; ") +
        "</div>"
      : "") +
    (a.pack
      ? '<div class="hint" title="' +
        esc(
          Object.entries(a.pack)
            .map(kv => kv[0] + " " + kv[1])
            .join("\n"),
        ) +
        '">read ' +
        Object.keys(a.pack).length +
        " sources" +
        (a.brief ? " &middot; brief " + esc(a.brief) : "") +
        "</div>"
      : "")
  );
}
// the buttons stay with the task; what the steward says lives in the conversation, at the time it arrived, and the work
// under way waits at its foot, where the answer will land
function stewardCardHtml(c) {
  if (!hasSteward(c.board)) return "";
  let h = '<div class="stew"><div class="decide">';
  const btn = (kind, label, busy, title) => {
    const on = activeReq(c.board, c.id, kind);
    return (
      '<button type="button" class="tiny" data-act="st-press" data-kind="' +
      kind +
      '" data-id="' +
      esc(c.id) +
      '" data-board="' +
      esc(c.board) +
      '" title="' +
      esc(title) +
      '"' +
      (on ? " disabled" : "") +
      ">" +
      (on ? busy : label) +
      "</button>"
    );
  };
  if (state.canTalk)
    h +=
      btn(
        "second-opinion",
        "Second opinion",
        "Second opinion&hellip;",
        "The steward's own view of this card, formed without the operator's recommendation",
      ) +
      btn(
        "explain",
        "Explain simply",
        "Explaining&hellip;",
        "Three plain sentences, and a diagram with the explanation to open",
      );
  return h + stewardStateHtml(c.board) + "</div></div>";
}
const stewardTalk = c =>
  hasSteward(c.board)
    ? (state.advice || []).filter(a => a.cardId === c.id).map(a => ({ t: a.t || "", html: adviceHtml(a, c) }))
    : [];
const stewardFoot = c => {
  const rq = hasSteward(c.board) ? requestsHtml(c.board, c.id) : "";
  return rq ? '<div class="stew">' + rq + "</div>" : "";
};
function stewardVerdict(c, d) {
  // on an open ask, one line: what the steward's second opinion or check said about it, which jumps to the report
  const v = (state.advice || [])
    .filter(
      a => a.cardId === c.id && a.askId && a.askId === d.id && (a.kind === "second-opinion" || a.kind === "check"),
    )
    .sort((a, b) => (b.t || "").localeCompare(a.t || ""))[0];
  if (!v) return "";
  const said =
    v.agrees === true
      ? "agrees with the operator"
      : v.agrees === false
        ? "would choose differently" + (v.choice ? ": " + v.choice : "")
        : v.choice
          ? "would choose " + v.choice
          : String(v.oneLine || "").slice(0, 110) + (String(v.oneLine || "").length > 110 ? "…" : "");
  return (
    '<span><b>Steward:</b> <button type="button" class="tlink" data-act="st-jump" data-id="' +
    esc(v.id) +
    '" data-card="' +
    esc(c.id) +
    '" title="Show the steward\'s report in the conversation">' +
    esc(said) +
    "</button></span>"
  );
}
