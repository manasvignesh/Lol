"""
Scientific Validation Suite for MaleCNS Connectome Runtime Graph.
Validates provenance, real body IDs, CSR integrity, synaptic weight ranges,
absence of synthetic neurons, and independent source-level verification against
official Janelia MaleCNS v1.0 feather tables.
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

def compute_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()

def validate_connectome_dir(connectome_dir: Path, raw_dir: Path | None = None) -> bool:
    print(f"\n=======================================================")
    print(f"   MaleCNS CONNECTOME VALIDATION: {connectome_dir.name}")
    print(f"=======================================================")

    manifest_file = connectome_dir / "manifest.json"
    neurons_file = connectome_dir / "neurons.json"
    indptr_file = connectome_dir / "indptr.bin"
    indices_file = connectome_dir / "indices.bin"
    weights_file = connectome_dir / "weights.bin"
    biological_weights_file = connectome_dir / "biologicalWeights.bin"
    signs_file = connectome_dir / "signs.bin"

    for f in [
        manifest_file,
        neurons_file,
        indptr_file,
        indices_file,
        weights_file,
        biological_weights_file,
        signs_file,
    ]:
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
    biological_weights = np.fromfile(biological_weights_file, dtype=np.uint32)
    signs = np.fromfile(signs_file, dtype=np.int8)

    errors = []

    # 1. Provenance check
    prov = manifest.get("provenance")
    if prov != "malecns-real":
        errors.append(f"Invalid provenance: expected 'malecns-real', got '{prov}'")

    dataset = manifest.get("dataset")
    if dataset != "MaleCNS":
        errors.append(f"Invalid dataset name: expected 'MaleCNS', got '{dataset}'")

    # 2. Dimensions and explicit edge/synapse terminology check
    n_neurons = len(neurons)
    n_edges = len(indices)
    bio_synapses_total = int(biological_weights.sum())

    if manifest.get("neuronCount") != n_neurons:
        errors.append(f"Manifest neuronCount ({manifest.get('neuronCount')}) != neurons.json length ({n_neurons})")
    
    edge_cnt = manifest.get("edgeCount", manifest.get("synapseCount"))
    if edge_cnt != n_edges:
        errors.append(f"Manifest edgeCount ({edge_cnt}) != indices.bin length ({n_edges})")

    if manifest.get("biologicalSynapseTotal") is not None:
        if manifest.get("biologicalSynapseTotal") != bio_synapses_total:
            errors.append(f"Manifest biologicalSynapseTotal ({manifest.get('biologicalSynapseTotal')}) != sum(biologicalWeights) ({bio_synapses_total})")

    if len(indptr) != n_neurons + 1:
        errors.append(f"indptr length ({len(indptr)}) != neuronCount + 1 ({n_neurons + 1})")
    if len(weights) != n_edges:
        errors.append(f"weights length ({len(weights)}) != indices length ({n_edges})")
    if len(biological_weights) != n_edges:
        errors.append(f"biologicalWeights length ({len(biological_weights)}) != indices length ({n_edges})")
    if len(signs) != n_edges:
        errors.append(f"signs length ({len(signs)}) != indices length ({n_edges})")

    # 3. Real Body ID and Metadata Integrity Check
    body_ids = set()
    synthetic_count = 0
    pop_counts = {
        "OpticLobe": 0,
        "CentralComplex": 0,
        "Protocerebrum": 0,
        "Descending": 0,
        "VNC": 0,
    }

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

        # Check for fake badminton-specific biological neurons
        t = str(neuron.get("type") or "")
        name = str(neuron.get("name") or "")
        if any(f in t.lower() or f in name.lower() for f in ["racket", "badminton", "smashneuron", "mn_strike"]):
            errors.append(f"Illegal synthetic badminton neuron in biological graph: '{name}' / '{t}'")

        region = neuron.get("region")
        if region in pop_counts:
            pop_counts[region] += 1

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
    if np.any(biological_weights <= 0):
        errors.append("biological_weights array contains non-positive values")

    if np.any(indices >= n_neurons):
        errors.append(f"indices array contains out-of-bounds target index (max {indices.max()} >= {n_neurons})")

    valid_signs = {-1, 0, 1}
    unique_signs = set(np.unique(signs))
    if not unique_signs.issubset(valid_signs):
        errors.append(f"signs array contains invalid signs: {unique_signs - valid_signs}")

    # 6. Independent Source-Level Verification Against Raw MaleCNS Feather Tables
    source_verification_status = "SKIPPED (no raw feather tables)"
    verified_src_bodies = 0
    verified_src_edges = 0
    verified_src_synapses = 0
    sha_status = "N/A"

    if raw_dir and raw_dir.exists():
        try:
            import pyarrow.feather as feather
            
            def find_raw_file(short: str, long: str) -> Path | None:
                p1 = raw_dir / long
                if p1.exists() and p1.stat().st_size > 0:
                    return p1
                p2 = raw_dir / short
                if p2.exists() and p2.stat().st_size > 0:
                    return p2
                return None

            ann_p = find_raw_file("annotations.feather", "body-annotations-male-cns-v1.0-minconf-0.5.feather")
            w_p = find_raw_file("weights.feather", "connectome-weights-male-cns-v1.0-minconf-0.5-traced-only.feather")
            nt_p = find_raw_file("neurotransmitters.feather", "body-neurotransmitters-male-cns-v1.0.feather")

            if ann_p and w_p and nt_p:
                # Check SHA-256 hashes against manifest
                manifest_hashes = manifest.get("sourceHashes", {})
                ann_hash = compute_sha256(ann_p)
                w_hash = compute_sha256(w_p)
                nt_hash = compute_sha256(nt_p)

                if manifest_hashes:
                    if manifest_hashes.get("annotations") and manifest_hashes["annotations"] != ann_hash:
                        errors.append(f"Source SHA-256 mismatch for annotations: {ann_hash} != {manifest_hashes['annotations']}")
                    if manifest_hashes.get("weights") and manifest_hashes["weights"] != w_hash:
                        errors.append(f"Source SHA-256 mismatch for weights: {w_hash} != {manifest_hashes['weights']}")
                    if manifest_hashes.get("neurotransmitters") and manifest_hashes["neurotransmitters"] != nt_hash:
                        errors.append(f"Source SHA-256 mismatch for neurotransmitters: {nt_hash} != {manifest_hashes['neurotransmitters']}")
                    sha_status = "PASS (SHA-256 verified against manifest)"
                else:
                    sha_status = "CALCULATED"

                # Verify all body IDs in official annotations table
                ann = feather.read_feather(ann_p)
                ann_body_set = set(ann["bodyId"].unique())
                runtime_numeric_bodies = [int(n["bodyId"]) for n in neurons]
                
                for b in runtime_numeric_bodies:
                    if b in ann_body_set:
                        verified_src_bodies += 1
                    else:
                        errors.append(f"Body ID {b} NOT found in official MaleCNS annotations table!")

                # Verify all runtime edges in official connectivity table
                weights_df = feather.read_feather(w_p)
                rb_set = set(runtime_numeric_bodies)
                wf = weights_df[weights_df["body_pre"].isin(rb_set) & weights_df["body_post"].isin(rb_set)]
                w_map = dict(zip(zip(wf["body_pre"], wf["body_post"]), wf["weight"]))

                for src_idx, n in enumerate(neurons):
                    src_body = int(n["bodyId"])
                    for k in range(indptr[src_idx], indptr[src_idx + 1]):
                        tgt_idx = int(indices[k])
                        tgt_body = int(neurons[tgt_idx]["bodyId"])
                        w = int(biological_weights[k])
                        official_w = w_map.get((src_body, tgt_body))
                        if official_w == w:
                            verified_src_edges += 1
                            verified_src_synapses += w
                        else:
                            errors.append(f"Edge ({src_body} -> {tgt_body}) weight mismatch: runtime {w} != official {official_w}")

                if verified_src_bodies == n_neurons and verified_src_edges == n_edges:
                    source_verification_status = "PASS (Exhaustive source table match)"
                else:
                    source_verification_status = f"FAIL ({verified_src_bodies}/{n_neurons} bodies, {verified_src_edges}/{n_edges} edges)"
        except Exception as e:
            errors.append(f"Error during source-level feather verification: {e}")
            source_verification_status = f"ERROR ({e})"

    # Output Summary Table
    print(f"Dataset          {manifest.get('dataset')} {manifest.get('datasetVersion')}")
    print(f"Provenance       {prov.upper()}")
    print(f"Real Neurons     {n_neurons:,}")
    print(f"Biological Edges {n_edges:,}")
    print(f"Total Synapses   {bio_synapses_total:,} biological synaptic contacts")
    print()
    print(f"Real body IDs    {len(body_ids):,} / {n_neurons:,}")
    print(f"Synthetic IDs    {synthetic_count}")
    print()
    print(f"Visual neurons   {pop_counts['OpticLobe']:,}")
    print(f"Central Complex  {pop_counts['CentralComplex']:,}")
    print(f"Protocerebrum    {pop_counts['Protocerebrum']:,}")
    print(f"Descending       {pop_counts['Descending']:,}")
    print(f"VNC motor        {pop_counts['VNC']:,}")
    print()
    print(f"CSR integrity    {'PASS' if len(errors) == 0 else 'FAIL'}")
    print(f"Metadata         {'PASS' if synthetic_count == 0 else 'FAIL'}")
    print(f"Provenance       {'PASS' if prov == 'malecns-real' else 'FAIL'}")
    if raw_dir and raw_dir.exists():
        print(f"Source IDs verif {verified_src_bodies:,} / {n_neurons:,}")
        print(f"Source edges ver {verified_src_edges:,} / {n_edges:,} ({verified_src_synapses:,} biological synapses)")
        print(f"Source SHA-256   {sha_status}")
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
    raw_path = repo_root / "data" / "raw"
    dirs_to_check = [
        repo_root / "data" / "connectome",
        repo_root / "public" / "data" / "connectome",
    ]
    all_ok = True
    for d in dirs_to_check:
        if not validate_connectome_dir(d, raw_dir=raw_path):
            all_ok = False

    sys.exit(0 if all_ok else 1)
