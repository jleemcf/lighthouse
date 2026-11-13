// The scene in parts (see core.js). This part: the marks the keepers walk between, the island's running state (the
// bottle, the cat, the butterflies, the tree's place, the weather), the oak's picture, and the cats in the clouds.

// ---------- the keepers' lives ----------
const GL = 616,
  GR = 946,
  DOOR = tx - 2,
  GAL = [tx - 31, tx + 27],
  LAN = [tx - 13, tx + 3];
const CHAIRS = [
  { x: 716, by: null },
  { x: 748, by: null },
  { x: 928, by: null },
];
const WRITE_X = 640,
  TOSS_X = 622,
  LAND = { x: 552, y: 416 },
  HOME = { x: 150, y: 506 }; // where a letter is written, thrown from, lands, and finally waits for Owner
// one bottle at a time; whoever is writing; a bottle in the air; then the leaves and petals
let bottle = null,
  noteBy = null,
  throwing = null;
const leaves = [];
const door = { open: 0, want: 0 };
const cat = {
  x: 880,
  y: 0,
  dir: -1,
  act: "sit",
  until: 0,
  t0: 0,
  target: 880,
  petBy: null,
  moving: false,
  leap: 0,
  targetButterflyId: null,
};
const butterflies = [];
let nextButterflyAt = 35 + Math.random() * 35,
  companionButterflyAt = Infinity,
  butterflySerial = 0;
// the giant tree's place; the weather's running state
const TREE = { x: 672 },
  wx = { raining: false, jump: 0, bolt: null, lastSnow: 0 };
// The illustrated oak supplies the dense leaf work and hand-shaped bark in leaf season.
const treeOak = new Image();
const treeOakUrl = "tree-oak.png"; // replaced with an embedded data URL in the self-hosted page
treeOak.src = treeOakUrl.startsWith("data:")
  ? treeOakUrl
  : new URL(treeOakUrl, (document.currentScript && document.currentScript.src) || location.href).href;
// the four cats that appear in the clouds, each replaced with an embedded data URL in the self-hosted page
const skyCatUrls = ["cat-sky-1.png", "cat-sky-2.png", "cat-sky-3.png", "cat-sky-4.png"];
const skyCats = skyCatUrls.map(url => {
  const img = new Image();
  img.src = url.startsWith("data:")
    ? url
    : new URL(url, (document.currentScript && document.currentScript.src) || location.href).href;
  return img;
});
const cloudCats = new Array(skyCats.length);
function cloudCat(index) {
  // keep each face's markings, but make every daylight pixel a warm piece of cloud
  if (cloudCats[index]) return cloudCats[index];
  const img = skyCats[index],
    cv = document.createElement("canvas");
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const ink = cv.getContext("2d");
  ink.drawImage(img, 0, 0);
  const pixels = ink.getImageData(0, 0, cv.width, cv.height),
    d = pixels.data;
  for (let y = 0; y < cv.height; y++)
    for (let x = 0; x < cv.width; x++) {
      const p = (y * cv.width + x) * 4;
      if (!d[p + 3]) continue;
      const value = clamp((d[p] * 0.25 + d[p + 1] * 0.65 + d[p + 2] * 0.1) / 255);
      const wisp = rnd(Math.floor(x / 4) + index * 13, Math.floor(y / 4) + 97) - 0.5;
      const light = clamp(0.1 + value * 0.9 + wisp * 0.14);
      d[p] = lerp(202, 249, light);
      d[p + 1] = lerp(187, 245, light);
      d[p + 2] = lerp(151, 228, light);
    }
  ink.putImageData(pixels, 0, 0);
  return (cloudCats[index] = cv);
}
const skyCatFeatures = [
  {
    eyes: [
      [33, 55],
      [63, 55],
    ],
    nose: [48, 71],
    ears: [
      [10, 11],
      [84, 11],
    ],
    chin: [48, 87],
  },
  {
    eyes: [
      [35, 50],
      [63, 50],
    ],
    nose: [49, 67],
    ears: [
      [14, 12],
      [82, 12],
    ],
    chin: [48, 88],
  },
  {
    eyes: [
      [32, 54],
      [65, 54],
    ],
    nose: [49, 72],
    ears: [
      [12, 10],
      [83, 10],
    ],
    chin: [49, 86],
  },
  {
    eyes: [
      [34, 56],
      [64, 56],
    ],
    nose: [49, 73],
    ears: [
      [14, 13],
      [82, 13],
    ],
    chin: [49, 86],
  },
];
function skyCatState() {
  const slot = 88,
    clock = Date.now() / 1000,
    turn = Math.floor(clock / slot),
    seconds = clock % slot;
  const index =
    dbg.catSkyIndex == null
      ? ((turn % skyCats.length) + skyCats.length) % skyCats.length
      : Math.max(0, Math.min(skyCats.length - 1, Math.floor(dbg.catSkyIndex)));
  const phase = dbg.catSkyPhase == null ? seconds : clamp(dbg.catSkyPhase) * slot;
  const ease = v => {
    const k = clamp(v);
    return k * k * (3 - 2 * k);
  };
  return { index, alpha: ease(phase / 13) * ease((slot - phase) / 15) };
}
function drawSkyCat(ctx, t, night, grey) {
  const state = skyCatState(),
    img = skyCats[state.index];
  if (!img.complete || !img.naturalWidth || state.alpha < 0.002) return;
  const glimmer = state.alpha * (1 - grey * 0.62),
    dayMix = clamp((0.7 - night) / 0.45),
    nightMix = clamp((night - 0.25) / 0.45);
  const x = Math.round(506 + Math.sin(t * 0.12 + state.index) * 5),
    y = Math.round(94 + Math.sin(t * 0.18 + state.index * 2) * 3),
    size = 128;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = rgba([249, 228, 174], (0.025 * glimmer * dayMix).toFixed(3));
  disc(ctx, x + size / 2, y + size / 2, 78);
  if (dayMix) {
    ctx.fillStyle = rgba([246, 244, 222], (0.07 * glimmer * dayMix).toFixed(3));
    [
      [18, 96, 19],
      [43, 110, 17],
      [91, 105, 19],
      [119, 88, 15],
      [65, 17, 12],
    ].forEach(([px, py, radius]) => disc(ctx, x + px, y + py, radius));
    ctx.globalAlpha = glimmer * dayMix * 0.62;
    ctx.drawImage(cloudCat(state.index), x, y, size, size);
  }
  if (nightMix) {
    ctx.filter = "brightness(0) invert(1)";
    ctx.globalAlpha = glimmer * nightMix * 0.13;
    ctx.drawImage(img, x - 3, y - 3, size + 6, size + 6);
    ctx.filter = "none";
    ctx.globalAlpha = glimmer * nightMix * 0.15;
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(img, x, y, size, size);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  if (nightMix) {
    const f = skyCatFeatures[state.index],
      bright = glimmer * nightMix,
      sx = v => x + (v * size) / 96,
      sy = v => y + (v * size) / 96;
    const strokes = [
      [f.ears[0], [24, 36], f.eyes[0], f.nose, f.chin, f.eyes[1], [72, 36], f.ears[1]],
      [
        [24, 36],
        [48, 31],
        [72, 36],
      ],
      [f.eyes[0], f.eyes[1]],
    ];
    ctx.strokeStyle = rgba([207, 223, 255], (0.25 * bright).toFixed(3));
    ctx.lineWidth = 1;
    strokes.forEach(path => {
      ctx.beginPath();
      path.forEach((p, i) => (i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1]))));
      ctx.stroke();
    });
    const stars = [f.ears[0], f.ears[1], [24, 36], [48, 31], [72, 36], ...f.eyes, f.nose, f.chin, [16, 70], [80, 70]];
    stars.forEach((p, i) => {
      const flicker = 0.78 + 0.22 * Math.sin(t * (1.1 + i * 0.13) + i * 2);
      ctx.fillStyle = rgba(
        i === 6 || i === 7 ? [255, 231, 168] : [231, 240, 255],
        (0.68 * bright * flicker).toFixed(3),
      );
      ctx.fillRect(Math.round(sx(p[0])), Math.round(sy(p[1])), i === 6 || i === 7 ? 3 : 2, i === 6 || i === 7 ? 3 : 2);
    });
  }
  ctx.restore();
}
