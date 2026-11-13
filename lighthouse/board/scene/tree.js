// The scene in parts (see core.js). This part: drawing the giant tree, with its nest, the squirrel's hole, the falling
// leaves and petals, and the squirrel.

// ---------- the giant tree: its own small world ----------
function branchTo(ctx, x1, y1, x2, y2, w, sway) {
  const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) || 1;
  for (let st = 0; st <= n; st++) {
    const k = st / n;
    ctx.fillRect(Math.round(lerp(x1, x2, k) + sway * k), Math.round(lerp(y1, y2, k)), w, w);
  }
}
function ell(ctx, cx, cy, rx, ry) {
  for (let dy = -ry; dy <= ry; dy += 2) {
    const w = Math.floor((rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry)))) / 2) * 2;
    if (w > 0) ctx.fillRect(cx - w, cy + dy, 2 * w, 2);
  }
} // a chunky ellipse, two pixels to the step
function poly(ctx, x, ty, pts, ws, sway, grow) {
  for (let i = 0; i < pts.length - 1; i++) {
    const w = (ws[Math.min(i, ws.length - 1)] || 1) + (grow || 0);
    branchTo(
      ctx,
      x + pts[i][0] - Math.floor(w / 2),
      ty + pts[i][1],
      x + pts[i + 1][0] - Math.floor(w / 2),
      ty + pts[i + 1][1],
      w,
      sway,
    );
  }
}
function drawTree(ctx, t, dt, sea, snowCover, wind, night, startle) {
  const x = TREE.x,
    ty = groundY(x),
    gust = 0.65 + 0.35 * Math.sin(t * 0.43 + 0.8),
    sw = wind * 15 * gust * Math.sin(t * (1.1 + wind * 0.9)),
    swayAt = yy => Math.round(sw * Math.pow(clamp((ty - yy) / 170), 1.35));
  const illustrated = treeOak.complete && treeOak.naturalWidth > 0;
  const dusk = night * 0.62,
    N = hex => {
      const c = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
      return rgb(mix(c, [16, 22, 42], dusk));
    }; // the tree darkens with the night like the land
  const OUT = N("#34281F"),
    BARK = N("#835236"),
    BARKL = N("#B77B4B"),
    BARKD = N("#563729"),
    BARKHI = N("#D29A60");
  // the trunk: thick, leaning, flared at the foot and, in winter, flaring again into the fork; drawn as an outline
  // pass and a bark pass so the limbs can share both and grow out of it without a seam
  const trunkTop = sea === "winter" ? 72 : 60;
  const trunkRow = yy => {
    const k = clamp((ty - yy) / TRUNK_H),
      cx = x + trunkBend(k),
      root = yy > ty - 5 ? Math.ceil((5 - (ty - yy)) * 0.9) : 0,
      fork = yy < ty - TRUNK_H ? Math.round((ty - TRUNK_H - yy) * 0.6) : 0;
    return { cx, half: Math.round(12 - 5 * k) + root + fork };
  };
  const trunkOutline = () => {
    ctx.fillStyle = OUT;
    ctx.fillRect(x - 20, ty - 1, 40, 2);
    for (let yy = ty - trunkTop; yy < ty; yy++) {
      const r = trunkRow(yy);
      ctx.fillRect(r.cx - r.half - 1, yy, r.half * 2 + 2, 1);
    }
  };
  const trunkBark = () => {
    for (let yy = ty - trunkTop; yy < ty; yy++) {
      const r = trunkRow(yy),
        cx = r.cx,
        half = r.half;
      ctx.fillStyle = BARK;
      ctx.fillRect(cx - half, yy, half * 2, 1);
      ctx.fillStyle = BARKL;
      ctx.fillRect(cx - half + 1, yy, 3, 1);
      ctx.fillStyle = BARKD;
      ctx.fillRect(cx + half - 4, yy, 3, 1);
    }
    for (let i = 0; i < 155; i++) {
      // short vertical grain follows the S curve instead of crossing it
      const h = 3 + Math.floor(rnd(i, 501) * (trunkTop - 7)),
        yy = ty - h,
        r = trunkRow(yy),
        off = Math.round((rnd(i, 502) * 1.6 - 0.8) * Math.max(1, r.half - 2));
      ctx.fillStyle = rnd(i, 503) < 0.45 ? BARKD : rnd(i, 504) < 0.55 ? BARKL : BARKHI;
      ctx.fillRect(r.cx + off, yy, rnd(i, 505) > 0.82 ? 2 : 1, 1 + Math.floor(rnd(i, 506) * 4));
    }
    ctx.fillStyle = OUT;
    branchTo(ctx, x - 7, ty - 4, x - 31, ty + 1, 5, 0);
    branchTo(ctx, x + 6, ty - 4, x + 27, ty + 1, 5, 0);
    ctx.fillStyle = BARK;
    branchTo(ctx, x - 7, ty - 5, x - 29, ty, 3, 0);
    branchTo(ctx, x + 6, ty - 5, x + 25, ty, 3, 0);
    ctx.fillStyle = BARKHI;
    branchTo(ctx, x - 10, ty - 6, x - 26, ty - 1, 1, 0);
    branchTo(ctx, x + 8, ty - 6, x + 22, ty - 1, 1, 0);
    [
      [10, -5, 5],
      [17, 3, 4],
      [38, -3, 5],
      [45, 3, 4],
      [53, -2, 3],
    ].forEach(([h, dx, w]) => {
      const cx = x + trunkBend(h / TRUNK_H);
      ctx.fillStyle = BARKD;
      ctx.fillRect(cx + dx, ty - h, w, 2);
      ctx.fillStyle = BARKL;
      ctx.fillRect(cx + dx - 2, ty - h - 3, 2, 3);
    });
  };
  if (illustrated) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.filter = `brightness(${1 - night * 0.6})`;
    const oak = oakVariant(sea),
      rowShift = row => swayAt(ty - 171 + row * 3);
    const drawLayer = (layer, branchX, branchY) => {
      for (let row = 0; row < 57; ) {
        const shift = rowShift(row);
        let end = row + 1;
        while (end < 57 && rowShift(end) === shift) end++;
        ctx.drawImage(
          layer,
          0,
          row,
          60,
          end - row,
          x - 88 + shift + branchX,
          ty - 171 + row * 3 + branchY,
          180,
          (end - row) * 3,
        );
        row = end;
      }
    };
    drawLayer(oak.shade, 0, 0);
    drawLayer(oak.wood, 0, 0);
    const flutter = oak.lobes.map((_, i) => ({
      x: Math.round(
        wind * (2.7 * Math.sin(t * (1.7 + i * 0.08) + i * 1.4) + 2.4 * Math.sin(t * (5.2 + i * 0.2) + i * 2.1)),
      ),
      y: Math.round(wind * 1.8 * Math.sin(t * (4.1 + i * 0.17) + i * 1.3)),
    }));
    oak.lobes.forEach((lobe, i) => drawLayer(lobe, flutter[i].x, flutter[i].y));
    ctx.restore();
    if (wind > 0.2 && oak.bright) {
      ctx.fillStyle = N(oak.bright);
      oak.accents.forEach((leaf, i) => {
        if (i % 3 || Math.sin(t * (6.5 + (i % 4)) + i * 1.8) < 0.1) return;
        const shake = Math.round(wind * 2.4 * Math.sin(t * (8 + (i % 3)) + i * 2.4)),
          f = flutter[leaf.lobe];
        ctx.fillRect(x - 88 + leaf.x * 3 + rowShift(leaf.y) + f.x + shake, ty - 171 + leaf.y * 3 + f.y, 2, 1);
      });
    }
  } else if (sea !== "winter") {
    trunkOutline();
    trunkBark();
  }
  // the hole where the squirrel lives
  {
    const hy = ty + HOLE.dy,
      hx = x + HOLE.dx + (illustrated ? HOLE.oakDx + swayAt(hy) : trunkBend(-HOLE.dy / TRUNK_H));
    ctx.fillStyle = OUT;
    [
      [-2, -5, 5, 1],
      [-3, -4, 7, 6],
      [-2, 2, 5, 1],
    ].forEach(r => ctx.fillRect(hx + r[0], hy + r[1], r[2], r[3]));
    ctx.fillStyle = N("#1A1208");
    ctx.fillRect(hx - 2, hy - 3, 5, 5);
    ctx.fillRect(hx - 1, hy - 5, 3, 1);
    ctx.fillStyle = BARKL;
    ctx.fillRect(hx - 3, hy - 6, 6, 1);
    ctx.fillRect(hx - 4, hy - 3, 1, 4);
    if (squirrel.place === "hole" && squirrel.peek) {
      ctx.fillStyle = "#A0522D";
      ctx.fillRect(hx - 1, hy - 2, 3, 3);
      ctx.fillRect(hx - 1, hy - 3, 1, 1);
      ctx.fillRect(hx + 1, hy - 3, 1, 1);
      ctx.fillStyle = "#1B2130";
      ctx.fillRect(hx, hy - 1, 1, 1);
    }
  }
  const ox = x + trunkBend(1); // the limbs spring from the top of the leaning trunk
  if (sea !== "winter" && !illustrated) {
    // Crooked limbs sit behind an irregular, detailed leaf silhouette. Openings in it expose real wood and sky.
    const boughs = [
      [
        [
          [0, -62],
          [-11, -70],
          [-24, -78],
          [-39, -91],
          [-56, -109],
        ],
        [8, 6, 4, 2],
      ],
      [
        [
          [0, -62],
          [11, -68],
          [24, -76],
          [41, -85],
          [55, -102],
        ],
        [8, 5, 4, 2],
      ],
      [
        [
          [0, -62],
          [4, -74],
          [1, -91],
          [14, -110],
          [20, -128],
        ],
        [7, 5, 3, 2],
      ],
      [
        [
          [-24, -78],
          [-31, -96],
          [-48, -113],
        ],
        [4, 2],
      ],
      [
        [
          [24, -76],
          [27, -98],
          [43, -118],
        ],
        [4, 2],
      ],
      [
        [
          [-36, -33],
          [-27, -42],
          [-11, -51],
          [8, -63],
          [36, -77],
        ],
        [5, 4, 3, 2],
      ],
    ];
    boughs.forEach(([pts, widths]) => {
      const sway = swayAt(ty + pts[pts.length - 1][1]);
      ctx.fillStyle = OUT;
      poly(ctx, ox, ty, pts, widths, sway, 2);
      ctx.fillStyle = BARKD;
      poly(ctx, ox, ty, pts, widths, sway, 0);
      ctx.fillStyle = BARKL;
      poly(
        ctx,
        ox - 1,
        ty - 1,
        pts,
        widths.map(w => Math.max(1, w - 3)),
        sway,
        0,
      );
    });
    const sway = swayAt(ty - 125),
      flutter = Math.round(Math.sin(t * 0.7) * wind);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(crownSprite(sea, night), ox - 137 + sway, ty - 177 + flutter);
    ctx.restore();
    if (wind > 0.15)
      for (let i = 0; i < 30; i++) {
        const c = CROWN[Math.floor(rnd(i, 721) * CROWN.length)],
          px = Math.round(ox + c[0] + (rnd(i, 722) - 0.5) * c[2] + sway),
          py = Math.round(ty + c[1] + (rnd(i, 723) - 0.5) * c[3]);
        if (Math.sin(t * (1 + wind) + i * 2.1) > 0.75) {
          ctx.fillStyle = sea === "autumn" ? N("#F4C66D") : N("#D8F28A");
          ctx.fillRect(px, py, 2, 1);
        }
      }
    if (snowCover) {
      ctx.fillStyle = "#F0F4FA";
      CROWN.forEach(([dx, dy, rx, ry], i) => {
        if (dy < -110 && i % 2 === 0) {
          ctx.fillRect(
            Math.round(ox + dx - rx * 0.35 + sway),
            Math.round(ty + dy - ry * 0.93),
            Math.round(rx * 0.65),
            2,
          );
        }
      });
    }
  } else if (sea === "winter" && !illustrated) {
    // fallback winter skeleton if the illustration has not loaded
    ctx.fillStyle = OUT;
    LIMBS.forEach(l => poly(ctx, ox, ty, l[0], l[1], swayAt(ty + l[0][l[0].length - 1][1]), 2));
    TWIGS.forEach(l => poly(ctx, ox, ty, l, [1], swayAt(ty + l[1][1]), 2));
    trunkOutline();
    trunkBark();
    ctx.fillStyle = BARK;
    LIMBS.forEach(l => poly(ctx, ox, ty, l[0], l[1], swayAt(ty + l[0][l[0].length - 1][1]), 0));
    TWIGS.forEach(l => poly(ctx, ox, ty, l, [1], swayAt(ty + l[1][1]), 0));
    ctx.fillStyle = BARKL;
    LIMBS.forEach(l => {
      if (l[1][0] >= 6)
        poly(
          ctx,
          ox - 1,
          ty,
          l[0],
          l[1].map(w => Math.max(1, w - 4)),
          swayAt(ty + l[0][l[0].length - 1][1]),
          0,
        );
    });
    if (snowCover) {
      ctx.fillStyle = "#F0F4FA";
      LIMBS.forEach(l =>
        poly(
          ctx,
          ox,
          ty - 2,
          l[0],
          l[1].map(w => Math.max(1, w - 1)),
          swayAt(ty + l[0][l[0].length - 1][1]),
          0,
        ),
      );
      ctx.fillRect(x - 6, ty - TRUNK_H, 12, 2);
    }
  }
  // The family nest follows the fork's sway, including its occupants and returning flights.
  {
    const nx = x + (illustrated ? 0 : trunkBend(1)) + NEST.dx + swayAt(ty + NEST.dy),
      ny = ty + NEST.dy;
    drawBirdFamily(ctx, t, nx, ny, snowCover, night);
  }
  // leaves in autumn, petals in spring: shed from the shelves now and then, drifting on the wind, autumn's gathering
  // under the tree
  if (
    (sea === "autumn" || sea === "spring") &&
    Math.random() < dt * (sea === "autumn" ? 0.8 : 0.6) &&
    leaves.length < 70
  ) {
    const c = CROWN[Math.floor(Math.random() * CROWN.length)];
    leaves.push({
      x: ox + c[0] + swayAt(ty + c[1]) + (Math.random() - 0.5) * c[2] * 1.5,
      y: ty + c[1] + (Math.random() - 0.5) * c[3] * 1.5,
      life: 90,
      down: false,
      ph: Math.random() * 6,
      col:
        sea === "autumn"
          ? ["#F2B24A", "#F9D37A", "#E08A32"][Math.floor(Math.random() * 3)]
          : ["#F5B9D0", "#FBDCE8", "#E496B6"][Math.floor(Math.random() * 3)],
    });
  }
  for (let i = leaves.length - 1; i >= 0; i--) {
    const l = leaves[i];
    if (!l.down) {
      l.x += (wind * 18 + Math.sin(t * 2 + l.ph) * 9) * dt;
      l.y += (sea === "autumn" ? 12 : 7) * dt;
      if (l.y >= groundY(l.x) && l.x > GL && l.x < GR) {
        l.down = true;
        l.y = groundY(l.x);
      }
      if (l.x < 0 || l.x > W || l.y > H) l.life = 0;
    }
    l.life -= dt;
    if (l.life <= 0) leaves.splice(i, 1);
  }
  leaves.forEach(l => {
    ctx.fillStyle = l.col;
    ctx.fillRect(Math.round(l.x), Math.round(l.y), 2, 1);
  });
  if (sea !== "autumn" && sea !== "spring") leaves.length = 0;
  // A few little disturbed-earth patches remain after the squirrel covers its acorns.
  squirrelBurrows.forEach(b => {
    const gy = squirrelGroundY(b.x);
    ctx.fillStyle = "#5C4933";
    ctx.fillRect(b.x - 3, gy - 1, 7, 1);
    ctx.fillStyle = "#98714A";
    ctx.fillRect(b.x - 1, gy - 2, 4, 1);
  });
  // the squirrel, wherever it is
  if (squirrel.place !== "hole") squirrelSprite(ctx, t, startle);
}
