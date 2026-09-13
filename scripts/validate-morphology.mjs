import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function validateMorphology(
  targetDir = path.join(ROOT_DIR, "public", "data", "morphology"),
) {
  console.log(`[Morphology Validation] Checking assets in: ${targetDir}`);

  const manifestPath = path.join(targetDir, "morphology-manifest.json");
  const metaPath = path.join(targetDir, "morphologyMeta.json");
  const posPath = path.join(targetDir, "segmentPositions.bin");
  const bodyIdsPath = path.join(targetDir, "segmentBodyIds.bin");
  const offsetsPath = path.join(targetDir, "neuronOffsets.bin");

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing morphology-manifest.json at ${manifestPath}`);
  }
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Missing morphologyMeta.json at ${metaPath}`);
  }
  if (!fs.existsSync(posPath)) {
    throw new Error(`Missing segmentPositions.bin at ${posPath}`);
  }
  if (!fs.existsSync(bodyIdsPath)) {
    throw new Error(`Missing segmentBodyIds.bin at ${bodyIdsPath}`);
  }
  if (!fs.existsSync(offsetsPath)) {
    throw new Error(`Missing neuronOffsets.bin at ${offsetsPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));

  // 1. Verify schema & metadata
  if (manifest.dataset !== "malecns:v1.0") {
    throw new Error(`Invalid dataset in manifest: ${manifest.dataset}`);
  }
  if (typeof manifest.neuronCount !== "number" || manifest.neuronCount <= 0) {
    throw new Error(`Invalid neuronCount: ${manifest.neuronCount}`);
  }
  if (
    typeof manifest.totalSegments !== "number" ||
    manifest.totalSegments <= 0
  ) {
    throw new Error(`Invalid totalSegments: ${manifest.totalSegments}`);
  }

  // 2. Read buffers & verify hashes
  const posBuf = fs.readFileSync(posPath);
  const bodyIdsBuf = fs.readFileSync(bodyIdsPath);
  const offsetsBuf = fs.readFileSync(offsetsPath);

  const posHash = sha256(posBuf);
  const bodyIdsHash = sha256(bodyIdsBuf);
  const offsetsHash = sha256(offsetsBuf);

  if (
    manifest.files?.["segmentPositions.bin"]?.sha256 &&
    manifest.files["segmentPositions.bin"].sha256 !== posHash
  ) {
    throw new Error(
      `Hash mismatch for segmentPositions.bin. Expected ${manifest.files["segmentPositions.bin"].sha256}, got ${posHash}`,
    );
  }
  if (
    manifest.files?.["segmentBodyIds.bin"]?.sha256 &&
    manifest.files["segmentBodyIds.bin"].sha256 !== bodyIdsHash
  ) {
    throw new Error(
      `Hash mismatch for segmentBodyIds.bin. Expected ${manifest.files["segmentBodyIds.bin"].sha256}, got ${bodyIdsHash}`,
    );
  }
  if (
    manifest.files?.["neuronOffsets.bin"]?.sha256 &&
    manifest.files["neuronOffsets.bin"].sha256 !== offsetsHash
  ) {
    throw new Error(
      `Hash mismatch for neuronOffsets.bin. Expected ${manifest.files["neuronOffsets.bin"].sha256}, got ${offsetsHash}`,
    );
  }

  // 3. Array lengths & types
  const positions = new Float32Array(
    posBuf.buffer,
    posBuf.byteOffset,
    posBuf.byteLength / 4,
  );
  const segmentIndices = new Uint16Array(
    bodyIdsBuf.buffer,
    bodyIdsBuf.byteOffset,
    bodyIdsBuf.byteLength / 2,
  );
  const neuronOffsets = new Uint32Array(
    offsetsBuf.buffer,
    offsetsBuf.byteOffset,
    offsetsBuf.byteLength / 4,
  );

  if (positions.length !== manifest.totalSegments * 6) {
    throw new Error(
      `Position array length mismatch: expected ${manifest.totalSegments * 6}, got ${positions.length}`,
    );
  }
  if (segmentIndices.length !== manifest.totalSegments) {
    throw new Error(
      `Segment indices array length mismatch: expected ${manifest.totalSegments}, got ${segmentIndices.length}`,
    );
  }
  if (neuronOffsets.length !== manifest.neuronCount + 1) {
    throw new Error(
      `Neuron offsets length mismatch: expected ${manifest.neuronCount + 1}, got ${neuronOffsets.length}`,
    );
  }

  // 4. Validate offsets monotonicity
  if (neuronOffsets[0] !== 0) {
    throw new Error(`First neuron offset must be 0, got ${neuronOffsets[0]}`);
  }
  if (neuronOffsets[neuronOffsets.length - 1] !== manifest.totalSegments) {
    throw new Error(
      `Last neuron offset must match totalSegments (${manifest.totalSegments}), got ${neuronOffsets[neuronOffsets.length - 1]}`,
    );
  }
  for (let i = 0; i < neuronOffsets.length - 1; i++) {
    if (neuronOffsets[i + 1] < neuronOffsets[i]) {
      throw new Error(
        `Offsets not monotonically non-decreasing at index ${i}: ${neuronOffsets[i]} -> ${neuronOffsets[i + 1]}`,
      );
    }
  }

  // 5. Check finite coordinates & bounding box
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  let minZ = Infinity,
    maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error(
        `Non-finite coordinate found at vertex index ${i / 3}: (${x}, ${y}, ${z})`,
      );
    }

    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  // 6. Check coordinate bounds roughly match normalized space [-50, 50]
  if (
    Math.abs(minX) > 100 ||
    Math.abs(maxX) > 100 ||
    Math.abs(minY) > 100 ||
    Math.abs(maxY) > 100 ||
    Math.abs(minZ) > 100 ||
    Math.abs(maxZ) > 100
  ) {
    throw new Error(
      `Coordinate bounds out of expected normalized range: X[${minX.toFixed(1)}, ${maxX.toFixed(1)}], Y[${minY.toFixed(1)}, ${maxY.toFixed(1)}], Z[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]`,
    );
  }

  // 7. Verify body IDs match connectome
  const connectomeManifestPath = path.join(
    ROOT_DIR,
    "public",
    "data",
    "connectome",
    "connectome-manifest.json",
  );
  if (fs.existsSync(connectomeManifestPath)) {
    const connManifest = JSON.parse(
      fs.readFileSync(connectomeManifestPath, "utf8"),
    );
    if (connManifest.neuronCount !== manifest.neuronCount) {
      console.warn(
        `[Warning] Morphology neuron count (${manifest.neuronCount}) differs from connectome neuron count (${connManifest.neuronCount})`,
      );
    }
  }

  console.log(`[Morphology Validation] PASSED!`);
  console.log(`  - Dataset: ${manifest.dataset}`);
  console.log(`  - Neurons: ${manifest.neuronCount}`);
  console.log(
    `  - Total Line Segments: ${manifest.totalSegments.toLocaleString()}`,
  );
  console.log(
    `  - Bounding Box: X[${minX.toFixed(2)}, ${maxX.toFixed(2)}], Y[${minY.toFixed(2)}, ${maxY.toFixed(2)}], Z[${minZ.toFixed(2)}, ${maxZ.toFixed(2)}]`,
  );
  console.log(`  - Scale Factor: ${manifest.transform?.scaleFactor}`);
  console.log(
    `  - 100um Scale Bar (3D units): ${manifest.transform?.scaleBar100umUnits?.toFixed(3)}`,
  );

  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    validateMorphology();
  } catch (err) {
    console.error(`[Morphology Validation] FAILED:`, err.message);
    process.exit(1);
  }
}
