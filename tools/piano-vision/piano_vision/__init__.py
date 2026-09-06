"""Corranzo Piano Vision v1 training stack."""

from .config import load_config, model_config, config_digest
from .model import PianoVisionV1, count_parameters

__all__ = [
    "PianoVisionV1",
    "config_digest",
    "count_parameters",
    "load_config",
    "model_config",
]

__version__ = "1.0.0-phase214"
