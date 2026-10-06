import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
// User-approved square PWA artwork, supplied 2026-10-06.
// Preserve the whole image: no redraw, letter substitution or logo crop.
const require = createRequire(
  process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
    ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/package.json"
    : import.meta.url,
);
const sharp = require("sharp");
const symbol = await sharp("assets/brand/pwa-approved.jpeg")
  .png()
  .toBuffer();
mkdirSync("public/icons", { recursive: true });
for (const [name, size, fraction] of [
  ["favicon", 48, 1],
  ["apple-touch-icon", 180, 1],
  ["icon-192", 192, 1],
  ["icon-512", 512, 1],
  ["maskable-512", 512, 0.56],
]) {
  const inner = Math.floor(size * fraction);
  const mark = await sharp(symbol)
    .resize(inner, inner, { fit: "inside" })
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: "#06174b" },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toFile(`public/icons/${name}.png`);
}
