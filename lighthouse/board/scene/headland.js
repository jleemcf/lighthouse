// The scene in parts (see core.js). This part: where the lighthouse stands, the headland's edge against the sea, the
// far islands, and the headland itself, drawn once per light, season and snow.

// ---------- the lighthouse's place ----------
const tx = 800,
  base = 384,
  top = base - 214,
  gy = top + 40,
  lc = { x: tx, y: top + 24 }; // tower centre, its foot, its top, the gallery deck, the lamp

// ---------- the headland: its edge against the sea, column by column ----------
const PTS = [
  [430, 541],
  [444, 524],
  [456, 514],
  [468, 503],
  [480, 494],
  [492, 487],
  [504, 482],
  [516, 477],
  [524, 471],
  [536, 468],
  [552, 467],
  [568, 467],
  [584, 468],
  [596, 466],
  [602, 448],
  [608, 428],
  [614, 412],
  [622, 402],
  [634, 395],
  [650, 390],
  [672, 386],
  [700, 382],
  [730, 379],
  [760, 377],
  [800, 376],
  [840, 377],
  [880, 379],
  [920, 382],
  [960, 386],
];
const EDGE = new Array(W + 1).fill(H + 2);
for (let x = 430; x <= W; x++) {
  let i = 0;
  while (i < PTS.length - 2 && PTS[i + 1][0] <= x) i++;
  const a = PTS[i],
    b = PTS[i + 1],
    k = (x - a[0]) / (b[0] - a[0]);
  let y = lerp(a[1], b[1], k);
  if (x < 524) y += (rnd(Math.floor(x / 5), 31) - 0.5) * 5;
  else if (x < 600) y += (rnd(Math.floor(x / 8), 31) - 0.5) * 1.5;
  else if (x < 660) y += (rnd(Math.floor(x / 4), 32) - 0.5) * 6;
  else y += (rnd(Math.floor(x / 10), 33) - 0.5) * 3;
  EDGE[x] = Math.round(y);
}
const groundY = x => EDGE[Math.max(0, Math.min(W, Math.round(x)))] + 10; // where feet stand on the green top
const ISLES = [
    [196, 44, 4],
    [300, 70, 5],
    [400, 160, 11],
    [845, 115, 6],
  ],
  ISLEH = new Array(W).fill(0); // far islands and a landmass: x, width, height
ISLES.forEach(([x0, w, h], i) => {
  for (let x = x0; x < x0 + w && x < W; x++) {
    const u = (x - x0) / w,
      bump = Math.sin(u * Math.PI);
    ISLEH[x] = Math.max(
      ISLEH[x],
      Math.round(h * (bump * (0.7 + 0.3 * Math.sin(u * 9 + i)) + 0.12 * rnd(Math.floor(x / 4), 90 + i))),
    );
  }
});
const ISLE_TOP = Math.max(...ISLEH); // the tallest of them, for the still layer they are drawn in
const capDepth = x => Math.round(lerp(4, 24, clamp((x - 600) / 220))) + Math.round(rnd(Math.floor(x / 16), 36) * 5);
const landCache = {};
function land(bucket, sea, snow) {
  // the headland drawn once per darkness, season and snow: rock in three shades, grass (or snow) on top, sand in the
  // inlet
  const key = bucket + ":" + sea + ":" + (snow ? 1 : 0);
  if (landCache[key]) return landCache[key];
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d");
  const img = c.createImageData(W, H),
    d = img.data;
  const ROCK = [
      [59, 47, 68],
      [90, 69, 96],
      [122, 97, 120],
    ],
    DARK = [44, 35, 52],
    RIM = [138, 122, 144];
  const G = snow
    ? { g: [232, 238, 246], g2: [246, 250, 255], g3: [196, 210, 226], e: [206, 218, 232] }
    : sea === "spring"
      ? { g: [118, 172, 78], g2: [160, 205, 100], g3: [90, 134, 56], e: [82, 128, 52] }
      : sea === "autumn"
        ? { g: [152, 148, 62], g2: [186, 168, 74], g3: [118, 106, 48], e: [104, 98, 44] }
        : sea === "winter"
          ? { g: [108, 120, 96], g2: [128, 140, 116], g3: [84, 96, 76], e: [78, 90, 70] }
          : { g: [111, 162, 69], g2: [139, 190, 85], g3: [85, 127, 51], e: [78, 122, 48] };
  const GRASS = G.g,
    GRASS2 = G.g2,
    GRASS3 = G.g3,
    EDGEG = G.e,
    PINK = [240, 170, 195],
    BROWN = [140, 110, 60];
  const SAND = [217, 199, 154],
    SAND2 = [201, 179, 132],
    SAND3 = [168, 143, 98];
  const put = (x, y, col) => {
    const o = (y * W + x) * 4;
    d[o] = col[0];
    d[o + 1] = col[1];
    d[o + 2] = col[2];
    d[o + 3] = 255;
  };
  for (let x = 430; x <= W - 1; x++) {
    const e = EDGE[x];
    if (e > H) continue;
    const inlet = x >= 524 && x < 600,
      cliff = x >= 600,
      cap = cliff ? capDepth(x) : 0;
    for (let y = Math.max(0, e); y < H; y++) {
      const dd = y - e;
      let col;
      if (inlet)
        col =
          dd < 3
            ? SAND
            : dd < 12
              ? SAND2
              : dd < 22
                ? SAND3
                : ROCK[Math.floor((y + Math.floor(rnd(Math.floor(x / 6), 33) * 8)) / 14) % 2];
      else if (cliff && dd < cap) {
        const sp = rnd(Math.floor(x / 4), Math.floor(y / 3));
        col =
          dd < 2
            ? EDGEG
            : dd < cap - 3
              ? sp < 0.12
                ? GRASS2
                : sea === "spring" && !snow && sp > 0.965
                  ? PINK
                  : sea === "autumn" && !snow && sp > 0.94
                    ? BROWN
                    : GRASS
              : GRASS3;
      } else if (cliff) {
        const band = Math.floor((y + Math.floor(rnd(Math.floor(x / 12), 34) * 10)) / 13) % 3;
        col = ROCK[band === 0 ? 1 : band === 1 ? 2 : 0];
        if (x < 660 && rnd(Math.floor(x / 3), Math.floor(y / 3)) < 0.18) col = DARK;
      } else {
        const band = Math.floor((y + Math.floor(rnd(Math.floor(x / 7), 35) * 9)) / 9) % 3;
        col = band === 0 ? DARK : ROCK[band];
        if (dd < 2) col = RIM;
      }
      put(x, y, col);
    }
  }
  c.putImageData(img, 0, 0);
  [
    [604, 470, 16, 9],
    [626, 440, 20, 10],
    [648, 478, 26, 12],
    [616, 505, 30, 14],
    [690, 520, 34, 12],
    [418, 528, 14, 8],
    [404, 536, 12, 6],
    [447, 536, 16, 6],
  ].forEach((b, i) => {
    c.fillStyle = i % 2 ? "#4A3A52" : "#6A5470";
    c.fillRect(b[0], b[1], b[2], b[3]);
    c.fillStyle = "#8A7A90";
    c.fillRect(b[0] + 2, b[1], b[2] - 6, 1);
    c.fillStyle = "#2C2334";
    c.fillRect(b[0], b[1] + b[3] - 2, b[2], 2);
  });
  if (bucket > 0) {
    c.globalCompositeOperation = "source-atop";
    c.fillStyle = rgba([8, 12, 30], (0.12 * bucket).toFixed(2));
    c.fillRect(0, 0, W, H);
  }
  landCache[key] = cv;
  return cv;
}
