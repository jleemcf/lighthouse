// The scene in parts (see core.js). This part: one frame of the scene, back to front: the weather, the sky, the sea,
// the far islands and the village, the beam, the ships, the headland, the bottle, the house, the tree, the tower, the
// keepers and the cat, and the rain or snow over everything.

// ---------- the scene ----------
const ROCKS = [
  { x: 236, y: 452, w: 30, h: 12, s: 0 },
  { x: 96, y: 500, w: 40, h: 16, s: 1.9 },
  { x: 392, y: 398, w: 18, h: 7, s: 3.7 },
  { x: 552, y: 342, w: 14, h: 5, s: 5.1 },
]; // rocks standing in the sea
// drawScene keeps a hand layout, a colour and its first shape sharing a line, so this file stays under 1,000 lines;
// Prettier's layout would spread it over about 1,060.
// prettier-ignore
function drawScene(ts) {
  const cv = document.getElementById("scene");
  if (!cv || !facts || !facts.isHome()) {
    sceneOn = false;
    return;
  }
  const ctx = cv.getContext("2d"),
    t = ts / 1000,
    gap = lastTs ? (ts - lastTs) / 1000 : 0,
    dt = Math.min(0.05, gap || 0.016),
    t0 = performance.now();
  lastTs = ts;
  nowT = t;
  const h = dbg.hour != null ? dbg.hour : etHour(),
    P = palette(h);
  // the weather: chosen on the page, or the real sky over Owner's area when the server reads it (WMO codes)
  const wxIn = facts.weather ? facts.weather() : { mode: "clear" },
    live = wxIn.live || null;
  const sea = dbg.season || (wxIn.season && wxIn.season !== "auto" ? wxIn.season : season(new Date()));
  let wxKind =
    wxIn.mode && wxIn.mode !== "live"
      ? wxIn.mode
      : live
        ? live.code >= 95 ? "storm"
          : (live.code >= 71 && live.code <= 77) || live.code === 85 || live.code === 86 ? "snow"
          : live.code >= 51 ? "rain"
          : (live.code >= 2 && live.cloud > 60) || live.code >= 45 ? "cloudy"
          : "clear"
        : "clear";
  if (wxKind === "rain" && sea === "winter" && live && live.temp != null && live.temp <= 1 && wxIn.mode === "live")
    wxKind = "snow"; // cold winter rain falls as snow
  const wind =
    wxIn.mode === "live" && live
      ? clamp(live.wind / 50)
      : { clear: 0.1, cloudy: 0.25, rain: 0.45, snow: 0.2, storm: 0.8 }[wxKind] || 0.1;
  const snowing = wxKind === "snow",
    raining = wxKind === "rain" || wxKind === "storm" || snowing,
    grey = { clear: 0, cloudy: 0.45, rain: 0.62, snow: 0.5, storm: 0.78 }[wxKind] || 0;
  wx.raining = raining;
  if (snowing) wx.lastSnow = t;
  const snowCover = snowing || (sea === "winter" && wx.lastSnow > 0 && t - wx.lastSnow < 1200);
  if (grey) {
    const gc = snowing ? [150, 158, 172] : [112, 118, 130];
    P.top = mix(P.top, gc, grey * 0.9);
    P.bot = mix(P.bot, snowing ? [170, 176, 190] : [118, 124, 136], grey);
    P.sea = mix(P.sea, [62, 76, 92], grey * 0.8);
    P.light *= 1 - grey * 0.5;
  }
  if (sea === "winter" && !grey) {
    P.top = mix(P.top, [150, 170, 200], 0.15);
    P.bot = mix(P.bot, [190, 205, 225], 0.15);
  }
  const night = 1 - P.light;
  let flash = 0;
  if (wxKind === "storm") {
    const cyc = 11,
      ph = (t + 3) % cyc,
      n = Math.floor((t + 3) / cyc);
    if (ph < 0.35) {
      flash = ph < 0.08 ? 1 : ph < 0.2 ? 0.5 : 0.2;
      wx.bolt = { x: 80 + rnd(n, 71) * 500, n };
      wx.jump = Math.max(wx.jump, t - ph + 0.75);
    }
  } // lightning now and then
  const startled = t < wx.jump,
    startle = startled ? Math.abs(Math.sin((Math.PI * (t - (wx.jump - 0.75))) / 0.25)) : 0; // everyone jumps at once
  // dbg.need: true for every board, or one board's id
  const presence = id => dbg.presence || facts.presence(id),
    unopened = id => (dbg.need != null ? (dbg.need === true || dbg.need === id ? 1 : 0) : facts.unopened(id));
  const red = facts.boards.some(
    id => unopened(id) > 0 && (presence(id) === "off" || (keepers[id] && keepers[id].alarmed)),
  ); // red once the alarm is hit (or nobody is there to hit it)
  const navy = navyVisit(t),
    kraken = krakenVisit(t);
  const col = red ? [255, 106, 91] : [255, 214, 100];
  // sky, stars, sun or moon
  layer(ctx, "sky", rgb(P.top) + rgb(P.bot), 0, 0, W, HZ, c => {
    for (let y = 0; y < HZ; y += 4) {
      c.fillStyle = rgb(mix(P.top, P.bot, y / HZ)); c.fillRect(0, y, W, 4);
    }
  });
  if (night > 0.2)
    for (let i = 0; i < 160; i++) {
      const x = Math.floor(rnd(i, 1) * W),
        y = Math.floor(rnd(i, 2) * (HZ - 40)),
        tw = 0.5 + 0.5 * Math.sin(t * (0.8 + rnd(i, 3) * 2) + i);
      ctx.fillStyle = "rgba(235,240,245," + (night * (0.25 + 0.65 * tw)).toFixed(2) + ")";
      ctx.fillRect(x, y, i % 9 === 0 ? 2 : 1, 1);
    }
  const day = (h - 6) / 13.5;
  if (day >= -0.04 && day <= 1.04 && grey < 0.6) {
    const d = clamp(day),
      sx = 40 + d * (W - 80),
      sy = HZ + 20 - Math.sin(d * Math.PI) * 250,
      r = Math.round((22 + 14 * (1 - Math.sin(d * Math.PI))) * 4) / 4; // to a quarter pixel: its disc is built once
    ctx.fillStyle = "rgba(255,225,120," + (0.2 * (1 - grey)).toFixed(2) + ")"; disc(ctx, sx, sy, r + 12);
    ctx.fillStyle = grey
      ? rgb(mix(d < 0.12 || d > 0.88 ? [255, 179, 71] : [255, 226, 122], [200, 200, 205], grey))
      : d < 0.12 || d > 0.88
        ? "#FFB347"
        : "#FFE27A";
    disc(ctx, sx, sy, r);
  } else {
    const nt = ((h + 24 - 19.5) % 24) / 10.5;
    if (nt >= 0 && nt <= 1) {
      const mx = 40 + nt * (W - 80),
        my = HZ - 20 - Math.sin(nt * Math.PI) * 200;
      ctx.fillStyle = "#E9EEF2"; disc(ctx, mx, my, 16);
      ctx.fillStyle = rgb(P.top); disc(ctx, mx + 7, my - 5, 14);
    }
  }
  // big clouds, drifting slowly; more of them, lower and darker, in bad weather
  for (let i = 0; i < (grey ? 11 : 6); i++) {
    const w = 150 + rnd(i, 7) * 170,
      cx = Math.round(((rnd(i, 9) * (W + 400) + t * (0.7 + 0.6 * rnd(i, 10)) * (1 + wind * 3)) % (W + 400)) - 200),
      cy = 28 + Math.round(rnd(i, 8) * (grey ? 150 : 120));
    const white = grey
      ? rgba(
          [Math.round(165 - grey * 70), Math.round(170 - grey * 70), Math.round(184 - grey * 66)],
          (0.75 - 0.3 * night).toFixed(2),
        )
      : night > 0.5
        ? "rgba(120,130,160,.25)"
        : "rgba(255,255,255," + (0.35 + 0.4 * P.light).toFixed(2) + ")";
    const under = grey
      ? rgba(
          [Math.round(112 - grey * 50), Math.round(118 - grey * 50), Math.round(134 - grey * 48)],
          (0.8 - 0.3 * night).toFixed(2),
        )
      : night > 0.5
        ? "rgba(90,100,130,.25)"
        : "rgba(205,212,232," + (0.35 + 0.4 * P.light).toFixed(2) + ")";
    ctx.fillStyle = white; ctx.fillRect(cx, cy, w, 14);
    ctx.fillRect(cx + Math.round(w * 0.12), cy - 10, Math.round(w * 0.72), 10);
    ctx.fillRect(cx + Math.round(w * 0.28), cy - 18, Math.round(w * 0.45), 8);
    ctx.fillRect(cx + Math.round(w * 0.4), cy - 24, Math.round(w * 0.22), 6);
    ctx.fillStyle = under; ctx.fillRect(cx + Math.round(w * 0.06), cy + 14, Math.round(w * 0.88), 6);
  }
  drawSkyCat(ctx, t, night, grey);
  // gulls: four on their own, two flocks in a V
  const gull = (gx, gy0, up, dark) => {
    ctx.fillStyle = dark;
    if (up) {
      ctx.fillRect(gx - 4, gy0 - 2, 3, 1);
      ctx.fillRect(gx - 1, gy0 - 1, 3, 1);
      ctx.fillRect(gx + 2, gy0 - 2, 3, 1);
    } else {
      ctx.fillRect(gx - 4, gy0, 3, 1);
      ctx.fillRect(gx - 1, gy0 - 1, 3, 1);
      ctx.fillRect(gx + 2, gy0, 3, 1);
    }
  };
  const gcol = night > 0.6 ? "#0d1522" : "#2A3140";
  for (let i = 0; i < 4; i++) {
    const gx = Math.round(((t * (22 + i * 7) + i * 260) % (W + 60)) - 30),
      gy0 = Math.round(HZ - 60 - i * 22 + 4 * Math.sin(t * 1.5 + i));
    gull(gx, gy0, Math.sin(t * 7 + i * 2) > 0, gcol);
  }
  for (let f = 0; f < 2; f++) {
    const speed = 20 + 6 * f,
      period = (W + 260) / speed,
      ph = (t + f * period * 0.5) % period,
      dir = f ? -1 : 1,
      fx = dir > 0 ? ph * speed - 130 : W + 130 - ph * speed,
      fy = HZ - 150 + f * 44 + 6 * Math.sin(t * 0.4 + f);
    for (let j = 0; j < 7; j++) {
      const k = Math.ceil(j / 2),
        side = j % 2 ? 1 : -1;
      gull(
        Math.round(fx - dir * k * 9),
        Math.round(fy + (j ? side * k * 3 : 0)),
        Math.sin(t * 7 + j * 0.7 + f) > 0,
        gcol,
      );
    }
  }
  // once in a long while in winter: a sleigh across the sky
  {
    const santa = dbg.santa || (sea === "winter" && (t + 600) % 2400 < 26);
    if (santa) {
      const ph = dbg.santa ? t % 26 : (t + 600) % 2400,
        sx = Math.round(-70 + (ph / 26) * (W + 140)),
        sy = Math.round(72 + 8 * Math.sin(t * 0.8)),
        dark = "#2A2230",
        gait = Math.sin(t * 12) > 0 ? 1 : 0;
      for (let i = 0; i < 4; i++) {
        const rx = sx + 14 + i * 10;
        ctx.fillStyle = dark; ctx.fillRect(rx, sy, 5, 2);
        ctx.fillRect(rx + 5, sy - 2, 2, 3);
        ctx.fillRect(rx + 6, sy - 3, 1, 1);
        ctx.fillRect(rx + gait, sy + 2, 1, 1);
        ctx.fillRect(rx + 3 + (1 - gait), sy + 2, 1, 1);
        if (i === 3) {
          ctx.fillStyle = Math.sin(t * 6) > 0 ? "#FF3B2B" : "#7A2420"; ctx.fillRect(rx + 7, sy - 1, 1, 1);
        }
      }
      ctx.fillStyle = dark; ctx.fillRect(sx + 12, sy + 1, 1, 1);
      ctx.fillStyle = "#C8352B"; ctx.fillRect(sx, sy, 10, 3);
      ctx.fillRect(sx - 1, sy - 1, 2, 1);
      ctx.fillStyle = "#E9C9A8"; ctx.fillRect(sx + 5, sy - 3, 2, 2);
      ctx.fillStyle = "#C8352B"; ctx.fillRect(sx + 4, sy - 4, 4, 1);
      ctx.fillStyle = "#F4F1EA"; ctx.fillRect(sx + 5, sy - 1, 2, 1);
      ctx.fillRect(sx + 8, sy - 5, 1, 1);
    }
  }
  // the sea, and the horizon's broken edge
  // the sea: its bands drawn once for their colour, and the moving glints gathered into three paths, one fill each
  // (the same pixels as a fillRect per glint: no glint overlaps another or a later band)
  {
    const deep = [P.sea[0] * 0.55, P.sea[1] * 0.6, P.sea[2] * 0.75];
    layer(ctx, "sea", rgb(P.sea), 0, HZ, W, H - HZ, c => {
      for (let y = HZ, row = 0; y < H; row++) {
        const sp = 3 + Math.floor(row / 12),
          k = (y - HZ) / (H - HZ);
        c.fillStyle = rgb(mix(P.sea, deep, k)); c.fillRect(0, y, W, sp);
        y += sp;
      }
    });
    const pa = new Path2D(),
      pb = new Path2D(),
      ps = new Path2D(); // the glints, the brighter rows' glints, the sparkles
    for (let y = HZ, row = 0; y < H; row++) {
      const sp = 3 + Math.floor(row / 12),
        per = 34 + row * 2,
        off = Math.floor((t * (8 + row * 1.1) + row * 17) % per);
      let cur = row % 3 === 0 ? pb : pa;
      for (let x = -per + off; x < W; x += per) {
        cur.rect(x + (row % 2) * 9, y, 6 + row, 1);
        if (row % 4 === 1 && Math.sin(t * 1.7 + x * 0.05 + row) > 0.6) {
          ps.rect(x + 2, y - 1, 4, 1);
          cur = pa;
        }
      } // after a sparkle the row goes on at the plain brightness
      y += sp;
    }
    ctx.fillStyle = "rgba(255,255,255," + (0.05 + 0.12 * P.light).toFixed(2) + ")"; ctx.fill(pa);
    ctx.fillStyle = "rgba(255,255,255," + (0.05 + 0.12 * P.light + 0.07).toFixed(2) + ")"; ctx.fill(pb);
    ctx.fillStyle = "rgba(255,255,255," + (0.35 + 0.35 * P.light).toFixed(2) + ")"; ctx.fill(ps);
  }
  {
    const hi = rgb(mix(P.sea, [255, 255, 255], 0.2 + 0.3 * P.light)),
      lo = rgb(mix(P.sea, P.bot, 0.5));
    layer(ctx, "horizon", hi + lo, 0, HZ - 1, W, 2, c => {
      for (let x = 0; x < W; x += 2) {
        const r = rnd(Math.floor(x / 2), 41);
        if (r < 0.3) {
          c.fillStyle = hi; c.fillRect(x, HZ - 1, 2, 1);
        } else if (r > 0.82) {
          c.fillStyle = lo; c.fillRect(x, HZ, 2, 1);
        }
      }
    });
  }
  for (let i = 0; i < 14; i++) {
    const sw = Math.round(((rnd(i, 42) * W + t * (1.5 + rnd(i, 43))) % (W + 40)) - 20),
      len = 6 + Math.round(rnd(i, 44) * 14);
    ctx.fillStyle = "rgba(255,255,255," + (0.12 + 0.18 * P.light).toFixed(2) + ")";
    ctx.fillRect(sw, HZ + 1 + (i % 3), len, 1);
  }
  drawGlacier(ctx, t, P, sea);
  {
    // far islands and a landmass, in the haze
    const haze = rgb(mix(mix(P.bot, P.sea, 0.55), [120, 128, 140], 0.25 + 0.4 * grey)),
      foot = rgb(mix(mix(mix(P.bot, P.sea, 0.55), [120, 128, 140], 0.25 + 0.4 * grey), P.sea, 0.45));
    layer(ctx, "isles", haze + foot, 190, HZ - ISLE_TOP, W - 190, ISLE_TOP + 2, c => {
      for (let x = 190; x < W; x++)
        if (ISLEH[x]) {
          c.fillStyle = haze; c.fillRect(x, HZ - ISLEH[x], 1, ISLEH[x]);
          c.fillStyle = foot; c.fillRect(x, HZ, 1, 2);
        }
    });
  }
  drawVillage(ctx, t, P, night, grey, snowCover);
  if (flash && wx.bolt) {
    const b = wx.bolt;
    ctx.fillStyle = "rgba(255,255,255," + (0.9 * flash).toFixed(2) + ")";
    let bx = b.x,
      by = 40;
    for (let sg = 0; sg < 12; sg++) {
      const nx = bx + (rnd(b.n, 80 + sg) - 0.5) * 30;
      ctx.fillRect(Math.min(bx, nx), by, Math.abs(nx - bx) + 2, 2);
      ctx.fillRect(nx, by, 2, 22);
      bx = nx;
      by += 22;
    }
  }
  if (day >= 0 && day <= 1 && grey < 0.6) {
    const sx = 40 + day * (W - 80);
    for (let y = HZ + 3; y < H; y += 4) {
      const w = 10 + (y - HZ) * 0.5,
        jit = Math.sin(t * 2 + y) * 5;
      ctx.fillStyle = "rgba(255,220,120," + (0.1 * (1 - (y - HZ) / (H - HZ))).toFixed(2) + ")";
      ctx.fillRect(sx - w / 2 + jit, y, w, 1);
    }
  }
  // the beam: one shape of light from the lamp to the spot where it lands, the far half sweeping the sea behind the
  // tower
  const th = (t / (red ? 8 : 12)) * Math.PI * 2,
    sth = Math.sin(th),
    behind = sth < 0,
    BC = { x: tx, y: 420, rx: 700, ry: 112 };
  const beam = (alpha, spot) => {
    const ex = BC.x + BC.rx * Math.cos(th),
      ey = BC.y + BC.ry * sth,
      a = 46,
      b = a * (0.28 + (0.34 * (1 + sth)) / 2); // the spot: flatter far away, rounder near
    const px = (lc.x - ex) / a,
      py = (lc.y - ey) / b,
      d = Math.hypot(px, py);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.beginPath();
    if (d > 1.001) {
      // the lamp and the two tangents round the far side of the spot
      const al = Math.atan2(py, px),
        be = Math.acos(1 / d);
      ctx.moveTo(lc.x, lc.y);
      ctx.ellipse(ex, ey, a, b, 0, al + be, al - be, false);
      ctx.closePath();
    } else ctx.ellipse(ex, ey, a, b, 0, 0, Math.PI * 2);
    ctx.fillStyle = rgba(col, alpha.toFixed(2)); ctx.fill();
    ctx.translate(ex, ey);
    ctx.scale(1, b / a);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, a);
    g.addColorStop(0, rgba(col, spot.toFixed(2)));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, a, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  if (behind) beam(0.1 + 0.22 * night, 0.16 + 0.3 * night);
  // rocks in the sea, with waves crashing into them now and then
  ROCKS.forEach((r, i) => {
    for (let row = 0; row <= r.h; row++) {
      const wr = Math.round((r.w * (0.35 + (0.65 * row) / r.h)) / 2) * 2;
      ctx.fillStyle = row < 3 ? "#6A5470" : row < r.h - 2 ? "#4A3A52" : "#2C2334";
      ctx.fillRect(r.x - wr / 2, r.y - r.h + row, wr, 1);
    }
    const cyc = 6.5 + r.s * 0.3,
      ph = (t + r.s) % cyc,
      crash = ph < 1 ? ph : -1;
    ctx.fillStyle = "rgba(255,255,255," + (0.3 + 0.3 * P.light + (crash >= 0 ? 0.3 : 0)).toFixed(2) + ")";
    for (let j = 0; j < 5; j++) {
      const fx = r.x - r.w / 2 - 6 + (j * (r.w + 12)) / 4 + Math.round(2 * Math.sin(t * 2 + j + i));
      ctx.fillRect(fx, r.y - 1 + (j % 2), 5, 1);
    }
    if (crash >= 0) {
      for (let j = 0; j < 9; j++) {
        const bx = r.x - r.w / 2 - 2 + (j * (r.w + 4)) / 8,
          hgt = Math.sin(crash * Math.PI) * (6 + rnd(j, 40 + i) * 12);
        ctx.fillRect(Math.round(bx), Math.round(r.y - r.h / 2 - hgt), 2, 2);
      }
    } else if (ph > cyc - 1.4) {
      const k = (ph - (cyc - 1.4)) / 1.4;
      ctx.fillRect(Math.round(r.x - r.w / 2 - 34 + 30 * k), r.y - 2, 12, 1);
    }
  });
  // a shark's fin, now and then, in the middle distance
  {
    const cyc = 41,
      ph = t % cyc;
    if (ph < 14) {
      const fx = 120 + (ph / 14) * 420,
        fy = HZ + 96 + 3 * Math.sin(t * 1.3);
      ctx.fillStyle = "#1c2530";
      for (let r = 0; r < 6; r++) ctx.fillRect(fx + r, fy - r, 7 - r, 1);
      ctx.fillStyle = "rgba(255,255,255,.4)"; ctx.fillRect(fx - 6, fy + 1, 6, 1);
    }
  }
  // a fish leaps, now and then
  {
    const cyc = 9,
      n = Math.floor(t / cyc),
      ph = t % cyc;
    if (ph < 1.1) {
      const fx0 = 60 + rnd(n, 21) * 480,
        fy0 = HZ + 40 + rnd(n, 22) * 170,
        k = ph / 1.1,
        fx = fx0 + k * 26,
        fy = fy0 - Math.sin(k * Math.PI) * 22;
      ctx.fillStyle = "#4A6A7A"; ctx.fillRect(fx, fy, 5, 2);
      ctx.fillRect(fx - 2, fy - 1, 2, 4);
      ctx.fillStyle = "#9FC3D0"; ctx.fillRect(fx + 1, fy + 1, 3, 1);
      if (k > 0.85 || k < 0.15) {
        ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.fillRect(fx - 1, fy0 + 1, 2, 1);
        ctx.fillRect(fx + 5, fy0 + 1, 2, 1);
      }
    }
  }
  // The village is a distant backdrop. Every vessel shares one waterline-depth pass, so a nearer
  // ship can cross in front of firstmate and the navy stays visible in front of the distant island.
  const pirate = pirateRoute(t),
    vessels = [
      ...seaTrafficShips(t),
      ...navyShips(t, navy),
      { type: "pirate", x: pirate.x, y: pirate.y, scale: pirate.scale, opacity: 1, route: pirate },
    ];
  drawPirateWake(ctx, t, pirate);
  vessels.sort((a, b) => a.y - b.y || (a.type === "pirate" ? 1 : -1));
  vessels.forEach(vessel => drawVessel(ctx, vessel, t, night, red, startle, navy, kraken));
  // the headland, and the waves breaking around its shore
  ctx.drawImage(land(Math.round(night * 4), sea, snowCover), 0, 0);
  if (snowCover)
    ROCKS.forEach(r => {
      ctx.fillStyle = "#F0F4FA"; ctx.fillRect(r.x - Math.round(r.w * 0.2), r.y - r.h, Math.round(r.w * 0.4), 2);
    });
  for (let x = 430; x < 612; x += 3) {
    const e = EDGE[x],
      ph = Math.sin(t * 1.3 + x * 0.09 + rnd(x, 37) * 3);
    if (ph > -0.1) {
      ctx.fillStyle = "rgba(255,255,255," + (0.3 + 0.4 * P.light * (0.5 + 0.5 * ph)).toFixed(2) + ")";
      ctx.fillRect(x - 2, e - 1 - (ph > 0.7 ? 1 : 0), 4, 2);
    }
  }
  {
    const wash = Math.round(2 + 3 * Math.sin(t * 0.7));
    ctx.fillStyle = "rgba(255,255,255," + (0.35 + 0.3 * P.light).toFixed(2) + ")";
    for (let x = 526; x < 598; x += 2) if (rnd(x, 38) > 0.25) ctx.fillRect(x, EDGE[x] + wash, 2, 1);
  }
  // a letter in a bottle: thrown from the cliff, meandering on the sea for a good while, then waiting in front of Owner
  if (throwing) {
    const k = (t - throwing.t0) / 0.9;
    if (k >= 1) {
      bottle = {
        phase: "float",
        x: LAND.x,
        y: LAND.y,
        ang: Math.PI * 0.8,
        age: 0,
        arrived: false,
        from: throwing.who,
        text: throwing.text,
      };
      throwing = null;
      ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.fillRect(LAND.x - 4, LAND.y - 1, 9, 1);
      ctx.fillRect(LAND.x - 2, LAND.y - 4, 1, 3);
      ctx.fillRect(LAND.x + 3, LAND.y - 4, 1, 3);
    } else {
      const bx = lerp(throwing.from.x, LAND.x, k),
        by = lerp(throwing.from.y, LAND.y, k) - Math.sin(k * Math.PI) * 30;
      drawBottle(ctx, bx, by, lerp(1, 0.75, k), { tilt: k * 4 });
    }
  }
  if (bottle && bottle.phase === "float") {
    // the sea kept moving while Home was away
    if (gap > 1) for (let s = 0; s < Math.min(1200, gap * 2); s++) stepBottle(bottle, 0.5, wind);
    if (!bottle.arrived) stepBottle(bottle, dt, wind);
    // by: its foot under the water, riding the swell, so it floats in the water rather than above it
    const s = bottleScale(bottle),
      bx = bottle.x,
      wy = bottle.y,
      by = wy + 4 * s + Math.round((1.5 * Math.sin(t * 1.5) * s) / 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.round(bx - 30 * s), Math.round(wy - 40 * s), Math.round(60 * s), Math.round(40 * s));
    ctx.clip(); // nothing of it shows below the waterline
    drawBottle(ctx, bx, by, s, { tilt: 0.16 * Math.sin(t * 1.3 + 1) + (bottle.arrived ? 0 : 0.22) });
    ctx.fillStyle = "rgba(255,255,255," + (Math.sin(t * 3) > 0.7 ? 0.9 : 0.35).toFixed(2) + ")";
    ctx.fillRect(Math.round(bx - s), Math.round(by - 7 * s), 1, Math.max(1, Math.round(s)));
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255," + (0.25 + 0.3 * P.light).toFixed(2) + ")";
    ctx.fillRect(Math.round(bx - 4 * s), Math.round(wy), Math.round(8 * s), 1); // the ring where it breaks the surface
  } else if (bottle && bottle.phase === "open") {
    // Owner has clicked it: a shake, the cork pops, the letter slides out and unrolls
    const k = t - bottle.t0,
      s = bottleScale(bottle),
      bx = bottle.x + (k < 0.4 ? Math.round(Math.sin(t * 40) * 2) : 0),
      by = bottle.y + 4 * s;
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.round(bx - 30 * s), Math.round(bottle.y - 40 * s), Math.round(60 * s), Math.round(40 * s));
    ctx.clip();
    drawBottle(ctx, bx, by, s, { noCork: k > 0.4, noPaper: k > 0.8 });
    ctx.restore();
    if (k > 0.4 && k < 1.1) {
      const c = (k - 0.4) / 0.7;
      ctx.fillStyle = "#8B7355";
      ctx.fillRect(
        Math.round(bx - s + c * 30),
        Math.round(by - 12 * s - c * 60 + c * c * 50),
        Math.max(1, Math.round(2 * s)),
        Math.max(1, Math.round(s)),
      );
    }
    if (k > 0.8) {
      const c = clamp((k - 0.8) / 0.8),
        w = Math.round(lerp(2 * s, 56, c)),
        hh = Math.round(lerp(4 * s, 40, c)),
        px = Math.round(bx - w / 2),
        py = Math.round(by - 12 * s - 6 - hh);
      ctx.fillStyle = "#F4EBD3"; ctx.fillRect(px, py, w, hh);
      ctx.fillStyle = "#C9B98F"; ctx.fillRect(px, py + hh - 1, w, 1);
      if (c > 0.5) {
        ctx.fillStyle = "#6E6350";
        for (let l = 0; l < 5; l++)
          ctx.fillRect(px + 5, py + 6 + l * 6, Math.round((w - 10) * (0.5 + 0.5 * rnd(l, 96))), 1);
      }
    }
    if (k > 1.7) {
      if (facts.onLetter) facts.onLetter({ from: bottle.from, text: bottle.text });
      bottle = null;
    }
  }
  // the keeper's house, at the tower's foot
  const hx = 842,
    hy = groundY(hx + 31);
  ctx.fillStyle = "#EDE7DA"; ctx.fillRect(hx, hy - 34, 62, 34);
  ctx.fillStyle = "rgba(0,0,0,.14)"; ctx.fillRect(hx + 50, hy - 34, 12, 34);
  ctx.fillStyle = "#B8332B"; ctx.fillRect(hx - 4, hy - 43, 70, 10);
  ctx.fillRect(hx + 4, hy - 48, 54, 5);
  ctx.fillStyle = "#3A2F44"; ctx.fillRect(hx + 46, hy - 54, 6, 12);
  if (snowCover) {
    ctx.fillStyle = "#F0F4FA"; ctx.fillRect(hx - 4, hy - 45, 70, 3);
    ctx.fillRect(hx + 4, hy - 49, 54, 2);
  }
  ctx.fillStyle = "#6B4A3A"; ctx.fillRect(hx + 40, hy - 22, 10, 22);
  ctx.fillStyle = night > 0.4 ? "#FFE27A" : "#8FB4D8"; ctx.fillRect(hx + 10, hy - 25, 14, 12);
  ctx.fillStyle = "#6B4A3A"; ctx.fillRect(hx + 16, hy - 25, 2, 12);
  ctx.fillRect(hx + 10, hy - 20, 14, 2);
  stepBirdFamily(t, night);
  drawTree(ctx, t, dt, sea, snowCover, wind, night, startle);
  // the benches, facing the sea: legs, seat, and a backrest nearest us that crosses whoever sits there
  CHAIRS.forEach(c => {
    const cy = groundY(c.x);
    ctx.fillStyle = "#3E2A1E"; ctx.fillRect(c.x + 1, cy - 3, 2, 3);
    ctx.fillRect(c.x + 13, cy - 3, 2, 3);
    ctx.fillStyle = "#6B4A3A"; ctx.fillRect(c.x, cy - 4, 16, 2);
    ctx.fillStyle = "#8B6A4A"; ctx.fillRect(c.x, cy - 4, 16, 1);
    if (!c.by) benchBack(ctx, c, cy, snowCover);
  });
  // who is here today; the keepers and the cat take their steps
  const gY = groundY(tx);
  Object.values(keepers).forEach(k => {
    if (k.here && !facts.boards.some(id => id === k.id && presence(id) !== "off")) {
      leave(k);
      k.here = false;
    }
  });
  if (pair && (!keepers[pair.a] || !keepers[pair.a].here || !keepers[pair.b].here)) endPair();
  facts.boards.forEach((id, i) => {
    const k = keeper(id, i);
    k.here = presence(id) !== "off";
    k.y = k.place === "ground" ? groundY(k.x) : k.place === "gallery" ? gy : top + 37;
  });
  facts.boards.forEach(id => {
    const k = keepers[id];
    if (k.here) stepKeeper(k, unopened(id) > 0, t, dt);
  });
  stepButterflies(t, dt, night);
  stepCat(t, dt, night);
  stepSquirrel(t, dt, sea);
  stepFlock(t, dt, startled);
  door.want = Object.values(keepers).some(k => k.here && k.place === "door") ? 1 : 0;
  door.open = clamp(door.open + (Math.sign(door.want - door.open) * dt) / 0.35);
  const climbing = Object.values(keepers).filter(k => k.here && k.place === "stairs"),
    atDoor = Object.values(keepers).filter(k => k.here && k.place === "door");
  // the tower, banded, tapering; see-through while someone is on the stairs; the door; the gallery; the lantern room
  // with its dome
  ctx.fillStyle = "#2F2A38"; ctx.fillRect(tx - 34, base - 12, 68, 18);
  const halfAt = y => 16 + (12 * (y - top)) / (base - top);
  if (climbing.length) {
    // the inside: a dark well, six flights of stairs, whoever is on them
    for (let y = top + 44; y < base - 12; y++) {
      const half = halfAt(y);
      ctx.fillStyle = "#1A1622"; ctx.fillRect(tx - half + 1, y, half * 2 - 2, 1);
    }
    ctx.fillStyle = "#5A546A";
    for (let f = 0; f < 6; f++) {
      const y0 = lerp(gY - 6, top + 40, f / 6),
        y1 = lerp(gY - 6, top + 40, (f + 1) / 6);
      for (let s = 0; s < 9; s++) {
        const k = s / 9,
          y = Math.round(lerp(y0, y1, k)),
          hw = halfAt(y) - 6,
          x = Math.round(tx + (f % 2 === 0 ? 1 : -1) * lerp(-hw, hw, k));
        ctx.fillRect(x - 2, y, 4, 1);
      }
    }
    climbing.forEach(k => {
      const s = stairPos(k.stair.p);
      if (presence(k.id) === "stale") ctx.globalAlpha = 0.55;
      figure(ctx, Math.round(s.x), Math.round(s.y), operatorColor(k.id), {
        walk: Math.sin(t * (k.phase ? 18 : 9)) > 0 ? 1 : 0,
        dir: k.stair.up ? s.dir : -s.dir,
      });
      ctx.globalAlpha = 1;
    });
    ctx.globalAlpha = 0.42;
  }
  layer(ctx, "tower", "tower", tx - 30, top + 44, 60, base - 12 - (top + 44), c => {
    for (let y = top + 44; y < base - 12; y++) {
      const half = halfAt(y),
        band = Math.floor((y - top - 44) / 40);
      c.fillStyle = band % 2 === 0 ? "#F2EFE8" : "#C8352B"; c.fillRect(tx - half, y, half * 2, 1);
      c.fillStyle = "rgba(0,0,0,.2)"; c.fillRect(tx + half - 7, y, 7, 1);
      c.fillStyle = "rgba(255,255,255,.12)"; c.fillRect(tx - half, y, 4, 1);
    }
  }); // the banded body, never changing: drawn once
  ctx.globalAlpha = 1;
  // the door: its frame, the dark inside when open, whoever is stepping through, and the leaf swinging on its hinge
  ctx.fillStyle = "#3A2F44"; ctx.fillRect(tx - 5, gY - 30, 10, 30);
  ctx.fillStyle = door.open > 0 ? "#1A1622" : "#6B4A3A"; ctx.fillRect(tx - 4, gY - 28, 8, 28);
  atDoor.forEach(k => {
    const a = (t - k.t0) / (k.phase ? 0.5 : 0.9),
      inward = k.act === "enter",
      m = clamp((a - 0.33) / 0.57),
      dy = -6 * (inward ? m : 1 - m),
      al = 1 - 0.5 * (inward ? m : 1 - m);
    ctx.save();
    ctx.beginPath();
    ctx.rect(tx - 4, gY - 28, 8, 28);
    ctx.clip();
    ctx.globalAlpha = al * (presence(k.id) === "stale" ? 0.55 : 1);
    figure(ctx, DOOR, Math.round(gY + dy), operatorColor(k.id), {
      walk: a > 0.33 && Math.sin(t * 9) > 0 ? 1 : 0,
      dir: inward ? 1 : -1,
    });
    ctx.restore();
  });
  {
    const leaf = Math.round(8 * (1 - 0.75 * door.open));
    ctx.fillStyle = "#6B4A3A"; ctx.fillRect(tx - 4, gY - 28, leaf, 28);
    ctx.fillStyle = "#3A2F44"; ctx.fillRect(tx - 4 + leaf - 1, gY - 26, 1, 24);
    ctx.fillStyle = "#D2B04E"; ctx.fillRect(tx - 4 + Math.max(1, leaf - 2), gY - 15, 1, 1);
  }
  const windowLit = night > 0.4 || climbing.length > 0;
  ctx.fillStyle = "#3A2F44"; ctx.fillRect(tx - 6, base - 118, 12, 14);
  ctx.fillStyle = windowLit ? "#FFE27A" : "#8FB4D8"; ctx.fillRect(tx - 4, base - 116, 8, 10);
  // the gallery deck
  ctx.fillStyle = "#B8332B"; ctx.fillRect(tx - 34, gy, 68, 6);
  ctx.fillStyle = "#7A2420"; ctx.fillRect(tx - 34, gy + 6, 68, 2);
  if (snowCover) {
    ctx.fillStyle = "#F0F4FA"; ctx.fillRect(tx - 34, gy - 1, 68, 2);
  }
  ctx.fillStyle = "#2F2A38"; ctx.fillRect(tx - 34, gy - 13, 68, 1);
  for (let x = -34; x <= 34; x += 6) ctx.fillRect(tx + x, gy - 13, 1, 13);
  // the lantern room: its frame, the lit glass, the lamp, the alarm, the glazing bars and the dome
  ctx.fillStyle = "#2F2A38"; ctx.fillRect(tx - 18, top + 6, 36, 34);
  const glow = red ? 0.55 + 0.45 * Math.sin(t * 2.0) : 0.85 + 0.15 * Math.sin(t * 1.2);
  ctx.fillStyle = red
    ? "rgba(255,90,70," + glow.toFixed(2) + ")"
    : night > 0.3
      ? "rgba(255,226,122," + glow.toFixed(2) + ")"
      : "rgba(215,228,242,.9)";
  ctx.fillRect(tx - 15, top + 9, 30, 28);
  ctx.fillStyle = "#FFF6D0"; ctx.fillRect(tx - 4, top + 16, 8, 12); // the lamp itself
  const hitting = Object.values(keepers).some(k => k.here && k.phase === "hit");
  ctx.fillStyle = "#2A2834"; ctx.fillRect(tx + 10, top + 17, 5, 6);
  ctx.fillStyle = (red && Math.sin(t * 8) > 0) || (hitting && Math.sin(t * 20) > 0) ? "#FF3B2B" : "#7A2420";
  ctx.fillRect(tx + 11, top + 18, 3, 3); // the alarm
  ctx.fillStyle = "#2F2A38"; ctx.fillRect(tx - 1, top + 9, 2, 28);
  ctx.fillRect(tx - 15, top + 22, 30, 1);
  ctx.fillRect(tx - 9, top + 9, 1, 28);
  ctx.fillRect(tx + 8, top + 9, 1, 28);
  ctx.fillStyle = "#B8332B"; ctx.fillRect(tx - 22, top, 44, 6);
  ctx.fillRect(tx - 14, top - 7, 28, 7);
  ctx.fillRect(tx - 7, top - 12, 14, 5);
  ctx.fillStyle = "#2F2A38"; ctx.fillRect(tx - 1, top - 18, 2, 6);
  ctx.fillRect(tx - 3, top - 19, 6, 1);
  if (snowCover) {
    ctx.fillStyle = "#F0F4FA"; ctx.fillRect(tx - 7, top - 13, 14, 2);
    ctx.fillRect(tx - 14, top - 8, 7, 1);
    ctx.fillRect(tx + 7, top - 8, 7, 1);
  }
  drawFlock(ctx, t, night);
  // the cat, and the keepers living their day
  drawButterflies(ctx, t);
  catSprite(ctx, { ...cat, y: cat.y - cat.leap - Math.round(startle * 4) }, t);
  ctx.font = "8px monospace";
  ctx.textAlign = "center";
  const labels = [],
    placeLabel = (text, x, y) => {
      let yy = y;
      for (let g = 0; g < 4 && labels.some(l => Math.abs(l.x - x) < 40 && Math.abs(l.y - yy) < 8); g++) yy += 9;
      labels.push({ x, y: yy });
      ctx.fillText(text, x, yy);
    };
  facts.boards.forEach((id, i) => {
    const k = keepers[id];
    if (!k || !k.here || k.place === "stairs" || k.place === "door") return;
    const p = presence(id),
      need = unopened(id) > 0;
    k.y = k.place === "ground" ? groundY(k.x) : k.place === "gallery" ? gy : top + 37;
    const eureka = k.act === "write" && t - k.t0 >= 3.5 && t - k.t0 < 4.7;
    const jump =
        k.phase === "jump"
          ? -6 * Math.abs(Math.sin((Math.PI * (t - k.t0)) / 0.4))
          : k.act === "lay"
            ? 0
            : eureka
              ? -2 * Math.abs(Math.sin((Math.PI * (t - k.t0 - 3.5)) / 0.6))
              : -5 * startle,
      fx = Math.round(k.x),
      fy = Math.round(k.y + jump);
    if (p === "stale") ctx.globalAlpha = 0.55;
    const inPair = pair && pair.on && (pair.a === id || pair.b === id),
      ball = inPair && pair.kind === "catch" ? pair.ball : null;
    if (inPair && pair.kind === "argue" && pair.fighting) {
      // a scuffle: a cloud of dust with caps and fists poking out, both lost in it
      if (id !== pair.a) return;
      const cx = Math.round(pair.cx),
        cy = groundY(cx),
        capA = operatorColor(pair.a),
        capB = operatorColor(pair.b);
      for (let j = 0; j < 9; j++) {
        const jx = Math.round(Math.sin(t * 9 + j * 2.1) * 3),
          jy = Math.round(Math.cos(t * 7 + j * 1.3) * 2),
          w = 6 + (j % 3) * 3;
        ctx.fillStyle = j % 2 ? "#D5D9E0" : "#EEF0F4";
        ctx.fillRect(cx - 12 + (j % 3) * 8 + jx, cy - 5 - Math.floor(j / 3) * 4 + jy, w, 4);
      }
      ctx.fillStyle = "#2A3140";
      for (let j = 0; j < 4; j++) {
        const ph = (t * 5 + j * 1.7) % 4,
          ang = (ph * Math.PI) / 2 + j;
        ctx.fillRect(Math.round(cx + Math.cos(ang) * 14), Math.round(cy - 6 + Math.sin(ang) * 6), 2, 2);
      }
      ctx.fillStyle = capA; ctx.fillRect(cx - 8 + Math.round(Math.sin(t * 8) * 2), cy - 15, 3, 1);
      ctx.fillStyle = capB; ctx.fillRect(cx + 5 + Math.round(Math.cos(t * 8) * 2), cy - 14, 3, 1);
      ctx.fillStyle = "#FFE27A";
      for (let j = 0; j < 3; j++) {
        const ph = (t * 3 + j) % 1;
        ctx.fillRect(Math.round(cx - 10 + j * 10 + Math.sin(t * 4 + j) * 4), Math.round(cy - 18 - ph * 6), 1, 1);
      }
      ctx.fillStyle = night > 0.5 ? "#E6EDF2" : "#1B2130";
      placeLabel(facts.label(pair.a).toUpperCase(), cx - 9, cy + 10);
      placeLabel(facts.label(pair.b).toUpperCase(), cx + 9, cy + 10);
      return;
    }
    const shouting = inPair && pair.kind === "argue" && pair.speaker === id;
    let arm = "";
    if (k.phase === "panic") arm = Math.sin(t * 12) > 0 ? "wave1" : "wave2";
    else if (k.phase === "relief") arm = "wipe";
    else if (k.phase === "hit") arm = "out";
    else if (k.act === "write" && t - k.t0 < 3.5) arm = "wipe";
    else if (k.act === "spy") arm = "spy";
    else if (k.place === "gallery" && ["polish", "sweep", "weather", "lean"].includes(k.act)) arm = "out";
    else if (k.place === "gallery" && k.act === "signal") arm = Math.sin(t * 4 + i) > 0 ? "up" : "out";
    else if (k.act === "work" && !k.moving && Math.sin(t * 5 + i) > 0) arm = "out";
    else if (shouting) arm = Math.sin(t * 10) > 0 ? "up" : "out";
    else if (inPair && pair.kind === "talk" && pair.speaker === id && Math.sin(t * 6) > 0) arm = "out";
    else if (ball) {
      const kk = (t - ball.t0) / 0.9;
      if (ball.flying && ball.to === id && kk > 0.55) arm = "up";
      else if (ball.flying && ball.from === id && kk < 0.3) arm = "out";
      else if (!ball.flying && ball.at === id) arm = "out";
    }
    if (k.act === "lay") lying(ctx, fx - 4, fy, operatorColor(id));
    else if (k.act === "sit" && k.chair) {
      figure(ctx, fx, fy - 4, operatorColor(id), { sitBack: true, cup: k.cup, cupUp: Math.sin(t * 1.5 + i) > 0.6 });
      benchBack(ctx, k.chair, groundY(k.chair.x), snowCover);
    } else
      figure(ctx, fx, fy, operatorColor(id), {
        walk: k.moving ? (Math.sin(t * (k.phase ? 18 : 9)) > 0 ? 1 : 0) : 0,
        arm: k.act === "toss" ? "up" : arm,
        dir: k.dir,
        sit: k.act === "write",
        crouch: k.act === "pet",
        cup: k.cup && k.act === "coffee",
        cupUp: Math.sin(t * 1.5 + i) > 0.6,
      });
    if (k.place === "gallery" && !k.phase) {
      // little jobs on the deck, close to the railing
      const beat = t - k.t0,
        side = k.dir < 0 ? -1 : 1;
      if (k.act === "polish") {
        const wipe = Math.round(Math.sin(beat * 6) * 3);
        ctx.fillStyle = "#F4F1EA"; ctx.fillRect(fx + 5 * side + wipe, fy - 14, 4, 3);
        ctx.fillStyle = "#9FD8FF";
        if (Math.sin(beat * 5) > 0.65) {
          ctx.fillRect(fx + 7 * side + wipe, fy - 18, 1, 3);
          ctx.fillRect(fx + 6 * side + wipe, fy - 17, 3, 1);
        }
      } else if (k.act === "sweep") {
        const sw = Math.sin(beat * 9) > 0 ? 1 : -1;
        ctx.fillStyle = "#8B7355"; ctx.fillRect(fx + 6 * side + sw, fy - 9, 1, 9);
        ctx.fillStyle = "#C9B98F"; ctx.fillRect(fx + 4 * side + sw, fy - 1, 6, 2);
        ctx.fillStyle = "#D9D1BA"; ctx.fillRect(fx + 10 * side + sw, fy - 2, 2, 1);
      } else if (k.act === "signal") {
        const up = Math.sin(beat * 3) > 0;
        for (let j = 0; j < 2; j++) {
          const xx = fx + (j ? 7 : -4),
            yy = fy - (up === !!j ? 24 : 18);
          ctx.fillStyle = "#574B3E"; ctx.fillRect(xx, yy, 1, 11);
          ctx.fillStyle = j ? "#F2A93B" : "#6FB1FF"; ctx.fillRect(xx + 1, yy, 5, 4);
          ctx.fillStyle = "#F5F1E6"; ctx.fillRect(xx + 1, yy + 1, 5, 1);
        }
      } else if (k.act === "weather") {
        ctx.fillStyle = "#F4EBD3"; ctx.fillRect(fx + 5 * side, fy - 10, 7, 7);
        ctx.fillStyle = "#4A6A7A"; ctx.fillRect(fx + 6 * side, fy - 8, 4, 1);
        ctx.fillRect(fx + 6 * side, fy - 6, 3, 1);
        ctx.fillStyle = "#D2B04E"; ctx.fillRect(fx + 8 * side, fy - 12, 1, 2);
        ctx.fillStyle = "#9FD8FF"; ctx.fillRect(fx + 13 * side + Math.round(Math.sin(t * 3) * 2), fy - 18, 5, 1);
      } else if (k.act === "lean") {
        ctx.fillStyle = "#2A3140"; ctx.fillRect(fx - 2, fy - 13, 3, 2);
        ctx.fillRect(fx + 4, fy - 13, 3, 2);
        if (Math.sin(beat * 0.5) > 0.5) {
          ctx.fillStyle = "#F5F1E6"; ctx.fillRect(fx + 8, fy - 20, 2, 2);
          ctx.fillRect(fx + 9, fy - 22, 1, 2);
        }
      }
    }
    if (k.act === "write") {
      const e = t - k.t0;
      if (e < 3.5) {
        // thinking: a cloud of dots
        ctx.fillStyle = "#F4F1EA"; ctx.fillRect(fx + 7, fy - 19, 7, 4);
        ctx.fillRect(fx + 8, fy - 20, 5, 1);
        ctx.fillRect(fx + 8, fy - 15, 5, 1);
        ctx.fillRect(fx + 6, fy - 14, 1, 1);
        ctx.fillRect(fx + 5, fy - 13, 1, 1);
        ctx.fillStyle = "#2A3140";
        const dots = Math.floor((e * 2) % 4);
        for (let j = 0; j < Math.min(3, dots); j++) ctx.fillRect(fx + 8 + j * 2, fy - 18, 1, 2);
      } else if (e < 4.7) {
        // the idea: a bulb lighting up
        ctx.fillStyle = "#FFE27A"; ctx.fillRect(fx + 1, fy - 21, 3, 3);
        ctx.fillRect(fx + 2, fy - 22, 1, 1);
        ctx.fillStyle = "#93A3B0"; ctx.fillRect(fx + 1, fy - 18, 3, 1);
        ctx.fillStyle = Math.sin(t * 12) > 0 ? "#FFE27A" : "#FFF6D0"; ctx.fillRect(fx - 2, fy - 22, 1, 1);
        ctx.fillRect(fx + 6, fy - 22, 1, 1);
        ctx.fillRect(fx + 2, fy - 25, 1, 1);
      } else {
        // writing: a note on the knee, a pen at work
        ctx.fillStyle = "#F4EBD3"; ctx.fillRect(fx + 6, fy - 6, 5, 4);
        ctx.fillStyle = "#2A3140"; ctx.fillRect(fx + 7 + Math.round(1.5 + 1.5 * Math.sin(t * 9)), fy - 8, 1, 2);
        ctx.fillStyle = "#6E6350";
        ctx.fillRect(fx + 7, fy - 5, Math.min(3, Math.max(0, Math.floor(3 - (k.until - t) / 3))), 1);
      }
    } else if (k.act === "bottle") {
      // the note goes into the bottle, then the cork
      const c = clamp((t - k.t0) / 2.5);
      drawBottle(ctx, fx + 7, fy - 4, 1, { noPaper: c < 0.6, noCork: c < 0.9 });
      ctx.fillStyle = "#F4EBD3";
      if (c < 0.6) ctx.fillRect(fx + 6, fy - 16 + Math.round(c * 12), 2, 2);
    } else if (k.act === "toToss") drawBottle(ctx, fx + (k.dir > 0 ? 7 : -3), fy - 4, 1);
    if (raining && (k.place === "ground" || k.place === "gallery") && k.act !== "lay" && !k.phase) {
      // an umbrella in the rain
      const uy = fy - (k.act === "sit" ? 18 : 17),
        col = operatorColor(id);
      ctx.fillStyle = col; ctx.fillRect(fx - 2, uy, 9, 1);
      ctx.fillRect(fx - 1, uy - 1, 7, 1);
      ctx.fillRect(fx, uy - 2, 5, 1);
      ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(fx + 2, uy - 2, 1, 3);
      ctx.fillStyle = "#3A2F44"; ctx.fillRect(fx + 2, uy + 1, 1, 4);
    }
    if (k.cup && (k.act === "sit" || k.act === "coffee") && Math.sin(t * 3 + i) > 0) {
      ctx.fillStyle = "rgba(255,255,255,.5)";
      ctx.fillRect(fx + (k.act === "sit" ? 6 : 7), fy - (Math.sin(t * 1.5 + i) > 0.6 ? 15 : 11), 1, 1);
    }
    if (inPair && pair.kind === "talk" && pair.speaker === id) {
      ctx.fillStyle = "#F4F1EA"; ctx.fillRect(fx - 1, fy - 19, 7, 3);
      ctx.fillRect(fx, fy - 20, 5, 1);
      ctx.fillRect(fx, fy - 16, 5, 1);
      ctx.fillRect(fx + 2, fy - 15, 1, 1);
      ctx.fillStyle = "#2A3140";
      const dots = Math.floor((t * 3) % 4);
      for (let j = 0; j < Math.min(3, dots); j++) ctx.fillRect(fx + j * 2, fy - 18, 1, 1);
    }
    if (shouting) {
      // an angry bubble and a cross by the temple
      const jx = Math.round(Math.sin(t * 20));
      ctx.fillStyle = "#F4F1EA"; ctx.fillRect(fx - 1 + jx, fy - 20, 7, 4);
      ctx.fillRect(fx + 2, fy - 16, 1, 1);
      ctx.fillStyle = "#C8352B";
      for (let j = 0; j < 3; j++) {
        ctx.fillRect(fx + j * 2 + jx, fy - 19, 1, 2);
        ctx.fillRect(fx + j * 2 + jx, fy - 17, 1, 1);
      }
      ctx.fillRect(fx + (k.dir > 0 ? 5 : -2), fy - 14, 1, 1);
      ctx.fillRect(fx + (k.dir > 0 ? 6 : -3), fy - 15, 1, 1);
      ctx.fillRect(fx + (k.dir > 0 ? 6 : -3), fy - 13, 1, 1);
    }
    if (k.place === "lantern") {
      ctx.fillStyle = "rgba(255,240,200,.28)"; ctx.fillRect(tx - 15, top + 9, 30, 28);
    }
    ctx.fillStyle = "#9FD8FF";
    k.sweat.forEach(s => ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, 2));
    ctx.fillStyle = "#FF8FA3";
    k.hearts.forEach(s => {
      const x = Math.round(s.x),
        y = Math.round(s.y);
      ctx.globalAlpha = Math.min(1, s.life);
      ctx.fillRect(x, y, 1, 1);
      ctx.fillRect(x + 2, y, 1, 1);
      ctx.fillRect(x, y + 1, 3, 1);
      ctx.fillRect(x + 1, y + 2, 1, 1);
    });
    ctx.globalAlpha = 1;
    if (k.phase === "jump" || k.phase === "panic") {
      ctx.fillStyle = Math.sin(t * 8) > 0 ? "#FF6A5B" : "#FFE27A"; ctx.fillRect(fx + 2, fy - 21, 1, 4);
      ctx.fillRect(fx + 2, fy - 16, 1, 1);
    } else if (need) {
      ctx.fillStyle = Math.sin(t * 3 + i) > 0 ? "#FF6A5B" : "rgba(255,106,91,.35)"; ctx.fillRect(fx + 1, fy - 17, 3, 3);
    }
    ctx.fillStyle = night > 0.5 ? "#E6EDF2" : "#1B2130";
    placeLabel(
      facts.label(id).toUpperCase(),
      k.place === "lantern" ? tx : fx + 2,
      k.place === "lantern" ? top - 24 : k.place === "gallery" ? gy + 18 : fy + 10,
    );
  });
  if (pair && pair.on && pair.kind === "catch") {
    // the ball in the air
    const b = pair.ball,
      from = keepers[b.from],
      to = keepers[b.to];
    if (from && to) {
      const kk = b.flying ? clamp((t - b.t0) / 0.9) : 0,
        x = b.flying ? lerp(from.x, to.x, kk) : keepers[b.at].x,
        y = groundY(x) - 8 - (b.flying ? Math.sin(kk * Math.PI) * 18 : 0);
      ctx.fillStyle = "#F4F1EA"; ctx.fillRect(Math.round(x) + 2, Math.round(y), 2, 2);
      ctx.fillStyle = "#C8352B"; ctx.fillRect(Math.round(x) + 2, Math.round(y), 1, 1);
    }
  }
  ctx.textAlign = "left";
  // the near half of the turn: across the deck, the island, the sea
  if (!behind) beam(0.12 + 0.24 * night, 0.2 + 0.32 * night);
  if (snowing) {
    // snow, drifting down slowly
    ctx.fillStyle = "rgba(250,252,255,.85)";
    for (let i = 0; i < 140; i++) {
      const sp = 16 + rnd(i, 63) * 14,
        x = Math.round(
          ((rnd(i, 60) * (W + 100) + t * sp * (0.4 + wind * 2) + Math.sin(t * 0.9 + i) * 10) % (W + 100)) - 50,
        ),
        y = Math.round((rnd(i, 61) * (H + 20) + t * sp) % (H + 20)) - 10;
      ctx.fillRect(x, y, i % 3 ? 1 : 2, i % 3 ? 1 : 2);
    }
  } else if (raining) {
    // the rain, leaning with the wind; drops striking the sea
    const n = wxKind === "storm" ? 230 : 150,
      a = wxKind === "storm" ? ".55" : ".42",
      len = wxKind === "storm" ? 6 : 4;
    ctx.fillStyle = "rgba(205,220,240," + a + ")";
    for (let i = 0; i < n; i++) {
      const sp = 260 + rnd(i, 62) * 160,
        x = Math.round(((rnd(i, 60) * (W + 200) + t * sp * wind * 0.7) % (W + 200)) - 100),
        y = Math.round((rnd(i, 61) * (H + 40) + t * sp) % (H + 40)) - 20;
      ctx.fillRect(x, y, 1, len);
      if (wind > 0.3) ctx.fillRect(x - 1, y - 2, 1, 2);
    }
    const bucket = Math.floor(t * 7);
    ctx.fillStyle = "rgba(255,255,255,.5)";
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(rnd(i, bucket) * W),
        y = HZ + Math.floor(rnd(i + 50, bucket) * (H - HZ));
      if (EDGE[x] > y) {
        ctx.fillRect(x - 1, y, 3, 1);
        ctx.fillRect(x, y - 1, 1, 1);
      }
    }
  }
  if (flash) {
    ctx.fillStyle = "rgba(240,245,255," + (0.55 * flash).toFixed(2) + ")"; ctx.fillRect(0, 0, W, H);
  }
  if (dbg.magnify) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv, 560, 210, 250, 210, 8, 8, 500, 420);
    ctx.imageSmoothingEnabled = true;
  } // debug({magnify: true}): the tree twice its size, top left, for inspection
  stat.frames++;
  stat.ms += performance.now() - t0;
  nextScene();
}
