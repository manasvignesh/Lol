# Third-party resources

- **Three.js**, pinned via npm: MIT license, https://github.com/mrdoob/three.
- **MediaPipe Tasks Vision**, pinned via npm: Apache-2.0, https://github.com/google-ai-edge/mediapipe. Package licenses remain in the installed dependency distribution.
- **Pose Landmarker Lite model**, float16, version 1, official distribution: https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task. Model documentation: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker. SHA-256: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`. Downloaded at setup, not redistributed in Git history.
- **Development pose fixture**: https://storage.googleapis.com/mediapipe-assets/pose.jpg, used locally for inference verification only. Not part of the shipped game and not committed or redistributed. The test script identifies it as prerecorded public media, never as a live user camera.
- **Vite, TypeScript, Vitest, esbuild, Prettier, Playwright**: development dependencies; exact versions and transitive dependencies are in the lockfile. Consult their package licenses for redistribution.

All court/avatar/racket/shuttle geometry, favicon, interface styling and procedural sound are authored for this prototype. The app does not fetch web fonts, record camera footage or contact analytics services.
