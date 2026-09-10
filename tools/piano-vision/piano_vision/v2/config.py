"""Capacity is expressed as widths/depths, never filler parameters."""
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class V2Config:
    variant: str = "compact"
    channels: tuple = (24, 48, 96, 192)
    depths: tuple = (1, 2, 3, 2)
    hidden: int = 320
    layers: int = 5
    heads: int = 8
    expansion: int = 3
    refinement_steps: int = 1
    dropout: float = 0.05
    image_height: int = 192
    image_width: int = 512
    max_objects: int = 192
    max_relations: int = 16384
    context_radius: int = 1
    region_grid: int = 3
    source_dropout: float = 0.35

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

    def to_dict(self):
        return asdict(self)


PRESETS = {
    "compact": V2Config(),
    "medium": V2Config(variant="medium", channels=(32, 64, 128, 256),
                       depths=(1, 2, 4, 3), hidden=480, layers=7),
    "large": V2Config(variant="large", channels=(40, 80, 160, 320),
                      depths=(1, 3, 5, 4), hidden=640, layers=8),
}


def config_from_dict(value):
    value = dict(value)
    for key in ("channels", "depths"):
        if key in value:
            value[key] = tuple(value[key])
    return V2Config(**value)

