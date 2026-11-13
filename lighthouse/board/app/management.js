const managementPanel = document.getElementById("management");
const managementToggle = document.getElementById("manageBoards");
function clearGrantOnce() {
  const field = document.getElementById("grantValue");
  if (field) field.value = "";
  const panel = document.getElementById("grantOnce");
  if (panel) {
    panel.replaceChildren();
    panel.hidden = true;
  }
}
async function managementRequest(action, input, credential) {
  const headers = { Accept: "application/json" };
  if (credential || TOKEN) headers.Authorization = "Bearer " + (credential || TOKEN);
  if (input !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["X-Lighthouse-CSRF"] = managementModel.csrf || "";
  }
  const response = await fetch("/api/registry/" + action, {
    method: input === undefined ? "GET" : "POST",
    headers,
    body: input === undefined ? undefined : JSON.stringify(input),
    credentials: "same-origin",
    redirect: "error",
  });
  if (!response.ok) throw new Error("Management request refused (HTTP " + response.status + ").");
  return response.json();
}
async function managementLoad(open = false) {
  clearGrantOnce();
  const meta = await managementRequest("context");
  managementModel.meta = meta;
  if (!meta.enabled) return true;
  managementToggle.hidden = meta.signedIn && !meta.hostAdmin && !meta.boards.length;
  if (meta.signedIn) managementModel.csrf = (await managementRequest("csrf")).csrf;
  if (open || !meta.signedIn || (meta.hostAdmin && !meta.boards.length)) {
    managementModel.open = true;
    managementPanel.innerHTML = managementHtml(meta);
    managementPanel.hidden = false;
    $app.hidden = true;
  }
  return meta.signedIn;
}
function managementFeedback(text) {
  const field = document.getElementById("managementFeedback");
  if (field) field.textContent = text;
}
function displayGrantOnce(handoff) {
  const panel = document.getElementById("grantOnce");
  panel.innerHTML =
    "<h2>Private invitation: copy once</h2><p>Transfer this JSON privately to the operator. " +
    "Never put it in chat, a URL or a command. Closing or leaving this page clears it.</p>" +
    '<label>Invitation JSON<textarea id="grantValue" readonly spellcheck="false"></textarea></label>' +
    managementButton("copy-grant", "Copy once and clear") +
    managementButton("dismiss-grant", "Dismiss and clear");
  document.getElementById("grantValue").value = JSON.stringify(handoff);
  panel.hidden = false;
  panel.scrollIntoView({ block: "nearest" });
}
function displayArchivePreview(preview) {
  managementModel.preview = preview;
  const panel = document.getElementById("archivePreview");
  const pending = Object.entries(preview.pending)
    .map(([name, value]) => name + ": " + (Array.isArray(value) ? value.length : value ? "active" : "none"))
    .join("; ");
  let fields = "<p>" + esc(pending) + "</p><p>Archiving retains history and read access; new work is refused.</p>";
  if (managementModel.meta.hostAdmin)
    fields +=
      '<label><input type="checkbox" name="preserve"> Explicitly preserve unresolved work ' +
      "without completing it</label>" +
      managementField("reason", "Disposition reason", 'maxlength="500"');
  panel.innerHTML = managementForm("archive", preview.id, "Confirm archive preview", fields, "Archive this board");
  panel.hidden = false;
  panel.scrollIntoView({ block: "nearest" });
}
async function managementSubmit(form) {
  const action = form.dataset.manage;
  const value = name => form.elements.namedItem(name)?.value || "";
  const input = { id: form.dataset.board };
  if (action === "login") {
    const file = form.elements.namedItem("administrator").files[0];
    let administrator;
    try {
      if (!file || file.size > 16384) throw new Error();
      administrator = JSON.parse(await file.text());
      await managementRequest("session", {}, administrator.credential);
    } finally {
      administrator = null;
      form.reset();
    }
    TOKEN = "";
    localStorage.removeItem("lh.token");
    await managementLoad(true);
    await data.connect();
    await refresh();
    return;
  }
  if (action === "create")
    input.board = {
      name: value("name"),
      access: { [value("owner")]: "owner" },
      protocol: "tools",
      steward: form.elements.namedItem("steward").checked,
    };
  else if (action === "rename") input.name = value("name");
  else if (action === "member") {
    input.principal = value("principal");
    const selected = value("role");
    input.role = selected === "remove" ? null : selected.includes("+") ? selected.split("+") : selected;
  } else if (action === "grant") {
    const file = form.elements.namedItem("request").files[0];
    if (!file || file.size > 16384) throw new Error("Select an installation request.");
    const request = JSON.parse(await file.text());
    const board = managementModel.meta.boards.find(candidate => candidate.id === input.id);
    input.proofVerifier = request.proofVerifier;
    input.scope = {
      action: "bind",
      boardId: board.id,
      principal: value("principal"),
      role: value("role"),
      protocol: board.protocol,
      installationId: request.installationId,
    };
  } else if (action === "archive") {
    input.confirmation = managementModel.preview?.confirmation;
    if (form.elements.namedItem("preserve")?.checked)
      input.disposition = { action: "preserve", reason: value("reason") };
  }
  const result = await managementRequest(action, input);
  await managementLoad(true);
  if (action === "grant") displayGrantOnce(result);
  else {
    managementFeedback("Saved. Board identity and history are unchanged.");
    await refresh();
  }
}
async function managementClick(button) {
  const action = button.dataset.manage;
  if (action === "close") {
    clearGrantOnce();
    managementPanel.hidden = true;
    $app.hidden = false;
    managementModel.open = false;
    return;
  }
  if (action === "dismiss-grant") {
    clearGrantOnce();
    return;
  }
  if (action === "copy-grant") {
    const field = document.getElementById("grantValue");
    if (!field?.value) return;
    const text = field.value;
    clearGrantOnce();
    try {
      await navigator.clipboard.writeText(text);
      managementFeedback("Copied once. Clear the clipboard after the private transfer.");
    } catch {
      managementFeedback("Copy failed. Revoke this invitation and issue a new one before retrying.");
    }
    return;
  }
  clearGrantOnce();
  if (action === "logout") {
    await managementRequest("logout", {});
    window.location.reload();
    return;
  }
  const input = { id: button.dataset.board };
  if (action === "preview") return displayArchivePreview(await managementRequest("preview", input));
  if (action === "move") {
    input.anchor = button.dataset.anchor;
    input.placement = button.dataset.placement;
    await managementRequest("reorder", input);
  } else if (action === "revoke") await managementRequest(action, { installationId: input.id });
  else if (action === "revoke-grant") await managementRequest(action, input);
  await managementLoad(true);
}
function managementCatch() {
  clearGrantOnce();
  managementFeedback(
    "Request not completed. Refresh before retrying; check your role, invitation expiry or archive blockers.",
  );
}
managementToggle.addEventListener("click", () => managementLoad(true).catch(managementCatch));
managementPanel.addEventListener("submit", event => {
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  managementSubmit(event.target)
    .catch(managementCatch)
    .finally(() => {
      button.disabled = false;
    });
});
managementPanel.addEventListener("click", event => {
  const button = event.target.closest("button[data-manage]");
  if (button) managementClick(button).catch(managementCatch);
});
window.addEventListener("pagehide", clearGrantOnce);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") clearGrantOnce();
});
