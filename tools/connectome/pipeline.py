"""
End-to-end pipeline: download MaleCNS dataset, extract sensorimotor subgraph,
generate CSR runtime binaries, and validate.
"""
import sys
from pathlib import Path

from download_malecns import download_all
from build_runtime_graph import build_runtime_graph
from validate_connectome import validate_connectome_dir

def run_pipeline(min_weight: int = 8):
    repo_root = Path(__file__).resolve().parents[2]
    raw_dir = repo_root / "data" / "raw"
    data_dir = repo_root / "data" / "connectome"
    public_dir = repo_root / "public" / "data" / "connectome"

    print("Step 1: Downloading official Janelia MaleCNS v1.0 feather files if needed...")
    download_all(raw_dir)

    print("\nStep 2 & 3: Extracting sensorimotor subgraph and building CSR arrays...")
    build_runtime_graph(raw_dir, [data_dir, public_dir], min_weight=min_weight)

    print("\nStep 4: Validating generated connectome graphs...")
    ok1 = validate_connectome_dir(data_dir)
    ok2 = validate_connectome_dir(public_dir)

    if ok1 and ok2:
        print("\nAll MaleCNS connectome assets successfully extracted, built, and validated!")
        return True
    else:
        print("\nValidation failed!")
        return False

if __name__ == "__main__":
    min_w = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    success = run_pipeline(min_weight=min_w)
    sys.exit(0 if success else 1)
