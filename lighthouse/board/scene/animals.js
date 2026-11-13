// The scene in parts (see core.js). This part: the bird family in the tree, the squirrel, and the visiting flock.

// ---------- the bird family ----------
function stepBirdFamily(t, night) {
  if (night > 0.6) {
    // everyone settles in at dusk; no bird can be stranded in an unfinished trip
    mother.state = father.state = "nest";
    birdFamily.mode = "rest";
    birdFamily.until = t + 16;
    return;
  }
  if (birdFamily.mode === "rest") {
    if (t < birdFamily.until) return;
    const event = birdFamily.event++ % 8;
    if (event === 2 || event === 5) {
      birdFamily.mode = event === 5 ? "heart" : "together";
      birdFamily.t0 = t;
      birdFamily.until = t + (event === 5 ? 10 : 6);
      mother.state = father.state = birdFamily.mode;
    } else if (event === 7) {
      birdFamily.mode = "snuggle";
      birdFamily.t0 = t;
      birdFamily.until = t + 9;
      mother.state = father.state = "snuggle";
    } else {
      const parent = birdFamily.trips++ % 2 ? father : mother;
      birdFamily.mode = "forage";
      parent.food = ["worm", "caterpillar", "caterpillar", "worm"][(birdFamily.trips - 1) % 4];
      parent.state = "depart";
      parent.t0 = t;
      parent.until = t + foodFlight(parent).duration;
    }
    return;
  }
  if (birdFamily.mode === "heart" || birdFamily.mode === "together" || birdFamily.mode === "snuggle") {
    if (t >= birdFamily.until) {
      mother.state = father.state = "nest";
      birdFamily.mode = "rest";
      birdFamily.until = t + 18 + Math.random() * 10;
    }
    return;
  }
  const parent = mother.state !== "nest" ? mother : father;
  if (parent.state === "depart" && t >= parent.until) {
    parent.state = "search";
    parent.t0 = t;
    parent.until = t + 9 + Math.random() * 6;
  } else if (parent.state === "search" && t >= parent.until) {
    parent.state = "return";
    parent.t0 = t;
    parent.until = t + foodFlight(parent).duration;
  } else if (parent.state === "return" && t >= parent.until) {
    parent.state = "feed";
    parent.t0 = t;
    parent.until = t + 3.5;
  } else if (parent.state === "feed" && t >= parent.until) {
    parent.state = "nest";
    birdFamily.mode = "rest";
    birdFamily.until = t + 65 + Math.random() * 35;
  }
}
function foodFlight(parent) {
  return parent.id === "mother"
    ? { x: -42, y: 166, duration: 6.2, arc: 45 }
    : { x: W + 42, y: 112, duration: 3.1, arc: 145 };
}
function birdFlightPos(parent, t, nx, ny) {
  if (parent.state === "heart" || parent.state === "together") {
    const elapsed = t - birdFamily.t0,
      heart = parent.state === "heart",
      duration = heart ? 10 : 6,
      approach = heart ? 1.7 : 1;
    const theta =
      clamp((elapsed - approach) / (duration - approach * 2)) * Math.PI * 2 + (parent.id === "father" ? -0.48 : 0);
    const blend = Math.min(clamp(elapsed / approach), clamp((duration - elapsed) / approach));
    const homeX = nx + (parent.id === "mother" ? -15 : 15),
      homeY = ny - 4;
    if (parent.state === "heart") {
      const hx = 16 * Math.pow(Math.sin(theta), 3),
        hy = -(13 * Math.cos(theta) - 5 * Math.cos(2 * theta) - 2 * Math.cos(3 * theta) - Math.cos(4 * theta));
      return {
        x: Math.round(lerp(homeX, nx - 20 + hx * 2.45, blend)),
        y: Math.round(lerp(homeY, ny - 102 + hy * 1.32, blend)),
        dir: Math.cos(theta) >= 0 ? 1 : -1,
      };
    }
    return {
      x: Math.round(lerp(homeX, nx - 22 + 54 * Math.cos(theta), blend)),
      y: Math.round(lerp(homeY, ny - 28 + 26 * Math.sin(theta * 1.3), blend)),
      dir: Math.sin(theta) < 0 ? 1 : -1,
    };
  }
  const mom = parent.id === "mother",
    route = foodFlight(parent);
  const k = clamp((t - parent.t0) / route.duration),
    p = parent.state === "return" ? 1 - k : k;
  return {
    x: Math.round(lerp(nx + (mom ? -15 : 15), route.x, p)),
    y: Math.round(lerp(ny - 4, route.y, p) - Math.sin(p * Math.PI) * route.arc),
    dir: parent.state === "return" ? (mom ? 1 : -1) : mom ? -1 : 1,
  };
}
function tinyBirdHeart(ctx, x, y, col) {
  ctx.fillStyle = col;
  ctx.fillRect(x, y, 2, 1);
  ctx.fillRect(x + 3, y, 2, 1);
  ctx.fillRect(x, y + 1, 5, 1);
  ctx.fillRect(x + 1, y + 2, 3, 1);
  ctx.fillRect(x + 2, y + 3, 1, 1);
}
function drawBirdFood(ctx, x, y, kind) {
  if (kind === "caterpillar") {
    ctx.fillStyle = "#314B32";
    ctx.fillRect(x, y, 5, 2);
    ctx.fillStyle = "#84B84D";
    ctx.fillRect(x, y, 2, 1);
    ctx.fillRect(x + 3, y, 2, 1);
    ctx.fillStyle = "#1B2130";
    ctx.fillRect(x + 4, y, 1, 1);
  } else {
    ctx.fillStyle = "#B87575";
    ctx.fillRect(x, y, 4, 1);
    ctx.fillRect(x + 3, y + 1, 2, 1);
    ctx.fillStyle = "#E6A3A0";
    ctx.fillRect(x + 1, y, 2, 1);
  }
}
function drawParentBird(ctx, parent, x, y, dir, wing, sleep, feeding) {
  const mom = parent.id === "mother",
    body = mom ? "#94664B" : "#4C65B8",
    light = mom ? "#C89D70" : "#7792DC",
    dark = mom ? "#593D31" : "#2B3D7C";
  const R = (dx, dy, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x + (dir > 0 ? dx : -dx - w + 1)), Math.round(y + dy), w, h);
  };
  if (wing) {
    // three distinct wing silhouettes make the slow beat legible at scene scale
    R(-4, -3, 8, 4, dark);
    R(-3, -4, 6, 4, body);
    R(-2, -2, 4, 2, light);
    R(-6, -3, 2, 1, dark);
    R(-7, -4, 2, 1, body);
    R(2, -6, 4, 4, body);
    R(3, -6, 2, 1, light);
    R(3, -3, 2, 1, "#D9C39A");
    R(5, -4, 2, 1, "#F2BF62");
    R(4, -5, 1, 1, "#162431");
    const phase = Math.floor((nowT * 5.5 + (mom ? 0 : 1.4)) % 3);
    if (phase === 0) {
      R(-3, -8, 3, 5, dark);
      R(-2, -10, 2, 3, light);
    } else if (phase === 1) {
      R(-4, -5, 6, 2, light);
      R(-6, -4, 3, 1, dark);
    } else {
      R(-3, -2, 4, 3, dark);
      R(-2, 0, 3, 2, light);
    }
    return;
  }
  // Perched birds stand tall with a slim breast, dropped tail, and head above the chicks.
  R(-3, -8, 6, 8, dark);
  R(-2, -9, 5, 8, body);
  R(-2, -7, 3, 5, light);
  R(-4, -6, 2, 5, dark);
  R(-5, -5, 1, 3, body);
  R(1, -13, 5, 5, dark);
  R(2, -13, 4, 4, body);
  R(2, -13, 2, 1, light);
  R(3, -10, 2, 1, mom ? "#E5C8A0" : "#D4DFF0");
  R(4, -12, 1, 1, sleep ? light : "#162431");
  R(5, feeding ? -9 : -10, 2, 1, "#F4C25F");
  R(6, feeding ? -8 : -9, 1, 1, "#D89841");
  R(-2, 0, 1, 2, "#A9734E");
  R(1, 0, 1, 2, "#A9734E");
}
function chicksBegging(t, nx, ny, night) {
  if (night > 0.6) return false;
  if (mother.state === "feed" || father.state === "feed") return true;
  const arriving = mother.state === "return" ? mother : father.state === "return" ? father : null;
  if (!arriving) return false;
  const p = birdFlightPos(arriving, t, nx, ny),
    homeX = nx + (arriving.id === "mother" ? -15 : 15);
  return Math.hypot(p.x - homeX, p.y - (ny - 4)) < 28;
}
function drawBirdFamily(ctx, t, nx, ny, snowCover, night) {
  // A woven bowl and projecting rim leave room for both parents and three individually animated chicks.
  ctx.fillStyle = "#3E2A24";
  ctx.fillRect(nx - 17, ny - 2, 35, 5);
  ctx.fillRect(nx - 14, ny + 3, 29, 2);
  ctx.fillRect(nx - 10, ny + 5, 21, 1);
  ctx.fillStyle = "#765036";
  ctx.fillRect(nx - 16, ny - 2, 33, 4);
  ctx.fillRect(nx - 13, ny + 2, 27, 2);
  ctx.fillStyle = "#AE7A4B";
  ctx.fillRect(nx - 17, ny - 3, 35, 2);
  ctx.fillRect(nx - 11, ny + 3, 6, 1);
  ctx.fillRect(nx + 3, ny + 3, 8, 1);
  ctx.fillStyle = "#C69860";
  [
    [-17, -4, 6],
    [-7, -5, 7],
    [5, -4, 10],
    [-14, 1, 4],
    [9, 2, 5],
  ].forEach(([dx, dy, w]) => ctx.fillRect(nx + dx, ny + dy, w, 1));
  ctx.fillStyle = "#503427";
  ctx.fillRect(nx - 19, ny, 5, 1);
  ctx.fillRect(nx + 14, ny + 1, 5, 1);
  if (snowCover) {
    ctx.fillStyle = "#EDF2F7";
    ctx.fillRect(nx - 17, ny - 5, 7, 1);
    ctx.fillRect(nx + 10, ny - 5, 7, 1);
  }

  const snuggle = birdFamily.mode === "snuggle";
  const asleep = night > 0.6,
    begging = chicksBegging(t, nx, ny, night);
  for (let i = 0; i < 3; i++) {
    const cx = nx - 7 + i * 6,
      gape = begging;
    const bob = asleep
      ? 0
      : gape
        ? 1 + (Math.sin(t * 7 + i * 2) > 0 ? 1 : 0)
        : Math.sin(t * 2.4 + i * 1.8) > 0.55
          ? 1
          : 0;
    const cy = ny - 4 - bob;
    ctx.fillStyle = "#A99E91";
    ctx.fillRect(cx - 1, cy + 1, 4, 3);
    ctx.fillStyle = "#D0BFA5";
    ctx.fillRect(cx, cy - 1, 3, 3);
    ctx.fillRect(cx + 1, cy - 2, 1, 1);
    if (gape) {
      // a small upward V, close to the head instead of a tall funnel
      ctx.fillStyle = "#F8C65C";
      ctx.fillRect(cx - 1, cy - 4, 1, 1);
      ctx.fillRect(cx + 3, cy - 4, 1, 1);
      ctx.fillRect(cx, cy - 3, 1, 2);
      ctx.fillRect(cx + 2, cy - 3, 1, 2);
      ctx.fillStyle = "#7F4050";
      ctx.fillRect(cx + 1, cy - 3, 1, 2);
      ctx.fillStyle = "#F8C65C";
      ctx.fillRect(cx, cy - 1, 3, 1);
    } else {
      ctx.fillStyle = "#E8B25C";
      ctx.fillRect(cx + 1, cy - 2, 2, 1);
      if (!asleep) {
        ctx.fillStyle = "#202635";
        ctx.fillRect(cx + 2, cy, 1, 1);
      }
    }
  }

  [mother, father].forEach(parent => {
    const mom = parent.id === "mother",
      flying =
        parent.state === "depart" ||
        parent.state === "return" ||
        parent.state === "heart" ||
        parent.state === "together";
    if (flying) {
      const p = birdFlightPos(parent, t, nx, ny);
      drawParentBird(ctx, parent, p.x, p.y, p.dir, true, false, false);
      if (parent.state === "return") drawBirdFood(ctx, p.x + (p.dir > 0 ? 7 : -11), p.y - 2, parent.food);
    } else if (parent.state === "search") {
      // the food hunt happens beyond the scene edge
      return;
    } else {
      const rubbing = snuggle ? Math.round(1.5 * Math.sin(t * 4 + (mom ? 0 : Math.PI))) : 0;
      const px = nx + (mom ? -15 : 15) + rubbing + (parent.state === "feed" || snuggle ? (mom ? 4 : -4) : 0);
      const py = ny - 4 + (snuggle ? Math.round(Math.sin(t * 4 + (mom ? 0 : 1))) : 0);
      drawParentBird(ctx, parent, px, py, mom ? 1 : -1, false, asleep, parent.state === "feed");
      if (parent.state === "feed" && t - parent.t0 < 2.8)
        drawBirdFood(ctx, nx + (mom ? -6 : 2), ny - 13 + Math.round(clamp((t - parent.t0) / 2.8) * 3), parent.food);
    }
  });
  ctx.fillStyle = "#C08D58";
  ctx.fillRect(nx - 16, ny + 1, 33, 1);
  ctx.fillStyle = "#5D3C2D";
  ctx.fillRect(nx - 13, ny + 4, 27, 1);
  if (snuggle && Math.sin(t * 3.1) > -0.5) {
    tinyBirdHeart(ctx, nx - 3, ny - 16 - Math.round((t * 2) % 5), "#D98C98");
    if (Math.sin(t * 1.8) > 0.2) tinyBirdHeart(ctx, nx + 10, ny - 18 - Math.round((t * 1.7) % 5), "#D9A1A2");
  }
  if (birdFamily.mode === "heart") {
    const elapsed = t - birdFamily.t0;
    for (let j = 1; j <= 24; j++) {
      const age = elapsed - j * 0.24;
      if (age < 1.7 || age > 8.3) continue;
      const theta = ((age - 1.7) * Math.PI * 2) / 6.6,
        hx = 16 * Math.pow(Math.sin(theta), 3),
        hy = -(13 * Math.cos(theta) - 5 * Math.cos(2 * theta) - 2 * Math.cos(3 * theta) - Math.cos(4 * theta));
      ctx.fillStyle = j % 2 ? "#B75F7B" : "#D68A9E";
      ctx.fillRect(Math.round(nx - 20 + hx * 2.45), Math.round(ny - 102 + hy * 1.32), 2, 2);
    }
  }
}
// ---------- the squirrel ----------
function squirrelSprite(ctx, t, startle) {
  const x = Math.round(squirrel.x),
    y = Math.round(squirrel.y - startle * 3),
    d = squirrel.dir,
    R = (vx, vy, w, h, col) => {
      ctx.fillStyle = col;
      ctx.fillRect(d > 0 ? x + vx : x + 5 - vx - w, y + vy, w, h);
    };
  if (squirrel.place === "trunk") {
    ctx.fillStyle = "#A0522D";
    ctx.fillRect(x, y - 5, 2, 4);
    ctx.fillRect(x, y - 7, 2, 2);
    ctx.fillStyle = "#8B4A2B";
    ctx.fillRect(x + 2, y - 3, 1, 4);
    ctx.fillStyle = "#1B2130";
    ctx.fillRect(x + 1, y - 6, 1, 1);
    return;
  }
  const airborne = squirrel.air > 1,
    looking = squirrel.act === "look",
    digging = squirrel.act === "dig" || squirrel.act === "cover";
  const noseDown = looking && Math.sin((t - squirrel.t0) * 5) > 0 ? 1 : 0;
  const tailLift = airborne ? 1 : Math.sin(t * 4) > 0.4 ? 1 : 0;
  R(0, -4, 4, 3, "#C4733A");
  R(0, -4, 2, 1, "#E09A52");
  R(3, -5 + noseDown, 3, 3, "#CB8042");
  R(4, -6 + noseDown, 1, 1, "#E8A65B");
  R(5, -4 + noseDown, 1, 1, "#192638");
  R(6, -3 + noseDown, 1, 1, "#F0C18B");
  R(-1, -5 - tailLift, 2, 3, "#8A492B");
  R(-3, -7 - tailLift, 2, 3, "#9D542C");
  R(-3, -8 - tailLift, 2, 1, "#C47A3D");
  if (airborne) {
    R(0, -1, 2, 1, "#7D4027");
    R(4, -2, 2, 1, "#7D4027");
  } else if (digging) {
    const paw = Math.sin(t * 12) > 0 ? -2 : -1;
    R(1, -1, 2, 1, "#7D4027");
    R(5, paw, 2, 1, "#C98245");
  } else {
    R(0, -1, 2, 1, "#7D4027");
    R(4, -1, 2, 1, "#7D4027");
  }
  if (squirrel.hasNut || squirrel.act === "nibble") {
    R(6, -2 + (squirrel.act === "nibble" && Math.sin(t * 9) > 0 ? -1 : 0), 2, 2, "#A16A37");
    R(6, -3, 2, 1, "#5B3C29");
  }
  if (looking && t - squirrel.t0 > 1.1) {
    R(9, -1, 2, 2, "#9B6435");
    R(9, -2, 2, 1, "#533625");
  }
  if (digging) {
    R(8, 0, 4, 1, "#49362C");
    R(9, -1, 2, 1, "#8F6746");
    if (squirrel.act === "dig" && Math.sin(t * 12) > 0) {
      R(10, -4, 2, 1, "#916744");
      R(12, -2, 1, 1, "#916744");
    }
  }
}
const squirrelSpot = () => Math.round(TREE.x - 17 + Math.random() * 55);
const SQUIRREL_BURY_PATCHES = [
  [628, 647],
  [691, 702],
]; // grass beside the roots, with room before the first bench
function squirrelBurySpot() {
  const last = squirrelBurrows.length ? squirrelBurrows[squirrelBurrows.length - 1].x : null;
  const patch =
    last == null
      ? Math.floor(Math.random() * 2)
      : Math.random() < 0.8
        ? last < TREE.x
          ? 1
          : 0
        : last < TREE.x
          ? 0
          : 1;
  const [low, high] = SQUIRREL_BURY_PATCHES[patch];
  let best = low,
    clearance = -1;
  for (let i = 0; i < 12; i++) {
    const x = low + Math.floor(Math.random() * (high - low + 1));
    const gap = squirrelBurrows.length ? Math.min(...squirrelBurrows.map(b => Math.abs(x - b.x))) : high - low;
    if (gap > clearance) {
      best = x;
      clearance = gap;
    }
  }
  return best;
}
function stepSquirrel(t, dt, sea) {
  const x = TREE.x,
    ty = groundY(x),
    illustrated = treeOak.complete && treeOak.naturalWidth,
    base = { x: x + HOLE.dx + (illustrated ? HOLE.oakDx : 0), y: ty };
  if (squirrel.place === "hole") {
    if (t >= squirrel.until) {
      const r = Math.random();
      if (r < 0.45) {
        squirrel.peek = !squirrel.peek;
        squirrel.until = t + 3 + Math.random() * 6;
      } else if (r < 0.7 && !wx.raining) {
        squirrel.place = "trunk";
        squirrel.climb = 0;
        squirrel.act = "down";
        squirrel.peek = false;
      } else {
        squirrel.peek = false;
        squirrel.until = t + 6 + Math.random() * 10;
      }
    }
    return;
  }
  if (squirrel.place === "trunk") {
    // climbing between the hole and the ground
    const speed = squirrel.flee ? 2.2 : 0.7;
    squirrel.climb += (squirrel.act === "down" ? 1 : -1) * speed * dt;
    squirrel.y = lerp(ty + HOLE.dy + 4, ty - 5, clamp(squirrel.climb));
    squirrel.x = base.x + (illustrated ? 0 : trunkBend((ty - squirrel.y) / TRUNK_H)) + 2;
    squirrel.dir = 1;
    if (squirrel.act === "down" && squirrel.climb >= 1) {
      squirrel.place = "ground";
      squirrel.y = squirrelGroundY(squirrel.x);
      squirrel.act = "seek";
      squirrel.target = squirrelSpot();
      squirrel.leap = null;
      squirrel.nextHopAt = t;
      squirrel.air = 0;
      squirrel.hasNut = false;
    }
    if (squirrel.act === "up" && squirrel.climb <= 0) {
      const frightened = squirrel.flee;
      squirrel.place = "hole";
      squirrel.flee = false;
      squirrel.peek = false;
      squirrel.leap = null;
      squirrel.air = 0;
      squirrel.hasNut = false;
      squirrel.until = t + (frightened ? 10 : 4) + Math.random() * 8;
    }
    return;
  }
  // Each bound has its own takeoff and landing. The pauses tell the nut-finding and burial story.
  if ((wx.raining || squirrel.flee) && squirrel.act !== "home") squirrel.act = "home";
  if (squirrel.act === "look" || squirrel.act === "nibble" || squirrel.act === "dig" || squirrel.act === "cover") {
    squirrel.air = 0;
    squirrel.y = squirrelGroundY(squirrel.x);
    if (squirrel.act === "look" && t >= squirrel.until) {
      const r = Math.random();
      if (r < 0.78) {
        squirrel.hasNut = true;
        squirrel.act = "carry";
        squirrel.target = squirrelBurySpot();
      } else if (r < 0.9) {
        squirrel.act = "nibble";
        squirrel.t0 = t;
        squirrel.until = t + 2.5;
      } else {
        squirrel.act = "seek";
        squirrel.target = squirrelSpot();
      }
    } else if (squirrel.act === "nibble" && t >= squirrel.until) {
      squirrel.act = Math.random() < 0.65 ? "seek" : "home";
      squirrel.target = squirrelSpot();
    } else if (squirrel.act === "dig" && t >= squirrel.until) {
      squirrel.act = "cover";
      squirrel.t0 = t;
      squirrel.until = t + 1.8;
      squirrel.hasNut = false;
    } else if (squirrel.act === "cover" && t >= squirrel.until) {
      squirrelBurrows.push({ x: Math.round(squirrel.x) });
      if (squirrelBurrows.length > 6) squirrelBurrows.shift();
      squirrel.act = Math.random() < 0.55 ? "seek" : "home";
      squirrel.target = squirrelSpot();
    }
    return;
  }
  const goal = squirrel.act === "home" ? base.x : squirrel.target;
  if (!squirrel.leap) {
    if (!squirrel.flee && t < squirrel.nextHopAt) {
      squirrel.air = 0;
      squirrel.y = squirrelGroundY(squirrel.x);
      return;
    }
    const dx = goal - squirrel.x;
    if (Math.abs(dx) < 2) {
      squirrel.x = goal;
      squirrel.y = squirrelGroundY(goal);
      squirrel.air = 0;
      if (squirrel.act === "home") {
        squirrel.place = "trunk";
        squirrel.climb = 1;
        squirrel.act = "up";
      } else if (squirrel.act === "carry") {
        squirrel.act = "dig";
        squirrel.t0 = t;
        squirrel.until = t + 2.4;
      } else {
        squirrel.act = "look";
        squirrel.t0 = t;
        squirrel.until = t + 2 + Math.random() * 1.4;
      }
      return;
    }
    const stride = Math.min(Math.abs(dx), squirrel.flee ? 16 + Math.random() * 6 : 7 + Math.random() * 5);
    squirrel.leap = {
      from: squirrel.x,
      to: squirrel.x + Math.sign(dx) * stride,
      t0: t,
      dur: squirrel.flee ? 0.33 : 0.34 + Math.random() * 0.11,
      peak: squirrel.flee ? 7 : 4 + Math.random() * 2,
    };
    squirrel.dir = Math.sign(dx);
  }
  const leap = squirrel.leap,
    p = clamp((t - leap.t0) / leap.dur),
    ease = p * p * (3 - 2 * p);
  squirrel.x = lerp(leap.from, leap.to, ease);
  squirrel.air = Math.round(leap.peak * Math.sin(Math.PI * p));
  squirrel.y = squirrelGroundY(squirrel.x) - squirrel.air;
  if (p >= 1) {
    squirrel.x = leap.to;
    squirrel.air = 0;
    squirrel.y = squirrelGroundY(squirrel.x);
    squirrel.leap = null;
    squirrel.nextHopAt = t + (squirrel.flee ? 0 : 0.08 + Math.random() * 0.12);
  }
}
// ---------- a visiting flock: down from the sky to perch around the lighthouse, off again together ----------
function flockSpots() {
  const ty = groundY(TREE.x),
    hy = groundY(842 + 31);
  return [
    { x: tx - 30, y: gy - 14 },
    { x: tx - 12, y: gy - 14 },
    { x: tx + 10, y: gy - 14 },
    { x: tx + 28, y: gy - 14 },
    { x: tx, y: top - 20 },
    { x: 842 + 18, y: hy - 49 },
    { x: 842 + 40, y: hy - 49 },
    { x: TREE.x - 27, y: ty - 112 },
    { x: TREE.x + 16, y: ty - 126 },
    { x: 552, y: 337 },
    { x: 236, y: 440 },
  ];
}
function stepFlock(t, dt, startled) {
  if (!flock) {
    if (dbg.flock || Math.random() < dt / 240) {
      dbg.flock = false;
      const spots = flockSpots()
        .sort(() => Math.random() - 0.5)
        .slice(0, 4 + Math.floor(Math.random() * 3));
      flock = {
        phase: "arrive",
        t0: t,
        until: t + 3.5,
        birds: spots.map((sp, i) => ({
          spot: sp,
          x0: sp.x - 150 + Math.random() * 300,
          delay: i * 0.35,
          hop: Math.random() * 6,
        })),
      };
    }
    return;
  }
  if (flock.phase === "arrive" && t >= flock.until) {
    flock.phase = "perch";
    flock.until = t + 20 + Math.random() * 20;
  } else if (flock.phase === "perch" && (t >= flock.until || startled)) {
    flock.phase = "leave";
    flock.t0 = t;
    flock.until = t + 2.6;
    flock.birds.forEach(b => {
      b.x1 = b.spot.x + (Math.random() - 0.5) * 200;
    });
  } else if (flock.phase === "leave" && t >= flock.until) flock = null;
}
function drawFlock(ctx, t, night) {
  if (!flock) return;
  const col = "#E6EDF2",
    dark = night > 0.6 ? "#93A3B0" : "#4A5568";
  flock.birds.forEach((b, i) => {
    if (flock.phase === "perch") {
      const hop = Math.sin(t * 1.3 + b.hop) > 0.92 ? 1 : 0,
        look = Math.sin(t * 0.7 + b.hop) > 0 ? 1 : -1;
      ctx.fillStyle = col;
      ctx.fillRect(b.spot.x - 1, b.spot.y - 2 - hop, 3, 2);
      ctx.fillRect(b.spot.x + look, b.spot.y - 3 - hop, 1, 1);
      ctx.fillStyle = dark;
      ctx.fillRect(b.spot.x - 1 - (look > 0 ? 0 : 0), b.spot.y - 2 - hop, 1, 1);
      ctx.fillStyle = "#F2A93B";
      ctx.fillRect(b.spot.x + look * 2, b.spot.y - 3 - hop, 1, 1);
      return;
    }
    const arriving = flock.phase === "arrive",
      k = clamp((t - flock.t0 - (arriving ? b.delay : 0)) / 2.4),
      kk = arriving ? k : 1 - k;
    const x = Math.round(lerp(arriving ? b.x0 : b.x1, b.spot.x, kk)),
      y = Math.round(lerp(-12, b.spot.y - 2, kk) - Math.sin(kk * Math.PI) * 10),
      up = Math.sin(t * 9 + i) > 0;
    ctx.fillStyle = col;
    ctx.fillRect(x - 1, y, 3, 1);
    ctx.fillRect(x - 4, up ? y - 2 : y + 1, 3, 1);
    ctx.fillRect(x + 2, up ? y - 2 : y + 1, 3, 1);
    ctx.fillStyle = dark;
    ctx.fillRect(x - 3, up ? y - 2 : y + 1, 1, 1);
    ctx.fillRect(x + 3, up ? y - 2 : y + 1, 1, 1);
  });
}
