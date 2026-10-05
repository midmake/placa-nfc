import { build } from "esbuild";
await build({
  entryPoints: ["src/print/worker.ts"],
  outfile: "public/print-worker.js",
  bundle: true,
  minify: true,
  platform: "browser",
  target: "es2022",
  format: "iife",
  legalComments: "eof",
});
