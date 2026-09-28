#!/usr/bin/env python3
"""Freeze the four campaign evaluation manifests from a built real-PDF corpus.

Thin CLI over ``realpdf_data.write_manifest`` so the PowerShell runner does not
have to inline Python. Writes ``<campaign_split>.json`` next to the corpus
index and prints a one-line summary per split.

The manifest carries a content digest, which ``train_realpdf.py`` and
``evaluate_realpdf.py`` both re-verify. A corpus or a split that changed after
the manifests were frozen cannot be silently trained or scored on.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools/piano-vision-v25-candidate"))

from realpdf_data import load_index, write_manifest  # noqa: E402

SPLITS = ("adaptation", "validation", "heldout-test", "diagnostic")


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--corpus-index", required=True)
    parser.add_argument("--splits", default=",".join(SPLITS))
    parser.add_argument("--min-adaptation-records", type=int, default=1)
    args = parser.parse_args()

    index_path = Path(args.corpus_index)
    index = load_index(index_path)
    root = Path(index["dataset_root"])
    wanted = [s.strip() for s in args.splits.split(",") if s.strip()]
    unknown = sorted(set(wanted) - set(SPLITS))
    if unknown:
        raise SystemExit(f"unknown campaign splits: {unknown}")

    written = {}
    for split in wanted:
        target = root / f"{split}.json"
        doc = write_manifest(target, None, index_path, split)
        written[split] = {
            "path": str(target), "records": len(doc["examples"]),
            "scores": doc["scores"], "digest": doc["digest"],
        }
        print(json.dumps({"split": split, "records": len(doc["examples"]),
                          "scores": len(doc["scores"]),
                          "digest": doc["digest"][:12]}), flush=True)

    adaptation = set(written.get("adaptation", {}).get("scores", []))
    for held in ("heldout-test", "diagnostic"):
        overlap = sorted(adaptation & set(written.get(held, {}).get("scores", [])))
        if overlap:
            raise SystemExit(
                f"split leak: {held} scores also appear in adaptation: {overlap}")
    if len(adaptation) < 2:
        raise SystemExit(
            f"adaptation has {len(adaptation)} score(s); a domain-adaptation run over a "
            f"single score would memorise it")
    held = len(written.get("heldout-test", {}).get("scores", []))
    if held and held < 3:
        raise SystemExit(
            f"held-out has only {held} score(s); prefer at least 3 so a single hard "
            f"engraving cannot decide the campaign")

    summary = {
        "corpus_index": str(index_path),
        "corpus_manifest_digest": index["manifest_digest"],
        "render_dpi": index["render_dpi"],
        "manifests": written,
        "selection_policy": {
            "selection_split": "validation",
            "heldout_used_for_selection": False,
            "diagnostic_used_for_selection": False,
        },
    }
    summary["digest"] = hashlib.sha256(
        json.dumps(summary, sort_keys=True).encode()).hexdigest()
    target = root / "manifests.json"
    tmp = Path(str(target) + ".tmp")
    tmp.write_text(json.dumps(summary, indent=2, sort_keys=True))
    os.replace(tmp, target)
    print(json.dumps({"ok": True, "summary": str(target),
                      "digest": summary["digest"][:12]}), flush=True)


if __name__ == "__main__":
    main()
