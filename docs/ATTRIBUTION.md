# Scientific & Data Attribution

This project is built upon foundational empirical neuroscience research, open datasets, and open-source software:

## 1. Drosophila Connectome Data & Janelia MaleCNS

- **HHMI Janelia Research Campus & FlyEM Project**
  - _MaleCNS v1.0_: Electron microscopy dataset and reconstructed wiring diagram of the adult male _Drosophila melanogaster_ central nervous system (`male-cns:v1.0`).
  - _Public GCS Bucket_: `https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome`

- **Key Literature & References**:
  - Takemura, S., et al. (2023). _A connectome of the male Drosophila melanogaster central nervous system_. **bioRxiv** / HHMI Janelia.
  - Shiu, P. K., et al. (2024). _A Drosophila computational brain model reveals how neural dynamics drive behavior_. **Nature**, 634, 210–219.

## 2. MediaPipe & On-Device Vision

- **Google MediaPipe**: MediaPipe Pose Landmarker running client-side via WebAssembly & SIMD.
  - Model: Pose Landmarker Lite (`pose_landmarker_lite.task`).

## 3. Rendering & Graphics

- **Three.js**: MIT License (Ricardo Cabello / mrdoob).
  - 3D WebGL Court, Lighting, Particle Trails, and Procedural Drosophila Rig.
