let handoffPage = null;
function handoffHtml(id, board) {
  const value = board.handoff;
  if (!value?.enabled) return "";
  const owner = value.ownership;
  const saved = value.checkpoint;
  const age = saved ? Math.max(0, Math.floor((Date.now() - saved.createdAt) / 60000)) + " minutes old" : "none";
  const completeness = saved
    ? saved.completeness.length
      ? "missing/stale: " + saved.completeness.join(", ")
      : "complete at capture"
    : "missing";
  const seal = value.transfer?.seal;
  const button = (action, label) =>
    '<button type="button" data-handoff="' + action + '" data-board="' + esc(id) + '">' + label + "</button>";
  return (
    '<section class="handoff-status" aria-label="Operator handoff"><h3>Operator continuity</h3><p>Holder: ' +
    esc(owner.holderSessionId || "unassigned") +
    " · " +
    esc(owner.phase) +
    " · On since " +
    esc(value.since || "off") +
    "</p><p>Checkpoint: " +
    esc(age + " · " + completeness) +
    "</p>" +
    (value.recoveryAvailable
      ? "<p>Presence: " +
        esc(value.presence) +
        " (not an ownership change). Original target: " +
        esc(value.targetAvailability) +
        "</p>"
      : "") +
    (value.transfer?.recovery
      ? '<p role="status">' + value.transfer.recovery.warnings.map(esc).join(" ") + "</p>"
      : "") +
    (seal ? "<p>Seal: " + (seal.degraded ? "degraded — never clean" : "clean at seal") + "</p>" : "") +
    (seal?.blockers.length ? "<ul>" + seal.blockers.map(item => "<li>" + esc(item) + "</li>").join("") + "</ul>" : "") +
    (value.transfer?.heldTargets.length
      ? "<p>Dispatch held: " + esc(value.transfer.heldTargets.join(", ")) + "</p>"
      : "") +
    (value.canManage
      ? '<div class="handoff-actions">' +
        (owner.phase === "working" ? button("prepare", "Hand off") : "") +
        (value.recoveryAvailable && owner.holderSessionId ? button("recover", "Recover") : "") +
        (value.transfer?.status === "sealed" ? button("accept", "Accept") : "") +
        (["draining", "sealed"].includes(value.transfer?.status) ? button("cancel", "Cancel handoff") : "") +
        "</div>"
      : "") +
    "</section>"
  );
}
function clearHandoffPage() {
  handoffPage = null;
  const dialog = document.getElementById("handoffDialog");
  dialog.close();
  dialog.replaceChildren();
}
function openHandoffPage(button) {
  const board = button.dataset.board;
  const action = button.dataset.handoff;
  const value = state.boards[board]?.handoff;
  if (!value?.canManage) return;
  handoffPage = { board, action, operationId: crypto.randomUUID(), value };
  const dialog = document.getElementById("handoffDialog");
  const field =
    action === "recover"
      ? '<label>Named registered successor session<input name="successor" required autocomplete="off"></label>' +
        '<label>Reason<textarea name="reason" required maxlength="500"></textarea></label>' +
        '<label>Old disk available?<select name="disk" required><option value="">Choose explicitly</option>' +
        '<option value="yes">Available for evidence import</option><option value="no">Unavailable</option>' +
        '</select></label><label><input type="checkbox" name="revoke">Explicitly revoke the current holder ' +
        "when this named successor accepts (required before lease expiry)</label>" +
        "<p>Approval is for this loss and epoch only. Recovery is degraded, never a complete handoff. " +
        "Unknown delivery stays blocked until independent evidence reconciles it. The steward keeps running.</p>" +
        "<h3>Visible blockers</h3><ul>" +
        value.pending.blockers.map(item => "<li>" + esc(item) + "</li>").join("") +
        "</ul>"
      : action === "prepare"
        ? '<label>Registered successor session<input name="successor" required autocomplete="off"></label>'
        : action === "accept"
          ? '<label>Private successor credential file<input name="session" type="file" ' +
            'accept=".json" required></label><p>Read the sealed checkpoint here before confirming acceptance. ' +
            "The successor must still complete pickup from its authorized home.</p>"
          : "<p>Pending effects are rechecked. A committed transfer cannot be rolled back.</p>";
  dialog.innerHTML =
    '<form id="handoffForm"><h2>' +
    esc(
      action === "recover"
        ? "Approve recovery"
        : action === "prepare"
          ? "Hand off"
          : action === "accept"
            ? "Accept handoff"
            : "Cancel handoff",
    ) +
    "</h2>" +
    field +
    '<p id="handoffFeedback" role="status"></p><pre id="handoffRead" hidden></pre>' +
    '<button type="submit">' +
    (action === "accept" ? "Read sealed checkpoint" : "Confirm") +
    '</button><button type="button" id="handoffClose">Close</button></form>';
  document.getElementById("handoffClose").onclick = clearHandoffPage;
  document.getElementById("handoffForm").onsubmit = submitHandoffPage;
  dialog.showModal();
}
async function submitHandoffPage(event) {
  event.preventDefault();
  const pending = handoffPage;
  const form = event.target;
  const button = form.querySelector('button[type="submit"]');
  const feedback = document.getElementById("handoffFeedback");
  button.disabled = true;
  try {
    const csrf = await managementRequest("csrf");
    managementModel.csrf = csrf.csrf;
    const value = pending.value;
    let input = pending.input;
    if (!input) {
      input = {
        board: pending.board,
        action: pending.action,
        operationId: pending.operationId,
        expectedEpoch: value.ownership.epoch,
        transferId: value.transfer?.id,
      };
      if (["prepare", "recover"].includes(pending.action)) {
        input.transferId = crypto.randomUUID();
        input.successorSessionId = form.elements.namedItem("successor").value.trim();
        if (pending.action === "recover") {
          input.reason = form.elements.namedItem("reason").value.trim();
          input.oldDiskAvailable = form.elements.namedItem("disk").value === "yes";
          input.revoke = form.elements.namedItem("revoke").checked;
          input.pendingDigest = value.pending.digest;
        }
      } else if (pending.action === "cancel") input.pendingDigest = value.pending.digest;
      else {
        const file = form.elements.namedItem("session").files[0];
        if (!file || file.size > 8192) throw new Error();
        const credential = JSON.parse(await file.text());
        input.action = "read";
        input.sessionCredential = credential.credential;
      }
      pending.input = input;
    }
    const result = await managementRequest("handoff", input);
    if (input.action === "read") {
      const display = document.getElementById("handoffRead");
      display.hidden = false;
      display.textContent = JSON.stringify(
        {
          checkpoint: result.checkpoint,
          changes: result.changes,
          live: result.live,
          dispatch: result.dispatch,
          steward: result.steward,
          recovery: result.recovery,
        },
        null,
        2,
      );
      pending.input = { ...input, action: "accept", operationId: crypto.randomUUID(), readId: result.readId };
      button.textContent = "Accept after reading";
      feedback.textContent = "Read the checkpoint and current records. Acceptance preserves the ongoing shift.";
    } else {
      clearHandoffPage();
      await refresh();
    }
  } catch {
    feedback.textContent =
      "Not completed. Retry this operation unchanged after checking the board. " +
      "If state changed, close and reopen to recheck. No shift was restarted.";
  } finally {
    button.disabled = false;
  }
}
document.addEventListener("click", event => {
  const button = event.target.closest("button[data-handoff]");
  if (button) openHandoffPage(button);
});
window.addEventListener("pagehide", clearHandoffPage);
document.getElementById("handoffDialog").addEventListener("cancel", clearHandoffPage);
