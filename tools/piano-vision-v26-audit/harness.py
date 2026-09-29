"""Shared, frozen access to the qualified V2.5 champion and to both corpora.

Nothing here trains anything. Every audit/gate script imports from here so that
the checkpoint, the runtime code and the two corpora are identical across
measurements. The source (factory) corpus is READ ONLY; the real-PDF corpus is
rebuilt by build_corpus.py into this worktree's out/realpdf.

Paths outside this worktree are read-only inputs. Nothing writes to them.
"""
from __future__ import annotations

import copy
import gzip
import json
import os
import sys
from pathlib import Path

# The factory dataset, the champion checkpoint and the frozen runtime all live
# in the primary checkout. We never write there.
SOURCE_REPO = Path(os.environ.get("PV_SOURCE_REPO", Path.home() / "Documents/scoreflow"))
V26_ROOT = Path(__file__).resolve().parents[2]

CAMPAIGN = SOURCE_REPO / "tmp/campaign/piano-vision-phase214"
TRANSFER = CAMPAIGN / "v25-windows-transfer-20260927"
CHECKPOINT = TRANSFER / "checkpoint-final.pt"
CONTRACT = TRANSFER / "contract.json"
RUNTIME_ROOT = TRANSFER / "runtime/piano-vision-v25-candidate"
FACTORY = SOURCE_REPO / "tmp/campaign/pdmx-piano-vision-full-v1"
INDEX = CAMPAIGN / "full-semantic-index.json"
ORIG_VAL_MANIFEST = CAMPAIGN / "v2-serious-medium-full-v1/validation.json"
ORIG_TRAIN_MANIFEST = CAMPAIGN / "v2-serious-medium-full-v1/train.json"

# Rebuilt locally by tools/real-pdf-adaptation/build_corpus.py.
# PV_REALPDF selects the corpus REVISION. "out/realpdf" is the frozen pre-Phase-D
# corpus; "out/realpdf_d2" is the post-index-fix corpus. The Gate 0 protocol is
# byte-identical across both - only the corpus under test changes.
REALPDF_ROOT = V26_ROOT / os.environ.get("PV_REALPDF", "out/realpdf")
REALPDF_INDEX = REALPDF_ROOT / "index.json"

OUT = V26_ROOT / "tools/piano-vision-v26-audit/out"

PITCH_HEADS = ("pitch_written_step", "pitch_octave", "pitch_accidental", "pitch_staff")
# The strict per-object conjunction: step AND octave AND accidental AND staff.
_STRICT = ("pitch_written_step", "pitch_octave", "pitch_accidental", "pitch_staff")
DURATION_HEADS = ("duration_type", "duration_dots")


def add_runtime_to_path() -> None:
    """Put the frozen champion runtime first on sys.path.

    V25Runtime refuses to load if a different piano_vision is already imported,
    so this must run before any piano_vision import.
    """
    for p in (str(SOURCE_REPO / "server"), str(RUNTIME_ROOT)):
        if p not in sys.path:
            sys.path.insert(0, p)


def load_runtime(device="cpu"):
    """Qualified step-2100 champion, frozen, inference only."""
    add_runtime_to_path()
    from piano_vision_service.runtime import V25Runtime
    return V25Runtime(CHECKPOINT, RUNTIME_ROOT, device=device)


def load_config():
    add_runtime_to_path()
    from piano_vision.v25.config import config_from_dict
    return config_from_dict(json.loads(CONTRACT.read_text())["model_config"])


# --------------------------------------------------------------------------
# source (factory) corpus
# --------------------------------------------------------------------------

def source_scores(limit, split="validation", seed=21701, validation_role=None):
    """Deterministic score subset, identical selection rule to development_scores."""
    add_runtime_to_path()
    from piano_vision.v2.data import development_scores
    return list(development_scores(INDEX, split, limit, seed=seed,
                                  validation_role=validation_role))


def source_resolver(index_path=None):
    add_runtime_to_path()
    from piano_vision.v2.data import PageResolver
    return PageResolver(FACTORY, max_pages=3,
                        index_path=index_path if index_path is not None else INDEX)


# --------------------------------------------------------------------------
# real-PDF corpus
# --------------------------------------------------------------------------

def realpdf_resolver():
    sys.path.insert(0, str(V26_ROOT / "tools/real-pdf-adaptation"))
    from realpdf_data import RealPdfPageResolver
    return RealPdfPageResolver(REALPDF_INDEX, max_pages=3)


def realpdf_scores(split):
    """All records of every score in one campaign split, canonical order."""
    sys.path.insert(0, str(V26_ROOT / "tools/real-pdf-adaptation"))
    from realpdf_data import load_realpdf_records
    index = json.loads(REALPDF_INDEX.read_text())
    out = []
    for score in index["scores"]:
        if score["split"] != split:
            continue
        out.append((score["score_id"],
                    load_realpdf_records(score["score_id"], split, REALPDF_INDEX)))
    return out


# --------------------------------------------------------------------------
# batch construction
# --------------------------------------------------------------------------

def build_batch(runtime, resolver, ordered, record, mutate=None):
    """Canonical V2.5 input assembly for one record.

    mutate(record) -> record lets an audit perturb the SOURCE GEOMETRY or the
    source-only metadata while pixels, labels and object order stay fixed.
    Returns (batch, sample, selected, lookup).
    """
    add_runtime_to_path()
    from piano_vision.v2.data import build_inputs, attach_targets, collate
    from piano_vision.v25.data import attach_object_page_geo
    from piano_vision.v25.performance import prepare_batch

    rec = copy.deepcopy(record)
    if mutate:
        mutate(rec)
    sample, selected, lookup, relations, nodes = build_inputs(
        rec, ordered, resolver, runtime.config)
    sample = attach_targets(sample, rec, selected, lookup, relations, nodes)
    sample = attach_object_page_geo(sample, selected)
    batch = prepare_batch(collate([sample]), consistency=False)
    return runtime._to_device(batch), sample, selected, lookup


def forward(runtime, batch):
    import torch
    with torch.inference_mode():
        return runtime.model(batch, decode_notation=False, return_memory=False)


# --------------------------------------------------------------------------
# metrics
# --------------------------------------------------------------------------

def head_accuracy(out, batch, head, group="object"):
    import torch
    pred = out[group][head][0].argmax(-1).cpu()
    tgt = batch["targets"][group][head]["target"][0].cpu()
    msk = batch["targets"][group][head]["mask"][0].cpu()
    h = int(((pred == tgt) & msk).sum())
    return h, int(msk.sum())


def strict_pitch(out, batch, heads=_STRICT):
    """Per-object conjunction over the written-pitch heads.

    An object counts correct only if every head in `heads` is correct, and it is
    only counted if all of them are supervised. This is the real-PDF campaign's
    canonical `written_pitch_accuracy` definition, applied to any corpus.
    """
    import torch
    ok = None
    mask = None
    for head in heads:
        pred = out["object"][head][0].argmax(-1).cpu()
        tgt = batch["targets"]["object"][head]["target"][0].cpu()
        msk = batch["targets"]["object"][head]["mask"][0].cpu()
        good = (pred == tgt) & msk
        ok = good if ok is None else (ok & good)
        mask = msk if mask is None else (mask & msk)
    ok = ok & mask
    return int(ok.sum()), int(mask.sum())


def staff_step_accuracy(out, batch):
    return head_accuracy(out, batch, "pitch_staff_step")


def duration_accuracy(out, batch):
    hit = tot = 0
    for head in DURATION_HEADS:
        h, t = head_accuracy(out, batch, head)
        hit += h
        tot += t
    return hit, tot


class Accumulator:
    """Counts objects across many records so deltas are never single-object noise."""

    def __init__(self):
        self.reset()

    def reset(self):
        self.pitch_hit = self.pitch_tot = 0
        self.step_hit = self.step_tot = 0
        self.dur_hit = self.dur_tot = 0
        self.records = 0

    def add(self, out, batch):
        h, t = strict_pitch(out, batch)
        self.pitch_hit += h
        self.pitch_tot += t
        h, t = staff_step_accuracy(out, batch)
        self.step_hit += h
        self.step_tot += t
        h, t = duration_accuracy(out, batch)
        self.dur_hit += h
        self.dur_tot += t
        self.records += 1

    def report(self):
        def r(h, t):
            return round(h / t, 6) if t else None
        return {
            "records": self.records,
            "written_pitch_accuracy": r(self.pitch_hit, self.pitch_tot),
            "written_pitch_correct": self.pitch_hit,
            "written_pitch_labels": self.pitch_tot,
            "pitch_staff_step_accuracy": r(self.step_hit, self.step_tot),
            "pitch_staff_step_labels": self.step_tot,
            "duration_accuracy": r(self.dur_hit, self.dur_tot),
            "duration_labels": self.dur_tot,
        }


def write_json(name, payload):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, default=str))
    return path
