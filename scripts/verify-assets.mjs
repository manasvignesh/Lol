import { access } from "node:fs/promises";
for (const path of [
  "public/models/pose_landmarker_lite.task",
  "public/wasm/vision_wasm_internal.wasm",
  "public/pose-worker.js",
  "public/neural-worker.js",
  "public/data/connectome/manifest.json",
  "public/data/connectome/neurons.json",
  "public/data/connectome/indptr.bin",
  "public/data/connectome/indices.bin",
  "public/data/connectome/weights.bin",
  "public/data/connectome/signs.bin",
  "public/data/morphology/morphology-manifest.json",
  "public/data/morphology/morphologyMeta.json",
  "public/data/morphology/segmentPositions.bin",
  "public/data/morphology/segmentBodyIds.bin",
  "public/data/morphology/neuronOffsets.bin",
]) {
  try {
    await access(path);
  } catch {
    throw new Error(`Missing ${path}. Run npm run setup before building.`);
  }
}
