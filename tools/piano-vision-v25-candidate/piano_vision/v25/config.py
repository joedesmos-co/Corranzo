"""V2.5 configuration. Trunk geometry mirrors V2 presets exactly so that
V2 checkpoints load key-for-key; every V2.5 behavior change is an explicit,
versioned knob with a V2-equivalent setting documented below.
"""
from dataclasses import asdict, dataclass, field


@dataclass(frozen=True)
class V25Config:
    # ---- trunk (identical semantics to V2Config) ----
    variant: str = "medium"
    channels: tuple = (32, 64, 128, 256)
    depths: tuple = (1, 2, 4, 3)
    hidden: int = 480
    layers: int = 7
    heads: int = 8
    expansion: int = 3
    refinement_steps: int = 3
    dropout: float = 0.05
    image_height: int = 192
    image_width: int = 512
    max_objects: int = 192
    max_relations: int = 16384
    context_radius: int = 1
    region_grid: int = 3
    source_dropout: float = 0.35

    # ---- V2.5 vision/region ----
    # Expanded notation-region crop: pad the marking box, then extend the
    # crop vertically to include the nearest staff band and horizontally by
    # one onset neighborhood. Source geometry only, never targets.
    # V2-equivalent: region_pad=0.15, region_staff_extend=False.
    region_pad: float = 0.15
    region_staff_extend: bool = True
    region_onset_extend: float = 1.0

    # ---- V2.5 event identity ----
    # Width of the projected event embedding. V2-equivalent: event_weight=0.
    event_dim: int = 96
    event_weight: float = 0.5

    # ---- V2.5 attachment ----
    # Object-set decoder memory (all current-scope objects, no truncation).
    # V2-equivalent: object_memory=False (mean-pooled page context only).
    object_memory: bool = True
    object_memory_max: int = 192
    pointer_weight: float = 1.0
    # Conservative pointer supervision: require unique staff agreement AND
    # unique onset-cluster agreement, else mask. Reported as coverage.
    pointer_require_unique: bool = True

    # ---- V2.5 refinement ----
    # Per-relation-type feedback instead of one pooled projection.
    # V2-equivalent: per_type_feedback=False.
    per_type_feedback: bool = True

    # ---- V2.5 objective ----
    # loss_mode="v2" reproduces the V2 group-mean objective exactly (for
    # ablations/regression); "v25" enables macro + focal + syntax weighting.
    loss_mode: str = "v25"
    initial_weight: float = 0.3
    rare_boost: float = 3.0
    focal_gamma: float = 1.0
    # Notation bytes that are pure JSON syntax get this CE multiplier so
    # content bytes (values that change semantics) dominate the token loss.
    syntax_weight: float = 0.2
    voice_consistency_weight: float = 0.2
    tie_pitch_weight: float = 0.3
    duration_consistency_weight: float = 0.2

    # ---- V2.5 inference ----
    decode_width: int = 4
    rerank_budget: int = 128
    abstain_on_review: bool = True

    def __post_init__(self):
        if self.hidden % self.heads or min(self.channels) < 1:
            raise ValueError("Invalid attention width or visual channels")
        if len(self.channels) != len(self.depths) or len(self.channels) != 4:
            raise ValueError("Four explicit visual scales are required")
        if min(self.depths) < 1 or self.layers < 1 or not 0 <= self.refinement_steps <= 3:
            raise ValueError("Invalid depth/refinement")
        if self.image_height < 32 or self.image_width < 32 or self.region_grid < 1:
            raise ValueError("Invalid image/region geometry")
        if self.max_objects < 2 or self.max_relations < 2 or self.context_radius < 0:
            raise ValueError("Invalid capacity")
        if not 0 <= self.dropout < 1 or not 0 <= self.source_dropout <= 1:
            raise ValueError("Invalid dropout probability")
        if self.loss_mode not in ("v2", "v25"):
            raise ValueError("loss_mode must be v2 or v25")
        if self.event_dim < 8 or self.object_memory_max < 1:
            raise ValueError("Invalid event/memory capacity")
        for key in ("event_weight", "pointer_weight", "rare_boost",
                    "voice_consistency_weight", "tie_pitch_weight",
                    "duration_consistency_weight"):
            if getattr(self, key) < 0:
                raise ValueError(f"Invalid loss weight {key}")
        if not 0 <= self.focal_gamma <= 4 or not 0 <= self.syntax_weight <= 1:
            raise ValueError("Invalid focal/syntax weighting")

    def to_dict(self):
        return asdict(self)

    def v2_dict(self):
        """Trunk geometry as a V2-compatible config dict."""
        keys = ("variant", "channels", "depths", "hidden", "layers", "heads",
                "expansion", "refinement_steps", "dropout", "image_height",
                "image_width", "max_objects", "max_relations",
                "context_radius", "region_grid", "source_dropout")
        return {k: (tuple(v) if k in ("channels", "depths") else v)
                for k, v in self.to_dict().items() if k in keys}


def _base(variant, channels, depths, hidden, layers, **overrides):
    fields = dict(variant=variant, channels=channels, depths=depths,
                  hidden=hidden, layers=layers)
    fields.update(overrides)
    return V25Config(**fields)


PRESETS = {
    "compact": _base("compact", (24, 48, 96, 192), (1, 2, 3, 2), 320, 5),
    "medium": _base("medium", (32, 64, 128, 256), (1, 2, 4, 3), 480, 7),
    "large": _base("large", (40, 80, 160, 320), (1, 3, 5, 4), 640, 8),
    # High-resolution variant for the RTX campaign: more pixels for tiny
    # symbols, same trunk widths. VRAM cost is measured before adoption.
    "medium-tall": _base("medium-tall", (32, 64, 128, 256), (1, 2, 4, 3),
                         480, 7, image_height=256, image_width=704),
}


def config_from_dict(value):
    value = dict(value)
    for key in ("channels", "depths"):
        if key in value:
            value[key] = tuple(value[key])
    known = V25Config.__dataclass_fields__.keys()
    unknown = [k for k in value if k not in known]
    if unknown:
        raise ValueError(f"Unknown V2.5 config keys: {unknown}")
    return V25Config(**value)
