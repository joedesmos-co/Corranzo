"""Production fret inference for Guitar Vision.

## What this is

Validated Guitar fret recipes, behind a loading and inference abstraction that a
runtime can depend on: the two-phase representation recipe and the dedicated raw-ROI
fret branch. It is not a training harness: nothing here trains, and the experimental
scripts under ``tools/guitar-vision/h*.py`` are deliberately not the product API.

## The recipes it serves

Two-phase representation:

    phase 1   joint training, unchanged
    phase 2   freeze the representation, take exact per-feature mean/std over the FIT
              fret rows, reinitialise ``fret_classifier``, train it alone

Dedicated raw-ROI fret branch:

    canonical FINAL_ROI
    -> 32x32 grayscale
    -> Conv(1,32,3)-BN-ReLU
    -> Conv(32,64,3)-BN-ReLU
    -> Conv(64,128,3)-BN-ReLU
    -> global average pooling
    -> Linear(128,26)

For the dedicated branch, the shared model continues to produce the unrelated tasks,
while the fret number comes from the raw crop. No shared token, encoder
representation, projection, or shared fusion contributes to that fret output.

The two-phase standardisation statistics are read-only. They are never updated and never
recomputed from user input.

## One page per forward is enforced, and why

The shared ``roi_crops`` representation builds a tile dimension from
``plane_count // batch`` and softmaxes a per-tile score across it. ``collate`` pads
pages to the batch's maximum plane count, and pages in this corpus carry between 7 and
29 planes, so **padded planes enter the softmax** and the combined crop for a real
object changes with whatever else shares its batch. Measured on the validated phase-1
checkpoint: 1.12e-01 maximum change in ``P`` between a one-page and a three-page
forward, moving 623 of 1162 objects.

That is a real bug in the shared model path, not in this module, and it is not fixed
here: fixing it would change the phase-1 representation and invalidate the checkpoint
the validated numbers were measured against. Until it is fixed, the correct production
contract for every full-model forward is one page at a time.
:meth:`GuitarFretModel.infer` enforces that by looping, and
:meth:`GuitarFretModel.infer_batch` refuses anything longer than one page rather than
silently returning representations that depend on their batch neighbours. The dedicated
raw-ROI crop itself is separately tested to be batch invariant, but full-model inference
retains the conservative one-page contract because the shared backbone and heads use the
same forward.

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
from .roi import (
    ROI_ARCHITECTURE_NAME,
    ROI_ARCHITECTURE_VERSION,
    ROI_CONTEXT,
    ROI_CROP,
    ROI_EXTRACTION_NAME,
    ROI_EXTRACTION_VERSION,
    ROI_VOCABULARY_NAME,
    ROI_VOCABULARY_VERSION,
    RoiFretCnn,
)

#: Marker that identifies a checkpoint as carrying fixed phase-2 statistics.
TWO_PHASE_FORMAT = "guitar-vision-two-phase-v1"

#: Marker that identifies a production checkpoint for the dedicated raw-ROI fret branch.
DEDICATED_ROI_FORMAT = "guitar-vision-dedicated-roi-v1"
DEDICATED_ROI_FORMAT_VERSION = 1
DEDICATED_ROI_KIND = "DEDICATED_ROI_FRET"
DEDICATED_FRET_MODEL = "guitar-fret-dedicated-roi/1.0"

#: Formats this loader understands. A declared format outside this set is rejected rather
#: than silently treated as legacy.
KNOWN_FORMATS = (TWO_PHASE_FORMAT, DEDICATED_ROI_FORMAT)

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


def _validate_dedicated_implementation(
    model: FretVariantModel, metadata: "DedicatedRoiMetadata"
) -> None:
    """Require the declared CNN to be the implementation that actually loaded."""
    head = getattr(model, "roi_head", None)
    if not isinstance(head, RoiFretCnn):
        raise CheckpointFormatError(
            f"dedicated checkpoint's fret branch is {type(head).__name__}, expected "
            f"RoiFretCnn")
    widths = tuple(module.out_channels for module in head.body
                   if isinstance(module, torch.nn.Conv2d))
    if widths != (32, 64, 128) or head.head.out_features != 26:
        raise CheckpointFormatError(
            f"loaded CNN has widths {widths} and {head.head.out_features} outputs, "
            f"not the validated (32, 64, 128) and 26")
    actual_parameters = sum(parameter.numel() for parameter in head.parameters())
    if actual_parameters != metadata.head_parameter_count:
        raise CheckpointFormatError(
            f"loaded CNN has {actual_parameters:,} parameters, but the checkpoint "
            f"declares {metadata.head_parameter_count:,}")


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


@dataclass(frozen=True)
class DedicatedRoiMetadata:
    """Validated provenance for a dedicated raw-ROI fret checkpoint."""
    format: str
    format_version: int
    variant: str
    architecture_name: str
    architecture_version: str
    extraction_name: str
    extraction_version: str
    output_classes: int
    head_parameter_count: int
    seed: int
    steps: int
    batch: int
    optimizer: str
    learning_rate: float
    weight_decay: float
    schedule: str
    split: dict[str, int]
    held_score_ids: tuple[str, ...]
    model_config: dict[str, Any]
    experiment_commit: str
    source_phase1_path: str
    source_phase1_sha256: str
    source_phase1_step: int
    source_phase1_variant: str
    source_head_checkpoint: str
    source_head_sha256: str
    vocabulary: dict[str, Any]
    extra: dict[str, Any] = field(default_factory=dict)

    REQUIRED = ("format", "format_version", "variant", "architecture", "roi_extraction",
                "model", "model_config", "training", "vocabulary", "provenance")

    @classmethod
    def from_checkpoint(cls, payload: dict[str, Any]) -> "DedicatedRoiMetadata":
        missing = [key for key in cls.REQUIRED if key not in payload]
        if missing:
            raise CheckpointFormatError(
                f"dedicated-ROI checkpoint is missing required keys: {missing}")
        if payload["format"] != DEDICATED_ROI_FORMAT:
            raise CheckpointFormatError(
                f"unknown format {payload['format']!r}, expected {DEDICATED_ROI_FORMAT!r}")
        if payload["format_version"] != DEDICATED_ROI_FORMAT_VERSION:
            raise CheckpointFormatError(
                f"unsupported dedicated-ROI format version {payload['format_version']!r}")
        variant = str(payload["variant"])
        if variant != DEDICATED_ROI_KIND:
            raise CheckpointFormatError(
                f"variant {variant!r} is not the dedicated raw-ROI fret variant")

        architecture = payload["architecture"]
        for key in ("name", "version", "input_channels", "crop", "widths",
                    "spatial_pooling", "output_classes", "parameter_count"):
            if key not in architecture:
                raise CheckpointFormatError(f"architecture is missing {key!r}")
        if (architecture["name"] != ROI_ARCHITECTURE_NAME
                or architecture["version"] != ROI_ARCHITECTURE_VERSION):
            raise CheckpointFormatError(
                f"architecture {architecture['name']!r} "
                f"version {architecture['version']!r} is not the validated "
                f"{ROI_ARCHITECTURE_NAME} {ROI_ARCHITECTURE_VERSION}")
        if (architecture["input_channels"] != 1 or architecture["crop"] != ROI_CROP
                or tuple(architecture["widths"]) != (32, 64, 128)
                or architecture["spatial_pooling"] != "AdaptiveAvgPool2d(1)->Flatten"
                or architecture["output_classes"] != 26
                or architecture["parameter_count"] != 96_474):
            raise CheckpointFormatError(
                f"architecture declaration does not match the validated CNN: {architecture!r}")

        extraction = payload["roi_extraction"]
        for key in ("name", "version", "crop", "context", "interpolation",
                    "align_corners", "padding_mode"):
            if key not in extraction:
                raise CheckpointFormatError(f"roi_extraction is missing {key!r}")
        if (extraction["name"] != ROI_EXTRACTION_NAME
                or extraction["version"] != ROI_EXTRACTION_VERSION
                or extraction["crop"] != ROI_CROP
                or float(extraction["context"]) != ROI_CONTEXT
                or extraction["interpolation"] != "bilinear"
                or extraction["align_corners"] is not False
                or extraction["padding_mode"] != "zeros"):
            raise CheckpointFormatError(
                f"ROI extraction declaration does not match the validated sampler: "
                f"{extraction!r}")

        model = payload["model"]
        if not isinstance(model, dict) or not model:
            raise CheckpointFormatError("model state_dict is missing or empty")

        model_config = payload["model_config"]
        for key in ("image_size", "max_objects", "hidden", "layers", "roi_grid",
                    "roi_context"):
            if key not in model_config:
                raise CheckpointFormatError(f"model_config is missing {key!r}")
        model_config = {key: model_config[key] for key in
                        ("image_size", "max_objects", "hidden", "layers", "roi_grid",
                         "roi_context")}

        training = payload["training"]
        model_config = {
            "image_size": int(model_config["image_size"]),
            "max_objects": int(model_config["max_objects"]),
            "hidden": int(model_config["hidden"]),
            "layers": int(model_config["layers"]),
            "roi_grid": int(model_config["roi_grid"]),
            "roi_context": float(model_config["roi_context"]),
        }
        if (model_config["image_size"] <= 0 or model_config["max_objects"] <= 0
                or model_config["hidden"] <= 0 or model_config["layers"] <= 0
                or model_config["roi_grid"] <= 0 or model_config["roi_context"] <= 0.0):
            raise CheckpointFormatError(
                f"model_config is not usable: {model_config!r}")
        for key in ("seed", "steps", "batch", "optimizer", "learning_rate",
                    "weight_decay", "schedule", "split", "split_scores",
                    "experiment_commit", "source_phase1", "source_head_checkpoint",
                    "reference_metrics"):
            if key not in training:
                raise CheckpointFormatError(f"training is missing {key!r}")
        split = training["split"]
        if (not isinstance(split, dict)
                or {k: int(v) for k, v in split.items()}
                != {"fit": 614, "same_score": 153, "score_disjoint": 395}):
            raise CheckpointFormatError(
                f"split does not match the validated 614/153/395 partition: {split!r}")
        split_scores = training["split_scores"]
        for key in ("train", "held_out"):
            if key not in split_scores or not isinstance(split_scores[key], list):
                raise CheckpointFormatError(f"split_scores is missing list {key!r}")
        held_scores = tuple(split_scores["held_out"])
        train_scores = tuple(split_scores["train"])
        if (len(held_scores) != 20 or len(set(held_scores)) != 20
                or len(train_scores) != 40 or len(set(train_scores)) != 40):
            raise CheckpointFormatError(
                "split-score provenance does not contain 40 unique train scores and "
                "20 unique held-out scores")
        if set(held_scores) & set(train_scores):
            raise CheckpointFormatError("train and held-out score IDs must be disjoint")
        experiment_commit = str(training["experiment_commit"])
        if not re.fullmatch(r"[0-9a-f]{40}", experiment_commit):
            raise CheckpointFormatError(
                f"experiment_commit is not a 40-character hex digest: {experiment_commit!r}")

        phase1 = training["source_phase1"]
        for key in ("path", "sha256", "step", "variant"):
            if key not in phase1:
                raise CheckpointFormatError(f"source_phase1 is missing {key!r}")
        if not _HEX64.match(str(phase1["sha256"])):
            raise CheckpointFormatError(
                f"source_phase1.sha256 is not a 64-character hex digest: {phase1['sha256']!r}")
        head_source = training["source_head_checkpoint"]
        for key in ("path", "sha256"):
            if key not in head_source:
                raise CheckpointFormatError(f"source_head_checkpoint is missing {key!r}")
        if not _HEX64.match(str(head_source["sha256"])):
            raise CheckpointFormatError(
                f"source_head_checkpoint.sha256 is not a hex digest: "
                f"{head_source['sha256']!r}")

        vocabulary = payload["vocabulary"]
        for key in ("name", "version", "classes", "represented", "unused", "semantics"):
            if key not in vocabulary:
                raise CheckpointFormatError(f"vocabulary is missing {key!r}")
        if (vocabulary["name"] != ROI_VOCABULARY_NAME
                or vocabulary["version"] != ROI_VOCABULARY_VERSION
                or vocabulary["classes"] != 26
                or list(vocabulary["represented"]) != list(range(20))
                or list(vocabulary["unused"]) != [20, 21, 22, 23, 24, 25]):
            raise CheckpointFormatError(
                f"vocabulary declaration does not match the validated output: "
                f"{vocabulary!r}")

        return cls(
            format=str(payload["format"]), format_version=int(payload["format_version"]),
            variant=variant, architecture_name=str(architecture["name"]),
            architecture_version=str(architecture["version"]),
            extraction_name=str(extraction["name"]),
            extraction_version=str(extraction["version"]),
            output_classes=int(architecture["output_classes"]),
            head_parameter_count=int(architecture["parameter_count"]),
            seed=int(training["seed"]), steps=int(training["steps"]),
            batch=int(training["batch"]), optimizer=str(training["optimizer"]),
            learning_rate=float(training["learning_rate"]),
            weight_decay=float(training["weight_decay"]),
            schedule=str(training["schedule"]),
            split={key: int(value) for key, value in split.items()},
            held_score_ids=tuple(str(score) for score in held_scores),
            model_config=model_config,
            experiment_commit=experiment_commit,
            source_phase1_path=str(phase1["path"]),
            source_phase1_sha256=str(phase1["sha256"]),
            source_phase1_step=int(phase1["step"]),
            source_phase1_variant=str(phase1["variant"]),
            source_head_checkpoint=str(head_source["path"]),
            source_head_sha256=str(head_source["sha256"]),
            vocabulary={key: vocabulary[key] for key in
                        ("name", "version", "classes", "represented", "unused", "semantics")},
            extra={key: value for key, value in payload.items()
                   if key not in cls.REQUIRED},
        )

    def public_dict(self) -> dict[str, Any]:
        """Serializable metadata, with no tensors."""
        return {
            "format": self.format,
            "format_version": self.format_version,
            "variant": self.variant,
            "fret_model": DEDICATED_FRET_MODEL,
            "architecture": {
                "name": self.architecture_name,
                "version": self.architecture_version,
                "output_classes": self.output_classes,
                "parameter_count": self.head_parameter_count,
            },
            "roi_extraction": {
                "name": self.extraction_name,
                "version": self.extraction_version,
            },
            "training": {
                "seed": self.seed,
                "steps": self.steps,
                "batch": self.batch,
                "optimizer": self.optimizer,
                "learning_rate": self.learning_rate,
                "weight_decay": self.weight_decay,
                "schedule": self.schedule,
                "split": dict(self.split),
                "held_score_ids": list(self.held_score_ids),
            },
            "model_config": dict(self.model_config),
            "vocabulary": dict(self.vocabulary),
            "experiment_commit": self.experiment_commit,
            "source_phase1_sha256": self.source_phase1_sha256,
            "source_head_sha256": self.source_head_sha256,
        }


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
        metadata: TwoPhaseMetadata | DedicatedRoiMetadata | None,
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
        """Load a dedicated, two-phase, or legacy checkpoint.

        A checkpoint carrying a recognised marker is validated strictly and its stored
        behaviour is used. Any other checkpoint is loaded under the variant recorded
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
        # newer file's statistics or fret branch, which is the failure this guard exists
        # to prevent.
        if "format" in payload and payload["format"] not in KNOWN_FORMATS:
            raise CheckpointFormatError(
                f"{path} declares unknown format {payload['format']!r}, expected one of "
                f"{KNOWN_FORMATS!r} or no format key at all")
        two_phase = payload.get("format") == TWO_PHASE_FORMAT
        dedicated = payload.get("format") == DEDICATED_ROI_FORMAT
        if dedicated:
            metadata = DedicatedRoiMetadata.from_checkpoint(payload)
            model_config = dict(metadata.model_config)
            namespace = argparse.Namespace(
                variant=variant,
                steps=int(metadata.steps),
                pages=40, batch_pages=1, held_out=20,
                image_size=int(model_config["image_size"]),
                max_objects=int(model_config["max_objects"]),
                hidden=int(model_config["hidden"]),
                layers=int(model_config["layers"]),
                lr=3e-3, train_jitter=0.35,
                roi_grid=int(model_config["roi_grid"]),
                roi_context=float(model_config["roi_context"]),
                seed=int(metadata.seed), device=str(resolved_device.name), out=None,
            )
        else:
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
        elif dedicated:
            metadata = DedicatedRoiMetadata.from_checkpoint(payload)
            if metadata.variant != variant:
                raise CheckpointFormatError(
                    f"payload variant {variant!r} disagrees with metadata "
                    f"{metadata.variant!r}")
        else:
            metadata = None

        model = build(variant, namespace, resolved_device)
        model.load_state_dict(payload["model"])
        model.eval()
        if dedicated:
            _validate_dedicated_implementation(model, metadata)

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
        return isinstance(self.metadata, TwoPhaseMetadata)

    @property
    def dedicated(self) -> bool:
        """Whether this is the dedicated raw-ROI fret path."""
        return isinstance(self.metadata, DedicatedRoiMetadata)

    @property
    def fret_path(self) -> str:
        """The validated fret behaviour selected by the checkpoint."""
        if self.dedicated:
            return "dedicated-raw-roi"
        if self.two_phase:
            return "shared-two-phase"
        return "legacy"

    def statistics(self) -> dict[str, Any]:
        """A copy of the fixed two-phase statistics, if present.

        Dedicated and legacy checkpoints do not use a ``P`` standardizer, so for them
        this remains empty rather than inventing values.
        """
        if not isinstance(self.metadata, TwoPhaseMetadata):
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
        if isinstance(self.metadata, TwoPhaseMetadata):
            metadata: dict[str, Any] | None = {
                "format": self.metadata.format,
                "phase1_sha256": self.metadata.phase1_sha256,
                "phase1_step": self.metadata.phase1_step,
                "phase2_step": self.metadata.phase2_step,
                "epsilon": self.metadata.epsilon,
                "sample_count": self.metadata.sample_count,
                "split": self.metadata.split,
                "statistics_provenance": self.metadata.statistics_provenance,
            }
        elif isinstance(self.metadata, DedicatedRoiMetadata):
            metadata = self.metadata.public_dict()
        else:
            metadata = None
        return {
            "variant": self.variant,
            "two_phase": self.two_phase,
            "dedicated": self.dedicated,
            "fret_path": self.fret_path,
            "checkpoint": str(self.checkpoint_path),
            "checkpoint_sha256": self.checkpoint_sha256,
            "metadata": metadata,
        }


def load(path: str | Path, device: str | Device = "cpu") -> GuitarFretModel:
    """Module-level convenience wrapper around :meth:`GuitarFretModel.load`."""
    return GuitarFretModel.load(path, device)


__all__ = [
    "TWO_PHASE_FORMAT",
    "DEDICATED_ROI_FORMAT",
    "DEDICATED_ROI_FORMAT_VERSION",
    "DEDICATED_ROI_KIND",
    "DEDICATED_FRET_MODEL",
    "KNOWN_FORMATS",
    "INTERVENTIONS",
    "STANDARDIZED_VARIANTS",
    "CheckpointFormatError",
    "MultiPageBatchError",
    "TwoPhaseMetadata",
    "DedicatedRoiMetadata",
    "PagePrediction",
    "GuitarFretModel",
    "load",
]