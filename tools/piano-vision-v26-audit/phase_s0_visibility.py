"""Phase S0 - are printed accidental glyphs actually VISIBLE in the render?

The previous report inferred "0 printed <accidental> elements in the MusicXML"
therefore "no accidental glyph in the pixels". That inference is NOT established.
A notation renderer draws a key-signature accidental as a glyph without emitting
an <accidental> element, so the MusicXML fact says nothing about the raster.

This builds a deterministic visual audit: for notes of each `alter` class, crop
the region immediately left of the notehead (where a printed accidental is
rendered) and lay them out in contact sheets for direct inspection. Nothing is
relabelled; the only output is images and the class counts.
"""
from __future__ import annotations

import gzip
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import v26_staff as S  # noqa: E402

OUT = H.V26_ROOT / "out/s0_accidental_visibility"
OUT.mkdir(parents=True, exist_ok=True)
LETTERS = "CDEFGAB"

# deterministic sample: this many notes per (score, alter class)
PER_SCORE_PER_CLASS = 6
# crop: the accidental sits immediately left of the notehead
CROP_W_SPACES = 3.2
CROP_H_SPACES = 3.2
LEFT_BIAS_SPACES = 1.1        # shift the window left of the notehead centre


def load_records(sid):
    idx = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    entry = next((s for s in idx["scores"] if s["score_id"] == sid), None)
    if entry is None or not entry.get("shards"):
        return None, None
    out = []
    for sh in entry["shards"]:
        p = H.REALPDF_ROOT / "shards" / sh
        if not p.is_file():
            continue
        with gzip.open(p, "rt") as f:
            for line in f:
                out.append(json.loads(line))
    return out, entry


def main():
    idx = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    by_alter = defaultdict(list)
    picked = []
    for sc in idx["scores"]:
        sid = sc["score_id"]
        recs, entry = load_records(sid)
        if not recs:
            continue
        for rec in recs[:14]:
            m = rec["input"]["modelInput"]
            bands = m.get("geometry", {}).get("staffBands", {}).get("staffBands", [])
            if not bands:
                continue
            objs = m.get("physicalObjects", [])
            feats = S.features_for_record(rec, len(objs))
            if feats is None:
                continue
            labs = {}
            for lab in rec["target"]["families"].get("PITCH_STAFF", []):
                if lab.get("state") != "KNOWN" or not lab.get("isPositive"):
                    continue
                for ix in (lab.get("objectIndexes") or []):
                    labs[ix] = lab
            for i, obj in enumerate(objs):
                if obj.get("kind") != "notehead" or i not in labs or i >= len(feats):
                    continue
                wp = labs[i]["value"].get("writtenPitch") or {}
                if "step" not in wp:
                    continue
                # MusicXML omits <alter> for natural; absence means 0
                alter = int(float(wp["alter"])) if wp.get("alter") is not None else 0
                if len(by_alter[(sid, alter)]) < PER_SCORE_PER_CLASS:
                    by_alter[(sid, alter)].append(
                        (rec, i, obj, alter, str(wp["step"]), int(wp["octave"])))
                    picked.append((sid, alter, rec, i, obj))
    print("sampled notes by alter class:",
          dict(Counter(a for (_, a) in by_alter)), flush=True)

    # ---- build contact sheets, one per alter class ----
    pages = {}
    for alter in sorted({a for (_, a) in by_alter}):
        items = [(k, v) for k, v in by_alter.items() if k[1] == alter]
        items.sort()
        tiles = []
        for (sid, _), rows in items:
            for (rec, i, obj, alt, step, octv) in rows:
                m = rec["input"]["modelInput"]
                bands = m["geometry"]["staffBands"]["staffBands"]
                cy_obj = float(obj["center"]["y"])
                band = min(bands, key=lambda b: abs(
                    cy_obj - (float(b["y0"]) + float(b["y1"])) / 2))
                if band is None:
                    continue
                gap = (float(band["y1"]) - float(band["y0"])) / 4.0
                if gap <= 0:
                    continue
                # exampleId looks like "score:p1-s0-x0"; the page token is "p1"
                mtok = re.match(r"p(\d+)", rec["exampleId"].split(":")[-1])
                if not mtok:
                    continue
                pp = H.REALPDF_ROOT / "pages" / sid / f"page-{int(mtok.group(1))}.png"
                if not pp.is_file():
                    continue
                if pp not in pages:
                    pages[pp] = Image.open(pp).convert("L")
                page = pages[pp]
                pw, ph = page.size
                cx = float(obj["center"]["x"]); cy = float(obj["center"]["y"])
                x0 = int((cx - (CROP_W_SPACES / 2 - LEFT_BIAS_SPACES) * gap) * pw)
                x1 = int((cx + (CROP_W_SPACES / 2 + LEFT_BIAS_SPACES) * gap) * pw)
                y0 = int((cy - CROP_H_SPACES / 2 * gap) * ph)
                y1 = int((cy + CROP_H_SPACES / 2 * gap) * ph)
                if x1 - x0 < 4 or y1 - y0 < 4:
                    continue
                crop = page.crop((max(0, x0), max(0, y0), min(pw, x1), min(ph, y1)))
                sc = 150.0 / max(1e-9, gap * ph)      # ~150 px per staff space
                big = crop.resize((max(1, int(crop.width * sc)),
                                   max(1, int(crop.height * sc))),
                                  Image.Resampling.LANCZOS)
                tiles.append((big, f"{step}{octv} alter={alt:+d} {sid[:18]}"))
        if not tiles:
            continue
        cols = 6
        rows_n = (len(tiles) + cols - 1) // cols
        tw = max(t[0].width for t in tiles) + 8
        th = max(t[0].height for t in tiles) + 22
        sheet = Image.new("L", (cols * tw, rows_n * th), 255)
        dr = ImageDraw.Draw(sheet)
        for n, (im, cap) in enumerate(tiles):
            cx0 = (n % cols) * tw + 4
            cy0 = (n // cols) * th + 18
            sheet.paste(im, (cx0, cy0))
            dr.text((cx0, 4 + (n // cols) * th), cap[:46], fill=0)
        name = f"s0_alter{alter:+d}.png".replace("+", "p").replace("-", "m")
        sheet.save(OUT / name)
        print(f"  wrote {name}  ({len(tiles)} notes)", flush=True)
    print("\noutput:", OUT)


if __name__ == "__main__":
    main()
