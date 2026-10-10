#!/usr/bin/env python3
"""String-2/3/4 autopsy (TRAIN-fit + heldout GT boxes, frozen heads).

Per GT digit: truth/pred string, confidence, staff geometry (comb tier,
y-in-system fraction, page multi-system flag), pairing (x-column note
present?), abstention at taus. Separates wrong-predictions vs abstention
vs geometry vs pairing (boxes excluded: GT boxes by construction).

Usage:
    python3 tools/guitar-vision/proof-string-autopsy.py --out <dir> --samples ... --tag fit
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from scipy import ndimage as ndi

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, TOOLS / path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_pct = _load("proof_context_train_mod", "proof_context_train.py")
_evlink = _load("proof_event_link_mod", "proof-event-link.py")
crops = _load("proof_context_crops_mod", "proof-context-crops.py")

SEED = 20261009


def count_systems(u8: np.ndarray) -> int:
    """Staff systems on the page (same band logic as barlines)."""
    h, w = u8.shape
    ink = u8 < 128
    prof = ink[:, int(w * 0.1):int(w * 0.9)].mean(axis=1)
    rows = np.nonzero(prof > 0.25)[0]
    if len(rows) < 5:
        return 0
    bands = []
    start, prev = rows[0], rows[0]
    for r in rows[1:]:
        if r - prev > 3:
            bands.append((start + prev) / 2)
            start = r
        prev = r
    bands.append((start + prev) / 2)
    systems, cur, prev_m = 0, 1, bands[0]
    for m in bands[1:]:
        if m - prev_m < 60:
            cur += 1
        else:
            if cur >= 5:
                systems += 1
            cur = 1
        prev_m = m
    if cur >= 5:
        systems += 1
    return systems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    parser.add_argument("--samples", required=True)
    parser.add_argument("--tag", default="fit")
    args = parser.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    work_dirs = [Path(w) for w in json.load(open("/tmp/proof/workdirs.json"))]
    string_net = _pct.StringNet().to(device)
    saved_s = torch.load(Path("/tmp/proof/chain-models") / "stringnet.pt",
                          map_location=device, weights_only=True)
    string_net.load_state_dict(saved_s["state"] if "state" in saved_s else saved_s)
    string_net.eval()

    wanted = set(args.samples.split(","))
    confusion: dict[str, dict[str, int]] = {}
    conf_by_cell: dict[str, list] = {}
    geo_err = {"single": [0, 0], "multi": [0, 0]}  # [wrong, total]
    pair_err = {"paired": [0, 0], "solo": [0, 0]}
    tier_err = {"exact": [0, 0], "anchored": [0, 0], "none": [0, 0]}
    yfrac_err: dict[str, list] = {"top": [0, 0], "mid": [0, 0], "bot": [0, 0]}
    n_rows = 0
    with torch.no_grad():
        for mp in sorted(Path("/tmp/proof/hires").glob("*-manifest.json")):
            sample = mp.name.replace("-manifest.json", "")
            if sample not in wanted:
                continue
            man = json.load(open(mp))
            joins = canon = None
            for root in work_dirs:
                for cand in (root / sample / "joins.json",
                             root / "joins.json" if root.name == sample else None):
                    if cand is not None and cand.exists():
                        joins = json.loads(Path(cand).read_text())
                        break
                if joins is not None:
                    break
            for root in work_dirs:
                for cand in (root / sample / "canonical.json",
                             root / "canonical.json" if Path(root).name == sample else None):
                    if cand is not None and Path(cand).exists():
                        canon = json.loads(Path(cand).read_text())
                        break
                if canon is not None:
                    break
            if joins is None:
                continue
            links, _ = _evlink.build_links(joins, canon, sample)
            for tag, meta in man.items():
                if not isinstance(meta, dict) or "file" not in meta:
                    continue
                pno = int(tag.replace("page", ""))
                image = Image.open(meta["file"]).convert("L")
                u8 = np.asarray(image)
                fx, fy = meta["cssWidth"] / meta["viewBox"][0], meta["height"] / meta["viewBox"][1]
                nsys = count_systems(u8)
                # Notehead x positions on this page (pairing).
                note_xs = []
                for sid2, j2 in joins["joins"].items():
                    if (j2.get("page") or 1) != pno or not j2.get("boxes"):
                        continue
                    if "notehead" not in (j2.get("children") or []):
                        continue
                    b = j2["boxes"]
                    note_xs.append((min(x[0] for x in b) + max(x[2] for x in b)) / 2 * fx)
                for sid, join in joins["joins"].items():
                    if (join.get("page") or 1) != pno or not join.get("boxes"):
                        continue
                    if "tab-text" not in (join.get("children") or []):
                        continue
                    ev = (links.get(sid) or {}).get("event")
                    if ev is None:
                        continue
                    tab = ev.get("tab") or {}
                    if tab.get("string") is None:
                        continue
                    boxes = join["boxes"]
                    box = [min(b[0] for b in boxes) * fx, min(b[1] for b in boxes) * fy,
                           max(b[2] for b in boxes) * fx, max(b[3] for b in boxes) * fy]
                    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
                    w, h = box[2] - box[0], box[3] - box[1]
                    half_h = max(h * 1.1, 160 * (h / 253))
                    tall = image.crop((max(int(cx - w), 0), max(int(cy - half_h), 0),
                                       min(int(cx + w), image.width), min(int(cy + half_h), image.height)))
                    tall = tall.resize((64, 256), Image.BILINEAR)
                    tall_t = torch.from_numpy(np.asarray(tall, dtype=np.float32) / 255.0).unsqueeze(0).unsqueeze(0).to(device)
                    post = F.softmax(string_net(tall_t)["string"], dim=1)[0]
                    pred = int(post.argmax())
                    conf = float(post.max())
                    truth = tab["string"] - 1
                    confusion.setdefault(str(truth), {}).setdefault(str(pred), 0)
                    confusion[str(truth)][str(pred)] += 1
                    conf_by_cell.setdefault(f"{truth}->{pred}", []).append(round(conf, 3))
                    wrong = pred != truth
                    geo_err["multi" if nsys > 1 else "single"][1] += 1
                    if wrong: geo_err["multi" if nsys > 1 else "single"][0] += 1
                    paired = any(abs(nx - cx) < 40 for nx in note_xs)
                    pair_err["paired" if paired else "solo"][1] += 1
                    if wrong: pair_err["paired" if paired else "solo"][0] += 1
                    lines, tier = crops.detect_tab_lines(u8, cx, cy, u8.shape[1], u8.shape[0])
                    tier_err[tier if tier else "none"][1] += 1
                    if wrong: tier_err[tier if tier else "none"][0] += 1
                    if lines and len(lines) >= 2 and lines[-1] > lines[0]:
                        frac = (cy - lines[0]) / (lines[-1] - lines[0])
                        band = "top" if frac < 0.33 else ("bot" if frac > 0.67 else "mid")
                        yfrac_err[band][1] += 1
                        if wrong: yfrac_err[band][0] += 1
                    n_rows += 1
    report = {"n": n_rows, "confusion": confusion,
              "confMed": {k: round(float(np.median(v)), 3) for k, v in conf_by_cell.items() if v},
              "geoErr": {k: {"wrong": v[0], "n": v[1], "rate": round(v[0] / max(v[1], 1), 3)} for k, v in geo_err.items()},
              "pairErr": {k: {"wrong": v[0], "n": v[1], "rate": round(v[0] / max(v[1], 1), 3)} for k, v in pair_err.items()},
              "tierErr": {k: {"wrong": v[0], "n": v[1], "rate": round(v[0] / max(v[1], 1), 3)} for k, v in tier_err.items()},
              "yfracErr": {k: {"wrong": v[0], "n": v[1], "rate": round(v[0] / max(v[1], 1), 3)} for k, v in yfrac_err.items()}}
    (out_dir / f"string-autopsy-{args.tag}.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1)[:2500])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
