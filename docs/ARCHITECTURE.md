# Engineering decisions

## One browser process, one inference worker

The prototype chooses a desktop browser instead of a Unity/Python split. A single local HTTP server simplifies Windows installation and camera permissions, while DOM UI and Three.js share typed deterministic gameplay modules. The worker owns the MediaPipe instance and consumes transferred ImageBitmaps; its `finally` block closes each bitmap. A generation token prevents old capture callbacks from feeding a restarted camera. Stopping a session terminates the worker and every media track.

MediaPipe's synchronous `detectForVideo` is explicitly off the render thread, as recommended by the [official web guide](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js). Its WASM bootstrap requires classic-worker `importScripts`, discovered and corrected during a real inference smoke test. `scripts/build-worker.mjs` bundles the TypeScript worker into an ignored IIFE asset for both dev and production.

## Intent-based control & auto-footwork

The human control model is designed around the core principle: **"Play badminton from where you stand"** (~1m × 1m area).

- Real-world players do not physically traverse their room across a full badminton court.
- The virtual avatar performs the court footwork automatically by predicting the incoming shuttle trajectory and moving smoothly to a sensible interception location.
- The vision system captures small real-world body intent signals: lateral torso lean, body center shift, arm reach forward/back, preparation posture, and swing direction.
- Player intent actively influences the avatar: aligning intent accelerates footwork commitment and refines positioning, while contradictory intent introduces a realistic positional deficit (stronger in Normal mode).
- After returning a shot, the avatar smoothly recovers toward the central base position.

## Timing, swing prediction & assistance

- Camera capture timestamps drive derivatives. A one-frame busy flag prevents queue growth.
- Motion uses mirrored, shoulder-relative wrist coordinates normalized by calibrated shoulder width. The arm chain provides elbow angle, forearm/upper-arm direction, reach and virtual racket extension.
- **Predictive swing detector**: maintains recent wrist/forearm motion history (~200 ms). Detects acceleration spikes and early swing initiation before peak velocity, and extrapolates short-horizon arm trajectories (40–80 ms) to eliminate perceived latency.
- **Assisted reachable contact envelope**: gameplay contact occurs when the avatar is within a reachable envelope around the interception zone and the player produces a deliberate swing within an assisted timing window.
- **Early swing priming**: a slightly early swing remains primed for a forgiving timing window until the shuttle enters the reachable zone.
- Each detected swing has a monotonically increasing ID. A single swing cannot serve and repeatedly hit. Tracking gaps reset derivative history without rewinding IDs.
- The main thread disables input at 240 ms of missing observations. At 800 ms it freezes simulation; valid tracking must remain for 650 ms before resuming. Visibility/blur also pauses.
- Streamlined 3-stage calibration: (1) Neutral standing posture & body scale, (2) Racket hand selection, (3) Arm reach & intent check. Room-scale lateral swaying is completely eliminated.

## Physics and assistance

Fixed 120 Hz integration applies `v /= 1 + drag * |v| * dt`, then gravity and position. It avoids sign reversal from explicit quadratic drag at large speed. Net intersection checks interpolate the actual crossing point. Ground bounds include line thickness. A numerical shooting solver iterates outgoing velocity using this same integrator rather than mixing incompatible analytical ball flight with shuttle drag.

Power and trajectory use normalized swing speed, intent, direction, contact height, approximate timing and incoming shuttle speed. Outgoing left/right shot placement is biased by swing follow-through direction and body intent. Nominal net-bound shots are lifted; the same net/ground/out code still governs flight.

## Verification boundaries

Deterministic tests cover engine invariants, auto-footwork, intent blending, contact envelopes, and scoring. Browser tests cover rendering and UI. A real image/model/worker test covers actual inference and resource lifecycle. A separate controlled-pose test covers the streamlined calibration and tracking-loss UI path. These together do not establish human control quality. That requires a physical playtest with measured contact and false-positive rates.
