// The scene in parts (see core.js). This part: the near island with its village and port, the traders and fireworks
// off the port, and the winter glacier.

// ---------- the near island with its sleepy village, and the winter glacier ----------
const VILH = new Array(210).fill(0); // the near island's hillside, x 0..200
for (let x = 0; x < 210; x++) {
  const u = x / 200;
  VILH[x] = Math.round(
    46 * Math.exp(-Math.pow((u - 0.36) / 0.27, 2)) +
      24 * Math.exp(-Math.pow((u - 0.78) / 0.16, 2)) +
      3 * rnd(Math.floor(x / 3), 97) -
      (u > 0.98 ? 40 : 0),
  );
  if (VILH[x] < 0) VILH[x] = 0;
}
const VIL_TOP = Math.max(...VILH);
// a dense village down the whole hillside: x, how far down the slope (0 the ridge, 1 the shore), kind: 0 cottage,
// 1 tall house, 2 long house, 3 the chapel, 4 a tower, 5 a windmill, 6 a shed
const HOUSES = [];
for (let i = 0; i < 96; i++) {
  const x = 6 + Math.floor(rnd(i, 101) * 188),
    k = Math.pow(rnd(i, 102), 0.9) * 0.9;
  if (VILH[x] < 7) continue;
  const r = rnd(i, 103);
  HOUSES.push({
    x,
    k,
    kind:
      i === 0
        ? 3
        : i === 5
          ? 5
          : i === 17
            ? 5
            : i === 9
              ? 4
              : i === 31
                ? 4
                : r < 0.45
                  ? 0
                  : r < 0.68
                    ? 1
                    : r < 0.85
                      ? 2
                      : 6,
    tone: Math.floor(rnd(i, 104) * 4),
    chimney: rnd(i, 105) < 0.35,
  });
}
HOUSES[0].x = 66;
HOUSES[0].k = 0.02;
HOUSES.sort((p, q) => p.k - q.k);
const traders = []; // small ships leaving and entering the port, off to either side of the screen
const fw = { shots: [], next: 240 }; // fireworks over the port, now and then after dark
function drawVillage(ctx, t, P, night, grey, snowCover) {
  const haze = 0.32 + 0.3 * grey,
    sky = mix(P.bot, P.sea, 0.5),
    land = mix(snowCover ? [214, 222, 232] : [88, 122, 84], sky, haze),
    dark = mix(snowCover ? [170, 184, 200] : [58, 86, 62], sky, haze),
    shore = mix([120, 108, 90], P.sea, haze + 0.2);
  {
    const cl = rgb(land),
      cd = rgb(dark),
      cs = rgb(shore),
      cn = rgb(mix([150, 140, 120], sky, haze * 0.7)); // the hillside, still: drawn once for its colours
    layer(ctx, "village", cl + cd + cs + cn, 0, HZ - VIL_TOP, 200, VIL_TOP + 4, c => {
      for (let x = 0; x < 200; x++) {
        const h = VILH[x];
        if (!h) continue;
        c.fillStyle = cl;
        c.fillRect(x, HZ - h, 1, h + 3);
        c.fillStyle = cd;
        c.fillRect(x, HZ - h + Math.round(h * 0.55), 1, Math.round(h * 0.45) + 3);
        if (x % 7 === 0) c.fillRect(x, HZ - h, 1, 1);
        c.fillStyle = cs;
        c.fillRect(x, HZ + 2, 1, 1);
      }
      c.fillStyle = cn;
      // a lane winding across the slope
      for (let x = 18; x < 190; x += 2) if (rnd(x, 106) < 0.5) c.fillRect(x, HZ - Math.round(VILH[x] * 0.5) + 1, 2, 1);
    });
  }
  const walls = [
      mix([232, 220, 196], P.bot, haze * 0.6),
      mix([214, 200, 178], P.bot, haze * 0.6),
      mix([196, 182, 160], P.bot, haze * 0.6),
      mix([178, 168, 150], P.bot, haze * 0.6),
    ].map(rgb),
    roof = rgb(mix([120, 62, 48], P.bot, haze * 0.6)),
    roof2 = rgb(mix([96, 78, 70], P.bot, haze * 0.6)),
    roof3 = rgb(mix([70, 90, 110], P.bot, haze * 0.6)),
    lit = night > 0.35;
  HOUSES.forEach((h, i) => {
    const kind = h.kind,
      hh = kind === 1 ? 6 : kind === 3 ? 6 : kind === 4 ? 8 : kind === 5 ? 6 : kind === 6 ? 2 : 3,
      ww = kind === 2 ? 7 : kind === 4 ? 3 : kind === 6 ? 3 : kind === 5 ? 4 : 4,
      gyy = HZ - VILH[h.x] + Math.round(VILH[h.x] * h.k) + 2;
    if (gyy > HZ + 1) return;
    const rf = i % 3 === 1 ? roof2 : i % 5 === 2 ? roof3 : roof;
    ctx.fillStyle = walls[h.tone];
    ctx.fillRect(h.x, gyy - hh, ww, hh);
    if (kind === 4) {
      // a tower with a pointed cap
      ctx.fillStyle = rf;
      ctx.fillRect(h.x, gyy - hh - 1, 3, 1);
      ctx.fillRect(h.x + 1, gyy - hh - 2, 1, 1);
    } else if (kind === 5) {
      // a windmill, sails turning
      ctx.fillStyle = rf;
      ctx.fillRect(h.x, gyy - hh - 1, 4, 1);
      const hx = h.x + 2,
        hy = gyy - hh - 2,
        ang = t * 0.5 + i;
      ctx.fillStyle = "#3E2A1E";
      for (let b = 0; b < 4; b++) {
        const a = ang + (b * Math.PI) / 2;
        for (let l = 1; l <= 4; l++)
          ctx.fillRect(Math.round(hx + Math.cos(a) * l), Math.round(hy + Math.sin(a) * l), 1, 1);
      }
    } else {
      ctx.fillStyle = rf;
      ctx.fillRect(h.x - 1, gyy - hh - 1, ww + 2, 1);
      if (kind === 1) ctx.fillRect(h.x, gyy - hh - 2, ww, 1);
      if (kind === 3) {
        ctx.fillRect(h.x + 1, gyy - hh - 4, 2, 3);
        ctx.fillRect(h.x + 1, gyy - hh - 5, 2, 1);
      }
    }
    if (lit && kind !== 6 && Math.sin(t * 0.05 + i * 2.3) > -0.5) {
      ctx.fillStyle = "#FFE27A";
      ctx.fillRect(h.x + 1, gyy - hh + 1, 1, 1);
      if (ww > 4) ctx.fillRect(h.x + ww - 2, gyy - hh + 1, 1, 1);
      if (kind === 1 || kind === 4) ctx.fillRect(h.x + 1, gyy - hh + 4, 1, 1);
    }
    if (h.chimney && kind < 3) {
      for (let j = 0; j < 3; j++) {
        const ph = (t * 0.25 + j * 0.33 + i * 0.1) % 1;
        ctx.fillStyle = "rgba(220,224,230," + (0.5 * (1 - ph)).toFixed(2) + ")";
        ctx.fillRect(h.x + ww - 1 + Math.round(ph * 6), Math.round(gyy - hh - 2 - ph * 14), 1 + (ph > 0.5 ? 1 : 0), 1);
      }
    }
  });
  // the port at the island's foot: a quay, a pier out over the water, a breakwater, boats moored and bobbing, lamps
  // after dark, folk about
  const wood = rgb(mix([74, 52, 36], P.sea, haze * 0.5)),
    stone = rgb(mix([120, 122, 130], P.sea, haze * 0.5));
  // the quay and the breakwater
  ctx.fillStyle = stone;
  ctx.fillRect(120, HZ + 1, 70, 2);
  ctx.fillRect(196, HZ + 2, 22, 2);
  ctx.fillRect(214, HZ + 1, 6, 1);
  // the pier and its piles
  ctx.fillStyle = wood;
  ctx.fillRect(160, HZ + 3, 34, 1);
  for (let px = 162; px < 194; px += 6) ctx.fillRect(px, HZ + 4, 1, 3);
  // the harbour house
  ctx.fillStyle = walls[1];
  ctx.fillRect(124, HZ - 5, 9, 6);
  ctx.fillStyle = roof2;
  ctx.fillRect(123, HZ - 6, 11, 1);
  ctx.fillStyle = wood;
  ctx.fillRect(127, HZ - 3, 3, 4);
  // warehouses on the quay
  ctx.fillStyle = walls[3];
  ctx.fillRect(136, HZ - 4, 12, 5);
  ctx.fillRect(150, HZ - 3, 8, 4);
  ctx.fillStyle = roof3;
  ctx.fillRect(135, HZ - 5, 14, 1);
  ctx.fillRect(149, HZ - 4, 10, 1);
  ctx.fillStyle = wood;
  ctx.fillRect(139, HZ - 2, 2, 3);
  ctx.fillRect(152, HZ - 1, 2, 2);
  // a crane at the pier's root, a crate on its hook
  ctx.fillStyle = "#2A2834";
  ctx.fillRect(160, HZ - 8, 1, 11);
  ctx.fillRect(160, HZ - 8, 7, 1);
  ctx.fillRect(166, HZ - 7, 1, 2 + Math.round(2 * (0.5 + 0.5 * Math.sin(t * 0.4))));
  ctx.fillStyle = "#6B4A3A";
  ctx.fillRect(165, HZ - 5 + Math.round(2 * (0.5 + 0.5 * Math.sin(t * 0.4))), 3, 2);
  // traders out of the port and into it, to and from either edge of the screen
  if (!traders.length && Math.random() < 1 / 5400) {
    const dir = Math.random() < 0.5 ? -1 : 1,
      arriving = Math.random() < 0.5;
    traders.push({ t0: t, dir, arriving, x0: arriving ? (dir > 0 ? -24 : W + 24) : 186, dock: 0 });
  }
  if (dbg.trader) {
    dbg.trader = false;
    traders.push({ t0: t, dir: -1, arriving: false, x0: 186, dock: 0 });
  }
  for (let i = traders.length - 1; i >= 0; i--) {
    const tr = traders[i],
      sp = 6,
      el = t - tr.t0;
    let x;
    if (tr.arriving) {
      const dist = Math.abs(186 - tr.x0),
        k = Math.min(1, (el * sp) / dist);
      x = tr.x0 + (186 - tr.x0) * k;
      if (k >= 1) {
        if (!tr.dock) tr.dock = t;
        if (t - tr.dock > 60) {
          traders.splice(i, 1);
          continue;
        }
      }
    } else {
      x = tr.x0 + tr.dir * sp * el;
      if (x < -30 || x > W + 30) {
        traders.splice(i, 1);
        continue;
      }
    }
    const facing = tr.arriving ? (tr.x0 < 186 ? 1 : -1) : tr.dir,
      ty = HZ + 4 + Math.round(Math.sin(t * 1.1 + i) * 0.6),
      hx = Math.round(x);
    ctx.fillStyle = rgb(mix([62, 42, 30], P.sea, haze * 0.4));
    ctx.fillRect(hx - 5, ty, 11, 2);
    ctx.fillRect(hx - 4, ty + 2, 9, 1);
    ctx.fillRect(hx + facing * 5, ty - 1, 1, 1);
    ctx.fillStyle = "#2A1C14";
    ctx.fillRect(hx, ty - 7, 1, 7);
    ctx.fillStyle = rgb(mix([239, 230, 210], P.bot, haze * 0.5));
    ctx.fillRect(facing > 0 ? hx + 1 : hx - 4, ty - 6, 4, 4);
    if (lit) {
      ctx.fillStyle = "#FFE27A";
      ctx.fillRect(hx - facing * 4, ty - 1, 1, 1);
    }
    if (!(tr.arriving && tr.dock)) {
      ctx.fillStyle = "rgba(255,255,255,.35)";
      ctx.fillRect(hx - facing * 8, ty + 1, 3, 1);
    }
  }
  // the boats
  [
    [140, 0],
    [166, 1.9],
    [184, 3.7],
  ].forEach(([bx, ph], i) => {
    const by = HZ + 5 + Math.round(1.2 * Math.sin(t * 0.9 + ph));
    ctx.fillStyle = wood;
    ctx.fillRect(bx, by, 7, 2);
    ctx.fillRect(bx + 1, by + 2, 5, 1);
    ctx.fillStyle = "#2A1C14";
    ctx.fillRect(bx + 3, by - 6, 1, 6);
    if (i === 1) {
      ctx.fillStyle = "rgba(239,230,210,.9)";
      ctx.fillRect(bx + 4, by - 5, 2, 3);
    }
  });
  // the lamps
  [
    [150, HZ - 2],
    [190, HZ + 1],
  ].forEach(([lx, ly]) => {
    ctx.fillStyle = "#2A2834";
    ctx.fillRect(lx, ly - 4, 1, 5);
    if (lit) {
      ctx.fillStyle = "rgba(255,226,122,.35)";
      ctx.fillRect(lx - 2, ly - 6, 5, 4);
      ctx.fillStyle = "#FFE27A";
      ctx.fillRect(lx, ly - 5, 1, 1);
    }
  });
  // folk along the quay and the lane
  for (let i = 0; i < 5; i++) {
    const sp = 3 + rnd(i, 107) * 4,
      span = i < 3 ? [122, 192] : [30, 160],
      u = ((t * sp) / (span[1] - span[0]) + rnd(i, 108)) % 2,
      k = u < 1 ? u : 2 - u,
      px = Math.round(lerp(span[0], span[1], k)),
      py = i < 3 ? HZ + 1 : HZ - Math.round(VILH[px] * 0.5) + 1;
    ctx.fillStyle = "#2A2834";
    ctx.fillRect(px, py - 2, 1, 2);
  }
  // fireworks over the port, a few rockets at a time, once in a while after dark
  if (night > 0.5 && t >= fw.next && !fw.shots.length) {
    const n = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++)
      fw.shots.push({
        x: 150 + Math.random() * 40,
        t0: t + i * 1.6 + Math.random(),
        h: 56 + Math.random() * 40,
        col: ["#FF6A5B", "#FFE27A", "#8FD1A6", "#9FD8FF", "#F5B9D0"][Math.floor(Math.random() * 5)],
        seed: Math.random() * 100,
      });
    fw.next = t + 300 + Math.random() * 300;
  }
  if (dbg.fireworks) {
    dbg.fireworks = false;
    fw.shots.push(
      { x: 170, t0: t, h: 80, col: "#FFE27A", seed: 1 },
      { x: 156, t0: t + 1.5, h: 66, col: "#FF6A5B", seed: 2 },
      { x: 186, t0: t + 3, h: 74, col: "#9FD8FF", seed: 3 },
    );
  }
  fw.shots = fw.shots.filter(f => t - f.t0 < 3.2);
  fw.shots.forEach(f => {
    const a = t - f.t0;
    if (a < 0) return;
    if (a < 1.2) {
      const k = a / 1.2,
        ry = HZ - f.h * k;
      ctx.fillStyle = "rgba(255,240,200,.9)";
      ctx.fillRect(Math.round(f.x), Math.round(ry), 1, 2);
      ctx.fillStyle = "rgba(255,240,200,.35)";
      ctx.fillRect(Math.round(f.x), Math.round(ry + 3), 1, 4);
      return;
    }
    const k = (a - 1.2) / 2,
      cy = HZ - f.h;
    ctx.globalAlpha = 1 - k;
    for (let j = 0; j < 16; j++) {
      const ang = (j * Math.PI) / 8 + f.seed,
        r = 4 + k * 22,
        gx = f.x + Math.cos(ang) * r,
        gy = cy + Math.sin(ang) * r * 0.8 + k * k * 14;
      ctx.fillStyle = f.col;
      ctx.fillRect(Math.round(gx), Math.round(gy), k < 0.5 ? 2 : 1, k < 0.5 ? 2 : 1);
      if (k < 0.3) {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(Math.round(f.x + Math.cos(ang) * r * 0.5), Math.round(cy + Math.sin(ang) * r * 0.4), 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  });
}
function drawGlacier(ctx, t, P, sea) {
  // a season long crossing, right to left, six pixels a day
  let prog = dbg.glacier;
  if (prog == null) {
    if (sea !== "winter") return;
    const d = new Date(),
      y = d.getFullYear(),
      start = d.getMonth() < 6 ? new Date(y - 1, 11, 21) : new Date(y, 11, 21);
    prog = clamp((d - start) / (89 * 86400000));
  }
  const gx = Math.round(W + 140 - prog * (W + 420)),
    gw = 260,
    gh = 34;
  const face = rgb(mix([222, 233, 244], mix(P.bot, P.sea, 0.5), 0.3)),
    shadow = rgb(mix([176, 200, 224], mix(P.bot, P.sea, 0.5), 0.3)),
    crack = rgb(mix([140, 170, 205], P.sea, 0.4));
  for (let x = 0; x < gw; x++) {
    const u = x / gw,
      h = Math.round(gh * (0.6 + 0.4 * Math.sin(u * 3.1)) - 4 * rnd(Math.floor(x / 9), 98));
    const px = gx + x;
    if (px < 0 || px >= W) continue;
    ctx.fillStyle = u > 0.72 ? shadow : face;
    ctx.fillRect(px, HZ - h, 1, h + 2);
    if (x % 23 === 5) {
      ctx.fillStyle = crack;
      ctx.fillRect(px, HZ - h + 3, 1, h - 6);
    }
    if (x % 9 === 0) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(px, HZ - h, 2, 1);
    }
  }
  ctx.fillStyle = shadow;
  ctx.fillRect(Math.max(0, gx), HZ + 1, Math.min(W, gx + gw) - Math.max(0, gx), 1);
}
