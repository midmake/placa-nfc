import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
// Exact crop of the first G from the supplied transparent official artwork.
// No font substitution or redraw. Generated files are committed.
const require = createRequire(
  process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
    ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/package.json"
    : import.meta.url,
);
const sharp = require("sharp");
const symbol = await sharp("public/gear-go-oficial.png")
  .extract({ left: 40, top: 110, width: 400, height: 410 })
  .png()
  .toBuffer();
mkdirSync("public/icons", { recursive: true });
for (const [name, size, fraction] of [
  ["favicon", 48, 0.86],
  ["apple-touch-icon", 180, 0.82],
  ["icon-192", 192, 0.82],
  ["icon-512", 512, 0.82],
  ["maskable-512", 512, 0.68],
]) {
  const inner = Math.floor(size * fraction);
  const mark = await sharp(symbol)
    .resize(inner, inner, { fit: "inside" })
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: "#4782d4" },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toFile(`public/icons/${name}.png`);
}
