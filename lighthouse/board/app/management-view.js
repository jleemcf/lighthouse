const managementModel = { meta: null, csrf: null, preview: null, open: false };
const managementButton = (action, text, id = "") =>
  '<button type="button" data-manage="' + action + '" data-board="' + esc(id) + '">' + text + "</button>";
const managementField = (name, label, extra = "") =>
  "<label>" + label + '<input name="' + name + '" ' + extra + "></label>";
function managementForm(action, id, title, fields, button) {
  return (
    '<form data-manage="' +
    action +
    '" data-board="' +
    esc(id) +
    '"><h3>' +
    title +
    "</h3>" +
    fields +
    '<button type="submit">' +
    button +
    "</button></form>"
  );
}
function managementRoleOptions(includeRemove = false) {
  return ["viewer", "commenter", "operator", "watch", "coordinator", "owner"]
    .concat(["viewer", "commenter", "operator", "watch", "owner"].map(role => role + "+coordinator"))
    .concat(includeRemove ? ["remove"] : [])
    .map(role => '<option value="' + role + '">' + role + "</option>")
    .join("");
}
function managementBoard(board, index, meta) {
  const active = board.lifecycle === "active";
  const reorder = (direction, label, anchor) =>
    anchor
      ? '<button type="button" data-manage="move" data-board="' +
        esc(board.id) +
        '" data-anchor="' +
        esc(anchor.id) +
        '" data-placement="' +
        direction +
        '">' +
        label +
        "</button>"
      : "";
  let html =
    '<article class="management-board"><h2>' +
    esc(board.name) +
    "</h2><p>" +
    esc(board.protocol + " · " + board.lifecycle) +
    '</p><div class="management-actions">' +
    reorder("before", "Move up", meta.boards[index - 1]) +
    reorder("after", "Move down", meta.boards[index + 1]) +
    (active ? managementButton("preview", "Preview archive", board.id) : "") +
    "</div>";
  html += managementForm(
    "rename",
    board.id,
    "Board name",
    managementField("name", "Display name", 'required maxlength="200" value="' + esc(board.name) + '"'),
    "Rename",
  );
  if (active)
    html += managementForm(
      "grant",
      board.id,
      "Invite an operator",
      managementField("request", "Installation request file", 'type="file" accept=".json" required') +
        managementField("principal", "Operator principal", 'required maxlength="160" autocomplete="off"') +
        '<label>Role<select name="role"><option>operator</option><option>watch</option>' +
        "<option>viewer</option><option>commenter</option></select></label>" +
        "<p>Prepare this request with operator setup. The invitation expires in five minutes and works once.</p>",
      "Issue one-use grant",
    );
  const grants = meta.grants.filter(grant => grant.scope.boardId === board.id);
  html +=
    "<h3>Pending invitations</h3><ul>" +
    grants
      .map(
        grant =>
          "<li>" +
          esc(grant.scope.principal) +
          " · expires " +
          esc(new Date(grant.expiresAt).toLocaleString()) +
          " " +
          managementButton("revoke-grant", "Revoke invitation", grant.id) +
          "</li>",
      )
      .join("") +
    "</ul>";
  html +=
    "<h3>Enrolled installations and doctor</h3><ul>" +
    meta.installations
      .filter(record => record.scope.boardId === board.id)
      .map(record => {
        const summary = record.doctor
          ? record.doctor.checks.map(check => check.name + ": " + check.status).join("; ")
          : "Not reported yet. Run lighthouse doctor in the operator home.";
        return (
          "<li><strong>" +
          esc(record.scope.principal) +
          "</strong> · " +
          esc(record.id) +
          "<p>" +
          esc(record.revoked ? "Revoked" : summary) +
          "</p>" +
          (record.doctor ? "<p>Reported " + esc(new Date(record.doctor.at).toLocaleString()) + "</p>" : "") +
          (record.revoked ? "" : managementButton("revoke", "Revoke installation", record.id)) +
          "</li>"
        );
      })
      .join("") +
    "</ul>";
  if (meta.hostAdmin) {
    html +=
      "<h3>Membership</h3><ul>" +
      Object.entries(board.members || {})
        .map(([principal, role]) => "<li>" + esc(principal) + ": " + esc(role || "no access") + "</li>")
        .join("") +
      "</ul>";
    html += managementForm(
      "member",
      board.id,
      "Adopt or change membership",
      managementField("principal", "Principal", 'required maxlength="160" autocomplete="off"') +
        '<label>Role<select name="role">' +
        managementRoleOptions(true) +
        "</select></label>",
      "Save membership",
    );
  }
  return html + "</article>";
}
function managementHtml(meta) {
  let html =
    '<div class="management-head"><h1>' +
    (meta.boards?.length ? "Manage boards" : "Set up Lighthouse") +
    "</h1>" +
    managementButton("close", "Back to board") +
    (meta.hostAdmin ? managementButton("logout", "Sign out of administration") : "") +
    '</div><p id="managementFeedback" role="status" aria-live="polite"></p>';
  if (!meta.signedIn)
    return (
      html +
      managementForm(
        "login",
        "",
        "Sign in privately",
        "<p>Select the protected administrator file created by lighthouse init. " +
          "Its contents are never stored here.</p>" +
          managementField("administrator", "Administrator file", 'type="file" accept=".json" required'),
        "Sign in",
      )
    );
  if (meta.hostAdmin && !meta.boards.length)
    html +=
      '<ol class="management-steps"><li>Create your first board.</li>' +
      "<li>Prepare an operator installation request, then issue its one-use invitation.</li>" +
      "<li>Complete operator setup and run doctor. Its redacted result appears here.</li></ol>";
  if (meta.hostAdmin)
    html += managementForm(
      "create",
      "",
      "Create a board",
      managementField("name", "Board name", 'required maxlength="200"') +
        managementField("owner", "Owner principal", 'required maxlength="160" value="' + esc(meta.principal) + '"') +
        '<label><input type="checkbox" name="steward"> Enable advice steward ' +
        "(requires a configured host runner)</label>" +
        "<p>New boards use tools mode. Optional integrations stay off unless configured.</p>",
      "Create board",
    );
  html += meta.boards.map((board, index) => managementBoard(board, index, meta)).join("");
  if (meta.hostAdmin && meta.audit.length)
    html +=
      "<details><summary>Membership audit</summary><ul>" +
      meta.audit
        .map(
          entry =>
            "<li>" +
            esc(
              entry.at + " · " + entry.actor + " · " + entry.principal + " · " + entry.previous + " → " + entry.role,
            ) +
            "</li>",
        )
        .join("") +
      "</ul></details>";
  return (
    html +
    '<section id="grantOnce" hidden aria-label="Private one-use invitation"></section>' +
    '<section id="archivePreview" hidden aria-label="Archive preview"></section>'
  );
}
