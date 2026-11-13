// The scene in parts (see core.js). This part: the header's small lighthouse, and the operator sprite beside each
// board's shift chip, drawn on their own canvases at the lamp's pace.

// ================= the header's lighthouse, and the operator beside each board's shift chip =================
function zee(ctx, x, y) {
  ctx.fillRect(x, y, 3, 1);
  ctx.fillRect(x + 1, y + 1, 1, 1);
  ctx.fillRect(x, y + 2, 3, 1);
}
function drawChips(t) {
  // <canvas class="opchip" data-op="board-id" data-mood="sleep|idle|stale|panic" width="22" height="18">
  document.querySelectorAll("canvas.opchip").forEach(cv => {
    const ctx = cv.getContext("2d"),
      mood = cv.dataset.mood || "idle",
      cap = operatorColor(cv.dataset.op) || "#93A3B0";
    ctx.clearRect(0, 0, 22, 18);
    if (mood === "sleep") {
      lying(ctx, 3, 17, cap);
      ctx.fillStyle = "#93A3B0";
      for (let i = 0; i < 2; i++) {
        const ph = (t * 0.5 + i * 0.5) % 1;
        ctx.globalAlpha = 1 - ph;
        zee(ctx, 14 + i * 3 + Math.round(ph * 2), 11 - Math.round(ph * 9) - i * 2);
      }
      ctx.globalAlpha = 1;
    } else if (mood === "panic") {
      figure(ctx, 7, 17, cap, { arm: Math.sin(t * 12) > 0 ? "wave1" : "wave2", walk: Math.sin(t * 16) > 0 ? 1 : 0 });
      ctx.fillStyle = "#9FD8FF";
      for (let i = 0; i < 3; i++) {
        const ph = (t * 1.5 + i * 0.33) % 1;
        ctx.fillRect(Math.round(14 + i * 2 + ph * 3), Math.round(3 + ph * 9), 1, 2);
      }
      ctx.fillStyle = Math.sin(t * 8) > 0 ? "#FF6A5B" : "#FFE27A";
      ctx.fillRect(9, 0, 1, 3);
    } else {
      ctx.globalAlpha = mood === "stale" ? 0.5 : 1;
      figure(ctx, 7, 17, cap, { arm: mood === "idle" && Math.sin(t * 0.7) > 0.85 ? "out" : "" });
      ctx.globalAlpha = 1;
      if (mood === "stale") {
        ctx.fillStyle = "#F2B63C";
        ctx.font = "9px monospace";
        ctx.fillText("?", 14, 8);
      }
    }
  });
}
function drawLamp(ts) {
  const t = ts / 1000;
  drawChips(t);
  const cv = document.getElementById("lamp");
  if (!cv || !facts) {
    nextLamp();
    return;
  }
  const ctx = cv.getContext("2d"),
    red = facts.anyUnopened() > 0,
    quiet = !red && facts.live();
  ctx.clearRect(0, 0, 40, 50);
  const col = red ? [255, 106, 91] : quiet ? [76, 195, 138] : [255, 226, 122];
  const th = (t / (red ? 6 : 9)) * Math.PI * 2,
    behind = Math.sin(th) < 0,
    cx = 20,
    cy = 12;
  const beam = a => {
    const L = 44,
      half = 0.16;
    const gr = ctx.createLinearGradient(cx, cy, cx + Math.cos(th) * L, cy + Math.sin(th) * L * 0.55);
    gr.addColorStop(0, rgba(col, a));
    gr.addColorStop(1, rgba(col, 0));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(th - half) * L, cy + Math.sin(th - half) * L * 0.55);
    ctx.lineTo(cx + Math.cos(th + half) * L, cy + Math.sin(th + half) * L * 0.55);
    ctx.closePath();
    ctx.fillStyle = gr;
    ctx.fill();
    ctx.restore();
  };
  if (behind) beam(0.45);
  ctx.fillStyle = "#2A2834";
  ctx.fillRect(9, 46, 22, 4);
  layer(ctx, "lamp-tower", "lamp-tower", 9, 21, 22, 25, c => {
    for (let y = 21; y < 46; y++) {
      const half = 5 + Math.round((y - 21) / 7),
        bandI = Math.floor((y - 21) / 8);
      for (let x = -half; x < half; x++) {
        const base = bandI % 2 === 1 ? [198, 52, 42] : [246, 243, 236];
        c.fillStyle = rgb(shade(base, cyl((x + 0.5) / half, 0)));
        c.fillRect(cx + x, y, 1, 1);
      }
    }
  }); // its banded tower, drawn once
  ctx.fillStyle = "#2A2834";
  ctx.fillRect(11, 19, 18, 2);
  ctx.fillRect(12, 17, 16, 1);
  for (let x = 12; x <= 28; x += 4) ctx.fillRect(x, 14, 1, 4);
  const glow = red ? 0.6 + 0.4 * Math.sin(t * 2) : 1;
  const rg = ctx.createRadialGradient(cx, cy, 2, cx, cy, 13);
  rg.addColorStop(0, rgba(col, (0.8 * glow).toFixed(2)));
  rg.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = rg;
  ctx.fillRect(cx - 13, cy - 13, 26, 26);
  ctx.fillStyle = "#2A2834";
  ctx.fillRect(14, 6, 12, 11);
  ctx.fillStyle = rgba(col, glow.toFixed(2));
  ctx.fillRect(15, 7, 10, 9);
  ctx.fillStyle = "#FFF6D0";
  ctx.fillRect(19, 9, 2, 5);
  ctx.fillStyle = "#C6342A";
  ctx.fillRect(12, 3, 16, 3);
  ctx.fillRect(15, 1, 10, 2);
  ctx.fillStyle = "#D2B04E";
  ctx.fillRect(19, 0, 2, 1);
  if (!behind) beam(0.55);
  nextLamp();
}
