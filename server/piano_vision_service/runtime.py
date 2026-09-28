"""Inference-only adapter for the actual V2.5 runtime, without training changes."""
from pathlib import Path
import hashlib
import importlib
import sys


class V25Runtime:
    def __init__(self, checkpoint, runtime_root, device="cpu"):
        checkpoint = Path(checkpoint).resolve(strict=True)
        root = Path(runtime_root).resolve(strict=True)
        if not (root / "piano_vision/v25/generation.py").is_file():
            raise ValueError("V2.5 runtime with object-memory generation is required")
        sys.path.insert(0, str(root))
        package = importlib.import_module("piano_vision.v25")
        if not Path(package.__file__).resolve().is_relative_to(root):
            raise ValueError("A different Piano Vision runtime was already imported")
        import torch
        from piano_vision.v25.config import config_from_dict
        from piano_vision.v25.model import PianoVisionV25
        self.torch = torch
        self.device = device
        # Only an operator-installed, trusted checkpoint may reach this path.
        # Campaign checkpoints also include Python/NumPy RNG state.
        payload = torch.load(checkpoint, map_location="cpu", weights_only=False)
        if payload.get("architecture") != "piano-vision/2.5":
            raise ValueError("Expected a V2.5 checkpoint; legacy checkpoints are not migrated")
        self.config = config_from_dict(payload["config"])
        self.model = PianoVisionV25(self.config)
        self.model.load_state_dict(payload["model"], strict=True)
        self.model.to(device).eval()
        for parameter in self.model.parameters():
            parameter.requires_grad_(False)
        with checkpoint.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        self.metadata = {"architecture": package.ARCHITECTURE_VERSION,
                         "checkpoint_sha256": digest, "step": payload.get("step"),
                         "runtime_root": str(root), "device": device}

    def infer(self, source_batch):
        """Consume source-only, collated CPU inputs; preserve all semantic heads.

        The production score adapter must build source proposals and assemble
        verified whole-score MusicXML. This method is not that missing pipeline.
        """
        from piano_vision.v25.performance import prepare_batch
        from piano_vision.v25.generation import beam_generate
        from piano_vision.v25.decoding import pointer_owners
        if "targets" in source_batch or "notation_tokens" in source_batch:
            raise ValueError("Inference must not consume teacher tokens or targets")
        batch = self._to_device(prepare_batch(source_batch, consistency=False))
        with self.torch.inference_mode():
            output = self.model(batch, decode_notation=False, return_memory=True)
            generation = None
            if "notation_memory" in output:
                active = batch["notation_mask"].flatten().nonzero(as_tuple=False).flatten()
                if len(active):
                    memory = output["notation_memory"].index_select(0, active)
                    pad = output.get("notation_memory_pad")
                    if pad is not None:
                        pad = pad.index_select(0, active)
                    generation = beam_generate(
                        self.model.notation_decoder, memory, pad,
                        width=self.config.decode_width,
                        max_new_tokens=min(1024, self.model.notation_decoder.max_length - 1))
                    generation["region_indices"] = active
            pointers = pointer_owners(output.get("attachment", {}).get("pointer"),
                                      batch["object_mask"].shape[1])
            # Keep structural relations/event affinity for the trained score decoder.
            # Argmax owner includes the null class; it is not a calibrated acceptance.
            return {"semantic": output, "notation": generation,
                    "pointer_owners": pointers, "metadata": source_batch.get("metadata"),
                    "complete": False}

    def _to_device(self, value):
        if isinstance(value, self.torch.Tensor):
            return value.to(self.device)
        if isinstance(value, dict):
            return {key: self._to_device(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return type(value)(self._to_device(item) for item in value)
        return value
