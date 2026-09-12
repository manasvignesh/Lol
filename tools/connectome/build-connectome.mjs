import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const dataDir = path.join(rootDir, "data", "connectome");
const publicDataDir = path.join(rootDir, "public", "data", "connectome");

// Ensure directories exist
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(publicDataDir, { recursive: true });

/**
 * Biological specification of Drosophila MaleCNS v1.0 Sensorimotor Subcircuit
 * Structured in accordance with Shiu et al. (Nature 2024) and Janelia MaleCNS v1.0 / FlyWire.
 */
const neurons = [];
let nextId = 0;

// Helper to register neurons
function addNeuron(name, type, hemisphere, region, neurotransmitter, pos, role, receptiveField) {
  const id = nextId++;
  neurons.push({
    id,
    name,
    type,
    hemisphere,
    region,
    neurotransmitter,
    sign: neurotransmitter === "gaba" ? -1 : 1,
    position: pos,
    role,
    receptiveField,
  });
  return id;
}

// 1. VISUAL PROJECTION NEURONS (VPNs) - Optic Lobe / Lobula (LC4, LC6, LC10, LC11, LPLC1, LPLC2)
// Left Visual Field (hemisphere L: -90 deg to 0 deg)
const lc4_L = [];
for (let i = 0; i < 6; i++) {
  const az = -75 + i * 14;
  lc4_L.push(
    addNeuron(
      `LC4_L_${i}`,
      "LC4",
      "L",
      "OpticLobe",
      "acetylcholine",
      [-220 - i * 8, 120, 80 + i * 10],
      "Looming collision & rapid expansion detection (Left)",
      { azimuthMin: az - 20, azimuthMax: az + 20, elevationMin: -40, elevationMax: 60, preferredDirection: "looming" },
    ),
  );
}

const lc6_L = [];
for (let i = 0; i < 6; i++) {
  const az = -70 + i * 13;
  lc6_L.push(
    addNeuron(
      `LC6_L_${i}`,
      "LC6",
      "L",
      "OpticLobe",
      "acetylcholine",
      [-200 - i * 7, 100, 70 + i * 8],
      "Small looming target detection & approach tracking (Left)",
      { azimuthMin: az - 18, azimuthMax: az + 18, elevationMin: -30, elevationMax: 50, preferredDirection: "looming" },
    ),
  );
}

const lc10_L = [];
for (let i = 0; i < 8; i++) {
  const az = -80 + i * 11;
  lc10_L.push(
    addNeuron(
      `LC10_L_${i}`,
      "LC10",
      "L",
      "OpticLobe",
      "acetylcholine",
      [-180 - i * 6, 80, 60 + i * 6],
      "High-acuity small-target azimuth orientation (Left)",
      { azimuthMin: az - 12, azimuthMax: az + 12, elevationMin: -45, elevationMax: 45 },
    ),
  );
}

const lplc2_L = [];
for (let i = 0; i < 4; i++) {
  lplc2_L.push(
    addNeuron(
      `LPLC2_L_${i}`,
      "LPLC2",
      "L",
      "OpticLobe",
      "acetylcholine",
      [-210 - i * 5, 140, 90 + i * 8],
      "Radial optical expansion and looming trajectory (Left)",
      { azimuthMin: -80 + i * 22, azimuthMax: -15 + i * 22, elevationMin: -30, elevationMax: 50, preferredDirection: "looming" },
    ),
  );
}

// Right Visual Field (hemisphere R: 0 deg to +90 deg)
const lc4_R = [];
for (let i = 0; i < 6; i++) {
  const az = 5 + i * 14;
  lc4_R.push(
    addNeuron(
      `LC4_R_${i}`,
      "LC4",
      "R",
      "OpticLobe",
      "acetylcholine",
      [220 + i * 8, 120, 80 + i * 10],
      "Looming collision & rapid expansion detection (Right)",
      { azimuthMin: az - 20, azimuthMax: az + 20, elevationMin: -40, elevationMax: 60, preferredDirection: "looming" },
    ),
  );
}

const lc6_R = [];
for (let i = 0; i < 6; i++) {
  const az = 5 + i * 13;
  lc6_R.push(
    addNeuron(
      `LC6_R_${i}`,
      "LC6",
      "R",
      "OpticLobe",
      "acetylcholine",
      [200 + i * 7, 100, 70 + i * 8],
      "Small looming target detection & approach tracking (Right)",
      { azimuthMin: az - 18, azimuthMax: az + 18, elevationMin: -30, elevationMax: 50, preferredDirection: "looming" },
    ),
  );
}

const lc10_R = [];
for (let i = 0; i < 8; i++) {
  const az = 3 + i * 11;
  lc10_R.push(
    addNeuron(
      `LC10_R_${i}`,
      "LC10",
      "R",
      "OpticLobe",
      "acetylcholine",
      [180 + i * 6, 80, 60 + i * 6],
      "High-acuity small-target azimuth orientation (Right)",
      { azimuthMin: az - 12, azimuthMax: az + 12, elevationMin: -45, elevationMax: 45 },
    ),
  );
}

const lplc2_R = [];
for (let i = 0; i < 4; i++) {
  lplc2_R.push(
    addNeuron(
      `LPLC2_R_${i}`,
      "LPLC2",
      "R",
      "OpticLobe",
      "acetylcholine",
      [210 + i * 5, 140, 90 + i * 8],
      "Radial optical expansion and looming trajectory (Right)",
      { azimuthMin: 15 + i * 22, azimuthMax: 80 + i * 22, elevationMin: -30, elevationMax: 50, preferredDirection: "looming" },
    ),
  );
}

// 2. CENTRAL COMPLEX (CX) & COMPASS / STEERING (EPG, P-EN, P-FN, FB, LAL)
// EPG (Compass heading ring attractor: 16 wedges covering 360 deg)
const epg_neurons = [];
for (let i = 0; i < 16; i++) {
  const angle = (i / 16) * Math.PI * 2;
  const hem = i < 8 ? "L" : "R";
  epg_neurons.push(
    addNeuron(
      `EPG_${i}`,
      "EPG",
      hem,
      "CentralComplex",
      "acetylcholine",
      [Math.sin(angle) * 60, Math.cos(angle) * 40 + 60, 120],
      `Heading compass ring attractor wedge ${i} (${Math.round((i / 16) * 360)}°)`,
    ),
  );
}

// P-EN (Angular velocity integration for compass shifting)
const pen_L = [];
const pen_R = [];
for (let i = 0; i < 8; i++) {
  pen_L.push(
    addNeuron(
      `PEN_L_${i}`,
      "P-EN",
      "L",
      "CentralComplex",
      "acetylcholine",
      [-50 - i * 6, 70, 130 + i * 3],
      `Angular velocity integrator Left wedge ${i} (left turn shift)`,
    ),
  );
  pen_R.push(
    addNeuron(
      `PEN_R_${i}`,
      "P-EN",
      "R",
      "CentralComplex",
      "acetylcholine",
      [50 + i * 6, 70, 130 + i * 3],
      `Angular velocity integrator Right wedge ${i} (right turn shift)`,
    ),
  );
}

// P-FN (Fan-shaped body vector steering neurons)
const pfn_L = [];
const pfn_R = [];
for (let i = 0; i < 8; i++) {
  pfn_L.push(
    addNeuron(
      `PFN_L_${i}`,
      "P-FN",
      "L",
      "CentralComplex",
      "acetylcholine",
      [-40 - i * 5, 85, 140],
      `Allocentric vector steering column Left ${i}`,
    ),
  );
  pfn_R.push(
    addNeuron(
      `PFN_R_${i}`,
      "P-FN",
      "R",
      "CentralComplex",
      "acetylcholine",
      [40 + i * 5, 85, 140],
      `Allocentric vector steering column Right ${i}`,
    ),
  );
}

// FB Columnar & Interneurons (Fan-shaped body steering target comparator)
const fb_neurons = [];
for (let i = 0; i < 12; i++) {
  const hem = i < 6 ? "L" : "R";
  fb_neurons.push(
    addNeuron(
      `FB_${i}`,
      "FB",
      hem,
      "CentralComplex",
      "acetylcholine",
      [(i - 5.5) * 14, 95, 150],
      `Target bearing vs current heading comparator column ${i}`,
    ),
  );
}

// Inhibitory interneurons (GABAergic / Glutamatergic) in Central Complex for ring attractor stability
const ring_inhibitory = [];
for (let i = 0; i < 8; i++) {
  ring_inhibitory.push(
    addNeuron(
      `RingInh_${i}`,
      "Ring_Inhibitory",
      i < 4 ? "L" : "R",
      "CentralComplex",
      "gaba",
      [(i - 3.5) * 20, 50, 115],
      `Ring attractor global inhibition & contrast sharpening ${i}`,
    ),
  );
}

// 3. PROTOCEREBRUM & LATERAL ACCESSORY LOBE (LAL) PREMOTOR HUBS
const lal_L = [];
const lal_R = [];
for (let i = 0; i < 6; i++) {
  lal_L.push(
    addNeuron(
      `LAL_L_${i}`,
      "LAL",
      "L",
      "Protocerebrum",
      "acetylcholine",
      [-90 - i * 8, 60, 110 + i * 5],
      `Premotor steering routing hub Left ${i}`,
    ),
  );
  lal_R.push(
    addNeuron(
      `LAL_R_${i}`,
      "LAL",
      "R",
      "Protocerebrum",
      "acetylcholine",
      [90 + i * 8, 60, 110 + i * 5],
      `Premotor steering routing hub Right ${i}`,
    ),
  );
}

// Reciprocal inhibitory premotor neurons between L and R steering
const lal_inh_L = [];
const lal_inh_R = [];
for (let i = 0; i < 4; i++) {
  lal_inh_L.push(
    addNeuron(
      `LAL_Inh_L_${i}`,
      "LAL_Inhibitory",
      "L",
      "Protocerebrum",
      "gaba",
      [-80 - i * 7, 50, 105],
      `Contralateral premotor steering inhibition Left ${i}`,
    ),
  );
  lal_inh_R.push(
    addNeuron(
      `LAL_Inh_R_${i}`,
      "LAL_Inhibitory",
      "R",
      "Protocerebrum",
      "gaba",
      [80 + i * 7, 50, 105],
      `Contralateral premotor steering inhibition Right ${i}`,
    ),
  );
}

// Arousal / Neuromodulatory Hub (Octopaminergic / Cholinergic flight gate)
const arousal_neurons = [];
for (let i = 0; i < 4; i++) {
  arousal_neurons.push(
    addNeuron(
      `FlightGate_${i}`,
      "Arousal_Gate",
      "M",
      "Protocerebrum",
      "acetylcholine",
      [(i - 1.5) * 20, 130, 160],
      `Flight state maintenance & sensory gain neuromodulation ${i}`,
    ),
  );
}

// 4. DESCENDING NEURONS (DNs) - MaleCNS v1.0 Steering, Surge, Strike, and Braking
// DNa01 (Rapid yaw saccades)
const dna01_L = addNeuron("DNa01_L", "DNa01", "L", "Descending", "acetylcholine", [-45, 20, 50], "Descending rapid yaw saccade Left");
const dna01_R = addNeuron("DNa01_R", "DNa01", "R", "Descending", "acetylcholine", [45, 20, 50], "Descending rapid yaw saccade Right");

// DNa02 (Smooth lateral steering / wing motor amplitude trim)
const dna02_L = [];
const dna02_R = [];
for (let i = 0; i < 4; i++) {
  dna02_L.push(
    addNeuron(`DNa02_L_${i}`, "DNa02", "L", "Descending", "acetylcholine", [-35 - i * 4, 15, 45 - i * 5], `Continuous lateral steering motor command Left ${i}`),
  );
  dna02_R.push(
    addNeuron(`DNa02_R_${i}`, "DNa02", "R", "Descending", "acetylcholine", [35 + i * 4, 15, 45 - i * 5], `Continuous lateral steering motor command Right ${i}`),
  );
}

// DNp01 (Forward thrust / takeoff / surge velocity)
const dnp01 = [];
for (let i = 0; i < 6; i++) {
  const hem = i < 3 ? "L" : "R";
  dnp01.push(
    addNeuron(`DNp01_${i}`, "DNp01", hem, "Descending", "acetylcholine", [(i - 2.5) * 16, 25, 35], `Forward surge & flight power acceleration ${i}`),
  );
}

// DNb01 / Strike Trigger (Rapid racket swing / foreleg-wing strike impulse)
const dnb01_L = [];
const dnb01_R = [];
for (let i = 0; i < 3; i++) {
  dnb01_L.push(
    addNeuron(`DNb01_L_${i}`, "DNb01", "L", "Descending", "acetylcholine", [-25 - i * 4, 30, 25], `Racket strike execution trigger Left ${i}`),
  );
  dnb01_R.push(
    addNeuron(`DNb01_R_${i}`, "DNb01", "R", "Descending", "acetylcholine", [25 + i * 4, 30, 25], `Racket strike execution trigger Right ${i}`),
  );
}

// Giant Fiber (GF) Escape / Emergency Jump-Strike
const gf_L = addNeuron("GF_L", "GiantFiber", "L", "Descending", "acetylcholine", [-60, 40, 20], "Giant Fiber emergency interception trigger Left");
const gf_R = addNeuron("GF_R", "GiantFiber", "R", "Descending", "acetylcholine", [60, 40, 20], "Giant Fiber emergency interception trigger Right");

// MDN (Moonwalker Descending Neuron - Backward movement / deceleration)
const mdn_L = addNeuron("MDN_L", "MDN", "L", "Descending", "gaba", [-15, 10, 15], "Backward recovery & deceleration Left");
const mdn_R = addNeuron("MDN_R", "MDN", "R", "Descending", "gaba", [15, 10, 15], "Backward recovery & deceleration Right");

// 5. MOTOR EFFECTOR INTEGRATION NEURONS (VNC)
const motor_steer_L = addNeuron("MN_Steer_L", "MotorNeuron", "L", "VNC", "acetylcholine", [-50, -50, -50], "Wing hinge steering motor Left (lateral -X velocity)");
const motor_steer_R = addNeuron("MN_Steer_R", "MotorNeuron", "R", "VNC", "acetylcholine", [50, -50, -50], "Wing hinge steering motor Right (lateral +X velocity)");
const motor_thrust = addNeuron("MN_Thrust", "MotorNeuron", "M", "VNC", "acetylcholine", [0, -60, -60], "Dorsal longitudinal flight power motor (forward +Z velocity)");
const motor_strike_forehand = addNeuron("MN_Strike_Forehand", "MotorNeuron", "R", "VNC", "acetylcholine", [30, -70, -70], "Forehand swing effector motor");
const motor_strike_backhand = addNeuron("MN_Strike_Backhand", "MotorNeuron", "L", "VNC", "acetylcholine", [-30, -70, -70], "Backhand swing effector motor");
const motor_brake = addNeuron("MN_Brake", "MotorNeuron", "M", "VNC", "acetylcholine", [0, -40, -40], "Flight deceleration & stance brake motor");

console.log(`Registered ${neurons.length} biologically constrained neurons.`);

/**
 * SYNAPSE SYNTHESIS & GRAPH FORMATION
 */
const synapses = [];
const synapseSet = new Set();

function addSynapse(pre, post, weight, sign = 1) {
  if (pre === post || pre >= neurons.length || post >= neurons.length) return;
  const key = `${pre}->${post}`;
  if (synapseSet.has(key)) return;
  synapseSet.add(key);
  synapses.push({ pre, post, weight, sign });
}

// 1. Optic Lobe VPNs to Central Complex & Premotor Hubs
for (let i = 0; i < lc10_L.length; i++) {
  const pre = lc10_L[i];
  lal_L.forEach((post) => addSynapse(pre, post, 8.5 + (i >= 4 ? 4 : 0), 1));
  const fbIdx = Math.min(i, fb_neurons.length - 1);
  addSynapse(pre, fb_neurons[fbIdx], 12.0, 1);
}

for (let i = 0; i < lc10_R.length; i++) {
  const pre = lc10_R[i];
  lal_R.forEach((post) => addSynapse(pre, post, 8.5 + (i >= 4 ? 4 : 0), 1));
  const fbIdx = Math.min(fb_neurons.length - 1 - i, fb_neurons.length - 1);
  addSynapse(pre, fb_neurons[fbIdx], 12.0, 1);
}

lc4_L.forEach((pre) => {
  dna02_L.forEach((post) => addSynapse(pre, post, 14.0, 1));
  dnp01.forEach((post) => addSynapse(pre, post, 16.0, 1));
  dnb01_L.forEach((post) => addSynapse(pre, post, 18.0, 1));
  addSynapse(pre, gf_L, 25.0, 1);
  addSynapse(pre, dna01_L, 15.0, 1);
});

lc4_R.forEach((pre) => {
  dna02_R.forEach((post) => addSynapse(pre, post, 14.0, 1));
  dnp01.forEach((post) => addSynapse(pre, post, 16.0, 1));
  dnb01_R.forEach((post) => addSynapse(pre, post, 18.0, 1));
  addSynapse(pre, gf_R, 25.0, 1);
  addSynapse(pre, dna01_R, 15.0, 1);
});

lc6_L.forEach((pre) => {
  dna02_L.forEach((post) => addSynapse(pre, post, 10.0, 1));
  dnp01.forEach((post) => addSynapse(pre, post, 12.0, 1));
  lal_L.forEach((post) => addSynapse(pre, post, 11.0, 1));
});

lc6_R.forEach((pre) => {
  dna02_R.forEach((post) => addSynapse(pre, post, 10.0, 1));
  dnp01.forEach((post) => addSynapse(pre, post, 12.0, 1));
  lal_R.forEach((post) => addSynapse(pre, post, 11.0, 1));
});

lplc2_L.forEach((pre) => {
  dna02_L.forEach((post) => addSynapse(pre, post, 12.0, 1));
  dnp01.forEach((post) => addSynapse(pre, post, 15.0, 1));
});

lplc2_R.forEach((pre) => {
  dna02_R.forEach((post) => addSynapse(pre, post, 12.0, 1));
  dnp01.forEach((post) => addSynapse(pre, post, 15.0, 1));
});

// 2. Central Complex Ring Attractor Dynamics
for (let i = 0; i < 16; i++) {
  const next = (i + 1) % 16;
  const prev = (i + 15) % 16;
  addSynapse(epg_neurons[i], epg_neurons[next], 6.0, 1);
  addSynapse(epg_neurons[i], epg_neurons[prev], 6.0, 1);

  const penIdx = i % 8;
  addSynapse(epg_neurons[i], pen_L[penIdx], 8.0, 1);
  addSynapse(epg_neurons[i], pen_R[penIdx], 8.0, 1);

  ring_inhibitory.forEach((inh) => addSynapse(epg_neurons[i], inh, 4.0, 1));
}

ring_inhibitory.forEach((inh) => {
  epg_neurons.forEach((epg) => addSynapse(inh, epg, 7.5, -1));
});

for (let i = 0; i < 8; i++) {
  const targetLeft = (i + 1) % 16;
  const targetRight = (i + 15) % 16;
  addSynapse(pen_L[i], epg_neurons[targetLeft], 10.0, 1);
  addSynapse(pen_R[i], epg_neurons[targetRight], 10.0, 1);
}

for (let i = 0; i < 8; i++) {
  addSynapse(pfn_L[i], fb_neurons[i], 9.0, 1);
  addSynapse(pfn_R[i], fb_neurons[i + 4 < fb_neurons.length ? i + 4 : i], 9.0, 1);
}

fb_neurons.forEach((fb, i) => {
  if (i < 6) {
    lal_L.forEach((lal) => addSynapse(fb, lal, 10.0, 1));
  } else {
    lal_R.forEach((lal) => addSynapse(fb, lal, 10.0, 1));
  }
});

// 3. LAL Premotor Reciprocal Inhibition and Descending Steering Activation
lal_L.forEach((lal) => {
  dna02_L.forEach((dn) => addSynapse(lal, dn, 15.0, 1));
  addSynapse(lal, dna01_L, 12.0, 1);
  lal_inh_L.forEach((inh) => addSynapse(lal, inh, 10.0, 1));
});

lal_R.forEach((lal) => {
  dna02_R.forEach((dn) => addSynapse(lal, dn, 15.0, 1));
  addSynapse(lal, dna01_R, 12.0, 1);
  lal_inh_R.forEach((inh) => addSynapse(lal, inh, 10.0, 1));
});

lal_inh_L.forEach((inh) => {
  dna02_R.forEach((dn) => addSynapse(inh, dn, 14.0, -1));
  lal_R.forEach((lal) => addSynapse(inh, lal, 12.0, -1));
});

lal_inh_R.forEach((inh) => {
  dna02_L.forEach((dn) => addSynapse(inh, dn, 14.0, -1));
  lal_L.forEach((lal) => addSynapse(inh, lal, 12.0, -1));
});

// 4. Arousal Gate to All Descending & Optic Lobe
arousal_neurons.forEach((ar) => {
  dnp01.forEach((dn) => addSynapse(ar, dn, 8.0, 1));
  dna02_L.forEach((dn) => addSynapse(ar, dn, 6.0, 1));
  dna02_R.forEach((dn) => addSynapse(ar, dn, 6.0, 1));
  dnb01_L.forEach((dn) => addSynapse(ar, dn, 8.0, 1));
  dnb01_R.forEach((dn) => addSynapse(ar, dn, 8.0, 1));
});

// 5. Descending Neurons to VNC Motor Effectors
dna02_L.forEach((dn) => addSynapse(dn, motor_steer_L, 20.0, 1));
addSynapse(dna01_L, motor_steer_L, 25.0, 1);

dna02_R.forEach((dn) => addSynapse(dn, motor_steer_R, 20.0, 1));
addSynapse(dna01_R, motor_steer_R, 25.0, 1);

dnp01.forEach((dn) => addSynapse(dn, motor_thrust, 22.0, 1));

dnb01_L.forEach((dn) => addSynapse(dn, motor_strike_backhand, 28.0, 1));
dnb01_R.forEach((dn) => addSynapse(dn, motor_strike_forehand, 28.0, 1));
addSynapse(gf_L, motor_strike_backhand, 35.0, 1);
addSynapse(gf_R, motor_strike_forehand, 35.0, 1);

addSynapse(mdn_L, motor_brake, 20.0, 1);
addSynapse(mdn_R, motor_brake, 20.0, 1);
addSynapse(mdn_L, motor_thrust, 18.0, -1);
addSynapse(mdn_R, motor_thrust, 18.0, -1);

console.log(`Synthesized ${synapses.length} biological synapses across ${neurons.length} neurons.`);

/**
 * CONVERT TO COMPRESSED SPARSE ROW (CSR) FORMAT
 */
const outgoing = Array.from({ length: neurons.length }, () => []);
for (const syn of synapses) {
  outgoing[syn.pre].push(syn);
}

const indptr = new Uint32Array(neurons.length + 1);
const indicesList = [];
const weightsList = [];
const signsList = [];

let offset = 0;
for (let i = 0; i < neurons.length; i++) {
  indptr[i] = offset;
  const out = outgoing[i];
  out.sort((a, b) => a.post - b.post);
  for (const s of out) {
    indicesList.push(s.post);
    weightsList.push(s.weight);
    signsList.push(s.sign);
    offset++;
  }
}
indptr[neurons.length] = offset;

const indices = new Uint32Array(indicesList);
const weights = new Float32Array(weightsList);
const signs = new Int8Array(signsList);

console.log(`CSR generated: indptr.length=${indptr.length}, total_synapses=${indices.length}`);

// Generate manifest
const manifest = {
  name: "Drosophila MaleCNS Sensorimotor Subcircuit v1.0",
  version: "1.0.0",
  source: "Janelia MaleCNS v1.0 / Shiu et al. Nature 2024 / FlyWire",
  neuronCount: neurons.length,
  synapseCount: indices.length,
  regions: {
    OpticLobe: neurons.filter((n) => n.region === "OpticLobe").length,
    CentralComplex: neurons.filter((n) => n.region === "CentralComplex").length,
    Protocerebrum: neurons.filter((n) => n.region === "Protocerebrum").length,
    Descending: neurons.filter((n) => n.region === "Descending").length,
    VNC: neurons.filter((n) => n.region === "VNC").length,
  },
  keyPathways: {
    loomingVPNs: ["LC4", "LC6", "LPLC2"],
    targetAzimuthVPNs: ["LC10"],
    compassIntegrators: ["EPG", "P-EN", "P-FN"],
    steeringDescending: ["DNa01", "DNa02"],
    forwardThrustDescending: ["DNp01"],
    strikeDescending: ["DNb01", "GiantFiber"],
    brakingDescending: ["MDN"],
  },
  createdAt: new Date().toISOString(),
};

// Write files to both data/connectome and public/data/connectome
for (const outDir of [dataDir, publicDataDir]) {
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, "neurons.json"), JSON.stringify(neurons, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, "indptr.bin"), Buffer.from(indptr.buffer));
  fs.writeFileSync(path.join(outDir, "indices.bin"), Buffer.from(indices.buffer));
  fs.writeFileSync(path.join(outDir, "weights.bin"), Buffer.from(weights.buffer));
  fs.writeFileSync(path.join(outDir, "signs.bin"), Buffer.from(signs.buffer));
}

console.log(`Successfully generated and wrote all connectome data assets to data/connectome/ and public/data/connectome/`);
