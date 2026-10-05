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

# The prompt text now lives in h2_prompts.py, which generates ONE unified flow per
# reviewer (four batches, per-batch temporary artifacts, a single final write) and runs
# the preflight validation. This module keeps only the consensus runner, so the old
# four-block generator that could overwrite batch answers cannot be resurrected.
def write_prompts():
    import h2_prompts
    return h2_prompts.write_prompts()


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