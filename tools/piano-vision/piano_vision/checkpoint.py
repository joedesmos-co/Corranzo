"""Crash-safe full-state checkpoint save and resume."""

from __future__ import annotations

import json
import os
import random
from copy import deepcopy
from pathlib import Path

import numpy as np
import torch

from piano_vision.config import config_digest


def _atomic_json(path: Path, value):
    partial = path.with_suffix(path.suffix + ".partial")
    partial.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(partial, path)


def _strip_config_keys(config, keys):
    config = deepcopy(config)
    for key in keys:
        parts = key.split(".")
        node = config
        for head in parts[:-1]:
            child = node.get(head)
            if not isinstance(child, dict):
                node = None
                break
            node = child
        if node is not None:
            node.pop(parts[-1], None)
    return config


def _config_relaxed_ok(stored_config, expected_config, relax_keys):
    if not isinstance(stored_config, dict) or not isinstance(expected_config, dict):
        return False
    try:
        stripped_stored = _strip_config_keys(stored_config, list(relax_keys))
        stripped_expected = _strip_config_keys(expected_config, list(relax_keys))
        return config_digest(stripped_stored) == config_digest(stripped_expected)
    except Exception:
        return False


def capture_rng_state():
    state = {
        "python": random.getstate(),
        "numpy": np.random.get_state(),
        "torch": torch.get_rng_state(),
    }
    if torch.cuda.is_available():
        state["cuda"] = torch.cuda.get_rng_state_all()
    if hasattr(torch, "mps") and hasattr(torch.mps, "get_rng_state"):
        try:
            state["mps"] = torch.mps.get_rng_state()
        except RuntimeError:
            pass
    return state


def restore_rng_state(state):
    random.setstate(state["python"])
    np.random.set_state(state["numpy"])
    torch.set_rng_state(state["torch"])
    if "cuda" in state and torch.cuda.is_available():
        torch.cuda.set_rng_state_all(state["cuda"])
    if "mps" in state and hasattr(torch, "mps") and hasattr(torch.mps, "set_rng_state"):
        try:
            torch.mps.set_rng_state(state["mps"])
        except RuntimeError:
            pass


class CheckpointManager:
    def __init__(self, run_dir: Path, keep_periodic=3):
        self.run_dir = Path(run_dir)
        self.directory = self.run_dir / "checkpoints"
        self.directory.mkdir(parents=True, exist_ok=True)
        self.keep_periodic = max(1, int(keep_periodic))

    def _pointer(self, name, path, trainer_state):
        _atomic_json(self.directory / f"{name}.json", {
            "path": path.name,
            "epoch": int(trainer_state.get("epoch", 0)),
            "global_step": int(trainer_state.get("global_step", 0)),
            "validation_loss": trainer_state.get("validation_loss"),
        })

    def save(self, model, optimizer, scheduler, scaler, trainer_state, config, config_digest, dataset_manifest_hash, kind="periodic", is_best=False):
        epoch = int(trainer_state.get("epoch", 0))
        step = int(trainer_state.get("global_step", 0))
        name = f"{kind}-e{epoch:04d}-s{step:09d}.pt"
        path = self.directory / name
        partial = path.with_suffix(path.suffix + ".partial")
        payload = {
            "schema_version": 1,
            "model_state": model.state_dict(),
            "optimizer_state": optimizer.state_dict(),
            "scheduler_state": scheduler.state_dict() if scheduler is not None else None,
            "scaler_state": scaler.state_dict() if scaler is not None else None,
            "trainer_state": dict(trainer_state),
            "rng_state": capture_rng_state(),
            "config": config,
            "config_digest": config_digest,
            "dataset_manifest_hash": dataset_manifest_hash,
        }
        torch.save(payload, partial)
        os.replace(partial, path)
        self._pointer("latest", path, trainer_state)
        if is_best:
            self._pointer("best", path, trainer_state)
        if kind == "periodic":
            self._prune_periodic()
        return path

    def _prune_periodic(self):
        paths = sorted(self.directory.glob("periodic-*.pt"), key=lambda path: path.stat().st_mtime)
        for path in paths[:-self.keep_periodic]:
            path.unlink()

    def resolve(self, value="latest"):
        candidate = Path(value)
        if candidate.is_file():
            return candidate
        pointer = self.directory / f"{value}.json"
        if not pointer.is_file():
            raise FileNotFoundError(f"Checkpoint pointer not found: {pointer}")
        payload = json.loads(pointer.read_text(encoding="utf-8"))
        path = self.directory / payload["path"]
        if not path.is_file():
            raise FileNotFoundError(f"Checkpoint target not found: {path}")
        return path

    def load(self, model, optimizer=None, scheduler=None, scaler=None, value="latest", expected_config_digest=None, expected_dataset_hash=None, map_location="cpu", expected_config=None, relax_keys=()):
        path = self.resolve(value)
        payload = torch.load(path, map_location=map_location, weights_only=False)
        if payload.get("schema_version") != 1:
            raise ValueError("Unsupported checkpoint schema")
        if expected_config_digest and payload.get("config_digest") != expected_config_digest:
            if not (expected_config is not None and relax_keys and _config_relaxed_ok(payload.get("config"), expected_config, relax_keys)):
                raise ValueError("Checkpoint config digest mismatch")
        if expected_dataset_hash and payload.get("dataset_manifest_hash") != expected_dataset_hash:
            raise ValueError("Checkpoint dataset manifest mismatch")
        model.load_state_dict(payload["model_state"])
        if optimizer is not None:
            optimizer.load_state_dict(payload["optimizer_state"])
        if scheduler is not None and payload.get("scheduler_state") is not None:
            scheduler.load_state_dict(payload["scheduler_state"])
        if scaler is not None and payload.get("scaler_state") is not None:
            scaler.load_state_dict(payload["scaler_state"])
        if payload.get("rng_state"):
            restore_rng_state(payload["rng_state"])
        return path, payload["trainer_state"], payload
