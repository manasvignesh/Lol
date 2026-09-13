import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function preprocessMorphology(maxSegmentsPerNeuron = 400) {
  const t0 = Date.now();
  const neuronsFile = path.join(ROOT_DIR, 'public', 'data', 'connectome', 'neurons.json');
  const neurons = JSON.parse(fs.readFileSync(neuronsFile, 'utf8'));
  const rawDir = path.join(ROOT_DIR, 'data', 'morphology', 'raw');

  const outputDirs = [
    path.join(ROOT_DIR, 'data', 'morphology'),
    path.join(ROOT_DIR, 'public', 'data', 'morphology'),
  ];
  for (const d of outputDirs) {
    fs.mkdirSync(d, { recursive: true });
  }

  console.log('=== PREPROCESSING MALECNS NEURON MORPHOLOGY (NODE.JS) ===');
  console.log(`Total neurons in graph: ${neurons.length}`);

  // Pass 1: Scan bounds
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let totalRawNodes = 0;
  let validSkeletonsCount = 0;

  for (let i = 0; i < neurons.length; i++) {
    const bid = neurons[i].bodyId;
    const filePath = path.join(rawDir, `${bid}.json`);
    if (!fs.existsSync(filePath)) continue;

    try {
      const rawText = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(rawText);
      const rows = data.data || [];
      if (rows.length > 0) {
        validSkeletonsCount++;
        totalRawNodes += rows.length;
        for (let r = 0; r < rows.length; r++) {
          const row = rows[r];
          const x = row[1], y = row[2], z = row[3];
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
      }
    } catch {
      // skip corrupted
    }
  }

  console.log(`Skeletons found: ${validSkeletonsCount} / ${neurons.length}`);
  console.log(`Total raw SWC nodes: ${totalRawNodes.toLocaleString()}`);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const spanZ = maxZ - minZ;
  const maxSpan = Math.max(spanX, spanY, spanZ);

  // Global uniform scale factor: maps max anatomical dimension to 2.4 visualization units
  const globalScale = 2.4 / maxSpan;
  // MaleCNS voxel: 8nm -> 100um = 12,500 voxels
  const scaleBar100umVis = 12500.0 * globalScale;

  console.log(`Global bounds (voxels): X=[${minX.toFixed(0)}, ${maxX.toFixed(0)}], Y=[${minY.toFixed(0)}, ${maxY.toFixed(0)}], Z=[${minZ.toFixed(0)}, ${maxZ.toFixed(0)}]`);
  console.log(`Center (voxels): [${centerX.toFixed(1)}, ${centerY.toFixed(1)}, ${centerZ.toFixed(1)}]`);
  console.log(`Global scale: ${globalScale.toFixed(8)} (100 um = ${scaleBar100umVis.toFixed(4)} vis units)`);

  // Pass 2: Build segments
  const posChunks = [];
  const bodyIdChunks = [];
  const neuronOffsets = [0];
  const morphologyMeta = [];
  let totalSegments = 0;

  for (let idx = 0; idx < neurons.length; idx++) {
    const n = neurons[idx];
    const bid = n.bodyId;
    const filePath = path.join(rawDir, `${bid}.json`);

    let rows = [];
    if (fs.existsSync(filePath)) {
      try {
        const rawText = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(rawText);
        rows = data.data || [];
      } catch {}
    }

    if (rows.length === 0) {
      morphologyMeta.push({
        index: idx,
        bodyId: bid,
        hasMorphology: false,
        nodeCount: 0,
        segmentCount: 0,
        region: n.region || 'Protocerebrum',
        type: n.type || '',
        instance: n.instance || '',
        hemisphere: n.hemisphere || 'R',
        neurotransmitter: n.neurotransmitter || 'unknown',
        centroid: [0, 0, 0],
        bounds: { min: [0, 0, 0], max: [0, 0, 0] },
      });
      neuronOffsets.push(totalSegments);
      continue;
    }

    // Build node map
    const nodeMap = new Map();
    let nMinX = Infinity, nMaxX = -Infinity;
    let nMinY = Infinity, nMaxY = -Infinity;
    let nMinZ = Infinity, nMaxZ = -Infinity;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const rowId = row[0];
      const rx = row[1], ry = row[2], rz = row[3];
      const rad = row[4] !== undefined ? row[4] : 1.0;
      const link = row[5] !== undefined ? row[5] : -1;

      const vx = (rx - centerX) * globalScale;
      const vy = -(ry - centerY) * globalScale; // Invert Y
      const vz = (rz - centerZ) * globalScale;

      nodeMap.set(rowId, { vx, vy, vz, rad, link });

      if (vx < nMinX) nMinX = vx;
      if (vx > nMaxX) nMaxX = vx;
      if (vy < nMinY) nMinY = vy;
      if (vy > nMaxY) nMaxY = vy;
      if (vz < nMinZ) nMinZ = vz;
      if (vz > nMaxZ) nMaxZ = vz;
    }

    // Collect segments
    let neuronSegs = [];
    for (const [rowId, node] of nodeMap.entries()) {
      if (node.link !== -1 && nodeMap.has(node.link)) {
        const parent = nodeMap.get(node.link);
        neuronSegs.push(parent.vx, parent.vy, parent.vz, node.vx, node.vy, node.vz);
      }
    }

    const segCountBefore = neuronSegs.length / 6;
    if (segCountBefore > maxSegmentsPerNeuron) {
      const step = segCountBefore / maxSegmentsPerNeuron;
      const decimated = [];
      for (let s = 0; s < maxSegmentsPerNeuron; s++) {
        const segIdx = Math.floor(s * step) * 6;
        for (let k = 0; k < 6; k++) {
          decimated.push(neuronSegs[segIdx + k]);
        }
      }
      neuronSegs = decimated;
    }

    const finalSegCount = neuronSegs.length / 6;
    totalSegments += finalSegCount;
    neuronOffsets.push(totalSegments);

    posChunks.push(new Float32Array(neuronSegs));
    const bArray = new Uint16Array(finalSegCount);
    bArray.fill(idx);
    bodyIdChunks.push(bArray);

    morphologyMeta.push({
      index: idx,
      bodyId: bid,
      hasMorphology: true,
      nodeCount: rows.length,
      segmentCount: finalSegCount,
      region: n.region || 'Protocerebrum',
      type: n.type || '',
      instance: n.instance || '',
      hemisphere: n.hemisphere || 'R',
      neurotransmitter: n.neurotransmitter || 'unknown',
      centroid: [
        Number(((nMinX + nMaxX) / 2).toFixed(4)),
        Number(((nMinY + nMaxY) / 2).toFixed(4)),
        Number(((nMinZ + nMaxZ) / 2).toFixed(4)),
      ],
      bounds: {
        min: [Number(nMinX.toFixed(4)), Number(nMinY.toFixed(4)), Number(nMinZ.toFixed(4))],
        max: [Number(nMaxX.toFixed(4)), Number(nMaxY.toFixed(4)), Number(nMaxZ.toFixed(4))],
      },
    });
  }

  console.log(`Total rendered line segments: ${totalSegments.toLocaleString()}`);

  // Merge binary buffers
  const mergedPositions = new Float32Array(totalSegments * 6);
  let posOffset = 0;
  for (const chunk of posChunks) {
    mergedPositions.set(chunk, posOffset);
    posOffset += chunk.length;
  }

  const mergedBodyIds = new Uint16Array(totalSegments);
  let bodyOffset = 0;
  for (const chunk of bodyIdChunks) {
    mergedBodyIds.set(chunk, bodyOffset);
    bodyOffset += chunk.length;
  }

  const offsetsArray = new Uint32Array(neuronOffsets);

  const posBuf = Buffer.from(mergedPositions.buffer);
  const bodyBuf = Buffer.from(mergedBodyIds.buffer);
  const offsetBuf = Buffer.from(offsetsArray.buffer);
  const metaBuf = Buffer.from(JSON.stringify(morphologyMeta));

  const manifest = {
    dataset: 'malecns:v1.0',
    datasetName: 'MaleCNS',
    datasetVersion: 'v1.0',
    provenance: 'official-janelia-neuprint-swc',
    neuronCount: neurons.length,
    morphologyNeurons: validSkeletonsCount,
    missingMorphologyCount: neurons.length - validSkeletonsCount,
    totalRawNodes: totalRawNodes,
    totalSegments: totalSegments,
    rawVoxelSizeNm: [8, 8, 8],
    coordinateUnits: 'male_cns_8nm_voxels',
    transform: {
      center: [Number(centerX.toFixed(2)), Number(centerY.toFixed(2)), Number(centerZ.toFixed(2))],
      scaleFactor: globalScale,
      scaleBar100umUnits: Number(scaleBar100umVis.toFixed(4)),
      boundsMin: [Number(minX.toFixed(1)), Number(minY.toFixed(1)), Number(minZ.toFixed(1))],
      boundsMax: [Number(maxX.toFixed(1)), Number(maxY.toFixed(1)), Number(maxZ.toFixed(1))],
    },
    files: {
      'segmentPositions.bin': { sha256: sha256(posBuf), byteLength: posBuf.byteLength },
      'segmentBodyIds.bin': { sha256: sha256(bodyBuf), byteLength: bodyBuf.byteLength },
      'neuronOffsets.bin': { sha256: sha256(offsetBuf), byteLength: offsetBuf.byteLength },
      'morphologyMeta.json': { sha256: sha256(metaBuf), byteLength: metaBuf.byteLength },
    },
  };

  for (const outDir of outputDirs) {
    fs.writeFileSync(path.join(outDir, 'segmentPositions.bin'), posBuf);
    fs.writeFileSync(path.join(outDir, 'segmentBodyIds.bin'), bodyBuf);
    fs.writeFileSync(path.join(outDir, 'neuronOffsets.bin'), offsetBuf);
    fs.writeFileSync(path.join(outDir, 'morphologyMeta.json'), metaBuf);
    fs.writeFileSync(path.join(outDir, 'morphology-manifest.json'), JSON.stringify(manifest, null, 2));
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`\nAll morphology binary buffers generated and saved in ${elapsed}s!`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  preprocessMorphology();
}
