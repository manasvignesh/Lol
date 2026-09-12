# Engineering Decisions & System Architecture

## 1. Dual-Worker Asynchronous Architecture

The system utilizes a multi-threaded web architecture offloading compute-intensive tasks to dedicated background Web Workers:

```text
+-------------------------------------------------------------------------------+
|                               Browser Main Thread                             |
|  * Three.js 3D Court & Drosophila Rig Rendering                               |
|  * 120 Hz Fixed-Step Physics & Shuttle Drag Integrator                        |
|  * Game State, Match Management, Rally Lifecycle                              |
|  * Canvas2D Connectome Lab Visualizer (Circuit / Spatial / Raster Views)       |
+-------------------------------------------------------------------------------+
         ^                                           ^
         | Transferred ImageBitmap / Pose Stream     | Sensory State / Telemetry Stream
         v                                           v
+-----------------------------+             +-----------------------------------+
|     MediaPipe Pose Worker   |             |   Drosophila Neural LIF Worker    |
| * CPU WASM + SIMD Inference |             | * Janelia MaleCNS v1.0 CSR Graph  |
| * 33-Landmark Pose Stream   |             | * 250–500 Hz LIF Numerical Loop   |
| * Non-blocking Main Thread  |             | * Sensory Encoder & Motor Decoder |
| * Auto Bitmap Disposal      |             | * 60 Hz Telemetry & Motor Output  |
+-----------------------------+             +-----------------------------------+
```

1. **MediaPipe Pose Worker (`src/pose.worker.ts` $\rightarrow$ `public/pose-worker.js`)**:
   - Runs local CPU inference via MediaPipe Pose Landmarker Lite over WebAssembly + SIMD.
   - Frame bitmaps are transferred with zero copy; `finally` blocks immediately close and free bitmaps.
2. **Drosophila Neural Worker (`src/flybrain/neural.worker.ts` $\rightarrow$ `public/neural-worker.js`)**:
   - Executes the Leaky Integrate-and-Fire (LIF) continuous simulation loop at 250–500 Hz (dt = 2–4 ms).
   - Operates directly over CSR binary arrays (`indptr.bin`, `indices.bin`, `weights.bin`, `signs.bin`).
   - Posts lightweight downsampled telemetry snapshots to the main thread at 60 Hz.
   - Provides synchronous fallback (`NeuralBridge`) in headless / Node / Vitest testing environments.

---

## 2. Intent-Based Human Control Model

The human control model follows the principle: **"Play badminton from where you stand"** (~1m × 1m area).

- Real-world players do not physically traverse their room across a full badminton court.
- The virtual avatar performs court footwork automatically by predicting the incoming shuttle trajectory and moving smoothly to a sensible interception location.
- The vision system captures small real-world body intent signals: lateral torso lean, body center shift, arm reach forward/back, preparation posture, and swing direction.
- Player intent actively influences the avatar: aligning intent accelerates footwork commitment and refines positioning, while contradictory intent introduces a realistic positional deficit.
- After returning a shot, the avatar smoothly recovers toward the central base position.

---

## 3. Timing, Swing Prediction & Contact Envelope

- Motion uses mirrored, shoulder-relative wrist coordinates normalized by calibrated shoulder width.
- **Predictive swing detector**: maintains recent wrist/forearm motion history (~200 ms). Detects acceleration spikes and early swing initiation before peak velocity.
- **Assisted reachable contact envelope**: gameplay contact occurs when the avatar is within a reachable envelope around the interception zone and the player produces a deliberate swing within an assisted timing window.
- **Early swing priming**: a slightly early swing remains primed for a forgiving timing window until the shuttle enters the reachable zone.
- Streamlined 3-stage calibration: (1) Neutral standing posture & body scale, (2) Racket hand selection, (3) Arm reach & intent check.

---

## 4. Connectome Subsystem & Biophysical Engine

- **CSR Matrix Sparse Representation**: The 172-neuron, 1,284-synapse graph is packed into contiguous binary typed arrays for maximum cache locality and vectorized matrix-vector multiplication.
- **Vectorized LIF Simulator (`src/flybrain/neuralEngine.ts`)**:
  - Membrane potentials ($V_i$), conductances ($g_{\text{exc}}, g_{\text{inh}}$), external currents ($I_{\text{ext}}$), and refractory timers are stored in contiguous `Float32Array` buffers.
  - Deterministic integration step with zero runtime allocations.
- **Biologically Grounded Transduction**:
  - `SensoryEncoder`: Translates shuttle 3D kinematics into spherical retinal angles and looming expansion rate $\eta(t)$.
  - `MotorDecoder`: Decodes left vs. right descending neuron activity (DNa01/DNa02) into lateral steering velocity ($v_x$), and forward thrust neurons (DNp01) into surge velocity ($v_z$).
- **Neural Visualizer (`src/flybrain/brainRenderer.ts`)**:
  - High-performance Canvas2D rendering supporting Circuit Flow, Spatial Anatomical, and Spike Raster views with live optogenetic interventions.

---

## 5. Verification Boundaries

Deterministic unit and integration tests (`tests/flybrain.test.ts` and `tests/core.test.ts`) cover:

- Connectome graph loading, CSR structural validation, and pathway indexing.
- LIF subthreshold integration, threshold spiking, absolute refractory enforcement, and neurotransmitter signs.
- Sensory looming encoding and left/right asymmetric receptive fields.
- Descending motor decoding and optogenetic silencing interventions.
- End-to-end match rallies with both Fruit-Fly Connectome and Classic AI opponents.
