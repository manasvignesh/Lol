# Validation record

Validated on Windows with Node 22.22.2 and installed Chrome, September 7, 2026. Commands run in the repository. No physical human webcam playtest was performed.

## Automated engine checks

`npm test`: **30 passing tests**. Includes body-scale normalized velocity, small torso lean directional intent detection, whole-body translation swing rejection, tracking-gap reset without spikes, streamlined 3-stage calibration, 5-class natural shot trajectory classification, landmark quality and shoulder measurement, auto-footwork avatar movement to predicted shuttle interception without room displacement, player lean acceleration commitment, post-shot central base recovery, early swing priming inside assisted timing windows, late swing misses, single swing ID collision consumption, Beginner vs Normal contact envelope comparison, swept contact, court boundaries/net crossings, quadratic drag, numerical shot profiles, rally scoring, AI reaction states, and net/out fault attribution.

The sustained-rally test simulates eight seeded Normal opponents for 60 seconds each with auto-footwork player control. Each produces rallies of at least four contacts. This is an engine stability/control-path test; the idealized controller is not a measurement of human difficulty.

## Browser acceptance

- `npm run test:browser`: real Three.js/WebGL rendering, keyboard serve, AI response, pause/settings return, synthetic interpreter serve, and actionable denied-camera error. No page errors. Production build tested at port 4173 as well as development at 5173.
- `npm run test:camera`: actual MediaPipe Lite model and classic worker, official public pose image presented through `canvas.captureStream`, skeleton detection, neutral calibration advance, loss-of-person guidance after blank frames, and camera/worker release on Home. No page errors. Both development and production assets tested. This is genuine inference, but the image stream is prerecorded test media.
- `npm run test:motion-flow`: streamlined 3-stage calibration flow (Position → Racket Hand → Reach/Intent), automatic racket-hand choice, synthetic physical-style swing through the production interpreter, serve, tracking-loss pause, unchanged shuttle position while paused, and recovery without a false swing. Pose results are mocked deliberately; inference is tested independently above.

Screenshots were visually inspected for Home, active match and pose calibration. They confirm visible court/net, racket/shuttle, scores, useful prompts and local skeleton overlay. Browser outputs live in ignored `test-results/` and may be regenerated.

## Build and quality

- `npm run build`: TypeScript strict checking and optimized Vite build pass, including offline runtime asset presence checks.
- `npm run typecheck`: passes.
- `npm run format:check`: passes.
- `npm audit`: zero known dependency vulnerabilities after updating patched versions.
- `npm run setup`: local pose model checksum verified, WASM copied and classic worker rebuilt.
- `git diff --check`: passes.

## Observed sample performance

| Path                                   | Render  | Pose inference rate | Inference duration | Capture-to-result |
| -------------------------------------- | ------- | ------------------- | ------------------ | ----------------- |
| Keyboard rally, Chrome                 | ~60 FPS | N/A                 | N/A                | N/A               |
| Prerecorded detected pose, development | ~60 FPS | ~31 FPS             | ~22 ms             | ~23 ms            |
| Prerecorded detected pose, production  | ~60 FPS | ~22 FPS             | ~29 ms             | ~30 ms            |

Short-run sampled values depend on CPU load and warmup. Blank-image/person-search frames were slower (up to about 45 ms inference in a sampled run). These measurements exclude real webcam exposure, camera driver buffering, human movement and display scanout. They are not a claim of 23 ms end-to-end physical latency. The worker never accumulates a frame queue.

## Problems found and repaired

1. ES module workers do not support MediaPipe's `importScripts` WASM bootstrap. Replaced with an explicitly bundled classic worker; verified actual inference afterward.
2. A stylesheet data import failed in the Windows CSS bundler. Removed it and rebuilt.
3. Restarting/input-mode changes could preserve stale swing data. Reset motion before match creation and clear keyboard swing timing.
4. Browser smoke assumptions initially treated an intentional Easy-AI miss as failure. The test now starts another rally within a bounded interval; engine tests use seeded random sources.
5. Camera cancellation now checks its generation again after video playback starts, preventing a late start from reviving a stopped camera.
6. Patched dependency versions replaced versions flagged by npm audit. Locked build tools and model checksum support reproduction.

## Remaining physical acceptance work

Actual human detection/calibration, dominant-arm tracking, deliberate-swing false positive/negative rates, perceived contact timing, multi-shot human rallies, camera unplug/replug, multiple physical webcams, poor-light operation, left-handed human play and sustained ordinary-laptop performance remain to be manually validated. Those are explicit limits, not passed tests.
