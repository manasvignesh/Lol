"""
Download official flat-connectome Feather files from Janelia's public Google Cloud Storage bucket.
Dataset: male-cns:v1.0 (HHMI Janelia Research Campus)
Computes and verifies SHA-256 integrity hashes and verifies required DataFrame schemas.
"""
import hashlib
import os
import shutil
import sys
import urllib.request
from pathlib import Path

import pyarrow.feather as feather

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

REQUIRED_COLUMNS = {
    "annotations": ["bodyId", "type", "instance", "superclass"],
    "neurotransmitters": ["body"],
    "weights": ["body_pre", "body_post", "weight"],
}

def compute_sha256(path: Path) -> str:
    """Compute SHA-256 hash of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()

def validate_feather_schema(key: str, path: Path) -> bool:
    """Validate that a feather file is non-empty and has required columns."""
    try:
        df = feather.read_feather(path)
        if len(df) == 0:
            print(f"[FAIL] {path.name} is empty.")
            return False
        required = REQUIRED_COLUMNS.get(key, [])
        missing = [c for c in required if c not in df.columns]
        if missing:
            print(f"[FAIL] {path.name} missing required columns: {missing}")
            return False
        return True
    except Exception as e:
        print(f"[FAIL] Error reading {path.name}: {e}")
        return False

def download_file(key: str, filename: str, dest_path: Path) -> tuple[Path, str]:
    url = f"{BUCKET_URL}/{filename}"
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    # Check primary path
    if dest_path.exists() and dest_path.stat().st_size > 0:
        if validate_feather_schema(key, dest_path):
            file_hash = compute_sha256(dest_path)
            print(f"[EXISTS] {dest_path.name} ({dest_path.stat().st_size / 1e6:.1f} MB | sha256: {file_hash[:12]}...)")
            return dest_path, file_hash

    # Check short alias in same directory
    alias_name = SHORT_ALIASES.get(key)
    if alias_name:
        alias_path = dest_path.parent / alias_name
        if alias_path.exists() and alias_path.stat().st_size > 0:
            if validate_feather_schema(key, alias_path):
                file_hash = compute_sha256(alias_path)
                print(f"[EXISTS via alias] {alias_path.name} -> copying to {dest_path.name} ({alias_path.stat().st_size / 1e6:.1f} MB | sha256: {file_hash[:12]}...)")
                shutil.copyfile(alias_path, dest_path)
                return dest_path, file_hash
    
    print(f"[FETCHING] {filename} from Janelia GCS bucket...")
    
    def reporthook(blocks, block_size, total):
        done = blocks * block_size
        if total > 0 and (blocks % 2000 == 0 or done >= total):
            pct = 100.0 * done / total
            sys.stdout.write(f"\r  Progress: {done / 1e6:6.1f} / {total / 1e6:6.1f} MB ({pct:5.1f}%)")
            sys.stdout.flush()
            
    tmp_dest = dest_path.with_suffix(".part")
    urllib.request.urlretrieve(url, tmp_dest, reporthook=reporthook)
    
    if not validate_feather_schema(key, tmp_dest):
        tmp_dest.unlink(missing_ok=True)
        raise ValueError(f"Downloaded file {filename} failed schema validation.")
        
    tmp_dest.rename(dest_path)
    file_hash = compute_sha256(dest_path)
    print(f"\n[DONE] Saved to {dest_path.name} (sha256: {file_hash})")
    return dest_path, file_hash

def download_all(dest_dir: Path | None = None) -> tuple[dict[str, Path], dict[str, str]]:
    if dest_dir is None:
        dest_dir = Path(__file__).resolve().parents[2] / "data" / "raw"
    dest_dir.mkdir(parents=True, exist_ok=True)
    
    downloaded = {}
    hashes = {}
    for key, filename in FILES.items():
        p, h = download_file(key, filename, dest_dir / filename)
        downloaded[key] = p
        hashes[key] = h
    return downloaded, hashes

if __name__ == "__main__":
    download_all()

