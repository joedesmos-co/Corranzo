"""D1/D2 - how much independent support does each fret class actually have?

## Why object count is not the answer

A fret value that appears 40 times across 12 scores is a different proposition from
one that appears 40 times inside a single score. The second is 40 crops of one
rendering context: same font stack, same staff spacing, same engraver settings, same
page. Only the first gives a held-out score anything resembling a new *domain*.

So this audit reports three separate things per class, and never collapses them:

- **objects** - raw instance count, what a naive accuracy denominator uses;
- **scores** - distinct scoreIds containing the class, the count of independent
  renderings;
- **strings** - distinct TAB lines, which is the other axis of visual variety
  (position and scale change with string).

and it does the same conditionally for fret x string, because a class can look
plentiful in aggregate and be thin at every (fret, string) cell that actually
occurs.

## What the record does not carry

There is no measure identifier and no per-page structure beyond `page: 1` - every
score in this corpus is a single page, so pages and scores are the same count here
and are reported as such rather than invented. "Instances" are therefore counted
as objects within a score, and the report is explicit that objects from one score
are *not* independent draws.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE / "python"))

from guitar_vision.dataset import string_for_object  # noqa: E402

NO_STRING = 0


def audit(records_dir: Path, train_pages: int, held_out: int) -> dict[str, Any]:
    records = [json.loads(p.read_text()) for p in sorted(records_dir.glob("*.record.json"))]
    train = records[:train_pages]
    held = records[train_pages : train_pages + held_out]

    def tally(pages: list[dict[str, Any]]) -> dict[str, Any]:
        objects = Counter()
        scores = defaultdict(set)
        strings = defaultdict(set)
        pairs = Counter()
        pair_scores = defaultdict(set)
        for record in pages:
            sid = record["scoreId"]
            for obj in record["objects"]:
                if obj["objectType"] != "fret-digit" or not obj.get("fret"):
                    continue
                fret = int(obj["fret"])
                string = string_for_object(record, obj)
                objects[fret] += 1
                scores[fret].add(sid)
                strings[fret].add(string)
                pairs[(fret, string)] += 1
                pair_scores[(fret, string)].add(sid)
        return {
            "objects": objects,
            "scores": scores,
            "strings": strings,
            "pairs": pairs,
            "pair_scores": pair_scores,
        }

    tr = tally(train)
    hd = tally(held)
    classes = sorted(set(tr["objects"]) | set(hd["objects"]))

    rows = []
    for fret in classes:
        n_tr = tr["objects"].get(fret, 0)
        n_hd = hd["objects"].get(fret, 0)
        s_tr = len(tr["scores"].get(fret, ()))
        s_hd = len(hd["scores"].get(fret, ()))
        st_tr = sorted(tr["strings"].get(fret, ()))
        st_hd = sorted(hd["strings"].get(fret, ()))
        pair_support = [
            pair for pair in tr["pairs"] if pair[0] == fret
        ]
        min_pair_scores = min(
            (len(tr["pair_scores"][p]) for p in pair_support), default=0
        )
        rows.append(
            {
                "fret": fret,
                "digits": 1 if fret < 10 else 2,
                "train_objects": n_tr,
                "held_objects": n_hd,
                "train_scores": s_tr,
                "held_scores": s_hd,
                "train_strings": st_tr,
                "held_strings": st_hd,
                "train_cells_fret_x_string": len(pair_support),
                "min_train_scores_per_cell": min_pair_scores,
                "train_objects_per_score": round(n_tr / s_tr, 3) if s_tr else 0.0,
                "in_train": n_tr > 0,
                "in_held": n_hd > 0,
                "train_score_support_band": (
                    "absent" if s_tr == 0 else "1" if s_tr == 1 else "<=2" if s_tr <= 2 else "<=3" if s_tr <= 3 else "4+"
                ),
            }
        )

    # fret x string conditional support, train side only
    pair_rows = [
        {
            "fret": fret,
            "string": string,
            "train_objects": tr["pairs"][(fret, string)],
            "train_scores": len(tr["pair_scores"][(fret, string)]),
            "held_objects": hd["pairs"].get((fret, string), 0),
        }
        for fret, string in sorted(tr["pairs"])
    ]

    absent_in_train = [r["fret"] for r in rows if not r["in_train"]]
    absent_in_held = [r["fret"] for r in rows if not r["in_held"]]
    bands = Counter(r["train_score_support_band"] for r in rows)
    train_counts = [r["train_objects"] for r in rows if r["in_train"]]
    held_counts = [r["held_objects"] for r in rows if r["in_held"]]

    majority_train = max(train_counts) if train_counts else 0
    majority_held = max(held_counts) if held_counts else 0
    total_train = sum(train_counts)
    total_held = sum(held_counts)

    # Held-out instances whose class has thin independent train support.
    thin = [
        r for r in rows
        if r["in_held"] and r["train_score_support_band"] in {"absent", "1", "<=2", "<=3"}
    ]
    held_in_thin = sum(r["held_objects"] for r in thin)

    import statistics

    return {
        "split": {
            "train_scores": [r["scoreId"] for r in train],
            "held_scores": [r["scoreId"] for r in held],
            "train_pages": len(train),
            "held_pages": len(held),
            "pages_equal_scores": all(r["page"] == 1 for r in records),
        },
        "totals": {
            "train_fret_objects": total_train,
            "held_fret_objects": total_held,
            "train_classes": sum(1 for r in rows if r["in_train"]),
            "held_classes": sum(1 for r in rows if r["in_held"]),
            "classes_total": len(rows),
        },
        "per_fret": rows,
        "fret_x_string": pair_rows,
        "support": {
            "classes_absent_from_train": absent_in_train,
            "classes_absent_from_held": absent_in_held,
            "train_score_support_bands": dict(bands),
            "median_train_scores_per_class": statistics.median(
                [r["train_scores"] for r in rows if r["in_train"]]
            )
            if any(r["in_train"] for r in rows) else 0,
            "median_train_objects_per_class": statistics.median(train_counts)
            if train_counts else 0,
            "median_held_objects_per_class": statistics.median(held_counts)
            if held_counts else 0,
            "max_to_median_train_objects": round(
                max(train_counts) / max(statistics.median(train_counts), 1e-9), 2
            )
            if train_counts else 0,
            "majority_class_train": max(
                tr["objects"].items(), key=lambda kv: kv[1]
            )[0] if tr["objects"] else None,
            "majority_class_train_share": round(majority_train / max(total_train, 1), 4),
            "majority_class_held": max(hd["objects"].items(), key=lambda kv: kv[1])[0]
            if hd["objects"] else None,
            "majority_class_held_share": round(majority_held / max(total_held, 1), 4),
        },
        "thin_support": {
            "classes_with_thin_train_score_support": [
                {"fret": r["fret"], "band": r["train_score_support_band"],
                 "train_scores": r["train_scores"], "held_objects": r["held_objects"]}
                for r in thin
            ],
            "held_objects_in_thin_classes": held_in_thin,
            "held_objects_total": total_held,
            "held_fraction_in_thin_classes": round(held_in_thin / max(total_held, 1), 4),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--records", type=Path, required=True)
    parser.add_argument("--train-pages", type=int, default=40)
    parser.add_argument("--held-out", type=int, default=20)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    report = audit(args.records, args.train_pages, args.held_out)

    print("D1/D2 data support audit")
    print("=" * 88)
    t = report["totals"]
    print(
        f"train {t['train_fret_objects']} fret objects over {report['split']['train_pages']} scores | "
        f"held {t['held_fret_objects']} over {report['split']['held_pages']} scores"
    )
    print(f"classes: {t['train_classes']} in train, {t['held_classes']} in held, {t['classes_total']} total")
    print()
    print(
        f"{'fret':>5} {'dig':>4} {'tr_obj':>7} {'hd_obj':>7} {'tr_scr':>7} {'hd_scr':>7} "
        f"{'tr_str':>14} {'cells':>6} {'minCellScr':>11} {'obj/scr':>8} {'band':>7}"
    )
    for row in report["per_fret"]:
        print(
            f"{row['fret']:>5} {row['digits']:>4} {row['train_objects']:>7} {row['held_objects']:>7} "
            f"{row['train_scores']:>7} {row['held_scores']:>7} "
            f"{str(row['train_strings']):>14} {row['train_cells_fret_x_string']:>6} "
            f"{row['min_train_scores_per_cell']:>11} {row['train_objects_per_score']:>8.2f} "
            f"{row['train_score_support_band']:>7}"
        )
    s = report["support"]
    print()
    print(f"absent from train: {s['classes_absent_from_train']}")
    print(f"absent from held : {s['classes_absent_from_held']}")
    print(f"train score-support bands: {s['train_score_support_bands']}")
    print(
        f"median train scores/class {s['median_train_scores_per_class']}  "
        f"median train objects/class {s['median_train_objects_per_class']}  "
        f"max:median objects {s['max_to_median_train_objects']}"
    )
    print(
        f"majority class train: fret {s['majority_class_train']} at {s['majority_class_train_share']:.1%} | "
        f"held: fret {s['majority_class_held']} at {s['majority_class_held_share']:.1%}"
    )
    th = report["thin_support"]
    print()
    print(
        f"held-out objects whose class has thin train-score support: "
        f"{th['held_objects_in_thin_classes']}/{th['held_objects_total']} = {th['held_fraction_in_thin_classes']:.1%}"
    )
    print(f"  {th['classes_with_thin_train_score_support']}")
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n")
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())