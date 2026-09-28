"""Configuration loading, validation, freezing, and stable digests."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from pathlib import Path


MODEL_PRESETS = {
    "tiny": {
        "variant": "tiny",
        "visual_channels": [24, 48, 96],
        "visual_blocks": [1, 2, 2],
        "hidden_dim": 128,
        "graph_layers": 2,
        "attention_heads": 4,
        "ffn_multiplier": 2,
        "dropout": 0.08,
    },
    "small": {
        "variant": "small",
        "visual_channels": [32, 64, 128],
        "visual_blocks": [2, 2, 3],
        "hidden_dim": 192,
        "graph_layers": 4,
        "attention_heads": 6,
        "ffn_multiplier": 3,
        "dropout": 0.10,
    },
    "base": {
        "variant": "base",
        "visual_channels": [48, 96, 192],
        "visual_blocks": [2, 3, 4],
        "hidden_dim": 256,
        "graph_layers": 6,
        "attention_heads": 8,
        "ffn_multiplier": 3,
        "dropout": 0.10,
    },
}


DEFAULTS = {
    "schema_version": 1,
    "model_id": "corranzo-piano-vision-v1",
    "frozen": False,
    "model": {
        **MODEL_PRESETS["tiny"],
        "image_channels": 1,
        "object_feature_dim": 24,
        "graph_feature_dim": 16,
        "source_feature_dim": 16,
        "relation_feature_dim": 12,
        "staff_step_classes": 33,
    },
    "data": {
        "image_height": 192,
        "image_width": 512,
        "context_scopes": 1,
        "max_objects": 64,
        "max_relations": 256,
        "shuffle_buffer": 32,
        "verify_hashes": False,
        "allow_synthetic_pixels": False,
    },
    "training": {
        "seed": 21401,
        "epochs": 40,
        "batch_size": 2,
        "validation_batch_size": 2,
        "num_workers": 0,
        "prefetch_factor": 1,
        "persistent_workers": False,
        "gradient_accumulation": 8,
        "gradient_clip_norm": 1.0,
        "learning_rate": 0.0003,
        "weight_decay": 0.0001,
        "warmup_steps": 500,
        "minimum_lr_ratio": 0.05,
        "mixed_precision": "auto",
        "checkpoint_every_steps": 1000,
        "keep_periodic_checkpoints": 3,
        "early_stopping_patience": 8,
        "early_stopping_min_delta": 0.0001,
        "early_stopping_min_epochs": 0,
        "milestones": [1, 2, 5, 10, 20, 40],
        "stop_after_epoch": 0,
        "loss_explosion_factor": 8.0,
        "max_steps": None,
        "max_validation_batches": None,
        "validate_every_steps": None,
        "device": "auto",
    },
    "loss": {
        "label_smoothing": 0.02,
        "focal_gamma": 1.5,
        "rare_positive_cap": 12.0,
        "family_weights": {
            "pitch": 2.0,
            "duration": 1.7,
            "attack": 1.3,
            "chord": 1.3,
            "lane": 1.4,
            "lane_continuation": 1.4,
            "rest": 1.1,
            "tuplet": 2.0,
            "tie": 2.2,
            "cross_staff": 2.2,
            "shared_head": 2.2,
            "auxiliary": 0.35,
            "scope": 0.5,
        },
    },
    "uncertainty": {
        "offer_threshold": 0.72,
        "complete_threshold": 0.82,
        "top_k": 3,
        "wrong_complete_cost": 5.0,
    },
}


def _merge(base, override):
    result = deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _merge(result[key], value)
        else:
            result[key] = deepcopy(value)
    return result


def model_config(variant: str = "tiny", **overrides):
    if variant not in MODEL_PRESETS:
        raise ValueError(f"Unknown model variant: {variant}")
    value = _merge(DEFAULTS["model"], MODEL_PRESETS[variant])
    return _merge(value, overrides)


def validate_config(config):
    if config.get("schema_version") != 1:
        raise ValueError("Only Piano Vision config schema_version=1 is supported")
    variant = config["model"].get("variant")
    if variant not in MODEL_PRESETS:
        raise ValueError(f"Invalid model variant: {variant}")
    hidden = int(config["model"]["hidden_dim"])
    heads = int(config["model"]["attention_heads"])
    if hidden % heads:
        raise ValueError("hidden_dim must be divisible by attention_heads")
    if int(config["data"]["max_objects"]) < 2 or int(config["data"]["max_relations"]) < 1:
        raise ValueError("max_objects and max_relations are too small")
    if int(config["training"]["gradient_accumulation"]) < 1:
        raise ValueError("gradient_accumulation must be positive")
    if config["training"]["mixed_precision"] not in {"auto", "off", "fp16", "bf16"}:
        raise ValueError("mixed_precision must be auto, off, fp16, or bf16")
    milestones = list(config["training"].get("milestones") or [])
    if not all(isinstance(m, int) and m >= 1 for m in milestones) or milestones != sorted(milestones):
        raise ValueError("training.milestones must be strictly increasing positive epochs")
    if int(config["training"].get("stop_after_epoch", 0)) < 0:
        raise ValueError("training.stop_after_epoch must be >= 0 (0 disables milestone stopping)")
    return config


def load_config(path: Path | str | None = None, overrides=None):
    payload = {}
    if path is not None:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    variant = payload.get("model", {}).get("variant", DEFAULTS["model"]["variant"])
    base = deepcopy(DEFAULTS)
    base["model"] = model_config(variant)
    return validate_config(_merge(_merge(base, payload), overrides or {}))


def canonical_config(config):
    return json.dumps(config, sort_keys=True, separators=(",", ":"), allow_nan=False)


def config_digest(config):
    return hashlib.sha256(canonical_config(config).encode("utf-8")).hexdigest()


def freeze_config(config, path: Path):
    frozen = deepcopy(config)
    frozen["frozen"] = True
    frozen["config_digest"] = config_digest({key: value for key, value in frozen.items() if key != "config_digest"})
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".partial")
    partial.write_text(json.dumps(frozen, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    partial.replace(path)
    return frozen
