import { mkdir, cp, writeFile, access, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import "./build-worker.mjs";
await mkdir("public/models", { recursive: true });
await cp("node_modules/@mediapipe/tasks-vision/wasm", "public/wasm", {
  recursive: true,
});
const path = "public/models/pose_landmarker_lite.task";
try {
  await access(path);
  console.log("Pose model already present.");
} catch {
  const url =
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
  console.log("Downloading version 1 of the local pose model…");
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Model download failed: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length < 1000000) throw new Error("Invalid model download");
  await writeFile(path, data);
  console.log(
    `Model saved (${data.length} bytes), SHA256 ${createHash("sha256").update(data).digest("hex")}`,
  );
}
const hash = createHash("sha256")
  .update(await readFile(path))
  .digest("hex");
if (hash !== "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a")
  throw new Error(
    "Pose model checksum mismatch. Remove public/models/pose_landmarker_lite.task and rerun npm run setup.",
  );
console.log(
  "Offline runtime assets ready. Model checksum verified. Camera frames never leave the browser.",
);
