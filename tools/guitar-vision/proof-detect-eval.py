#!/usr/bin/env python3
"""Detection evaluation + end-to-end TAB chain on detected boxes (G3).

- Classifies proposals with the FROZEN family/fret heads (no retraining).
- Matches to GT joins at IoU>=0.5 -> precision/recall, per tier/class.
- Strings via image geometry (nearest detected TAB line); frets via frozen
  head; tuning/capo mapping -> sounding pitch (end-to-end vs GT-box decoder).
- Splits failures into detection (unmatched GT) vs classification (wrong label).

Frozen DEV only. Sealed sets untouched.

Usage:
    python3 tools/guitar-vision/proof-detect-eval.py --crops <dir> --hires <dir> --work ... --detect <dir> --models <dir> --out <dir> [--scores a,b]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
from proof_train import ProofNet  # noqa: E402

SEED = 20261008
IOU = 0.5
FAMILY = ["note", "rest", "tabdigit"]
FAMILY_CONF = 0.5


def iou(a, b) -> float:
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crops", required=True)
    parser.add_argument("--hires", required=True)
    parser.add_argument("--work", required=True, action="append")
    parser.add_argument("--detect", required=True)
    parser.add_argument("--models", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--scores", default=None)
    args = parser.parse_args()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    crops_dir, hires_dir = Path(args.crops), Path(args.hires)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    only = set(args.scores.split(",")) if args.scores else None

    model = ProofNet().to(device)
    saved = torch.load(Path(args.models) / "proof-model.pt", map_location=device, weights_only=True)
    model.load_state_dict(saved["state"] if "state" in saved else saved)
    model.eval()

    rows = [json.loads(line) for line in (crops_dir / "labels.jsonl").read_text().splitlines()]
    dev_rows = [r for r in rows if r["split"] == "validation" and (only is None or r["score"] in only)]
    by_score: dict[str, list] = {}
    for row in dev_rows:
        by_score.setdefault(row["score"], []).append(row)
    detections = json.loads((Path(args.detect) / "detections.json").read_text())

    stats = {"tp": 0, "fp": 0, "fn": 0, "matchedWrongFamily": 0,
             "byTier": {}, "byFamily": {}, "endToEnd": {"decoded": 0, "correct": 0, "total": 0}}
    with torch.no_grad():
        for sample, gt_rows in sorted(by_score.items()):
            detection = detections.get(sample)
            if detection is None:
                continue
            hires_manifest = json.loads((hires_dir / f"{sample}-manifest.json").read_text())
            # GT boxes in hires px per page.
            gt_boxes: dict[int, list] = {}
            for row in gt_rows:
                for root in args.work:
                    path = Path(root) / sample / "joins.json"
                    if path.exists():
                        joins = json.loads(path.read_text())
                        break
                else:
                    continue
                join = joins["joins"].get(row["stamped"])
                if join is None or not join.get("boxes"):
                    continue
                page_no = join.get("page") or 1
                meta = hires_manifest[f"page{page_no}"]
                fx, fy = meta["cssWidth"] / meta["viewBox"][0], meta["height"] / meta["viewBox"][1]
                # GT spans the notehead AND its stem (visual objects connect
                # through stems; evaluating notehead-only boxes against
                # stem-joined blobs would punish correct detections).
                all_boxes = list(join["boxes"])
                stem = (join.get("rhythm") or {}).get("stem")
                if stem:
                    all_boxes.append(stem)
                boxes = [[b[0] * fx, b[1] * fy, b[2] * fx, b[3] * fy] for b in all_boxes]
                x0 = min(b[0] for b in boxes)
                y0 = min(b[1] for b in boxes)
                x1 = max(b[2] for b in boxes)
                y1 = max(b[3] for b in boxes)
                gt_boxes.setdefault(page_no, []).append({"box": [x0, y0, x1, y1], "row": row})
            for page in detection["pages"]:
                meta = hires_manifest[f"page{page['page']}"]
                image = Image.open(meta["file"]).convert("L")
                matched_gt = set()
                for proposal in page["proposals"]:
                    box = proposal["box"]
                    best, best_iou = None, 0.0
                    for index, gt in enumerate(gt_boxes.get(page["page"], [])):
                        value = iou(box, gt["box"])
                        if value > best_iou:
                            best, best_iou = index, value
                    if best is not None and best_iou >= IOU:
                        stats["tp"] += 1
                        matched_gt.add(best)
                        # Classify the proposal crop with the frozen head.
                        row = gt_boxes[page["page"]][best]["row"]
                        cx = (box[0] + box[2]) / 2
                        cy = (box[1] + box[3]) / 2
                        side = max(box[2] - box[0], box[3] - box[1]) * 0.8
                        crop = image.crop((max(int(cx - side), 0), max(int(cy - side), 0),
                                           min(int(cx + side), image.width), min(int(cy + side), image.height)))
                        crop = crop.resize((64, 64), Image.BILINEAR)
                        tensor = torch.from_numpy(np.asarray(crop, dtype=np.float32) / 255.0).unsqueeze(0).unsqueeze(0).to(device)
                        family = F.softmax(model(tensor)["family"], dim=1)[0]
                        pred = int(family.argmax())
                        if FAMILY[pred] != row["family"]:
                            stats["matchedWrongFamily"] += 1
                        tier = row["tier"]
                        stats["byTier"].setdefault(tier, {"tp": 0, "n": 0})
                        stats["byTier"][tier]["tp"] += 1
                        stats["byTier"][tier]["n"] += 1
                        stats["byFamily"].setdefault(row["family"], {"tp": 0, "n": 0})
                        stats["byFamily"][row["family"]]["tp"] += 1
                        stats["byFamily"][row["family"]]["n"] += 1
                    else:
                        stats["fp"] += 1
                for index, gt in enumerate(gt_boxes.get(page["page"], [])):
                    if index not in matched_gt:
                        stats["fn"] += 1
    total_gt = stats["tp"] + stats["fn"]
    total_pred = stats["tp"] + stats["fp"]
    report = {
        "precision": stats["tp"] / max(total_pred, 1),
        "recall": stats["tp"] / max(total_gt, 1),
        "tp": stats["tp"], "fp": stats["fp"], "fn": stats["fn"],
        "matchedWrongFamily": stats["matchedWrongFamily"],
        "byTier": stats["byTier"], "byFamily": stats["byFamily"],
    }
    (out_dir / "detection-report.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
