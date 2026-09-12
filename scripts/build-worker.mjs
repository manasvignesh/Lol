import { build } from "esbuild";

await build({
  entryPoints: ["src/pose.worker.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: "public/pose-worker.js",
  minify: true,
});

await build({
  entryPoints: ["src/flybrain/neural.worker.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: "public/neural-worker.js",
  external: ["node:fs", "node:path", "node:module"],
  minify: true,
});
