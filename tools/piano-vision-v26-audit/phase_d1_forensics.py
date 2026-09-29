"""Phase D1 - staff detector forensics.

Runs the PRODUCTION detection path unchanged (same modules, same arguments, no
reimplementation) and records, for every score x page x system x measure x staff
band, the full state of the staff-geometry inference:

    detected stave count, per-stave 5-line lattice (or None)
    grand-staff pairing decision
    per-measure staff_lines, the pooled staff_space, band centres
    whether any band was FABRICATED by a fallback
    the analytic band offset and its deviation from +/-1
    the aligner's own line-count gate and rejection reason

Failures are then bucketed into an explicit taxonomy. No unrelated failures are
grouped under one generic reason, and every bucket carries the concrete evidence
that put an item in it.

Nothing here is a fix. This is the measurement that decides what D2 repairs.
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import fitz
from PIL import Image

V26 = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(V26 / "server"))
sys.path.insert(0, str(V26 / "tools/piano-vision-v25-candidate"))
sys.path.insert(0, str(V26 / "tools/real-pdf-adaptation"))

import piano_vision_service.v25_adapter as adapter_module  # noqa: E402
from piano_vision_service.omr_staff_geometry import (  # noqa: E402
    detect_staff_line_staves, group_staves_into_systems)
from piano_vision_service.v25_canonical_features import staff_space, staff_bands  # noqa: E402
from align_objects import analytic_band_delta  # noqa: E402
from musicxml_truth import score_report  # noqa: E402

RENDER_DPI = adapter_module.RENDER_DPI
SPLIT_DOC = json.loads((V26 / "tools/real-pdf-adaptation/split_manifest.json").read_text())
MAX_PAGES = 4
CLEF_FOR_BAND = {"upper": ("G", 2), "lower": ("F", 4)}
MIN_LINES = 4  # build_corpus.MIN_DETECTED_LINES_PER_BAND

# ------------------------------------------------------------------ taxonomy
TAXONOMY = [
    "ok",
    "no_staves_detected",
    "staff_cluster_without_five_line_lattice",
    "system_dropped_incomplete_staff",
    "grand_staff_not_paired",
    "single_staff_two_stave_page",
    "band_fabricated_by_measure_fallback",
    "lineys_fabricated_by_linspace",
    "staff_space_default_used",
    "staff_space_cross_staff_contaminated",
    "band_line_count_below_gate",
    "band_offset_off_analytic",
    "band_offset_absent",
]


def render_page(document, index):
    page = document[index]
    matrix = fitz.Matrix(RENDER_DPI / 72.0, RENDER_DPI / 72.0)
    pixmap = page.get_pixmap(matrix=matrix, alpha=False)
    image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
    gray = image.convert("L")
    from piano_vision_service.omr_pdf_glyphs import extract_pdf_glyphs
    gray.info["omrGlyphs"] = extract_pdf_glyphs(page, pixmap.width, pixmap.height)
    return gray


def band_evidence(lines, gap, role, measure_y):
    """Per-band evidence, including the analytic invariant check."""
    sign, clef_line = CLEF_FOR_BAND[role]
    ordered = sorted(float(v) for v in (lines or []))
    n = len(ordered)
    ev = {
        "role": role, "lines": ordered, "n_lines": n,
        "line_count_below_gate": n < MIN_LINES,
        "centre": (ordered[0] + ordered[-1]) / 2 if n else None,
        "span": (ordered[-1] - ordered[0]) if n else None,
    }
    if n >= 2 and gap and gap > 1e-9:
        # per-band internal spacing: must be a near-uniform 5-line lattice
        local = [ordered[i + 1] - ordered[i] for i in range(n - 1)]
        ev["local_gaps"] = [float(g) for g in local]
        ev["local_gap_median"] = float(np.median(local))
        ev["local_gap_cv"] = float(np.std(local) / max(1e-9, np.mean(local)))
        ev["implied_full_staff_gap"] = (ordered[-1] - ordered[0]) / 4.0
        ev["pooled_gap"] = float(gap)
        ev["gap_ratio_local_over_pooled"] = ev["implied_full_staff_gap"] / float(gap)
        ev["analytic_delta"] = analytic_band_delta(ordered, gap, sign, clef_line)
        d = ev["analytic_delta"]
        ev["analytic_offset_error"] = None if d is None else abs(abs(d) - 1.0)
    else:
        ev["analytic_delta"] = None
        ev["analytic_offset_error"] = None
    return ev


def score_pages(entry, out):
    """Run production detection on one score, recording every staff decision."""
    score_id = entry["id"]
    rep = out.setdefault(score_id, {
        "split": entry["split"], "engraving": entry.get("engraving"),
        "pdf": entry["pdf"], "pages": [], "taxonomy": Counter(),
        "page_facts": {},
    })
    truth = score_report(entry["musicxml"])
    if not truth.get("ok"):
        rep["musicxml_ok"] = False
        return rep
    rep["musicxml_ok"] = True

    document = fitz.open(str(V26 / entry["pdf"]))
    for p in range(min(len(document), MAX_PAGES)):
        image = render_page(document, p)
        array = np.array(image, dtype=np.float32) / 255.0
        adapter = adapter_module.V25ScoreAdapter.__new__(adapter_module.V25ScoreAdapter)
        content_bounds = adapter._detect_content_bounds(array)
        gray255 = array.astype(np.float64) * 255

        staves = detect_staff_line_staves(gray255, content_bounds)
        groups = group_staves_into_systems(staves)
        systems = adapter._detect_staff_systems(array, content_bounds)
        boxes, _gap = adapter._build_measure_grid(array, systems, content_bounds, 0)

        page = {"page": p + 1, "n_staves": len(staves),
                "n_groups": len(groups), "n_systems": len(systems),
                "n_measures": len(boxes),
                "group_sizes": [len(g) for g in groups],
                "staves_without_lattice": sum(1 for s in staves if not s["lineYs"]),
                "bands": []}
        rep["page_facts"][str(p + 1)] = {
            "n_staves": len(staves), "n_groups": len(groups),
            "n_systems": len(systems), "n_measures": len(boxes),
            "group_sizes": [len(g) for g in groups]}

        # ---- page-level taxonomy ----
        if not staves:
            page["flags"] = ["no_staves_detected"]
            rep["taxonomy"]["no_staves_detected"] += 1
        if staves and page["staves_without_lattice"] == len(staves):
            page["flags"] = page.get("flags", []) + ["staff_cluster_without_five_line_lattice"]
            rep["taxonomy"]["staff_cluster_without_five_line_lattice"] += 1
        if len(staves) == 2 and len(systems) == 2:
            page["flags"] = page.get("flags", []) + ["single_staff_two_stave_page"]
            rep["taxonomy"]["single_staff_two_stave_page"] += 1
        if any(len(g) == 1 for g in groups) and len(staves) > 1:
            page["flags"] = page.get("flags", []) + ["grand_staff_not_paired"]
            rep["taxonomy"]["grand_staff_not_paired"] += 1
        if len(staves) and len(systems) < len(staves):
            page["flags"] = page.get("flags", []) + ["system_dropped_incomplete_staff"]
            rep["taxonomy"]["system_dropped_incomplete_staff"] += 1

        for b in boxes:
            sl = b.staff_lines
            up = [float(v) for v in (sl.get("treble") or [])]
            lo = [float(v) for v in (sl.get("bass") or [])]
            gap = staff_space(sl)
            bands = staff_bands(sl, (b.y0, b.y1))
            rec = {"page": p + 1, "measure": int(b.measure_number),
                   "n_treble_lines": len(up), "n_bass_lines": len(lo),
                   "staff_space": float(gap), "n_bands": len(bands),
                   "single_staff_flag": bool(sl.get("singleStaff")),
                   "splitY": sl.get("splitY"), "bands": []}
            flags = []
            if len(up) == 0 and len(lo) == 0:
                flags.append("band_fabricated_by_measure_fallback")
            if gap <= 0.0101 and len(up) + len(lo) < 2:
                flags.append("staff_space_default_used")
            # is the pooled gap actually a single-staff gap, or a cross-staff mix?
            if up and lo:
                ug = (max(up) - min(up)) / 4.0
                lg = (max(lo) - min(lo)) / 4.0
                rec["upper_gap"] = ug
                rec["lower_gap"] = lg
                if gap < min(ug, lg) * 0.75 or gap > max(ug, lg) * 1.33:
                    flags.append("staff_space_cross_staff_contaminated")
            for role, lines in (("upper", up), ("lower", lo)):
                if not lines:
                    continue
                ev = band_evidence(lines, gap, role, (b.y0, b.y1))
                if ev["line_count_below_gate"]:
                    flags.append("band_line_count_below_gate")
                if ev["analytic_delta"] is None:
                    flags.append("band_offset_absent")
                elif ev["analytic_offset_error"] is not None and ev["analytic_offset_error"] > 0.25:
                    flags.append("band_offset_off_analytic")
                rec["bands"].append(ev)
            rec["flags"] = sorted(set(flags))
            for f in rec["flags"]:
                rep["taxonomy"][f] += 1
            if not rec["flags"]:
                rep["taxonomy"]["ok"] += 1
            page["bands"].append(rec)
        rep["pages"].append(page)
    document.close()
    return rep


def main():
    out = {}
    for entry in SPLIT_DOC["scores"]:
        if entry.get("split") in {"heldout-test", "diagnostic"}:
            pass  # audit every split; reporting filters later
        try:
            score_pages(entry, out)
        except Exception as exc:
            out[entry["id"]] = {"error": f"{type(exc).__name__}: {exc}",
                                "split": entry["split"]}
            print(f"  {entry['id']}: {type(exc).__name__}: {exc}", flush=True)
        r = out.get(entry["id"], {})
        print(f"  {entry['id'][:34]:<34} {r.get('engraving','?')[:24]:<24} "
              f"measures={sum(p['n_measures'] for p in r.get('pages',[]))}", flush=True)
    for r in out.values():
        r["taxonomy"] = dict(r.get("taxonomy", {}))
    path = V26 / "tools/piano-vision-v26-audit/out/phase_d1_forensics.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=1, sort_keys=True, default=str))
    tot = Counter()
    for r in out.values():
        for k, v in r.get("taxonomy", {}).items():
            tot[k] += v
    print("\n=== taxonomy (band-measure units) ===")
    for k, v in tot.most_common():
        print(f"  {k:<46} {v}")
    print("\nwrote", path)


if __name__ == "__main__":
    main()
