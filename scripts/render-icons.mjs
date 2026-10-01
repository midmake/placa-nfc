import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
// Optional development helper. Generated PNG files are committed, so builds need
// no image library. Uses the shared runtime here, or an installed sharp locally.
const require = createRequire(
  process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
    ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/package.json"
    : import.meta.url,
);
const sharp = require("sharp"),
  svg = readFileSync("public/logo.svg");
mkdirSync("public/icons", { recursive: true });
for (const [name, size] of [
  ["icon-192", 192],
  ["icon-512", 512],
  ["apple-touch-icon", 180],
])
  await sharp(svg).resize(size, size).png().toFile(`public/icons/${name}.png`);
const padded = await sharp(svg).resize(380, 380).png().toBuffer();
await sharp({
  create: { width: 512, height: 512, channels: 4, background: "#102729" },
})
  .composite([{ input: padded, gravity: "centre" }])
  .png()
  .toFile("public/icons/maskable-512.png");
