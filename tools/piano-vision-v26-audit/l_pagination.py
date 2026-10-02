"""L - pagination audit: is per-page system correspondence even well posed?

Stage K compared PDF intervals against Verovio measures ON THE CORPUS PAGES and
landed at a total ratio of 0.9810, but the per-page ratios spread widely (p10
0.57, p90 1.50). This stage establishes why.

The PDF is page-truncated relative to the MusicXML, and Verovio's page breaks do
not fall where the PDF's do. So a PDF page and a Verovio page need not contain the
same number of systems, which makes "the i-th system on this page" an ill-posed
correspondence. Everything below is counts only - no pitch, no d0, no residual.
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
from l_note_correspondence import (load_pdf_systems,  # noqa: E402
                                  verovio_page_systems, index)


def main():
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}
    vcache = {}
    per_page = []
    for sc in index["scores"]:
        sid = sc["score_id"]
        pdfsys = load_pdf_systems(sid)
        if sid not in vcache:
            mp = H.V26_ROOT / sm[sid]["musicxml"]
            vcache[sid] = verovio_page_systems(mp) if mp.is_file() else {}
        vp = vcache[sid]
        by_page = defaultdict(int)
        notes = Counter()
        for (pno, sidx), sd in pdfsys.items():
            if sd["upper"] and sd["lower"]:
                by_page[pno] += 1
                for role in ("upper", "lower"):
                    notes[(pno, role)] += len(sd["notes"][role])
        for pno in sorted(set(by_page) | set(vp)):
            vs = vp.get(pno, [])
            vn = sum(len(v[role]["pts"]) for v in vs for role in ("upper", "lower"))
            per_page.append({
                "score": sid, "page": pno,
                "pdf_systems": by_page.get(pno, 0),
                "vx_systems": len(vs),
                "pdf_notes": notes[(pno, "upper")] + notes[(pno, "lower")],
                "vx_notes": vn})

    print("L  pagination audit - PDF vs Verovio page composition\n")
    hdr = ("score", "pg", "pdfSys", "vxSys", "dSys", "pdfN", "vxN", "Nratio")
    print("  " + "%-30s %3s %6s %5s %4s %6s %6s %7s" % hdr)
    for r in per_page:
        if r["pdf_systems"] or r["vx_systems"]:
            nr = (r["vx_notes"] / r["pdf_notes"]) if r["pdf_notes"] else float("nan")
            print("  %-30s %3d %6d %5d %4d %6d %6d %7.3f" % (
                r["score"][:30], r["page"], r["pdf_systems"], r["vx_systems"],
                r["vx_systems"] - r["pdf_systems"], r["pdf_notes"], r["vx_notes"], nr))
    eq = sum(1 for r in per_page if r["pdf_systems"] == r["vx_systems"] and r["pdf_systems"])
    nz = sum(1 for r in per_page if r["pdf_systems"] or r["vx_systems"])
    dsys = np.array([r["vx_systems"] - r["pdf_systems"] for r in per_page
                     if r["pdf_systems"] or r["vx_systems"]])
    pn = np.array([r["pdf_notes"] for r in per_page], float)
    vn = np.array([r["vx_notes"] for r in per_page], float)
    ok = (pn > 0) & (vn > 0)
    nr = vn[ok] / pn[ok]
    print("\n  pages compared                : %d" % nz)
    print("  pages with equal system count : %d  (%.4f)" % (eq, eq / max(1, nz)))
    print("  system-count delta  mean/min/max: %+.2f / %d / %d"
          % (dsys.mean(), dsys.min(), dsys.max()))
    print("  per-page note-count ratio median %.3f  p10 %.3f  p90 %.3f"
          % (np.median(nr), np.percentile(nr, 10), np.percentile(nr, 90)))
    print("  total PDF notes %d, Verovio notes %d, ratio %.4f"
          % (pn[ok].sum(), vn[ok].sum(), vn[ok].sum() / pn[ok].sum()))
    print("\n  NOTE-CORRESPONDENCE GATE: NOT EVALUATED")
    print("  Reason: PDF and Verovio break pages at different places, so per-page")
    print("  system pairing is not well posed. %d of %d pages disagree on system"
          % (nz - eq, nz))
    print("  count. A per-page order match would be an artefact, not a mapping,")
    print("  so no clean-control denominator can be formed honestly.")
    H.write_json("L_pagination.json", per_page)


if __name__ == "__main__":
    main()