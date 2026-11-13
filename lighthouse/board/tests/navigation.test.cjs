const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { test } = require("node:test");

// The scene is a browser IIFE. Evaluate it with inert canvases, then expose only
// its route functions so the same geometry used by the renderer is exercised.
let source = require("./scene-source.cjs")();
const end = source.lastIndexOf("})();");
assert.ok(end > 0);
source =
  source.slice(0, end) +
  ("window.probe={seaEncounter,navyVisit,navyShips,krakenVisit,pirateRoute,trafficState,seaTraffic,seaTrafficShips," +
    "launchTraffic,hullsTouch,stepBirdFamily,birdFlightPos,chicksBegging,birdFamily,mother,father,spawnButterfly," +
    "stepButterflies,butterflies,stepCat,cat,stepSquirrel,squirrelBurySpot,squirrel,squirrelBurrows,wx,groundY," +
    "setDebug:o=>{dbg=o;}};") +
  source.slice(end);

function scene(seed) {
  let value = seed;
  const seededMath = Object.create(Math);
  seededMath.random = () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
  const context = {
    window: {},
    document: { createElement: () => ({ getContext: () => ({}) }), currentScript: null },
    Image: class {
      constructor() {
        this.complete = false;
      }
    },
    URL,
    location: { href: "http://localhost/" },
    performance: { now: () => 0 },
    requestAnimationFrame: () => {},
    Math: seededMath,
  };
  vm.runInNewContext(source, context);
  return context.window.probe;
}

test("bird parents alternate occasional offscreen food trips and share flights and nest time", () => {
  const p = scene(17),
    departures = [],
    feeds = [],
    moments = new Set();
  let previousMother = "nest",
    previousFather = "nest";
  for (let t = 0; t < 2100; t += 0.25) {
    p.stepBirdFamily(t, 0);
    moments.add(p.birdFamily.mode);
    assert.ok(!(p.mother.state === "depart" && p.father.state === "depart"), "only one parent should forage");
    if (p.mother.state === "depart" && previousMother !== "depart") departures.push("mother");
    if (p.father.state === "depart" && previousFather !== "depart") departures.push("father");
    if (
      (p.mother.state === "feed" && previousMother !== "feed") ||
      (p.father.state === "feed" && previousFather !== "feed")
    )
      feeds.push(t);
    previousMother = p.mother.state;
    previousFather = p.father.state;
  }
  assert.ok(departures.length >= 8, "both parents should make repeated food trips");
  departures.forEach((bird, i) => assert.equal(bird, i % 2 ? "father" : "mother"));
  assert.ok(moments.has("together") && moments.has("heart") && moments.has("snuggle"));
  for (let i = 1; i < feeds.length; i++)
    assert.ok(feeds[i] - feeds[i - 1] > 70, "feedings should leave long quiet gaps");
  p.mother.state = "depart";
  p.mother.t0 = 0;
  const a = p.birdFlightPos(p.mother, 2, 713, 320),
    b = p.birdFlightPos(p.mother, 3, 713, 320);
  assert.ok(Math.abs(a.x - b.x) > 100, "the food trip should travel briskly");
  assert.ok(p.birdFlightPos(p.mother, 6.2, 713, 320).x < -30, "mother should disappear beyond the left edge");
  p.father.state = "depart";
  p.father.t0 = 0;
  assert.ok(p.birdFlightPos(p.father, 3.1, 713, 320).x > 990, "father should disappear beyond the right edge");
  p.mother.state = "return";
  p.mother.t0 = 20;
  assert.ok(p.birdFlightPos(p.mother, 20, 713, 320).x < -30, "return should begin offscreen");
  assert.equal(p.birdFlightPos(p.mother, 26.2, 713, 320).x, 698, "return should reach the nest");
  p.birdFamily.mode = "heart";
  p.birdFamily.t0 = 100;
  p.mother.state = "heart";
  const launch = p.birdFlightPos(p.mother, 100, 713, 320),
    land = p.birdFlightPos(p.mother, 110, 713, 320);
  assert.deepEqual(
    [launch.x, launch.y, land.x, land.y],
    [698, 316, 698, 316],
    "the dance should begin and end at the nest",
  );
});

test("chicks beg only as a food-carrying parent reaches the nest and feeds", () => {
  const p = scene(23),
    nx = 713,
    ny = 320;
  p.birdFamily.mode = "forage";
  p.mother.state = "search";
  assert.equal(p.chicksBegging(3, nx, ny, 0), false, "waiting through the hunt should be quiet");
  p.mother.state = "return";
  p.mother.t0 = 0;
  p.mother.until = 6.2;
  assert.equal(p.chicksBegging(5, nx, ny, 0), false, "a distant parent should not trigger begging");
  assert.equal(p.chicksBegging(6.15, nx, ny, 0), true, "begging starts at the nest");
  p.mother.state = "feed";
  assert.equal(p.chicksBegging(6.5, nx, ny, 0), true, "mouths remain open while feeding");
  p.mother.state = "nest";
  p.father.state = "return";
  p.father.t0 = 0;
  p.father.until = 3.1;
  assert.equal(p.chicksBegging(3.05, nx, ny, 0), true, "either parent may prompt the chicks");
  assert.equal(p.chicksBegging(3.05, nx, ny, 1), false, "sleeping chicks remain tucked in");
  p.father.state = "nest";
  assert.equal(p.chicksBegging(7, nx, ny, 0), false, "begging stops after the meal");
});

test("butterflies enter and leave offscreen independently of the cat", () => {
  const p = scene(7),
    right = p.spawnButterfly(0, "right"),
    top = p.spawnButterfly(0, "top");
  assert.ok(right.x > 960 && top.y < 0, "each route begins outside the scene");
  assert.ok(right.points.at(-1).y < 0 && top.points.at(-1).x > 960, "each route finishes outside the scene");
  let rightSeen = false,
    topSeen = false;
  for (let frame = 0; frame <= 301; frame++) {
    const t = frame / 10;
    p.stepButterflies(t, 0.1, 0);
    rightSeen ||= right.x > 680 && right.x < 940 && right.y > 0 && right.y < 380;
    topSeen ||= top.x > 650 && top.x < 940 && top.y > 0 && top.y < 380;
  }
  assert.ok(rightSeen && topSeen, "both routes should cross the visible island sky");
  assert.ok(
    !p.butterflies.includes(right) && !p.butterflies.includes(top),
    "each butterfly should exit before removal",
  );
  assert.equal(p.cat.act, "sit", "butterfly visits should not depend on cat activity");
  const rain = p.spawnButterfly(31, "right");
  p.stepButterflies(35, 0.1, 0);
  p.wx.raining = true;
  p.stepButterflies(35.1, 0.1, 0);
  assert.ok(p.butterflies.includes(rain), "rain should send the butterfly away instead of erasing it");
  for (let t = 35.2; t <= 39; t += 0.1) p.stepButterflies(t, 0.1, 0);
  assert.ok(!p.butterflies.includes(rain), "the butterfly should leave above the frame");
});

test("cat reaches and swipes during rare butterfly chases", () => {
  const p = scene(11),
    b = p.spawnButterfly(0, "right");
  p.cat.x = 810;
  p.cat.y = p.groundY(810);
  p.cat.act = "butterfly";
  p.cat.t0 = 0;
  p.cat.until = 7;
  p.cat.targetButterflyId = b.id;
  b.x = 820;
  b.y = p.groundY(820) - 25;
  let highest = 0;
  for (let t = 0; t < 6; t += 0.05) {
    p.stepCat(t, 0.05, 0);
    highest = Math.max(highest, p.cat.leap);
  }
  assert.ok(highest >= 9, "cat should make a high, upright jump");
  p.wx.raining = true;
  p.stepCat(6, 0.05, 0);
  assert.equal(p.cat.targetButterflyId, null, "rain should interrupt the chase");

  const visits = scene(21),
    seen = new Set();
  let chases = 0,
    previous = "sit";
  for (let t = 0; t < 2800; t += 0.2) {
    visits.stepButterflies(t, 0.2, 0);
    visits.stepCat(t, 0.2, 0);
    visits.butterflies.forEach(item => seen.add(item.id));
    if (visits.cat.act === "butterfly" && previous !== "butterfly") chases++;
    previous = visits.cat.act;
  }
  assert.ok(seen.size >= 25, "butterflies should regularly visit the scene");
  assert.ok(chases > 0, "the cat should occasionally pursue a butterfly");
  assert.ok(chases < seen.size / 3, "most butterflies should pass without a chase");
});

test("squirrel bounds between nut search, carrying, digging, and covered caches", () => {
  const p = scene(9),
    s = p.squirrel,
    seen = new Set();
  s.place = "ground";
  s.act = "seek";
  s.x = 675;
  s.y = p.groundY(s.x);
  s.target = 731;
  let peak = 0,
    longestHop = 0;
  for (let t = 0; t < 210; t += 0.05) {
    p.stepSquirrel(t, 0.05, "summer");
    seen.add(s.act);
    peak = Math.max(peak, s.air);
    if (s.leap && !s.flee) longestHop = Math.max(longestHop, Math.abs(s.leap.to - s.leap.from));
    assert.ok(s.place !== "ground" || (s.x >= 616 && s.x <= 764), "nut route should stay on the island grass");
  }
  assert.ok(peak >= 4, "short travel should still have a clear airborne arc");
  assert.ok(longestHop <= 12, "ordinary bounds should be short");
  for (const phase of ["look", "carry", "dig", "cover"]) assert.ok(seen.has(phase), `missing ${phase} phase`);
  assert.ok(p.squirrelBurrows.length > 0, "covered acorns should leave small earth patches");
  assert.ok(
    p.squirrelBurrows.every(b => (b.x >= 628 && b.x <= 647) || (b.x >= 691 && b.x <= 702)),
    "caches should stay in the safe tree-side patches",
  );

  const choices = scene(19),
    locations = [];
  for (let i = 0; i < 30; i++) {
    const x = choices.squirrelBurySpot();
    locations.push(x);
    choices.squirrelBurrows.push({ x });
    if (choices.squirrelBurrows.length > 6) choices.squirrelBurrows.shift();
  }
  assert.ok(
    locations.some(x => x < 670) && locations.some(x => x > 680),
    "the squirrel should cache on both sides of the roots",
  );
  assert.ok(new Set(locations).size >= 12, "burial spots should vary within the grass patches");
});

test("navy crossing is slow and rare", () => {
  const p = scene(1),
    start = Array.from({ length: 12000 }, (_, t) => t).find(t => p.navyVisit(t));
  assert.ok(Number.isFinite(start));
  assert.ok(!p.navyVisit(start + 300));
  const first = p.navyShips(start + 50, p.navyVisit(start + 50))[0],
    second = p.navyShips(start + 51, p.navyVisit(start + 51))[0];
  assert.ok(Math.abs(second.x - first.x) < 7, "fleet should advance less than 7 pixels per second");
});

test("navy and kraken have separate rare windows", () => {
  const p = scene(1);
  let navy = 0,
    kraken = 0,
    previous = null;
  for (let t = 0; t < 86400; t++) {
    const n = p.navyVisit(t),
      k = p.krakenVisit(t);
    assert.ok(!(n && k), `both events appeared at second ${t}`);
    const kind = n ? "navy" : k ? "kraken" : null;
    if (kind && kind !== previous) {
      if (kind === "navy") navy++;
      else kraken++;
    }
    previous = kind;
  }
  assert.ok(navy > 0 && navy < 28, `navy appeared ${navy} times in a day`);
  assert.ok(kraken > 0 && kraken < 20, `kraken appeared ${kraken} times in a day`);
  p.setDebug({ navyPhase: 20, krakenPhase: 20 });
  assert.ok(p.krakenVisit(0) && !p.navyVisit(0), "even simultaneous preview requests choose one event");
});

test("kraken wraps the pirate in open water, then retreats", () => {
  const p = scene(1),
    start = Array.from({ length: 18000 }, (_, t) => t).find(t => p.krakenVisit(t));
  assert.ok(Number.isFinite(start));
  assert.equal(p.krakenVisit(start + 3).surface, 0, "the creature should begin beneath the waterline");
  assert.ok(p.krakenVisit(start + 8).surface > 0, "the mantle should emerge first");
  assert.ok(
    p.krakenVisit(start + 30).reach > 0.9 && p.krakenVisit(start + 30).fight > 0.9,
    "the arms should grip during the struggle",
  );
  assert.ok(p.krakenVisit(start + 50).drivenOff > 0.8, "the crew should drive it off");
  assert.ok(p.krakenVisit(start + 68).reach === 0, "the tentacles should release the ship");
  assert.equal(p.krakenVisit(start + 72), null, "the creature should vanish below the sea");
  for (let t = start; t < start + 72; t++)
    assert.ok(p.pirateRoute(t).x < 430, "the fight should stay clear of the headland");
});

test("the pirate keeps sailing during the navy visit instead of spinning in a holding circle", () => {
  const p = scene(1),
    start = Array.from({ length: 12000 }, (_, t) => t).find(t => p.navyVisit(t)),
    routes = [];
  for (let t = start + 26; t <= start + 274; t++) routes.push(p.pirateRoute(t));
  const xs = routes.map(r => r.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 300, "navy evasion should retain a broad course");
  let reversals = 0,
    last = 0;
  for (const r of routes) {
    const side = r.heading > 0.28 ? 1 : r.heading < -0.28 ? -1 : 0;
    if (side && last && side !== last) reversals++;
    if (side) last = side;
  }
  assert.ok(reversals <= 2, "ship should only turn at the ends of its course");
});

test("every passing route enters and leaves entirely offscreen", () => {
  for (const route of ["cross", "approach", "depart", "arc"]) {
    const p = scene(23);
    assert.ok(p.launchTraffic(0, route));
    const tr = p.seaTraffic[0],
      start = p.trafficState(tr, 0),
      end = p.trafficState(tr, tr.dur);
    if (tr.dir > 0) {
      assert.ok(start.x + 60 * start.scale < 0, `${route} starts visible at left edge`);
      assert.ok(end.x - 60 * end.scale > 960, `${route} ends visible at right edge`);
    } else {
      assert.ok(start.x - 60 * start.scale > 960, `${route} starts visible at right edge`);
      assert.ok(end.x + 60 * end.scale < 0, `${route} ends visible at left edge`);
    }
    assert.equal(p.trafficState(tr, tr.dur / 2).opacity, 1, `${route} should remain solid while crossing`);
  }
});

test("passing hulls keep clear of each other, the pirate, the kraken, and the navy", () => {
  const routesSeen = new Set();
  for (const seed of [3, 11, 29, 47, 83, 131]) {
    const p = scene(seed);
    const seen = new Set();
    for (let t = 0; t < 7200; t += 0.5) {
      p.seaTrafficShips(t);
      // Extra launches stress the planner with denser traffic than the live scene.
      if (t % 85 === 0 && p.seaTraffic.length < 2) p.launchTraffic(t);
      p.seaTraffic.forEach(tr => seen.add(tr));
      const pirate = p.pirateRoute(t);
      const vessels = [{ x: pirate.x, y: pirate.y, beam: 68 * pirate.scale, draft: 11 * pirate.scale, type: "pirate" }];
      for (const tr of p.seaTraffic) {
        const s = p.trafficState(tr, t);
        if (s.k > 0 && s.k < 1 && s.opacity > 0.12)
          vessels.push({ x: s.x, y: s.y, beam: 40 * s.scale, draft: 7 * s.scale, type: "traffic" });
      }
      for (const n of p.navyShips(t, p.navyVisit(t)))
        if (n.opacity > 0.12) vessels.push({ x: n.x, y: n.y, beam: 83 * n.scale, draft: 12 * n.scale, type: "navy" });
      if (p.krakenVisit(t)) {
        const squid = {
          x: pirate.x + 48 * pirate.scale,
          y: pirate.y,
          beam: 150 * pirate.scale,
          draft: 48 * pirate.scale,
        };
        for (const visitor of vessels.filter(v => v.type === "traffic"))
          assert.ok(!p.hullsTouch(squid, visitor), `seed ${seed}, second ${t}: visitor touches the kraken`);
      }
      for (let i = 0; i < vessels.length; i++)
        for (let j = i + 1; j < vessels.length; j++) {
          assert.ok(
            !p.hullsTouch(vessels[i], vessels[j]),
            `seed ${seed}, second ${t}: ${vessels[i].type} touches ${vessels[j].type}`,
          );
        }
    }
    assert.ok(seen.size >= 15, `seed ${seed}: route check should still allow traffic (launched ${seen.size})`);
    seen.forEach(tr => routesSeen.add(tr.route));
  }
  for (const route of ["cross", "approach", "depart", "arc"])
    assert.ok(routesSeen.has(route), `${route} route should remain possible`);
});
