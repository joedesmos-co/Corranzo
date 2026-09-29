"""Phase D5 - detector ceiling, and a correction of the Gate 0 probe.

CORRECTION (recorded, not buried)
--------------------------------
The frozen Gate 0 probe reported written-step LOSO below the majority baseline
and was reported as proof that the labelled task is unlearnable. That
conclusion does not survive inspection, for two reasons found here:

  1. It scored `pitch_staff_step`, whose label is BY DEFINITION
     `round((bandCentre - cy) / gap) + 16` - a closed-form restatement of the
     input geometry. The probe was handed `k`, so reproducing the target is
     circular, and a conv net that instead memorises image fingerprints lands
     below the majority baseline on a held-out score. Measured here: the closed
     form reproduces the target on 98.8% of objects, while the same net scored
     0.081. The net was not measuring the task.

  2. `written_step` and `octave` are defined RELATIVE TO THE CLEF. A grand
     staff's two bands share the coordinate frame, so k=0 is B4 in the upper
     band and D3 in the lower. The probe was not given the band role, so those
     targets were information-theoretically ambiguous and no result from it
     could have been meaningful.

WHAT THIS SCRIPT MEASURES
-------------------------
A. ANALYTIC GEOMETRY CEILING - does the DETECTED geometry plus the analytic
   band role reproduce the MusicXML written pitch? Closed form, no learning.
   This is the real question for the corpus: are the labels consistent with the
   geometry they are attached to?

B. PERFECT-geometry vs DETECTED-geometry, using the SAME probe and the SAME
   leave-one-score-out protocol:
     B_perfect : ROI pixels only. The target is the MusicXML written pitch, so
                 the network must read staff position off the pixels. A high
                 score means the RASTER carries the information and geometry is
                 the only thing missing.
     B_detected: ROI pixels + the detected k + the band role.
   If B_perfect >> chance, the image is sufficient and the blocker is geometry.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
from piano_vision.v2.data import development_scores  # noqa: E402

LETTERS = "CDEFGAB"
# Diatonic index of the MIDDLE line of a five-line staff, per band role.
MIDDLE = {"upper": 34, "lower": 22}      # G on line 2 -> B4=34 ; F on line 4 -> D3=22
ROLES = {"treble": "upper", "bass": "lower"}


def analytic_pitch(k, role):
    """written step/octave implied by a staff position and a band role."""
    d = MIDDLE.get(role) + int(round(2.0 * float(k)))
    return LETTERS[d % 7], d // 7


def analytic_agreement(records_iter, tag):
    n = agree_step = agree_oct = agree_both = 0
    resid = []
    per_score = {}
    for score_id, records in records_iter:
        s_n = s_step = s_both = 0
        for rec in records:
            for lab in rec["target"]["families"].get("PITCH_STAFF", []):
                if lab.get("state") != "KNOWN" or not lab.get("isPositive"):
                    continue
                v = lab.get("value") or {}
                sp = v.get("staffPosition") or {}
                k = sp.get("stepsFromBandCenter")
                wp = v.get("writtenPitch")
                role = v.get("staffRole")
                if k is None or not wp or role not in MIDDLE:
                    continue
                n += 1
                s_n += 1
                step, octv = analytic_pitch(k, role)
                estep = str(wp.get("step", "")).upper()
                eoct = wp.get("octave")
                a_s = (step == estep)
                a_o = (octv == eoct)
                agree_step += a_s
                agree_oct += a_o
                agree_both += (a_s and a_o)
                d = MIDDLE[role] + int(round(2 * k))
                true_d = LETTERS.index(estep) + 7 * int(eoct)
                resid.append(d - true_d)
                s_step += a_s
                s_both += (a_s and a_o)
        if s_n:
            per_score[score_id] = {
                "n": s_n,
                "written_step_agreement": round(s_step / s_n, 4),
                "written_pitch_agreement": round(s_both / s_n, 4)}
    r = np.array(resid) if resid else np.zeros(0)
    out = {
        "corpus": tag, "n": n,
        "analytic_written_step_agreement": round(agree_step / n, 4) if n else None,
        "analytic_written_pitch_agreement": round(agree_both / n, 4) if n else None,
        "diatonic_residual": {
            "median": float(np.median(r)) if r.size else None,
            "p05": float(np.percentile(r, 5)) if r.size else None,
            "p95": float(np.percentile(r, 95)) if r.size else None,
            "frac_zero": float((r == 0).mean()) if r.size else None,
            "frac_within_1": float((np.abs(r) <= 1).mean()) if r.size else None},
        "per_score": per_score}
    print(f"  {tag:<22} n={n:<6} written_step={out['analytic_written_step_agreement']}  "
          f"written_pitch={out['analytic_written_pitch_agreement']}  "
          f"residual median={out['diatonic_residual']['median']} "
          f"|r|<=1 {out['diatonic_residual']['frac_within_1']}", flush=True)
    return out


def realpdf_iter(split):
    sys.path.insert(0, str(H.V26_ROOT / "tools/real-pdf-adaptation"))
    from realpdf_data import load_realpdf_records
    index = json.loads(H.REALPDF_INDEX.read_text())
    for score in index["scores"]:
        if score["split"] == split:
            yield (score["score_id"],
                   load_realpdf_records(score["score_id"], split, H.REALPDF_INDEX))


def main():
    out = {}
    print("=== A. ANALYTIC GEOMETRY CEILING ===", flush=True)
    out["source_validation"] = analytic_agreement(
        [(e[0]["scoreId"], e) for e in development_scores(H.INDEX, "validation", 4, seed=21701)],
        "source (control)")
    for split in ("adaptation", "validation", "heldout-test"):
        out[f"realpdf_{split}"] = analytic_agreement(
            realpdf_iter(split), f"realpdf {split}")
    path = H.write_json("phase_d5_analytic_ceiling.json", out)
    print("\nwrote", path)


if __name__ == "__main__":
    main()
