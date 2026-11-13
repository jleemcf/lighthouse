// The scene in parts (see core.js). This part: the ships passing by, the rare navy and kraken visits, and the pirate
// ship's course and wake.

// ---------- the sea's traffic ----------
// Traffic beyond firstmate: every visitor enters and leaves beyond a screen edge.
// The slower curved courses grow toward us and recede toward the horizon.
const seaTraffic = [];
let nextTraffic = 12;
function trafficState(tr, t) {
  const k = (t - tr.t0) / tr.dur;
  const x = lerp(tr.from.x, tr.to.x, k) + Math.sin(k * Math.PI) * tr.arc;
  const y = lerp(tr.from.y, tr.to.y, k) + Math.sin(k * Math.PI) * tr.depth;
  return { x, y, k, scale: 0.36 + 1.02 * clamp((y - HZ) / 92), opacity: 1 };
}
// Hull clearances are measured at the waterline; tall sails can pass in front of one another.
function hullsTouch(a, b) {
  return Math.abs(a.x - b.x) < a.beam + b.beam + 9 && Math.abs(a.y - b.y) < a.draft + b.draft + 9;
}
function trafficClear(tr) {
  for (let s = 0; s <= tr.dur; s += 0.5) {
    const at = tr.t0 + s,
      p = trafficState(tr, at);
    if (p.opacity < 0.03 || p.x < -120 || p.x > W + 120) continue;
    // Extra room absorbs the subpixel bob and the time between route samples.
    const candidate = { x: p.x, y: p.y, beam: 40 * p.scale + 10, draft: 7 * p.scale + 6 };
    const pirate = pirateRoute(at);
    if (hullsTouch(candidate, { x: pirate.x, y: pirate.y, beam: 68 * pirate.scale, draft: 11 * pirate.scale }))
      return false;
    if (
      krakenVisit(at) &&
      hullsTouch(candidate, {
        x: pirate.x + 48 * pirate.scale,
        y: pirate.y,
        beam: 150 * pirate.scale,
        draft: 48 * pirate.scale,
      })
    )
      return false;
    for (const other of seaTraffic) {
      if (at <= other.t0 || at >= other.t0 + other.dur) continue;
      const q = trafficState(other, at);
      if (q.opacity > 0.03 && hullsTouch(candidate, { x: q.x, y: q.y, beam: 40 * q.scale, draft: 7 * q.scale }))
        return false;
    }
    for (const vessel of navyShips(at, navyVisit(at))) {
      if (
        vessel.opacity > 0.03 &&
        hullsTouch(candidate, { x: vessel.x, y: vessel.y, beam: 83 * vessel.scale, draft: 12 * vessel.scale })
      )
        return false;
    }
    // The near island is a solid shore, not a route for a visiting ship.
    if (p.x > 430 && p.x < W && p.y + 12 * p.scale >= EDGE[Math.round(p.x)] - 3) return false;
  }
  return true;
}
function launchTraffic(t, forced) {
  for (let attempt = 0; attempt < (forced ? 1 : 28); attempt++) {
    const kind = ["fisher", "trader", "schooner"][Math.floor(Math.random() * 3)];
    const route =
      typeof forced === "string"
        ? forced
        : ["cross", "approach", "approach", "depart", "depart", "arc"][Math.floor(Math.random() * 6)];
    const dir = Math.random() < 0.5 ? -1 : 1,
      edge = 120;
    const from = { x: dir > 0 ? -edge : W + edge, y: HZ + 20 },
      to = { x: dir > 0 ? W + edge : -edge, y: HZ + 20 };
    let arc = 0,
      depth = 0,
      dur;
    if (route === "approach") {
      from.y = HZ + 3 + Math.random() * 7;
      to.y = HZ + 12 + Math.random() * 13;
      depth = 58 + Math.random() * 17;
      arc = dir * (12 + Math.random() * 24);
      dur = 360 + Math.random() * 95;
    } else if (route === "depart") {
      from.y = HZ + 24 + Math.random() * 14;
      to.y = HZ + 3 + Math.random() * 7;
      depth = 24 + Math.random() * 28;
      arc = -dir * (12 + Math.random() * 24);
      dur = 350 + Math.random() * 95;
    } else if (route === "arc") {
      from.y = HZ + 16 + Math.random() * 24;
      to.y = HZ + 12 + Math.random() * 20;
      depth = 18 + Math.random() * 24;
      arc = dir * (18 + Math.random() * 22);
      dur = 230 + Math.random() * 85;
    } else {
      from.y = HZ + 20 + Math.random() * 43;
      to.y = from.y + (Math.random() - 0.5) * 22;
      dur = 95 + Math.random() * 45;
    }
    const tr = { t0: t, dur, kind, route, from, to, arc, depth, dir, seed: Math.random() * 9 };
    if (forced || trafficClear(tr)) {
      seaTraffic.push(tr);
      return true;
    }
  }
  return false;
}
const passingSurface = document.createElement("canvas");
passingSurface.width = 120;
passingSurface.height = 82;
const passingInk = passingSurface.getContext("2d");
function drawPassingShip(ctx, x, y, scale, dir, kind, t, night, opacity) {
  passingInk.clearRect(0, 0, 120, 82);
  passingInk.save();
  passingInk.translate(60, 65);
  const R = (x, y, w, h, c) => {
    passingInk.fillStyle = c;
    passingInk.fillRect(x, y, w, h);
  };
  const hull = kind === "fisher" ? "#594333" : kind === "schooner" ? "#415268" : "#684B37",
    sail = kind === "fisher" ? "#DAC8A2" : "#EFE8D8";
  for (let row = 0; row < 10; row++)
    R(-39 + Math.floor(row * 0.8), row, 78 - Math.floor(row * 1.6), 1, row % 2 ? hull : "#302B2A");
  R(-39, -2, 78, 3, "#332C2A");
  R(-37, 1, 74, 1, "#B59B73");
  R(-31, 5, 62, 1, "#8C6F52");
  for (let p = -28; p <= 28; p += 14) {
    R(p, 3, 5, 3, "#24262C");
    R(p + 1, 2, 3, 1, "#B59B73");
  }
  R(-27, -8, 17, 7, hull);
  R(-24, -10, 12, 2, "#8C6F52");
  R(27, -6, 14, 5, hull);
  R(35, -8, 7, 2, "#B59B73");
  [-17, 15].forEach((mx, i) => {
    R(mx, -43 + i * 5, 2, 43 - i * 5, "#332C2A");
    R(mx - 15, -40 + i * 5, 31, 2, "#453B32");
  });
  if (kind === "schooner") {
    for (let row = 0; row < 32; row++) {
      R(-15 + Math.floor(row * 0.35), -39 + row, 28 - Math.floor(row * 0.85), 1, row % 5 ? sail : "#D1C7B5");
      R(17 + Math.floor(row * 0.4), -34 + row, Math.max(2, 21 - Math.floor(row * 0.55)), 1, "#DDD6C7");
    }
    R(-19, -46, 11, 5, "#6A8AA6");
  } else {
    [-17, 15].forEach((mx, i) => {
      const top = -39 + i * 5;
      for (let row = 0; row < 16; row++) {
        const trim = Math.floor(row / 6);
        R(mx - 13 + trim, top + row, 28 - trim * 2, 1, row % 6 === 5 ? "#C4BAA6" : sail);
      }
      R(mx - 11, top + 18, 24, 10, "#D9CDB4");
      R(mx - 10, top + 23, 22, 1, "#AAA18F");
    });
    if (kind === "fisher") {
      R(27, -26, 11, 21, "#C4A879");
      R(28, -27, 12, 2, "#8A684B");
      R(-26, -14, 8, 7, "#6D5743");
    }
    R(-20, -49, 12, 6, kind === "fisher" ? "#BD7847" : "#365E89");
  }
  for (let p = -29; p <= 30; p += 10) {
    R(p, -4, 1, 4, "#282A2D");
    R(p, -5, 2, 2, "#E6D5B5");
    R(p - 1, -7, 4, 2, kind === "schooner" ? "#6A8AA6" : "#8A5840");
  }
  if (night > 0.4) {
    R(-31, -3, 3, 3, "#F6D886");
    R(34, -3, 3, 3, "#F6D886");
  }
  passingInk.restore();
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x), Math.round(y + Math.sin(t * 0.75 + x * 0.01)));
  ctx.scale(dir, 1);
  const w = Math.round(120 * scale),
    h = Math.round(82 * scale);
  ctx.drawImage(passingSurface, Math.round(-w / 2), Math.round(-65 * scale), w, h);
  ctx.restore();
}
function seaTrafficShips(t) {
  if (dbg.traffic) {
    launchTraffic(t, dbg.traffic === true ? null : dbg.traffic);
    dbg.traffic = false;
  }
  if (t >= nextTraffic && seaTraffic.length < 2) nextTraffic = t + (launchTraffic(t) ? 65 + Math.random() * 80 : 12);
  const ships = [];
  for (let i = seaTraffic.length - 1; i >= 0; i--) {
    const tr = seaTraffic[i],
      p = trafficState(tr, dbg.trafficPhase != null ? tr.t0 + dbg.trafficPhase * tr.dur : t);
    if (p.k >= 1) {
      seaTraffic.splice(i, 1);
      continue;
    }
    ships.push({ ...p, type: "traffic", tr });
  }
  return ships;
}
const ENCOUNTER_SLOT = 1200,
  NAVY_DURATION = 300,
  KRAKEN_DURATION = 72;
function seaEncounter(t) {
  // one rare spectacle per twenty-minute window, with long quiet stretches between them
  if (dbg.krakenPhase != null)
    return dbg.krakenPhase >= 0 && dbg.krakenPhase < KRAKEN_DURATION
      ? { kind: "kraken", phase: dbg.krakenPhase, dir: 1 }
      : null;
  if (dbg.navyPhase != null)
    return dbg.navyPhase >= 0 && dbg.navyPhase < NAVY_DURATION ? { kind: "navy", phase: dbg.navyPhase, dir: 1 } : null;
  if (dbg.kraken) return { kind: "kraken", phase: t % KRAKEN_DURATION, dir: 1 };
  if (dbg.navy) return { kind: "navy", phase: t % NAVY_DURATION, dir: 1 };
  const slot = Math.floor(t / ENCOUNTER_SLOT),
    roll = rnd(slot, 199);
  const kind = roll < 0.25 ? "navy" : roll < 0.41 ? "kraken" : null;
  if (!kind) return null;
  let start;
  if (kind === "navy") start = slot * ENCOUNTER_SLOT + 120 + Math.floor(rnd(slot, 882) * 120);
  else {
    // westbound in open water, so the entire struggle stays clear of the headland
    const wave = Math.PI - Math.asin(0.16),
      earliest = slot * ENCOUNTER_SLOT + 90;
    start = (wave + Math.ceil((earliest * 0.016 - wave) / (Math.PI * 2)) * Math.PI * 2) / 0.016;
  }
  const phase = t - start,
    duration = kind === "navy" ? NAVY_DURATION : KRAKEN_DURATION;
  return phase >= 0 && phase < duration ? { kind, phase, dir: slot % 2 ? -1 : 1 } : null;
}
function navyVisit(t) {
  const event = seaEncounter(t);
  if (!event || event.kind !== "navy") return null;
  const { phase, dir } = event,
    progress = phase / NAVY_DURATION;
  const compliance = clamp((phase - 9) / 6) * clamp((NAVY_DURATION - phase - 5) / 6);
  const hide = clamp((phase - 8) / 18) * clamp((NAVY_DURATION - phase - 6) / 20);
  return {
    phase,
    progress,
    dir,
    compliance,
    hide,
    cower: phase >= 9 && phase <= NAVY_DURATION - 5,
    changing: (phase >= 9 && phase < 16) || (phase > NAVY_DURATION - 12 && phase <= NAVY_DURATION - 5),
  };
}
function krakenVisit(t) {
  const event = seaEncounter(t);
  if (!event || event.kind !== "kraken") return null;
  const phase = event.phase;
  return {
    phase,
    surface: clamp((phase - 4) / 11) * clamp((KRAKEN_DURATION - phase) / 12),
    reach: clamp((phase - 7) / 12) * clamp((66 - phase) / 14),
    fight: clamp((phase - 12) / 7) * clamp((60 - phase) / 10),
    drivenOff: clamp((phase - 43) / 7) * clamp((62 - phase) / 12),
  };
}
const krakenBack = document.createElement("canvas"),
  krakenFront = document.createElement("canvas");
krakenBack.width = krakenFront.width = 340;
krakenBack.height = krakenFront.height = 250;
function drawKrakenLayer(ctx, route, visit, t, front) {
  const surface = front ? krakenFront : krakenBack,
    ink = surface.getContext("2d");
  ink.clearRect(0, 0, 340, 250);
  ink.save();
  ink.translate(160, 170);
  const R = (x, y, w, h, color) => {
    ink.fillStyle = color;
    ink.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  };
  const INK = "#683044",
    DEEP = "#B6534E",
    CORAL = "#DF7358",
    LIGHT = "#F4A06C",
    PEARL = "#F7D7AE";
  const curvePoint = (segment, k) => {
    const [a, b, c, d] = segment,
      v = 1 - k;
    return {
      x: v * v * v * a[0] + 3 * v * v * k * b[0] + 3 * v * k * k * c[0] + k * k * k * d[0],
      y: v * v * v * a[1] + 3 * v * v * k * b[1] + 3 * v * k * k * c[1] + k * k * k * d[1],
    };
  };
  const tentacle = (segments, reach, width, seed, club) => {
    // two long feeding tentacles end in broad sucker-covered clubs
    if (reach < 0.02) return;
    const count = segments.length * 28,
      wobble = Math.sin(t * (1.6 + seed * 0.07) + seed) * (2 + visit.fight * 3);
    const at = u => {
      const part = Math.min(segments.length - 1, Math.floor(u * segments.length)),
        k = u * segments.length - part,
        p = curvePoint(segments[part], k);
      return { x: p.x + wobble * u * u, y: p.y + Math.sin(t * 1.9 + seed) * 2 * u };
    };
    for (let i = 0; i <= Math.ceil(count * reach); i++) {
      const u = Math.min(reach, i / count),
        p = at(u),
        tip = clamp((reach - u) / 0.07);
      const clubWidth = club && u > 0.79 ? 1 + 0.85 * Math.sin(clamp((u - 0.79) / 0.21) * Math.PI) : 1;
      const w = Math.max(1, Math.round(width * (1 - 0.72 * u) * clubWidth * tip));
      R(p.x - w / 2 - 2, p.y - w / 2 - 2, w + 4, w + 4, INK);
      R(p.x - w / 2, p.y - w / 2, w, w, front ? CORAL : DEEP);
      if (w > 4) R(p.x - w / 2 + 2, p.y - w / 2 + 1, Math.max(2, Math.round(w * 0.32)), 2, front ? LIGHT : CORAL);
      if (i % 4 === 0 && u > 0.12 && w > 3) {
        R(p.x - 2, p.y + w / 2 - 1, 4, 3, INK);
        R(p.x - 1, p.y + w / 2 - 1, 2, 2, PEARL);
      }
    }
  };
  if (!front) {
    const swell = clamp((visit.phase + 2) / 6) * clamp((KRAKEN_DURATION - visit.phase) / 8);
    for (let row = 0; row < 17; row += 2) {
      const half = Math.round(10 + Math.sqrt(1 - ((row - 8) / 9) ** 2) * 86);
      R(42 - half, 19 + row, half * 2, 2, `rgba(17,39,58,${(0.34 * swell).toFixed(2)})`);
    }
    for (let i = 0; i < 26; i++) {
      const x = -90 + i * 9,
        y = 17 + Math.round(Math.sin(t * 3 + i * 1.9) * 3);
      if (i % 3 === 0) R(x - 4, y + 3, 14, 2, `rgba(15,32,54,${(0.52 * swell).toFixed(2)})`);
      if (i % 2 === 0) R(x, y, 3 + (i % 4), 2, `rgba(225,244,248,${(0.62 * swell).toFixed(2)})`);
    }
    for (let i = 0; i < 10; i++) {
      const bx = -28 + i * 11,
        by = 13 - ((t * 8 + i * 7) % 18);
      if (visit.phase < 18 && by > -10)
        R(bx, by, i % 3 ? 2 : 3, i % 3 ? 2 : 3, `rgba(221,241,244,${(0.45 * swell).toFixed(2)})`);
    }
    tentacle(
      [
        [
          [52, 20],
          [8, 20],
          [-92, 20],
          [-94, -22],
        ],
        [
          [-94, -22],
          [-101, -60],
          [-33, -99],
          [-23, -66],
        ],
      ],
      visit.reach,
      17,
      1,
    );
    tentacle(
      [
        [
          [68, 20],
          [30, -14],
          [-29, -37],
          [-9, -84],
        ],
        [
          [-9, -84],
          [4, -115],
          [37, -100],
          [21, -76],
        ],
      ],
      visit.reach * 0.95,
      14,
      2,
    );
    tentacle(
      [
        [
          [85, 20],
          [134, 16],
          [165, -25],
          [137, -60],
        ],
        [
          [137, -60],
          [113, -92],
          [90, -61],
          [119, -55],
        ],
      ],
      visit.reach * 0.89,
      16,
      3,
    );
    tentacle(
      [
        [
          [60, 20],
          [12, -36],
          [-35, -95],
          [-27, -124],
        ],
        [
          [-27, -124],
          [-22, -153],
          [17, -147],
          [8, -127],
        ],
      ],
      visit.reach * 0.8,
      9,
      4,
      true,
    );
    if (visit.surface > 0.01) {
      // a broad, finned mantle pushes straight up out of the swell beneath the bow
      const rise = Math.round((1 - visit.surface) * 127),
        tilt = Math.round(Math.sin(t * 1.3) * 2 + visit.drivenOff * Math.sin(t * 10) * 4);
      for (let row = 0; row <= 122; row += 2) {
        const y = 17 - row + rise;
        if (y > 17 || y < -158) continue;
        const half = row < 29 ? 30 + row * 0.23 : row < 75 ? 37 - (row - 29) * 0.08 : 33 - (row - 75) * 0.66;
        if (half < 1) continue;
        const hw = Math.round(half),
          cx = 48 + Math.round(24 * visit.surface) + tilt;
        R(cx - hw - 2, y, hw * 2 + 4, 2, INK);
        R(cx - hw, y, hw * 2, 2, row % 12 < 2 ? "#BB5752" : CORAL);
        R(cx - hw + 5, y, Math.max(2, Math.round(hw * 0.46)), 2, row % 10 < 2 ? PEARL : LIGHT);
        R(cx + hw - 10, y, 6, 2, DEEP);
      }
      for (let row = 0; row < 33; row += 2) {
        const y = -103 + row + rise;
        if (y > 17) continue;
        const wing = Math.round(5 + Math.sin((row / 33) * Math.PI) * 25),
          cx = 48 + Math.round(24 * visit.surface) + tilt;
        R(cx - 23 - wing, y, wing + 7, 2, INK);
        R(cx - 21 - wing, y, wing + 4, 2, DEEP);
        R(cx + 16, y, wing + 9, 2, INK);
        R(cx + 18, y, wing + 6, 2, LIGHT);
      }
      for (let i = 0; i < 18; i++) {
        const px = 25 + Math.round(24 * visit.surface) + Math.floor(rnd(i, 170) * 50) + tilt,
          py = -76 + Math.floor(rnd(i, 171) * 42) + rise;
        if (py < 14) R(px, py, i % 4 ? 2 : 3, i % 3 ? 1 : 2, i % 2 ? "#F5B17F" : DEEP);
      }
    }
  } else {
    const near = visit.reach * clamp((visit.phase - 11) / 8);
    tentacle(
      [
        [
          [54, 20],
          [25, 49],
          [-85, 39],
          [-92, 8],
        ],
        [
          [-92, 8],
          [-102, -20],
          [-51, -37],
          [-39, -12],
        ],
      ],
      near,
      19,
      5,
    );
    tentacle(
      [
        [
          [69, 18],
          [30, 26],
          [-60, 9],
          [-57, -21],
        ],
        [
          [-57, -21],
          [-59, -48],
          [-13, -52],
          [-12, -31],
        ],
      ],
      near * 0.94,
      14,
      6,
    );
    tentacle(
      [
        [
          [79, 19],
          [121, 49],
          [70, 58],
          [16, 35],
        ],
        [
          [16, 35],
          [-3, 24],
          [1, -14],
          [32, -21],
        ],
      ],
      near * 0.87,
      13,
      7,
    );
    tentacle(
      [
        [
          [72, 18],
          [70, -23],
          [31, -69],
          [11, -61],
        ],
        [
          [11, -61],
          [-10, -55],
          [-17, -96],
          [9, -89],
        ],
      ],
      near * 0.8,
      10,
      8,
      true,
    );
    if (visit.surface > 0.78) {
      // two big, slightly crossed eyes peer at the pirates over the gunwale
      const rise = Math.round((1 - visit.surface) * 127),
        glance = Math.round(Math.sin(t * 1.1) * 2),
        blink = visit.drivenOff > 0.4 && Math.sin(t * 15) > 0.55;
      [
        [56, -21, -1],
        [88, -19, 1],
      ].forEach(([ex, ey, side], i) => {
        const y = ey + rise;
        if (y > 16) return;
        ink.fillStyle = INK;
        disc(ink, ex, y, 15);
        ink.fillStyle = "#FFF1D4";
        disc(ink, ex, y, blink ? 3 : 12);
        if (!blink) {
          ink.fillStyle = "#DDA653";
          disc(ink, ex + glance + side * 2, y + 2, 8);
          ink.fillStyle = "#30243B";
          disc(ink, ex + glance + side * 2, y + 2, 5);
          R(ex + glance + side, y - 3, 3, 3, "#FFFFFF");
          R(ex + glance + side * 2 + 4, y + 5, 2, 2, "#FFF8DE");
        }
        R(ex - 10, y - 15, 20, 2, LIGHT);
        if (i === 0) {
          R(34, y + 12, 6, 3, LIGHT);
          R(39, y + 13, 3, 2, PEARL);
        }
      });
      const mouthY = Math.round(5 + rise);
      if (mouthY < 16) {
        R(70, mouthY - 2, 11, 8, INK);
        R(72, mouthY, 7, 5, "#74334A");
        R(74, mouthY + 4, 3, 1, "#F2B6A0");
      }
    }
    if (visit.fight > 0.05)
      for (let i = 0; i < 24; i++) {
        const x = -92 + i * 10,
          y = 16 + Math.round(Math.sin(t * 7 + i * 1.8) * 5);
        if (i % 2 === 0) R(x, y, 3 + (i % 4), 2, `rgba(234,246,249,${(0.7 * visit.fight).toFixed(2)})`);
        if (i % 5 === 0) R(x + 2, y - 8, 2, 5, `rgba(234,246,249,${(0.55 * visit.fight).toFixed(2)})`);
      }
    if (visit.drivenOff > 0) {
      // gun flashes and spray send the arms back beneath the surface
      const flash = Math.sin(t * 17) > 0.15,
        strength = visit.drivenOff;
      for (let i = 0; i < 10; i++) {
        const x = 35 + i * 12,
          y = 10 + Math.round(Math.sin(t * 8 + i) * 7);
        R(x, y, 3 + (i % 2) * 2, 2, `rgba(235,245,248,${(0.8 * strength).toFixed(2)})`);
        if (i % 2 === 0) R(x + 2, y - 5, 2, 4, `rgba(235,245,248,${(0.55 * strength).toFixed(2)})`);
      }
      if (flash) {
        R(44, -23, 12, 4, "#FFEAB0");
        R(55, -26, 5, 9, "#FFF8DF");
        R(60, -21, 7, 2, "#FFE27A");
      }
    }
  }
  ink.restore();
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const w = Math.round(340 * route.scale),
    h = Math.round(250 * route.scale);
  ctx.drawImage(surface, Math.round(route.x - 160 * route.scale), Math.round(route.y - 170 * route.scale), w, h);
  ctx.restore();
}
const navySurface = document.createElement("canvas");
navySurface.width = 200;
navySurface.height = 124;
const navyInk = navySurface.getContext("2d");
function drawNavyVessel(ctx, x, y, scale, dir, flagship, night, opacity) {
  navyInk.clearRect(0, 0, 200, 124);
  navyInk.save();
  navyInk.translate(100, 104);
  const R = (x, y, w, h, c) => {
    navyInk.fillStyle = c;
    navyInk.fillRect(x, y, w, h);
  };
  for (let row = 0; row < 16; row++) {
    const inset = row < 8 ? Math.floor(row * 0.35) : Math.floor((row - 8) * 2.1 + 3);
    R(-78 + inset, row, 156 - inset * 2, 1, row % 3 ? "#243B52" : "#172A3E");
  }
  R(-79, -5, 157, 6, "#27445B");
  R(-76, -3, 151, 2, "#D2B04E");
  R(-71, 5, 142, 1, "#8AA4B5");
  R(-60, 11, 120, 2, "#102232");
  for (let p = -59; p <= 57; p += 13) {
    R(p, 3, 7, 5, "#101B29");
    R(p + 1, 2, 5, 1, "#D2B04E");
    R(p + 2, 8, 3, 1, "#7995A9");
  }
  R(-72, -23, 31, 18, "#36546C");
  R(-69, -29, 24, 6, "#223950");
  R(-70, -27, 26, 2, "#D2B04E");
  for (let p = -66; p < -47; p += 7) R(p, -18, 4, 5, night > 0.35 ? "#F6D886" : "#AFC9D2");
  R(67, -12, 20, 10, "#223950");
  R(82, -10, 12, 2, "#D2B04E");
  R(80, -2, 10, 1, "#D2B04E");
  [-42, 2, 47].forEach((mx, i) => {
    const top = -79 + (i === 1 ? -12 : i * 5);
    R(mx, top, 3, -top, "#283546");
    R(mx - 20, top + 7, 41, 2, "#283546");
    R(mx - 18, top + 9, 37, 18, "#F2F0E8");
    R(mx - 17, top + 16, 35, 1, "#B9CBD1");
    R(mx - 16, top + 27, 33, 14, "#E0E7E7");
    R(mx - 15, top + 33, 31, 1, "#AFC3CE");
    R(mx - 12, top + 43, 25, 10, "#F1F0E6");
    R(mx - 18, top + 9, 2, 18, "#AFC3CE");
    for (let seam = -11; seam <= 11; seam += 11) {
      R(mx + seam, top + 10, 1, 16, "#D2D6CE");
      R(mx + seam, top + 28, 1, 12, "#C3D0D1");
    }
    R(mx - 4, top + 3, 8, 3, "#D2B04E");
  });
  R(2, -99, 3, 13, "#283546");
  R(5, -99, flagship ? 29 : 23, 13, "#365E89");
  R(5, -99, flagship ? 29 : 23, 3, "#F5F1E7");
  R(13, -93, 10, 3, "#D2B04E");
  if (flagship) {
    R(-74, -33, 28, 5, "#E7D5A1");
    R(-68, -38, 16, 5, "#365E89");
    R(-61, -42, 3, 4, "#D2B04E");
    R(-51, -14, 4, 4, "#D2B04E");
  }
  for (let p = -60; p <= 65; p += 10) {
    R(p, -10, 4, 5, "#365E89");
    R(p + 1, -13, 3, 3, "#E9C7A8");
    R(p, -15, 5, 2, "#BF4D40");
    R(p + 4, -15, 1, 10, "#2B3541");
  }
  R(-77, -5, 154, 2, "#D2B04E");
  if (night > 0.35) {
    R(-63, -19, 4, 4, "#F6D886");
    R(76, -9, 3, 3, "#F6D886");
  }
  navyInk.restore();
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(dir, 1);
  const w = Math.round(200 * scale),
    h = Math.round(124 * scale);
  ctx.drawImage(navySurface, Math.round(-w / 2), Math.round(-104 * scale), w, h);
  ctx.restore();
}
function navyShips(t, visit) {
  if (!visit) return [];
  const lead = lerp(-200, W + 3 * 190 + 200, visit.progress),
    dir = visit.dir,
    ships = [];
  for (let i = 3; i >= 0; i--) {
    const x = dir > 0 ? lead - i * 190 : W - lead + i * 190,
      y = HZ + 29 + (i % 2) * 8 + 2 * Math.sin(t * 0.55 + i),
      scale = i === 0 ? 1.16 : 0.88 + (i % 2) * 0.08;
    const opacity = clamp((x + 120) / 140) * clamp((W + 120 - x) / 140);
    if (opacity > 0) ships.push({ type: "navy", x, y, scale, dir, flagship: i === 0, opacity });
  }
  return ships;
}
function drawVessel(ctx, vessel, t, night, red, startle, navy, kraken) {
  const { x, y, scale, opacity } = vessel;
  if (vessel.type === "navy") {
    ctx.fillStyle = "rgba(235,246,250," + (0.28 * opacity).toFixed(2) + ")";
    ctx.fillRect(Math.round(x - vessel.dir * 95 * scale), Math.round(y + 12 * scale), Math.round(48 * scale), 1);
    drawNavyVessel(ctx, x, y, scale, vessel.dir, vessel.flagship, night, opacity);
  } else if (vessel.type === "traffic") {
    const tr = vessel.tr,
      vx = tr.to.x - tr.from.x,
      vy = tr.to.y - tr.from.y,
      length = Math.hypot(vx, vy) || 1;
    ctx.fillStyle = "rgba(235,246,250," + (0.23 * opacity).toFixed(2) + ")";
    ctx.fillRect(
      Math.round(x - (vx / length) * 45 * scale),
      Math.round(y - (vy / length) * 20 * scale + 8 * scale),
      Math.max(2, Math.round(13 * scale)),
      1,
    );
    drawPassingShip(ctx, x, y, scale, tr.dir, tr.kind, t + tr.seed, night, opacity);
  } else {
    const r = vessel.route;
    if (kraken) drawKrakenLayer(ctx, r, kraken, t, false);
    const attack = !!kraken && kraken.fight > 0.1;
    const rocking = kraken
      ? 1.5 * Math.sin(t * 5) * kraken.surface + (attack ? 3.5 * Math.sin(t * 8) * kraken.fight : 0)
      : 0;
    ship(
      ctx,
      Math.round(x),
      Math.round(y + ((red ? 3.5 * Math.sin(t * 1.6) : 2 * Math.sin(t * 0.7)) + rocking) * scale),
      scale,
      r.heading,
      night,
      t,
      (red || attack) && !(navy && navy.cower),
      Math.max(startle, attack ? kraken.fight * 0.5 : 0),
      r.speed,
      r.bow,
      navy,
    );
    if (kraken) drawKrakenLayer(ctx, r, kraken, t, true);
  }
}

function piratePosition(t) {
  const w = dbg.shipW != null ? dbg.shipW : t * 0.016 + (dbg.shipOffset || 0);
  const navy = navyVisit(t),
    hide = navy ? navy.hide : 0;
  // Keep making way along the broad loop. The navy sends firstmate into a
  // deeper, separate water lane rather than trapping her in a tiny holding circle.
  const x = 320 + 240 * Math.sin(w);
  const y = lerp(HZ + 58 - 42 * Math.cos(w), HZ + 110 - 12 * Math.cos(w), hide);
  return { x, y };
}
function pirateRoute(t) {
  // a wide loop with a clear near-water lane during navy visits
  const { x, y } = piratePosition(t),
    a = piratePosition(t - 0.1),
    b = piratePosition(t + 0.1);
  // A frozen debug phase still needs the heading of that phase for turn inspection.
  const dx = dbg.shipW != null ? 240 * Math.cos(dbg.shipW) : (b.x - a.x) / 0.2 / 0.016;
  const dy = dbg.shipW != null ? 42 * Math.sin(dbg.shipW) : (b.y - a.y) / 0.2 / 0.016;
  const heading = dx / (Math.hypot(dx, 1.5 * dy) || 1);
  return {
    x,
    y,
    scale: lerp(0.58, 1.18, clamp((y - HZ - 16) / 84)),
    heading,
    dx,
    dy,
    bow: dy > 0,
    speed: Math.hypot(dx, dy * 2) / 240,
  };
}
const pirateWake = [];
let lastWakeAt = -1;
function drawPirateWake(ctx, t, r) {
  const vx = r.dx * 0.016,
    vy = r.dy * 0.016,
    speed = Math.hypot(vx, vy),
    ux = vx / (speed || 1),
    uy = vy / (speed || 1);
  if (dbg.shipW == null && t - lastWakeAt >= 0.16 && speed > 0.3) {
    const stern = (18 + 52 * Math.abs(r.heading)) * r.scale;
    pirateWake.push({
      x: r.x - ux * stern,
      y: r.y - uy * stern + 13 * r.scale,
      ux,
      uy,
      scale: r.scale,
      speed,
      born: t,
    });
    lastWakeAt = t;
  }
  while (pirateWake.length && t - pirateWake[0].born > 13) pirateWake.shift();
  pirateWake.forEach((p, i) => {
    const age = t - p.born,
      life = Math.min(11, 4 + p.speed * 1.8),
      fade = clamp(1 - age / life);
    if (fade <= 0 || i % 4) return;
    const sideX = -p.uy,
      sideY = p.ux,
      spread = (3 + age * 0.5) * p.scale,
      drift = age * 0.26,
      width = Math.max(2, Math.round((2 + age * 0.16) * p.scale));
    ctx.fillStyle = `rgba(240,248,250,${(0.36 * fade * clamp(p.speed / 2)).toFixed(2)})`;
    for (const flank of [-1, 1])
      ctx.fillRect(
        Math.round(p.x - p.ux * drift + sideX * flank * spread - width / 2),
        Math.round(p.y - p.uy * drift + sideY * flank * spread),
        width,
        1,
      );
  });
}
