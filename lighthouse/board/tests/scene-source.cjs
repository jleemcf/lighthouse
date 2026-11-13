// The Home screen picture's script as the page build joins it (server/make-page.py): the parts listed in
// board/scene/parts.txt, in order, as the body of one function, or board/scene.js while the picture is one file.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const BOARD = path.join(__dirname, "..");

module.exports = function sceneSource() {
  const folder = path.join(BOARD, "scene");
  if (!fs.existsSync(folder)) return fs.readFileSync(path.join(BOARD, "scene.js"), "utf8");
  const names = fs
    .readFileSync(path.join(folder, "parts.txt"), "utf8")
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(x => x && !x.startsWith("#"));
  const body = names.map(n => fs.readFileSync(path.join(folder, n), "utf8").replace(/^\n+|\n+$/g, "")).join("\n");
  return '(function () {\n  "use strict";\n' + body + "\n})();";
};
