# Motion Badminton

A playable local singles badminton prototype: your webcam tracks your body, your arm drives the racket, and deliberate swings return a drag-heavy shuttle against a heuristic opponent. No account, API key, cloud inference, or video upload. The intended moment is simple: see the shuttle, swing through it, feel the return.

**Status:** implemented and tested as a prototype. Actual MediaPipe inference has been verified using a public prerecorded image; the complete calibration/game/tracking-recovery path has been tested with synthetic pose fixtures. **A human webcam playtest and subjective “I hit that” validation have not been performed.** This is not a claim of production-quality gesture recognition.

![Local keyboard-test rally showing the playable court](docs/images/game.png)

## Run on Windows

Install Node.js 22.12 or newer and Git. Use current Chrome or Edge with hardware acceleration.

```powershell
git clone https://github.com/manasvignesh/Lol.git
cd Lol
npm ci
npm run setup
npm run dev
```

Open **http://127.0.0.1:5173**. Initial installation needs internet access to download dependencies and Google's versioned pose model (about 5.8 MB). After setup, both inference and gameplay run locally, including all WASM and model requests. The server binds to loopback only. macOS/Linux use the same commands.

For an optimized local build:

```powershell
npm run build
npm run preview
```

Open **http://127.0.0.1:4173**. Do not open `index.html` directly from the filesystem. Keep the terminal running. Ctrl+C stops the server. Quit releases the camera; browser security prevents a page from reliably closing a user-opened tab.

## Camera and calibration

Use a normal laptop or USB webcam, ideally 640×480 at 30 FPS. Face the camera in front lighting, with shoulders, elbows, wrists, and hips visible. Legs are tracked if visible but are not required. Avoid loose sleeves obscuring wrists. Leave clear space around you; stay approximately in place and do not jump.

1. Select **Play with camera** and allow browser camera access.
2. Stand centered and relaxed for about 1.5 seconds.
3. Raise **only your racket hand** above its shoulder and hold for one second. Either hand works; selection is automatic.
4. Sway a little left and right for about three seconds. Both directions establish your movement range.
5. Extend that arm comfortably for one second. The match starts automatically.

Typical calibration is 7–12 seconds when landmarks remain visible. Prompts wait for valid observations rather than silently accepting incomplete calibration. Use Pause → Recalibrate to switch hands or move the camera. Settings lists available cameras after permission is granted; changing camera starts recalibration.

## How to play

- **Serve:** make a deliberate, gentle upward arm swing. A new swing is needed for each player serve; no keyboard input is required.
- **Move:** shift your torso or take a small sideways step. Calibration maps modest room movement across the virtual court.
- **Reach:** raise/lower and extend your racket arm. The racket extends beyond the wrist along the forearm. The preview is mirrored like a mirror.
- **Hit:** swing through the approaching shuttle near your racket. A real swing state and spatial proximity are both required. Merely holding your hand nearby does not hit.
- **Shots:** upward strokes tend toward lifts/clears, horizontal strokes toward drives, slower deliberate strokes toward drops, and fast downward strokes from high contact toward smashes. Low or net-bound trajectories are assisted into safer returns. Incoming speed and early/late timing affect power and placement.
- **Read the shuttle:** watch its shadow, trail, and Beginner landing ring. The ring predicts ground landing, not the exact interception point.
- **Score:** every rally awards one point. First to 21, win by two, capped at 30. The winner serves next. Pause/Escape pauses; results offers a new match.
- **Tracking loss:** input becomes inactive after 240 ms, then the rally pauses after 800 ms. Stable tracking for about 650 ms resumes it. Switching tabs pauses the match.

Start with Easy opponent and Beginner assistance. Normal reduces the contact radius and gives the AI a faster reaction/movement profile. Sensitivity changes swing thresholds relative to body size; movement sensitivity changes court mapping.

## Debug and diagnostics

**Keyboard test** is explicitly separate from webcam mode:

| Key               | Action                                     |
| ----------------- | ------------------------------------------ |
| A/D or left/right | Move sideways                              |
| W/S or up/down    | Adjust racket height                       |
| Space             | Deliberate swing / serve                   |
| 1 / 2 / 3 / 4 / 5 | Clear / drive / drop / smash / lift intent |
| Escape            | Pause/resume                               |
| F3                | Toggle telemetry                           |

Settings → **Run synthetic pose diagnostic** feeds generated anatomical landmarks through the real filter and interpreter. It is a motion diagnostic, not an autonomous opponent or proof of camera recognition. Developer overlay shows camera, inference and render FPS, processing latency, confidence, hand, elbow angle, swing state/ID, intent, racket position, AI state and contact count. Webcam preview draws shoulder/elbow/wrist/hip/knee/ankle connections locally. `window.motionDiagnostics` is a read-only snapshot for acceptance scripts.

## Architecture and stack

TypeScript + Three.js + Vite, with MediaPipe Pose Landmarker Lite on the CPU in a **classic Web Worker**. No backend application or IPC service is necessary. The local web server only serves static source/assets. The worker is bundled as IIFE because MediaPipe's WASM loader uses `importScripts`; an ES module worker fails at runtime.

```text
getUserMedia → newest ImageBitmap (one in flight) → pose worker
  → confidence gate → adaptive pose filter → calibrated arm-chain interpretation
  → swing state machine → player/racket controller
  → fixed 120 Hz swept contact / shuttle physics / AI / scoring
  → independent requestAnimationFrame rendering + UI + procedural audio
```

`createImageBitmap` transfers only the latest frame when the worker is idle. Frames are never queued. Pose velocity uses frame capture timestamps, not render timestamps. Shoulder-relative motion suppresses torso translation; body-proportion normalization makes thresholds resolution-independent. Fast movement reduces smoothing. Invalid/stale poses reset velocity history to avoid a recovery spike.

Shuttle physics uses semi-implicit gravity with stable quadratic drag. A numerical shooting solver uses the same integrator to aim distinct flight profiles. Contact calculates the closest relative approach of two moving points over the same fixed step. Beginner/Normal assistance enlarges the effective zone, but does not bypass swing confidence or per-swing hit consumption.

The AI predicts an interception from simulated flight, waits its reaction delay, moves at limited speed, and has explicit miss/placement error. Court coordinates are meters, `y` is up, positive `z` is the player half. Rendering is independent from deterministic game state.

## Folder structure

```text
src/
  camera.ts          camera lifecycle, frame scheduling, metrics
  pose.worker.ts     local MediaPipe inference
  motion.ts          filter, calibration, interpretation, swing state
  game.ts            player/racket updates, AI, contacts, rally lifecycle
  physics.ts         drag, shot solver, prediction, court and scoring rules
  renderer.ts        lit 3D court, avatars, racket, shuttle, effects
  audio.ts           local procedural sound
  config.ts          shared tuning and default settings
  synthetic.ts       explicit keyboard and generated-pose test inputs
  main.ts/style.css  screens, integration, telemetry, presentation
scripts/             offline asset setup, worker build, browser acceptance
tests/               deterministic unit and integration tests
public/              favicon and generated local runtime assets
docs/                engineering decisions and validation record
```

## Development and verification

```powershell
npm test
npm run typecheck
npm run format:check
npm run build
npm audit
```

With `npm run dev` running in a separate terminal and Chrome installed:

```powershell
npm run test:browser
npm run test:camera
npm run test:motion-flow
```

Browser tests write screenshots and JSON to ignored `test-results/`. The camera test downloads Google's public test image if needed; it runs the actual model in the actual worker using a canvas camera stream. The motion-flow test replaces pose inference with deterministic results, explicitly testing all calibration stages, serving and tracking pause/recovery. These tests complement one another; neither is a physical human playtest. See [validation details](docs/VALIDATION.md).

## Performance

Observed in headless Chrome on the development machine: approximately 60 render FPS during keyboard rallies, and 22–31 pose FPS with about 22–29 ms inference and 23–30 ms capture-to-result processing on the prerecorded detected-pose fixture across development and production runs. Person-search frames were slower. These are sample measurements, not hardware-independent guarantees or sensor-to-display latency. Camera exposure, OS buffering, screen latency and physical interaction were not measured. CPU inference keeps GPU rendering independent. Render pixel ratio is capped at 1.75, and frames are discarded while inference is busy. The overlay identifies low pose FPS.

## Troubleshooting

- **Permission denied:** allow the camera in the browser address bar; retry Play. OS Settings → Privacy & security → Camera must also allow desktop apps.
- **Camera busy/disconnected:** close video-call apps, reconnect, and recalibrate. Choose Default camera if a saved device ID is unavailable.
- **Model/WASM missing:** run `npm run setup` from the repository. Setup downloads the versioned model and copies WASM from the locked npm dependency.
- **Worker changes not reflected:** restart `npm run dev`; its predev step rebuilds the classic worker. Main app changes use Vite hot reload.
- **No tracking:** improve front lighting, move away from backlighting, face forward, and fit shoulders/wrists/hips inside frame.
- **Low FPS:** close other heavy apps, enable browser hardware acceleration, use a 30 FPS camera, and lower the browser window size. Debug overlay gives measured bottlenecks.
- **Unwanted swings:** reduce Swing sensitivity; keep the camera still and recalibrate. Large rapid repositioning can still resemble a swing.
- **Missed returns:** start with Beginner assistance, watch the shuttle shadow, and swing near the visible racket. This prototype still needs human timing/threshold tuning.
- **Port busy:** Vite prints the actual URL if 5173 is occupied. Browser scripts expect 5173 unless `GAME_URL` is set.

## Known limitations and simplifications

- Single-camera depth/racket orientation is approximate 2.5D; lateral position and racket height are controlled physically, while racket depth stays in a narrow contact band. It does not reconstruct a true 3D racket face or require a physical racket.
- No separate hand-landmark model, reliable defensive-block classifier, or biomechanical forehand/backhand labeling. The five practical intent classes come from arm trajectory and speed; any valid new swing may serve.
- Only one visible player is supported. Multiple people can confuse person tracking. Lower-body landmarks are drawn but not required for gameplay.
- Simplified serving: no diagonal service boxes, foot faults, doubles, ends switching or best-of-three match. The actual rally scoring and 30-point cap are implemented.
- Shot assistance favors net clearance and valid court targets; it makes unforced player out shots less common than real badminton. The AI has simple heuristics and is not tournament-strength.
- Stylized avatars and procedural audio; no detailed skeletal animation or recorded sports sounds.
- No physical camera disconnect, multiple physical camera selection, variable lighting, left-handed human swing, or sustained real-person rally has been manually validated here.
- Subjective latency, contact forgiveness and “I hit that” feel need human playtesting before this can be called polished motion control.

## Assets, privacy and repository notes

The game uses generated geometry, CSS, and synthesized sound rather than third-party artwork. MediaPipe is Apache-2.0; Three.js is MIT. The versioned Google model is downloaded from the official MediaPipe model distribution. See [third-party notes](docs/THIRD_PARTY.md). No video, camera image or calibration is persisted by the app. Settings alone are saved locally. Browser test fixtures and screenshots are development-only and ignored by Git.

Dependencies are pinned in `package-lock.json`. Generated models/WASM, `node_modules`, builds, logs and test outputs are intentionally untracked. Source and reproducible setup are the GitHub deliverable. The default branch is `main` at [manasvignesh/Lol](https://github.com/manasvignesh/Lol). Build/test before pushing; never commit private camera media or credentials.

## Next milestone

Run structured physical webcam playtests with left/right-handed players, several webcams and small rooms. Measure false swing rate, missed-contact rate, motion-to-contact delay and rally length, then tune thresholds and assistance from those observations. After that: improve 3D contact depth, avatar arm animation and shot variety. Keep accounts, multiplayer, monetization and other sports out of this prototype.
