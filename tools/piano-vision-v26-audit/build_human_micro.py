#!/usr/bin/env python3
"""Build the minimal human source-assisted micro-review (H0-H12).

Population: exactly the V3 items with 3/3 SAME_STRUCTURE. No further filtering.
Selection used only the frozen packet and three blind reviewers. No residual, pitch,
decoder or reviewer-confidence field is read, embedded or displayed.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).parent
V3 = ROOT / "out/h_review_ai_v3"
OUT = ROOT / "out/h_review_human_micro"

# ---------------------------------------------------------------- H0 population
man = json.loads((ROOT / "out/h_review_manifest.json").read_text())
items = {i["item_id"]: i for i in man["items"]}
# The rendered V3 sheets were built from items_neutral.json, so the X list MUST come
# from there. The V1 manifest source_onsets is truncated to correspondence candidates
# (R004: 8 vs the 12 actually rendered) and would mislabel the human's markers.
neutral = {i["item_id"]: i for i in json.loads((V3 / "items_neutral.json").read_text())["items"]}
consensus = json.loads((V3 / "ai_blind_consensus_v3_manifest.json").read_text())

same = sorted(
    it["item_id"]
    for it in consensus["items"]
    if it["A_votes"] == ["SAME_STRUCTURE"] * 3
)
pop_hash = hashlib.sha256("".join(same).encode()).hexdigest()

# Exact marker geometry -------------------------------------------------
# X positions come from the renderer's own layout function, so they are the
# coordinates the sheet was actually drawn with. P positions are read back off
# the red overlay lines already printed on the PDF panel. Evenly spaced
# markers would drift away from the notation and mislead click-pairing.
sys.path.insert(0, str(ROOT))
import harness as H  # noqa: E402
from h3_skeleton import onset_x, xml_rhythm_v3  # noqa: E402

DISP, GAP = 780.0, 17.0
_X0 = 1.6 * GAP + 0.8 * GAP
_X1 = (DISP - 1.1 * GAP) - 0.8 * GAP
_NHW = 0.60 * GAP
_sm = {x["id"]: x for x in json.loads(
    (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}
_man = {i["item_id"]: i for i in man["items"]}
_cache = {}


def x_fractions(iid):
    it = _man[iid]
    sid = it["score"]
    if sid not in _cache:
        mp = H.V26_ROOT / _sm[sid]["musicxml"]
        _cache[sid] = xml_rhythm_v3(mp) if mp.is_file() else []
    rs = _cache[sid]
    pix = 0 if (it["staff"] == "upper" or len(rs) < 2) else 1
    if it["xml_ord"] >= len(rs[pix]):
        return None
    xs = onset_x(rs[pix][it["xml_ord"]]["onsets"], _X0, _X1)
    return [round((x + _NHW / 2.0) / DISP, 5) for x in xs]


def p_fractions(rel_path, n_expected):
    """Read the red P overlay lines straight off the printed PDF panel."""
    a = np.asarray(Image.open(ROOT / "out" / rel_path).convert("RGB")).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    red = (r > 120) & (r - g > 50) & (r - b > 50)
    cols = np.where(red.sum(0) > 20)[0]
    if len(cols) == 0:
        return None
    groups, cur = [], [int(cols[0])]
    for v in cols[1:]:
        v = int(v)
        if v - cur[-1] <= 3:
            cur.append(v)
        else:
            groups.append(cur)
            cur = [v]
    groups.append(cur)
    if len(groups) != n_expected:
        return None
    w = a.shape[1]
    return [round(float(np.mean(gg)) / w, 5) for gg in groups]


population = []
ceiling = 0
for iid in same:
    src = items[iid]
    px = p_fractions(src["sheet"], len(src["pdf_onsets"]))
    assert px is not None and all(0.0 < f < 1.0 for f in px), iid
    fx = x_fractions(iid)
    cards = neutral[iid]["source_cards"]
    assert len(fx) == len(cards), iid
    assert all(0.0 < f < 1.0 for f in fx), iid
    assert all(a < b for a, b in zip(fx, fx[1:])), iid
    population.append(
        {
            "item_id": iid,
            "pdf_image": "../" + src["sheet"],
            "src_image": "sheets/%s.png" % iid,
            "pdf_onsets": [{"pid": o["pid"], "card": o["card"], "fx": px[n]}
                           for n, o in enumerate(src["pdf_onsets"])],
            "p_fractions": px,
            "src_onsets": [
                {"sid": "X%d" % (n + 1), "card": c, "fx": fx[n]}
                for n, c in enumerate(neutral[iid]["source_cards"])
            ],
            "x_fractions": fx,
        }
    )
    ceiling += sum(cards)

(OUT).mkdir(parents=True, exist_ok=True)
(OUT / "sheets").mkdir(exist_ok=True)
for iid in same:
    shutil.copyfile(V3 / "sheets" / ("%s.png" % iid), OUT / "sheets" / ("%s.png" % iid))

meta = {
    "label": "HUMAN_MICRO_REVIEW_POPULATION",
    "population": same,
    "population_n": len(same),
    "population_sha256": pop_hash,
    "max_potential_noteheads": ceiling,
    "n50_reachable": ceiling >= 50,
    "selection_basis": "3/3 unanimous SAME_STRUCTURE on the frozen V3 packet only",
    "excluded_fields": [
        "residual", "delta_space", "r_corpus", "r_render", "d0", "true_d",
        "written_pitch", "midi", "decoder", "mismatch", "category",
        "reviewer_confidence", "reviewer_answers",
    ],
}
(OUT / "population.json").write_text(json.dumps(meta, indent=1) + "\n")
(OUT / "population.sha256").write_text(pop_hash + "\n")
(OUT / "items_blinded.json").write_text(json.dumps({"items": population}, indent=1) + "\n")
print("population n=%d ceiling=%d sha=%s" % (len(same), ceiling, pop_hash))


# ------------------------------------------------------------------ H2 review UI
tpl = (ROOT / "h_micro_template.html").read_text()
_pf = json.loads((OUT / "population.json").read_text())
# Only the fields the tool actually needs reach the human-facing HTML. The audit
# copy of excluded_fields stays in population.json on disk; naming forbidden fields
# inside the HTML would itself be the leak we guard against.
pop = json.dumps({
    "population": _pf["population"],
    "population_n": _pf["population_n"],
    "population_sha256": _pf["population_sha256"],
    "max_potential_noteheads": _pf["max_potential_noteheads"],
    "n50_reachable": _pf["n50_reachable"],
    "selection_basis": "preselected by unanimous structural agreement on the frozen packet",
})
html = (tpl
        .replace("__DATA__", (OUT / "items_blinded.json").read_text().replace("</script>", "<\\/script>"))
        .replace("__POP__", pop))
(OUT / "review.html").write_text(html)
print("review.html written %d bytes" % len(html))
