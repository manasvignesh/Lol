"""
Download official flat-connectome Feather files from Janelia's public Google Cloud Storage bucket.
Dataset: male-cns:v1.0 (HHMI Janelia Research Campus)
"""
import os
import sys
import urllib.request
from pathlib import Path

BUCKET_URL = "https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome"

FILES = {
    "annotations": "body-annotations-male-cns-v1.0-minconf-0.5.feather",
    "neurotransmitters": "body-neurotransmitters-male-cns-v1.0.feather",
    "weights": "connectome-weights-male-cns-v1.0-minconf-0.5-traced-only.feather",
}

SHORT_ALIASES = {
    "annotations": "annotations.feather",
    "neurotransmitters": "neurotransmitters.feather",
    "weights": "weights.feather",
}

def download_file(key: str, filename: str, dest_path: Path) -> Path:
    url = f"{BUCKET_URL}/{filename}"
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    # Check primary path
    if dest_path.exists() and dest_path.stat().st_size > 0:
        print(f"[EXISTS] {dest_path.name} ({dest_path.stat().st_size / 1e6:.1f} MB)")
        return dest_path

    # Check short alias in same directory
    alias_name = SHORT_ALIASES.get(key)
    if alias_name:
        alias_path = dest_path.parent / alias_name
        if alias_path.exists() and alias_path.stat().st_size > 0:
            print(f"[EXISTS via alias] {alias_path.name} -> copying to {dest_path.name} ({alias_path.stat().st_size / 1e6:.1f} MB)")
            import shutil
            shutil.copyfile(alias_path, dest_path)
            return dest_path
    
    print(f"[FETCHING] {filename} from Janelia GCS bucket...")
    
    def reporthook(blocks, block_size, total):
        done = blocks * block_size
        if total > 0 and (blocks % 2000 == 0 or done >= total):
            pct = 100.0 * done / total
            sys.stdout.write(f"\r  Progress: {done / 1e6:6.1f} / {total / 1e6:6.1f} MB ({pct:5.1f}%)")
            sys.stdout.flush()
            
    tmp_dest = dest_path.with_suffix(".part")
    urllib.request.urlretrieve(url, tmp_dest, reporthook=reporthook)
    tmp_dest.rename(dest_path)
    print(f"\n[DONE] Saved to {dest_path.name}")
    return dest_path

def download_all(dest_dir: Path | None = None) -> dict[str, Path]:
    if dest_dir is None:
        dest_dir = Path(__file__).resolve().parents[2] / "data" / "raw"
    dest_dir.mkdir(parents=True, exist_ok=True)
    
    downloaded = {}
    for key, filename in FILES.items():
        downloaded[key] = download_file(key, filename, dest_dir / filename)
    return downloaded

if __name__ == "__main__":
    download_all()
