import { access } from "node:fs/promises";
for (const path of [
  "public/models/pose_landmarker_lite.task",
  "public/wasm/vision_wasm_internal.wasm",
  "public/pose-worker.js",
]) {
  try {
    await access(path);
  } catch {
    throw new Error(`Missing ${path}. Run npm run setup before building.`);
  }
}
