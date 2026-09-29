"""Phase F - the minimal staff-relative adapter.

Design constraints from the brief, and how each is met:

  * "the strong V2.5 semantic core must remain frozen initially"
    The frozen model is never modified. It runs once, in eval mode, with
    requires_grad_(False); this adapter is a separate module that reads the
    frozen model's OUTPUTS and adds a correction to the PITCH LOGITS only.
    Backbone, context layers, event/relation heads, notation decoder and every
    non-pitch head are untouched by construction, not by convention.

  * "identity-safe initialization where practical"
    The final linear layer is zero-initialised, so at initialisation the
    adapter contributes exactly 0 and the model's outputs are bit-identical to
    the frozen champion. Gate F5 verifies this numerically.

  * "residual adapter / small MLP, target ~0.1M-0.5M"
    A two-layer MLP over [frozen object embedding (480), staff features (7)]
    producing a per-pitch-head logit delta.

  * "do not create a giant handcrafted feature vector"
    7 features, enumerated in v26_staff.FEATURE_NAMES.

Only these heads are corrected:
    pitch_staff_step, pitch_written_step, pitch_octave, pitch_accidental,
    pitch_staff
Duration, tuplet, lane, rest, cross-staff, event, relation, pointer and the
notation decoder are deliberately NOT corrected: this milestone tests a pitch
hypothesis, and touching anything else would make the result uninterpretable.
"""
from __future__ import annotations

import torch
from torch import nn

from v26_staff import N_FEATURES

ADAPTED_PITCH_HEADS = (
    "pitch_staff_step", "pitch_written_step", "pitch_octave",
    "pitch_accidental", "pitch_staff",
)
# OBJECT_CLASSES from piano_vision.v2.model, restated so this module can be read
# without importing the frozen runtime.
PITCH_HEAD_SIZES = {
    "pitch_staff_step": 33, "pitch_written_step": 7, "pitch_octave": 11,
    "pitch_accidental": 7, "pitch_staff": 3,
}


class StaffPitchAdapter(nn.Module):
    """Additive logit correction on the pitch heads, from staff-relative geometry."""

    def __init__(self, embedding_dim, width=256, n_features=N_FEATURES,
                 heads=ADAPTED_PITCH_HEADS):
        super().__init__()
        self.heads = tuple(heads)
        self.n_features = n_features
        self.total_classes = sum(PITCH_HEAD_SIZES[h] for h in self.heads)
        self.body = nn.Sequential(
            nn.Linear(embedding_dim + n_features, width),
            nn.GELU(),
            nn.Linear(width, width),
            nn.GELU(),
        )
        self.out = nn.Linear(width, self.total_classes)
        # Identity at initialisation: the champion's outputs are untouched.
        nn.init.zeros_(self.out.weight)
        nn.init.zeros_(self.out.bias)

    def forward(self, embedding, staff_features, object_mask):
        """embedding (B,N,D) frozen object embedding;
        staff_features (B,N,F); object_mask (B,N) bool."""
        z = torch.cat((embedding, staff_features), -1)
        delta = self.out(self.body(z))
        delta = delta * object_mask.unsqueeze(-1).to(delta.dtype)
        return dict(zip(self.heads, torch.split(delta, [PITCH_HEAD_SIZES[h]
                                                        for h in self.heads], -1)))

    def parameter_count(self):
        return sum(p.numel() for p in self.parameters())


def apply_adapter(outputs, adapter, embedding, staff_features, object_mask):
    """Return a copy of the frozen outputs with the pitch logits corrected."""
    if adapter is None:
        return outputs
    delta = adapter(embedding, staff_features, object_mask)
    out = dict(outputs)
    obj = dict(out["object"])
    for name, d in delta.items():
        obj[name] = obj[name] + d
    out["object"] = obj
    return out
