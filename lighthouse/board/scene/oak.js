// The scene in parts (see core.js). This part: the giant tree's shape. The illustrated oak reduced to the scene's
// palette for each season, the winter skeleton of limbs and twigs, and the crown drawn once per season and light.

// ---------- the giant tree's shape ----------
const oakVariants = {};
function oakVariant(sea) {
  if (oakVariants[sea]) return oakVariants[sea];
  const cv = document.createElement("canvas");
  cv.width = treeOak.naturalWidth;
  cv.height = treeOak.naturalHeight;
  const c = cv.getContext("2d");
  c.drawImage(treeOak, 0, 0);
  const pixels = c.getImageData(0, 0, cv.width, cv.height),
    d = pixels.data;
  for (let y = 0; y < cv.height; y++)
    for (let x = 0; x < cv.width; x++) {
      const i = (y * cv.width + x) * 4,
        r = d[i],
        g = d[i + 1],
        b = d[i + 2];
      if (y > 303 && g > r + 7 && g > b * 0.94) {
        d[i + 3] = 0;
        continue;
      } // blend the roots into the island instead of carrying a grass tile
      if (sea === "winter" && (y < 260 || (g > r + 3 && g > b * 0.92))) {
        d[i + 3] = 0;
        continue;
      }
      if (sea === "spring" && g > r + 7 && g > b * 0.94) {
        const lum = clamp((r * 0.25 + g * 0.65 + b * 0.1 - 24) / 210),
          cream = rnd(x * 11 + y * 23, 83) > 0.71;
        const a = [72, 47, 70],
          z = cream ? [255, 239, 225] : [250, 178, 204];
        d[i] = lerp(a[0], z[0], lum);
        d[i + 1] = lerp(a[1], z[1], lum);
        d[i + 2] = lerp(a[2], z[2], lum);
      }
      if (sea === "autumn" && g > r + 7 && g > b * 0.94) {
        const lum = clamp((r * 0.25 + g * 0.65 + b * 0.1 - 28) / 210),
          gold = rnd(x * 7 + y * 17, 82) > 0.42;
        const a = gold ? [86, 48, 32] : [69, 36, 38],
          z = gold ? [244, 188, 69] : [207, 90, 45];
        d[i] = lerp(a[0], z[0], lum);
        d[i + 1] = lerp(a[1], z[1], lum);
        d[i + 2] = lerp(a[2], z[2], lum);
      }
    }
  c.putImageData(pixels, 0, 0);
  const low = document.createElement("canvas");
  low.width = 90;
  low.height = 85;
  const ink = low.getContext("2d");
  ink.imageSmoothingEnabled = false;
  ink.drawImage(cv, 0, 0, cv.width, 340, 0, 0, 90, 85);
  if (sea === "winter") {
    // fewer, stronger limbs suit the simple pixel scale of the surrounding scene
    const limbs = [
      [
        [44, 54],
        [34, 47],
        [24, 40],
        [17, 29],
      ],
      [
        [34, 47],
        [20, 44],
        [11, 39],
      ],
      [
        [24, 40],
        [25, 28],
        [20, 22],
      ],
      [
        [44, 54],
        [47, 42],
        [46, 30],
        [42, 19],
      ],
      [
        [47, 42],
        [53, 34],
        [57, 24],
      ],
      [
        [47, 53],
        [59, 45],
        [70, 38],
        [78, 28],
      ],
      [
        [59, 45],
        [65, 32],
        [69, 24],
      ],
      [
        [70, 38],
        [73, 27],
        [77, 21],
      ],
      [
        [11, 39],
        [8, 33],
      ],
      [
        [17, 29],
        [13, 23],
      ],
      [
        [42, 19],
        [38, 15],
      ],
      [
        [78, 28],
        [83, 24],
      ],
    ];
    const stroke = (pts, wide, color) => {
      ink.fillStyle = color;
      for (let p = 0; p < pts.length - 1; p++) {
        const [x0, y0] = pts[p],
          [x1, y1] = pts[p + 1],
          steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        for (let j = 0; j <= steps; j++)
          ink.fillRect(
            Math.round(lerp(x0, x1, j / steps)),
            Math.round(lerp(y0, y1, j / steps)),
            Math.max(1, wide - p),
            Math.max(1, wide - p),
          );
      }
    };
    stroke(
      [
        [47, 69],
        [44, 60],
        [44, 53],
      ],
      5,
      "#392E30",
    );
    stroke(
      [
        [46, 69],
        [43, 60],
        [43, 53],
      ],
      3,
      "#9D6C4E",
    );
    limbs.forEach((points, i) => {
      stroke(points, i < 8 ? 3 : 1, "#392E30");
      stroke(
        points.map(([x, y]) => [x, y - 1]),
        i < 8 ? 2 : 1,
        "#8B5D48",
      );
    });
    [
      [14, 24],
      [20, 21],
      [39, 15],
      [56, 23],
      [69, 23],
      [78, 20],
    ].forEach(([x, y]) => {
      ink.fillStyle = "#D4B3A2";
      ink.fillRect(x, y, 2, 1);
    });
  }
  // Reduce the supplied illustration to the scene's three-pixel vocabulary and a small,
  // deliberate palette. Keep bark and canopy on separate layers so each bough can respond
  // to wind without sliding the entire picture like a single cutout.
  const size = { w: 60, h: 57 },
    pixel = document.createElement("canvas");
  pixel.width = size.w;
  pixel.height = size.h;
  const pin = pixel.getContext("2d");
  pin.imageSmoothingEnabled = false;
  pin.drawImage(low, 0, 0, low.width, low.height, 0, 0, size.w, size.h);
  const original = document.createElement("canvas");
  original.width = size.w;
  original.height = size.h;
  const raw = original.getContext("2d");
  raw.imageSmoothingEnabled = false;
  raw.drawImage(treeOak, 0, 0, cv.width, Math.min(340, cv.height), 0, 0, size.w, size.h);
  const source = pin.getImageData(0, 0, size.w, size.h),
    mask = raw.getImageData(0, 0, size.w, size.h).data;
  const palettes = {
    summer: ["#263D34", "#365C3A", "#528147", "#75A151", "#9ABF65", "#C0D47F"],
    spring: ["#493848", "#80566D", "#B67491", "#D99BB1", "#F0BBD0", "#FFE0DE"],
    autumn: ["#48322F", "#81503A", "#B4673A", "#D58D45", "#E8AF5C", "#F3D17D"],
  };
  const bark = ["#2F282E", "#4D3431", "#704835", "#946341", "#BA8455"],
    crown = palettes[sea];
  const centers = [
    [8, 32],
    [13, 23],
    [23, 14],
    [35, 11],
    [47, 17],
    [53, 27],
    [40, 31],
    [27, 34],
  ];
  const makeLayer = () => {
    const layer = document.createElement("canvas");
    layer.width = size.w;
    layer.height = size.h;
    return layer;
  };
  const wood = makeLayer(),
    shade = makeLayer(),
    lobes = crown ? centers.map(makeLayer) : [],
    accents = [];
  const woodPixels = new ImageData(size.w, size.h),
    shadePixels = new ImageData(size.w, size.h);
  const lobePixels = lobes.map(() => new ImageData(size.w, size.h));
  const paint = (target, index, hex) => {
    target[index] = parseInt(hex.slice(1, 3), 16);
    target[index + 1] = parseInt(hex.slice(3, 5), 16);
    target[index + 2] = parseInt(hex.slice(5, 7), 16);
    target[index + 3] = 255;
  };
  for (let yy = 0; yy < size.h; yy++)
    for (let xx = 0; xx < size.w; xx++) {
      const i = (yy * size.w + xx) * 4;
      if (source.data[i + 3] < 120) continue;
      const r = mask[i],
        g = mask[i + 1],
        b = mask[i + 2];
      const leaf = !!crown && yy < 45 && g >= r - 2 && g > b * 0.84;
      if (leaf) {
        // A small neighborhood shares a shade, so the crown reads as broad painted
        // masses instead of retaining every noisy highlight from the reference.
        let light = 0,
          count = 0;
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const qx = xx + ox,
              qy = yy + oy;
            if (qx < 0 || qx >= size.w || qy < 0 || qy >= size.h) continue;
            const j = (qy * size.w + qx) * 4,
              rr = mask[j],
              gg = mask[j + 1],
              bb = mask[j + 2];
            if (mask[j + 3] < 120 || gg < rr - 2 || gg <= bb * 0.84) continue;
            light += rr * 0.25 + gg * 0.62 + bb * 0.13;
            count++;
          }
        const lum = count ? light / count : r * 0.25 + g * 0.62 + b * 0.13;
        const tone = Math.max(0, Math.min(5, Math.floor((lum - 29) / 31)));
        let lobe = 0,
          distance = Infinity;
        centers.forEach(([cx, cy], n) => {
          const d = (xx - cx) ** 2 + (yy - cy) ** 2 * 1.35;
          if (d < distance) {
            distance = d;
            lobe = n;
          }
        });
        paint(shadePixels.data, i, palettes[sea][Math.max(0, tone - 2)]);
        paint(lobePixels[lobe].data, i, palettes[sea][tone]);
        if (tone >= 3 && rnd(xx + yy * size.w, 704) > 0.83) accents.push({ x: xx, y: yy, lobe });
      } else {
        const lum = source.data[i] * 0.3 + source.data[i + 1] * 0.57 + source.data[i + 2] * 0.13;
        const tone = Math.max(0, Math.min(4, Math.floor((lum - 24) / 36)));
        paint(woodPixels.data, i, sea === "winter" && lum > 155 ? "#D6C9C1" : bark[tone]);
      }
    }
  wood.getContext("2d").putImageData(woodPixels, 0, 0);
  shade.getContext("2d").putImageData(shadePixels, 0, 0);
  lobes.forEach((layer, i) => layer.getContext("2d").putImageData(lobePixels[i], 0, 0));
  oakVariants[sea] = { wood, shade, lobes, accents, bright: crown && crown[5] };
  return oakVariants[sea];
}
// TS scales the tree's coordinates below to three quarters; TRUNK_H is the trunk's height in leaf
const TS = 0.75,
  TRUNK_H = 63;
const HOLE = { dx: 0, dy: -28, oakDx: 4 },
  NEST = { dx: 41, dy: -75 }; // the illustrated trunk sits four pixels right of the tree's foot at the hollow's height
// The winter tree exposes a skeleton of limbs and twigs. In leaf, one connected crown covers the branches completely;
// the trunk and the squirrel's climbing path share the same exaggerated bend. Three boughs grow from its top in winter,
// then fork into smaller branches and twigs, kept below the lantern room.
const FROM_FORK = p => [Math.round(p[0] * TS), Math.round((-84 + (p[1] + 84) * 0.8) * TS)];
const LIMBS = [
  [
    [
      [0, -84],
      [-14, -104],
      [-30, -124],
      [-42, -146],
    ],
    [6, 4, 3],
  ],
  [
    [
      [-30, -124],
      [-52, -132],
      [-70, -138],
    ],
    [3, 2],
  ],
  [
    [
      [-42, -146],
      [-56, -166],
      [-62, -180],
    ],
    [2, 2],
  ],
  [
    [
      [-14, -104],
      [-34, -108],
      [-54, -106],
    ],
    [3, 2],
  ],
  [
    [
      [2, -84],
      [4, -110],
      [0, -136],
      [6, -164],
    ],
    [6, 4, 3],
  ],
  [
    [
      [4, -110],
      [-10, -132],
      [-18, -156],
    ],
    [3, 2],
  ],
  [
    [
      [0, -136],
      [16, -154],
      [20, -178],
    ],
    [3, 2],
  ],
  [
    [
      [6, -164],
      [-2, -186],
      [2, -204],
    ],
    [2, 1],
  ],
  [
    [
      [4, -84],
      [18, -102],
      [34, -120],
      [48, -142],
    ],
    [6, 4, 3],
  ],
  [
    [
      [34, -120],
      [58, -124],
      [76, -132],
    ],
    [3, 2],
  ],
  [
    [
      [48, -142],
      [60, -162],
      [64, -180],
    ],
    [2, 2],
  ],
  [
    [
      [18, -102],
      [40, -100],
      [60, -96],
    ],
    [3, 2],
  ],
].map(l => [l[0].map(FROM_FORK), l[1]]);
const TWIGS = [
  [
    [-62, -180],
    [-70, -192],
  ],
  [
    [-62, -180],
    [-56, -194],
  ],
  [
    [2, -204],
    [-6, -216],
  ],
  [
    [2, -204],
    [10, -214],
  ],
  [
    [64, -180],
    [72, -192],
  ],
  [
    [64, -180],
    [58, -194],
  ],
  [
    [-70, -138],
    [-82, -144],
  ],
  [
    [76, -132],
    [88, -138],
  ],
  [
    [-18, -156],
    [-26, -168],
  ],
  [
    [20, -178],
    [28, -190],
  ],
  [
    [-54, -106],
    [-66, -110],
  ],
  [
    [60, -96],
    [72, -100],
  ],
].map(l => l.map(FROM_FORK));
// Large, uneven crown volumes. Fine leaf edges and texture are generated once per season and light level below.
// [x from the fork, y from the foot, horizontal radius, vertical radius], in scene pixels.
const CROWN = [
  [-107, -91, 19, 15],
  [-96, -109, 22, 19],
  [-78, -126, 19, 17],
  [-60, -113, 23, 20],
  [-48, -142, 22, 20],
  [-24, -155, 20, 17],
  [-3, -164, 18, 16],
  [4, -151, 22, 18],
  [29, -141, 24, 20],
  [51, -125, 19, 17],
  [-87, -80, 23, 17],
  [-64, -92, 21, 18],
  [-39, -103, 21, 20],
  [-13, -113, 20, 18],
  [10, -111, 22, 18],
  [35, -105, 22, 19],
  [55, -95, 18, 17],
  [-79, -67, 18, 14],
  [-55, -73, 20, 14],
  [-30, -84, 18, 15],
  [-7, -77, 18, 15],
  [20, -82, 18, 17],
  [45, -71, 17, 14],
  [65, -68, 12, 11],
  [-111, -77, 11, 10],
  [-70, -139, 11, 11],
  [56, -112, 13, 10],
  [60, -72, 11, 12],
];
const BEND = [
  [0, 0],
  [0.16, -10],
  [0.38, -21],
  [0.56, -24],
  [0.72, -13],
  [0.87, 5],
  [1, 14],
]; // an exaggerated S: roots to the left, then a return into the crown
const trunkBend = k => {
  let i = 0;
  while (i < BEND.length - 2 && BEND[i + 1][0] <= k) i++;
  const a = BEND[i],
    b = BEND[i + 1],
    u = clamp((k - a[0]) / (b[0] - a[0])),
    w = 0.5 - 0.5 * Math.cos(u * Math.PI);
  return Math.round(lerp(a[1], b[1], w));
};
const crownCache = {};
const crownPalette = sea =>
  sea === "spring"
    ? ["#192E2A", "#2B5A36", "#478448", "#70AA55", "#9ECB70", "#D9E895", "#F2D9D7"]
    : sea === "autumn"
      ? ["#302927", "#65402C", "#95502E", "#BA7134", "#D9973F", "#F0BE58", "#FFE09A"]
      : ["#142B2B", "#235039", "#367B3F", "#56A246", "#7BC04C", "#A9DA61", "#D6F18A"];
function crownNoise(x, y, size, salt) {
  // smooth blocks of light and shadow, with smaller blocks for the leaf edges
  const xx = x / size,
    yy = y / size,
    ix = Math.floor(xx),
    iy = Math.floor(yy),
    u = xx - ix,
    v = yy - iy,
    a = u * u * (3 - 2 * u),
    b = v * v * (3 - 2 * v);
  const h = (px, py) => rnd(px * 37 + py * 131, salt);
  return lerp(lerp(h(ix, iy), h(ix + 1, iy), a), lerp(h(ix, iy + 1), h(ix + 1, iy + 1), a), b);
}
function crownSprite(sea, night) {
  const bucket = Math.round(night * 4),
    key = sea + ":" + bucket;
  if (crownCache[key]) return crownCache[key];
  const cv = document.createElement("canvas"),
    w = 240,
    h = 190;
  cv.width = w;
  cv.height = h;
  const c = cv.getContext("2d"),
    img = c.createImageData(w, h),
    data = img.data;
  const pal = crownPalette(sea).map(hex =>
    mix(
      [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)],
      [16, 22, 42],
      bucket * 0.155,
    ),
  );
  const gaps = [
    [-48, -83, 8, 4],
    [15, -79, 8, 4],
    [46, -97, 6, 3],
    [-91, -101, 6, 3],
  ];
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) {
      const dx = px - 137,
        dy = py - 177;
      let field = -2,
        u = 0,
        v = 0,
        lobe = 0;
      CROWN.forEach(([lx, ly, rx, ry], i) => {
        const uu = (dx - lx) / rx,
          vv = (dy - ly) / ry,
          f = 1 - uu * uu - vv * vv;
        if (f > field) {
          field = f;
          u = uu;
          v = vv;
          lobe = i;
        }
      });
      const edge = (crownNoise(dx, dy, 9, 701) - 0.5) * 0.34 + (crownNoise(dx, dy, 3, 702) - 0.5) * 0.17;
      if (field < edge) continue;
      let opening = false;
      for (const [gx, gy0, rx, ry] of gaps) {
        const uu = (dx - gx) / rx,
          vv = (dy - gy0) / ry;
        if (uu * uu + vv * vv < 0.76 + (crownNoise(dx, dy, 4, 703) - 0.5) * 0.3) {
          opening = true;
          break;
        }
      }
      const broad = Math.floor(crownNoise(dx, dy, 15, 704) * 5) / 5,
        tuft = Math.floor(crownNoise(dx, dy, 6, 705) * 5) / 5,
        grain = rnd(px * 13 + py * 47, 706);
      const light =
        0.23 -
        v * 0.42 -
        u * 0.2 +
        (broad - 0.5) * 1.45 +
        (tuft - 0.5) * 0.92 +
        (grain - 0.5) * 0.25 +
        (rnd(lobe, 740) - 0.5) * 0.32;
      let shade = light > 0.91 ? 6 : light > 0.72 ? 5 : light > 0.54 ? 4 : light > 0.35 ? 3 : light > 0.13 ? 2 : 1;
      if (field - edge < 0.2) shade = Math.min(shade, grain > 0.84 ? 3 : 1);
      else if (field < 0.4 && v > -0.25) shade = Math.min(shade, 2);
      if (dy > -76) shade = Math.max(0, shade - 1);
      if (opening) shade = grain > 0.84 ? 1 : 0;
      if (grain > 0.92 && field > 0.22) shade = Math.min(6, shade + 1); // bright individual leaf tips
      if (grain < 0.08 && field > 0.18) shade = Math.max(0, shade - 2); // tiny gaps between leaves
      const o = (py * w + px) * 4,
        col = pal[shade];
      data[o] = col[0];
      data[o + 1] = col[1];
      data[o + 2] = col[2];
      data[o + 3] = 255;
    }
  c.putImageData(img, 0, 0);
  CROWN.forEach(([lx, ly, rx, ry], part) => {
    // grouped, angular leaf sprays instead of isolated noise
    for (let j = 0; j < 33; j++) {
      const id = part * 43 + j,
        u = rnd(id, 731) * 1.7 - 0.85,
        v = rnd(id, 732) * 1.6 - 0.8;
      if (u * u + v * v > 0.7) continue;
      const px = Math.round(137 + lx + u * rx),
        py = Math.round(177 + ly + v * ry),
        at = (py * w + px) * 4;
      if (px < 3 || px > w - 6 || py < 3 || py > h - 6 || !data[at + 3]) continue;
      const bright = v < -0.15 && rnd(id, 733) > 0.23,
        shade = bright ? (rnd(id, 734) > 0.64 ? 6 : 5) : v > 0.3 ? 2 : 4;
      const span = 2 + Math.floor(rnd(id, 735) * 3),
        col = pal[shade];
      c.fillStyle = rgb(col);
      c.fillRect(px - 2, py, span, 2);
      c.fillRect(px + 1, py - 2, span, 2);
      c.fillRect(px - 3, py + 2, 2, 1);
      if (rnd(id, 736) > 0.45) c.fillRect(px + span, py - 1, 2, 1);
      if (rnd(id, 737) > 0.65) {
        c.fillStyle = rgb(pal[1]);
        c.fillRect(px + 1, py + 3, span + 1, 1);
      }
    }
  });
  crownCache[key] = cv;
  return cv;
}
