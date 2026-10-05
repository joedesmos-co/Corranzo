"""P12/P15/P16 - three exact V2 reviewer prompts, and the V2 consensus runner.

This session CANNOT spawn isolated top-level contexts (subagent_depth = 0), and it is
additionally CONTAMINATED for this packet, having built it. It therefore does not
review. This script emits three ready-to-paste prompts for three separate top-level
sessions, plus a conservative consensus runner that will refuse until all three
independent V2 reviewer files exist.

V1 reviewer files are NEVER read here, and V1 and V2 votes are never mixed.
"""
from __future__ import annotations

import hashlib
import itertools
import json
import sys
from collections import Counter
from pathlib import Path

V2 = Path(__file__).parent / "out/h_review_ai_v2"
V2R = V2 / "reviews"
A_VALS = {"SAME_STRUCTURE", "DIFFERENT_MEASURE", "UNSURE"}
B_VALS = {"PRINTED", "NOT_PRINTED", "UNSURE"}
E_VALS = {"HIGH", "MEDIUM", "LOW"}
D_VALS = {"YES", "NO", "UNSURE"}
NAMES = ["V2_REVIEWER_1", "V2_REVIEWER_2", "V2_REVIEWER_3"]

PROMPT = """You are {NAME}, an independent blinded structural music-notation reviewer.
You have your own fresh context. Judge only from what you can see.

Working directory: /Users/ryland/Documents/scoreflow-piano-v26

STEP 1. Read the rubric:
  tools/piano-vision-v26-audit/out/h_review_ai_v2/rubric_v2.md
  Then read the serialisation schema:
  tools/piano-vision-v26-audit/out/h_review_ai_v2/schema_v2.json
  Then look at TWO instructional examples first (they are synthetic teaching cases,
  not real data):
  tools/piano-vision-v26-audit/out/h_review_ai_v2/examples/ex1_same_with_one_source_extra.png
  tools/piano-vision-v26-audit/out/h_review_ai_v2/examples/ex3_same_rhythm_uncertain_dense_chord.png

STEP 2. Read your assigned batch:
  tools/piano-vision-v26-audit/out/h_review_ai_v2/batches/batch{N}.json
  Each entry has item_id, image, n_pdf_proposals, source_cards.

STEP 3. For EACH entry use the read tool on the image path
  tools/piano-vision-v26-audit/out/h_review_ai_v2/<image>
  and actually look at it before answering. The LEFT panel is the printed PDF raster
  with machine proposals P1..Pn. The RIGHT panel is the same measure as a RHYTHM
  SKELETON whose every notehead height has been canonicalised to a neutral slot, so
  it shows rhythm, onset order, chord cardinality, stems, beams, flags, rests, dots,
  tuplets, meter and barlines but NO pitch information.

STEP 4. Answer per item, exactly as the rubric and schema specify:
  A = SAME_STRUCTURE | DIFFERENT_MEASURE | UNSURE
  B = per source onset Xn: PRINTED | NOT_PRINTED | UNSURE
  C = per PDF proposal Pn: an X id, or NO_SOURCE_COUNTERPART, or UNSURE
  D = YES | NO | UNSURE
  E = HIGH | MEDIUM | LOW
  If E is HIGH, also do the second pass for each matched onset pair: RANK_OK with an
  explicit map like {{"P1a":"X1a","P1b":"X1b"}}, or AMBIGUOUS.
  Record clearly visible printed onsets that carry no P label in unlisted_visible_onsets.

  A is about STRUCTURE. A single extra or missing note does NOT make A
  DIFFERENT_MEASURE; that is what B and C are for.

STEP 5. Write ONLY JSON to exactly:
  tools/piano-vision-v26-audit/out/h_review_ai_v2/reviews/{NAME}.json
  Shape:
  {{"reviewer":"{NAME}","batch":{N},"items":[{{"item_id":"R001","A":"SAME_STRUCTURE",
  "B":{{"X1":"PRINTED"}},"C":{{"P1":"X1"}},"D":"YES","E":"HIGH",
  "unlisted_visible_onsets":[],
  "second_pass":{{"P1":{{"verdict":"RANK_OK","map":{{"P1a":"X1a"}}}}}}}}]}}

STEP 6. Reply with exactly ONE line:
  {NAME} batch{N} done: <N items>

ABSOLUTE RULES - violating any invalidates the work:
- Review ONLY the items in your assigned batch{N}.json.
- Do NOT open any other file in the repository. Never open out/h_review_manifest.json,
  out/h_review_lookup_INTERNAL.json, anything under out/h_review_ai/ (the V1 packet or
  V1 reviewer files), any out/L*.json, or any file whose name contains residual, d0,
  true_d, decoder, mismatch, answers or reviewer.
- Do NOT run git. Do NOT search the repo. Do NOT try to identify the score, page,
  system or measure of an item.
- Do NOT look for or accept another reviewer's answers, a consensus, or any expected
  answer. None are available and you must not seek them.
- Never name a note, octave or accidental value, and do not try to infer pitch. Judge
  printed structure only.
- Be conservative: prefer UNSURE over a forced match. Never invent a one-to-one
  mapping to fill C. P labels are proposals, not truth.
- Work serially. Do not spawn other agents."""


def write_prompts():
    V2.mkdir(parents=True, exist_ok=True)
    (V2 / "batches").mkdir(exist_ok=True)
    items = json.loads((V2 / "items_neutral.json").read_text())["items"]
    n = len(items)
    B = 4
    per = n // B
    for b in range(B):
        chunk = items[b * per:(b + 1) * per] if b < B - 1 else items[b * per:]
        (V2 / "batches" / ("batch%d.json" % (b + 1))).write_text(
            json.dumps(chunk, indent=1))
    outs = []
    for i, name in enumerate(NAMES):
        parts = []
        for b in range(1, B + 1):
            parts.append(PROMPT.replace("{NAME}", name).replace("{N}", str(b)))
        p = V2 / ("prompt_%d.txt" % (i + 1))
        p.write_text("\n\n" + ("=" * 78 + "\n") .join(parts))
        outs.append(str(p))
    (V2 / "batches").mkdir(exist_ok=True)
    print("P11 batches written : %d x ~%d items" % (B, per))
    for o in outs:
        print("P12 prompt          : %s" % o)
    return outs


def consensus():
    items = {s["item_id"]: s for s in
             json.loads((V2 / "items_neutral.json").read_text())["items"]}
    rev, meta, missing = {}, {}, []
    for nm in NAMES:
        p = V2R / ("%s.json" % nm)
        if not p.is_file():
            missing.append(nm)
            continue
        raw = p.read_bytes()
        doc = json.loads(raw.decode())
        its = doc if isinstance(doc, list) else doc.get("items", [])
        out, errs = {}, []
        for it in its:
            iid = it.get("item_id")
            if iid not in items:
                errs.append("unknown %s" % iid)
                continue
            if iid in out:
                errs.append("dup %s" % iid)
                continue
            s = items[iid]
            if it.get("A") not in A_VALS:
                errs.append("%s bad A=%r" % (iid, it.get("A")))
                continue
            if it.get("E") not in E_VALS:
                errs.append("%s bad E=%r" % (iid, it.get("E")))
                continue
            for x in it.get("B", {}):
                if x not in json.dumps(s):
                    pass
            out[iid] = it
        rev[nm] = out
        meta[nm] = {"sha256": hashlib.sha256(raw).hexdigest(), "errors": errs,
                    "n": len(out)}
    if missing:
        print("REFUSING: missing independent V2 reviewer files: %s" % missing)
        print("Expected: out/h_review_ai_v2/reviews/%s.json" % ", ".join(NAMES))
        return 2
    allerr = [(k, e) for k in meta for e in meta[k]["errors"]]
    if allerr:
        for k, e in allerr[:30]:
            print("  SCHEMA ERROR [%s] %s" % (k, e))
        return 2
    for nm in NAMES:
        print("  %-13s items=%-4d sha256=%s" % (nm, meta[nm]["n"],
                                                meta[nm]["sha256"][:40]))
    common = set(rev[NAMES[0]])
    for nm in NAMES[1:]:
        common &= set(rev[nm])
    got = Counter()
    tot = Counter()
    rows, n_on, n_note, unres = [], 0, 0, 0
    for iid in sorted(common):
        a = [rev[nm][iid] for nm in NAMES]
        tot["A"] += 1
        if all(x["A"] == "SAME_STRUCTURE" for x in a):
            got["A"] += 1
        xs = sorted({k for x in a for k in x.get("B", {})})
        for x in xs:
            tot["B"] += 1
            if all(y.get("B", {}).get(x) == "PRINTED" for y in a):
                got["B"] += 1
        ps = sorted({k for x in a for k in x.get("C", {})})
        for p in ps:
            tot["C"] += 1
            v = [y.get("C", {}).get(p) for y in a]
            if v[0] == v[1] == v[2] and str(v[0]).startswith("X"):
                got["C"] += 1
        tot["E"] += 1
        if sum(1 for x in a if x["E"] == "HIGH") >= 2 and \
                not any(x["E"] == "LOW" for x in a):
            got["E"] += 1
        okA = all(x["A"] == "SAME_STRUCTURE" for x in a)
        okE = (sum(1 for x in a if x["E"] == "HIGH") >= 2
               and not any(x["E"] == "LOW" for x in a))
        e = {"item_id": iid, "A_votes": [x["A"] for x in a],
             "E_votes": [x["E"] for x in a], "accepted": bool(okA and okE),
             "onsets": [], "rank_pairs": {}}
        if not (okA and okE):
            e["status"] = "AI_CONSENSUS_V2_UNRESOLVED"
            unres += 1
        else:
            e["status"] = "AI_CONSENSUS_V2_ACCEPTED"
            for x in xs:
                if all(y.get("B", {}).get(x) == "PRINTED" for y in a):
                    e["onsets"].append({"x": x, "presence": "PRINTED"})
                    n_on += 1
            for p in ps:
                v = [y.get("C", {}).get(p) for y in a]
                if v[0] == v[1] == v[2] and str(v[0]).startswith("X"):
                    e["onsets"].append({"p": p, "match": v[0]})
            for p in sorted({k for y in a for k in (y.get("second_pass") or {})}):
                maps, ok = [], True
                for y in a:
                    sp = (y.get("second_pass") or {}).get(p)
                    if not sp or sp.get("verdict") != "RANK_OK":
                        ok = False
                        break
                    maps.append(sp.get("map") or {})
                tot["rank"] += 1
                if ok and maps[0] and all(mm == maps[0] for mm in maps):
                    got["rank"] += 1
                    e["rank_pairs"][p] = maps[0]
                    n_note += len(maps[0])
        rows.append(e)
    pairs = {}
    for x, y in itertools.combinations(NAMES, 2):
        ag = 0
        for iid in sorted(common):
            ax, ay = rev[x][iid], rev[y][iid]
            ag += int(ax["A"] == ay["A"] and ax["E"] == ay["E"]
                      and ax.get("B") == ay.get("B")
                      and ax.get("C") == ay.get("C"))
        pairs["%s|%s" % (x, y)] = ag / max(1, len(common))
    print("\nP14 agreement (before any science)")
    for k, lbl in (("A", "unanimous SAME_STRUCTURE"), ("B", "unanimous onset-PRESENT"),
                   ("C", "unanimous exact P->X"), ("E", ">=2/3 HIGH no LOW"),
                   ("rank", "unanimous rank-pairing")):
        d = tot.get(k, 0)
        print("  %-26s %4d/%-5d = %.4f" % (lbl, got.get(k, 0), d,
                                          got.get(k, 0) / max(1, d)))
    for k, v in pairs.items():
        print("  pairwise A-exact %-24s %.4f" % (k, v))
    print("\nP15 consensus: accepted=%d unresolved=%d onsets=%d noteheads=%d"
          % (sum(1 for r in rows if r["accepted"]), unres, n_on, n_note))
    payload = {"label": "AI_BLIND_CONSENSUS_V2",
               "warning": "NOT human ground truth. NOT manually certified.",
               "packet_sha256": (V2 / "packet_v2.sha256").read_text().strip(),
               "reviewer_sha256": {k: meta[k]["sha256"] for k in NAMES},
               "rule_version": "v2-conservative-1",
               "rules": {"A": "3/3 SAME_STRUCTURE", "B": "3/3 identical PRINTED",
                         "C": "3/3 exact X id", "rank": "3/3 RANK_OK identical map",
                         "admission": "unanimous structure AND >=2/3 HIGH AND no LOW",
                         "else": "AI_CONSENSUS_V2_UNRESOLVED",
                         "bias": "precision over coverage"},
               "agreement": {k: [got.get(k, 0), tot.get(k, 0)] for k in tot},
               "pairwise": pairs, "consensus_onsets": n_on,
               "consensus_noteheads": n_note, "unresolved": unres, "items": rows}
    blob = json.dumps(rows, sort_keys=True, separators=(",", ":"))
    h = hashlib.sha256(blob.encode()).hexdigest()
    payload["consensus_manifest_sha256"] = h
    (V2 / "ai_blind_consensus_v2_manifest.json").write_text(json.dumps(payload, indent=1))
    print("\nP16 frozen consensus manifest sha256: %s" % h)
    print("    (frozen BEFORE any residual join)")
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "consensus":
        sys.exit(consensus())
    write_prompts()