"""Compact multimodal Piano Vision v1 architecture.

The network keeps pixel evidence first-class, accepts optional source-graph
features, refines object queries globally, and exposes separate structured
object/relation heads. MIDI is deliberately not a learned class: callers
derive it from written step, octave, and accidental predictions.
"""

from __future__ import annotations

import math

import torch
import torch.nn.functional as F
from torch import nn


WRITTEN_STEPS = ("C", "D", "E", "F", "G", "A", "B")
NATURAL_PITCH_CLASS = (0, 2, 4, 5, 7, 9, 11)


def count_parameters(module: nn.Module):
    return sum(value.numel() for value in module.parameters() if value.requires_grad)


def _groups(channels):
    for group in (16, 8, 4, 2):
        if channels % group == 0:
            return group
    return 1


class ConvNormAct(nn.Sequential):
    def __init__(self, source, target, kernel=3, stride=1, groups=1):
        super().__init__(
            nn.Conv2d(source, target, kernel, stride=stride, padding=kernel // 2, groups=groups, bias=False),
            nn.GroupNorm(_groups(target), target),
            nn.GELU(),
        )


class SeparableResidual(nn.Module):
    def __init__(self, source, target, stride=1, dropout=0.0):
        super().__init__()
        self.depthwise = ConvNormAct(source, source, 3, stride=stride, groups=source)
        self.pointwise = nn.Sequential(
            nn.Conv2d(source, target, 1, bias=False),
            nn.GroupNorm(_groups(target), target),
            nn.GELU(),
            nn.Dropout2d(dropout),
        )
        self.skip = nn.Identity() if source == target and stride == 1 else nn.Conv2d(source, target, 1, stride=stride, bias=False)

    def forward(self, value):
        return self.pointwise(self.depthwise(value)) + self.skip(value)


class VisualEncoder(nn.Module):
    def __init__(self, image_channels, channels, blocks, dropout):
        super().__init__()
        self.stem = ConvNormAct(image_channels, channels[0], 5, stride=2)
        stages = []
        source = channels[0]
        for stage_index, (target, count) in enumerate(zip(channels, blocks)):
            rows = [SeparableResidual(source, target, stride=2 if stage_index else 1, dropout=dropout)]
            rows.extend(SeparableResidual(target, target, dropout=dropout) for _ in range(count - 1))
            stages.append(nn.Sequential(*rows))
            source = target
        self.stages = nn.ModuleList(stages)
        self.channels = channels

    def forward(self, image):
        value = self.stem(image)
        features = []
        for stage in self.stages:
            value = stage(value)
            features.append(value)
        return features


class MultiScaleObjectSampler(nn.Module):
    def forward(self, features, object_xy):
        # grid_sample keeps the image pathway spatially tied to every object
        # query. Out-of-scope neighbor objects intentionally receive zeros.
        grid = object_xy.mul(2).sub(1).unsqueeze(2)
        sampled = []
        for feature in features:
            values = F.grid_sample(feature, grid, mode="bilinear", padding_mode="zeros", align_corners=False)
            sampled.append(values.squeeze(-1).transpose(1, 2))
        return torch.cat(sampled, dim=-1)


class GraphContextBlock(nn.Module):
    def __init__(self, hidden, heads, multiplier, dropout):
        super().__init__()
        self.hidden = hidden
        self.heads = heads
        self.head_dim = hidden // heads
        self.norm1 = nn.LayerNorm(hidden)
        self.qkv = nn.Linear(hidden, hidden * 3)
        self.graph_bias = nn.Linear(1, heads, bias=False)
        self.output = nn.Linear(hidden, hidden)
        self.dropout = nn.Dropout(dropout)
        self.norm2 = nn.LayerNorm(hidden)
        self.ffn = nn.Sequential(
            nn.Linear(hidden, hidden * multiplier),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden * multiplier, hidden),
        )

    def forward(self, objects, object_mask, adjacency):
        batch, count, _ = objects.shape
        value = self.norm1(objects)
        q, k, v = self.qkv(value).chunk(3, dim=-1)
        q = q.reshape(batch, count, self.heads, self.head_dim).transpose(1, 2)
        k = k.reshape(batch, count, self.heads, self.head_dim).transpose(1, 2)
        v = v.reshape(batch, count, self.heads, self.head_dim).transpose(1, 2)
        scores = torch.matmul(q, k.transpose(-2, -1)) / math.sqrt(self.head_dim)
        scores = scores + self.graph_bias(adjacency.unsqueeze(-1)).permute(0, 3, 1, 2)
        scores = scores.masked_fill(~object_mask[:, None, None, :], -1e4)
        attention = torch.softmax(scores, dim=-1)
        attention = attention * object_mask[:, None, :, None].to(attention.dtype)
        mixed = torch.matmul(attention, v).transpose(1, 2).reshape(batch, count, self.hidden)
        objects = objects + self.dropout(self.output(mixed))
        objects = objects + self.dropout(self.ffn(self.norm2(objects)))
        return objects * object_mask.unsqueeze(-1).to(objects.dtype)


class TemperatureHead(nn.Module):
    """A calibrated categorical head with a positive learned temperature."""

    def __init__(self, source, classes):
        super().__init__()
        self.projection = nn.Linear(source, classes)
        self.log_temperature = nn.Parameter(torch.zeros(()))

    def forward(self, value):
        temperature = self.log_temperature.exp().clamp(0.25, 4.0)
        return self.projection(value) / temperature


class PianoVisionV1(nn.Module):
    OBJECT_CLASSES = {
        "pitch_staff_step": 33,
        "pitch_written_step": 7,
        "pitch_octave": 11,
        "pitch_accidental": 7,
        "pitch_staff": 3,
        "pitch_clef": 8,
        "pitch_key_fifths": 15,
        "duration_type": 13,
        "duration_dots": 4,
        "duration_tuplet_ratio": 9,
        "duration_grace": 2,
        "lane": 8,
        "rest": 2,
        "tuplet": 2,
        "cross_staff": 2,
        "shared_head": 4,
        # Independently extensible notation-family heads.
        "stem": 3,
        "beam": 5,
        "articulation": 16,
        "dynamic": 16,
        "pedal": 4,
        "ottava": 5,
        "ornament": 12,
        "tremolo": 6,
        "arpeggio": 2,
        "accidental_glyph": 8,
    }
    RELATION_CLASSES = {
        "attack": 2,
        "chord": 2,
        "lane_continuation": 2,
        "tie": 2,
        "cross_staff_relation": 2,
        "shared_head_ownership": 4,
    }
    SCOPE_CLASSES = {
        "time_signature": 16,
        "measure_irregular": 2,
        "repeat_ending": 8,
        "tempo_class": 12,
    }

    def __init__(self, config):
        super().__init__()
        self.config = dict(config)
        hidden = int(config["hidden_dim"])
        channels = list(config["visual_channels"])
        dropout = float(config.get("dropout", 0.1))
        self.encoder = VisualEncoder(
            int(config.get("image_channels", 1)), channels,
            list(config["visual_blocks"]), dropout,
        )
        self.sampler = MultiScaleObjectSampler()
        input_dim = (
            sum(channels) + channels[-1]
            + int(config["object_feature_dim"])
            + int(config["graph_feature_dim"])
            + int(config["source_feature_dim"])
        )
        self.object_projection = nn.Sequential(
            nn.Linear(input_dim, hidden),
            nn.LayerNorm(hidden),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        self.context = nn.ModuleList([
            GraphContextBlock(
                hidden,
                int(config["attention_heads"]),
                int(config.get("ffn_multiplier", 3)),
                dropout,
            )
            for _ in range(int(config["graph_layers"]))
        ])
        relation_input = hidden * 4 + int(config["relation_feature_dim"])
        self.relation_projection = nn.Sequential(
            nn.Linear(relation_input, hidden),
            nn.LayerNorm(hidden),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden, hidden),
            nn.GELU(),
        )
        object_classes = dict(self.OBJECT_CLASSES)
        object_classes["pitch_staff_step"] = int(config.get("staff_step_classes", 33))
        self.object_heads = nn.ModuleDict({name: TemperatureHead(hidden, classes) for name, classes in object_classes.items()})
        self.relation_heads = nn.ModuleDict({name: TemperatureHead(hidden, classes) for name, classes in self.RELATION_CLASSES.items()})
        self.scope_heads = nn.ModuleDict({name: TemperatureHead(hidden, classes) for name, classes in self.SCOPE_CLASSES.items()})
        self.duration_quarters = nn.Linear(hidden, 1)
        self.measure_capacity = nn.Linear(hidden, 1)

    @staticmethod
    def _gather(objects, indexes):
        hidden = objects.shape[-1]
        return torch.gather(objects, 1, indexes.unsqueeze(-1).expand(-1, -1, hidden))

    def forward(self, batch):
        features = self.encoder(batch["image"])
        local = self.sampler(features, batch["object_xy"])
        pooled = F.adaptive_avg_pool2d(features[-1], 1).flatten(1)
        pooled = pooled.unsqueeze(1).expand(-1, local.shape[1], -1)
        source = batch["source_features"].unsqueeze(1).expand(-1, local.shape[1], -1)
        objects = self.object_projection(torch.cat([
            local,
            pooled,
            batch["object_features"],
            batch["graph_features"],
            source,
        ], dim=-1))
        objects = objects * batch["object_mask"].unsqueeze(-1).to(objects.dtype)
        for block in self.context:
            objects = block(objects, batch["object_mask"], batch["graph_adjacency"])

        pairs = batch["relation_index"].clamp(min=0, max=max(0, objects.shape[1] - 1))
        left = self._gather(objects, pairs[..., 0])
        right = self._gather(objects, pairs[..., 1])
        relation = self.relation_projection(torch.cat([
            left, right, torch.abs(left - right), left * right, batch["relation_features"],
        ], dim=-1))
        relation = relation * batch["relation_mask"].unsqueeze(-1).to(relation.dtype)

        mask = batch["object_mask"].unsqueeze(-1).to(objects.dtype)
        scope = (objects * mask).sum(1) / mask.sum(1).clamp_min(1.0)
        return {
            "object": {name: head(objects) for name, head in self.object_heads.items()},
            "relation": {name: head(relation) for name, head in self.relation_heads.items()},
            "scope": {name: head(scope) for name, head in self.scope_heads.items()},
            "regression": {
                "duration_quarters": F.softplus(self.duration_quarters(objects)).squeeze(-1),
                "measure_capacity": F.softplus(self.measure_capacity(scope)).squeeze(-1),
            },
            "embeddings": {"object": objects, "relation": relation, "scope": scope},
        }

    @staticmethod
    def uncertainty(logits, top_k=3, threshold=0.72):
        probabilities = torch.softmax(logits, dim=-1)
        count = min(int(top_k), probabilities.shape[-1])
        values, indexes = torch.topk(probabilities, count, dim=-1)
        entropy = -(probabilities * probabilities.clamp_min(1e-9).log()).sum(-1)
        entropy = entropy / math.log(max(2, probabilities.shape[-1]))
        confidence = values[..., 0] * (1.0 - entropy)
        return {
            "probabilities": probabilities,
            "topk_probability": values,
            "topk_index": indexes,
            "entropy": entropy,
            "confidence": confidence,
            "abstain": confidence < float(threshold),
        }


def derive_midi(written_step, octave, accidental):
    """Derive MIDI after structured pitch prediction; never a learned class."""
    if torch.is_tensor(written_step):
        table = torch.tensor(NATURAL_PITCH_CLASS, device=written_step.device, dtype=octave.dtype)
        return (octave + 1) * 12 + table[written_step] + (accidental - 3)
    return (int(octave) + 1) * 12 + NATURAL_PITCH_CLASS[int(written_step)] + (int(accidental) - 3)
