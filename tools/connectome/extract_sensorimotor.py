"""
Extract a real sensorimotor subgraph from the official Janelia MaleCNS v1.0 connectome.
Preserves real body IDs, cell types, instances, soma coordinates, neurotransmitter consensus,
and biological synapse counts.
"""
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.feather as feather

# Known neurotransmitter sign conventions for Drosophila CNS
NT_SIGN = {
    "acetylcholine": 1,
    "gaba": -1,
    "glutamate": -1,
    "histamine": -1,
    "dopamine": 0,
    "octopamine": 0,
    "serotonin": 0,
    "unclear": 0,
}

DEFAULT_VISUAL_SEEDS = ["LC4", "LC6", "LC10a", "LC10b", "LPLC1", "LPLC2"]
DEFAULT_CX_SEEDS = ["EPG", "PEN_a(PEN1)", "PEN_b(PEN2)", "PFL1", "PFL2", "PFL3"]
DEFAULT_DN_SEEDS = ["DNa01", "DNa02", "DNp01", "DNb01", "MDN"]
DEFAULT_MIN_WEIGHT = 8

def map_neuropil_region(row: pd.Series) -> str:
    """Map MaleCNS cell metadata to core neuropil functional compartment."""
    sc = str(row.get("superclass") or "")
    ct = str(row.get("type") or "")
    if sc == "descending_neuron" or ct.startswith("DN"):
        return "Descending"
    if sc in ("vnc_motor", "vnc_efferent", "vnc_intrinsic") or str(row.get("somaNeuromere") or "").startswith("T"):
        return "VNC"
    if any(ct.startswith(p) for p in ["LC", "LPLC", "VS", "HS", "CT1", "Am1"]):
        return "OpticLobe"
    if any(ct.startswith(p) for p in ["EPG", "PEN", "PFN", "PFL", "EB", "FB", "AB", "NO", "hDelta"]):
        return "CentralComplex"
    return "Protocerebrum"

def extract_sensorimotor_subgraph(
    raw_dir: Path,
    min_weight: int = DEFAULT_MIN_WEIGHT,
    visual_seeds: list[str] | None = None,
    cx_seeds: list[str] | None = None,
    dn_seeds: list[str] | None = None,
) -> dict:
    visual_seeds = visual_seeds or DEFAULT_VISUAL_SEEDS
    cx_seeds = cx_seeds or DEFAULT_CX_SEEDS
    dn_seeds = dn_seeds or DEFAULT_DN_SEEDS

    def find_file(short_name: str, long_name: str) -> Path:
        p1 = raw_dir / long_name
        if p1.exists() and p1.stat().st_size > 0:
            return p1
        p2 = raw_dir / short_name
        if p2.exists() and p2.stat().st_size > 0:
            return p2
        return p1

    ann_path = find_file("annotations.feather", "body-annotations-male-cns-v1.0-minconf-0.5.feather")
    nt_path = find_file("neurotransmitters.feather", "body-neurotransmitters-male-cns-v1.0.feather")
    weights_path = find_file("weights.feather", "connectome-weights-male-cns-v1.0-minconf-0.5-traced-only.feather")

    if not ann_path.exists() or not nt_path.exists() or not weights_path.exists():
        raise FileNotFoundError(
            f"Missing required feather files in {raw_dir}. Run download_malecns.py first."
        )

    ann = feather.read_feather(ann_path)
    nt_df = feather.read_feather(nt_path)
    w_df = feather.read_feather(weights_path)

    print(f"MaleCNS raw dataset: {len(ann):,} neurons, {len(w_df):,} synapses.")

    # Build neurotransmitter map by body ID
    # Take consensus_nt, fall back to predicted_nt
    nt_map = {}
    for _, row in nt_df.iterrows():
        b_id = int(row["body"])
        cons = row.get("consensus_nt")
        pred = row.get("predicted_nt")
        nt_val = cons if (pd.notna(cons) and cons != "unclear") else (pred if pd.notna(pred) else "unclear")
        nt_map[b_id] = str(nt_val)

    # 1. Identify seed populations
    vis_bodies = set(ann[ann["type"].isin(visual_seeds)]["bodyId"].unique())
    cx_bodies = set(ann[ann["type"].isin(cx_seeds)]["bodyId"].unique())
    dn_bodies = set(ann[ann["type"].isin(dn_seeds)]["bodyId"].unique())
    all_dn_bodies = set(ann[ann["superclass"] == "descending_neuron"]["bodyId"].unique())
    vnc_bodies = set(ann[ann["superclass"] == "vnc_motor"]["bodyId"].unique())

    core_seeds = vis_bodies.union(cx_bodies).union(dn_bodies)
    print(f"Seeds: {len(vis_bodies)} visual, {len(cx_bodies)} CX, {len(dn_bodies)} key DNs, {len(all_dn_bodies)} total DNs, {len(vnc_bodies)} VNC motor.")

    # 2. Filter edges with minimum biological synapse count
    wf = w_df[w_df["weight"] >= min_weight]
    print(f"Synapse edges with weight >= {min_weight}: {len(wf):,}")

    # 3. Downstream DNs connected to visual or CX
    active_dns = set(
        wf[wf["body_pre"].isin(core_seeds) & wf["body_post"].isin(all_dn_bodies)]["body_post"].unique()
    ).union(dn_bodies)

    # 4. Active VNC motor effectors connected to active DNs
    active_vnc = set(
        wf[wf["body_pre"].isin(active_dns) & wf["body_post"].isin(vnc_bodies)]["body_post"].unique()
    )

    # 5. Sensorimotor interneurons connecting visual/CX to active DNs
    targets_from_vis = set(wf[wf["body_pre"].isin(vis_bodies)]["body_post"].unique())
    inputs_to_dn = set(wf[wf["body_post"].isin(active_dns)]["body_pre"].unique())
    interneurons = targets_from_vis.intersection(inputs_to_dn)

    # 6. Combined selected neuron set
    selected_body_ids = sorted(list(core_seeds.union(active_dns).union(active_vnc).union(interneurons)))
    selected_set = set(selected_body_ids)

    # 7. Extract induced subgraph edges
    sub_edges_df = wf[wf["body_pre"].isin(selected_set) & wf["body_post"].isin(selected_set)].copy()
    print(f"Extracted sensorimotor subgraph: {len(selected_body_ids):,} real neurons, {len(sub_edges_df):,} biological edges.")

    # 8. Build neuron records with genuine provenance
    ann_indexed = ann.set_index("bodyId")
    neuron_records = []
    
    # Calculate coordinate bounds for normalization
    # Janelia MaleCNS center ~ [48542, 32394, 38817]
    cx_ref, cy_ref, cz_ref = 48542.0, 32394.0, 38817.0
    coord_scale = 45000.0

    for idx, body_id in enumerate(selected_body_ids):
        row = ann_indexed.loc[body_id] if body_id in ann_indexed.index else pd.Series()
        cell_type = str(row.get("type")) if pd.notna(row.get("type")) else "Unknown"
        instance = str(row.get("instance")) if pd.notna(row.get("instance")) else None
        soma_side = str(row.get("somaSide")) if pd.notna(row.get("somaSide")) else None
        superclass = str(row.get("superclass")) if pd.notna(row.get("superclass")) else None
        nt = nt_map.get(body_id, "unclear")
        region = map_neuropil_region(row)

        soma_loc = row.get("somaLocation")
        coord_type = "soma_voxel"
        if soma_loc is not None and isinstance(soma_loc, (list, np.ndarray)) and len(soma_loc) == 3:
            vx, vy, vz = float(soma_loc[0]), float(soma_loc[1]), float(soma_loc[2])
            nx = (vx - cx_ref) / coord_scale
            ny = -(vy - cy_ref) / coord_scale  # invert Y for 3D graphics
            nz = (vz - cz_ref) / coord_scale
        else:
            coord_type = "neuropil_fallback"
            # Fallback anatomical placement by region
            region_offsets = {
                "OpticLobe": (-0.8 if soma_side == "L" else 0.8, 0.2, 0.0),
                "CentralComplex": (0.0, 0.3, 0.1),
                "Protocerebrum": (-0.3 if soma_side == "L" else 0.3, 0.1, -0.1),
                "Descending": (-0.1 if soma_side == "L" else 0.1, -0.4, -0.2),
                "VNC": (-0.2 if soma_side == "L" else 0.2, -0.8, -0.4),
            }
            ox, oy, oz = region_offsets.get(region, (0.0, 0.0, 0.0))
            nx = ox + (np.random.RandomState(body_id).uniform(-0.08, 0.08))
            ny = oy + (np.random.RandomState(body_id + 1).uniform(-0.08, 0.08))
            nz = oz + (np.random.RandomState(body_id + 2).uniform(-0.08, 0.08))

        display_name = f"{instance or cell_type} [{body_id}]"

        neuron_records.append({
            "index": idx,
            "bodyId": str(body_id),
            "name": display_name,
            "type": cell_type,
            "instance": instance,
            "hemisphere": "L" if soma_side == "L" else ("R" if soma_side == "R" else ("bilateral" if soma_side in ("B", "M") else "unknown")),
            "superclass": superclass,
            "region": region,
            "neurotransmitter": nt,
            "pos": [round(float(nx), 4), round(float(ny), 4), round(float(nz), 4)],
            "coordinateType": coord_type,
            "sourceDataset": "male-cns:v1.0",
        })

    # 9. Index edges to runtime 0..N-1 indices
    body_to_idx = {b: i for i, b in enumerate(selected_body_ids)}
    
    edge_records = []
    for _, edge in sub_edges_df.iterrows():
        b_pre = int(edge["body_pre"])
        b_post = int(edge["body_post"])
        syn_count = int(edge["weight"])
        nt_pre = nt_map.get(b_pre, "unclear")
        sign = NT_SIGN.get(nt_pre, 0)

        edge_records.append({
            "sourceIndex": body_to_idx[b_pre],
            "targetIndex": body_to_idx[b_post],
            "sourceBodyId": str(b_pre),
            "targetBodyId": str(b_post),
            "synapseCount": syn_count,
            "neurotransmitter": nt_pre,
            "sign": sign,
        })

    manifest = {
        "dataset": "MaleCNS",
        "datasetVersion": "v1.0",
        "source": "https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome",
        "provenance": "malecns-real",
        "graphType": "real-connectome-derived",
        "extractionMode": "sensorimotor-subgraph",
        "neuronCount": len(neuron_records),
        "synapseCount": len(edge_records),
        "seedCount": len(core_seeds),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "extractionParameters": {
            "minSynapseWeight": min_weight,
            "visualSeeds": visual_seeds,
            "cxSeeds": cx_seeds,
            "descendingSeeds": dn_seeds,
            "vncSuperclass": "vnc_motor",
        },
        "pathwaySummary": {
            "visualNeurons": len(vis_bodies),
            "cxNeurons": len(cx_bodies),
            "descendingNeurons": len(active_dns),
            "vncMotorNeurons": len(active_vnc),
            "interneurons": len(interneurons),
        }
    }

    return {
        "manifest": manifest,
        "neurons": neuron_records,
        "edges": edge_records,
    }

if __name__ == "__main__":
    raw_path = Path(__file__).resolve().parents[2] / "data" / "raw"
    result = extract_sensorimotor_subgraph(raw_path)
    print("Extraction completed successfully.")
