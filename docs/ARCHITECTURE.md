# Engineering decisions

## One browser process, one inference worker

The prototype chooses a desktop browser instead of a Unity/Python split. A single local HTTP server simplifies Windows installation and camera permissions, while DOM UI and Three.js share typed deterministic gameplay modules. The worker owns the MediaPipe instance and consumes transferred ImageBitmaps; its `finally` block closes each bitmap. A generation token prevents old capture callbacks from feeding a restarted camera. Stopping a session terminates the worker and every media track.

MediaPipe's synchronous `detectForVideo` is explicitly off the render thread, as recommended by the [official web guide](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js). Its WASM bootstrap requires classic-worker `importScripts`, discovered and corrected during a real inference smoke test. `scripts/build-worker.mjs` bundles the TypeScript worker into an ignored IIFE asset for both dev and production.

## Timing and control

- Camera capture timestamps drive derivatives. A one-frame busy flag prevents queue growth.
- Motion uses mirrored, shoulder-relative wrist coordinates normalized by calibrated shoulder width. The arm chain provides elbow angle, forearm/upper-arm direction, reach and virtual racket extension.
- Adaptive exponential smoothing favors fast movement; the racket adds a small fixed-step smoothing stage. Thresholds are shoulder-widths per second, not raw pixels.
- Each detected swing has a monotonically increasing ID. A single swing cannot serve and repeatedly hit. Tracking gaps reset derivative history without rewinding IDs.
- The main thread disables input at 240 ms of missing observations. At 800 ms it freezes simulation; valid tracking must remain for 650 ms before resuming. Visibility/blur also pauses.
- Calibration and settings never advance rallies. Leaving Home releases camera resources. Restarting clears old input before creating a fresh serve.

## Physics and assistance

Fixed 120 Hz integration applies `v /= 1 + drag * |v| * dt`, then gravity and position. It avoids sign reversal from explicit quadratic drag at large speed. Net intersection checks interpolate the actual crossing point. Ground bounds include line thickness. A numerical shooting solver iterates outgoing velocity using this same integrator rather than mixing incompatible analytical ball flight with shuttle drag.

Collision uses relative segment closest approach at a shared substep time. A deliberate swing, fresh confidence, eligible side, unused ID, near-court contact and dynamic radius are all necessary. Assisting the radius is deliberate prototype forgiveness. The racket's forward depth is constrained because monocular depth is unreliable. There is no hidden automatic player return.

Power and trajectory use normalized swing speed, intent, direction, contact height, approximate timing and incoming shuttle speed. Nominal net-bound shots are lifted; the same net/ground/out code still governs flight. Intent labels follow any assisted change to avoid reporting a smash while actually playing a clear.

## Verification boundaries

Deterministic tests cover engine invariants. Browser tests cover rendering and UI. A real image/model/worker test covers actual inference and resource lifecycle. A separate controlled-pose test covers the full calibration and tracking-loss UI path. These together do not establish human control quality. That requires a physical playtest with measured contact and false-positive rates.

Generic pose interpretation stays independent of court rules; another sport could reuse it later without adding multi-sport abstractions now.
