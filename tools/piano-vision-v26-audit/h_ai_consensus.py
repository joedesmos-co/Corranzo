"""A5-A9 - AI_BLIND_CONSENSUS: validate reviewer files, compute agreement, freeze.

THIS IS NOT HUMAN GROUND TRUTH. Every artifact produced here is labelled
AI_BLIND_CONSENSUS. It is a conservative internal R&D correspondence set, nothing
more.

The script REFUSES to run unless three independent reviewer files are present, and it
performs NO residual, pitch or decoder join of any kind. Freezing the consensus
manifest happens here, BEFORE any scientific field is revealed. The join is a
separate, later step (A10) that must read the frozen hash.

Consensus rules (A6), precision over coverage:
  measure identity  : SAME only if all 3 say SAME
  source onset      : PRINTED only if all 3 say PRINTED
  P->X mapping      : only if all 3 name the exact same X id
  cardinality       : only if all 3 agree
  rank pairing      : only if all 3 say RANK_OK with the identical rank map
  enters science    : unanimous structural decisions AND >=2/3 HIGH AND no LOW
  anything else     : AI_CONSENSUS_UNRESOLVED
"""
from __future__ import annotations

import hashlib
import itertools
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

BASE = Path(__file__).parent / "out/h_review_ai"
REVIEWERS = ["reviewer_1", "reviewer_2", "reviewer_3"]
A_VALS = {"SAME", "NO", "UNSURE"}
B_VALS = {"PRINTED", "NOT_PRINTED", "UNSURE"}
E_VALS = {"HIGH", "MEDIUM", "LOW"}
D_VALS = {"YES", "NO", "UNSURE"}
REQUIRED_TOP = {"reviewer", "batch", "items"}
REQUIRED_ITEM = {"item_id", "A", "B", "C", "D", "E"}


def die(msg):
    print("REFUSING TO PROCEED: %s" % msg)
    sys.exit(2)


def load_spec():
    spec = json.loads((BASE / "items_neutral.json").read_text())
    return {s["item_id"]: s for s in spec}


def load_reviewer(name, spec):
    # reviewers 2 and 3 wrote a bare JSON list; reviewer 1 wrote an object with
    # metadata. Normalise both containers rather than rejecting the campaign over a
    # shape difference, but REPORT it.
    p = BASE / ("%s.json" % name)
    if not p.is_file():
        return None, None
    raw = p.read_bytes()
    doc = json.loads(raw.decode())
    errs = []
    container = "object"
    if isinstance(doc, list):
        container = "bare_list"
        items = doc
    else:
        if not REQUIRED_TOP <= set(doc):
            errs.append("missing top-level keys %s" % (REQUIRED_TOP - set(doc)))
        items = doc.get("items", [])
    seen = set()
    out = {}
    for it in items:
        iid = it.get("item_id")
        if not iid:
            errs.append("item without item_id")
            continue
        if iid not in spec:
            errs.append("unknown item_id %s" % iid)
            continue
        if iid in seen:
            errs.append("duplicate item_id %s" % iid)
            continue
        seen.add(iid)
        miss = REQUIRED_ITEM - set(it)
        if miss:
            errs.append("%s missing %s" % (iid, miss))
            continue
        s = spec[iid]
        if it["A"] not in A_VALS:
            errs.append("%s bad A=%r" % (iid, it["A"]))
        if it["E"] not in E_VALS:
            errs.append("%s bad E=%r" % (iid, it["E"]))
        if it["D"] not in D_VALS:
            errs.append("%s bad D=%r" % (iid, it["D"]))
        for x in it["B"]:
            if x not in s["X_ids"]:
                errs.append("%s B references unknown %s" % (iid, x))
            elif it["B"][x] not in B_VALS:
                errs.append("%s bad B[%s]=%r" % (iid, x, it["B"][x]))
        for p_ in it["C"]:
            if p_ not in s["P_ids"]:
                errs.append("%s C references unknown %s" % (iid, p_))
            else:
                v = it["C"][p_]
                if v != "NO_SOURCE_COUNTERPART" and v != "UNSURE" \
                        and v not in s["X_ids"]:
                    errs.append("%s C[%s] points at unknown %r" % (iid, p_, v))
        sp = it.get("second_pass") or {}
        if sp and it["E"] != "HIGH":
            errs.append("%s has second_pass but E=%s" % (iid, it["E"]))
        for p_, v in sp.items():
            if v.get("verdict") not in ("RANK_OK", "AMBIGUOUS"):
                errs.append("%s second_pass[%s] bad verdict" % (iid, p_))
            if v.get("verdict") == "RANK_OK":
                mp = v.get("map") or {}
                if not mp:
                    errs.append("%s second_pass[%s] RANK_OK without map" % (iid, p_))
                for k in mp:
                    if not (k.startswith(p_) and len(k) == len(p_) + 1):
                        errs.append("%s rank key %s malformed" % (iid, k))
                    if not (isinstance(mp[k], str) and mp[k].startswith("X")):
                        errs.append("%s rank value %r malformed" % (iid, mp[k]))
        out[iid] = it
    return out, {"sha256": hashlib.sha256(raw).hexdigest(), "errors": errs,
                 "n_items": len(out), "container": container}


def agreement(a, b, iid, field):
    x, y = a[iid][field], b[iid][field]
    return x == y


def main():
    spec = load_spec()
    print("A5-A9  AI_BLIND_CONSENSUS  (NOT human ground truth)\n")
    print("  packet items in neutral spec: %d" % len(spec))
    rev, meta = {}, {}
    missing = []
    for r in REVIEWERS:
        d, m = load_reviewer(r, spec)
        if d is None:
            missing.append(r)
        else:
            rev[r] = d
            meta[r] = m
    if missing:
        print("  reviewer files present : %d / 3" % (3 - len(missing)))
        for r in missing:
            print("    MISSING: out/h_review_ai/reviews/%s.json" % r)
        die("A3 independent blinded reviewer passes are not available. "
            "Consensus cannot be formed from fewer than 3 independent reviewers, "
            "and simulating independence is not permitted.")
    allerr = [(r, e) for r in REVIEWERS for e in meta[r]["errors"]]
    if allerr:
        for r, e in allerr[:40]:
            print("    SCHEMA ERROR [%s] %s" % (r, e))
        die("%d schema errors across reviewer files" % len(allerr))

    for r in REVIEWERS:
        print("  %-11s items=%-4d container=%-10s sha256=%s"
              % (r, meta[r]["n_items"], meta[r]["container"],
                 meta[r]["sha256"][:40]))
    common = set(rev[REVIEWERS[0]])
    for r in REVIEWERS[1:]:
        common &= set(rev[r])
    print("  items common to all three: %d" % len(common))

    # ---------------- A7 agreement metrics (before any science)
    m = defaultdict(lambda: [0, 0])
    for iid in sorted(common):
        a = [rev[r][iid] for r in REVIEWERS]
        m["A_same_unanimous"][1] += 1
        if all(x["A"] == "SAME" for x in a):
            m["A_same_unanimous"][0] += 1
        allx = sorted({x for y in a for x in y["B"]})
        for x in allx:
            m["B_printed_unanimous"][1] += 1
            vs = [y["B"].get(x, "MISSING") for y in a]
            if vs[0] == vs[1] == vs[2] == "PRINTED":
                m["B_printed_unanimous"][0] += 1
        for p in sorted({k for y in a for k in y["C"]}):
            m["C_map_unanimous"][1] += 1
            vs = [y["C"].get(p, "MISSING") for y in a]
            if vs[0] == vs[1] == vs[2] and vs[0].startswith("X"):
                m["C_map_unanimous"][0] += 1
        m["D_card_unanimous"][1] += 1
        if a[0]["D"] == a[1]["D"] == a[2]["D"]:
            m["D_card_unanimous"][0] += 1
        m["E_high_2of3_no_low"][1] += 1
        if sum(1 for x in a if x["E"] == "HIGH") >= 2 and \
                not any(x["E"] == "LOW" for x in a):
            m["E_high_2of3_no_low"][0] += 1
    pairs = {}
    for x, y in itertools.combinations(REVIEWERS, 2):
        agree = 0
        for iid in sorted(common):
            ax, ay = rev[x][iid], rev[y][iid]
            same = (ax["A"] == ay["A"] and ax["D"] == ay["D"]
                    and ax["E"] == ay["E"]
                    and ax["B"] == ay["B"] and ax["C"] == ay["C"])
            agree += int(same)
        pairs["%s|%s" % (x, y)] = agree / max(1, len(common))
    rank_tot = rank_ok = rank_any = 0
    for iid in sorted(common):
        a = [rev[r][iid] for r in REVIEWERS]
        for p in sorted({k for y in a for k in (y.get("second_pass") or {})}):
            rank_tot += 1
            rank_any += sum(1 for y in a
                            if (y.get("second_pass") or {}).get(p))
            maps = []
            allok = True
            for y in a:
                sp = (y.get("second_pass") or {}).get(p)
                if not sp or sp.get("verdict") != "RANK_OK":
                    allok = False
                    break
                maps.append(sp.get("map") or {})
            if allok and all(mm == maps[0] for mm in maps):
                rank_ok += 1

    # ---------------- A6 consensus
    cons_items, n_on, n_note, unresolved = [], 0, 0, 0
    for iid in sorted(common):
        a = [rev[r][iid] for r in REVIEWERS]
        ok_struct = all(x["A"] == "SAME" for x in a)
        conf_ok = (sum(1 for x in a if x["E"] == "HIGH") >= 2
                   and not any(x["E"] == "LOW" for x in a))
        entry = {"item_id": iid, "A_unanimous": a[0]["A"] if ok_struct else None,
                 "E_values": [x["E"] for x in a],
                 "accepted": bool(ok_struct and conf_ok),
                 "onsets": [], "rank_pairs": {}}
        if not (ok_struct and conf_ok):
            entry["status"] = "AI_CONSENSUS_UNRESOLVED"
            unresolved += 1
            cons_items.append(entry)
            continue
        entry["status"] = "AI_CONSENSUS_ACCEPTED"
        entry["D_unanimous"] = a[0]["D"] if a[0]["D"] == a[1]["D"] == a[2]["D"] else None
        for x in sorted({k for y in a for k in y["B"]}):
            vs = [y["B"].get(x, "MISSING") for y in a]
            st = "PRINTED" if vs[0] == vs[1] == vs[2] == "PRINTED" else "UNRESOLVED"
            entry["onsets"].append({"x": x, "presence": st})
            if st == "PRINTED":
                n_on += 1
        for p in sorted({k for y in a for k in y["C"]}):
            vs = [y["C"].get(p, "MISSING") for y in a]
            if vs[0] == vs[1] == vs[2] and vs[0].startswith("X"):
                entry["onsets"].append({"p": p, "match": vs[0]})
        for p in sorted({k for y in a for k in (y.get("second_pass") or {})}):
            maps, allok = [], True
            for y in a:
                sp = (y.get("second_pass") or {}).get(p)
                if not sp or sp.get("verdict") != "RANK_OK":
                    allok = False
                    break
                maps.append(sp.get("map") or {})
            if allok and all(mm == maps[0] for mm in maps) and maps[0]:
                entry["rank_pairs"][p] = maps[0]
                n_note += len(maps[0])
        cons_items.append(entry)

    print("\nA7  agreement (computed BEFORE any scientific join)")
    def rate(key, label):
        got, tot = m[key]
        print("  %-34s %4d / %-5d = %.4f" % (label, got, tot, got / max(1, tot)))
    rate("A_same_unanimous", "unanimous SAME-measure rate")
    rate("B_printed_unanimous", "unanimous onset-PRESENT rate")
    rate("C_map_unanimous", "unanimous P->X mapping rate")
    rate("D_card_unanimous", "unanimous cardinality rate")
    rate("E_high_2of3_no_low", ">=2/3 HIGH and no LOW")
    print("  %-34s %4d / %-5d = %.4f  (%d second-pass verdicts submitted in all)"
          % ("unanimous rank-pairing rate", rank_ok, rank_tot,
             rank_ok / max(1, rank_tot), rank_any))
    for k, v in pairs.items():
        print("  pairwise exact-agreement %-16s %.4f" % (k, v))
    print("\nA6  AI_BLIND_CONSENSUS")
    print("  consensus accepted items   : %d" % sum(1 for c in cons_items if c["accepted"]))
    print("  unresolved items           : %d" % unresolved)
    print("  consensus matched onsets   : %d" % n_on)
    print("  consensus matched noteheads: %d" % n_note)

    payload = {"label": "AI_BLIND_CONSENSUS",
               "warning": "NOT human ground truth. NOT manually certified. "
                          "Internal R&D only.",
               "packet_sha256": (BASE / "items_neutral.sha256").read_text().strip(),
               "reviewer_sha256": {r: meta[r]["sha256"] for r in REVIEWERS},
               "rules": {"measure_identity": "unanimous SAME",
                         "onset_presence": "unanimous PRINTED",
                         "P_to_X": "unanimous identical X id",
                         "cardinality": "unanimous",
                         "rank_pairing": "unanimous RANK_OK with identical map",
                         "admission": "unanimous structure AND >=2/3 HIGH AND no LOW",
                         "otherwise": "AI_CONSENSUS_UNRESOLVED",
                         "bias_policy": "precision over coverage"},
               "agreement": {k: m[k] for k in m},
               "rank_pairing": [rank_ok, rank_tot, rank_any],
               "pairwise": pairs,
               "consensus_matched_onsets": n_on,
               "consensus_matched_noteheads": n_note,
               "unresolved_items": unresolved,
               "items": cons_items}
    blob = json.dumps(payload["items"], sort_keys=True, separators=(",", ":"))
    h = hashlib.sha256(blob.encode()).hexdigest()
    payload["consensus_manifest_sha256"] = h
    (BASE / "ai_blind_consensus_manifest.json").write_text(
        json.dumps(payload, indent=1))
    print("\nA9  FROZEN (before any residual/pitch join)")
    print("  consensus manifest sha256: %s" % h)
    print("  wrote out/h_review_ai/ai_blind_consensus_manifest.json")


if __name__ == "__main__":
    main()