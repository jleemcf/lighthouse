// ---------- what his clicks, keys, pastes and drags do ----------
$root.addEventListener("click", ev => {
  // a click anywhere else shuts the machine dropdown
  if (state.railMenu && !ev.target.closest(".rail-pick")) {
    state.railMenu = false;
    render();
  }
  // a link in a message opens in its own tab, and does nothing else (no card opens or closes)
  if (ev.target.closest("a.ext")) return;
  const a = ev.target.closest("[data-act]");
  if (a) {
    const act = a.getAttribute("data-act"),
      id = a.getAttribute("data-id");
    ev.stopPropagation();
    if (act === "tab") return setView(id);
    if (act === "goto-card") {
      setView(a.getAttribute("data-board"));
      expandCard(id);
      const el = document.getElementById("card-" + id);
      if (el) el.scrollIntoView({ block: "nearest" });
      return;
    }
    // Reply on a feed entry or an ask: the column's box writes to that card, once (pressed again, back to General)
    if (act === "feed-reply") {
      const board = a.getAttribute("data-board");
      if (state.feedTo[board] === id) delete state.feedTo[board];
      else state.feedTo[board] = id;
      render();
      const ta = document.querySelector("#fcol-" + CSS.escape(board) + " .ffoot textarea");
      if (ta && state.feedTo[board]) ta.focus();
      return;
    }
    if (act === "feed-to-clear") {
      delete state.feedTo[a.getAttribute("data-board")];
      render();
      return;
    }
    // General's earlier messages load when he asks
    if (act === "unfold") {
      const k = a.getAttribute("data-key");
      state.unfold.add(k);
      if (k.startsWith("gen:"))
        data
          .general(k.slice(4))
          .then(render)
          .catch(() => {});
      return render();
    }
    if (act === "fold") {
      const k = a.getAttribute("data-key");
      state.unfold.delete(k);
      if (k.startsWith("gen:"))
        data
          .general(k.slice(4))
          .then(render)
          .catch(() => {});
      return render();
    }
    if (act === "st-press") {
      a.disabled = true;
      data
        .steward(a.getAttribute("data-board"), { kind: a.getAttribute("data-kind"), cardId: id || undefined })
        .then(() => refresh())
        .catch(e => {
          showBanner("Not asked: " + e.message + ".", true);
          render();
        });
      return;
    }
    if (act === "st-jump") {
      // from the verdict on an ask to the report where it sits in the conversation, earlier ones unfolded if need be
      const cid = a.getAttribute("data-card"),
        go = () => {
          const sel = "#adv-" + CSS.escape(id),
            el = document.querySelector("#panel " + sel) || document.querySelector(sel);
          if (!el) return false;
          state.pinned.panel = true;
          el.scrollIntoView({ block: "center", behavior: lessMotion() ? "auto" : "smooth" });
          el.classList.add("flash");
          setTimeout(() => el.classList.remove("flash"), 1600);
          return true;
        };
      if (!go()) {
        state.unfold.add("card:" + cid + ":panel");
        state.unfold.add("card:" + cid + ":card");
        render();
        setTimeout(go, 0);
      }
      return;
    }
    if (act === "st-put") {
      a.disabled = true;
      const item = a.getAttribute("data-item");
      data
        .advicePut(id, item == null ? undefined : Number(item))
        .then(() => refresh())
        .catch(e => {
          showBanner("Not put: " + e.message + ".", true);
          render();
        });
      return;
    }
    if (act === "st-open") {
      state.explain = id;
      if (!state.adviceFull[id])
        data
          .advice(id)
          .then(() => render())
          .catch(e => showBanner("Could not open it: " + e.message + ".", true));
      return render();
    }
    if (act === "st-close") {
      state.explain = null;
      return render();
    }
    // the side panel's overview line opens General full screen
    if (act === "ov-open") {
      state.wide = true;
      ls("lh.wide", "1");
      markSeen("general:" + state.view);
      return render();
    }
    // General, from the task list
    if (act === "rail-general") {
      state.panel = null;
      state.newTask = null;
      state.railBoard = null;
      state.railMenu = false;
      state.drawer = true;
      state.side = "general";
      ls("lh.drawer", "1");
      if (state.view !== id) return setView(id);
      return render();
    }
    if (act === "gmode") {
      const b = a.getAttribute("data-board");
      state.genMode[b] = a.getAttribute("data-v");
      render();
      const t = document.querySelector("#general-" + CSS.escape(b) + " .dfoot textarea");
      if (t) t.focus();
      return;
    }
    if (act === "st-unclear") {
      const more = prompt("What is still unclear? One line.");
      if (!more || !more.trim()) return;
      data
        .steward(a.getAttribute("data-board"), { kind: "explain", cardId: id, line: more.trim() })
        .then(() => refresh())
        .catch(e => {
          showBanner("Not asked: " + e.message + ".", true);
          render();
        });
      return;
    }
    if (act === "jump") {
      // top or newest, inside the panel or inside an expanded card
      const dir = a.getAttribute("data-dir");
      if (a.getAttribute("data-where") === "panel") {
        const p = taskPanelScrollBox();
        if (!p) return;
        state.pinned.panel = dir === "top";
        p.scrollTo({ top: dir === "top" ? 0 : p.scrollHeight, behavior: "smooth" });
        return;
      }
      const card = document.getElementById("card-" + id);
      if (!card) return;
      const body = card.querySelector(".cbody");
      if (dir === "top") {
        if (body) body.scrollTo({ top: 0, behavior: "smooth" });
        card.scrollIntoView({ block: "start", behavior: "smooth" });
      } else {
        if (body) body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
        const box = card.querySelector(".compose textarea") || card.querySelector(".thread") || card;
        box.scrollIntoView({ block: "end", behavior: "smooth" });
      }
      return;
    }
    if (act === "lane") {
      if (state.folded.has(id)) state.folded.delete(id);
      else state.folded.add(id);
      saveFolded();
      return render();
    }
    if (act === "more") {
      if (state.more.has(id)) state.more.delete(id);
      else state.more.add(id);
      return render();
    }
    if (act === "cards-open") {
      for (const c of state.cards)
        if (c.board === id && !state.folded.has(id + ":" + c.status)) state.expanded.add(c.id);
      render();
      for (const c of state.cards) if (c.board === id && state.expanded.has(c.id)) data.thread(c.id).catch(() => {});
      return;
    }
    if (act === "cards-collapse") {
      for (const c of state.cards) if (c.board === id) state.expanded.delete(c.id);
      return render();
    }
    if (act === "open-panel") return openPanel(id);
    // a task named in the transcript opens full screen, for this once: the remembered switch stays as he set it
    if (act === "open-full") {
      state.panelWide = true;
      return openPanel(id);
    }
    if (act === "close-panel" || act === "newtask-close") return closeOverlays();
    if (act === "collapse") return collapseCard(id);
    if (act === "density") {
      state.detailed = a.getAttribute("data-v") === "1";
      ls("lh.detailed", state.detailed ? "1" : "0");
      return render();
    }
    if (act === "hist") {
      state.activityOpen = state.activityOpen === id ? false : id;
      return render();
    }
    if (act === "col") {
      if (state.expandedCols.has(id)) state.expandedCols.delete(id);
      else state.expandedCols.add(id);
      return render();
    }
    if (act === "pview") {
      state.panelView = a.getAttribute("data-v");
      ls("lh.panelView", state.panelView);
      return render();
    }
    // back to the side panel it opened from
    if (act === "wide" && state.panel && state.panelWide && !state.wide) {
      state.panelWide = false;
      return render();
    }
    if (act === "wide") {
      state.wide = !state.wide;
      ls("lh.wide", state.wide ? "1" : "0");
      return render();
    }
    if (act === "rail") {
      state.rail = !state.rail;
      ls("lh.rail", state.rail ? "1" : "0");
      return render();
    }
    if (act === "rail-menu") {
      state.railMenu = !state.railMenu;
      render();
      const it = state.railMenu && document.querySelector('#pw-rail .rail-menu [aria-checked="true"]');
      if (it) it.focus();
      return;
    }
    if (act === "rail-board") {
      state.railBoard = id;
      state.railMenu = false;
      render();
      const r = document.getElementById("pw-rail"),
        b = r && r.querySelector(".rail-pick-btn");
      if (r) r.scrollTop = 0;
      if (b) b.focus();
      return;
    }
    if (act === "bundle-toggle") {
      const on = state.bundle.on && state.bundle.board === id;
      if (on && sideOf(id) !== "bundle") {
        state.side = "bundle";
        return render();
      }
      state.bundle = on
        ? { on: false, board: null, parts: {}, general: false }
        : { on: true, board: id, parts: {}, general: false };
      state.side = "bundle";
      return render();
    }
    if (act === "bundle-general") {
      if (state.bundle.on) {
        state.bundle.general = true;
        state.focusKey = "bundle:" + state.bundle.board;
      }
      return render();
    }
    if (act === "bundle-general-remove") {
      state.bundle.general = false;
      return render();
    }
    if (act === "drawer") {
      if (state.drawer && sideOf(id) !== "general") {
        state.side = "general";
        return render();
      }
      state.drawer = !state.drawer;
      state.side = state.drawer ? "general" : null;
      ls("lh.drawer", state.drawer ? "1" : "0");
      return render();
    }
    if (act === "ops") {
      if (state.ops === id && sideOf(id) === "ops") {
        state.ops = null;
        state.side = null;
      } else {
        state.ops = id;
        state.side = "ops";
        markSeen("ops:" + id);
      }
      return render();
    }
    if (act === "transcript") {
      if (state.transcript === id && sideOf(id) === "transcript") {
        state.transcript = null;
        state.side = null;
      } else {
        state.transcript = id;
        state.side = "transcript";
        markSeen("transcript:" + id);
        data
          .transcript(id)
          .then(render)
          .catch(e => showBanner("The transcript could not be read (" + e.message + ").", true));
      }
      return render();
    }
    // Owner settles an ask himself
    if (act === "ask-done") {
      a.disabled = true;
      data
        .resolveAsk(id, a.getAttribute("data-did") || undefined)
        .then(() => refresh())
        .catch(e => {
          showBanner("Not done: " + e.message + ".", true);
          render();
        });
      return;
    }
    if (act === "prompt-edit") {
      state.editPrompt = id;
      state.focusKey = "prompt:" + id;
      return render();
    }
    if (act === "prompt-edit-cancel") {
      state.editPrompt = null;
      delete state.drafts["prompt:" + id];
      return render();
    }
    if (act === "prompt-send-edited") {
      // Send with edit: the same instruction, carrying his version
      const text = (state.drafts["prompt:" + id] || "").trim();
      if (!text) return showBanner("The prompt is empty; write it or cancel.", true);
      a.disabled = true;
      data
        .decide(id, "send", text)
        .then(() => {
          state.editPrompt = null;
          delete state.drafts["prompt:" + id];
          return refresh();
        })
        .catch(e => {
          showBanner("Not done: " + e.message + ".", true);
          render();
        });
      return;
    }
    if (act === "prompt-send" || act === "prompt-other") {
      // Owner's choice on a suggested prompt
      const choice = act === "prompt-send" ? "send" : "other",
        key = a.getAttribute("data-key");
      a.disabled = true;
      data
        .decide(id, choice)
        .then(() => {
          if (choice === "other") state.focusKey = key;
          return refresh();
        })
        .catch(e => {
          showBanner("Not done: " + e.message + ".", true);
          render();
        });
      return;
    }
    if (act === "wx") {
      const order = ["live", "clear", "cloudy", "rain", "snow", "storm"];
      state.wx = order[(order.indexOf(state.wx) + 1) % order.length];
      ls("lh.weather", state.wx);
      return render();
    }
    if (act === "season") {
      const order = ["auto", "spring", "summer", "autumn", "winter"];
      state.season = order[(order.indexOf(state.season) + 1) % order.length];
      ls("lh.season", state.season);
      return render();
    }
    if (act === "letter-close") {
      state.letter = null;
      return render();
    }
    if (act === "scene") {
      const p = sceneXY(a, ev);
      if (p && window.LighthouseScene && window.LighthouseScene.click(p.x, p.y)) return;
      return;
    }
    // only the art, or everything back
    if (act === "art") {
      state.art = !state.art;
      ls("lh.art", state.art ? "1" : "0");
      return render();
    }
    if (act === "feed") {
      state.feed = !state.feed;
      ls("lh.feed", state.feed ? "1" : "0");
      render();
      if (state.feed) loadFeed().then(render);
      return;
    }
    if (act === "lite") {
      state.lite = !state.lite;
      ls("lh.lite", state.lite ? "1" : "0");
      document.documentElement.classList.toggle("lite", state.lite);
      if (window.LighthouseScene && window.LighthouseScene.setLite) window.LighthouseScene.setLite(state.lite);
      return render();
    }
    if (act === "demo") {
      // the alarm demo names one operator at random, so the others can be seen carrying on
      const v = a.getAttribute("data-v");
      if (v === "alarm") {
        if (state.demo.alarm) state.demo.alarm = false;
        else {
          const on = boardIds().filter(b => state.demo.shift || presence(state.boards[b]) !== "off"),
            pool = on.length ? on : boardIds();
          state.demo.alarm = pool[Math.floor(Math.random() * pool.length)];
        }
      } else state.demo[v] = !state.demo[v];
      if (window.LighthouseScene)
        window.LighthouseScene.debug({
          presence: state.demo.shift ? "on" : undefined,
          need: state.demo.alarm || undefined,
        });
      return render();
    }
    if (act === "bundle-add") return addToBundle(state.view, id);
    if (act === "bundle-remove") {
      delete state.bundle.parts[id];
      return render();
    }
    if (act === "attach") {
      const key = a.getAttribute("data-key"),
        inp = a.closest("form").querySelector('input[type=file][data-file="' + key + '"]');
      if (inp) inp.click();
      return;
    }
    if (act === "file-remove") {
      const key = a.getAttribute("data-key"),
        i = Number(a.getAttribute("data-i"));
      (state.files[key] || []).splice(i, 1);
      state.focusKey = key;
      return render();
    }
    if (act === "newtask") {
      state.newTask = id;
      state.panel = null;
      state.focusKey = "newtask:" + id;
      return render();
    }
    return;
  }
  const card = ev.target.closest("[data-card]");
  if (card && !ev.target.closest("textarea, input, select, button, a, .cxi")) {
    if (window.getSelection && String(window.getSelection())) return;
    const id = card.getAttribute("data-card");
    if (state.expanded.has(id)) collapseCard(id);
    else expandCard(id);
    return;
  }
  const g = ev.target.closest("[data-drop]");
  if (g && unreadGeneral(state.view)) {
    markSeen("general:" + state.view);
    render();
  }
});
$root.addEventListener("keydown", ev => {
  // Escape shuts the dropdown first, the card after
  if (ev.key === "Escape" && state.railMenu) {
    state.railMenu = false;
    render();
    const b = document.querySelector("#pw-rail .rail-pick-btn");
    if (b) b.focus();
    return;
  }
  if (ev.key === "Escape" && (state.panel || state.newTask)) {
    closeOverlays();
    return;
  }
  // General full screen closes as a task does
  if (
    ev.key === "Escape" &&
    state.wide &&
    state.drawer &&
    sideOf(state.view) === "general" &&
    !ev.target.closest("textarea, input")
  ) {
    state.drawer = false;
    state.side = null;
    ls("lh.drawer", "0");
    render();
    return;
  }
  if (ev.key === "Escape" && !ev.target.closest("textarea, input")) {
    let n = 0;
    for (const c of state.cards)
      if (c.board === state.view && state.expanded.has(c.id)) {
        state.expanded.delete(c.id);
        n++;
      }
    if (n) {
      render();
      return;
    }
  }
  const lane = ev.target.closest && ev.target.closest('[data-act="lane"]');
  if (lane && ev.target === lane && (ev.key === "Enter" || ev.key === " ")) {
    ev.preventDefault();
    lane.click();
    return;
  }
  const card = ev.target.closest && ev.target.closest("[data-card]");
  if (card && ev.target === card && (ev.key === "Enter" || ev.key === " ")) {
    ev.preventDefault();
    const id = card.getAttribute("data-card");
    if (state.expanded.has(id)) collapseCard(id);
    else expandCard(id);
  }
});
$root.addEventListener("submit", ev => {
  const f = ev.target.closest("form[data-form]");
  if (!f) return;
  ev.preventDefault();
  submit(f);
});
// arrows and selection count as typing too
$root.addEventListener(
  "keydown",
  ev => {
    const t = ev.target;
    if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) lastKey = Date.now();
  },
  true,
);
$root.addEventListener("input", ev => {
  lastKey = Date.now();
  const t = ev.target;
  if (t.hasAttribute("data-draft")) {
    state.drafts[t.getAttribute("data-draft")] = t.value;
    const tb = t.closest("[data-drop]");
    if (tb && unreadGeneral(state.view)) markSeen("general:" + state.view);
    return;
  }
  if (t.hasAttribute("data-bpart")) {
    state.bundle.parts[t.getAttribute("data-bpart")] = t.value;
    return;
  }
  if (t.hasAttribute("data-nt")) {
    state.nt[t.getAttribute("data-nt")] = t.value;
  }
});
$root.addEventListener("change", ev => {
  const t = ev.target;
  if (t.hasAttribute("data-file")) {
    const key = t.getAttribute("data-file");
    Array.from(t.files || []).forEach(f => addFile(key, f));
    t.value = "";
  }
  if (t.hasAttribute("data-nt")) {
    state.nt[t.getAttribute("data-nt")] = t.value;
  }
});
// a pasted image attaches to the box it is pasted in; a bundle part's box takes images for that task
$root.addEventListener("paste", ev => {
  const t = ev.target,
    key = t.getAttribute ? t.getAttribute("data-fkey") || t.getAttribute("data-draft") : null;
  if (!key) return;
  const items = Array.from((ev.clipboardData && ev.clipboardData.items) || []).filter(
    it => it.kind === "file" && /^image\//.test(it.type),
  );
  if (!items.length) return;
  ev.preventDefault();
  items.forEach(it => {
    const f = it.getAsFile();
    if (f) addFile(key, f);
  });
});
// the General chip or a card dragged into the bundle box; selected text dragged out of a card is text, not the card
$root.addEventListener("dragstart", ev => {
  const chip = ev.target.closest && ev.target.closest("[data-drag]");
  if (chip) {
    ev.dataTransfer.setData("text/plain", "general:" + chip.getAttribute("data-drag"));
    ev.dataTransfer.effectAllowed = "copy";
    return;
  }
  const card = ev.target.closest && ev.target.closest("[data-card]");
  if (!card || card.getAttribute("draggable") !== "true" || !state.bundle.on) return;
  ev.dataTransfer.setData("text/plain", card.getAttribute("data-card"));
  ev.dataTransfer.effectAllowed = "copy";
});
$root.addEventListener("dragover", ev => {
  const g = ev.target.closest && ev.target.closest("[data-drop]");
  if (!g) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = "copy";
  g.classList.add("dropping");
});
$root.addEventListener("dragleave", ev => {
  const g = ev.target.closest && ev.target.closest("[data-drop]");
  if (g && !g.contains(ev.relatedTarget)) g.classList.remove("dropping");
});
$root.addEventListener("drop", ev => {
  const g = ev.target.closest && ev.target.closest("[data-drop]");
  if (!g) return;
  ev.preventDefault();
  g.classList.remove("dropping");
  const id = ev.dataTransfer.getData("text/plain"),
    board = g.getAttribute("data-drop");
  if (id === "general:general") {
    if (!state.bundle.on || state.bundle.board !== board)
      state.bundle = { on: true, board: board, parts: {}, general: false };
    state.bundle.general = true;
    state.side = "bundle";
    state.focusKey = "bundle:" + board;
    render();
  } else if (id && state.cards.some(c => c.id === id)) addToBundle(board, id);
});
$root.addEventListener(
  "toggle",
  ev => {
    if (ev.target.tagName !== "DETAILS") return;
    const adv = ev.target.getAttribute("data-adv");
    // a fold the page remembers across its redraws (the earlier overviews)
    const fold = ev.target.getAttribute("data-fold");
    if (fold) {
      if (ev.target.open) state.unfold.add(fold);
      else state.unfold.delete(fold);
      return;
    }
    if (!adv) {
      state.histOpen = ev.target.open;
      return;
    }
    // an advice's reasons come when he opens them, and stay open across the page's redraws
    if (ev.target.open) {
      state.adviceOpen.add(adv);
      if (!state.adviceFull[adv])
        data
          .advice(adv)
          .then(() => render())
          .catch(() => {});
    } else state.adviceOpen.delete(adv);
  },
  true,
);
$root.addEventListener(
  "scroll",
  ev => {
    const dw = ev.target;
    if (
      dw.classList &&
      (dw.classList.contains("dthread") ||
        dw === phonePanelScroll?.box ||
        dw.classList.contains("panel") ||
        dw.classList.contains("pw-talk") ||
        dw.classList.contains("fbody") ||
        dw.id === "glist")
    )
      state.pinned[
        dw === phonePanelScroll?.box || dw.classList.contains("panel") || dw.classList.contains("pw-talk")
          ? "panel"
          : dw.id
      ] = dw.scrollHeight - dw.scrollTop - dw.clientHeight > 24;
  },
  true,
);
