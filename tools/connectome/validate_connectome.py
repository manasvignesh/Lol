"""
Scientific Validation Suite for MaleCNS Connectome Runtime Graph.
Validates provenance, real body IDs, CSR integrity, synaptic weight ranges,
and absence of synthetic neurons.
"""
import json
import sys
from pathlib import Path

import numpy as np

def validate_connectome_dir(connectome_dir: Path) -> bool:
    print(f"\n=======================================================")
    print(f"   MaleCNS CONNECTOME VALIDATION: {connectome_dir.name}")
    print(f"=======================================================")

    manifest_file = connectome_dir / "manifest.json"
    neurons_file = connectome_dir / "neurons.json"
    indptr_file = connectome_dir / "indptr.bin"
    indices_file = connectome_dir / "indices.bin"
    weights_file = connectome_dir / "weights.bin"
    signs_file = connectome_dir / "signs.bin"

    for f in [manifest_file, neurons_file, indptr_file, indices_file, weights_file, signs_file]:
        if not f.exists():
            print(f"[FAIL] Missing required asset: {f.name}")
            return False

    with open(manifest_file, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    with open(neurons_file, "r", encoding="utf-8") as f:
        neurons = json.load(f)

    indptr = np.fromfile(indptr_file, dtype=np.uint32)
    indices = np.fromfile(indices_file, dtype=np.uint32)
    weights = np.fromfile(weights_file, dtype=np.float32)
    signs = np.fromfile(signs_file, dtype=np.int8)

    errors = []

    # 1. Provenance check
    prov = manifest.get("provenance")
    if prov != "malecns-real":
        errors.append(f"Invalid provenance: expected 'malecns-real', got '{prov}'")

    dataset = manifest.get("dataset")
    if dataset != "MaleCNS":
        errors.append(f"Invalid dataset name: expected 'MaleCNS', got '{dataset}'")

    # 2. Dimensions check
    n_neurons = len(neurons)
    n_edges = len(indices)

    if manifest.get("neuronCount") != n_neurons:
        errors.append(f"Manifest neuronCount ({manifest.get('neuronCount')}) != neurons.json length ({n_neurons})")
    if manifest.get("synapseCount") != n_edges:
        errors.append(f"Manifest synapseCount ({manifest.get('synapseCount')}) != indices.bin length ({n_edges})")

    if len(indptr) != n_neurons + 1:
        errors.append(f"indptr length ({len(indptr)}) != neuronCount + 1 ({n_neurons + 1})")
    if len(weights) != n_edges:
        errors.append(f"weights length ({len(weights)}) != indices length ({n_edges})")
    if len(signs) != n_edges:
        errors.append(f"signs length ({len(signs)}) != indices length ({n_edges})")

    # 3. Real Body ID and Metadata Integrity Check
    body_ids = set()
    indices_set = set()
    synthetic_count = 0
    visual_count = 0
    cx_count = 0
    descending_count = 0
    vnc_count = 0

    for i, neuron in enumerate(neurons):
        b_id = str(neuron.get("bodyId") or "")
        idx = neuron.get("index")

        # Must be genuine numeric MaleCNS ID
        if not b_id.isdigit():
            synthetic_count += 1
            if synthetic_count <= 5:
                errors.append(f"Neuron at index {i} has non-numeric synthetic body ID: '{b_id}'")

        if b_id in body_ids:
            errors.append(f"Duplicate bodyId found: '{b_id}'")
        body_ids.add(b_id)

        if idx != i:
            errors.append(f"Neuron index mismatch: expected {i}, got {idx}")
        indices_set.add(idx)

        # Check for fake badminton-specific biological neurons
        t = str(neuron.get("type") or "")
        name = str(neuron.get("name") or "")
        if any(f in t.lower() or f in name.lower() for f in ["racket", "badminton", "smashneuron", "mn_strike"]):
            errors.append(f"Illegal synthetic badminton neuron in biological graph: '{name}' / '{t}'")

        # Count populations
        region = neuron.get("region")
        if region == "OpticLobe":
            visual_count += 1
        elif region == "CentralComplex":
            cx_count += 1
        elif region == "Descending":
            descending_count += 1
        elif region == "VNC":
            vnc_count += 1

    # 4. CSR Structure Integrity Check
    if indptr[0] != 0:
        errors.append(f"indptr[0] must be 0, got {indptr[0]}")
    if indptr[-1] != n_edges:
        errors.append(f"indptr[-1] ({indptr[-1]}) must equal n_edges ({n_edges})")

    for i in range(n_neurons):
        start = indptr[i]
        end = indptr[i + 1]
        if start > end:
            errors.append(f"indptr monotonicity violation at index {i}: {start} > {end}")
            break
        if end > n_edges:
            errors.append(f"indptr pointer out of bounds at index {i}: {end} > {n_edges}")
            break

    # 5. Weight & Sign Range Check
    if np.any(np.isnan(weights)) or np.any(np.isinf(weights)):
        errors.append("weights array contains NaN or Infinity")
    if np.any(weights <= 0):
        errors.append("weights array contains non-positive conductance values")

    if np.any(indices >= n_neurons):
        errors.append(f"indices array contains out-of-bounds target index (max {indices.max()} >= {n_neurons})")

    valid_signs = {-1, 0, 1}
    unique_signs = set(np.unique(signs))
    if not unique_signs.issubset(valid_signs):
        errors.append(f"signs array contains invalid signs: {unique_signs - valid_signs}")

    # Output Summary Table
    print(f"Dataset          {manifest.get('dataset')} {manifest.get('datasetVersion')}")
    print(f"Provenance       {prov.upper()}")
    print(f"Neurons          {n_neurons:,}")
    print(f"Edges            {n_edges:,}")
    print()
    print(f"Real body IDs    {len(body_ids):,} / {n_neurons:,}")
    print(f"Synthetic IDs    {synthetic_count}")
    print()
    print(f"Visual neurons   {visual_count:,}")
    print(f"Central Complex  {cx_count:,}")
    print(f"Descending       {descending_count:,}")
    print(f"VNC motor        {vnc_count:,}")
    print()
    print(f"CSR integrity    {'PASS' if len(errors) == 0 else 'FAIL'}")
    print(f"Metadata         {'PASS' if synthetic_count == 0 else 'FAIL'}")
    print(f"Provenance       {'PASS' if prov == 'malecns-real' else 'FAIL'}")
    print("-------------------------------------------------------")

    if errors:
        print(f"[FAIL] Connectome validation failed with {len(errors)} errors:")
        for err in errors[:10]:
            print(f"  - {err}")
        return False

    print("CONNECTOME VALID: Real MaleCNS v1.0 biological graph verified.")
    return True

if __name__ == "__main__":
    repo_root = Path(__file__).resolve().parents[2]
    dirs_to_check = [
        repo_root / "data" / "connectome",
        repo_root / "public" / "data" / "connectome",
    ]
    all_ok = True
    for d in dirs_to_check:
        if not validate_connectome_dir(d):
            all_ok = False

    sys.exit(0 if all_ok else 1)
