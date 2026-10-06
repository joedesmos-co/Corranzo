"""Regression fixture for the known padded-plane softmax bug (I6).

This test **documents a real, unfixed model bug**. It is marked ``xfail`` so the suite
stays green, but it is written to start passing the moment the bug is fixed, at which
point ``strict=True`` will turn the xfail into a failure and force a decision rather than
letting a fixed bug linger.

## The bug

``roi_crops`` builds a tile dimension from ``plane_count // batch`` and normalises a
per-tile score across it::

    score   = values.std(dim=-1, keepdim=True)
    weights = torch.softmax(score * 8.0, dim=2)
    combined = (values * weights).sum(dim=2)

``collate`` pads every page in a batch to that batch's maximum plane count, and pages in
this corpus carry between **7 and 29 planes**. The padded planes are not masked out of
``weights``, so they participate in the softmax and change the combined crop for *real*
objects on *real* pages.

## The consequence

A fret object's representation depends on which other pages happened to share its batch.
Measured on the validated phase-1 checkpoint (``tmp/gvprobe/std-ckpt/step1200``):

    max |P delta| between a 1-page and a 3-page forward   1.12e-01
    fret objects moved of 1162                            623

## Why production does not hit it

``guitar_vision.inference.GuitarFretModel`` runs one page per forward and
``infer_batch`` refuses anything longer. That is a guard, not a fix.

## Why it is not fixed here

Excluding padded planes from the softmax changes the phase-1 representation, which would
invalidate the checkpoint every validated number was measured against. It is a separate
change with its own retraining; see ``docs/GUITAR_VISION_BATCH_INVARIANCE_FIX_SPEC.md``.

Do not delete this test. Do not mark the bug fixed because this file exists.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.fret_experiments import build, roi_crops  # noqa: E402
from guitar_vision.qualify import Device  # noqa: E402

_REPO = Path(__file__).resolve().parents[4]
_RECORDS = _REPO / "datasets/guitar-vision/synthetic/train/records"
_VIEWS = _REPO / "datasets/guitar-vision/synthetic/train/views"
PHASE1 = _REPO / "tmp/gvprobe/std-ckpt/step1200/state.pt"
VARIANT = "FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED"


def _representation(model, page_subset, max_objects=128):
    batch = collate(page_subset, max_objects)
    batch = {k: (v.to("cpu") if torch.is_tensor(v) else v) for k, v in batch.items()}
    with torch.no_grad():
        model(batch)
        crops = roi_crops(model.features[0], batch["boxes"], batch["object_mask"], 8, 1.6)
        encoded = model.encoder(crops, batch["object_mask"], 8,
                                model.base.backbone.output_channels[0])
        p = model.roi_projection(encoded.flatten(-2))
    keep = (batch["object_type"][0] == 1).nonzero(as_tuple=True)[0].tolist()
    return p[0, keep].numpy()


@pytest.mark.xfail(
    strict=True,
    reason="known: padded planes enter the roi_crops tile softmax, so P is batch-dependent",
)
def test_representation_is_batch_invariant() -> None:
    """Fails today. Should pass once padded planes are excluded from the softmax."""
    if not PHASE1.exists() or not _RECORDS.exists():
        pytest.skip("phase-1 checkpoint or corpus not present")
    import argparse

    namespace = argparse.Namespace(
        variant=VARIANT, steps=1200, pages=40, batch_pages=1, held_out=20,
        image_size=256, max_objects=128, hidden=192, layers=4, lr=3e-3,
        train_jitter=0.35, roi_grid=8, roi_context=1.6, seed=11, device="cpu", out=None)
    model = build(VARIANT, namespace, Device("cpu"))
    model.load_state_dict(
        torch.load(PHASE1, map_location="cpu", weights_only=False)["model"])
    model.eval()

    # Page 1 has fewer planes than page 0 or 2 in this corpus, so batching it with a
    # longer page is what forces padding. Comparing page 0 against a longer batch would
    # show nothing, because page 0 already has the batch maximum.
    pages = load_dataset(_RECORDS, _VIEWS, size=(256, 256), limit=3)
    alone = _representation(model, pages[1:2])
    batched = _representation(model, pages[1:3])
    delta = float(np.abs(alone - batched).max())
    assert delta < 1e-4, (
        f"P differs by {delta:.3e} between a 1-page and a 2-page forward; padded planes "
        f"are still entering the tile softmax in roi_crops"
    )


def test_bug_is_still_present_and_measured() -> None:
    """The counterpart assertion: the delta is real, and roughly the recorded size.

    This one is expected to pass. It exists so the magnitude is recorded in the suite
    rather than only in a report, and so a change that quietly narrows or widens the
    effect is noticed.
    """
    if not PHASE1.exists() or not _RECORDS.exists():
        pytest.skip("phase-1 checkpoint or corpus not present")
    import argparse

    namespace = argparse.Namespace(
        variant=VARIANT, steps=1200, pages=40, batch_pages=1, held_out=20,
        image_size=256, max_objects=128, hidden=192, layers=4, lr=3e-3,
        train_jitter=0.35, roi_grid=8, roi_context=1.6, seed=11, device="cpu", out=None)
    model = build(VARIANT, namespace, Device("cpu"))
    model.load_state_dict(
        torch.load(PHASE1, map_location="cpu", weights_only=False)["model"])
    model.eval()

    pages = load_dataset(_RECORDS, _VIEWS, size=(256, 256), limit=3)
    alone = _representation(model, pages[1:2])
    batched = _representation(model, pages[1:3])
    delta = float(np.abs(alone - batched).max())
    assert delta > 1e-4, (
        "the batch-invariance bug no longer reproduces. If roi_crops was fixed, flip the "
        "xfail above to a normal test and update the module docstring in inference.py and "
        "the spec in docs/GUITAR_VISION_BATCH_INVARIANCE_FIX_SPEC.md."
    )
    assert 1e-3 < delta < 1.0, f"unexpected magnitude {delta:.3e}; investigate before trusting"