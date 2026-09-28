"""Drop-in corpus access for the real-PDF adaptation records.

The real-PDF records produced by ``build_corpus.py`` are ordinary V2.5 canonical
records: same ``input.modelInput`` the production adapter builds, same
``target.families`` schema the qualified checkpoint was trained on. So the
existing canonical code path is used unchanged:

    piano_vision.v25.data.tensorize_v25
        -> piano_vision.v2.data.build_inputs
        -> piano_vision.v2.data.attach_targets
        -> piano_vision.v25.data.attach_object_page_geo
        -> piano_vision.v25.data.attach_event_targets
        -> piano_vision.v25.data.collate_v25
        -> piano_vision.v25.performance.prepare_batch

The only thing this module supplies is a ``PageResolver``-shaped object that
serves the pre-rendered 150 DPI grayscale pages, so ``crop_view`` cuts exactly
the pixels production cuts. No crop is precomputed and no tensor is cached, so
a change to the rendering contract changes training and inference together.
"""
from __future__ import annotations

import gzip
import hashlib
import json
from collections import OrderedDict
from pathlib import Path

from PIL import Image

from piano_vision.v2.data import source_order

SPLIT_GUARD = {"adaptation": "train", "validation": "validation",
               "heldout-test": "validation", "diagnostic": "validation"}
# Only the adaptation split may ever reach an optimizer. Evaluation-only splits
# are openable (their records carry split="validation", which the canonical
# PageResolver accepts) but are refused by any training entry point.
TRAINABLE_SPLITS = frozenset({"adaptation"})


def load_index(index_path) -> dict:
    return json.loads(Path(index_path).read_text())


def split_to_record_split(split: str) -> str:
    """Map a campaign split onto the record ``split`` the canonical code allows."""
    if split in SPLIT_GUARD:
        return SPLIT_GUARD[split]
    if split in {"train", "validation"}:
        return split
    raise PermissionError(f"unknown campaign split {split!r}")


def assert_trainable(campaign_split: str) -> None:
    """Refuse to train on an evaluation split. Called by every training entry point."""
    if campaign_split not in TRAINABLE_SPLITS:
        raise PermissionError(
            f"campaign split {campaign_split!r} is evaluation-only; held-out and "
            f"diagnostic scores may never contribute a training measure")


class RealPdfPageResolver:
    """``PageResolver``-compatible reader for the real-PDF corpus.

    Enforces the same two guards the qualified factory reader does: only
    train/validation records are open, and a score's declared split must match
    the split on its records.
    """

    def __init__(self, index_path, max_pages=3):
        self.index_path = str(index_path)
        self.index = load_index(self.index_path)
        self.root = Path(self.index["dataset_root"])
        self.scores = {s["score_id"]: s for s in self.index["scores"]}
        self.assignments = {s["score_id"]: s["split"] for s in self.index["scores"]}
        self.max_pages = max_pages
        self.pages: OrderedDict = OrderedDict()
        self.page_paths: dict[str, dict[str, str]] = {}
        for score in self.index["scores"]:
            self.page_paths[score["score_id"]] = {
                f"p{n}": str(self.root / path)
                for n, path in enumerate(score["page_paths"], start=1)}

    def page(self, record):
        if record["split"] not in {"train", "validation"}:
            raise PermissionError(f"sealed split: {record['split']!r}")
        declared = self.assignments.get(record["scoreId"])
        if declared is not None and split_to_record_split(declared) != record["split"]:
            raise PermissionError(
                f"score {record['scoreId']} is {declared!r} but the record claims "
                f"{record['split']!r}")
        page_number = source_order(record)[0]
        # Key on the score as well as the page. Keying on the page alone would
        # silently serve the previous score's pixels, which is both a wrong
        # answer and a wrong measurement.
        key = (record["scoreId"], page_number)
        if key not in self.pages:
            path = self.page_paths[record["scoreId"]].get(f"p{page_number}")
            if path is None:
                raise KeyError(f"no rendered page {key} for {record['scoreId']}")
            with Image.open(path) as image:
                self.pages[key] = image.convert("L").copy()
        self.pages.move_to_end(key)
        while len(self.pages) > self.max_pages:
            self.pages.popitem(last=False)
        return self.pages[key]


def load_realpdf_records(score_id, split, index_path) -> list[dict]:
    """Every record of one score, in canonical ``source_order``.

    ``split`` is the CAMPAIGN split (``adaptation`` / ``validation`` /
    ``heldout-test`` / ``diagnostic``). It is mapped to the record ``split`` the
    canonical code allows, and the shard contents are re-checked against that,
    so a manifest can never open a sealed split by relabelling it.
    """
    index = load_index(index_path)
    record_split = split_to_record_split(split)
    score = next((s for s in index["scores"]
                  if s["score_id"] == score_id and s["split"] == split), None)
    if score is None:
        raise PermissionError(f"score {score_id} is not in split {split}")
    root = Path(index["dataset_root"])
    records: dict[str, dict] = {}
    for shard in score["shards"]:
        with gzip.open(root / "shards" / shard, "rt") as stream:
            for line in stream:
                record = json.loads(line)
                if record["scoreId"] != score_id:
                    raise ValueError("shard content contradicts the score manifest")
                if record["split"] != record_split:
                    raise PermissionError("shard content contradicts the split manifest")
                if record["provenance"].get("runtimeTruthInputs") != []:
                    raise ValueError("runtime truth firewall violation")
                records[record["exampleId"]] = record
    if len(records) != score["examples"]:
        raise ValueError(f"score manifest count mismatch: {len(records)} != {score['examples']}")
    return sorted(records.values(), key=source_order)


def realpdf_manifest(path, split) -> dict:
    """Campaign manifest with the same content-digest discipline as the factory.

    ``campaign_profile.manifest`` recomputes the digest over everything except
    the ``digest`` key and refuses a split mismatch. This keeps a real-PDF
    manifest interchangeable with a factory manifest in the same code path.
    """
    doc = json.loads(Path(path).read_text())
    digest = hashlib.sha256(
        json.dumps({k: v for k, v in doc.items() if k != "digest"}, sort_keys=True).encode()
    ).hexdigest()
    if doc.get("split") != split:
        raise ValueError(f"manifest split {doc.get('split')!r} != {split!r}")
    if doc.get("digest") != digest:
        raise ValueError("manifest content digest mismatch")
    if any(entry["split"] != split for entry in doc["examples"]):
        raise PermissionError("mixed-split manifest")
    return doc


def write_manifest(path, split, corpus_index_path, campaign_split) -> dict:
    """Materialise ``<split>.json`` for one campaign split from a corpus index."""
    index = load_index(corpus_index_path)
    root = Path(index["dataset_root"])
    record_split = split_to_record_split(campaign_split)
    examples = []
    for score in index["scores"]:
        if score["split"] != campaign_split:
            continue
        for record in load_realpdf_records(score["score_id"], campaign_split, corpus_index_path):
            examples.append({
                "score_id": score["score_id"],
                "example_id": record["exampleId"],
                "split": record_split,
                "page": source_order(record)[0],
                "families": sorted({name for name, labels in record["target"]["families"].items()
                                    if any(label.get("state") == "KNOWN" for label in labels)}),
            })
    examples.sort(key=lambda e: (e["score_id"], e["page"], e["example_id"]))
    doc = {
        "schemaVersion": 1,
        "split": record_split,
        "campaign_split": campaign_split,
        "corpus_manifest_digest": index["manifest_digest"],
        "render_dpi": index["render_dpi"],
        "scores": sorted({e["score_id"] for e in examples}),
        "examples": examples,
    }
    doc["digest"] = hashlib.sha256(
        json.dumps({k: v for k, v in doc.items() if k != "digest"},
                   sort_keys=True).encode()).hexdigest()
    Path(path).write_text(json.dumps(doc, indent=2, sort_keys=True))
    return doc


def _campaign_split_of(self, manifest) -> str:
    """Campaign split behind a manifest document."""
    split = manifest.get("campaign_split")
    if split is None:
        raise ValueError("manifest does not declare a campaign split")
    return split


RealPdfPageResolver.campaign_split_of = _campaign_split_of
