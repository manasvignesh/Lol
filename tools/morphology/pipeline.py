"""
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

    print("\nStep 2: Preprocessing skeletons into compact binary buffers...")
    preprocess_morphology()

    print("\nStep 3: Validating morphology buffers...")
    ok1 = validate_morphology_dir(d1)
    ok2 = validate_morphology_dir(d2)

    if ok1 and ok2:
        print("\nAll MaleCNS morphology assets successfully downloaded, preprocessed, and validated!")
        return True
    else:
        print("\nMorphology validation failed!")
        return False

if __name__ == "__main__":
    success = run_morphology_pipeline()
    sys.exit(0 if success else 1)
