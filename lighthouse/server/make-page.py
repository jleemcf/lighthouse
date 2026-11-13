#!/usr/bin/env python3
"""Build the board's page, server/public/index.html, from its sources in ../board.

The page is one HTML file. Its sources:
  board/index.html       the page's markup, with placeholders the build fills in
  board/style/           the page's styles, as parts listed in parts.txt
  board/app/             the page's script, as parts listed in parts.txt; the parts are
                         joined into one function body, so they share its scope
  board/scene/           the Home screen picture, the same way
  board/letters.js       the keepers' letters
  board/server-layer.js  how the page talks to the board server (the "@data-layer" part of the script)
  board/vendor/          morphdom (MIT), which patches the page in place

Edit the sources and run this script; never edit public/index.html."""
import argparse
import base64
import os

HERE = os.path.dirname(os.path.abspath(__file__))
BOARD = os.path.join(HERE, "..", "board")


def read(*parts):
    with open(os.path.join(BOARD, *parts), encoding="utf-8") as f:
        return f.read()


def part_names(folder):
    lines = read(folder, "parts.txt").splitlines()
    return [x.strip() for x in lines if x.strip() and not x.strip().startswith("#")]


def joined(folder, layer):
    """Join listed parts, omitting source-only comments from the shared presence module."""
    out = []
    for name in part_names(folder):
        if name == "@shift-presence":
            with open(os.path.join(HERE, "shift-presence.js"), encoding="utf-8") as source:
                out.append("".join(line for line in source if not line.lstrip().startswith("//")))
        else:
            out.append(layer if name == "@data-layer" else read(folder, name).strip("\n"))
    return "\n".join(out)


def function_body(text):
    return '(function () {\n  "use strict";\n' + text + "\n})();"


def fill(s, marker, text):
    assert s.count(marker) == 1, marker
    return s.replace(marker, text)


def inline_images(scene):
    oak = base64.b64encode(open(os.path.join(BOARD, "tree-oak.png"), "rb").read()).decode("ascii")
    assert scene.count('const treeOakUrl = "tree-oak.png";') == 1
    oak_line = 'const treeOakUrl = "data:image/png;base64,' + oak + '";'
    scene = scene.replace('const treeOakUrl = "tree-oak.png";', oak_line)
    for n in range(1, 5):
        name = f"cat-sky-{n}.png"
        png = base64.b64encode(open(os.path.join(BOARD, name), "rb").read()).decode("ascii")
        assert scene.count(f'"{name}"') == 1, name
        scene = scene.replace(f'"{name}"', f'"data:image/png;base64,{png}"')
    return scene


def build():
    s = read("index.html")
    layer = read("server-layer.js").rstrip("\n")
    s = fill(s, "/*STYLE*/", joined("style", ""))
    s = fill(s, "/*APP*/", function_body(joined("app", layer)))
    theme = '<meta name="theme-color" content="#0F1720" />'
    s = fill(s, theme, "\n".join([
        theme,
        '<meta name="apple-mobile-web-app-title" content="Lighthouse">',
        '<link rel="manifest" href="/manifest.webmanifest">',
        '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    ]))

    s = fill(s, "/*MORPHDOM*/", read("vendor", "morphdom-umd.min.js").strip())
    scene = function_body(joined("scene", ""))
    s = fill(s, "/*SCENE*/", inline_images(scene))
    s = fill(s, "/*LETTERS*/", read("letters.js").strip())

    return s


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.parse_args()
    dst = os.path.join(HERE, "public", "index.html")
    s = build()
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    with open(dst, "w", encoding="utf-8", newline="\n") as f:
        f.write(s)
    print("wrote", dst, len(s), "bytes")


if __name__ == "__main__":
    main()
