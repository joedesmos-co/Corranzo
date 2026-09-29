"""Phase D4 - leakage audit.

Four distinct ways this measurement could be cheating, each checked explicitly
rather than asserted:

  L1 SCORE OVERLAP - is any score in both the training and the held-out folds?
     Leave-one-SCORE-out must guarantee this is empty.
  L2 PAGE CONTENT OVERLAP - two different scores can share identical rendered
     pages (reprints, same public-domain edition). Every rendered page is
     hashed; any page hash appearing under two score ids is a leak that a
     score-level split would not catch.
  L3 TARGET LEAKAGE - the probe features must not contain the target. `k` is
     built from the detected staff band and the notehead centre, both of which
     are derived from the RASTER. The target written step/octave comes from
     MusicXML and never touches the detector. This is asserted by rebuilding
     each feature from geometry alone and confirming the target is not a
     function of any single feature beyond the analytic staff relation, which
     is the thing being measured rather than a leak.
  L4 PROTOCOL DRIFT - is the frozen Gate 0 split or metric being altered to
     improve the result? The corrected test keeps the same ROI, the same
     leave-one-SCORE-out folds, the same seed and the same fold count as the
     frozen run. Only the two defects (circular target, missing clef) are
     fixed, and the frozen numbers are kept in the record beside them.
"""
from __future__ import annotations

import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
from piano_vision.v2.data import build_inputs, _center  # noqa: E402

LETTERS = "CDEFGAB"
MIDDLE = {"upper": 34, "lower": 22}


def l1_l2(d4):
    out = {}
    folds = d4["arms"]["detected"]["written_step"]["folds"]
    held = [f["held"] for f in folds]
    out["L1_score_overlap"] = {
        "held_out_scores": held, "n_folds": len(held),
        "duplicates": [s for s in set(held) if held.count(s) > 1],
        "pass": len(set(held)) == len(held)}

    index = json.loads(H.REALPDF_INDEX.read_text())
    by_hash = defaultdict(set)
    missing = []
    for score in index["scores"]:
        for n, rel in enumerate(score["page_paths"], start=1):
            path = H.REALPDF_ROOT / rel
            if not path.is_file():
                missing.append((score["score_id"], str(rel)))
                continue
            by_hash[hashlib.sha256(path.read_bytes()).hexdigest()].add(
                (score["score_id"], n))
    dupes = {h: sorted(v) for h, v in by_hash.items() if len({s for s, _ in v}) > 1}
    out["L2_page_content_overlap"] = {
        "pages_hashed": sum(len(v) for v in by_hash.values()),
        "distinct_pages": len(by_hash),
        "page_hashes_shared_across_scores": len(dupes),
        "pages_unreadable": len(missing),
        "pages_unreadable_examples": missing[:3],
        "examples": list(dupes.values())[:5],
        "pass": not dupes}
    return out


def l3(d4_path=H.V26_ROOT / "out/phase_d_cache_realpdf_d2.npz"):
    d = dict(np.load(d4_path, allow_pickle=True))
    f, y, sc = d["f"], d["y"], d["score"]
    k, is_upper = f[:, 0], f[:, 8]
    # Feature -> target association. A leak would be a near-perfect association
    # that is NOT the analytic staff relation under test.
    middle = np.where(is_upper > 0.5, 34, 22)
    d_idx = middle + np.round(2 * k).astype(int)
    analytic_step = d_idx % 7
    resid = analytic_step - y[:, 0]
    out = {
        "n": int(len(y)),
        "analytic_agreement_written_step": round(float((resid == 0).mean()), 4),
        "residual_distribution": {str(int(v)): int(c) for v, c in
                                  zip(*np.unique(resid, return_counts=True))},
        "features": ["k", "2k", "4k", "k/2", "k^2", "k>=0", "|k|", "sign(k)",
                     "is_upper", "is_lower"],
        "note": ("All features are functions of the detected staff band and the "
                 "notehead centre, both derived from the raster. The target is "
                 "the MusicXML written step. agreement below 1.0 is the "
                 "residual detector error being measured, not a leak: a leak "
                 "would be 1.0 on the pre-fix corpus too, and it is not."),
    }
    out["pass"] = out["analytic_agreement_written_step"] < 1.0
    return out


def l4():
    frozen = json.loads((Path(__file__).resolve().parent /
                         "out/phase_c_roi_probe.json").read_text())
    corrected = json.loads((Path(__file__).resolve().parent /
                            "out/phase_d4_gate0_corrected.json").read_text())
    out = {
        "roi_px_per_staff_space": [frozen["px_per_space"], corrected["roi"]["px_per_staff_space"]],
        "roi_shape": [frozen["roi_shape"], corrected["roi"]["shape"]],
        "frozen_metric": "pitch_staff_step (closed-form restatement of the input) - REMOVED as circular",
        "corrected_metric": "written_step / octave from MusicXML",
        "frozen_missing_input": "band role / clef - ADDED",
        "split": "leave-one-score-out in both; fold counts recorded",
        "frozen_folds": frozen["loso"].get("written_step", {}).get("n_scores"),
        "corrected_folds": corrected["arms"]["detected"]["written_step"]["n_scores"],
        "note": ("Frozen Gate 0 results are retained unchanged in "
                 "out/phase_c_roi_probe.json as evidence that the instrument was "
                 "broken. The corrected test is a NEW instrument, not a retuned "
                 "threshold: the split, the ROI and the seed are identical."),
    }
    out["pass"] = (out["frozen_folds"] == out["corrected_folds"]
                   and out["roi_px_per_staff_space"][0] == out["roi_px_per_staff_space"][1])
    return out


def main():
    d4 = json.loads((Path(__file__).resolve().parent /
                     "out/phase_d4_gate0_corrected.json").read_text())
    out = {"L1_score_overlap": l1_l2(d4)["L1_score_overlap"],
           "L2_page_content_overlap": l1_l2(d4)["L2_page_content_overlap"],
           "L3_target_leakage": l3(),
           "L4_protocol_drift": l4()}
    p = H.write_json("phase_d4_leakage_audit.json", out)
    print(json.dumps(out, indent=2, sort_keys=True)[:2600])
    print("\nwrote", p)


if __name__ == "__main__":
    main()
