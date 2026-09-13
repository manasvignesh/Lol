# Validation Record: Fruit-Fly Connectome Edition

Validated on Windows with Node 22.22.2 and Google Chrome, September 2026. Commands executed within the repository root.

---

## 1. Automated Test Suite

`npm test`: **48 passing tests across 2 test files** (`tests/core.test.ts` and `tests/flybrain.test.ts`):

### A. Fruit-Fly Connectome Subsystem (`tests/flybrain.test.ts` - 18 tests)

1. **MaleCNS v1.0 Dataset Provenance**: Validates official dataset metadata (`MaleCNS`, `v1.0`, `malecns-real`), neuron counts ($N = 2,439$), edge count ($E = 44,781$), and underlying biological synapse total ($S = 1,146,043$).
2. **Authentic MaleCNS Body IDs**: Validates that 100% of neurons have authentic numeric Janelia body IDs (e.g. `10001`) with zero synthetic names, fake badminton cell types, or placeholder IDs.
3. **CSR Binary Format & Memory Layout**: Validates loading of `manifest.json`, `neurons.json`, `indptr.bin`, `indices.bin`, `weights.bin`, `biologicalWeights.bin`, and `signs.bin` with exact dimensions and positive conductances.
4. **Pathway Indexing**: Validates registration of Lobula Columnar VPNs (LC4, LC6, LC10a/b, LPLC1/2), Central Complex ring attractor compass (EPG, PEN, PFN, PFL1/2/3), Premotor Lateral Accessory Lobe (LAL), and Descending Channels (DNa01, DNa02, DNp01, DNb01, Giant Fiber, MDN).
5. **Deterministic LIF Biophysical Simulator**: Validates reproducibility under PRNG seeds, subthreshold membrane potential integration, action potential generation upon threshold crossing ($-50\text{ mV}$), reset potential ($-70\text{ mV}$), and post-spike absolute refractory state ($2.5\text{ ms}$).
6. **Synaptic Polarity & Conductance Transmission**: Validates that cholinergic pre-synaptic spikes trigger excitatory conductance surges ($g_{\text{exc}}$) and GABAergic pre-synaptic spikes trigger inhibitory conductance surges ($g_{\text{inh}}$).
7. **Optical Sensory Transduction**: Validates differentiation of incoming looming trajectories ($\eta > 0.005$) from retreating trajectories ($\eta = 0$), and retinotopic excitation of visual projection neurons.
8. **Visual Population Input Restriction**: Proves external optical stimulus currents inject exclusively into visual projection populations (`LC4`, `LC6`, `LC10a/b`, `LPLC1/2`), with zero direct artificial drive into P-EN, CX, DNs, or VNC.
9. **Causal Forward Propagation**: Proves visual input propagates through the connectome into descending modulation (`DNa01`/`DNa02`) and drives virtual avatar steering.
10. **DNa02 Optogenetic Silencing**: Verifies lateral steering response is causally diminished when DNa02 descending neurons are silenced.
11. **Decoupled Biological Decoding vs. Embodiment**: Verifies biological motor variables (`steeringTorque`, `forwardThrust`, `brakingDrive`, `locomotorDrive`, `flightState`) are computed independently from badminton court coordinate geometry.
12. **Active Pathway Tracing**: Validates end-to-end active pathway trace extraction from visual projection neurons down through premotor hubs to descending motor outputs with authentic Janelia body IDs.
13. **Physical Embodiment Match Rally**: Validates that the Fruit-Fly Connectome opponent perceives incoming shuttles, executes lateral steering, surges forward, triggers racket strikes, and sustains rallies using physical swept racket collisions.

### B. Core Physics, Auto-Footwork & Intent Model (`tests/core.test.ts` - 30 tests)

- Body-scale normalized velocity, small torso lean directional intent detection, whole-body translation swing rejection, tracking-gap reset without spikes.
- Streamlined 3-stage calibration, 5-class natural shot trajectory classification, landmark quality and shoulder measurement.
- Auto-footwork avatar movement to predicted shuttle interception without room displacement, player lean acceleration commitment, post-shot central base recovery.
- Early swing priming inside assisted timing windows, late swing misses, single swing ID collision consumption, Beginner vs Normal contact envelope comparison.
- Swept contact, court boundaries/net crossings, quadratic drag, numerical shot profiles, rally scoring, AI reaction states, and net/out fault attribution.

---

## 2. Connectome Validation CLI

```bash
npm run validate:connectome
```

Output:

```text
=======================================================
   MaleCNS CONNECTOME VALIDATION: data/connectome
=======================================================
Dataset          MaleCNS v1.0
Provenance       MALECNS-REAL
Real Neurons     2,439
Biological Edges 44,781
Total Synapses   1,146,043 biological synaptic contacts

Real body IDs    2,439 / 2,439
Synthetic IDs    0

Visual neurons   1,158
Central Complex  138
Protocerebrum    702
Descending       186
VNC motor        255

CSR integrity    PASS
Metadata         PASS
Provenance       PASS
Source IDs verif 2,439 / 2,439
Source edges ver 44,781 / 44,781 (1,146,043 biological synapses)
Source SHA-256   PASS (SHA-256 verified against manifest)
-------------------------------------------------------
CONNECTOME VALID: Real MaleCNS v1.0 biological graph verified.
```

---

## 3. Build & Code Quality

```powershell
npm test                    # 48 / 48 passed (100%)
npm run validate:connectome # MaleCNS v1.0 source tables & CSR verified
npm run typecheck           # 0 TypeScript errors
npm run format:check        # Formatted with Prettier
npm run build               # Production Vite bundle + Worker assets built cleanly
```

---

## 4. Observed Runtime Performance

| Component                             | Frequency / Rate | Latency / Duration            |
| :------------------------------------ | :--------------- | :---------------------------- |
| **Court WebGL Rendering**             | 60 FPS           | ~16.6 ms frame budget         |
| **LIF Neural Simulation (Worker)**    | 500 Hz           | 2.0 ms dt per step            |
| **Neural Telemetry Stream**           | 60 Hz            | Snapshot transferred to UI    |
| **MediaPipe Pose Inference (Worker)** | ~25–31 FPS       | ~22–29 ms CPU WASM            |
| **Physics Integrator**                | 120 Hz           | Fixed semi-implicit drag step |
