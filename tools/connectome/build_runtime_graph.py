"""
Build CSR binary arrays and runtime assets from extracted MaleCNS sensorimotor subgraph.
Outputs to data/connectome/ and public/data/connectome/
"""
import json
import os
import shutil
import struct
import sys
from pathlib import Path

import numpy as np

from extract_sensorimotor import extract_sensorimotor_subgraph

# Normalization factor converting biological synapse count to LIF synaptic conductance (nS)
# e.g., 1 biological synapse ~ 0.08 nS peak conductance
SYNAPSE_TO_CONDUCTANCE_NS = 0.08

def build_runtime_graph(raw_dir: Path, output_dirs: list[Path], min_weight: int = 8) -> dict:
    subgraph = extract_sensorimotor_subgraph(raw_dir, min_weight=min_weight)

    manifest = subgraph["manifest"]
    neurons = subgraph["neurons"]
    edges = subgraph["edges"]

    num_neurons = len(neurons)
    num_edges = len(edges)

    print(
        f"Building CSR representation for {num_neurons:,} neurons, {num_edges:,} biological edges, and {manifest.get('biologicalSynapseTotal', 0):,} underlying biological synapses..."
    )

    # Group outgoing edges by source index
    adj: list[list[dict]] = [[] for _ in range(num_neurons)]
    for edge in edges:
        src = edge["sourceIndex"]
        adj[src].append(edge)

    # Sort outgoing edges by target index for O(1) CSR lookup
    for src in range(num_neurons):
        adj[src].sort(key=lambda e: e["targetIndex"])

    indptr = np.zeros(num_neurons + 1, dtype=np.uint32)
    indices = np.zeros(num_edges, dtype=np.uint32)
    weights = np.zeros(num_edges, dtype=np.float32)
    signs = np.zeros(num_edges, dtype=np.int8)
    biological_weights = np.zeros(num_edges, dtype=np.uint32)

    edge_offset = 0
    for src in range(num_neurons):
        indptr[src] = edge_offset
        for edge in adj[src]:
            indices[edge_offset] = edge["targetIndex"]
            biological_weights[edge_offset] = edge["synapseCount"]
            weights[edge_offset] = float(edge["synapseCount"]) * SYNAPSE_TO_CONDUCTANCE_NS
            signs[edge_offset] = edge["sign"]
            edge_offset += 1
    indptr[num_neurons] = edge_offset

    assert edge_offset == num_edges, f"Edge count mismatch: {edge_offset} != {num_edges}"

    manifest["synapseToConductanceFactor"] = SYNAPSE_TO_CONDUCTANCE_NS
    manifest["indptrLength"] = len(indptr)
    manifest["indicesLength"] = len(indices)

    # Write assets to each destination directory
    for out_dir in output_dirs:
        out_dir.mkdir(parents=True, exist_ok=True)
        print(f"Writing runtime files to {out_dir}...")

        with open(out_dir / "manifest.json", "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)

        with open(out_dir / "neurons.json", "w", encoding="utf-8") as f:
            json.dump(neurons, f, indent=2)

        indptr.tofile(out_dir / "indptr.bin")
        indices.tofile(out_dir / "indices.bin")
        weights.tofile(out_dir / "weights.bin")
        signs.tofile(out_dir / "signs.bin")
        biological_weights.tofile(out_dir / "biologicalWeights.bin")

    print(f"Runtime graph assets successfully generated across {len(output_dirs)} locations.")
    return {
        "manifest": manifest,
        "neuronCount": num_neurons,
        "edgeCount": num_edges,
    }

if __name__ == "__main__":
    repo_root = Path(__file__).resolve().parents[2]
    raw_path = repo_root / "data" / "raw"
    out_paths = [
        repo_root / "data" / "connectome",
        repo_root / "public" / "data" / "connectome",
    ]
    min_w = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    build_runtime_graph(raw_path, out_paths, min_weight=min_w)
