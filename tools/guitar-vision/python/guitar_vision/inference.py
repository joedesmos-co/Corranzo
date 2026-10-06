"""Production fret inference for Guitar Vision.

## What this is

The validated two-phase recipe, behind a loading and inference abstraction that a
runtime can depend on. It is not a training harness: nothing here trains, and the
experimental scripts under ``tools/guitar-vision/h*.py`` are deliberately not the
product API.

## The recipe it serves

    phase 1   joint training, unchanged
    phase 2   freeze the representation, take exact per-feature mean/std over the FIT
              fret rows, reinitialise ``fret_classifier``, train it alone

Inference is then::

    image -> backbone -> RoiEncoder -> roi_projection
          -> fixed train-stat standardisation -> phase-2 fret classifier

The standardisation statistics are read-only. They are never updated and never
recomputed from user input.

## One page per forward is enforced, and why

``roi_crops`` builds a tile dimension from ``plane_count // batch`` and softmaxes a
per-tile score across it. ``collate`` pads pages to the batch's maximum plane count,
and pages in this corpus carry between 7 and 29 planes, so **padded planes enter the
softmax** and the combined crop for a real object changes with whatever else shares its
batch. Measured on the validated phase-1 checkpoint: 1.12e-01 maximum change in ``P``
between a one-page and a three-page forward, moving 623 of 1162 objects.

That is a real bug in the model, not in this module, and it is not fixed here: fixing
it would change the phase-1 representation and invalidate the checkpoint the validated
numbers were measured against. Until it is fixed, the correct production contract is
one page per forward. :meth:`GuitarFretModel.infer` enforces that by looping, and
:meth:`GuitarFretModel.infer_batch` refuses anything longer than one page rather than
silently returning representations that depend on their batch neighbours.

## Legacy checkpoints

A checkpoint without the two-phase format marker keeps the behaviour of the variant
recorded in its own config. No statistics are fabricated, no standardisation is enabled,
and nothing is upgraded implicitly.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

import torch

from .dataset import collate
from .fret_experiments import (
    FretVariantModel,
    FrozenTrainStatsStandardizer,
    build,
    decode,
)
from .qualify import Device

#: Marker that identifies a checkpoint as carrying fixed phase-2 statistics.
TWO_PHASE_FORMAT = "guitar-vision-two-phase-v1"

#: Variants whose fret head reads a standardised ``P``.
STANDARDIZED_VARIANTS = (
    "FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED",
    "TWO_PHASE_STANDARDIZED",
)

_HEX64 = re.compile(r"^[0-9a-f]{64}$")


class CheckpointFormatError(RuntimeError):
    """A checkpoint claims the two-phase format but does not satisfy it."""


class MultiPageBatchError(RuntimeError):
    """A batched fret forward was requested with more than one page.

    Raised instead of quietly returning representations that depend on which other
    pages shared the batch. See the module docstring for the measurement.
    """


@dataclass(frozen=True)
class TwoPhaseMetadata:
    """Validated provenance and statistics for a two-phase checkpoint."""

    format: str
    variant: str
    phase1_sha256: str
    phase1_path: str
    phase1_step: int
    phase1_config: dict[str, Any]
    epsilon: float
    sample_count: float
    phase2_step: int
    split: dict[str, int]
    statistics_provenance: str
    extra: dict[str, Any] = field(default_factory=dict)

    REQUIRED = ("format", "variant", "source_phase1", "statistics", "split",
                "phase2_step")

    @classmethod
    def from_checkpoint(cls, payload: dict[str, Any], hidden: int) -> "TwoPhaseMetadata":
        missing = [key for key in cls.REQUIRED if key not in payload]
        if missing:
            raise CheckpointFormatError(
                f"two-phase checkpoint is missing required keys: {missing}")
        if payload["format"] != TWO_PHASE_FORMAT:
            raise CheckpointFormatError(
                f"unknown format {payload['format']!r}, expected {TWO_PHASE_FORMAT!r}")

        source = payload["source_phase1"]
        for key in ("sha256", "variant", "step", "path"):
            if key not in source:
                raise CheckpointFormatError(f"source_phase1 is missing {key!r}")
        digest = str(source["sha256"])
        if not _HEX64.match(digest):
            raise CheckpointFormatError(
                f"source_phase1.sha256 is not a 64-character hex digest: {digest!r}")

        statistics = payload["statistics"]
        for key in ("mean", "sigma", "count", "eps"):
            if key not in statistics:
                raise CheckpointFormatError(f"statistics is missing {key!r}")
        mean = torch.as_tensor(statistics["mean"])
        sigma = torch.as_tensor(statistics["sigma"])
        if mean.shape != (hidden,) or sigma.shape != (hidden,):
            raise CheckpointFormatError(
                f"statistics must be {hidden}-dimensional, got {tuple(mean.shape)} "
                f"and {tuple(sigma.shape)}")
        if not torch.isfinite(mean).all() or not torch.isfinite(sigma).all():
            raise CheckpointFormatError("statistics contain non-finite values")
        if float(sigma.min()) <= 0.0:
            raise CheckpointFormatError(
                f"sigma must be strictly positive, minimum is {float(sigma.min())}")
        epsilon = float(statistics["eps"])
        if not (0.0 < epsilon < 1.0):
            raise CheckpointFormatError(f"epsilon out of range: {epsilon}")
        count = float(statistics["count"])
        if count <= 0.0:
            raise CheckpointFormatError(f"sample count must be positive, got {count}")

        split = payload["split"]
        if not isinstance(split, dict) or "fit" not in split:
            raise CheckpointFormatError("split must be a mapping containing 'fit'")

        variant = str(payload["variant"])
        if variant not in STANDARDIZED_VARIANTS:
            raise CheckpointFormatError(
                f"variant {variant!r} is not a standardized variant")

        return cls(
            format=str(payload["format"]), variant=variant,
            phase1_sha256=digest, phase1_path=str(source["path"]),
            phase1_step=int(source["step"]), phase1_config=dict(source.get("config", {})),
            epsilon=epsilon, sample_count=count, phase2_step=int(payload["phase2_step"]),
            split={k: int(v) for k, v in split.items()},
            statistics_provenance=str(statistics.get("provenance", "unspecified")),
            extra={k: v for k, v in payload.items()
                   if k not in cls.REQUIRED + ("model",)},
        )


@dataclass
class PagePrediction:
    """Per-object outputs for one page, in the page's own object order."""

    fret: torch.Tensor
    fret_logits: torch.Tensor
    object_type: torch.Tensor
    string: torch.Tensor
    tile: torch.Tensor
    object_mask: torch.Tensor
    is_fret: torch.Tensor

    def fret_numbers(self) -> list[int]:
        """Predicted fret for each fret object, in order."""
        return self.fret[self.is_fret].tolist()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


#: QA interventions. These exist so that "does the model actually use the fret pixels?"
#: can be asked of the production path rather than of a copy of it. They are evaluation
#: instruments, not features: nothing in a normal request selects one.
INTERVENTIONS = ("blank", "wrong_roi", "pixel_ablation")


def _apply_intervention(batch: dict[str, torch.Tensor], mode: str) -> dict[str, torch.Tensor]:
    """Perturb a collated batch in one specific way.

    ``blank``
        White the whole page. Kills staff lines, noteheads and glyphs together, so a
        drop proves the model reads *something* visual, not that it reads the glyph.
    ``wrong_roi``
        Move every fret box onto another fret's glyph on the same page. Labels and
        geometry survive; the pixels under the box do not.
    ``pixel_ablation``
        White only the pixels inside each fret box, leaving the page intact. This is
        the sharpest control: the glyph is gone but its staff line, its neighbours and
        its coordinates all remain, so a drop can only be the glyph.

    Boxes are in normalised ``[0, 1]`` page coordinates, not pixels. An earlier
    implementation of the ablation read them as pixel indices, floored every coordinate
    to 0 or 1, and ablated two pixels of a 1.5-million-pixel page. It measured as
    "ablation changes nothing", which is a no-op's signature and not a finding.
    """
    if mode not in INTERVENTIONS:
        raise ValueError(f"unknown intervention {mode!r}; expected one of {INTERVENTIONS}")
    out = dict(batch)
    if mode == "blank":
        out["images"] = torch.ones_like(batch["images"])
        return out

    boxes = batch["boxes"]
    is_fret = batch["object_mask"] & (batch["object_type"] == 1)
    if mode == "wrong_roi":
        shifted = boxes.clone()
        for page in range(boxes.shape[0]):
            rows = is_fret[page].nonzero(as_tuple=True)[0]
            if rows.numel() < 2:
                continue
            shifted[page, rows] = boxes[page, rows][torch.roll(torch.arange(rows.numel()), 1)]
        out["boxes"] = shifted
        return out

    images = batch["images"].clone()
    height, width = images.shape[-2:]
    for page in range(images.shape[0]):
        for row in is_fret[page].nonzero(as_tuple=True)[0].tolist():
            x0, y0, x1, y1 = boxes[page, row].tolist()
            lo_x = max(0, min(width, int(round(x0 * width))))
            hi_x = max(0, min(width, int(round(x1 * width))))
            lo_y = max(0, min(height, int(round(y0 * height))))
            hi_y = max(0, min(height, int(round(y1 * height))))
            if hi_x > lo_x and hi_y > lo_y:
                images[page, :, :, lo_y:hi_y, lo_x:hi_x] = 1.0
    out["images"] = images
    return out


class GuitarFretModel:
    """Loaded Guitar fret model with a page-at-a-time inference contract.

    Obtain one with :meth:`load`. The class does not expose a constructor that takes a
    live module, so a caller cannot accidentally hand it a model whose variant does not
    match the checkpoint's recorded behaviour.
    """

    def __init__(
        self,
        model: FretVariantModel,
        device: Device,
        *,
        metadata: TwoPhaseMetadata | None,
        checkpoint_path: Path,
        checkpoint_sha256: str,
        variant: str,
    ) -> None:
        self._model = model
        self._device = device
        self.metadata = metadata
        self.checkpoint_path = checkpoint_path
        self.checkpoint_sha256 = checkpoint_sha256
        self.variant = variant
        self._model.eval()
        for parameter in self._model.parameters():
            parameter.requires_grad_(False)

    # ---------------------------------------------------------------- loading

    @classmethod
    def load(cls, checkpoint: str | Path, device: str | Device = "cpu") -> "GuitarFretModel":
        """Load a two-phase or legacy checkpoint.

        A checkpoint carrying the two-phase marker is validated strictly and its stored
        statistics are used. Any other checkpoint is loaded under the variant recorded
        in its own config, with no statistics invented and no standardisation enabled.
        """
        path = Path(checkpoint)
        if not path.exists():
            raise FileNotFoundError(path)
        resolved_device = device if isinstance(device, Device) else Device(device)
        payload = torch.load(path, map_location="cpu", weights_only=False)
        if "model" not in payload:
            raise CheckpointFormatError(f"{path} has no 'model' state_dict")
        config = dict(payload.get("config", {}))
        variant = str(config.get("variant") or payload.get("variant") or "")
        if not variant:
            raise CheckpointFormatError(f"{path} does not record a variant")

        # A checkpoint that declares a format we do not know is an error, not a legacy
        # checkpoint. Treating an unrecognised marker as legacy would silently ignore a
        # newer file's statistics, which is the failure this guard exists to prevent.
        if "format" in payload and payload["format"] != TWO_PHASE_FORMAT:
            raise CheckpointFormatError(
                f"{path} declares unknown format {payload['format']!r}, expected "
                f"{TWO_PHASE_FORMAT!r} or no format key at all")
        two_phase = payload.get("format") == TWO_PHASE_FORMAT
        namespace = argparse.Namespace(
            variant=variant,
            steps=int(payload.get("phase2_step", payload.get("step", 1200)) or 1200),
            pages=40, batch_pages=1, held_out=20,
            image_size=int(config.get("image_size", 256)),
            max_objects=int(config.get("max_objects", 128)),
            hidden=int(config.get("hidden", 192)),
            layers=int(config.get("layers", 4)),
            lr=3e-3, train_jitter=0.35,
            roi_grid=int(config.get("roi_grid", 8)),
            roi_context=float(config.get("roi_context", 1.6)),
            seed=int(config.get("seed", 11)), device=str(resolved_device.name), out=None,
        )

        if two_phase:
            metadata = TwoPhaseMetadata.from_checkpoint(payload, namespace.hidden)
            if metadata.variant != variant:
                raise CheckpointFormatError(
                    f"payload variant {variant!r} disagrees with metadata "
                    f"{metadata.variant!r}")
        else:
            metadata = None

        model = build(variant, namespace, resolved_device)
        model.load_state_dict(payload["model"])
        model.eval()

        # Read-only statistics: assert the type, and assert nothing can write to it.
        if two_phase:
            standardizer = getattr(model, "p_standardizer", None)
            if not isinstance(standardizer, FrozenTrainStatsStandardizer):
                raise CheckpointFormatError(
                    f"two-phase checkpoint's standardizer is "
                    f"{type(standardizer).__name__}, expected "
                    f"FrozenTrainStatsStandardizer")
            expected_mean = torch.as_tensor(payload["statistics"]["mean"]).double()
            expected_sigma = torch.as_tensor(payload["statistics"]["sigma"]).double()
            if not torch.equal(standardizer.mean, expected_mean):
                raise CheckpointFormatError("loaded mean does not match the checkpoint")
            if not torch.equal(standardizer.sigma, expected_sigma):
                raise CheckpointFormatError("loaded sigma does not match the checkpoint")

        return cls(model, resolved_device, metadata=metadata,
                   checkpoint_path=path, checkpoint_sha256=_sha256(path), variant=variant)

    # -------------------------------------------------------------- inference

    @property
    def two_phase(self) -> bool:
        return self.metadata is not None

    def statistics(self) -> dict[str, Any]:
        """A copy of the fixed statistics, or an empty dict for a legacy checkpoint."""
        if self.metadata is None:
            return {}
        standardizer = self._model.p_standardizer
        return {
            "mean": standardizer.mean.clone(),
            "sigma": standardizer.sigma.clone(),
            "epsilon": float(standardizer.eps.item()),
            "sample_count": float(standardizer.count.item()),
        }

    def _forward_one_page(
        self, page: dict[str, torch.Tensor], intervention: str | None = None
    ) -> PagePrediction:
        batch = collate([page], self._max_objects())
        if intervention is not None:
            batch = _apply_intervention(batch, intervention)
        batch = {k: (v.to(self._device.torch) if torch.is_tensor(v) else v)
                 for k, v in batch.items()}
        with torch.no_grad():
            out = self._model(batch)
        # `collate` pads every page to `max_objects`; a page's prediction should
        # describe that page's objects, not the padding. `object_counts` carries the
        # real count and is the only thing that distinguishes a genuine slot from a
        # padded one once the mask has been built.
        count = int(batch["object_counts"][0])
        return PagePrediction(
            fret=decode(out)[0][:count],
            fret_logits=out["fret"][0][:count],
            object_type=out["object_type"][0].argmax(-1)[:count],
            string=out["string"][0].argmax(-1)[:count],
            tile=out["tile"][0].argmax(-1)[:count],
            object_mask=batch["object_mask"][0][:count],
            is_fret=(batch["object_mask"][0][:count]
                     & (batch["object_type"][0][:count] == 1)),
        )

    def _max_objects(self) -> int:
        return int(self._model.base.config.max_objects)

    def infer_page(
        self, page: dict[str, torch.Tensor], intervention: str | None = None
    ) -> PagePrediction:
        """Run exactly one page. This is the only supported granularity.

        ``intervention`` is a QA hook for the pixel-causality controls; see
        :data:`INTERVENTIONS`. It is never set by a normal request.
        """
        return self._forward_one_page(page, intervention)

    def infer_batch(self, pages: Sequence[dict[str, torch.Tensor]]) -> list[PagePrediction]:
        """Explicit invariant: batching more than one page is refused.

        The name is deliberately unattractive. There is no supported batched fret
        forward, because the model's representation is not batch-invariant, so this
        raises rather than returning something whose meaning depends on the batch.
        """
        if len(pages) != 1:
            raise MultiPageBatchError(
                f"the fret path is not batch-invariant; got {len(pages)} pages. Use "
                f"infer(), which runs one page at a time, or fix the padded-plane "
                f"softmax in roi_crops first."
            )
        return [self._forward_one_page(pages[0])]

    def infer(
        self, pages: Sequence[dict[str, torch.Tensor]], intervention: str | None = None
    ) -> list[PagePrediction]:
        """Run every page, one at a time, and return them in the input order.

        The page-at-a-time loop is the correctness contract, not an optimisation that
        can be lifted later without revalidating: see the module docstring.
        """
        return [self._forward_one_page(page, intervention) for page in pages]

    # ------------------------------------------------------------------ stats

    def describe(self) -> dict[str, Any]:
        return {
            "variant": self.variant,
            "two_phase": self.two_phase,
            "checkpoint": str(self.checkpoint_path),
            "checkpoint_sha256": self.checkpoint_sha256,
            "metadata": None if self.metadata is None else {
                "format": self.metadata.format,
                "phase1_sha256": self.metadata.phase1_sha256,
                "phase1_step": self.metadata.phase1_step,
                "phase2_step": self.metadata.phase2_step,
                "epsilon": self.metadata.epsilon,
                "sample_count": self.metadata.sample_count,
                "split": self.metadata.split,
                "statistics_provenance": self.metadata.statistics_provenance,
            },
        }


def load(path: str | Path, device: str | Device = "cpu") -> GuitarFretModel:
    """Module-level convenience wrapper around :meth:`GuitarFretModel.load`."""
    return GuitarFretModel.load(path, device)


__all__ = [
    "TWO_PHASE_FORMAT",
    "INTERVENTIONS",
    "STANDARDIZED_VARIANTS",
    "CheckpointFormatError",
    "MultiPageBatchError",
    "TwoPhaseMetadata",
    "PagePrediction",
    "GuitarFretModel",
    "load",
]