"""Piano Vision V2.5 model: V2 trunk with structural identity + attachment.

Trunk compatibility: every V2 parameter name is preserved with identical
shape semantics, so V2 checkpoints load key-for-key (see compat.py).
V2.5 additions (new prefixes only):

- event_projector / event_pair : onset-event identity embeddings + affinity
- relation_feedback.*        : per-relation-type refinement feedback
- pointer.*                  : region -> object attachment distribution
- object_memory.*            : projection for object-set decoder memory
- notation_bias.*            : learned region/object role bias for memory

Retired (accepted-but-ignored on load, never trained): ordinal_head,
notation_decoder.cand_* (failed D1/D3/ordinal directions).
"""
import math

import torch
from torch import nn

from . import ARCHITECTURE_VERSION
from ..v2.context import MusicalAttention, musical_pairs
from ..v2.visual import DetailBackbone, RegionSampler
from ..v2.model import SemanticHeads, OBJECT_CLASSES, RELATION_CLASSES
from ..v2.notation_model import NotationDecoder
from ..v2.notation import NotationCodec


class EventIdentity(nn.Module):
    """Onset-event embeddings supervised by ATTACK/CHORD pairs.

    Objects that sound together (same attack group or chord) must be near
    in event space; safely-known different-onset pairs must be far. This is
    the representation the frozen-V2 ordinal experiment proved missing:
    with event identity, attachment becomes selection among events, not
    classification from a pooled vector.
    """

    def __init__(self, hidden, event_dim=96):
        super().__init__()
        self.projector = nn.Sequential(
            nn.Linear(hidden, hidden), nn.LayerNorm(hidden), nn.GELU(),
            nn.Linear(hidden, event_dim), nn.LayerNorm(event_dim))
        self.pair = nn.Sequential(
            nn.Linear(event_dim * 4, event_dim), nn.GELU(),
            nn.Linear(event_dim, 1))

    def affinity(self, events, index):
        left = torch.gather(events, 1,
                            index[..., 0, None].expand(-1, -1, events.shape[-1]))
        right = torch.gather(events, 1,
                             index[..., 1, None].expand(-1, -1, events.shape[-1]))
        return self.pair(torch.cat((left, right, left - right, left * right), -1)).squeeze(-1)


class PointerAttachment(nn.Module):
    """Region -> object attachment as explicit selection.

    Score = query(region) . key(object) + geometric bias from page-space
    deltas. Geometry enters only as a learned additive bias; there are no
    rank features and no rank targets (the D1 failure mode). When the owner
    is genuinely ambiguous the supervision stays masked and the pointer
    remains a distribution, never a forced choice.
    """

    GEO_DIM = 4  # dx, dy, euclidean distance, same-page

    def __init__(self, hidden, width=128):
        super().__init__()
        self.query = nn.Linear(hidden, width)
        self.key = nn.Linear(hidden, width)
        self.geo = nn.Sequential(nn.Linear(self.GEO_DIM, width), nn.GELU(),
                                 nn.Linear(width, 1))
        self.null = nn.Parameter(torch.zeros(width))
        self.scale = 1.0 / math.sqrt(width)

    def forward(self, regions, objects, region_geo, object_geo, object_mask):
        q = self.query(regions) * self.scale
        k = self.key(objects)
        scores = torch.bmm(q, k.transpose(1, 2))
        delta = region_geo[:, :, None, :2] - object_geo[:, None, :, :2]
        dist = delta.norm(dim=-1, keepdim=True)
        same = (region_geo[:, :, None, 2] == object_geo[:, None, :, 2]).to(regions.dtype).unsqueeze(-1)
        bias = self.geo(torch.cat((delta, dist, same), -1)).squeeze(-1)
        scores = scores + bias
        null = torch.bmm(q, self.null.expand(q.shape[0], 1, -1).transpose(1, 2)).squeeze(-1)
        scores = torch.cat((scores, null.unsqueeze(-1)), -1)
        pad = ~object_mask
        scores[..., :-1] = scores[..., :-1].masked_fill(pad.unsqueeze(1), -1e4)
        return scores


class PianoVisionV25(nn.Module):
    architecture_version = ARCHITECTURE_VERSION

    def __init__(self, config, backbone=None):
        super().__init__()
        self.config = config
        d = config.hidden
        self.backbone = backbone or DetailBackbone(config)
        self.sampler = RegionSampler(config.region_grid)
        visual_dim = sum(self.backbone.output_channels) * config.region_grid ** 2
        self.visual_projection = nn.Linear(visual_dim, d)
        self.object_projection = nn.Sequential(nn.Linear(24 + 16, d), nn.LayerNorm(d), nn.GELU())
        self.source_projection = nn.Linear(16, d)
        self.hierarchy_type = nn.Embedding(6, d)
        self.geometry_projection = nn.Linear(4, d)
        self.context = nn.ModuleList([MusicalAttention(config) for _ in range(config.layers)])
        self.heads = SemanticHeads(config)
        self.object_feedback = nn.Linear(sum(OBJECT_CLASSES.values()), d)
        if config.per_type_feedback:
            self.relation_feedback = nn.ModuleDict(
                {name: nn.Linear(classes, d) for name, classes in RELATION_CLASSES.items()})
        else:
            self.relation_feedback = nn.Linear(sum(RELATION_CLASSES.values()), d)
        self.context_feedback = nn.Linear(
            sum(self.heads.context[h].out_features for h in self.heads.context), d)
        self.refinement = MusicalAttention(config)
        self.final_norm = nn.LayerNorm(d)
        self.notation_decoder = NotationDecoder(d)
        # Retired D1 candidate path: parameters retained ONLY so D1-era
        # checkpoints remain loadable. Frozen at init, never trained,
        # never read by the V2.5 forward pass. Removal scheduled for V2.6.
        self.notation_decoder.cand_gate.requires_grad_(False)
        for module in (self.notation_decoder.cand_geo,):
            for param in module.parameters():
                param.requires_grad_(False)
        self.notation_decoder.cand_kind.weight.requires_grad_(False)
        # ---- V2.5 additions ----
        self.event_projector = EventIdentity(d, config.event_dim)
        self.pointer = PointerAttachment(d)
        self.object_memory = nn.LayerNorm(d)
        self.notation_bias = nn.Embedding(
            2, self.notation_decoder.memory.out_features)  # 0 = region, 1 = object

    def encode_views(self, images):
        return self.backbone(images.flatten(0, 1))

    def _refine(self, tokens, mask, pairs, batch, n, outputs):
        d = tokens.shape[-1]
        b = tokens.shape[0]
        objects = self.object_feedback(torch.cat([v.softmax(-1) for v in outputs["object"].values()], -1))
        if isinstance(self.relation_feedback, nn.ModuleDict):
            relation = torch.zeros(b, outputs["relation"]["attack"].shape[1], d,
                                   device=tokens.device, dtype=tokens.dtype)
            for name, proj in self.relation_feedback.items():
                relation = relation + proj(outputs["relation"][name].softmax(-1))
        else:
            relation = self.relation_feedback(
                torch.cat([v.softmax(-1) for v in outputs["relation"].values()], -1))
        relation = relation * batch["relation_mask"].unsqueeze(-1)
        messages = torch.zeros_like(objects)
        degree = objects.new_zeros(b, objects.shape[1], 1)
        for end in (0, 1):
            index = batch["relation_index"][..., end, None]
            messages = messages.scatter_add(1, index.expand(-1, -1, d), relation)
            degree = degree.scatter_add(1, index, batch["relation_mask"].unsqueeze(-1).to(degree.dtype))
        objects = objects + messages / degree.clamp_min(1)
        hierarchy = self.context_feedback(torch.cat([v.softmax(-1) for v in outputs["context"].values()], -1))
        return self.refinement(tokens + torch.cat((objects, hierarchy), 1), mask, pairs)

    def _notation_memory(self, region, object_tokens, object_mask):
        """Memory per region = [region] + current-scope object tokens.

        Shapes: region (B,R,d); objects (B,M,d) -> memory (B,R,1+M,W) with
        pad (B,R,1+M). No truncation of the supervised set, no rank
        features. Falls back to region-only when object memory is disabled
        or unavailable; the choice is recorded in outputs['v25'] so it is
        explicit, never silent."""
        mem_r = self.notation_decoder.memory(region)[:, :, None, :]
        used = False
        if self.config.object_memory and object_tokens is not None:
            mem_o = self.notation_decoder.memory(self.object_memory(object_tokens))
            mem_o = mem_o.unsqueeze(1).expand(-1, mem_r.shape[1], -1, -1)
            memory = torch.cat((mem_r, mem_o), 2)
            region_pad = torch.zeros(memory.shape[:2] + (1,), dtype=torch.bool,
                                     device=memory.device)
            obj_pad = ~object_mask if object_mask is not None else torch.zeros(
                (memory.shape[0], memory.shape[2] - 1), dtype=torch.bool,
                device=memory.device)
            obj_pad = obj_pad.unsqueeze(1).expand(-1, memory.shape[1], -1)
            pad = torch.cat((region_pad, obj_pad), 2)
            used = True
        else:
            memory, pad = mem_r, None
        # Role bias: region token 0, object tokens 1.
        role = torch.zeros(memory.shape[:3], dtype=torch.long, device=memory.device)
        if used:
            role[:, :, 1:] = 1
        memory = memory + self.notation_bias(role)
        return memory, pad, used

    def forward(self, batch, encoded_views=None, cand_k=None):
        _ = cand_k  # retired D1 path: accepted for call-compat, ignored.
        b, views = batch["images"].shape[:2]
        n = batch["object_mask"].shape[1]
        mask = torch.cat((batch["object_mask"], batch["hierarchy_mask"]), 1)
        boxes = torch.cat((batch["object_boxes"], batch["hierarchy_boxes"]), 1)
        view_index = torch.cat((batch["object_view"], batch["hierarchy_view"]), 1)
        features = self.encode_views(batch["images"]) if encoded_views is None else encoded_views
        visual = self.visual_projection(self.sampler(features, boxes, view_index, mask, views))
        source = self.source_projection(batch["source_features"])
        object_features = self.object_projection(torch.cat((batch["object_features"], batch["graph_features"]), -1))
        if self.training and self.config.source_dropout:
            keep = (torch.rand(b, 1, 1, device=visual.device) >= self.config.source_dropout).to(visual.dtype)
            source = source * keep.squeeze(1)
            object_features = object_features * keep
        objects = visual[:, :n] + object_features + source[:, None]
        hierarchy = visual[:, n:] + self.hierarchy_type(batch["hierarchy_type"])
        tokens = torch.cat((objects, hierarchy), 1) + self.geometry_projection(batch["token_geometry"])
        pairs = musical_pairs(batch["token_geometry"][..., :2], batch["token_identity"], batch["token_parent"])
        for layer in self.context:
            tokens = layer(tokens, mask, pairs)
        outputs = self.heads(self.final_norm(tokens[:, :n]), self.final_norm(tokens[:, n:]), batch)
        initial = outputs
        for _ in range(self.config.refinement_steps):
            tokens = self._refine(tokens, mask, pairs, batch, n, outputs)
            outputs = self.heads(self.final_norm(tokens[:, :n]), self.final_norm(tokens[:, n:]), batch)
        outputs["initial"] = initial if initial is not outputs else None
        obj_norm = self.final_norm(tokens[:, :n])
        outputs["embeddings"] = {"object": tokens[:, :n], "context": tokens[:, n:]}
        # Event identity on final object embeddings.
        events = self.event_projector.projector(obj_norm)
        outputs["events"] = events
        outputs.setdefault("attachment", {})["event_affinity"] = self.event_projector.affinity(
            events, batch["relation_index"])
        if "notation_tokens" in batch:
            region = self.visual_projection(self.sampler(features, batch["notation_boxes"],
                           batch["notation_view"], batch["notation_mask"], views))
            current = None
            cur_mask = None
            if "metadata" in batch and isinstance(batch["metadata"], list):
                counts = torch.tensor([m.get("current_objects", n) for m in batch["metadata"]],
                                      device=tokens.device)
            else:
                counts = torch.full((b,), n, device=tokens.device)
            max_cur = int(counts.max())
            current = obj_norm[:, :max_cur]
            arange = torch.arange(max_cur, device=tokens.device).unsqueeze(0)
            cur_mask = arange < counts.unsqueeze(1)
            memory, mem_pad, mem_used = self._notation_memory(
                region, current, cur_mask)
            flat_region = region.flatten(0, 1)
            flat_tokens = batch["notation_tokens"].flatten(0, 1)
            value = (self.notation_decoder.embedding(flat_tokens)
                     + self.notation_decoder.position[:flat_tokens.shape[1]][None])
            causal = torch.ones(value.shape[1], value.shape[1], dtype=torch.bool, device=value.device).triu(1)
            row_mem = memory.flatten(0, 1)
            row_pad = mem_pad.flatten(0, 1) if mem_pad is not None else None
            decoded = self.notation_decoder.decoder(
                value, row_mem, tgt_mask=causal,
                tgt_key_padding_mask=flat_tokens == NotationCodec.PAD,
                memory_key_padding_mask=row_pad)
            outputs["notation"] = self.notation_decoder.output(decoded)
            outputs["v25_memory_used"] = mem_used
            # Pointer attachment for every notation region.
            region_ctx = region
            obj_geo = batch.get("object_page_geo")
            reg_geo = batch.get("notation_region_geo")
            if obj_geo is not None and reg_geo is not None:
                outputs["attachment"]["pointer"] = self.pointer(
                    region_ctx, current,
                    reg_geo.to(region.dtype),
                    obj_geo[:, :current.shape[1]].to(region.dtype), cur_mask)
            else:
                outputs["attachment"]["pointer"] = None
        else:
            outputs["v25_memory_used"] = False
        outputs["v25"] = {
            "object_memory": bool(outputs.get("v25_memory_used", False)),
            "per_type_feedback": isinstance(self.relation_feedback, nn.ModuleDict),
            "loss_mode": self.config.loss_mode,
        }
        return outputs


def load_v25_from_v2(model, payload):
    """Load a V2 (or V2.5) checkpoint into a V2.5 model.

    All trunk/vocabulary keys must match; V2.5-new prefixes may be missing
    (fresh init); retired D1/ordinal keys in the payload are ignored with a
    report. Anything else fails loudly.
    """
    from . import V25_NEW_PREFIXES, RETIRED_PREFIXES
    from ..v2.model import RELATION_CLASSES
    state = payload.get("model", payload) if isinstance(payload, dict) else payload
    ignored = {k: v for k, v in state.items() if k.startswith(RETIRED_PREFIXES)}
    kept = {k: v for k, v in state.items() if k not in ignored}
    # V2 pooled relation feedback -> per-type slices (column blocks follow
    # RELATION_CLASSES insertion order, matching the V2 forward concat).
    migrated = []
    if isinstance(model.relation_feedback, nn.ModuleDict) and \
            "relation_feedback.weight" in kept:
        pooled_w = kept.pop("relation_feedback.weight")
        pooled_b = kept.pop("relation_feedback.bias", None)
        offset = 0
        for name, classes in RELATION_CLASSES.items():
            w = pooled_w[:, offset:offset + classes]
            model.relation_feedback[name].weight.data.copy_(w)
            if pooled_b is not None:
                model.relation_feedback[name].bias.data.copy_(
                    pooled_b / len(RELATION_CLASSES))
            migrated.append(name)
            offset += classes
        assert offset == pooled_w.shape[1], "relation class width mismatch"
    result = model.load_state_dict(kept, strict=False)
    missing, unexpected = list(result.missing_keys), list(result.unexpected_keys)
    acceptable_missing = V25_NEW_PREFIXES + RETIRED_PREFIXES
    bad_missing = [k for k in missing if not k.startswith(acceptable_missing)]
    if bad_missing or unexpected:
        raise ValueError(f"checkpoint incompatible: bad_missing={bad_missing} "
                         f"unexpected={unexpected}")
    total = sum(p.numel() for p in model.parameters())
    new = sum(model.get_parameter(k).numel() for k in missing)
    return {"old_keys_matched": len(kept),
            "ignored_retired_keys": sorted(ignored),
            "migrated_feedback_heads": migrated,
            "new_keys_initialized": sorted(missing),
            "weights_reused_fraction": (total - new) / total,
            "total_params": total, "new_params": new}
