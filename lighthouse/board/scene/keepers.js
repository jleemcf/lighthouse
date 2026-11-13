// The scene in parts (see core.js). This part: the animals' running state, the letter in a bottle, the keepers' day
// (outside, in the tower, and in an alarm), the butterflies and the cat, and where a climber is on the stairs.

// ---------- the animals' running state ----------
const squirrel = {
  place: "hole",
  peek: false,
  x: 0,
  y: 0,
  dir: 1,
  act: "hide",
  until: 4,
  t0: 0,
  target: 0,
  flee: false,
  climb: 0,
  leap: null,
  nextHopAt: 0,
  air: 0,
  hasNut: false,
};
const squirrelBurrows = [];
const squirrelGroundY = x => groundY(x) - 5; // paws and caches sit on the grass, above the cliff's dark face
// The parents share one itinerary: only one leaves for food at a time. Short paired flights and
// cuddles interrupt the foraging cycle, while the next food trip always belongs to the other bird.
const mother = { id: "mother", state: "nest", t0: 0, until: 0, food: "worm" };
const father = { id: "father", state: "nest", t0: 0, until: 0, food: "caterpillar" };
const birdFamily = { mode: "rest", until: 0, t0: 0, event: 0, trips: 0 };
let flock = null; // a visiting group of birds: arriving from above, perched around the lighthouse, leaving together

// ---------- the letter in a bottle, and the keepers' day ----------
function drawBottle(ctx, x, y, s, o) {
  // a green bottle standing on (x, y), s pixels to the unit, tilted by o.tilt radians about its foot
  const tilt = (o && o.tilt) || 0;
  if (tilt) {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(tilt);
    x = 0;
    y = 0;
  }
  const R = (vx, vy, w, h, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(
      Math.round(x + vx * s),
      Math.round(y + vy * s),
      Math.max(1, Math.round(w * s)),
      Math.max(1, Math.round(h * s)),
    );
  };
  R(-2, -8, 4, 8, "#3E8E5A");
  R(-2, -8, 1, 8, "#2E6E45");
  R(0, -7, 1, 5, "#8FD1A6");
  if (!o || !o.noPaper) R(-1, -6, 2, 4, "#F4EBD3");
  R(-1, -11, 2, 3, "#3E8E5A");
  if (!o || !o.noCork) R(-1, -12, 2, 1, "#8B7355");
  if (tilt) ctx.restore();
}
function stepBottle(b, dt, wind) {
  // the bottle meanders on the sea, drawn to Owner only slowly
  b.age += dt;
  const pull = 0.02 + 0.5 * clamp(b.age / 420);
  b.ang += (rnd(Math.floor(b.age * 0.7), 95) - 0.5) * 1.6 * dt + Math.sin(b.age * 0.13) * 0.4 * dt;
  const dx = HOME.x - b.x,
    dy = HOME.y - b.y,
    dist = Math.hypot(dx, dy) || 1;
  let vx = Math.cos(b.ang) * 5 + (dx / dist) * 5 * pull - wind * 2,
    vy = Math.sin(b.ang) * 2.5 + (dy / dist) * 5 * pull;
  let nx = b.x + vx * dt,
    ny = b.y + vy * dt;
  if (nx < 16 || nx > 600 || EDGE[Math.round(nx)] < ny + 4) {
    b.ang += Math.PI * 0.7;
    nx = b.x;
  }
  if (ny < HZ + 26 || ny > H - 8) {
    b.ang = -b.ang;
    ny = b.y;
  }
  b.x = nx;
  b.y = ny;
  if (dist < 9 && b.age > 60) b.arrived = true;
}
// small far off, growing as it nears
const bottleScale = b => 0.6 + 2 * Math.pow(clamp((b.y - (HZ + 26)) / (H - 8 - (HZ + 26))), 1.3);
let pair = null; // two keepers talking or playing catch
const keepers = {};
const keeper = (id, i) =>
  keepers[id] ||
  (keepers[id] = {
    id,
    i,
    place: i % 2 ? "gallery" : "ground",
    x: i % 2 ? tx - 10 + i * 8 : 660 + i * 50,
    y: 0,
    act: "rest",
    until: 0,
    target: 0,
    dir: 1,
    phase: null,
    alarmed: false,
    t0: 0,
    sweat: [],
    hearts: [],
    moving: false,
    stair: null,
    cup: false,
    chair: null,
    here: false,
  });
const free = k => k.here && k.place === "ground" && !k.phase && ["walk", "rest", "coffee"].includes(k.act);
const towerClaimed = k =>
  k.here &&
  (k.place === "gallery" ||
    k.place === "lantern" ||
    k.place === "stairs" ||
    (k.place === "door" && k.act === "enter") ||
    (k.place === "ground" && k.act === "toDoor"));
const towerHasRoom = k => Object.values(keepers).filter(o => o !== k && towerClaimed(o)).length < 2;
const galleryPeers = k => Object.values(keepers).filter(o => o !== k && o.here && o.place === "gallery" && !o.phase);
const galleryStation = k => {
  const peer = galleryPeers(k)[0];
  if (peer) return (peer.target || peer.x) < tx ? GAL[1] - 10 : GAL[0] + 10;
  return Math.random() < 0.5 ? GAL[0] + 10 : GAL[1] - 10;
};
function leave(k) {
  if (k.chair) {
    k.chair.by = null;
    k.chair = null;
  }
  k.cup = false;
  if (cat.petBy === k.id) cat.petBy = null;
  if (pair && (pair.a === k.id || pair.b === k.id)) endPair();
  if (noteBy === k.id) noteBy = null;
}
function endPair() {
  // after an argument the two stalk off in opposite directions
  if (!pair) return;
  const p = pair;
  pair = null;
  [p.a, p.b].forEach((id, i) => {
    const o = keepers[id];
    if (!o || o.act !== "pair") return;
    if (p.kind === "argue") {
      o.act = "walk";
      o.target = Math.max(GL, Math.min(GR, o.x + (i ? 1 : -1) * (40 + Math.random() * 40)));
    } else {
      o.act = "rest";
      o.until = 0;
    }
  });
}
function startPair(kind, a, b, now) {
  // talk, catch, or (rarely) an argument that may come to blows
  const cx = Math.max(GL + 30, Math.min(GR - 30, (a.x + b.x) / 2)),
    gap = kind === "catch" ? 26 : kind === "argue" ? 8 : 7;
  leave(b);
  const until = now + (kind === "talk" ? 12 : kind === "argue" ? 4 : 14) + Math.random() * (kind === "argue" ? 2 : 10);
  pair = {
    kind,
    a: a.id,
    b: b.id,
    cx,
    until,
    ball: { at: a.id, t0: now, flying: false, from: a.id, to: b.id },
    speaker: a.id,
    spoke: now,
    on: false,
    fight: kind === "argue" && Math.random() < 0.5,
    fightUntil: until + 3 + Math.random() * 1.5,
    fighting: false,
  };
  a.act = "pair";
  a.target = cx - gap;
  b.act = "pair";
  b.target = cx + gap;
}
function stepBall(p, now) {
  const b = p.ball;
  if (!b.flying && now - b.t0 > 0.5) {
    b.flying = true;
    b.from = b.at;
    b.to = b.at === p.a ? p.b : p.a;
    b.t0 = now;
  } else if (b.flying && now - b.t0 > 0.9) {
    b.flying = false;
    b.at = b.to;
    b.t0 = now;
  }
}
function plan(k, now) {
  // what to do next, by where they are; about half the day outside, half in the tower
  leave(k);
  const r = Math.random(),
    dur = (a, b) => now + a + Math.random() * (b - a),
    roam = () => {
      k.act = "walk";
      k.target = GL + Math.random() * (GR - GL);
    };
  if (k.place === "ground") {
    const mate = !pair ? Object.values(keepers).find(o => o !== k && free(o)) : null;
    if (dbg.sit) {
      const c = CHAIRS.find(c => !c.by);
      if (c) {
        dbg.sit = false;
        c.by = k.id;
        k.chair = c;
        k.act = "toChair";
        k.target = c.x + 6;
        k.cup = true;
      }
    } // debug({sit: true}) sends the next planner to a bench
    else if (dbg.bottle || (!bottle && !noteBy && !throwing && !wx.raining && Math.random() < 0.02)) {
      dbg.bottle = false;
      noteBy = k.id;
      k.act = "toWrite";
      k.target = WRITE_X;
    } // a letter for Owner, now and then
    else if (dbg.pair && mate) {
      const kind = dbg.pair;
      dbg.pair = null;
      startPair(kind, k, mate, now);
    } // debug({pair: "argue"}) forces the next pairing
    else if (r < 0.2) roam();
    else if (r < 0.3) {
      k.act = "rest";
      k.until = dur(4, 9);
    } else if (r < 0.4) {
      const c = CHAIRS.find(c => !c.by);
      if (c) {
        c.by = k.id;
        k.chair = c;
        k.act = "toChair";
        k.target = c.x + 6;
        k.cup = Math.random() < 0.5;
      } else {
        k.act = "rest";
        k.until = dur(3, 6);
      }
    } else if (r < 0.47) {
      if (wx.raining) roam();
      else {
        k.act = "toLay";
        k.target = GL + 20 + Math.random() * (GR - GL - 40);
      }
    } else if (r < 0.55) {
      k.act = "coffee";
      k.cup = true;
      k.until = dur(8, 14);
    } else if (r < 0.65) {
      if (mate) startPair(Math.random() < 0.06 ? "argue" : "talk", k, mate, now);
      else roam();
    } // one talk in sixteen turns into an argument
    else if (r < 0.73) {
      if (mate) startPair("catch", k, mate, now);
      else {
        k.act = "rest";
        k.until = dur(3, 6);
      }
    } else if (r < 0.8) {
      if (
        !cat.petBy &&
        cat.act !== "sleep" &&
        !Object.values(keepers).some(o => o !== k && o.here && o.act === "toCat")
      )
        k.act = "toCat";
      else roam();
    } else if (towerHasRoom(k)) k.act = "toDoor";
    else roam();
  } else if (k.place === "gallery") {
    const peers = galleryPeers(k),
      lanternBusy = Object.values(keepers).some(
        o => o !== k && o.here && (o.place === "lantern" || (o.place === "gallery" && o.act === "toLantern")),
      );
    const jobs = ["spy", "polish", "sweep", "signal", "weather", "lean"].filter(
      job => !peers.some(o => o.act === job) && (job !== "sweep" || !peers.length),
    );
    const station = galleryStation(k);
    if (peers.length >= 2)
      k.act = "toStairs"; // alarms may fill the deck; normal work thins back out
    else if (r < 0.12) {
      k.act = "walk";
      k.target = station;
    } else if (r < 0.78 && jobs.length) {
      k.act = jobs[Math.floor(Math.random() * jobs.length)];
      k.target = station;
      k.until = dur(8, 16);
      if (k.act === "sweep") {
        k.sweepBounds = station < tx ? [GAL[0] + 6, tx - 7] : [tx + 7, GAL[1] - 6];
        k.target = k.sweepBounds[0];
      }
    } else if (r < 0.9 && !lanternBusy) k.act = "toLantern";
    else k.act = "toStairs";
    k.t0 = now;
  } else if (k.place === "lantern") {
    if (r < 0.6) {
      k.act = "work";
      k.until = dur(8, 16);
      k.target = LAN[0] + Math.random() * (LAN[1] - LAN[0]);
    } else {
      k.place = "gallery";
      k.x = tx - 2;
      plan(k, now);
    }
  }
}
function stepKeeper(k, need, now, dt) {
  const speed = k.phase ? 70 : 24;
  const walkTo = target => {
    const d = target - k.x;
    if (Math.abs(d) <= speed * dt) {
      k.x = target;
      return true;
    }
    k.x += Math.sign(d) * speed * dt;
    k.dir = Math.sign(d);
    k.moving = true;
    return false;
  };
  k.moving = false;
  k.sweat = k.sweat.filter(s => (s.life -= dt) > 0);
  k.sweat.forEach(s => {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += 90 * dt;
  });
  k.hearts = k.hearts.filter(s => (s.life -= dt) > 0);
  k.hearts.forEach(s => {
    s.y -= 14 * dt;
    s.x += Math.sin(now * 5 + s.life * 8) * 8 * dt;
  });
  if (k.place === "stairs") {
    // climbing, seen through the wall
    const st = k.stair;
    if (need && !k.phase) {
      k.phase = "run";
      st.up = true;
      st.dur = 1.6;
    }
    st.p += ((st.up ? 1 : -1) * dt) / st.dur;
    if (st.up && st.p >= 1) {
      k.place = "lantern";
      k.x = tx - 2;
      k.stair = null;
      k.act = "rest";
      k.until = now + 0.3;
    } else if (!st.up && st.p <= 0) {
      k.place = "door";
      k.x = DOOR;
      k.act = "exit";
      k.t0 = now;
      k.stair = null;
    }
    return;
  }
  if (k.place === "door") {
    // stepping in or out while the door stands open
    const a = now - k.t0,
      T = k.phase ? 0.5 : 0.9;
    if (a >= T) {
      if (k.act === "enter") {
        k.place = "stairs";
        k.stair = { p: 0, up: true, dur: k.phase ? 1.6 : 9 };
      } else {
        k.place = "ground";
        k.act = "rest";
        k.until = now + 0.5;
      }
    }
    return;
  }
  // the alarm: something needs Owner
  if (need && !k.phase) {
    leave(k);
    k.phase = "jump";
    k.t0 = now;
    k.until = now + 1.2;
  }
  if (!need && k.phase && k.phase !== "relief") {
    k.phase = "relief";
    k.t0 = now;
    k.until = now + 2;
    k.alarmed = false;
  }
  if (k.phase === "jump") {
    if (now >= k.until) k.phase = "run";
    return;
  }
  if (k.phase === "run") {
    if (k.place === "ground") {
      if (walkTo(DOOR)) {
        k.place = "door";
        k.act = "enter";
        k.t0 = now;
      }
    } else if (k.place === "gallery") {
      if (walkTo(tx - 2)) k.place = "lantern";
    } else if (walkTo(tx + 3)) {
      k.phase = "hit";
      k.t0 = now;
      k.until = now + 0.9;
      k.dir = 1;
    }
    return;
  }
  if (k.phase === "hit") {
    if (now >= k.until) {
      k.alarmed = true;
      k.phase = "panic";
      k.place = "gallery";
      k.x = tx - 2;
      k.target = GAL[1];
    }
    return;
  }
  if (k.phase === "panic") {
    if (walkTo(k.target)) k.target = k.target > tx ? GAL[0] : GAL[1];
    if (Math.random() < dt * 3)
      k.sweat.push({
        x: k.x + 2,
        y: k.y - 12,
        vx: (Math.random() - 0.5) * 40,
        vy: -30 - Math.random() * 20,
        life: 0.7,
      });
    return;
  }
  if (k.phase === "relief") {
    if (now >= k.until) {
      k.phase = null;
      k.act = "rest";
      k.until = now + 1;
    }
    return;
  }
  // the day
  switch (k.act) {
    case "walk":
      if (walkTo(k.target)) plan(k, now);
      break;
    case "rest":
    case "coffee":
    case "lay":
    case "sit":
      if (now >= k.until) plan(k, now);
      break;
    case "spy":
    case "polish":
    case "signal":
    case "weather":
    case "lean":
      walkTo(k.target);
      if (now >= k.until) plan(k, now);
      break;
    case "sweep":
      if (!k.sweepBounds) k.sweepBounds = [GAL[0] + 6, tx - 7];
      if (walkTo(k.target)) k.target = k.target === k.sweepBounds[0] ? k.sweepBounds[1] : k.sweepBounds[0];
      if (now >= k.until) plan(k, now);
      break;
    case "work":
      walkTo(k.target);
      if (now >= k.until) plan(k, now);
      break;
    case "toChair":
      if (walkTo(k.target)) {
        k.act = "sit";
        k.until = now + 12 + Math.random() * 12;
        k.dir = 1;
      }
      break;
    case "toLay":
      if (walkTo(k.target)) {
        k.act = "lay";
        k.until = now + 12 + Math.random() * 8;
      }
      break;
    case "toCat": {
      const side = k.x < cat.x ? -1 : 1;
      if (walkTo(cat.x + side * 8)) {
        if (cat.petBy || cat.act === "sleep") plan(k, now);
        else {
          cat.petBy = k.id;
          cat.dir = -side;
          k.act = "pet";
          k.until = now + 5 + Math.random() * 3;
          k.dir = -side;
        }
      }
      break;
    }
    case "pet":
      if (Math.random() < dt * 2.5) k.hearts.push({ x: cat.x + 2, y: cat.y - 9, life: 1.2 });
      if (now >= k.until) plan(k, now);
      break;
    case "pair": {
      if (!pair) {
        plan(k, now);
        break;
      }
      const arrived = walkTo(k.target);
      if (arrived) k.dir = k.id === pair.a ? 1 : -1;
      if (k.id === pair.a) {
        // the one who asked runs the session once both are there
        const b = keepers[pair.b],
          both = arrived && b && b.act === "pair" && Math.abs(b.x - b.target) < 0.5;
        if (both) {
          pair.on = true;
          if (pair.kind !== "catch" && now - pair.spoke > (pair.kind === "argue" ? 0.8 : 1.4)) {
            pair.speaker = pair.speaker === pair.a ? pair.b : pair.a;
            pair.spoke = now;
          }
          if (pair.kind === "catch") stepBall(pair, now);
          if (now >= pair.until) {
            if (pair.fight && now < pair.fightUntil) pair.fighting = true;
            else {
              endPair();
              plan(k, now);
            }
          }
        } else if (now > pair.until + 8) {
          endPair();
          plan(k, now);
        }
      }
      break;
    }
    case "toWrite":
      if (walkTo(k.target)) {
        k.act = "write";
        k.t0 = now;
        k.until = now + 13 + Math.random() * 4;
        k.dir = 1;
      }
      break; // thinking, then the idea, then writing
    case "write":
      if (now >= k.until) {
        k.act = "bottle";
        k.until = now + 2.5;
        k.t0 = now;
      }
      break;
    case "bottle":
      if (now >= k.until) {
        k.act = "toToss";
        k.target = TOSS_X;
      }
      break;
    case "toToss":
      if (walkTo(k.target)) {
        k.act = "toss";
        k.until = now + 1;
        k.dir = -1;
        const L = window.LighthouseLetters || ["Weather report: yes."];
        const others = facts.boards
          .filter(b => b !== k.id)
          .map(b => facts.label(b))
          .join(" and ");
        throwing = {
          t0: now,
          from: { x: k.x, y: k.y - 12 },
          who: k.id,
          text: L[Math.floor(Math.random() * L.length)]
            .replace(/\{name\}/g, facts.label(k.id))
            .replace(/\{others\}/g, others),
        };
      }
      break;
    case "toss":
      if (now >= k.until) {
        noteBy = null;
        plan(k, now);
      }
      break;
    case "toDoor":
      if (walkTo(DOOR)) {
        k.place = "door";
        k.act = "enter";
        k.t0 = now;
      }
      break;
    case "toStairs":
      if (walkTo(tx - 2)) {
        k.place = "stairs";
        k.stair = { p: 1, up: false, dur: 9 };
      }
      break;
    case "toLantern":
      if (walkTo(tx - 2)) {
        k.place = "lantern";
        k.act = "work";
        k.until = now + 8 + Math.random() * 8;
        k.target = LAN[0] + Math.random() * (LAN[1] - LAN[0]);
      }
      break;
    default:
      plan(k, now);
  }
}
function spawnButterfly(now, edge) {
  const fromTop = edge === "top" || (!edge && Math.random() < 0.4);
  const firstX = 715 + Math.random() * 160,
    secondX = 680 + Math.random() * 205;
  const points = fromTop
    ? [
        { x: 665 + Math.random() * 220, y: -18 },
        { x: firstX, y: groundY(firstX) - 37 },
        { x: secondX, y: groundY(secondX) - 24 },
        { x: W + 18, y: groundY(W) - 45 },
      ]
    : [
        { x: W + 18, y: groundY(W) - 45 },
        { x: firstX, y: groundY(firstX) - 26 },
        { x: secondX, y: groundY(secondX) - 32 },
        { x: secondX + 30, y: -18 },
      ];
  const b = {
    id: ++butterflySerial,
    t0: now,
    x: points[0].x,
    y: points[0].y,
    points,
    legs: fromTop ? [9, 12, 9] : [7, 12, 9],
    hue: Math.random() < 0.5 ? 0 : 1,
    flutter: Math.random() * Math.PI * 2,
    chaseDecided: false,
    flee: null,
  };
  butterflies.push(b);
  return b;
}
function butterflyPosition(b, now) {
  if (b.flee) {
    const k = clamp((now - b.flee.t0) / b.flee.duration);
    return {
      x: lerp(b.flee.x, b.flee.toX, k) + (1 - k) * Math.sin(now * 9 + b.flutter) * 2,
      y: lerp(b.flee.y, -18, k) + (1 - k) * Math.sin(now * 14 + b.flutter) * 3,
    };
  }
  let age = Math.max(0, now - b.t0),
    leg = 0;
  while (leg < b.legs.length - 1 && age > b.legs[leg]) age -= b.legs[leg++];
  const k = clamp(age / b.legs[leg]),
    from = b.points[leg],
    to = b.points[leg + 1];
  const wobble = Math.sin(now * 9 + b.flutter) * 2 + Math.sin(now * 3.7 + b.flutter) * 2;
  return {
    x: lerp(from.x, to.x, k) + wobble,
    y: lerp(from.y, to.y, k) + Math.sin(now * 14 + b.flutter) * 3 + Math.sin(now * 6 + b.flutter) * 2,
  };
}
function stepButterflies(now, dt, night) {
  const fair = !wx.raining && night < 0.4;
  if (fair && now >= nextButterflyAt) {
    spawnButterfly(now);
    nextButterflyAt = now + 70 + Math.random() * 45;
    if (Math.random() < 0.45) companionButterflyAt = now + 2 + Math.random() * 2;
  }
  if (fair && now >= companionButterflyAt) {
    spawnButterfly(now);
    companionButterflyAt = Infinity;
  }
  if (!fair) {
    companionButterflyAt = Infinity;
    if (now >= nextButterflyAt) nextButterflyAt = now + 30;
  }
  for (let i = butterflies.length - 1; i >= 0; i--) {
    const b = butterflies[i];
    if (!fair && !b.flee) b.flee = { t0: now, x: b.x, y: b.y, toX: b.x + (b.x < 800 ? -24 : 24), duration: 3.5 };
    const p = butterflyPosition(b, now);
    b.x = p.x;
    b.y = p.y;
    if (b.flee ? now >= b.flee.t0 + b.flee.duration : now >= b.t0 + b.legs.reduce((a, n) => a + n, 0)) {
      butterflies.splice(i, 1);
      continue;
    }
    if (
      !b.chaseDecided &&
      !b.flee &&
      now - b.t0 > 5 &&
      b.x > GL + 12 &&
      b.x < GR - 8 &&
      Math.abs(b.x - cat.x) < 80 &&
      Math.abs(b.y - (groundY(b.x) - 28)) < 45
    ) {
      b.chaseDecided = true;
      if (!cat.petBy && ["sit", "walk", "stretch"].includes(cat.act) && Math.random() < 0.13) {
        cat.act = "butterfly";
        cat.t0 = now;
        cat.until = now + 6 + Math.random() * 2;
        cat.targetButterflyId = b.id;
      }
    }
  }
}
function stepCat(now, dt, night) {
  cat.moving = false;
  cat.leap = 0;
  if (cat.petBy) {
    cat.targetButterflyId = null;
    cat.y = groundY(cat.x);
    return;
  }
  if (wx.raining) {
    // under the tree until it stops
    cat.targetButterflyId = null;
    if (cat.act !== "shelter") {
      const d = TREE.x + 4 - cat.x;
      if (Math.abs(d) <= 20 * dt) {
        cat.x = TREE.x + 4;
        cat.act = "shelter";
        cat.dir = -1;
      } else {
        cat.x += Math.sign(d) * 20 * dt;
        cat.dir = Math.sign(d);
        cat.moving = true;
        cat.act = "walk";
      }
    }
    cat.y = groundY(cat.x);
    return;
  }
  if (cat.act === "shelter") catPlan(now, night);
  if (cat.act === "chase") {
    // after the squirrel, until it makes the tree
    cat.targetButterflyId = null;
    const d = squirrel.x - cat.x;
    if (squirrel.place !== "ground") {
      cat.act = "sit";
      cat.until = now + 4;
      cat.dir = Math.sign(TREE.x - cat.x) || 1;
    } else {
      cat.x += Math.sign(d) * 46 * dt;
      cat.dir = Math.sign(d) || cat.dir;
      cat.moving = true;
      if (Math.abs(d) < 60) squirrel.flee = true;
    }
    cat.y = groundY(cat.x);
    return;
  }
  if (cat.act === "butterfly") {
    const b = butterflies.find(item => item.id === cat.targetButterflyId);
    if (!b || b.flee || now >= cat.until || night > 0.5) {
      cat.targetButterflyId = null;
      cat.act = "sit";
      cat.until = now + 3;
    } else {
      const d = b.x - cat.x,
        age = now - cat.t0;
      cat.dir = Math.sign(d) || cat.dir;
      if (Math.abs(d) > 6) {
        cat.x = Math.max(GL + 8, Math.min(GR - 8, cat.x + Math.sign(d) * Math.min(Math.abs(d), 30 * dt)));
        cat.moving = true;
      }
      const pounce = (age - 0.45) % 2.25;
      if (age > 0.45 && Math.abs(d) < 43 && pounce < 0.95)
        cat.leap = Math.round(11 * Math.sin((Math.PI * pounce) / 0.95));
      cat.y = groundY(cat.x);
      return;
    }
  }
  if (
    (cat.act === "walk" || cat.act === "sit" || cat.act === "stretch") &&
    squirrel.place === "ground" &&
    !squirrel.flee &&
    Math.abs(squirrel.x - cat.x) < 110 &&
    Math.random() < dt * 0.25
  ) {
    cat.act = "chase";
    return;
  }
  if (cat.act === "walk") {
    const d = cat.target - cat.x;
    if (Math.abs(d) <= 14 * dt) {
      cat.x = cat.target;
      catPlan(now, night);
    } else {
      cat.x += Math.sign(d) * 14 * dt;
      cat.dir = Math.sign(d);
      cat.moving = true;
    }
  } else if (now >= cat.until) catPlan(now, night);
  cat.y = groundY(cat.x);
}
function catPlan(now, night) {
  const r = Math.random();
  cat.t0 = now;
  cat.targetButterflyId = null;
  if (r < 0.36) {
    cat.act = "walk";
    cat.target = GL + Math.random() * (GR - GL);
  } else if (r < 0.57) {
    cat.act = "sit";
    cat.until = now + 3 + Math.random() * 4;
  } else if (r < 0.76) {
    cat.act = "sleep";
    cat.until = now + 8 + Math.random() * 8;
  } else if (r < 0.87) {
    cat.act = "stretch";
    cat.until = now + 2.5 + Math.random();
  } else {
    cat.act = "groom";
    cat.until = now + 5 + Math.random() * 3;
  }
}
function drawButterflies(ctx, t) {
  butterflies.forEach(b => {
    const x = Math.round(b.x),
      y = Math.round(b.y),
      beat = Math.floor(t * 22 + b.flutter) % 3;
    const light = b.hue ? "#DDB4CE" : "#F0D186",
      dark = b.hue ? "#A77CA8" : "#C99B65";
    ctx.fillStyle = dark;
    ctx.fillRect(x, y - 1, 1, 2);
    ctx.fillStyle = light;
    if (beat === 0) {
      ctx.fillRect(x - 2, y - 3, 2, 2);
      ctx.fillRect(x + 1, y - 3, 2, 2);
    } else if (beat === 1) {
      ctx.fillRect(x - 2, y - 1, 2, 1);
      ctx.fillRect(x + 1, y - 1, 2, 1);
    } else {
      ctx.fillRect(x - 1, y - 2, 1, 2);
      ctx.fillRect(x + 1, y - 2, 1, 2);
    }
  });
}
const stairPos = p => {
  // where on the zigzag of flights a climber is, p from the door (0) to the lantern floor (1)
  const N = 6,
    y0 = groundY(tx) - 6,
    y1 = top + 40,
    f = Math.min(N - 1, Math.floor(p * N)),
    k = p * N - f;
  const y = lerp(lerp(y0, y1, f / N), lerp(y0, y1, (f + 1) / N), k),
    hw = 16 + (12 * (y - top)) / (base - top) - 6,
    dir = f % 2 === 0 ? 1 : -1;
  return { x: tx + dir * lerp(-hw, hw, k) - 2, y, dir };
};
