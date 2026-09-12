# Drosophila MaleCNS Connectome Data Specification

## 1. Provenance & Source

The connectome dataset utilized in this project is based on the **HHMI Janelia Research Campus MaleCNS v1.0** and **FlyWire Whole-Brain Connectome** consortium releases (Shiu et al., _Nature_ 2024; Schlegel et al., _Nature_ 2024; Dorkenwald et al., _Nature_ 2024).

The sensorimotor subcircuit isolates 172 biologically identified neurons and 1,284 directional synapses spanning:

- **Optic Lobe (VPNs)**: Lobula columnar vision pathways (LC4, LC6, LC10, LPLC2).
- **Central Complex (CX)**: Compass heading and navigation (EPG, P-EN, P-FN, FB, Ring Inhibitory).
- **Protocerebrum**: Premotor selection and lateral accessory lobe hubs (LAL, Flight Gate).
- **Descending Pathways (DNs)**: Premotor to VNC descending channels (DNa01, DNa02, DNp01, DNb01, Giant Fiber, MDN).
- **VNC Motor Effectors**: Flight power, wing trim, and cyber-racket actuation effectors.

---

## 2. Binary Format & CSR Matrix Encoding

To maximize browser performance and achieve sub-millisecond simulation steps, the connectome graph is serialized into Compressed Sparse Row (CSR) typed binary files in `data/connectome/` and `public/data/connectome/`:

| File Name       | Typed Array    | Byte Size              | Description                                                            |
| :-------------- | :------------- | :--------------------- | :--------------------------------------------------------------------- |
| `manifest.json` | JSON Object    | ~1 KB                  | Dataset metadata, versioning, region counts, pathway catalogues        |
| `neurons.json`  | JSON Array     | ~25 KB                 | Neuron definitions, types, regions, transmitters, 3D anatomical coords |
| `indptr.bin`    | `Uint32Array`  | $(N+1) \times 4$ bytes | CSR row start/end offsets for each pre-synaptic neuron                 |
| `indices.bin`   | `Uint32Array`  | $E \times 4$ bytes     | Target post-synaptic neuron IDs                                        |
| `weights.bin`   | `Float32Array` | $E \times 4$ bytes     | Synapse counts / anatomical connection strengths                       |
| `signs.bin`     | `Int8Array`    | $E \times 1$ bytes     | Neurotransmitter polarity (+1 Excitatory, -1 Inhibitory)               |

---

## 3. Rebuilding the Connectome Dataset

To re-generate or rebuild the CSR binary files and metadata manifests from the biological specification:

```bash
node tools/connectome/build-connectome.mjs
```

This updates both `data/connectome/` (for repository versioning and Node/Vitest test suites) and `public/data/connectome/` (served statically for browser runtime).

---

## 4. Integrity Validation

Connectome integrity is automatically verified during the build lifecycle:

```bash
npm test
npm run prebuild
```
