#!/usr/bin/env python3
"""The home-screen icons for the board (a lighthouse on the night ground), drawn with nothing but zlib: no image
library is needed on any machine. Writes ../server/public/icon-512.png, icon-192.png and apple-touch-icon.png (180).
Run once after changing the drawing; the PNGs are committed."""
import os, struct, zlib
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "server", "public")
S = 512
GROUND = (0x0F, 0x17, 0x20)
TOWER = (0xE6, 0xED, 0xF2)
BAND = (0xC8, 0x35, 0x2B)
DARK = (0x1B, 0x27, 0x33)
LAMP = (0xF2, 0xB6, 0x3C)

def lerp(a, b, t): return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))

def tower_half(y):   # the tower's half-width at height y (base wide, top narrow)
    if y < 216 or y > 448: return None
    return 40 + (62 - 40) * (y - 216) / (448 - 216)

def pixel(x, y):
    c = GROUND
    cx, ly = 256, 178   # the lamp's centre
    dx, dy = x - cx, y - ly
    # the beams: two soft wedges to the edges, brightest near the lamp
    if 0 <= y < S:
        for sgn in (-1, 1):
            far = sgn * dx
            if far > 40:
                half = 18 + (far - 40) * 0.42   # the wedge widens with distance
                if abs(dy) < half:
                    a = 0.34 * (1 - abs(dy) / half) * max(0.0, 1 - far / 300)
                    c = lerp(c, LAMP, a)
    # the glow
    d = (dx * dx + dy * dy) ** 0.5
    if d < 120: c = lerp(c, LAMP, 0.45 * (1 - d / 120) ** 2)
    # the tower with its two bands
    h = tower_half(y)
    if h is not None and abs(dx) <= h:
        c = TOWER
        if 262 <= y < 300 or 344 <= y < 382: c = BAND
        if abs(dx) > h - 4: c = lerp(c, DARK, 0.25)   # a shaded edge
    # the gallery: a dark ledge under the lantern
    if 204 <= y < 218 and abs(dx) <= 56: c = DARK
    # the lantern room: the light itself, framed
    if 150 <= y < 204 and abs(dx) <= 44:
        c = LAMP if abs(dx) <= 38 and 156 <= y < 198 else DARK
    # the roof
    if 108 <= y < 150:
        rh = 56 * (y - 108) / 42
        if abs(dx) <= rh: c = BAND
    if 100 <= y < 108 and abs(dx) <= 5: c = DARK   # the finial
    return c

def render(size):
    px = [[pixel(x, y) for x in range(S)] for y in range(S)]
    if size == S: return px
    f = S // size if S % size == 0 else None
    out = []
    for yy in range(size):
        row = []
        for xx in range(size):
            # box-average the source pixels this output pixel covers
            x0, x1 = xx * S // size, (xx + 1) * S // size; y0, y1 = yy * S // size, (yy + 1) * S // size
            n = (x1 - x0) * (y1 - y0); r = g = b = 0
            for y in range(y0, y1):
                for x in range(x0, x1):
                    p = px[y][x]; r += p[0]; g += p[1]; b += p[2]
            row.append((r // n, g // n, b // n))
        out.append(row)
    return out

def png(rows):
    size = len(rows)
    raw = b"".join(b"\0" + bytes(v for p in row for v in p) for row in rows)
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
    header = chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    return b"\x89PNG\r\n\x1a\n" + header + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")

if __name__ == "__main__":
    big = render(S)
    for name, size in (("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)):
        rows = big if size == S else render(size)
        with open(os.path.join(OUT, name), "wb") as f: f.write(png(rows))
        print("wrote", name)
