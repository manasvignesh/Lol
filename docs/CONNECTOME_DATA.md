# Drosophila MaleCNS v1.0 Connectome Data Specification

## 1. Provenance & Biological Grounding

The connectome dataset utilized in this project is extracted directly from the official **HHMI Janelia Research Campus MaleCNS v1.0** dataset (`male-cns:v1.0`), as published by the FlyEM Project and Janelia Research Campus (Takemura et al., 2023; Shiu et al., _Nature_ 2024; Schlegel et al., _Nature_ 2024; Dorkenwald et al., _Nature_ 2024).

The sensorimotor subcircuit comprises **2,439 biologically validated neurons** and **44,781 directional biological synapses** with 100% authentic Janelia body IDs (e.g. `10001`, `10014`, `10051`), standard cell types, hemilineages, and EM voxel soma coordinates.

### Subcircuit Composition

- **Optic Lobe Visual Projection Neurons (VPNs - 1,158 neurons)**:
  - Lobula Columnar looming and expansion detectors: `LC4`, `LC6`, `LPLC1`, `LPLC2`.
  - Retinotopic target-tracking visual projection neurons: `LC10a`, `LC10b`, `LC10c`, `LC10d`, `LC11`, `LC15`, `LC17`.
- **Central Complex (CX - 138 neurons)**:
  - Ring-attractor compass heading representation: `EPG` (Ellipsoid body - Protocerebral bridge - Gall).
  - Angular velocity integrators: `PEN_a` (PEN1), `PEN_b` (PEN2).
  - Columnar coordinate transformation neurons: `PFN_a`, `PFN_b`, `PFN_p`, `PFL1`, `PFL2`, `PFL3`.
- **Premotor Protocerebrum & LAL Hubs (702 neurons)**:
  - Lateral Accessory Lobe (`LAL`) premotor routing interneurons with bilateral reciprocal inhibition.
  - Anterior Optic Tubercle (`AOTU`) and Posterior Slope (`PS`) relay interneurons.
- **Descending Pathways (DNs - 186 neurons)**:
  - Steering and turning motor commands: `DNa01`, `DNa02`.
  - Flight thrust, takeoff, and surge commands: `DNp01`, `DNp02`, `DNp09`, `DNp11`.
  - Fast strike and escape effectors: `DNb01`, `Giant Fiber` (`GF`), `MDN` (Moonwalker braking).
- **VNC Motor Systems (255 neurons)**:
  - Ventral nerve cord motor and premotor interneurons coordinating flight trim, wing amplitude, and bio-cybernetic racket swing mechanics.

---

## 2. Ingestion & Extraction Pipeline

The raw connectome tables are retrieved directly from the public Google Cloud Storage bucket hosted by HHMI Janelia / FlyEM:

- **GCS Base URL**: `https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome`
  - `body-annotations-male-cns-v1.0-minconf-0.5.feather` (211,577 neurons, 14.5 MB)
  - `body-neurotransmitters-male-cns-v1.0.feather` (1.83M records, 43.3 MB)
  - `connectome-weights-male-cns-v1.0-minconf-0.5-traced-only.feather` (25.5M biological synapses, 508 MB)

### Toolchain Execution

The automated ingestion and build pipeline is located in `tools/connectome/`:

```bash
# Setup Python environment and install pyarrow, pandas, scipy
python -m venv .venv
.venv\Scripts\activate # On Windows (.venv/bin/activate on Unix)
pip install pyarrow pandas scipy numpy requests

# Execute end-to-end extraction and CSR binary generation
python tools/connectome/pipeline.py

# Or via npm script
npm run setup:connectome
```

The pipeline:

1. Downloads official Janelia MaleCNS v1.0 feather tables with sha256 / size verification.
2. Filters biologically identified cell types with traced EM morphologies and confidence $\ge 0.5$.
3. Resolves pre- and post-synaptic biological weights and predicted neurotransmitter polarities (+1 Acetylcholine, -1 GABA / Glutamate).
4. Emits production Compressed Sparse Row (CSR) binary arrays and JSON manifests to `data/connectome/` and `public/data/connectome/`.

---

## 3. Binary Format & CSR Matrix Encoding

To maximize browser performance and achieve sub-millisecond 500 Hz LIF simulation steps in a Web Worker, the connectome graph is serialized into Compressed Sparse Row (CSR) typed binary files:

| File Name               | Typed Array    | Dimensions / Elements | Description                                                             |
| :---------------------- | :------------- | :-------------------- | :---------------------------------------------------------------------- |
| `manifest.json`         | JSON Object    | -                     | Dataset metadata, MaleCNS version, neuron counts, pathway indexes       |
| `neurons.json`          | JSON Array     | 2,439 records         | Real Janelia body IDs, cell types, instances, neurotransmitters, coords |
| `indptr.bin`            | `Uint32Array`  | 2,440 elements        | CSR row pointer offsets for pre-synaptic neurons                        |
| `indices.bin`           | `Uint32Array`  | 44,781 elements       | Target post-synaptic neuron indices                                     |
| `weights.bin`           | `Float32Array` | 44,781 elements       | Normalized biological synaptic conductances                             |
| `biologicalWeights.bin` | `Float32Array` | 44,781 elements       | Raw EM biological synapse counts ($w_{ji}$)                             |
| `signs.bin`             | `Int8Array`    | 44,781 elements       | Neurotransmitter polarity (+1 Excitatory, -1 Inhibitory)                |

Total binary payload size: **~460 KB**, enabling instant network loading and zero runtime parse overhead.

---

## 4. Integrity & Scientific Validation

Run strict automated validation of the connectome graph against MaleCNS provenance requirements:

```bash
npm run validate:connectome
```

Checks performed:

- Provenance flag is `"malecns-real"` and dataset is `"MaleCNS"`.
- 100% of neurons have numeric Janelia body IDs with zero synthetic names.
- CSR row offsets are strictly monotonically non-decreasing and terminate at `synapseCount`.
- All synaptic weights are strictly positive and finite.
- Neurotransmitter signs are strictly within $\{-1, 0, +1\}$.
- Key sensorimotor populations (`LC4`, `LC6`, `LC10`, `EPG`, `DNa02`, `DNp01`, `DNb01`, `vnc_motor`) are present with verified biological connectivity.
