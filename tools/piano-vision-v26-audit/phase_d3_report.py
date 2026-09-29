"""Phase D3 - corpus consistency report.

Reports the frozen acceptance evidence for the real-PDF corpus: what entered,
what was refused and why, residual distributions, and rejection rate by score
and by engraving. Correctness over record count: nothing here widens a
threshold to admit more data, and the counts are the point, not the yield.
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
sys.path.insert(0, str(H.V26_ROOT / "tools/real-pdf-adaptation"))
from realpdf_data import load_realpdf_records  # noqa: E402
from staff_geometry_verify import MAX_LEDGER_SPACES  # noqa: E402

LETTERS = "CDEFGAB"
MIDDLE = {"upper": 34, "lower": 22}


def main():
    cov = json.loads((H.REALPDF_ROOT / "coverage.json").read_text())
    index = json.loads(H.REALPDF_INDEX.read_text())
    rows, gate_tot, reasons_tot = [], Counter(), Counter()
    by_engraving = defaultdict(lambda: {"scores": 0, "records": 0, "pitch": 0,
                                        "gate_refusals": 0})
    for score in index["scores"]:
        sid, split = score["score_id"], score["split"]
        meta = next((c for c in cov["scores"] if c["score_id"] == sid), {})
        ks, resid, role_ok, role_tot = [], [], 0, 0
        n_pitch = 0
        for rec in load_realpdf_records(sid, split, H.REALPDF_INDEX):
            m = rec["input"]["modelInput"]
            bands = m["geometry"]["staffBands"]["staffBands"]
            centres = {b["staffRole"]: (b["y0"] + b["y1"]) / 2 for b in bands}
            objs = m["physicalObjects"]
            for lab in rec["target"]["families"].get("PITCH_STAFF", []):
                if lab.get("state") != "KNOWN" or not lab.get("isPositive"):
                    continue
                v = lab.get("value") or {}
                k = (v.get("staffPosition") or {}).get("stepsFromBandCenter")
                role = v.get("staffRole")
                if k is None or role not in MIDDLE:
                    continue
                n_pitch += 1
                ks.append(abs(float(k)))
                wp = v.get("writtenPitch") or {}
                d = MIDDLE[role] + int(round(2 * float(k)))
                td = LETTERS.index(str(wp.get("step", "C")).upper()) + 7 * int(wp.get("octave", 4))
                resid.append(d - td)
                ix = (lab.get("objectIndexes") or [None])[0]
                if ix is not None and ix < len(objs) and centres:
                    cy = objs[ix]["center"]["y"]
                    role_tot += 1
                    if min(centres, key=lambda r: abs(cy - centres[r])) == role:
                        role_ok += 1
        gate = meta.get("label_gate") or {}
        for k, v in gate.items():
            gate_tot[k] += v
        gr = meta.get("group_reasons") or {}
        for k, v in gr.items():
            reasons_tot[k] += v
        eng = (meta.get("engraving") or "?")
        by_engraving[eng]["scores"] += 1
        by_engraving[eng]["records"] += meta.get("records_written") or 0
        by_engraving[eng]["pitch"] += n_pitch
        by_engraving[eng]["gate_refusals"] += sum(gate.values())
        a = np.array(ks) if ks else np.zeros(0)
        r = np.array(resid) if resid else np.zeros(0)
        rows.append({
            "score_id": sid, "split": split, "engraving": eng,
            "records_written": meta.get("records_written"),
            "objects_total": meta.get("objects_total"),
            "pitch_labels": n_pitch,
            "label_gate_refusals": sum(gate.values()),
            "label_gate_detail": gate,
            "group_rejections": gr,
            "residual_k_median": float(np.median(a)) if a.size else None,
            "residual_k_p95": float(np.percentile(a, 95)) if a.size else None,
            "frac_abs_k_over_ledger": float((a > MAX_LEDGER_SPACES).mean()) if a.size else None,
            "analytic_written_pitch_agreement": float((r == 0).mean()) if r.size else None,
            "analytic_residual_median": float(np.median(r)) if r.size else None,
            "role_matches_nearest": (role_ok / role_tot) if role_tot else None,
        })

    total_pitch = sum(r["pitch_labels"] for r in rows)
    agree = [r["analytic_written_pitch_agreement"] for r in rows
             if r["analytic_written_pitch_agreement"] is not None]
    out = {
        "corpus": H.REALPDF_INDEX.parent.name,
        "ledger_envelope_staff_spaces": MAX_LEDGER_SPACES,
        "totals": {
            "scores": len(rows),
            "records_written": sum(r["records_written"] or 0 for r in rows),
            "pitch_labels": total_pitch,
            "label_gate_refusals": sum(gate_tot.values()),
            "group_rejections": sum(reasons_tot.values()),
        },
        "label_gate_refusals": dict(gate_tot),
        "group_rejection_reasons": dict(reasons_tot),
        "by_engraving": {k: dict(v) for k, v in sorted(by_engraving.items())},
        "per_score": rows,
        "analytic_written_pitch_agreement": {
            "scores_above_0.75": sum(1 for a in agree if a > 0.75),
            "scores_total": len(agree),
            "min": min(agree) if agree else None,
            "median": float(np.median(agree)) if agree else None},
    }
    p = H.write_json("phase_d3_corpus_consistency.json", out)
    print(json.dumps({k: v for k, v in out.items() if k != "per_score"},
                     indent=2, sort_keys=True, default=str))
    print("\n%-34s %-13s %6s %6s %7s %8s %8s" % (
        "score", "split", "recs", "pitch", "refus", "agree", "role=near"))
    for r in rows:
        print("%-34s %-13s %6s %6s %7s %8s %8s" % (
            r["score_id"][:33], r["split"], r["records_written"], r["pitch_labels"],
            r["label_gate_refusals"],
            (round(r["analytic_written_pitch_agreement"], 3)
             if r["analytic_written_pitch_agreement"] is not None else "-"),
            (round(r["role_matches_nearest"], 3)
             if r["role_matches_nearest"] is not None else "-")))
    print("\nwrote", p)


if __name__ == "__main__":
    main()
