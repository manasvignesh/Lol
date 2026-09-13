import { readFileSync, existsSync, createReadStream } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

function tryPythonValidation() {
  const pyCandidates = [
    resolve(process.cwd(), ".venv", "Scripts", "python.exe"),
    resolve(process.cwd(), ".venv", "bin", "python"),
    "python",
    "python3",
  ];

  for (const py of pyCandidates) {
    try {
      const res = spawnSync(py, ["tools/connectome/validate_connectome.py"], {
        stdio: "inherit",
        cwd: process.cwd(),
      });
      if (res.status === 0) {
        return true;
      }
    } catch {
      // Continue to next candidate
    }
  }
  return false;
}

function computeFileHash(filePath) {
  const fileBuffer = readFileSync(filePath);
  return createHash("sha256").update(fileBuffer).digest("hex");
}

function validateDir(dirPath) {
  const dir = resolve(process.cwd(), dirPath);
  console.log(`\n=======================================================`);
  console.log(`   MaleCNS CONNECTOME VALIDATION: ${dirPath}`);
  console.log(`=======================================================`);

  const manifestFile = join(dir, "manifest.json");
  const neuronsFile = join(dir, "neurons.json");
  const indptrFile = join(dir, "indptr.bin");
  const indicesFile = join(dir, "indices.bin");
  const weightsFile = join(dir, "weights.bin");
  const bioWeightsFile = join(dir, "biologicalWeights.bin");
  const signsFile = join(dir, "signs.bin");

  for (const f of [
    manifestFile,
    neuronsFile,
    indptrFile,
    indicesFile,
    weightsFile,
    bioWeightsFile,
    signsFile,
  ]) {
    if (!existsSync(f)) {
      console.error(`[FAIL] Missing required asset: ${f}`);
      return false;
    }
  }

  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const neurons = JSON.parse(readFileSync(neuronsFile, "utf8"));

  const toAB = (b) => new Uint8Array(b).buffer;
  const indptr = new Uint32Array(toAB(readFileSync(indptrFile)));
  const indices = new Uint32Array(toAB(readFileSync(indicesFile)));
  const weights = new Float32Array(toAB(readFileSync(weightsFile)));
  const biologicalWeights = new Uint32Array(toAB(readFileSync(bioWeightsFile)));
  const signs = new Int8Array(toAB(readFileSync(signsFile)));

  const errors = [];

  if (manifest.provenance !== "malecns-real") {
    errors.push(
      `Invalid provenance: expected 'malecns-real', got '${manifest.provenance}'`,
    );
  }
  if (manifest.dataset !== "MaleCNS") {
    errors.push(
      `Invalid dataset: expected 'MaleCNS', got '${manifest.dataset}'`,
    );
  }

  const nNeurons = neurons.length;
  const nEdges = indices.length;
  const bioSynapsesTotal = biologicalWeights.reduce((acc, w) => acc + w, 0);

  if (manifest.neuronCount !== nNeurons) {
    errors.push(
      `Manifest neuronCount (${manifest.neuronCount}) != neurons.json length (${nNeurons})`,
    );
  }
  const edgeCount = manifest.edgeCount ?? manifest.synapseCount;
  if (edgeCount !== nEdges) {
    errors.push(
      `Manifest edgeCount (${edgeCount}) != indices length (${nEdges})`,
    );
  }
  if (
    manifest.biologicalSynapseTotal !== undefined &&
    manifest.biologicalSynapseTotal !== bioSynapsesTotal
  ) {
    errors.push(
      `Manifest biologicalSynapseTotal (${manifest.biologicalSynapseTotal}) != sum(biologicalWeights) (${bioSynapsesTotal})`,
    );
  }
  if (indptr.length !== nNeurons + 1) {
    errors.push(
      `indptr length (${indptr.length}) != neuronCount + 1 (${nNeurons + 1})`,
    );
  }
  if (weights.length !== nEdges) {
    errors.push(
      `weights length (${weights.length}) != indices length (${nEdges})`,
    );
  }
  if (biologicalWeights.length !== nEdges) {
    errors.push(
      `biologicalWeights length (${biologicalWeights.length}) != indices length (${nEdges})`,
    );
  }
  if (signs.length !== nEdges) {
    errors.push(`signs length (${signs.length}) != indices length (${nEdges})`);
  }

  const bodyIds = new Set();
  let syntheticCount = 0;
  let visualCount = 0;
  let cxCount = 0;
  let descendingCount = 0;
  let vncCount = 0;
  let protocerebrumCount = 0;

  for (let i = 0; i < nNeurons; i++) {
    const neuron = neurons[i];
    const bId = String(neuron.bodyId || "");
    if (!/^\d+$/.test(bId)) {
      syntheticCount++;
      if (syntheticCount <= 5) {
        errors.push(
          `Neuron at index ${i} has non-numeric synthetic body ID: '${bId}'`,
        );
      }
    }
    if (bodyIds.has(bId)) {
      errors.push(`Duplicate bodyId found: '${bId}'`);
    }
    bodyIds.add(bId);

    if (neuron.index !== i) {
      errors.push(`Neuron index mismatch: expected ${i}, got ${neuron.index}`);
    }

    const t = String(neuron.type || "").toLowerCase();
    const name = String(neuron.name || "").toLowerCase();
    if (
      t.includes("racket") ||
      t.includes("badminton") ||
      t.includes("smashneuron") ||
      name.includes("racket")
    ) {
      errors.push(
        `Illegal synthetic badminton neuron in biological graph: '${neuron.name}'`,
      );
    }

    if (neuron.region === "OpticLobe") visualCount++;
    else if (neuron.region === "CentralComplex") cxCount++;
    else if (neuron.region === "Descending") descendingCount++;
    else if (neuron.region === "VNC") vncCount++;
    else if (neuron.region === "Protocerebrum") protocerebrumCount++;
  }

  if (indptr[0] !== 0) errors.push(`indptr[0] must be 0, got ${indptr[0]}`);
  if (indptr[nNeurons] !== nEdges)
    errors.push(
      `indptr[${nNeurons}] (${indptr[nNeurons]}) must equal nEdges (${nEdges})`,
    );

  for (let i = 0; i < nNeurons; i++) {
    if (indptr[i] > indptr[i + 1]) {
      errors.push(`indptr monotonicity violation at ${i}`);
      break;
    }
  }

  for (let e = 0; e < nEdges; e++) {
    if (indices[e] >= nNeurons) {
      errors.push(`indices[${e}] (${indices[e]}) >= neuronCount (${nNeurons})`);
      break;
    }
    if (isNaN(weights[e]) || !isFinite(weights[e]) || weights[e] <= 0) {
      errors.push(`Invalid weight at edge ${e}: ${weights[e]}`);
      break;
    }
    if (biologicalWeights[e] <= 0) {
      errors.push(
        `Invalid biological weight at edge ${e}: ${biologicalWeights[e]}`,
      );
      break;
    }
    if (signs[e] !== -1 && signs[e] !== 0 && signs[e] !== 1) {
      errors.push(`Invalid sign at edge ${e}: ${signs[e]}`);
      break;
    }
  }

  console.log(
    `Dataset          ${manifest.dataset} ${manifest.datasetVersion}`,
  );
  console.log(`Provenance       ${String(manifest.provenance).toUpperCase()}`);
  console.log(`Real Neurons     ${nNeurons.toLocaleString()}`);
  console.log(`Biological Edges ${nEdges.toLocaleString()}`);
  console.log(
    `Total Synapses   ${bioSynapsesTotal.toLocaleString()} biological synaptic contacts`,
  );
  console.log();
  console.log(
    `Real body IDs    ${bodyIds.size.toLocaleString()} / ${nNeurons.toLocaleString()}`,
  );
  console.log(`Synthetic IDs    ${syntheticCount}`);
  console.log();
  console.log(`Visual neurons   ${visualCount.toLocaleString()}`);
  console.log(`Central Complex  ${cxCount.toLocaleString()}`);
  console.log(`Protocerebrum    ${protocerebrumCount.toLocaleString()}`);
  console.log(`Descending       ${descendingCount.toLocaleString()}`);
  console.log(`VNC motor        ${vncCount.toLocaleString()}`);
  console.log();
  console.log(`CSR integrity    ${errors.length === 0 ? "PASS" : "FAIL"}`);
  console.log(`Metadata         ${syntheticCount === 0 ? "PASS" : "FAIL"}`);
  console.log(
    `Provenance       ${manifest.provenance === "malecns-real" ? "PASS" : "FAIL"}`,
  );
  console.log(`-------------------------------------------------------`);

  if (errors.length > 0) {
    console.error(
      `[FAIL] Connectome validation failed with ${errors.length} errors:`,
    );
    for (const err of errors.slice(0, 10)) {
      console.error(`  - ${err}`);
    }
    return false;
  }

  console.log("CONNECTOME VALID: Real MaleCNS v1.0 biological graph verified.");
  return true;
}

if (!tryPythonValidation()) {
  const dirs = ["data/connectome", "public/data/connectome"];
  let allOk = true;
  for (const d of dirs) {
    if (!validateDir(d)) allOk = false;
  }
  if (!allOk) {
    process.exit(1);
  }
}
