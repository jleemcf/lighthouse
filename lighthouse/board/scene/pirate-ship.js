// The scene in parts (see core.js). This part: firstmate's pirate ship and her crew, end on and broadside.

// ---------- the pirate ship ----------
function pirateSprite(ctx, x, y, o, m) {
  // a pirate, feet at (x, y); 3 wide, 8 tall; m = -1 mirrors it to face the other way
  m = m || 1;
  if (o.nap) y += 2;
  if (o.cower) y += 3;
  const R = (vx, vy, w, h, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(m > 0 ? x + vx : x + 3 - vx - w, y + vy, w, h);
  };
  R(0, -6, 3, 2, "#E9C9A8");
  if (o.hatUp) {
    R(0, -7, 3, 1, "#4A3020");
    R(4, -10 + (o.hatUp > 0 ? 0 : 1), 3, 1, "#111");
    R(3, -11 + (o.hatUp > 0 ? 0 : 1), 5, 1, "#111");
    R(3, -6, 1, 2, "#2A3140");
  } else {
    R(0, -7, 3, 1, o.hat ? "#111" : o.cap || "#C8352B");
    if (o.hat) R(-1, -8, 5, 1, "#111");
  }
  R(0, -4, 3, 3, o.coat || (o.stripes ? "#EFE6D2" : "#2A3140"));
  if (o.stripes) R(0, -3, 3, 1, "#2A3140");
  // the captain's coat is red with gold frogging, so he reads as a man and not a shadow
  if (o.coat) R(1, -4, 1, 3, "#D2B04E");
  if (o.armsUp) {
    R(-1, -6, 1, 2, "#2A3140");
    R(3, -6, 1, 2, "#2A3140");
  } else if (o.spy) {
    R(3, -4 - (o.spyUp ? 1 : 0), 1, 1, "#2A3140");
    R(4, -5 - (o.spyUp ? 1 : 0), 2, 1, "#8B7355");
  } else if (o.point) R(3, -4, 3, 1, "#2A3140");
  else if (o.wheel) R(3, -4 + (o.wheel > 0 ? 1 : 0), 1, 1, "#2A3140");
  else if (o.mop) {
    R(3, -4, 1, 1, "#2A3140");
    R(4 + o.mop, -5, 1, 5, "#8B7355");
    R(3 + o.mop, 0, 3, 1, "#C9CFD8");
  } else if (o.mug) {
    R(3, o.mug > 0 ? -6 : -4, 1, 1, "#2A3140");
    R(4, o.mug > 0 ? -7 : -5, 2, 2, "#8B7355");
  } else if (o.haul) {
    R(-1, -5, 1, 1, "#2A3140");
    R(3, -5, 1, 1, "#2A3140");
    R(3, -8 + o.haul, 1, 3, "#8B7355");
  } else if (o.bell) {
    R(3, -6, 1, 2, "#2A3140");
    R(4, -8 + (o.bell > 0 ? 1 : 0), 2, 2, "#D2B04E");
  } else if (o.rifle) {
    R(3, -5, 1, 1, "#2A3140");
    if (o.rifle > 0) {
      R(3, -6, 2, 1, "#6B4A3A");
      R(5, -6, 4, 1, "#2A2834");
      if (o.flash) {
        R(9, -7, 2, 3, "#FFE27A");
        R(9.5, -6.5, 1, 2, "#fff");
      }
    } else {
      R(3, -6, 1, 1, "#6B4A3A");
      R(4, -7, 1, 1, "#2A2834");
      R(5, -8, 1, 1, "#2A2834");
      R(6, -9, 1, 1, "#2A2834");
      if (o.flash) R(7, -11, 2, 2, "#FFE27A");
    }
  }
  if (!o.nap) {
    R(0 + (o.step ? 1 : 0), -1, 1, 1, "#1B2130");
    R(2 - (o.step ? 1 : 0), -1, 1, 1, "#1B2130");
  } else {
    R(0, -1, 3, 1, "#1B2130");
  }
}
function pirateFlag(ctx, R, x, y, w, h, compliance) {
  // the lookout lowers the black anchor and runs up a harmless harbor pennant
  const alpha = ctx.globalAlpha,
    k = clamp(compliance || 0);
  if (k < 1) {
    ctx.globalAlpha = alpha * (1 - k);
    R(x, y, w, h, "#111");
    R(x, y, w, 1.2, "#C8352B");
    R(x + w * 0.43, y + h * 0.2, Math.max(0.6, w * 0.14), h * 0.56, "#fff");
    R(x + w * 0.24, y + h * 0.46, w * 0.5, 0.7, "#fff");
    R(x + w * 0.15, y + h * 0.76, w * 0.7, 0.7, "#fff");
  }
  if (k > 0) {
    ctx.globalAlpha = alpha * k;
    R(x, y, w, h, "#F5F1E7");
    R(x, y + h * 0.2, w, 1.3, "#5A83AB");
    R(x + w * 0.17, y + h * 0.65, w * 0.58, 0.8, "#D2B04E");
  }
  ctx.globalAlpha = alpha;
}
function shipEndOn(ctx, x, y, night, t, alarm, startle, bow, navy) {
  // a real bow/stern silhouette bridges the two broadside views
  const s = 2.2,
    R = (vx, vy, w, h, col) => {
      ctx.fillStyle = col;
      ctx.fillRect(
        Math.round(x + vx * s),
        Math.round(y + vy * s),
        Math.max(1, Math.round(w * s)),
        Math.max(1, Math.round(h * s)),
      );
    };
  const HULL = "#3E2A1E",
    PLANK = "#5C4030",
    DARK = "#2A1C14",
    SAIL = "#EFE6D2",
    SHADE = "#D9CDB4";
  // The masts line up along the ship's length, while the square sails and the breadth of the hull remain visible.
  R(-0.6, -42, 1.2, 42, DARK);
  R(-7, -34, 14, 8, SHADE);
  R(-6, -33, 12, 6, SAIL);
  R(-9, -26, 18, 12, SAIL);
  R(-9, -26, 18, 0.6, SHADE);
  R(-8, -20, 16, 0.5, SHADE);
  R(-8, -13, 16, 8, SAIL);
  R(-8, -13, 16, 0.6, SHADE);
  R(-7, -9, 14, 0.5, SHADE);
  for (let i = -6; i <= 6; i += 3) R(i, -26, 0.5, 1.5, DARK);
  R(-0.6, -48, 1.2, 14, DARK);
  pirateFlag(ctx, R, 0.6, -48, 4, 10, navy ? navy.compliance : 0);
  const widths = bow ? [10, 10, 9, 8, 7, 5, 3] : [10, 10, 10, 9, 9, 8, 8];
  widths.forEach((half, row) => {
    R(-half, row, half * 2, 1, row % 2 ? PLANK : HULL);
    if (row === 0 || row === 4) R(-half, row, half * 2, 0.5, DARK);
  });
  R(-10, -1.8, 20, 0.7, PLANK);
  [-9, -5, 5, 9].forEach(px => R(px, -2.2, 0.6, 2, DARK));
  if (bow) {
    R(-2, 4, 4, 2, "#6B4A3A");
    R(-1, 6, 2, 1, "#D2B04E");
  } else {
    R(-7, 1, 3, 2, night > 0.3 ? "#FFE27A" : "#8FB4D8");
    R(4, 1, 3, 2, night > 0.3 ? "#FFE27A" : "#8FB4D8");
    R(-8, 5, 16, 0.5, "#6B4A3A");
  }
  const py = Math.round(y - (alarm ? startle * 3 : 0));
  pirateSprite(
    ctx,
    Math.round(x - 15),
    py - 2,
    { hat: true, coat: "#8B2E2E", armsUp: alarm && !(navy && navy.cower), cower: navy && navy.cower },
    1,
  );
  pirateSprite(
    ctx,
    Math.round(x + 11),
    py - 2,
    { stripes: true, armsUp: alarm && !(navy && navy.cower), cower: navy && navy.cower },
    -1,
  );
  if (bow)
    pirateSprite(
      ctx,
      Math.round(x - 1),
      py - 7,
      {
        cap: "#4A6FA5",
        point: !alarm && !(navy && navy.cower),
        armsUp: navy && navy.changing,
        cower: navy && navy.cower && !navy.changing,
      },
      1,
    );
  R(-4, -37, 8, 3, PLANK);
  R(-4, -37, 8, 0.6, "#8B7355");
  for (let i = -3; i <= 3; i += 2) R(i, -36, 0.5, 2, DARK);
  R(-3.6, -34, 7.2, 0.6, DARK);
  if (alarm && !(navy && navy.cower)) R(4, -37 + Math.round(Math.sin(t * 16)), 1.5, 1.5, "#D2B04E");
}

function shipBroadside(ctx, x, y, dirf, night, t, alarm, startle, vel, navy) {
  // firstmate's pirate ship with her crew, deck at (x, y); dirf is the signed side-on projection
  const s = 2.2,
    m = dirf >= 0 ? 1 : -1,
    R = (vx, vy, w, h, col) => {
      const x0 = x + vx * s * dirf,
        x1 = x + (vx + w) * s * dirf;
      ctx.fillStyle = col;
      ctx.fillRect(
        Math.round(Math.min(x0, x1)),
        Math.round(y + vy * s),
        Math.max(1, Math.round(Math.abs(x1 - x0))),
        Math.max(1, Math.round(h * s)),
      );
    };
  const at = (vx, vy) => ({ x: Math.round(x + vx * s * dirf) - 1, y: Math.round(y + vy * s) });
  const HULL = "#3E2A1E",
    PLANK = "#5C4030",
    DARK = "#2A1C14",
    SAIL = "#EFE6D2",
    SHADE = "#D9CDB4";
  for (let r = 0; r < 8; r++) {
    const inset = r < 5 ? 0 : (r - 4) * 3;
    R(-26 + inset, r, 52 - 2 * inset, 1, HULL);
  }
  for (let r = 1; r < 8; r += 2) R(-24, r, 46, 1, PLANK);
  for (let i = 0; i < 32; i++) {
    const row = 1 + Math.floor(rnd(i, 711) * 6),
      px = -23 + Math.floor(rnd(i, 712) * 45);
    R(px, row, 1.2 + rnd(i, 713) * 2.8, 0.4, i % 3 ? "#78533B" : "#34251C");
  }
  for (let px = -22; px < 24; px += 7) R(px, 1, 0.5, 4, DARK);
  R(-26, 0, 52, 0.5, DARK);
  R(-26, 4.6, 52, 0.4, "#6B4A3A");
  [-18, -8, 2, 12].forEach(vx => {
    R(vx - 0.4, 1.3, 3.4, 3, "#9A744C");
    R(vx, 2.2, 2.6, 1.8, "#15100C");
    R(vx, 1.4, 2.6, 0.6, "#6B4A3A");
    R(vx + 0.6, 2.6, 1.2, 0.8, "#4A4A4A");
  });
  for (let px = -24; px <= 24; px += 4) R(px, -1.6, 0.5, 1.6, DARK);
  R(-25, -1.8, 50, 0.5, PLANK);
  R(26, -3, 12, 3, HULL);
  R(30, -5, 9, 2, HULL);
  R(38, -4.5, 2, 2.5, "#D2B04E");
  R(-31, -7, 7, 8, HULL);
  R(-29, -9, 10, 2, PLANK);
  R(-30, -3, 1.2, 1.2, night > 0.3 ? "#FFE27A" : "#8FB4D8");
  R(-27, -3, 1.2, 1.2, night > 0.3 ? "#FFE27A" : "#8FB4D8");
  R(-32, -5, 1.2, 1.2, night > 0.3 ? "#FFE27A" : "#8B7355");
  R(-28, -4, 2, 2, night > 0.3 ? "#FFE27A" : "#8FB4D8");
  R(-24, -12, 2.4, 2.4, "#5C4030");
  if (alarm && Math.sin(t * 14) > 0) R(-23.6, -11.6, 1.6, 0.6, DARK);
  else R(-23.4, -11.4, 1.2, 1.2, DARK);
  R(-4, -2, 2, 2, "#6B4A3A");
  R(-4, -1.3, 2, 0.4, DARK);
  R(-1.5, -2, 2, 2, "#6B4A3A");
  R(-1.5, -1.3, 2, 0.4, DARK);
  R(22, -2.4, 2.2, 2.4, "#4A4A4A");
  R(22.6, -3, 1, 0.8, "#4A4A4A");
  [8, -10].forEach((mx, i) => {
    R(mx, -34 + i * 4, 1.2, 34 - i * 4, DARK);
    R(mx - 9, -30 + i * 4, 20, 0.5, DARK);
    R(mx - 8, -18 + i * 4, 18, 0.5, DARK);
    const sw = 1 + Math.round(Math.sin(t * 0.9 + i));
    for (let row = 0; row < 10; row++) {
      const trim = row > 6 ? Math.floor((row - 5) / 2) : 0;
      R(mx - 8 + trim, -29 + i * 4 + row, 18 - trim * 2, 1, row === 9 ? "#C4B89F" : SAIL);
    }
    R(mx - 8 + sw, -29 + i * 4, 2, 9, SHADE);
    R(mx - 8, -29 + i * 4, 18, 0.5, "#FFF7E7");
    R(mx - 8, -24 + i * 4, 18, 0.4, SHADE);
    for (let seam = 1; seam < 4; seam++) {
      R(mx - 8 + seam * 4, -27 + i * 4, 0.4, 6, seam % 2 ? "#E1D7C2" : "#FFF5DF");
      R(mx - 8 + seam * 4, -20 + i * 4, 0.7, 1, "#A99A82");
    }
    for (let row = 0; row < 8; row++) {
      const trim = row > 5 ? row - 5 : 0;
      R(mx - 7 + trim, -17 + i * 4 + row, 16 - trim * 2, 1, row === 7 ? "#C4B89F" : SAIL);
    }
    R(mx - 7 + sw, -17 + i * 4, 2, 7, SHADE);
    R(mx - 7, -13 + i * 4, 16, 0.4, SHADE);
    [mx - 2, mx + 4].forEach(sx => {
      R(sx, -16 + i * 4, 0.4, 5, "#E1D7C2");
      R(sx, -10 + i * 4, 0.6, 0.7, "#A99A82");
    });
    for (let k = 0; k < 6; k++) R(mx - 9 + k * 3.4, -30 + i * 4 + k * 0.1, 0.4, 1.6, DARK);
  });
  R(8, -48, 1.2, 14, DARK); // the mainmast on up past the nest to the flag
  pirateFlag(ctx, R, 8.6, -48, 8.4, 10, navy ? navy.compliance : 0);
  R(24, -12, 0.5, 12, DARK);
  for (let r = 0; r < 10; r++) R(24 - r, -12 + r, r + 1, 1, SAIL);
  // the crew, each with a day of their own; frantic in an alarm; a "yar" now and then
  const yar = (p, i) => {
    const ph = (t + i * 5.3) % 26;
    if (alarm || ph > 0.9) return;
    const alpha = ctx.globalAlpha;
    ctx.font = "7px monospace";
    ctx.textAlign = "center";
    ctx.globalAlpha = alpha * (1 - ph / 0.9);
    ctx.fillStyle = "#1B2130";
    ctx.fillText("yar", p.x + 2, p.y - 10 - ph * 4);
    ctx.fillStyle = "#F4F1EA";
    ctx.fillText("yar", p.x + 1, p.y - 11 - ph * 4);
    ctx.globalAlpha = alpha;
    ctx.textAlign = "left";
  };
  const pirate = (vx, vy, o, i) => {
    const p = at(vx, vy);
    pirateSprite(ctx, p.x, p.y - Math.round(startle * 3), o, m);
    if (i != null) yar(p, i);
  };
  const step = Math.sin(t * (alarm ? 16 : 6)) > 0;
  if (navy && navy.cower) {
    // the navy is in sight: crew tuck behind the gunwale; the lookout works the flag halyard
    pirate(-27, -8, { hat: true, coat: "#8B2E2E", cower: true });
    pirate(-12, -1, { stripes: true, cower: true });
    pirate(21, -2, { cap: "#4A6FA5", cower: true });
    pirate(5.6, -35.2, {
      stripes: true,
      armsUp: navy.changing,
      haul: navy.changing ? (Math.sin(t * 7) > 0 ? 1 : 3) : 0,
      cower: !navy.changing,
    });
    R(-25, -1.8, 50, 1.2, DARK); // the near rail hides their lowered bodies
    R(5, -37, 8, 3, "#5C4030");
    R(5, -37, 8, 0.6, "#8B7355");
    for (let k = 0; k < 4; k++) R(5.8 + k * 2, -36.2, 0.5, 2.2, DARK);
    R(5.4, -34, 7.2, 0.6, DARK);
    return;
  }
  {
    // the captain, a minute a round: the wheel, the glass at the stern rail, a mug, a turn about the poop, a jig, his
    // parrot, his hat waved at the island
    const c = t % 64,
      cap = { hat: true, coat: "#8B2E2E" };
    if (alarm) pirate(-27, -9, Object.assign({ armsUp: Math.sin(t * 9) > 0 }, cap), 0);
    else if (c < 12) pirate(-27, -9, Object.assign({ wheel: Math.sin(t * 1.1) > 0 ? 1 : -1 }, cap), 0);
    else if (c < 20) pirate(-30, -9, Object.assign({ spy: true, spyUp: Math.sin(t * 0.5) > 0 }, cap), 0);
    else if (c < 28) pirate(-28, -9, Object.assign({ mug: Math.sin(t * 0.8) > 0.3 ? 1 : -1 }, cap), 0);
    else if (c < 38) {
      const w = (t * 0.3) % 2,
        vx = w < 1 ? -30 + w * 8 : -22 - (w - 1) * 8;
      pirate(vx, -9, Object.assign({ step: Math.sin(t * 6) > 0, point: Math.sin(t * 0.9) > 0.7 }, cap), 0);
    } else if (c < 46)
      pirate(
        -26,
        -9 - (Math.sin(t * 8) > 0 ? 1 : 0),
        Object.assign({ step: Math.sin(t * 8) > 0, armsUp: Math.sin(t * 4) > 0 }, cap),
        0,
      );
    else if (c < 56) {
      // the parrot on his shoulder, off round his head and back
      pirate(-27, -9, Object.assign({ point: Math.sin(t * 0.9) > 0.5 }, cap), 0);
      const k = c < 50 ? 0 : (c - 50) / 6,
        sh = at(-25.2, -14.2),
        px = sh.x + Math.round(Math.sin(k * Math.PI * 2) * 7 * m),
        py =
          sh.y - Math.round(Math.abs(Math.sin(k * Math.PI * 2)) * 7) - (k > 0 && k < 1 && Math.sin(t * 20) > 0 ? 1 : 0);
      ctx.fillStyle = "#3FA34D";
      ctx.fillRect(px, py, 2, 2);
      ctx.fillStyle = "#C8352B";
      ctx.fillRect(px + (m > 0 ? 1 : 0), py, 1, 1);
      ctx.fillStyle = "#FFE27A";
      ctx.fillRect(px + (m > 0 ? 2 : -1), py, 1, 1);
    } else pirate(-27, -9, Object.assign({ hatUp: Math.sin(t * 3) > 0 ? 1 : -1 }, cap), 0);
  }
  {
    // the lookout: scanning, waving his hat, pointing, leaning on the rim, a nap; in an alarm he rings the bell
    const c = Math.floor((t / 20) % 5),
      scan = Math.sin(t * 0.35);
    if (alarm) pirate(5.6, -35.2, { stripes: true, bell: Math.sin(t * 16) > 0 ? 1 : -1 }, 1);
    else if (c === 0) pirate(5.6, -35.2, { stripes: true, spy: true, spyUp: scan > 0.3 }, 1);
    else if (c === 1) pirate(5.6, -35.2, { stripes: true, armsUp: Math.sin(t * 3) > 0 }, 1);
    else if (c === 2) pirate(5.6, -35.2, { stripes: true, point: true }, 1);
    else if (c === 3) pirate(5.6, -35.2, { stripes: true }, 1);
    else pirate(5.6, -35.2, { stripes: true, nap: true }, 1);
  }
  {
    // a deckhand: pacing, then mopping, then hauling a line
    const c = (t * 0.15) % 3;
    if (c < 1) {
      const w = (c * 2) % 2,
        vx = w < 1 ? -16 + w * 32 : 16 - (w - 1) * 32;
      pirate(vx, 0, { stripes: true, step, armsUp: alarm }, 2);
    } else if (c < 2) pirate(-14, 0, { stripes: true, mop: Math.sin(t * 5) > 0 ? 1 : 2, armsUp: alarm }, 2);
    else pirate(-2, 0, { stripes: true, haul: Math.sin(t * 4) > 0 ? 1 : 3, armsUp: alarm }, 2);
  }
  {
    // one on the rigging: up to the nest, a long rest there, down, a rest on deck; in an alarm he stops half way up
    // the mast and waves a rifle about, firing now and then
    const c = (t / 120) % 1;
    if (alarm) pirate(8.8, -18, { cap: "#4A6FA5", rifle: Math.sin(t * 5) > 0 ? 1 : -1, flash: (t * 1.3) % 1 < 0.1 }, 3);
    else if (c < 0.15) {
      const up = c / 0.15;
      pirate(8 + up * 2.2, -1 - up * 33.6, { cap: "#4A6FA5", step: Math.sin(t * 4) > 0 }, 3);
    } else if (c < 0.55) pirate(10.2, -35.2, { cap: "#4A6FA5", point: Math.sin(t * 0.6) > 0.5 }, 3);
    else if (c < 0.7) {
      const up = 1 - (c - 0.55) / 0.15;
      pirate(8 + up * 2.2, -1 - up * 33.6, { cap: "#4A6FA5", step: Math.sin(t * 4) > 0 }, 3);
    } else pirate(9, 0, { cap: "#4A6FA5", mug: Math.sin(t * 0.7) > 0.4 ? 1 : -1 }, 3);
  }
  {
    // the bow watch: pointing ahead and waving, sitting out on the bowsprit, or hauling at the jib
    const c = Math.floor((t / 30) % 3);
    if (alarm) pirate(20, -1 - 2 * Math.abs(Math.sin(t * 8)), { armsUp: true }, 4);
    else if (c === 0) pirate(20, -1, { armsUp: Math.sin(t * 0.7) > 0.8, point: Math.sin(t * 0.7) < -0.3 }, 4);
    else if (c === 1) pirate(30, -5, { nap: Math.sin(t * 0.2) > 0.6 }, 4);
    else pirate(22, -1, { haul: Math.sin(t * 3) > 0 ? 1 : 3 }, 4);
  }
  R(5, -37, 8, 3, "#5C4030");
  R(5, -37, 8, 0.6, "#8B7355");
  for (let k = 0; k < 4; k++) R(5.8 + k * 2, -36.2, 0.5, 2.2, DARK);
  R(5.4, -34, 7.2, 0.6, DARK); // the crow's nest: a barrel of staves round the mast, drawn over whoever stands in it
  {
    const bell = at(12.6, -37.2),
      sw = alarm ? Math.round(Math.sin(t * 16)) : 0;
    ctx.fillStyle = "#D2B04E";
    ctx.fillRect(bell.x + sw, bell.y, 2, 2);
    ctx.fillStyle = "#8B7355";
    ctx.fillRect(bell.x + sw, bell.y + 2, 2, 1);
  } // its bell
  if (alarm) {
    {
      const w = (t * 2.1) % 2,
        vx = w < 1 ? -18 + w * 30 : 12 - (w - 1) * 30;
      pirate(vx + 4, 0, { step, stripes: true }, 5);
    }
    [-18, -8, 2, 12].forEach((vx, i) => {
      const period = 1.6 + 0.35 * i,
        ph = (t + i * 0.55) % period,
        p = at(vx + 1.3, 3.1);
      if (ph < 0.12) {
        ctx.fillStyle = "#FFE27A";
        ctx.fillRect(p.x - 3, p.y - 2, 7, 5);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(p.x - 1, p.y - 1, 3, 3);
      }
      if (ph > 0.05 && ph < 1.4) {
        const k = (ph - 0.05) / 1.35;
        ctx.fillStyle = "rgba(201,207,216," + (0.6 * (1 - k)).toFixed(2) + ")";
        for (let j = 0; j < 3; j++) {
          const w = 2 + Math.round(k * 4) + j;
          ctx.fillRect(
            Math.round(p.x - 2 + j * 3 - k * 6 * m),
            Math.round(p.y - 2 - k * 16 - j * 2),
            w,
            Math.max(2, Math.round(w / 2)),
          );
        }
      }
      if (ph < 0.8) {
        const k = ph / 0.8;
        ctx.fillStyle = "#1B2130";
        ctx.fillRect(Math.round(p.x + m * k * 14), Math.round(p.y + k * 8 + k * k * 34), 2, 2);
      } else if (ph < 1.2) {
        const k = (ph - 0.8) / 0.4,
          bx = Math.round(p.x + m * 14),
          by = Math.round(p.y + 42);
        ctx.fillStyle = "rgba(255,255,255," + (0.85 * (1 - k * 0.6)).toFixed(2) + ")";
        for (let j = 0; j < 4; j++)
          ctx.fillRect(bx - 4 + j * 3, Math.round(by - Math.sin(k * Math.PI) * (4 + (j % 2) * 4)), 1, 2);
        ctx.fillRect(bx - 5, by, 12, 1);
      }
    });
  }
}

const shipSurface = document.createElement("canvas");
shipSurface.width = 320;
shipSurface.height = 250;
const shipInk = shipSurface.getContext("2d");
function ship(ctx, x, y, scale, heading, night, t, alarm, startle, vel, bow, navy) {
  // The aligned end view carries the turn across zero. A narrow side projection meets it
  // without layering translucent sails or abruptly mirroring the crew.
  shipInk.clearRect(0, 0, 320, 250);
  shipInk.save();
  shipInk.translate(160, 150);
  if (Math.abs(heading) < 0.28) shipEndOn(shipInk, 0, 0, night, t, alarm, startle, bow, navy);
  else
    shipBroadside(
      shipInk,
      0,
      0,
      Math.sign(heading) * Math.max(0.36, Math.abs(heading)),
      night,
      t,
      alarm,
      startle,
      vel,
      navy,
    );
  shipInk.restore();
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const dw = Math.round(320 * scale),
    dh = Math.round(250 * scale);
  ctx.drawImage(shipSurface, Math.round(x - dw / 2), Math.round(y - dh * 0.6), dw, dh);
  ctx.restore();
}
