"""
Preprocess official MaleCNS SWC skeletons into compact binary buffers.
Applies ONE unified global anatomical transform (MaleCNS nm voxels -> visualization space).
Outputs:
- segmentPositions.bin (Float32Array [x1, y1, z1, x2, y2, z2, ...])
- segmentBodyIds.bin (Uint16Array neuron indices)
- neuronOffsets.bin (Uint32Array segment start offsets)
- morphologyMeta.json (Per-neuron metadata)
- morphology-manifest.json (Global manifest and dataset provenance)
"""
import array
import hashlib
import json
import os
import shutil
import sys
import time
from pathlib import Path

def compute_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()

def preprocess_morphology(max_segments_per_neuron: int = 1500):
    t0 = time.time()
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

    # Pass 1: Scan skeletons for bounding box
    min_x, max_x = float("inf"), float("-inf")
    min_y, max_y = float("inf"), float("-inf")
    min_z, max_z = float("inf"), float("-inf")
    total_raw_nodes = 0
    loaded_skeletons = {}

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
                    loaded_skeletons[idx] = rows
                    total_raw_nodes += len(rows)
                    for r in rows:
                        x, y, z = float(r[1]), float(r[2]), float(r[3])
                        if x < min_x: min_x = x
                        if x > max_x: max_x = x
                        if y < min_y: min_y = y
                        if y > max_y: max_y = y
                        if z < min_z: min_z = z
                        if z > max_z: max_z = z
        except Exception:
            continue

    print(f"Skeletons loaded: {len(loaded_skeletons)} / {len(neurons)}")
    print(f"Total raw SWC nodes: {total_raw_nodes:,}")

    if len(loaded_skeletons) == 0:
        raise ValueError("No valid skeleton files found in data/morphology/raw.")

    center_x = (min_x + max_x) / 2.0
    center_y = (min_y + max_y) / 2.0
    center_z = (min_z + max_z) / 2.0

    span_x = max_x - min_x
    span_y = max_y - min_y
    span_z = max_z - min_z
    max_span = max(span_x, span_y, span_z)

    # Global uniform scale factor: maps max anatomical dimension to 2.4 visualization units
    # (keeps whole brain in [-1.2, 1.2] range)
    global_scale = 2.4 / max_span

    # MaleCNS voxel size: 8nm x 8nm x 8nm
    # 100 um = 100,000 nm = 12,500 voxels
    scale_bar_100um_vis = 12500.0 * global_scale

    print(f"Global bounds (voxels): X=[{min_x:.0f}, {max_x:.0f}], Y=[{min_y:.0f}, {max_y:.0f}], Z=[{min_z:.0f}, {max_z:.0f}]")
    print(f"Center (voxels): [{center_x:.1f}, {center_y:.1f}, {center_z:.1f}]")
    print(f"Global scale: {global_scale:.8f} (100 um = {scale_bar_100um_vis:.4f} vis units)")

    # Pass 2: Build segments and pack into binary buffers
    pos_array = array.array("f")   # Float32 flat array [x1, y1, z1, x2, y2, z2, ...]
    body_id_array = array.array("H") # Uint16 flat array
    offset_array = array.array("I")  # Uint32 flat array
    offset_array.append(0)

    morphology_meta = []
    total_segments = 0

    for idx, n in enumerate(neurons):
        bid = n["bodyId"]
        if idx not in loaded_skeletons:
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
                "centroid": [0.0, 0.0, 0.0],
                "bounds": {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]},
            })
            offset_array.append(total_segments)
            continue

        rows = loaded_skeletons[idx]

        # Build node lookup: rowId -> (vx, vy, vz, rad, link)
        node_map = {}
        n_min_x, n_max_x = float("inf"), float("-inf")
        n_min_y, n_max_y = float("inf"), float("-inf")
        n_min_z, n_max_z = float("inf"), float("-inf")

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

            if vx < n_min_x: n_min_x = vx
            if vx > n_max_x: n_max_x = vx
            if vy < n_min_y: n_min_y = vy
            if vy > n_max_y: n_max_y = vy
            if vz < n_min_z: n_min_z = vz
            if vz > n_max_z: n_max_z = vz

        # Build segments from parent links
        neuron_segs = []
        for row_id, (vx, vy, vz, rad, link) in node_map.items():
            if link in node_map and link != -1:
                px, py, pz, _, _ = node_map[link]
                neuron_segs.append((px, py, pz, vx, vy, vz))

        # Decimate if neuron has excessive segments
        if len(neuron_segs) > max_segments_per_neuron:
            step = len(neuron_segs) / max_segments_per_neuron
            sampled_indices = [int(i * step) for i in range(max_segments_per_neuron)]
            neuron_segs = [neuron_segs[i] for i in sampled_indices]

        # Append to binary arrays
        for seg in neuron_segs:
            pos_array.extend(seg)
            body_id_array.append(idx)

        seg_count = len(neuron_segs)
        total_segments += seg_count
        offset_array.append(total_segments)

        n_cen = [
            round((n_min_x + n_max_x) / 2.0, 4) if n_min_x != float("inf") else 0.0,
            round((n_min_y + n_max_y) / 2.0, 4) if n_min_y != float("inf") else 0.0,
            round((n_min_z + n_max_z) / 2.0, 4) if n_min_z != float("inf") else 0.0,
        ]
        n_min = [round(n_min_x, 4) if n_min_x != float("inf") else 0.0, round(n_min_y, 4) if n_min_y != float("inf") else 0.0, round(n_min_z, 4) if n_min_z != float("inf") else 0.0]
        n_max = [round(n_max_x, 4) if n_max_x != float("-inf") else 0.0, round(n_max_y, 4) if n_max_y != float("-inf") else 0.0, round(n_max_z, 4) if n_max_z != float("-inf") else 0.0]

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
            "centroid": n_cen,
            "bounds": {"min": n_min, "max": n_max},
        })

    print(f"Total rendered line segments: {total_segments:,}")
    print(f"Segment positions array size: {len(pos_array):,} floats ({len(pos_array)*4 / 1e6:.2f} MB)")

    # Prepare manifest
    manifest = {
        "dataset": "malecns:v1.0",
        "datasetName": "MaleCNS",
        "datasetVersion": "v1.0",
        "provenance": "official-janelia-neuprint-swc",
        "neuronCount": len(neurons),
        "morphologyNeurons": len(loaded_skeletons),
        "missingMorphologyCount": len(neurons) - len(loaded_skeletons),
        "totalRawNodes": total_raw_nodes,
        "totalSegments": total_segments,
        "rawVoxelSizeNm": [8, 8, 8],
        "coordinateUnits": "male_cns_8nm_voxels",
        "transform": {
            "center": [round(center_x, 2), round(center_y, 2), round(center_z, 2)],
            "scaleFactor": float(global_scale),
            "scaleBar100umUnits": round(scale_bar_100um_vis, 4),
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

        with open(pos_file, "wb") as f:
            pos_array.tofile(f)
        with open(body_file, "wb") as f:
            body_id_array.tofile(f)
        with open(offset_file, "wb") as f:
            offset_array.tofile(f)

        with open(meta_file, "w", encoding="utf-8") as f:
            json.dump(morphology_meta, f)

        manifest["files"] = {
            "segmentPositions.bin": {"sha256": compute_sha256(pos_file), "byteLength": os.path.getsize(pos_file)},
            "segmentBodyIds.bin": {"sha256": compute_sha256(body_file), "byteLength": os.path.getsize(body_file)},
            "neuronOffsets.bin": {"sha256": compute_sha256(offset_file), "byteLength": os.path.getsize(offset_file)},
            "morphologyMeta.json": {"sha256": compute_sha256(meta_file), "byteLength": os.path.getsize(meta_file)},
        }

        with open(manifest_file, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)

    elapsed = time.time() - t0
    print(f"\nAll morphology binary buffers generated and saved in {elapsed:.2f}s!")
    return manifest

if __name__ == "__main__":
    preprocess_morphology()
