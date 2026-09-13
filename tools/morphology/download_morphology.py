"""
Download official MaleCNS v1.0 SWC skeleton morphology from HHMI Janelia neuPrint API.
Input: public/data/connectome/neurons.json
Output: data/morphology/raw/{bodyId}.json
"""
import concurrent.futures
import json
import os
import sys
import threading
import time
from pathlib import Path
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

NEUPRINT_URL = "https://neuprint.janelia.org/api/skeletons/skeleton/male-cns:v1.0/{bodyId}?format=json"

thread_local = threading.local()

def get_session():
    if not hasattr(thread_local, "session"):
        session = requests.Session()
        retry = Retry(total=3, backoff_factor=0.3, status_forcelist=[429, 500, 502, 503, 504])
        adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=10)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ConnectomeViewer/1.0",
            "Accept": "application/json",
        })
        thread_local.session = session
    return thread_local.session

def fetch_single_skeleton(body_id: str, dest_file: Path) -> tuple[str, bool, int, str]:
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
    session = get_session()

    for attempt in range(4):
        try:
            resp = session.get(url, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                nodes = len(data.get("data", []))
                if nodes > 0:
                    tmp_file = dest_file.with_suffix(".tmp")
                    with open(tmp_file, "w", encoding="utf-8") as f:
                        json.dump(data, f)
                    tmp_file.replace(dest_file)
                    return body_id, True, nodes, "downloaded"
                else:
                    return body_id, False, 0, "empty_nodes"
            elif resp.status_code == 404:
                return body_id, False, 0, "not_found"
            elif resp.status_code == 429:
                time.sleep(0.5 * (2 ** attempt))
                continue
        except Exception:
            time.sleep(0.3 * (2 ** attempt))

    return body_id, False, 0, "failed"

def download_all_skeletons(max_workers: int = 32) -> dict:
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
    print(f"Concurrency: {max_workers} worker threads with HTTP connection pooling\n")

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
    print(f"\nDownload finished in {elapsed:.1f}s.")
    print(f"Morphology obtained: {success_count} / {len(body_ids)} neurons ({pct:.1f}%)")
    print(f"Total skeleton nodes: {total_nodes:,}")
    return results

if __name__ == "__main__":
    download_all_skeletons()
