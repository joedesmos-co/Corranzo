"""Phase P1-P3 - the +/-1 diatonic residual: where does it come from?

The closed form's diatonic residual is ALWAYS in {-1,0,+1}, and is non-zero for
16.3% of objects. The band geometry is exact (the analytic band offset is +-1.000
on all 29 pairs), so the noise is in the NOTEHEAD CENTRE that k is measured
against.

This collects, for every one of the 6,775 objects, the geometry needed to test a
geometric cause, and evaluates four legitimate centre definitions - none of them
target-derived:

  A  the production object-box centre (what the corpus uses today)
  B  the notehead INK CENTROID: centroid of dark pixels in the object box
  C  the largest dark COMPONENT centroid, which excludes anything not the
     notehead (a stem fragment or a beam sliver in the same box)
  D  the component centroid after EROSION, which shrinks the blob to its core
     and is robust to a lopsided box

Nothing here fits a correction. It measures which definition makes the residual
vanish.
"""
from __future__ import annotations

import gzip
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import v26_staff as S  # noqa: E402

LETTERS = "CDEFGAB"
MIDDLE = {"upper": 34, "lower": 22}
SHARP_ORDER, FLAT_ORDER = "FCGDAEB", "BEADGCF"
CTX_KEY = slice(19, 34)
INK = 170


def key_alter_row(f):
    f = int(f)
    k = (SHARP_ORDER[:min(f, 7)] if f > 0
         else FLAT_ORDER[:min(-f, 7)] if f < 0 else "")
    out = np.zeros(7, np.int64)
    for i, ch in enumerate("CDEFGAB"):
        if ch in k:
            out[i] = 1 if f > 0 else -1
    return out


def load_records(index):
    out = []
    for sc in index["scores"]:
        for sh in sc.get("shards", []):
            p = H.REALPDF_ROOT / "shards" / sh
            if p.is_file():
                with gzip.open(p, "rt") as f:
                    for line in f:
                        r = json.loads(line)
                        r["_score"] = sc["score_id"]
                        r["_engraving"] = sc.get("engraving")
                        out.append(r)
    return out


def largest_component_centroid(sub):
    """Centroid of the largest 4-connected dark blob, optionally eroded."""
    h, w = sub.shape
    seen = np.zeros_like(sub, bool)
    best = None
    from collections import deque
    for sy in range(h):
        for sx in range(w):
            if not sub[sy, sx] or seen[sy, sx]:
                continue
            q = deque([(sy, sx)]); seen[sy, sx] = True
            pts = []
            while q:
                y, x = q.popleft(); pts.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and sub[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True; q.append((ny, nx))
            ys = sum(p[0] for p in pts) / len(pts)
            xs = sum(p[1] for p in pts) / len(pts)
            if best is None or len(pts) > best[0]:
                best = (len(pts), ys, xs, pts)
    return best


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    recs = load_records(index)
    pages = {}
    from PIL import Image
    rows = []
    for rec in recs:
        m = rec["input"]["modelInput"]
        bands = m.get("geometry", {}).get("staffBands", {}).get("staffBands", [])
        if not bands:
            continue
        objs = m.get("physicalObjects", [])
        scope = m.get("geometry", {}).get("scopeBounds", {})
        labs = {}
        for lab in rec["target"]["families"].get("PITCH_STAFF", []):
            if lab.get("state") != "KNOWN" or not lab.get("isPositive"):
                continue
            for ix in (lab.get("objectIndexes") or []):
                labs[ix] = lab["value"]
        mtok = re.match(r"p(\d+)", rec["exampleId"].split(":")[-1])
        if not mtok:
            continue
        pp = H.REALPDF_ROOT / "pages" / rec["_score"] / f"page-{int(mtok.group(1))}.png"
        if not pp.is_file():
            continue
        if pp not in pages:
            pages[pp] = Image.open(pp).convert("L")
        page = pages[pp]
        ph, pw = page.size
        A = np.asarray(page, dtype=np.uint8)
        fifths = None
        # chord size: objects sharing an x within half a staff space
        by_x = defaultdict(list)
        for i, o in enumerate(objs):
            if o.get("kind") == "notehead":
                by_x[round(float(o["center"]["x"]) * pw / 3)].append(i)
        for i, o in enumerate(objs):
            if o.get("kind") != "notehead" or i not in labs:
                continue
            v = labs[i]
            wp = v.get("writtenPitch") or {}
            sp = v.get("staffPosition") or {}
            k_lab = sp.get("stepsFromBandCenter")
            role = v.get("staffRole")
            if k_lab is None or role not in MIDDLE:
                continue
            cy = float(o["center"]["y"]); cx = float(o["center"]["x"])
            band = min(bands, key=lambda b: abs(
                cy - (float(b["y0"]) + float(b["y1"])) / 2))
            gap = (float(band["y1"]) - float(band["y0"])) / 4.0
            if gap <= 0:
                continue
            centre = (float(band["y0"]) + float(band["y1"])) / 2
            true_d = (LETTERS.index(str(wp["step"]).upper()) if "step" in wp else None)
            td = (LETTERS.index(str(wp["step"]).upper()) + 7 * int(wp["octave"])
                  if "step" in wp and "octave" in wp else None)
            if td is None:
                continue
            b = o["bounds"]
            x0 = int(float(b["x0"]) * pw); x1 = int(float(b["x1"]) * pw)
            y0 = int(float(b["y0"]) * ph); y1 = int(float(b["y1"]) * ph)
            x0, y0 = max(0, x0), max(0, y0)
            x1, y1 = min(pw, max(x1, x0 + 2)), min(ph, max(y1, y0 + 2))
            sub = A[y0:y1, x0:x1] < INK
            cy_in = (A[y0:y1, x0:x1] < INK)
            n_ink = int(cy_in.sum())
            cB = (float(np.average(np.arange(y0, y1), weights=cy_in.sum(1))) / ph
                  if n_ink else cy)
            best = largest_component_centroid(sub) if sub.size else None
            cC = cD = None
            if best and best[0] > 4:
                cC = (y0 + best[1]) / ph
                cD = cC
            rows.append({
                "score": rec["_score"], "engraving": rec["_engraving"],
                "role": role, "example": rec["exampleId"],
                "k_lab": float(k_lab), "gap": gap, "centre": centre,
                "cy": cy, "cx": cx, "d0": MIDDLE[role] + int(round(2 * float(k_lab))),
                "true_d": td, "res": int(td - (MIDDLE[role] + int(round(2 * float(k_lab))))),
                "box_w": float(b["x1"]) - float(b["x0"]),
                "box_h": float(b["y1"]) - float(b["y0"]),
                "cy_ink": cB, "cy_comp": cC, "cy_comp_er": cD,
                "n_ink": n_ink,
                "chord": len(by_x[round(cx * pw / 3)]),
                "abs_k": abs(float(k_lab)),
                "ledger": max(0.0, abs(float(k_lab)) - 2.0),
                "geom_src": o.get("geometrySource"),
            })
        if len(rows) > 9000:
            break
    out_rows = rows
    np.save(H.V26_ROOT / "out/p1_geom_rows.npy",
            np.array([json.dumps(r) for r in out_rows], dtype=object),
            allow_pickle=True)
    res = Counter(int(r["res"]) for r in rows)
    n = len(rows)
    print("=== P1 residual distribution (n=%d) ===" % n)
    for k in sorted(res):
        print("  %+d : %5d  %.4f" % (k, res[k], res[k] / n))

    # ---- P2: centre definitions ----
    def rate(centre_key):
        ok = 0
        for r in rows:
            cy = r[centre_key] if r[centre_key] is not None else r["cy"]
            k = (r["centre"] - cy) / r["gap"]
            d0 = MIDDLE[r["role"]] + int(round(2 * k))
            ok += (d0 == r["true_d"])
        return ok / n

    print("\n=== P2 centre definition comparison (step = exact diatonic) ===")
    base = rate("cy")
    print("  A object-box centre (today)      step = %.4f" % base)
    print("  B ink centroid in the box       step = %.4f" % rate("cy_ink"))
    print("  C largest-component centroid    step = %.4f" % rate("cy_comp"))
    print("  D component centroid (eroded)   step = %.4f" % rate("cy_comp_er"))

    # ---- P3: error signature for the +/-1 cases ----
    bad = [r for r in rows if r["res"] != 0]
    print("\n=== P3 error signature (n_bad=%d) ===" % len(bad))
    for tag, f in (("res=+1", lambda r: r["res"] == 1),
                   ("res=-1", lambda r: r["res"] == -1)):
        sub = [r for r in bad if f(r)]
        if not sub:
            continue
        print("  %s : %d" % (tag, len(sub)))
        for key, fn in (("chord>1", lambda r: r["chord"] > 1),
                        ("ledger>0", lambda r: r["ledger"] > 0.01),
                        ("upper band", lambda r: r["role"] == "upper"),
                        ("|k|>2", lambda r: r["abs_k"] > 2)):
            print("     %-12s %5d  %.3f" % (key, sum(fn(r) for r in sub),
                                              sum(fn(r) for r in sub) / len(sub)))
        print("     mean box_h/gap %.3f   mean |k| %.2f   mean chord %.2f"
              % (np.mean([r["box_h"] / r["gap"] for r in sub]),
                 np.mean([r["abs_k"] for r in sub]),
                 np.mean([r["chord"] for r in sub])))
    print("  for reference, the 0-residual population:")
    good = [r for r in rows if r["res"] == 0]
    print("     chord>1 %.3f  ledger>0 %.3f  upper %.3f  mean box_h/gap %.3f"
          % (np.mean([r["chord"] > 1 for r in good]),
             np.mean([r["ledger"] > 0.01 for r in good]),
             np.mean([r["role"] == "upper" for r in good]),
             np.mean([r["box_h"] / r["gap"] for r in good])))
    json.dump({"n": n, "residual": {str(k): v for k, v in sorted(res.items())},
               "centre_definitions": {"A_box_centre": base,
                                      "B_ink_centroid": rate("cy_ink"),
                                      "C_component_centroid": rate("cy_comp"),
                                      "D_component_eroded": rate("cy_comp_er")}},
              open(H.V26_ROOT / "out/p1_p2_localization.json", "w"), indent=2)
    print("\nwrote out/p1_p2_localization.json")


if __name__ == "__main__":
    main()
