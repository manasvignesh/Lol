# Validation Record: Fruit-Fly Connectome Edition

Validated on Windows with Node 22.22.2 and Google Chrome, September 2026. Commands executed within the repository root.

---

## 1. Automated Test Suite

`npm test`: **40 passing tests across 2 test files** (`tests/core.test.ts` and `tests/flybrain.test.ts`):

### A. Fruit-Fly Connectome Subsystem (`tests/flybrain.test.ts`)

1. **Connectome Graph & CSR Binary Format**: Validates loading of `manifest.json`, `neurons.json`, `indptr.bin`, `indices.bin`, `weights.bin`, and `signs.bin` with exact dimensional parity across all 172 neurons and 1,284 synapses.
2. **Pathway Indexing**: Validates registration of Lobula Columnar VPNs (LC4, LC6, LC10, LPLC2), Central Complex ring attractor compass (EPG, P-EN, P-FN, FB), Premotor Lateral Accessory Lobe (LAL), and Descending Channels (DNa01, DNa02, DNp01, DNb01, Giant Fiber, MDN).
3. **LIF Biophysical Simulator**: Validates subthreshold membrane potential integration, action potential generation upon threshold crossing ($-50\text{ mV}$), reset potential ($-70\text{ mV}$), and post-spike refractory state.
4. **Synaptic Polarity & Conductance Decay**: Validates that cholinergic pre-synaptic spikes trigger excitatory conductance surges ($g_{\text{exc}}$) and GABAergic pre-synaptic spikes trigger inhibitory conductance surges ($g_{\text{inh}}$).
5. **Optical Sensory Transduction**: Validates differentiation of incoming looming trajectories ($\eta > 0.01$) from retreating trajectories ($\eta = 0$), and retinotopic excitation of ipsilateral visual projection neurons (left vs right visual fields).
6. **Descending Motor Decoding**: Validates that asymmetric DNa02 descending activity translates to lateral steering velocity ($v_x$), and forward thrust descending activity (DNp01) translates to surge velocity ($v_z$).
7. **Optogenetic Interventions**: Validates that optogenetically silencing LC4/LC6 abolishes looming-driven descending activation.
8. **End-to-End Match Rally**: Validates that the Fruit-Fly Connectome opponent perceives incoming shuttles, executes lateral steering, surges forward, triggers racket strikes, and sustains rallies.

### B. Core Physics, Auto-Footwork & Intent Model (`tests/core.test.ts` - 30 tests)

- Body-scale normalized velocity, small torso lean directional intent detection, whole-body translation swing rejection, tracking-gap reset without spikes.
- Streamlined 3-stage calibration, 5-class natural shot trajectory classification, landmark quality and shoulder measurement.
- Auto-footwork avatar movement to predicted shuttle interception without room displacement, player lean acceleration commitment, post-shot central base recovery.
- Early swing priming inside assisted timing windows, late swing misses, single swing ID collision consumption, Beginner vs Normal contact envelope comparison.
- Swept contact, court boundaries/net crossings, quadratic drag, numerical shot profiles, rally scoring, AI reaction states, and net/out fault attribution.

---

## 2. Build & Code Quality

```powershell
npm test          # 40 / 40 passed
npm run typecheck # 0 TypeScript errors
npm run format:check # Formatted with Prettier
npm run build     # Production Vite bundle + Worker assets built cleanly
```

---

## 3. Sample Observed Metrics

| Component                             | Frequency / Rate | Latency / Duration            |
| :------------------------------------ | :--------------- | :---------------------------- |
| **Court WebGL Rendering**             | 60 FPS           | ~16.6 ms frame budget         |
| **LIF Neural Simulation (Worker)**    | 250–500 Hz       | 2–4 ms dt per step            |
| **Neural Telemetry Stream**           | 60 Hz            | Snapshot transferred to UI    |
| **MediaPipe Pose Inference (Worker)** | ~25–31 FPS       | ~22–29 ms CPU WASM            |
| **Physics Integrator**                | 120 Hz           | Fixed semi-implicit drag step |
