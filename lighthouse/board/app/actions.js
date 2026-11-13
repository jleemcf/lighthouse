// ---------- actions ----------
function setView(id) {
  state.view = id;
  ls("lh.view", JSON.stringify(id));
  state.activityOpen = false;
  render();
  if (id === null && state.feed) loadFeed().then(render);
}
// an old finished card comes light; opening it fetches it whole
const wholeCard = id => {
  if ((state.cards.find(c => c.id === id) || {}).lite)
    data
      .card(id)
      .then(() => render())
      .catch(() => {});
};
function expandCard(id) {
  state.expanded.add(id);
  markSeen(id);
  state.scrollTo = id;
  render();
  wholeCard(id);
  data
    .thread(id)
    .then(() => {
      state.scrollTo = id;
      render();
    })
    .catch(() => {});
}
function collapseCard(id) {
  state.expanded.delete(id);
  render();
}
function openPanel(id) {
  state.panel = id;
  state.histOpen = false;
  state.panelReset = true;
  markSeen(id);
  render();
  wholeCard(id);
  data
    .thread(id)
    .then(() => {
      if (!phoneWidth()) state.panelReset = true;
      render();
    })
    .catch(() => {});
}
function closeOverlays() {
  state.panel = null;
  state.panelWide = false;
  state.newTask = null;
  state.railBoard = null;
  state.railMenu = false;
  render();
}
function addToBundle(board, cardId) {
  if (!state.bundle.on || state.bundle.board !== board)
    state.bundle = { on: true, board: board, parts: {}, general: false };
  if (!(cardId in state.bundle.parts)) state.bundle.parts[cardId] = "";
  state.side = "bundle";
  render();
}
async function addFile(key, f) {
  if (!/^image\//.test(f.type || "")) {
    showBanner("Only images can be attached.", true);
    return;
  }
  try {
    const a = await data.upload(f);
    (state.files[key] = state.files[key] || []).push({ id: a.id, name: a.name || f.name || "image" });
    state.focusKey = key;
    render();
  } catch (e) {
    showBanner("The image was not uploaded (" + e.message + ").", true);
  }
}
// a send whose answer never came back may still have arrived: trying the same words again carries the same id, and the
// board answers with what it already made, so nothing is sent twice; changed words are a new send
function sendIdFor(key, payload) {
  const sig = JSON.stringify(payload),
    cur = state.sendIds[key];
  if (cur && cur.sig === sig) return cur.id;
  const id =
    window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  state.sendIds[key] = { id: id, sig: sig };
  return id;
}
async function submit(form) {
  const kind = form.getAttribute("data-form"),
    key = form.getAttribute("data-key");
  if (state.posting) return;
  const text = (state.drafts[key] || "").trim(),
    files = (state.files[key] || []).map(f => f.id);
  // a message to the operator leaves the box at once and lands where it will sit, so a second press never looks needed;
  // if it is not sent, it goes back into the box
  const flies =
      ["comment", "general", "direct", "feed", "feedcard", "global"].includes(kind) && !!(text || files.length),
    heldFiles = state.files[key] || [];
  let sent = false,
    from = null;
  if (flies) {
    const ta = form.querySelector("textarea");
    from = ta ? ta.getBoundingClientRect() : null;
    state.pending[key] = { text: text, files: files.length, landing: !!from && !lessMotion() };
    state.drafts[key] = "";
    state.files[key] = [];
    if (ta) ta.value = "";
  }
  state.posting = true;
  render();
  if (flies) flyIn(form, key, from);
  try {
    if (kind === "comment") {
      const cardId = key.slice(5);
      if (!text && !files.length) throw new Error("write something first");
      await data.postComment(cardId, text, files, sendIdFor(key, [cardId, text, files]));
      sent = true;
      delete state.sendIds[key];
      markSeen(cardId);
      await data.thread(cardId);
    } else if (kind === "general") {
      const board = key.slice(8);
      if (!text && !files.length) throw new Error("write something first");
      await data.postGeneral(board, text, files, undefined, sendIdFor(key, [board, text, files]));
      sent = true;
      delete state.sendIds[key];
      markSeen("general:" + board);
      await data.general(board);
    } else if (kind === "feed") {
      // a feed column's box: his words on that board's General, as from its own box
      const board = key.slice(5);
      if (!text && !files.length) throw new Error("write something first");
      await data.postGeneral(board, text, files, undefined, sendIdFor(key, [board, text, files]));
      sent = true;
      delete state.sendIds[key];
      markSeen("general:" + board);
      await data.feed(board);
    } else if (kind === "feedcard") {
      // a feed column's box pointed at a card by Reply: his words in that card's conversation, as from the card
      // itself; then the box writes to General again
      const m = /^fcard:([^:]+):(.+)$/.exec(key),
        board = m[1],
        cardId = m[2];
      if (!text && !files.length) throw new Error("write something first");
      await data.postComment(cardId, text, files, sendIdFor(key, [cardId, text, files]));
      sent = true;
      delete state.sendIds[key];
      if (state.feedTo[board] === cardId) delete state.feedTo[board];
      markSeen(cardId);
      await data.feed(board);
    } else if (kind === "global") {
      // one message to every operator
      if (!text && !files.length) throw new Error("write something first");
      await data.postGlobal(text, files, sendIdFor(key, ["global", text, files]));
      sent = true;
      delete state.sendIds[key];
      await loadFeed();
    } else if (kind === "steward-ask") {
      const board = key.slice(6);
      if (!text) throw new Error("write the question first");
      await data.steward(board, { kind: "ask", text: text });
      state.drafts[key] = "";
      await data.load();
    } else if (kind === "bundle") {
      const board = key.slice(7);
      const partFiles = k => (state.files[key + ":" + k] || []).map(f => f.id);
      const parts = Object.keys(state.bundle.parts)
        .filter(k => (state.bundle.parts[k] || "").trim() || partFiles(k).length)
        .map(k => ({ cardId: k, text: (state.bundle.parts[k] || "").trim(), attachments: partFiles(k) }));
      if (state.bundle.general && (text || files.length)) parts.push({ text: text, attachments: files });
      if (!parts.length) throw new Error("write at least one comment first");
      await data.postBundle(board, parts, [], sendIdFor(key, [board, parts]));
      delete state.sendIds[key];
      markSeen("general:" + board);
      parts.forEach(p => {
        if (p.cardId) markSeen(p.cardId);
      });
      Object.keys(state.files).forEach(k => {
        if (k === key || k.startsWith(key + ":")) state.files[k] = [];
      });
      state.bundle = { on: false, board: null, parts: {}, general: false };
      state.drafts[key] = "";
      await data.general(board);
      for (const p of parts)
        if (p.cardId && (state.expanded.has(p.cardId) || state.panel === p.cardId)) await data.thread(p.cardId);
    } else if (kind === "direct") {
      const board = key.slice(7);
      if (!text && !files.length) throw new Error("write something first");
      await data.postDirect(board, text, files, sendIdFor(key, [board, text, files, "direct"]));
      sent = true;
      delete state.sendIds[key];
      markSeen("transcript:" + board);
      await data.transcript(board);
    } else if (kind === "newtask") {
      const board = key.slice(8),
        nt = state.nt;
      if (!nt.title.trim()) throw new Error("give the task a title");
      if (!text) throw new Error("describe the task");
      const body =
        "Please open a task.\n\n**Title:** " +
        nt.title.trim() +
        "\n**Severity:** " +
        nt.severity +
        " &middot; **Complexity:** " +
        nt.complexity +
        " &middot; **Nature:** " +
        nt.nature +
        "\n\n**Description:**\n" +
        text;
      await data.postGeneral(board, body.replace(/&middot;/g, "·"), files, "task-request");
      markSeen("general:" + board);
      state.drafts[key] = "";
      state.files[key] = [];
      state.nt = { title: "", severity: "low", complexity: "small", nature: "ops" };
      state.newTask = null;
      await data.general(board);
    }
    state.focusKey = kind === "newtask" ? null : kind === "feedcard" ? "feed:" + key.split(":")[1] : key;
    // the box Owner is typing in is never patched by a render, so a sent draft is cleared here
    {
      const ta = document.querySelector('[data-draft="' + key + '"]');
      if (ta && !state.drafts[key]) ta.value = "";
    }
  } catch (e) {
    if (flies && !sent) {
      // back into the box, ahead of anything typed since
      const cur = state.drafts[key] || "";
      state.drafts[key] = text + (cur ? "\n\n" + cur : "");
      state.files[key] = heldFiles.concat(state.files[key] || []);
      const ta = document.querySelector('[data-draft="' + key + '"]');
      if (ta) ta.value = state.drafts[key];
    }
    showBanner((sent ? "Sent, but the page could not refresh: " : "Not sent: ") + e.message + ".", true);
  }
  if (flies) delete state.pending[key];
  state.posting = false;
  render();
}
// the sent words fly from the box to where they land: one copy of the new message, moved by transform and opacity
// only, which the browser does without laying the page out again, in a fifth of a second; none when the system asks for
// less motion
const lessMotion = () => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {
    return false;
  }
};
function flyIn(form, key, from) {
  const p = state.pending[key],
    sel = '[data-pending="' + CSS.escape(key) + '"]';
  const land = () => {
    if (state.pending[key]) state.pending[key].landing = false;
    document.querySelectorAll(sel).forEach(x => x.classList.remove("landing"));
  };
  const scope = form.closest(".pw-talk, .panel, .card, .side") || document,
    b = scope.querySelector(sel);
  if (!b) return land();
  for (let el = b.parentElement; el && el !== document.body; el = el.parentElement) {
    // where it lands is in view, and stays followed
    if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) {
      el.scrollTop = el.scrollHeight;
      if (el.classList.contains("panel") || el.classList.contains("pw-talk")) state.pinned.panel = false;
      else if (el.classList.contains("dthread")) state.pinned[el.id] = false;
      break;
    }
  }
  if (!p || !p.landing || !from) return land();
  const to = b.getBoundingClientRect(),
    g = b.cloneNode(true);
  g.classList.remove("landing", "pending");
  g.removeAttribute("data-pending");
  g.classList.add("send-ghost");
  g.style.cssText =
    "left:" +
    to.left +
    "px;top:" +
    to.top +
    "px;width:" +
    to.width +
    "px;height:" +
    to.height +
    "px;font-size:" +
    getComputedStyle(b).fontSize;
  document.body.appendChild(g);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    g.remove();
    land();
  };
  try {
    const a = g.animate(
      [
        {
          transform: "translate(" + (from.left - to.left) + "px," + (from.top - to.top) + "px) scale(.97)",
          opacity: 0.4,
        },
        { transform: "none", opacity: 1 },
      ],
      { duration: 200, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
    a.onfinish = finish;
    a.oncancel = finish;
  } catch (e) {
    finish();
  }
  setTimeout(finish, 700); // never left hidden
}
