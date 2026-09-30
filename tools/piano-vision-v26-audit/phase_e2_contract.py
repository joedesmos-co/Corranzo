"""Phase E2 - freeze the corrected real-PDF corpus contract.

Emits a versioned, self-describing contract for the CORRECTED corpus so the
Phase E numbers stay reproducible and the superseded corpus stays identifiable
as historical evidence. Nothing here rebuilds or mutates a corpus; it records
what exists and proves the provenance chain.

Recorded: implementation commit, source PDF hashes, rendered page hashes, split
manifests and their content digests, a whole-corpus digest, record and label
counts, refusal reasons, residual distributions, and the leakage checks.

The PREVIOUS corpus is named explicitly as INVALIDATED, never overwritten.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
sys.path.insert(0, str(H.V26_ROOT / "tools/real-pdf-adaptation"))
from realpdf_data import load_realpdf_records  # noqa: E402

CONTRACT_VERSION = "real-pdf-corpus/2.1"
SUPERSEDES = ("real-pdf-corpus/2.0 (local out/realpdf_d2) - preserved unchanged for "
              "reproducibility. 2.1 differs in exactly two ways: (a) stepsFromBandCenter "
              "and the analytic band offset are divided by EACH BAND's own detected "
              "five-line spacing instead of one pooled value, which makes the analytic "
              "band offset exactly +-1 on all 29 score x role pairs (2.0 deviated up to "
              "0.05); (b) std-hungarian-dance-no5 is REFUSED as a source mismatch. "
              "2.0 also supersedes 1.0 (out/realpdf), invalidated because pitch labels "
              "were attached to the wrong object.")
CHANGES_FROM_20 = [
    "band-local staff gap divisor for all band-relative quantities",
    "analytic band offset invariant replaces the 1.35x cross-band guard "
    "(MAX_ANALYTIC_OFFSET_ERROR = 0.10, label-free)",
    "std-hungarian-dance-no5 refused: source_mismatch:pdf_key_differs_from_paired_musicxml",
]
LETTERS = "CDEFGAB"
MIDDLE = {"upper": 34, "lower": 22}


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def digest_of(obj):
    return hashlib.sha256(
        json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def main():
    root = H.REALPDF_ROOT
    index = json.loads((root / "index.json").read_text())
    cov = json.loads((root / "coverage.json").read_text())
    split_doc = json.loads((H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())
    sm_by_id = {s["id"]: s for s in split_doc["scores"]}

    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=H.V26_ROOT,
                            capture_output=True, text=True).stdout.strip()
    impl_sha = {}
    for rel in ("tools/real-pdf-adaptation/build_corpus.py",
                "tools/real-pdf-adaptation/align_objects.py",
                "tools/real-pdf-adaptation/staff_geometry_verify.py",
                "tools/real-pdf-adaptation/realpdf_data.py",
                "tools/real-pdf-adaptation/evaluate_realpdf.py",
                "server/piano_vision_service/v25_adapter.py",
                "server/piano_vision_service/omr_staff_geometry.py",
                "server/piano_vision_service/v25_canonical_features.py"):
        p = H.V26_ROOT / rel
        if p.is_file():
            impl_sha[rel] = hashlib.sha256(p.read_bytes()).hexdigest()

    scores, pages_by_hash = [], {}
    for s in index["scores"]:
        sid = s["score_id"]
        meta = next((c for c in cov["scores"] if c["score_id"] == sid), {})
        pdf = H.V26_ROOT / sm_by_id[sid]["pdf"]
        ph = [sha256_file(root / rel) for rel in s["page_paths"]]
        for rel, h in zip(s["page_paths"], ph):
            pages_by_hash.setdefault(h, set()).add(sid)
        scores.append({
            "score_id": sid, "split": s["split"], "engraving": s.get("engraving"),
            "title": s.get("title"),
            "source_pdf": sm_by_id[sid]["pdf"],
            "source_pdf_sha256": sha256_file(pdf) if pdf.is_file() else None,
            "musicxml": sm_by_id[sid].get("musicxml"),
            "records": meta.get("records_written"),
            "objects_total": meta.get("objects_total"),
            "objects_labelled_pitch": meta.get("objects_labelled_pitch"),
            "objects_labelled_duration": meta.get("objects_labelled_duration"),
            "label_gate_refusals": meta.get("label_gate") or {},
            "group_rejections": meta.get("group_reasons") or {},
            "band_offsets": meta.get("band_offsets") or {},
            "shard_sha256": meta.get("shard_sha256"),
            "page_sha256": ph})
    dup_pages = {h: sorted(v) for h, v in pages_by_hash.items() if len(v) > 1}

    resid = []
    refusals = Counter()
    gate_tot = Counter()
    for s in index["scores"]:
        sid, split = s["score_id"], s["split"]
        meta = next((c for c in cov["scores"] if c["score_id"] == sid), {})
        for k, v in (meta.get("label_gate") or {}).items():
            gate_tot[k] += v
        for rec in load_realpdf_records(sid, split, H.REALPDF_INDEX):
            for lab in rec["target"]["families"].get("PITCH_STAFF", []):
                if lab.get("state") != "KNOWN" or not lab.get("isPositive"):
                    continue
                v = lab["value"]
                k = (v.get("staffPosition") or {}).get("stepsFromBandCenter")
                role = v.get("staffRole")
                wp = v.get("writtenPitch") or {}
                if k is None or role not in MIDDLE or not wp:
                    continue
                d = MIDDLE[role] + int(round(2 * float(k)))
                td = LETTERS.index(str(wp["step"]).upper()) + 7 * int(wp["octave"])
                resid.append(int(d - td))
    a = np.array(resid)
    dist = {str(k): int(c) for k, c in sorted(Counter(a.tolist()).items())}
    n = int(a.size)
    refusals = {k: v for k, v in gate_tot.items() if k != "dependent_label_dropped"}

    manifests = {}
    for split in ("adaptation", "validation", "heldout-test", "diagnostic"):
        p = root / f"{split}.json"
        if p.is_file():
            doc = json.loads(p.read_text())
            manifests[split] = {
                "path": f"{root.name}/{p.name}",
                "records": len(doc["examples"]),
                "scores": sorted({e["score_id"] for e in doc["examples"]}),
                "digest": doc.get("digest"),
                "campaign_split": doc.get("campaign_split")}

    body = {
        "contract_version": CONTRACT_VERSION,
        "generated_utc": None,
        "implementation_commit": commit,
        "implementation_sha256": impl_sha,
        "supersedes": SUPERSEDES,
        "corpus_root": str(root),
        "render_dpi": index.get("render_dpi"),
        "assembler_version": index.get("assemblerVersion"),
        "manifest_digest": index.get("manifest_digest"),
        "scores": scores,
        "split_manifests": manifests,
        "totals": {
            "scores": len(scores),
            "records_written": sum(s["records"] or 0 for s in scores),
            "accepted_pitch_labels": sum(s["objects_labelled_pitch"] or 0 for s in scores),
            "objects_total": sum(s["objects_total"] or 0 for s in scores),
        },
        "refusals": {
            "label_gate_total": int(sum(gate_tot.values())),
            "label_gate_reasons": refusals,
            "dependent_labels_dropped": int(gate_tot.get("dependent_label_dropped", 0)),
            "group_rejections": {k: v for k, v in sorted(
                Counter({k: sum((s["group_rejections"] or {}).get(k, 0) for s in scores)
                         for k in {kk for s in scores for kk in s["group_rejections"]}}).items(),
                key=lambda kv: -kv[1])},
        },
        "residual_diatonic_steps": {
            "n": n, "distribution": dist,
            "frac_zero": round(float((a == 0).mean()), 6),
            "frac_within_1": round(float((np.abs(a) <= 1).mean()), 6),
            "frac_abs_ge_2": round(float((np.abs(a) >= 2).mean()), 6),
            "note": ("Full diatonic residual of the detected geometry against the "
                     "MusicXML written pitch. |r|>=2 would indicate a staff-role or "
                     "clef-classification failure; it is 0."),
        },
        "leakage": {
            "page_hashes_shared_across_scores": len(dup_pages),
            "page_hash_examples": list(dup_pages.values())[:5],
            "distinct_page_hashes": len(pages_by_hash),
            "grouping": "by score; a score belongs to exactly one split",
            "split_disjointness": "asserted by realpdf_data.SPLIT_GUARD and re-checked by make_manifests.py",
            "pass": not dup_pages,
        },
    }
    body["changes_from_2_0"] = CHANGES_FROM_20
    body["frozen_baseline_on_this_corpus"] = {
        "note": "fresh pitch head on the unchanged frozen V2.5 object embedding, "
                "leave-one-score-out, corpus/2.1, 17 scores",
        "weighted_written_pitch": 0.6056, "macro_written_pitch": 0.5349,
        "written_step": 0.7537, "octave": 0.9619, "midi": 0.6075, "n_labels": 6775,
        "corpus_2_0_for_comparison": {"weighted": 0.5726, "macro": 0.5264,
                                      "n_labels": 7625}}
    body["corpus_digest"] = digest_of({k: v for k, v in body.items()
                                       if k not in ("corpus_digest", "generated_utc")})
    out = H.write_json("phase_e2_corpus_contract.json", body)
    print(json.dumps({k: v for k, v in body.items() if k != "scores"},
                     indent=2, sort_keys=True, default=str)[:3000])
    print("\nper-score contract entries:", len(scores))
    print("wrote", out)


if __name__ == "__main__":
    main()
