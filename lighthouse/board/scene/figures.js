// The scene in parts (see core.js). This part: the keepers' and the cat's sprites.

// ---------- the people and the cat ----------
const OP_COLORS = ["#F2A93B", "#6FB1FF", "#4CC38A", "#BD96E8", "#EF8FA0", "#D2C36B"];
const operatorColor = id => OP_COLORS[(facts?.boards || []).indexOf(id) % OP_COLORS.length] || "#93A3B0";
function figure(ctx, x, y, cap, o) {
  // a small keeper, feet at (x, y); 5 wide, 13 tall with the cap
  o = o || {};
  const d = o.dir || 1;
  if (o.sitBack) {
    // on a bench, seen from behind, looking out to sea: the cap, the back of the head, the coat; the legs are beyond
    // the seat
    ctx.fillStyle = cap;
    ctx.fillRect(x, y - 9, 5, 2);
    ctx.fillStyle = "#D9B48E";
    ctx.fillRect(x + 1, y - 7, 3, 2);
    ctx.fillStyle = "#2A3140";
    ctx.fillRect(x, y - 5, 5, 5);
    if (o.cup) {
      ctx.fillStyle = "#2A3140";
      ctx.fillRect(x + 5, o.cupUp ? y - 7 : y - 4, 1, 1);
      ctx.fillStyle = "#F4F1EA";
      ctx.fillRect(x + 6, o.cupUp ? y - 9 : y - 6, 2, 2);
      ctx.fillStyle = "#6B4A3A";
      ctx.fillRect(x + 6, o.cupUp ? y - 9 : y - 6, 2, 1);
    }
    return;
  }
  if (o.sit) {
    // on the ground, legs forward
    ctx.fillStyle = "#E9C9A8";
    ctx.fillRect(x + 1, y - 9, 3, 3);
    ctx.fillStyle = cap;
    ctx.fillRect(x, y - 10, 5, 1);
    ctx.fillRect(x + 1, y - 11, 3, 1);
    ctx.fillStyle = "#2A3140";
    ctx.fillRect(x, y - 6, 5, 4);
    ctx.fillStyle = "#1B2130";
    ctx.fillRect(x + 2, y - 2, 4, 1);
    ctx.fillRect(x + 5, y - 1, 1, 1);
    if (o.cup) {
      const up = o.cupUp;
      ctx.fillStyle = "#2A3140";
      ctx.fillRect(x + 5, up ? y - 8 : y - 5, 2, 1);
      ctx.fillStyle = "#F4F1EA";
      ctx.fillRect(x + 6, up ? y - 10 : y - 7, 2, 2);
      ctx.fillStyle = "#6B4A3A";
      ctx.fillRect(x + 6, up ? y - 10 : y - 7, 2, 1);
    }
    return;
  }
  if (o.crouch) {
    // bending down to the cat
    ctx.fillStyle = "#E9C9A8";
    ctx.fillRect(x + 1, y - 8, 3, 3);
    ctx.fillStyle = cap;
    ctx.fillRect(x, y - 9, 5, 1);
    ctx.fillRect(x + 1, y - 10, 3, 1);
    ctx.fillStyle = "#2A3140";
    ctx.fillRect(x, y - 5, 5, 3);
    ctx.fillRect(d > 0 ? x + 5 : x - 2, y - 3, 2, 1);
    ctx.fillRect(d > 0 ? x + 6 : x - 2, y - 2, 1, 1);
    ctx.fillStyle = "#1B2130";
    ctx.fillRect(x + 1, y - 2, 1, 2);
    ctx.fillRect(x + 3, y - 2, 1, 2);
    return;
  }
  ctx.fillStyle = "#E9C9A8";
  ctx.fillRect(x + 1, y - 11, 3, 3);
  ctx.fillStyle = cap;
  ctx.fillRect(x, y - 12, 5, 1);
  ctx.fillRect(x + 1, y - 13, 3, 1);
  ctx.fillStyle = "#2A3140";
  ctx.fillRect(x, y - 8, 5, 5);
  const ax = d > 0 ? x + 5 : x - 3;
  if (o.arm === "spy") {
    ctx.fillRect(ax, y - 7, 3, 1);
    ctx.fillStyle = "#8B7355";
    ctx.fillRect(d > 0 ? x + 8 : x - 5, y - 8, 2, 1);
  } else if (o.arm === "out") ctx.fillRect(ax, y - 7, 3, 1);
  else if (o.arm === "up") {
    ctx.fillRect(x - 1, y - 11, 1, 4);
    ctx.fillRect(x + 5, y - 11, 1, 4);
  } else if (o.arm === "wave1") {
    ctx.fillRect(x - 2, y - 12, 1, 4);
    ctx.fillRect(x + 6, y - 9, 1, 2);
  } else if (o.arm === "wave2") {
    ctx.fillRect(x - 2, y - 9, 1, 2);
    ctx.fillRect(x + 6, y - 12, 1, 4);
  } else if (o.arm === "wipe") {
    ctx.fillRect(x + 5, y - 10, 1, 2);
    ctx.fillRect(x + 4, y - 11, 2, 1);
  }
  if (o.cup) {
    const up = o.cupUp,
      cx = d > 0 ? x + 6 : x - 3;
    ctx.fillStyle = "#2A3140";
    ctx.fillRect(d > 0 ? x + 5 : x - 2, up ? y - 10 : y - 6, 2, 1);
    ctx.fillStyle = "#F4F1EA";
    ctx.fillRect(cx, up ? y - 12 : y - 8, 2, 2);
    ctx.fillStyle = "#6B4A3A";
    ctx.fillRect(cx, up ? y - 12 : y - 8, 2, 1);
  }
  ctx.fillStyle = "#1B2130";
  const w = o.walk || 0;
  ctx.fillRect(x + 1 - w, y - 3, 1, 3);
  ctx.fillRect(x + 3 + w, y - 3, 1, 3);
}
function benchBack(ctx, c, cy, snow) {
  ctx.fillStyle = "#3E2A1E";
  ctx.fillRect(c.x + 1, cy - 8, 1, 4);
  ctx.fillRect(c.x + 14, cy - 8, 1, 4);
  ctx.fillStyle = "#7A5A44";
  ctx.fillRect(c.x, cy - 9, 16, 2);
  ctx.fillStyle = "#3E2A1E";
  ctx.fillRect(c.x, cy - 7, 16, 1);
  if (snow) {
    ctx.fillStyle = "#F0F4FA";
    ctx.fillRect(c.x, cy - 10, 16, 1);
  }
}
function lying(ctx, x, y, cap) {
  // stretched out on the grass, head to the left; 12 wide, 4 tall
  ctx.fillStyle = cap;
  ctx.fillRect(x, y - 4, 1, 3);
  ctx.fillStyle = "#E9C9A8";
  ctx.fillRect(x + 1, y - 4, 3, 3);
  ctx.fillStyle = "#2A3140";
  ctx.fillRect(x + 4, y - 4, 5, 3);
  ctx.fillStyle = "#1B2130";
  ctx.fillRect(x + 9, y - 3, 3, 1);
  ctx.fillRect(x + 9, y - 2, 3, 1);
}
function catSprite(ctx, c, now) {
  // a small grey cat, feet at (c.x, c.y), facing c.dir
  const x = Math.round(c.x),
    y = Math.round(c.y),
    d = c.dir;
  const R = (vx, vy, w, h, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(d > 0 ? x + vx : x + 8 - vx - w, y + vy, w, h);
  }; // mirrored across an 8-wide box
  const FUR = "#A8AFBB",
    STRIPE = "#717B89",
    EYE = "#3E8E5A";
  if (c.act === "sleep") {
    R(0, -3, 7, 3, FUR);
    R(1, -4, 4, 1, FUR);
    R(2, -2, 1, 1, STRIPE);
    R(5, -2, 1, 1, STRIPE);
    R(6, -4, 2, 1, FUR);
    const ph = (now * 0.5) % 1;
    ctx.globalAlpha = 1 - ph;
    ctx.fillStyle = "#93A3B0";
    ctx.fillRect(x + 8, y - 7 - Math.round(ph * 6), 1, 1);
    ctx.fillRect(x + 9, y - 8 - Math.round(ph * 6), 1, 1);
    ctx.globalAlpha = 1;
    return;
  }
  if (c.act === "groom" && !c.petBy) {
    const lick = Math.sin((now - c.t0) * 8) > 0;
    R(1, -5, 5, 5, FUR);
    R(2, -8, 4, 3, FUR);
    R(2, -9, 1, 1, FUR);
    R(5, -9, 1, 1, FUR);
    R(4, -7, 1, 1, EYE);
    R(0, -2, 2, 1, STRIPE);
    R(-2, -1, 3, 1, FUR);
    R(5, lick ? -7 : -5, 2, 2, FUR);
    R(6, lick ? -8 : -6, 1, 1, STRIPE);
    if (lick) R(5, -6, 1, 2, "#D9899F");
    return;
  }
  if (c.act === "stretch" && !c.petBy) {
    const reach = Math.sin((now - c.t0) * 3.5) > 0 ? 1 : 0;
    R(-1, -4, 8, 3, FUR);
    R(0, -5, 3, 2, FUR);
    R(2, -3, 2, 1, STRIPE);
    R(6, -3, 3, 2, FUR);
    R(7, -4, 1, 1, FUR);
    R(9, -2, 1, 1, EYE);
    R(8 + reach, -1, 2, 1, FUR);
    R(10 + reach, -1, 2, 1, FUR);
    R(-2, -8, 1, 5, FUR);
    R(-3, -9, 2, 1, FUR);
    return;
  }
  if (c.act === "butterfly" && !c.petBy) {
    if (c.leap > 1) {
      // spring up on the hind legs, both forepaws reaching and swiping at the air
      const swipe = Math.sin((now - c.t0) * 25) > 0 ? 2 : 0;
      R(1, -11, 6, 9, FUR);
      R(1, -9, 2, 5, STRIPE);
      R(4, -9, 2, 6, "#C9D0D5");
      R(5, -7, 1, 3, STRIPE);
      R(2, -16, 5, 5, FUR);
      R(2, -18, 2, 3, FUR);
      R(6, -18, 2, 3, FUR);
      R(5, -15, 1, 1, EYE);
      R(7, -15, 1, 1, EYE);
      R(6, -13, 1, 1, "#D58A9D");
      R(6, -12, 2, 1, "#554750");
      R(0, -16, 2, 5, FUR);
      R(-1, -19, 3, 2, FUR);
      R(-1, -19, 1, 1, "#E3BAC1");
      R(8, -17 + swipe, 2, 6 - swipe, FUR);
      R(8 + swipe, -19 + swipe, 3, 2, FUR);
      R(10 + swipe, -19 + swipe, 1, 1, "#E3BAC1");
      R(-1, -3, 4, 2, FUR);
      R(-3, -1, 3, 1, STRIPE);
      R(6, -3, 4, 2, FUR);
      R(9, -1, 3, 1, STRIPE);
      R(-1, -9, 2, 4, FUR);
      R(-3, -12, 2, 4, FUR);
      R(-4, -13, 2, 2, FUR);
      return;
    }
    const step = Math.sin(now * 17) > 0 ? 1 : 0;
    R(0, -4, 7, 3, FUR);
    R(2, -4, 1, 1, STRIPE);
    R(4, -3, 1, 1, STRIPE);
    R(5, -7, 3, 3, FUR);
    R(5, -8, 1, 1, FUR);
    R(7, -8, 1, 1, FUR);
    R(7, -6, 1, 1, EYE);
    R(1 + step, -1, 2, 1, FUR);
    R(7 - step, -3, 2, 2, FUR);
    R(-1, -7, 1, 4, FUR);
    R(-2, -8, 1, 1, FUR);
    return;
  }
  if (c.act === "sit" || c.act === "shelter" || c.petBy) {
    R(1, -4, 4, 4, FUR);
    R(2, -7, 3, 3, FUR);
    R(2, -8, 1, 1, FUR);
    R(4, -8, 1, 1, FUR);
    R(4, -6, 1, 1, EYE);
    R(2, -3, 1, 1, STRIPE);
    R(-2, -1, 3, 1, FUR);
    return;
  }
  const step = c.moving ? (Math.sin(now * (c.act === "chase" ? 24 : 14)) > 0 ? 1 : 0) : 0,
    st = c.act === "stretch" || c.act === "chase";
  R(0, st ? -3 : -4, 6, 3, FUR);
  R(2, -3, 1, 1, STRIPE);
  R(4, -3, 1, 1, STRIPE);
  R(1 + step, -1, 1, 1, FUR);
  R(4 - step, -1, 1, 1, FUR);
  R(5, st ? -4 : -6, 3, 3, FUR);
  R(5, st ? -5 : -7, 1, 1, FUR);
  R(7, st ? -5 : -7, 1, 1, FUR);
  R(7, st ? -3 : -5, 1, 1, EYE);
  R(-1, -6 + (st ? 2 : 0), 1, 3, FUR);
  R(-2, -7 + (st ? 2 : 0), 1, 1, FUR);
}
