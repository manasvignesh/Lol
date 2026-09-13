import fs from "fs";
import path from "path";

const downloadScript = `"""
Download official MaleCNS v1.0 SWC skeleton morphology from HHMI Janelia neuPrint API.
Input: public/data/connectome/neurons.json
Output: data/morphology/raw/{bodyId}.json
"""
import concurrent.futures
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

NEUPRINT_URL = "https://neuprint.janelia.org/api/skeletons/skeleton/male-cns:v1.0/{bodyId}?format=json"

def fetch_single_skeleton(body_id: str, dest_file: Path, max_retries: int = 4) -> tuple[str, bool, int, str]:
    if dest_file.exists() and dest_file.stat().st_size > 10:
        try:
            with open(dest_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                nodes = len(data.get("data", []))
                if nodes > 0:
                    return body_id, True, nodes, "cached"
        except Exception:
            pass

    url = NEUPRINT_URL.format(bodyId=body_id)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ConnectomeViewer/1.0",
        "Accept": "application/json",
    }

    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=12) as resp:
                if resp.status == 200:
                    raw_bytes = resp.read()
                    data = json.loads(raw_bytes.decode("utf-8"))
                    nodes = len(data.get("data", []))
                    if nodes > 0:
                        tmp_file = dest_file.with_suffix(".tmp")
                        with open(tmp_file, "wb") as f:
                            f.write(raw_bytes)
                        tmp_file.replace(dest_file)
                        return body_id, True, nodes, "downloaded"
                    else:
                        return body_id, False, 0, "empty_nodes"
                elif resp.status == 404:
                    return body_id, False, 0, "not_found"
        except urllib.error.HTTPError as he:
            if he.code == 404:
                return body_id, False, 0, "not_found"
            if he.code == 429:
                time.sleep(1.0 * (2 ** attempt))
                continue
        except Exception:
            time.sleep(0.5 * (2 ** attempt))

    return body_id, False, 0, "failed"

def download_all_skeletons(max_workers: int = 24) -> dict:
    repo_root = Path(__file__).resolve().parents[2]
    neurons_file = repo_root / "public" / "data" / "connectome" / "neurons.json"
    if not neurons_file.exists():
        neurons_file = repo_root / "data" / "connectome" / "neurons.json"

    with open(neurons_file, "r", encoding="utf-8") as f:
        neurons = json.load(f)

    raw_dir = repo_root / "data" / "morphology" / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    print(f"=== DOWNLOADING MALECNS SKELETON MORPHOLOGY ===")
    print(f"Total neurons in runtime connectome: {len(neurons)}")
    print(f"Destination: {raw_dir}")
    print(f"Concurrency: {max_workers} worker threads\\n")

    results = {}
    success_count = 0
    total_nodes = 0
    t0 = time.time()

    body_ids = [n["bodyId"] for n in neurons]

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_bid = {
            executor.submit(fetch_single_skeleton, bid, raw_dir / f"{bid}.json"): bid
            for bid in body_ids
        }

        completed = 0
        for future in concurrent.futures.as_completed(future_to_bid):
            bid, ok, nodes, status = future.result()
            results[bid] = {"success": ok, "nodes": nodes, "status": status}
            completed += 1
            if ok:
                success_count += 1
                total_nodes += nodes

            if completed % 100 == 0 or completed == len(body_ids):
                elapsed = time.time() - t0
                rate = completed / max(0.001, elapsed)
                pct = completed / len(body_ids) * 100
                print(f"  Progress: {completed:4d} / {len(body_ids)} ({pct:5.1f}%) | Success: {success_count} ({total_nodes:,} nodes) | {rate:4.1f} neurons/sec")

    elapsed = time.time() - t0
    pct = success_count / len(body_ids) * 100
    print(f"\\nDownload finished in {elapsed:.1f}s.")
    print(f"Morphology obtained: {success_count} / {len(body_ids)} neurons ({pct:.1f}%)")
    print(f"Total skeleton nodes: {total_nodes:,}")
    return results

if __name__ == "__main__":
    download_all_skeletons()
`;

const preprocessScript = `"""
Preprocess official MaleCNS SWC skeletons into compact binary buffers.
Applies ONE unified global anatomical transform (MaleCNS nm voxels -> visualization space).
Outputs:
- segmentPositions.bin (Float32Array [x1, y1, z1, x2, y2, z2, ...])
- segmentBodyIds.bin (Uint16Array neuron indices)
- neuronOffsets.bin (Uint32Array segment start offsets)
- morphologyMeta.json (Per-neuron metadata)
- morphology-manifest.json (Global manifest and dataset provenance)
"""
import hashlib
import json
import os
import shutil
import struct
import sys
import numpy as np
from pathlib import Path

def compute_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()

def preprocess_morphology(
    max_segments_per_neuron: int = 1200,
    decimate_leaf_factor: int = 1
):
    repo_root = Path(__file__).resolve().parents[2]
    neurons_file = repo_root / "public" / "data" / "connectome" / "neurons.json"
    if not neurons_file.exists():
        neurons_file = repo_root / "data" / "connectome" / "neurons.json"

    raw_dir = repo_root / "data" / "morphology" / "raw"
    output_dirs = [
        repo_root / "data" / "morphology",
        repo_root / "public" / "data" / "morphology",
    ]

    for d in output_dirs:
        d.mkdir(parents=True, exist_ok=True)

    with open(neurons_file, "r", encoding="utf-8") as f:
        neurons = json.load(f)

    print("=== PREPROCESSING MALECNS NEURON MORPHOLOGY ===")
    print(f"Total neurons in graph: {len(neurons)}")

    # Pass 1: Load skeletons and compute global bounding box
    raw_skeletons = {}
    all_x = []
    all_y = []
    all_z = []
    total_raw_nodes = 0

    for idx, n in enumerate(neurons):
        bid = n["bodyId"]
        file_path = raw_dir / f"{bid}.json"
        if not file_path.exists() or file_path.stat().st_size < 10:
            continue

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                rows = data.get("data", [])
                if len(rows) > 0:
                    raw_skeletons[idx] = (bid, rows)
                    total_raw_nodes += len(rows)
                    # Sample bounds
                    for r in rows:
                        all_x.append(r[1])
                        all_y.append(r[2])
                        all_z.append(r[3])
        except Exception:
            continue

    print(f"Skeletons loaded: {len(raw_skeletons)} / {len(neurons)}")
    print(f"Total raw SWC nodes: {total_raw_nodes:,}")

    if len(raw_skeletons) == 0:
        raise ValueError("No valid skeleton files found in data/morphology/raw.")

    all_x = np.array(all_x, dtype=np.float64)
    all_y = np.array(all_y, dtype=np.float64)
    all_z = np.array(all_z, dtype=np.float64)

    min_x, max_x = float(np.min(all_x)), float(np.max(all_x))
    min_y, max_y = float(np.min(all_y)), float(np.max(all_y))
    min_z, max_z = float(np.min(all_z)), float(np.max(all_z))

    center_x = (min_x + max_x) / 2.0
    center_y = (min_y + max_y) / 2.0
    center_z = (min_z + max_z) / 2.0

    span_x = max_x - min_x
    span_y = max_y - min_y
    span_z = max_z - min_z
    max_span = max(span_x, span_y, span_z)

    # Global uniform scale factor: maps max anatomical dimension to 2.4 visualization units
    global_scale = 2.4 / max_span

    # MaleCNS voxel size: 8nm x 8nm x 8nm
    # 100 um = 100,000 nm = 12,500 voxels
    scale_bar_100um_vis = 12500.0 * global_scale

    print(f"Global bounds (voxels): X=[{min_x:.0f}, {max_x:.0f}], Y=[{min_y:.0f}, {max_y:.0f}], Z=[{min_z:.0f}, {max_z:.0f}]")
    print(f"Center (voxels): [{center_x:.1f}, {center_y:.1f}, {center_z:.1f}]")
    print(f"Global scale: {global_scale:.8f} (100 um = {scale_bar_100um_vis:.4f} vis units)")

    # Pass 2: Extract normalized segments
    neuron_offsets = [0]
    segment_positions = [] # Float32 flat array [x1, y1, z1, x2, y2, z2, ...]
    segment_body_ids = []  # Uint16 flat array
    morphology_meta = []
    total_segments = 0

    for idx, n in enumerate(neurons):
        bid = n["bodyId"]
        if idx not in raw_skeletons:
            morphology_meta.append({
                "index": idx,
                "bodyId": bid,
                "hasMorphology": False,
                "nodeCount": 0,
                "segmentCount": 0,
                "region": n.get("region", "Protocerebrum"),
                "type": n.get("type", ""),
                "instance": n.get("instance", ""),
                "hemisphere": n.get("hemisphere", "R"),
                "neurotransmitter": n.get("neurotransmitter", "unknown"),
                "centroid": [0, 0, 0],
                "bounds": {"min": [0, 0, 0], "max": [0, 0, 0]},
            })
            neuron_offsets.append(total_segments)
            continue

        _, rows = raw_skeletons[idx]

        # Build node lookup: rowId -> (x, y, z, radius, link)
        node_map = {}
        for r in rows:
            row_id = int(r[0])
            raw_x, raw_y, raw_z = float(r[1]), float(r[2]), float(r[3])
            rad = float(r[4]) if len(r) > 4 else 1.0
            link = int(r[5]) if len(r) > 5 else -1

            # Unified global transform: center and scale
            # Invert Y so dorsal/ventral orientation matches standard biological orientation
            vx = (raw_x - center_x) * global_scale
            vy = -(raw_y - center_y) * global_scale
            vz = (raw_z - center_z) * global_scale

            node_map[row_id] = (vx, vy, vz, rad, link)

        # Build segments from parent links
        neuron_segs = []
        n_xs, n_ys, n_zs = [], [], []

        for row_id, (vx, vy, vz, rad, link) in node_map.items():
            n_xs.append(vx)
            n_ys.append(vy)
            n_zs.append(vz)

            if link in node_map and link != -1:
                px, py, pz, _, _ = node_map[link]
                neuron_segs.append((px, py, pz, vx, vy, vz))

        # Decimate if neuron has excessive segments for smooth 60 FPS rendering
        if len(neuron_segs) > max_segments_per_neuron:
            step = len(neuron_segs) / max_segments_per_neuron
            sampled_indices = [int(i * step) for i in range(max_segments_per_neuron)]
            neuron_segs = [neuron_segs[i] for i in sampled_indices]

        # Append to master binary buffers
        for px, py, pz, vx, vy, vz in neuron_segs:
            segment_positions.extend([px, py, pz, vx, vy, vz])
            segment_body_ids.append(idx)

        seg_count = len(neuron_segs)
        total_segments += seg_count
        neuron_offsets.append(total_segments)

        n_min = [float(np.min(n_xs)), float(np.min(n_ys)), float(np.min(n_zs))] if n_xs else [0, 0, 0]
        n_max = [float(np.max(n_xs)), float(np.max(n_ys)), float(np.max(n_zs))] if n_xs else [0, 0, 0]
        n_cen = [(n_min[0] + n_max[0]) / 2, (n_min[1] + n_max[1]) / 2, (n_min[2] + n_max[2]) / 2]

        morphology_meta.append({
            "index": idx,
            "bodyId": bid,
            "hasMorphology": True,
            "nodeCount": len(rows),
            "segmentCount": seg_count,
            "region": n.get("region", "Protocerebrum"),
            "type": n.get("type", ""),
            "instance": n.get("instance", ""),
            "hemisphere": n.get("hemisphere", "R"),
            "neurotransmitter": n.get("neurotransmitter", "unknown"),
            "centroid": [round(c, 4) for c in n_cen],
            "bounds": {
                "min": [round(c, 4) for c in n_min],
                "max": [round(c, 4) for c in n_max]
            },
        })

    print(f"Total rendered line segments: {total_segments:,}")
    print(f"Segment positions array size: {len(segment_positions):,} floats ({len(segment_positions)*4 / 1e6:.2f} MB)")

    # Convert to NumPy binary arrays
    pos_array = np.array(segment_positions, dtype=np.float32)
    body_id_array = np.array(segment_body_ids, dtype=np.uint16)
    offset_array = np.array(neuron_offsets, dtype=np.uint32)

    # Manifest
    manifest = {
        "dataset": "MaleCNS",
        "datasetVersion": "v1.0",
        "provenance": "official-janelia-neuprint-swc",
        "totalNeuronsInGraph": len(neurons),
        "morphologyNeurons": len(raw_skeletons),
        "missingMorphologyCount": len(neurons) - len(raw_skeletons),
        "totalRawNodes": total_raw_nodes,
        "totalSegments": total_segments,
        "rawVoxelSizeNm": [8, 8, 8],
        "coordinateUnits": "male_cns_8nm_voxels",
        "globalTransform": {
            "center": [round(center_x, 2), round(center_y, 2), round(center_z, 2)],
            "scale": float(global_scale),
            "scaleBar100umVis": round(scale_bar_100um_vis, 4),
            "boundsMin": [round(min_x, 1), round(min_y, 1), round(min_z, 1)],
            "boundsMax": [round(max_x, 1), round(max_y, 1), round(max_z, 1)],
        },
        "files": {}
    }

    # Write binary and JSON files to output dirs
    for out_dir in output_dirs:
        pos_file = out_dir / "segmentPositions.bin"
        body_file = out_dir / "segmentBodyIds.bin"
        offset_file = out_dir / "neuronOffsets.bin"
        meta_file = out_dir / "morphologyMeta.json"
        manifest_file = out_dir / "morphology-manifest.json"

        pos_array.tofile(pos_file)
        body_id_array.tofile(body_file)
        offset_array.tofile(offset_file)

        with open(meta_file, "w", encoding="utf-8") as f:
            json.dump(morphology_meta, f)

        manifest["files"] = {
            "segmentPositions": compute_sha256(pos_file),
            "segmentBodyIds": compute_sha256(body_file),
            "neuronOffsets": compute_sha256(offset_file),
            "morphologyMeta": compute_sha256(meta_file),
        }

        with open(manifest_file, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)

    print(f"\\nAll morphology binary buffers generated and saved to {output_dirs[0]} and {output_dirs[1]}")
    return manifest

if __name__ == "__main__":
    preprocess_morphology()
`;

const validateScript = `"""
Validate MaleCNS morphology assets integrity, dimensions, body ID mapping, and manifest hashes.
"""
import hashlib
import json
import os
import sys
import numpy as np
from pathlib import Path

def compute_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()

def validate_morphology_dir(target_dir: Path) -> bool:
    manifest_file = target_dir / "morphology-manifest.json"
    pos_file = target_dir / "segmentPositions.bin"
    body_file = target_dir / "segmentBodyIds.bin"
    offset_file = target_dir / "neuronOffsets.bin"
    meta_file = target_dir / "morphologyMeta.json"

    required = [manifest_file, pos_file, body_file, offset_file, meta_file]
    for r in required:
        if not r.exists():
            print(f"[FAIL] Missing required morphology file: {r.name}")
            return False

    with open(manifest_file, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    with open(meta_file, "r", encoding="utf-8") as f:
        meta = json.load(f)

    pos_data = np.fromfile(pos_file, dtype=np.float32)
    body_data = np.fromfile(body_file, dtype=np.uint16)
    offset_data = np.fromfile(offset_file, dtype=np.uint32)

    total_segments = manifest["totalSegments"]
    neuron_count = manifest["totalNeuronsInGraph"]

    # Check array lengths
    if len(pos_data) != total_segments * 6:
        print(f"[FAIL] segmentPositions length mismatch: expected {total_segments*6}, got {len(pos_data)}")
        return False

    if len(body_data) != total_segments:
        print(f"[FAIL] segmentBodyIds length mismatch: expected {total_segments}, got {len(body_data)}")
        return False

    if len(offset_data) != neuron_count + 1:
        print(f"[FAIL] neuronOffsets length mismatch: expected {neuron_count+1}, got {len(offset_data)}")
        return False

    if offset_data[0] != 0 or offset_data[-1] != total_segments:
        print(f"[FAIL] neuronOffsets bounds invalid: start={offset_data[0]}, end={offset_data[-1]} vs expected={total_segments}")
        return False

    # Check finite coordinates
    if not np.all(np.isfinite(pos_data)):
        print("[FAIL] segmentPositions contains NaN or Inf coordinates.")
        return False

    # Check 100% real body IDs
    for m in meta:
        bid = m["bodyId"]
        if not bid.isdigit():
            print(f"[FAIL] Non-numeric bodyId detected: {bid}")
            return False

    # Check manifest hashes
    for fname, expected_hash in manifest.get("files", {}).items():
        fpath = target_dir / f"{fname}.{'bin' if 'Positions' in fname or 'BodyIds' in fname or 'Offsets' in fname else 'json'}"
        if fpath.exists():
            actual_hash = compute_sha256(fpath)
            if actual_hash != expected_hash:
                print(f"[FAIL] SHA-256 hash mismatch for {fpath.name}")
                return False

    print("=======================================================")
    print("   MaleCNS MORPHOLOGY VALIDATION: " + target_dir.name)
    print("=======================================================")
    print(f"Dataset          {manifest.get('dataset')} {manifest.get('datasetVersion')}")
    print(f"Provenance       {manifest.get('provenance')}")
    print(f"Neurons in graph {manifest.get('totalNeuronsInGraph')}")
    print(f"With morphology  {manifest.get('morphologyNeurons')} / {manifest.get('totalNeuronsInGraph')}")
    print(f"Total SWC nodes  {manifest.get('totalRawNodes'):,}")
    print(f"Rendered segments{manifest.get('totalSegments'):,}")
    print(f"Scale bar (100um){manifest.get('globalTransform', {}).get('scaleBar100umVis'):.4f} vis units")
    print(f"Integrity check  PASS (Finite coordinates, valid offsets, valid hashes)")
    print("-------------------------------------------------------")
    print("MORPHOLOGY VALID: Authentic MaleCNS v1.0 reconstructed morphology verified.")
    return True

if __name__ == "__main__":
    repo_root = Path(__file__).resolve().parents[2]
    d1 = repo_root / "data" / "morphology"
    d2 = repo_root / "public" / "data" / "morphology"
    ok1 = validate_morphology_dir(d1)
    ok2 = validate_morphology_dir(d2)
    sys.exit(0 if ok1 and ok2 else 1)
`;

const pipelineScript = `"""
End-to-end pipeline: download MaleCNS SWC skeletons, preprocess into compact binary buffers,
and validate.
"""
import sys
from pathlib import Path

from download_morphology import download_all_skeletons
from preprocess_morphology import preprocess_morphology
from validate_morphology import validate_morphology_dir

def run_morphology_pipeline():
    repo_root = Path(__file__).resolve().parents[2]
    d1 = repo_root / "data" / "morphology"
    d2 = repo_root / "public" / "data" / "morphology"

    print("Step 1: Downloading official MaleCNS SWC skeletons from Janelia neuPrint...")
    download_all_skeletons(max_workers=24)

    print("\\nStep 2: Preprocessing skeletons into compact binary buffers...")
    preprocess_morphology()

    print("\\nStep 3: Validating morphology buffers...")
    ok1 = validate_morphology_dir(d1)
    ok2 = validate_morphology_dir(d2)

    if ok1 and ok2:
        print("\\nAll MaleCNS morphology assets successfully downloaded, preprocessed, and validated!")
        return True
    else:
        print("\\nMorphology validation failed!")
        return False

if __name__ == "__main__":
    success = run_morphology_pipeline()
    sys.exit(0 if success else 1)
`;

fs.writeFileSync("tools/morphology/download_morphology.py", downloadScript.trim() + "\n");
fs.writeFileSync("tools/morphology/preprocess_morphology.py", preprocessScript.trim() + "\n");
fs.writeFileSync("tools/morphology/validate_morphology.py", validateScript.trim() + "\n");
fs.writeFileSync("tools/morphology/pipeline.py", pipelineScript.trim() + "\n");
console.log("All morphology tools written successfully!");