// The Lighthouse scene, in simple pixel art: the view from up at the lantern room, looking a little down at the sea.
// The sky follows the real time of day; a wide green rocky headland with irregular cliffs, exposed rocks, a small
// sandy inlet and waves breaking around the shore; the keeper's house at the tower's foot; big slow clouds; gulls alone
// and in flocks; sea rocks with waves crashing into them; a big pirate ship with its crew for firstmate; the beam
// circling horizontally, one shape from the lamp to the spot where it lands; the operators living a day half on the
// island (chairs, coffee, lying in the grass, talking, playing catch, petting the cat) and half in the tower (the door
// opens for them, the tower turns see-through while they climb the stairs), and the alarm routine when something needs
// Owner. 960x540 on a canvas the page scales up. Also the header's small lighthouse and the operator sprites beside
// each board's shift chip. Exposed as window.LighthouseScene.
//
// The script is in parts, listed in order in parts.txt. The page build (server/make-page.py) joins them into the body
// of one function, so they share one scope: a part may use what an earlier part declares, and the order matters where
// a value is used as the script loads.
//
// This part: the scene's running state and pace, its size, colour helpers, the time of day and the season, and still
// layers drawn once and reused.
let facts = null,
  sceneOn = false,
  lastTs = 0,
  nowT = 0,
  dbg = {},
  stat = { frames: 0, ms: 0 }; // dbg: {hour, need, presence} overrides for inspection
// The pace. The scene draws 30 times a second and the header's lighthouse and operators 12, whatever the screen's own
// rate. In lite mode, a switch on each device, they draw once a minute and when the page changes: the time of day, the
// weather and who is on shift still show, without the motion. gen retires a loop that a switch replaced.
const SCENE_MS = 1000 / 30,
  LAMP_MS = 1000 / 12,
  LITE_MS = 60000;
let lite = false,
  gen = 0,
  sceneTimer = 0,
  lampTimer = 0,
  lampLast = 0,
  lampGen = 0,
  pokedAt = 0,
  pokeTimer = 0;
const later = (fn, g, wait) =>
  wait ? setTimeout(() => requestAnimationFrame(ts => fn(ts, g)), wait) : (requestAnimationFrame(ts => fn(ts, g)), 0);
const nextScene = () => {
  sceneTimer = later(sceneFrame, gen, lite ? LITE_MS : 0);
};
const nextLamp = () => {
  lampTimer = later(lampFrame, lampGen, lite ? LITE_MS : 0);
};
function sceneFrame(ts, g) {
  if (g !== gen) return;
  if (!lite && lastTs && ts - lastTs < SCENE_MS - 4) {
    const cv = document.getElementById("scene");
    if (!cv || !facts || !facts.isHome()) {
      sceneOn = false;
      return;
    }
    nextScene();
    return;
  }
  drawScene(ts);
}
function lampFrame(ts, g) {
  if (g !== lampGen) return;
  if (!lite && lampLast && ts - lampLast < LAMP_MS - 4) {
    nextLamp();
    return;
  }
  lampLast = ts;
  drawLamp(ts);
}
const W = 960,
  H = 540,
  HZ = 300;
const rnd = (i, k) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const lerp = (a, b, k) => a + (b - a) * k,
  mix = (c1, c2, k) => c1.map((v, i) => Math.round(lerp(v, c2[i], k))),
  rgb = c => "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
const rgba = (c, a) => "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
const clamp = v => Math.max(0, Math.min(1, v));
const shade = (c, k) => c.map(v => Math.max(0, Math.min(255, Math.round(v * k))));
const cyl = (u, o) => {
  const s = u + (o || 0) + 0.3;
  return 0.55 + 0.55 * Math.sqrt(Math.max(0, 1 - s * s));
}; // a cylinder lit from the left
const PAL = [
  // hour of the day (ET): sky top, sky bottom, sea, daylight 0..1
  [0, [7, 12, 24], [16, 26, 46], [10, 20, 36], 0],
  [4.5, [7, 12, 24], [18, 28, 50], [10, 20, 36], 0],
  [6, [46, 40, 90], [235, 120, 70], [28, 42, 74], 0.35],
  [7.5, [110, 150, 210], [255, 200, 150], [40, 90, 130], 0.8],
  [10, [80, 150, 225], [190, 220, 240], [34, 105, 150], 1],
  [15, [70, 140, 220], [200, 225, 240], [30, 100, 145], 1],
  [18, [120, 120, 190], [255, 160, 80], [40, 80, 120], 0.8],
  [19.5, [90, 34, 74], [235, 72, 55], [44, 40, 84], 0.4],
  [21, [14, 18, 40], [30, 34, 70], [16, 26, 48], 0.05],
  [24, [7, 12, 24], [16, 26, 46], [10, 20, 36], 0],
];
function palette(h) {
  let i = 0;
  while (i < PAL.length - 2 && PAL[i + 1][0] <= h) i++;
  const a = PAL[i],
    b = PAL[i + 1],
    k = clamp((h - a[0]) / (b[0] - a[0]));
  return { top: mix(a[1], b[1], k), bot: mix(a[2], b[2], k), sea: mix(a[3], b[3], k), light: lerp(a[4], b[4], k) };
}
// The configured business clock is read every few seconds, not every frame, to spare slower machines.
let etFmt = null,
  etZone = null,
  etAt = -1e9,
  etVal = 0;
function etHour() {
  const now = Date.now();
  const zone = facts?.timeZone || "UTC";
  if (zone === etZone && now - etAt < 5000) return etVal;
  etFmt =
    (zone === etZone && etFmt) ||
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
  const p = etFmt.formatToParts(new Date(now));
  etZone = zone;
  const g = t => Number((p.find(x => x.type === t) || {}).value || 0);
  etAt = now;
  return (etVal = (g("hour") % 24) + g("minute") / 60);
}
function season(d) {
  const md = (d.getMonth() + 1) * 100 + d.getDate();
  return md >= 1221 || md < 320 ? "winter" : md < 621 ? "spring" : md < 922 ? "summer" : "autumn";
}
// a disc's rows as one path, built once per radius and filled in one call; the same pixels as a fillRect per row
const discPaths = new Map();
function disc(ctx, x, y, r) {
  if (typeof Path2D === "undefined") {
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.floor(Math.sqrt(r * r - dy * dy));
      ctx.fillRect(Math.round(x - w), Math.round(y + dy), w * 2 + 1, 1);
    }
    return;
  }
  let p = discPaths.get(r);
  if (!p) {
    p = new Path2D();
    for (let k = 0, dy = -r; dy <= r; k++, dy++) {
      const w = Math.floor(Math.sqrt(r * r - dy * dy));
      p.rect(-w, k, w * 2 + 1, 1);
    }
    if (discPaths.size > 200) discPaths.clear();
    discPaths.set(r, p);
  }
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y - r));
  ctx.fill(p);
  ctx.restore();
}
// a still part of the picture, drawn once into a canvas of its own and reused while what it shows (its key) holds;
// paint draws it in the scene's own coordinates
const layers = {};
function layer(ctx, name, key, x, y, w, h, paint) {
  const L = layers[name] || (layers[name] = { cv: document.createElement("canvas"), key: null });
  if (L.key !== key) {
    L.cv.width = w;
    L.cv.height = h;
    const c = L.cv.getContext("2d");
    c.translate(-x, -y);
    paint(c);
    L.key = key;
  }
  ctx.drawImage(L.cv, x, y);
}
