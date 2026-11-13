// The scene in parts (see core.js). This part: window.LighthouseScene, what the page calls: attach the page's facts,
// start the scene, switch lite mode, poke it when the page changes, open the bottle on a click, and the debug hooks
// and stats for inspection.

window.LighthouseScene = {
  attach(f) {
    facts = f;
    nextLamp();
  },
  syncBoards() {
    const boards = facts ? facts.boards : [];
    for (const id of Object.keys(keepers))
      if (!boards.includes(id)) {
        leave(keepers[id]);
        delete keepers[id];
        bottle = null;
        throwing = null;
      }
    if (bottle && !boards.includes(bottle.from)) bottle = null;
    if (throwing && !boards.includes(throwing.who)) throwing = null;
  },
  start() {
    if (sceneOn) {
      this.poke();
      return;
    }
    sceneOn = true;
    lastTs = 0;
    gen++;
    clearTimeout(sceneTimer);
    nextScene();
  },
  // lite mode on or off, at once (the page keeps the choice per device)
  setLite(on) {
    on = !!on;
    if (on === lite) return;
    lite = on;
    gen++;
    lampGen++;
    clearTimeout(sceneTimer);
    clearTimeout(lampTimer);
    lampLast = 0;
    nextLamp();
    if (sceneOn) nextScene();
  },
  lite() {
    return lite;
  },
  // the page changed (an ask came in, someone went on shift): in lite mode, draw now rather than at the minute
  poke() {
    if (!lite) return;
    const wait = 3000 - (Date.now() - pokedAt);
    if (wait > 0) {
      if (!pokeTimer)
        pokeTimer = setTimeout(() => {
          pokeTimer = 0;
          this.poke();
        }, wait);
      return;
    }
    pokedAt = Date.now();
    gen++;
    lampGen++;
    clearTimeout(sceneTimer);
    clearTimeout(lampTimer);
    // now, not at the minute
    lampTimer = later(lampFrame, lampGen, 0);
    if (sceneOn) sceneTimer = later(sceneFrame, gen, 0);
  },
  hit(x, y) {
    if (!bottle || bottle.phase !== "float" || !bottle.arrived) return false;
    const s = bottleScale(bottle);
    return x >= bottle.x - 3 * s && x <= bottle.x + 3 * s && y >= bottle.y - 13 * s && y <= bottle.y + 2;
  },
  click(x, y) {
    if (!this.hit(x, y)) return false;
    bottle.phase = "open";
    bottle.t0 = nowT;
    return true;
  },
  debug(o) {
    dbg = o || {};
    if (dbg.squirrelOut && squirrel.place === "hole") {
      squirrel.place = "trunk";
      squirrel.climb = 0;
      squirrel.act = "down";
      squirrel.peek = false;
    }
    if (dbg.catAct) {
      cat.act = dbg.catAct;
      cat.x = dbg.catX || 850;
      cat.y = groundY(cat.x);
      cat.t0 = nowT;
      cat.until = nowT + 20;
      cat.targetButterflyId = null;
      if (dbg.catAct === "butterfly") {
        const b = spawnButterfly(nowT - 9, "right");
        b.points[1] = { x: cat.x + 18, y: cat.y - 23 };
        b.points[2] = { x: cat.x - 12, y: cat.y - 28 };
        const p = butterflyPosition(b, nowT);
        b.x = p.x;
        b.y = p.y;
        cat.targetButterflyId = b.id;
      }
    }
    if (dbg.squirrelAct) {
      squirrel.place = "ground";
      squirrel.act = dbg.squirrelAct;
      squirrel.x = dbg.squirrelX || 705;
      squirrel.y = squirrelGroundY(squirrel.x);
      squirrel.t0 = nowT;
      squirrel.until = nowT + 12;
      squirrel.leap = null;
      squirrel.nextHopAt = nowT;
      squirrel.air = 0;
      squirrel.hasNut = dbg.squirrelAct === "carry" || dbg.squirrelAct === "dig";
      squirrel.target = squirrelBurySpot();
    }
    if (dbg.motherOut && birdFamily.mode === "rest") birdFamily.until = 0;
    if (dbg.birdScene) {
      // deterministic art inspection without waiting through the family itinerary
      const scene = dbg.birdScene,
        solo = scene === "depart" || scene === "search" || scene === "return" || scene === "feed";
      const parent = dbg.birdParent === "father" ? father : mother,
        companion = parent === mother ? father : mother;
      birdFamily.mode = solo ? "forage" : scene;
      birdFamily.t0 = nowT;
      birdFamily.until = nowT + (scene === "heart" ? 10 : scene === "together" ? 6 : scene === "snuggle" ? 9 : 16);
      parent.state = solo || scene === "heart" || scene === "together" || scene === "snuggle" ? scene : "nest";
      companion.state = solo ? "nest" : parent.state;
      parent.t0 = scene === "return" ? nowT - foodFlight(parent).duration + 1.7 : nowT;
      parent.until =
        nowT +
        (scene === "feed" ? 3.5 : scene === "return" ? 1.7 : scene === "search" ? 12 : foodFlight(parent).duration);
    }
    if (dbg.bottleNow && bottle && bottle.phase === "float") {
      bottle.x = HOME.x;
      bottle.y = HOME.y;
      bottle.arrived = true;
      bottle.age = 999;
    }
    if (dbg.ground)
      Object.values(keepers).forEach(k => {
        if (!k.phase) {
          leave(k);
          k.place = "ground";
          k.stair = null;
          k.act = "rest";
          k.until = 0;
          k.x = GL + Math.random() * (GR - GL);
        }
      });
    if (dbg.gallery && facts && facts.boards.length) {
      // inspect the little deck jobs without waiting for the planner
      const k = keeper(facts.boards[0], 0);
      leave(k);
      k.here = true;
      k.place = "gallery";
      k.x = GAL[0] + 15;
      k.target = k.x;
      k.act = dbg.gallery;
      k.phase = null;
      k.until = nowT + 20;
      k.t0 = nowT;
    }
  },
  stats() {
    const r = pirateRoute(nowT),
      n = navyVisit(nowT),
      k = krakenVisit(nowT),
      skyCat = skyCatState();
    const s = {
      fireworks: fw.shots.length,
      traders: traders.length,
      frames: stat.frames,
      avgMs: stat.frames ? +(stat.ms / stat.frames).toFixed(2) : 0,
      keepers: {},
      cat: {
        act: cat.act,
        x: Math.round(cat.x),
        leap: cat.leap,
        butterfly: cat.targetButterflyId !== null,
        butterflies: butterflies.length,
        petBy: cat.petBy,
      },
      skyCat: { index: skyCat.index, alpha: +skyCat.alpha.toFixed(2) },
      pair: pair ? { kind: pair.kind, a: pair.a, b: pair.b, on: pair.on } : null,
      door: +door.open.toFixed(2),
      bottle: bottle
        ? {
            phase: bottle.phase,
            x: Math.round(bottle.x),
            y: Math.round(bottle.y),
            age: Math.round(bottle.age),
            arrived: bottle.arrived,
            from: bottle.from,
          }
        : null,
      noteBy,
      throwing: !!throwing,
      leaves: leaves.length,
      squirrel: {
        place: squirrel.place,
        act: squirrel.act,
        x: Math.round(squirrel.x),
        air: squirrel.air,
        nut: squirrel.hasNut,
        buried: squirrelBurrows.length,
        peek: squirrel.peek,
        flee: squirrel.flee,
      },
      mother: mother.state,
      father: father.state,
      birdFamily: { mode: birdFamily.mode, trips: birdFamily.trips },
      flock: flock ? flock.phase : null,
      pirate: { x: Math.round(r.x), y: Math.round(r.y), scale: +r.scale.toFixed(2), heading: +r.heading.toFixed(2) },
      navy: n ? { phase: +n.phase.toFixed(1), cower: n.cower, flag: +n.compliance.toFixed(2) } : null,
      kraken: k ? { phase: +k.phase.toFixed(1), reach: +k.reach.toFixed(2), fight: +k.fight.toFixed(2) } : null,
      traffic: seaTraffic.map(tr => tr.route),
    };
    Object.keys(keepers).forEach(id => {
      const k = keepers[id];
      s.keepers[id] = {
        place: k.place,
        act: k.act,
        phase: k.phase,
        x: Math.round(k.x),
        here: k.here,
        alarmed: k.alarmed,
        stair: k.stair ? +k.stair.p.toFixed(2) : null,
      };
    });
    stat.frames = 0;
    stat.ms = 0;
    return s;
  },
};
