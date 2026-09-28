"""Modular hierarchical semantic model. It never consumes target tensors."""
import torch
from torch import nn

from . import ARCHITECTURE_VERSION
from .context import MusicalAttention, musical_pairs
from .visual import DetailBackbone, RegionSampler
from .notation_model import NotationDecoder


OBJECT_CLASSES = {
    "pitch_staff_step": 33, "pitch_written_step": 7, "pitch_octave": 11,
    "pitch_accidental": 7, "pitch_staff": 3,
    "duration_type": 13, "duration_dots": 4, "duration_tuplet_ratio": 9,
    "duration_grace": 2, "lane": 8, "rest": 2, "tuplet": 2,
    "cross_staff": 2, "shared_head": 4,
}
RELATION_CLASSES = {"attack": 2, "chord": 2, "lane_continuation": 2,
                    "tie": 2, "cross_staff_relation": 2, "shared_head_ownership": 4}
CONTEXT_CLASSES = {"key_fifths": 15, "clef": 8, "clef_line": 6, "clef_octave": 5,
                   "meter_numerator": 33, "meter_denominator": 8}


class SemanticHeads(nn.Module):
    def __init__(self, config):
        super().__init__()
        d = config.hidden
        self.object = nn.ModuleDict({k: nn.Linear(d, v) for k, v in OBJECT_CLASSES.items()})
        self.context = nn.ModuleDict({k: nn.Linear(d, v) for k, v in CONTEXT_CLASSES.items()})
        self.left = nn.Linear(d, 96)
        self.right = nn.Linear(d, 96)
        self.pair = nn.Sequential(nn.Linear(96 * 4 + 12, 192), nn.GELU(), nn.Linear(192, 96), nn.GELU())
        self.relation = nn.ModuleDict({k: nn.Linear(96, v) for k, v in RELATION_CLASSES.items()})
        self.duration = nn.Linear(d, 1)

    def forward(self, objects, contexts, batch):
        indexes = batch["relation_index"]
        left = torch.gather(self.left(objects), 1, indexes[..., 0, None].expand(-1, -1, 96))
        right = torch.gather(self.right(objects), 1, indexes[..., 1, None].expand(-1, -1, 96))
        pair = self.pair(torch.cat((left, right, left - right, left * right, batch["relation_features"]), -1))
        return {"object": {k: h(objects) for k, h in self.object.items()},
                "relation": {k: h(pair) for k, h in self.relation.items()},
                "context": {k: h(contexts) for k, h in self.context.items()},
                "regression": {"duration_quarters": torch.nn.functional.softplus(self.duration(objects)).squeeze(-1)}}


class PianoVisionV2(nn.Module):
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
        self.relation_feedback = nn.Linear(sum(RELATION_CLASSES.values()), d)
        self.context_feedback = nn.Linear(sum(CONTEXT_CLASSES.values()), d)
        self.refinement = MusicalAttention(config)
        self.final_norm = nn.LayerNorm(d)
        self.notation_decoder = NotationDecoder(d)
        # Ordinal-grounded attachment head (additive; zero-initialized).
        # Input: final object embeddings + source-only geometry features
        # (staff_id, staff_local_x_rank, global_x_rank, x_center).
        # Target: dense scope-local XML-ordinal classes 0..31 + overflow.
        # Geometric rank is a FEATURE; XML ordinal is the TARGET.
        from .ordinal import N_ATTACHMENT_CLASSES, ORDINAL_GEO_FEATURES
        self.ordinal_head = nn.Sequential(
            nn.Linear(d + ORDINAL_GEO_FEATURES, max(32, d // 2)),
            nn.GELU(),
            nn.Linear(max(32, d // 2), N_ATTACHMENT_CLASSES),
        )
        nn.init.zeros_(self.ordinal_head[2].weight)
        nn.init.zeros_(self.ordinal_head[2].bias)
        self.ordinal_stage = "A"

    def set_ordinal_stage(self, stage):
        """Stage-A freezes everything except the new attachment head.

        Stage A: only ``ordinal_head`` trains (notation-type path untouched).
        Stage B: ordinal head + notation decoder train (backbone stays frozen).
        Stage full: all parameters train (requires explicit evidence).
        Returns a param-count report.
        """
        if stage not in ("A", "B", "full"):
            raise ValueError("ordinal stage must be one of A/B/full")
        self.ordinal_stage = stage
        if stage == "A":
            for name, param in self.named_parameters():
                param.requires_grad = name.startswith("ordinal_head.")
        elif stage == "B":
            for name, param in self.named_parameters():
                param.requires_grad = name.startswith("ordinal_head.") or name.startswith("notation_decoder.")
        else:
            for param in self.parameters():
                param.requires_grad = True
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        frozen = sum(p.numel() for p in self.parameters() if not p.requires_grad)
        return {"stage": stage, "trainable_params": trainable, "frozen_params": frozen}

    def encode_views(self, images):
        """Deployment may cache these using exact weights/pixels/transform keys."""
        return self.backbone(images.flatten(0, 1))

    def forward(self, batch, encoded_views=None, cand_k=None):
        """cand_k: evaluate/train candidate-anchor width (None=all built, 0=legacy path)."""
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
            objects = self.object_feedback(torch.cat([v.softmax(-1) for v in outputs["object"].values()], -1))
            relation = self.relation_feedback(torch.cat([v.softmax(-1) for v in outputs["relation"].values()], -1))
            relation = relation * batch["relation_mask"].unsqueeze(-1)
            messages = torch.zeros_like(objects)
            degree = objects.new_zeros(b, n, 1)
            for end in (0, 1):
                index = batch["relation_index"][..., end, None]
                messages = messages.scatter_add(1, index.expand(-1, -1, objects.shape[-1]), relation)
                degree = degree.scatter_add(1, index, batch["relation_mask"].unsqueeze(-1).to(degree.dtype))
            objects = objects + messages / degree.clamp_min(1)
            hierarchy = self.context_feedback(torch.cat([v.softmax(-1) for v in outputs["context"].values()], -1))
            tokens = self.refinement(tokens + torch.cat((objects, hierarchy), 1), mask, pairs)
            outputs = self.heads(self.final_norm(tokens[:, :n]), self.final_norm(tokens[:, n:]), batch)
        outputs["initial"] = initial if initial is not outputs else None
        outputs["embeddings"] = {"object": tokens[:, :n], "context": tokens[:, n:]}
        if "notation_tokens" in batch:
            # Arbitrary source regions can include unanchored text/directions.
            # Teacher tokens never alter the semantic backbone or object logits.
            region = self.visual_projection(self.sampler(features,batch["notation_boxes"],
                       batch["notation_view"],batch["notation_mask"],views))
            hm=batch["hierarchy_mask"].unsqueeze(-1)
            page_context=(tokens[:,n:]*hm).sum(1)/hm.sum(1).clamp_min(1)
            region=region+page_context[:,None]
            cand=None
            if "notation_cand_index" in batch and cand_k != 0:
                k=cand_k or batch["notation_cand_index"].shape[2]
                idx=batch["notation_cand_index"][:,:,:k].clamp_min(0)
                msk=batch["notation_cand_mask"][:,:,:k]
                emb=torch.gather(tokens[:,:n].unsqueeze(1).expand(
                                     -1,idx.shape[1],-1,-1),2,
                                 idx.unsqueeze(-1).expand(-1,-1,-1,tokens.shape[-1]))
                cand={"emb":emb.flatten(0,1),
                      "geo":batch["notation_cand_geo"][:,:,:k].flatten(0,1),
                      "kind":batch["notation_cand_kind"][:,:,:k].flatten(0,1),
                      "mask":msk.flatten(0,1)}
            outputs["notation"] = self.notation_decoder(region.flatten(0,1),batch["notation_tokens"].flatten(0,1),cand=cand)
        # Ordinal-grounded attachment head (additive; never alters other logits).
        # Uses final normalized object embeddings + source-only geometry.
        if "object_ordinal_features" in batch:
            obj_norm = self.final_norm(tokens[:, :n])
            geo = batch["object_ordinal_features"].to(obj_norm.dtype)
            outputs.setdefault("attachment", {})["ordinal"] = self.ordinal_head(
                torch.cat((obj_norm, geo), -1)
            )
        return outputs


def load_v2_compat(model,payload):
    """Load an older V2 checkpoint into a (possibly extended) model.

    Returns reuse report. New D1 + ordinal keys must be the ONLY missing keys;
    any other missing/unexpected key fails loudly.
    """
    state=payload.get("model",payload) if isinstance(payload,dict) else payload
    result=model.load_state_dict(state,strict=False)
    missing,unexpected=list(result.missing_keys),list(result.unexpected_keys)
    new_prefixes=("notation_decoder.cand_gate","notation_decoder.cand_geo.",
                  "notation_decoder.cand_kind.", "ordinal_head.")
    bad_missing=[k for k in missing if not k.startswith(new_prefixes)]
    if bad_missing or unexpected:
        raise ValueError(f"checkpoint incompatible: bad_missing={bad_missing} "
                         f"unexpected={unexpected}")
    total=sum(p.numel() for p in model.parameters())
    new=sum(model.get_parameter(k).numel() for k in missing)
    return {"old_keys_matched":len(state)-len(unexpected),
            "new_keys_initialized":sorted(missing),
            "weights_reused_fraction":(total-new)/total,
            "total_params":total,"new_params":new}
