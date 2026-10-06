#!/usr/bin/env python3
"""H13 - human-confirmed correspondence, then (and only then) the residual join.

Run order is enforced by the file system, not by good intentions:

  1. validate human_review_answers.json
  2. build the human-confirmed correspondence
  3. freeze + hash it                     <-- membership is now immutable
  4. join hidden scientific fields
  5. clean gate

Step 4 refuses to run unless the frozen manifest from step 3 exists and its hash
matches, so residuals cannot influence membership. Nothing here may be re-run to
grow N after the join; use a NEW population and a NEW review instead.

Usage:
    python3 h_human_correspondence.py validate
    python3 h_human_correspondence.py freeze
    python3 h_human_correspondence.py gate
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent
OUT = ROOT / "out/h_review_human_micro"
ANSWERS = OUT / "human_review_answers.json"
POP = OUT / "population.json"
FROZEN = OUT / "human_correspondence_frozen.json"
FROZEN_SHA = OUT / "human_correspondence_frozen.sha256"
GATE = OUT / "clean_gate.json"

POP_SHA = "6abeebd9a717a03d0d40f2e09460c910e9b727b7517b198fc4fad97e1d65534d"
CEILING = 137
N_REQUIRED = 50

# Scientific fields, touched only in step 4.
HIDDEN_KEYS = ["delta_space", "r_corpus", "r_render", "d0", "true_d"]


def die(msg: str) -> None:
    print("REFUSED: %s" % msg)
    sys.exit(2)


def load_answers():
    if not ANSWERS.is_file():
        die("%s does not exist yet - the human review has not been exported." % ANSWERS.name)
    a = json.loads(ANSWERS.read_text())
    if a.get("population_sha256") != POP_SHA:
        die("answers population hash does not match the frozen micro-review population.")
    if not POP.is_file():
        die("population.json missing; rebuild the tool.")
    pop = json.loads(POP.read_text())
    if pop["population_sha256"] != POP_SHA:
        die("population.json hash drifted from the frozen value.")
    ids = [i["item_id"] for i in a.get("items", [])]
    if ids != pop["population"]:
        die("answers item list does not match the frozen population (order or membership changed).")
    bad = [i["item_id"] for i in a["items"]
           if set(i) != {"item_id", "x_presence", "p_to_x", "false_p", "unlisted_onsets"}]
    if bad:
        die("unexpected keys in answers for %s" % bad)
    return a, pop


def build_correspondence(a):
    """Only human CONFIRMED rank pairings count. UNSURE and AMBIGUOUS are excluded."""
    rows = []
    for it in a["items"]:
        for pr in it["p_to_x"]:
            if pr.get("rank_status") != "CONFIRMED":
                continue
            for rp in pr.get("rank_pairs", []):
                rows.append({
                    "item_id": it["item_id"],
                    "p": pr["p"], "x": pr["x"],
                    "p_notehead": rp["p"], "x_notehead": rp["x"],
                })
    return rows


def cmd_validate() -> int:
    a, pop = load_answers()
    rows = build_correspondence(a)
    n = len(rows)
    print("answers            : %s" % ANSWERS.name)
    print("population         : %d items, sha %s" % (pop["population_n"], pop["population_sha256"]))
    print("confirmed noteheads: %d" % n)
    print("ceiling            : %d" % CEILING)
    print("N >= %d reachable  : %s" % (N_REQUIRED, n >= N_REQUIRED))
    done = sum(1 for i in a["items"]
               if i["p_to_x"] or i["false_p"] or i["x_presence"] or i["unlisted_onsets"])
    print("items with any decision: %d / %d" % (done, pop["population_n"]))
    if n == 0:
        print("\nN = 0 -> no correspondence. Do not run freeze or gate.")
        return 1
    return 0


def cmd_freeze() -> int:
    a, pop = load_answers()
    rows = build_correspondence(a)
    if not rows:
        die("no CONFIRMED notehead-level pairs to freeze.")
    if FROZEN.is_file():
        die("a frozen correspondence already exists (%s). Membership is immutable; "
            "it may not be regenerated after the residual join." % FROZEN.name)
    doc = {
        "label": "HUMAN_CONFIRMED_CORRESPONDENCE",
        "population_sha256": POP_SHA,
        "population_n": pop["population_n"],
        "scale": "CONFIRMED only; UNSURE and AMBIGUOUS excluded",
        "matched_notehead_n": len(rows),
        "clean_gate_required_n": N_REQUIRED,
        "pairs": rows,
    }
    FROZEN.write_text(json.dumps(doc, indent=1) + "\n")
    sha = hashlib.sha256(FROZEN.read_bytes()).hexdigest()
    FROZEN_SHA.write_text(sha + "\n")
    print("frozen %d human-confirmed noteheads" % len(rows))
    print("sha256 %s" % sha)
    print("frozen BEFORE any residual join. Membership may not change from here.")
    return 0


def cmd_gate() -> int:
    if not FROZEN.is_file() or not FROZEN_SHA.is_file():
        die("no frozen correspondence. Run freeze first; the gate cannot join residuals "
            "before membership is immutable.")
    sha = hashlib.sha256(FROZEN.read_bytes()).hexdigest()
    if sha != FROZEN_SHA.read_text().strip():
        die("frozen correspondence hash mismatch. Membership was altered after freezing - "
            "the result is void.")
    doc = json.loads(FROZEN.read_text())
    n = doc["matched_notehead_n"]

    # ---- step 4: the ONLY place hidden scientific fields are read -------------
    import harness as H  # noqa: E402
    sci = {}
    sp = OUT / "scientific_lookup.json"
    if not sp.is_file():
        die("scientific_lookup.json missing. It must be generated from the frozen corpus "
            "for exactly these (item_id, p_notehead) keys. Refusing to guess it.")
    sci = json.loads(sp.read_text())

    vals, missing = [], 0
    for r in doc["pairs"]:
        k = "%s|%s" % (r["item_id"], r["p_notehead"])
        if k not in sci:
            missing += 1
            continue
        row = sci[k]
        vals.append((abs(float(row["delta_space"])), int(row["r_render"])))
    if not vals:
        die("no scientific rows matched the frozen correspondence.")

    d_ok = sum(1 for v, _ in vals if v < 0.25)
    r_ok = sum(1 for _, v in vals if v == 0)
    n_tot = len(vals)
    d_frac = d_ok / n_tot
    r_frac = r_ok / n_tot
    passed = (d_frac > 0.98) and (r_frac > 0.98)

    GATE.write_text(json.dumps({
        "correspondence_sha256": sha,
        "matched_notehead_n": n,
        "scientific_rows": n_tot,
        "unmatched_rows": missing,
        "delta_space_under_0.25_fraction": round(d_frac, 6),
        "r_render_zero_fraction": round(r_frac, 6),
        "rule": ">98% |delta_space| < 0.25 AND >98% r_render == 0",
        "pass": passed,
        "note": "N below %d is reported honestly; it is NOT a pass or a fail of the "
                "correspondence itself." % N_REQUIRED,
    }, indent=1) + "\n")
    print("matched notehead N : %d" % n)
    print("scientific rows    : %d (unmatched %d)" % (n_tot, missing))
    print("|delta_space|<0.25 : %.4f  (need > 0.98)" % d_frac)
    print("r_render == 0      : %.4f  (need > 0.98)" % r_frac)
    print("CLEAN GATE         : %s" % ("PASS" if passed else "FAIL"))
    return 0 if passed else 1


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "validate"
    if cmd == "validate":
        return cmd_validate()
    if cmd == "freeze":
        return cmd_freeze()
    if cmd == "gate":
        return cmd_gate()
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
