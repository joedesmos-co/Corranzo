"""V2.5 objective: macro/focal rebalancing, syntax-aware notation loss,
event/pointer supervision, and label-free structural consistency.

loss_mode="v2" reproduces the V2 group-mean objective bit-for-bit (modulo
the new auxiliary terms, all defaulting to weight 0 in that mode) so that
ablations and regressions are exact.
"""
import torch
import torch.nn.functional as F

from ..v2.loss import _pass_loss as _v2_pass_loss


def _tree_to_device(value, device):
    """Recursively move tensor supervision/batch data onto one device."""
    if torch.is_tensor(value):
        return value.to(device=device, non_blocking=True)
    if isinstance(value, dict):
        return {k: _tree_to_device(v, device) for k, v in value.items()}
    if isinstance(value, list):
        return [_tree_to_device(v, device) for v in value]
    if isinstance(value, tuple):
        return tuple(_tree_to_device(v, device) for v in value)
    return value


# Heads whose positives are rare enough to deserve a boost in v25 mode.
RARE_OBJECT_HEADS = {"tuplet", "cross_staff", "shared_head",
                     "duration_tuplet_ratio", "duration_grace",
                     "pitch_accidental"}
RARE_RELATION_HEADS = {"tie", "cross_staff_relation", "shared_head_ownership"}

# UTF-8 byte values that are pure JSON syntax in the notation codec stream.
# Tokens store byte+OFFSET(3); syntax bytes get syntax_weight, content bytes 1.
SYNTAX_BYTES = {0x7B, 0x7D, 0x5B, 0x5D, 0x22, 0x2C, 0x3A}  # { } [ ] " , :


def _focal_ce(logits, target, mask, gamma):
    # Keep supervision on the same device as model logits.
    target = target.to(device=logits.device, non_blocking=True)
    mask = mask.to(device=logits.device, non_blocking=True)
    ce = F.cross_entropy(logits.flatten(0, -2), target.clamp_min(0).flatten(),
                         reduction="none").reshape_as(mask)
    if gamma > 0:
        prob = logits.softmax(-1).gather(-1, target.clamp_min(0).unsqueeze(-1)).squeeze(-1)
        ce = ce * (1 - prob).clamp_min(0) ** gamma
    return (ce * mask).sum() / mask.sum().clamp_min(1)


def _head_loss(logits, payload, weight, gamma):
    mask = payload["mask"].to(logits.dtype)
    denom = mask.sum()
    if int(payload["mask"].sum()) == 0:
        return logits.sum() * 0, denom
    return weight * _focal_ce(logits, payload["target"], mask, gamma), denom


def _macro_pass(outputs, targets, rare_boost, gamma):
    """Mean over heads (not over labels): a rare family contributes as much
    as a common one. Within a head, masked mean over supervised positions."""
    total = next(iter(outputs["object"].values())).sum() * 0
    count = total.detach().clone()
    groups = 0
    for group, rare in (("object", RARE_OBJECT_HEADS),
                        ("relation", RARE_RELATION_HEADS),
                        ("context", set())):
        parts = []
        for head, logits in outputs[group].items():
            payload = targets.get(group, {}).get(head)
            if payload is None:
                continue
            weight = rare_boost if head in rare else 1.0
            loss, denom = _head_loss(logits, payload, weight, gamma)
            parts.append((loss, denom > 0))
            count = count + denom
        if parts:
            group_loss = sum(v for v, _ in parts) / len(parts)
            total = total + group_loss
            groups += 1
    for head, prediction in outputs.get("regression", {}).items():
        payload = targets.get("regression", {}).get(head)
        if payload is None:
            continue
        mask = payload["mask"].to(prediction.dtype)
        total = total + .1 * (F.smooth_l1_loss(
            prediction, payload["target"], reduction="none") * mask).sum() / mask.sum().clamp_min(1)
    return total, count


def _notation_loss(outputs, targets, syntax_weight):
    if "notation" not in outputs or "notation" not in targets:
        return None, None
    payload, logits = targets["notation"], outputs["notation"]
    target = payload["target"].reshape(-1).clamp_min(0)
    mask = payload["mask"].reshape(-1).to(logits.dtype)
    ce = F.cross_entropy(logits.reshape(-1, logits.shape[-1]), target, reduction="none")
    if syntax_weight != 1.0:
        raw = (payload["target"].reshape(-1).clamp_min(0) - 3).tolist()
        is_syntax = torch.tensor([int(b) in SYNTAX_BYTES for b in raw],
                                 device=logits.device, dtype=torch.bool)
        weight = torch.where(
            is_syntax,
            torch.tensor(syntax_weight, device=logits.device, dtype=logits.dtype),
            torch.tensor(1.0, device=logits.device, dtype=logits.dtype))
        ce = ce * weight
    denom = mask.sum()
    return (ce * mask).sum() / denom.clamp_min(1), denom


def _event_loss(outputs, targets, weight):
    payload = (targets.get("attachment") or {}).get("event")
    affinity = (outputs.get("attachment") or {}).get("event_affinity")
    if payload is None or affinity is None or weight == 0:
        return None, None
    mask = payload["mask"].to(affinity.dtype)
    if int(payload["mask"].sum()) == 0:
        return affinity.sum() * 0, mask.sum()
    bce = F.binary_cross_entropy_with_logits(affinity, payload["target"].to(affinity.dtype),
                                             reduction="none")
    denom = mask.sum()
    return weight * (bce * mask).sum() / denom.clamp_min(1), denom


def _pointer_loss(outputs, targets, weight):
    payload = (targets.get("attachment") or {}).get("pointer")
    logits = (outputs.get("attachment") or {}).get("pointer")
    if payload is None or logits is None or weight == 0:
        return None, None
    mask = payload["mask"].to(logits.dtype)
    if int(payload["mask"].sum()) == 0:
        return logits.sum() * 0, mask.sum()
    ce = F.cross_entropy(logits.flatten(0, -2), payload["target"].clamp_min(0).flatten(),
                         reduction="none").reshape_as(mask)
    denom = mask.sum()
    return weight * (ce * mask).sum() / denom.clamp_min(1), denom


def _voice_consistency(outputs, batch, weight):
    """Label-free: lane-continuation probabilities should be symmetric and
    transitive. Penalizes structural contradiction, never invents labels."""
    if weight == 0 or "lane_continuation" not in outputs.get("relation", {}):
        return None
    logits = outputs["relation"]["lane_continuation"]
    prob = logits.softmax(-1)[..., 1]
    index = batch["relation_index"]
    mask = batch["relation_mask"].to(prob.dtype)
    b, m = prob.shape
    # Symmetry over mutual pairs present in the built relation set.
    pair_id = index[..., 0] * 4096 + index[..., 1]
    rev_id = index[..., 1] * 4096 + index[..., 0]
    rev_pos = torch.zeros_like(pair_id)
    for row in range(b):
        table = {int(k): v for v, k in enumerate(pair_id[row].tolist())}
        rev_pos[row] = torch.tensor([table.get(int(k), -1) for k in rev_id[row].tolist()],
                                    device=prob.device)
    valid = (rev_pos >= 0) & (mask > 0)
    sym = (prob.gather(1, rev_pos.clamp_min(0)) - prob).square() * valid
    # Transitivity over sampled triples sharing a middle node.
    tri = torch.zeros((), device=prob.device, dtype=prob.dtype)
    tri_n = 0
    mid = index[..., 1]
    for row in range(min(b, 2)):
        succ = {}
        for e in range(m):
            if mask[row, e] > 0:
                succ.setdefault(int(index[row, e, 0]), []).append(e)
        edges = [e for e in range(m) if mask[row, e] > 0][:256]
        for e in edges:
            a, c = int(index[row, e, 0]), int(index[row, e, 1])
            for f in succ.get(c, [])[:8]:
                d = int(index[row, f, 1])
                g = next((h for h in succ.get(a, []) if int(index[row, h, 1]) == d), None)
                if g is None:
                    continue
                implied = (prob[row, e] * prob[row, f]).detach()
                tri = tri + (prob[row, g] - implied).square() * (prob[row, g] < implied)
                tri_n += 1
    denom = valid.sum().clamp_min(1) + tri_n
    return weight * (sym.sum() + tri) / denom


def _tie_pitch_consistency(outputs, batch, weight):
    """Label-free: a confident tie between different-sounding notes is a
    contradiction. Uses predicted pitch distributions, never targets."""
    if weight == 0 or "tie" not in outputs.get("relation", {}):
        return None
    tie = outputs["relation"]["tie"].softmax(-1)[..., 1].detach()
    mask = batch["relation_mask"].to(tie.dtype)
    agree = torch.ones_like(tie)
    for head in ("pitch_written_step", "pitch_octave", "pitch_accidental"):
        if head not in outputs.get("object", {}):
            continue
        p = outputs["object"][head].softmax(-1)
        left = torch.gather(p, 1, batch["relation_index"][..., 0, None].expand(-1, -1, p.shape[-1]))
        right = torch.gather(p, 1, batch["relation_index"][..., 1, None].expand(-1, -1, p.shape[-1]))
        agree = agree * (left * right).sum(-1)
    penalty = (tie * (1 - agree) * mask).sum() / mask.sum().clamp_min(1)
    return weight * penalty


TYPE_QUARTERS = {"unknown": 0.0, "maxima": 32.0, "long": 16.0, "breve": 8.0,
                 "whole": 4.0, "half": 2.0, "quarter": 1.0, "eighth": 0.5,
                 "16th": 0.25, "32nd": 0.125, "64th": 1 / 16, "128th": 1 / 32,
                 "256th": 1 / 64}
_DURATION_ORDER = tuple(TYPE_QUARTERS)
_DOT_MULT = [1.0, 1.5, 1.75, 1.875]


def _duration_consistency(outputs, batch, targets, weight):
    """Label-free where possible: expected quarters from the predicted
    (type, dots) distribution should agree with the regression prediction,
    weighted toward confidently non-grace, non-tuplet rows."""
    if weight == 0 or "duration_quarters" not in outputs.get("regression", {}):
        return None
    obj = outputs.get("object", {})
    if not all(h in obj for h in ("duration_type", "duration_dots", "duration_grace", "tuplet")):
        return None
    type_p = obj["duration_type"].softmax(-1)
    dots_p = obj["duration_dots"].softmax(-1)
    table = torch.tensor(
        [[TYPE_QUARTERS[t] * _DOT_MULT[d] for d in range(4)] for t in _DURATION_ORDER],
        device=type_p.device, dtype=type_p.dtype)
    expected = ((type_p.unsqueeze(-1) * dots_p.unsqueeze(-2))
                .reshape(type_p.shape[0], type_p.shape[1], 52) @ table.flatten())
    plain = obj["duration_grace"].softmax(-1)[..., 0] * obj["tuplet"].softmax(-1)[..., 0]
    reg_mask = (targets.get("regression", {}).get("duration_quarters") or {}).get("mask")
    if reg_mask is None:
        return None
    w = (plain * reg_mask.to(plain.dtype)).detach()
    diff = (expected - outputs["regression"]["duration_quarters"]).square()
    return weight * (diff * w).sum() / w.sum().clamp_min(1)


def semantic_loss_v25(outputs, targets, batch=None, config=None,
                      initial_weight=0.3, ordinal_weight=0.0,
                      consistency_scale=1.0):
    """Full V2.5 objective. Returns (loss, supervised_count, components).

    consistency_scale ramps the label-free structural penalties (0 during
    new-head warmup, 1.0 once co-adapting); supervised terms are unaffected.
    """
    # Keep all supervision and structural indices on the same device as
    # the model outputs.  This covers classification, regression, notation,
    # attachment and consistency losses in one place.
    device = next(iter(outputs["object"].values())).device
    targets = _tree_to_device(targets, device)
    if batch is not None:
        batch = _tree_to_device(batch, device)

    _ = ordinal_weight
    mode = getattr(config, "loss_mode", "v25") if config is not None else "v25"
    rare_boost = getattr(config, "rare_boost", 3.0) if config is not None else 3.0
    gamma = getattr(config, "focal_gamma", 1.0) if config is not None else 1.0
    syntax_w = getattr(config, "syntax_weight", 0.2) if config is not None else 0.2
    if mode == "v2":
        loss, count = _v2_pass_loss(outputs, targets)
    else:
        loss, count = _macro_pass(outputs, targets, rare_boost, gamma)
    components = {"semantic": float(loss.detach())}
    if outputs.get("initial") is not None and initial_weight:
        if mode == "v2":
            deep, _ = _v2_pass_loss(outputs["initial"], targets)
        else:
            deep, _ = _macro_pass(outputs["initial"], targets, rare_boost, gamma)
        loss = loss + initial_weight * deep
        components["deep"] = float(deep.detach())
    notation, notation_count = _notation_loss(outputs, targets, syntax_w if mode == "v25" else 1.0)
    if notation is not None:
        loss = loss + notation
        count = count + notation_count
        components["notation"] = float(notation.detach())
    event_w = getattr(config, "event_weight", 0.5) if config is not None else 0.5
    event, event_count = _event_loss(outputs, targets, event_w if mode == "v25" else 0.0)
    if event is not None:
        loss = loss + event
        count = count + event_count
        components["event"] = float(event.detach())
    pointer_w = getattr(config, "pointer_weight", 1.0) if config is not None else 1.0
    pointer, pointer_count = _pointer_loss(outputs, targets, pointer_w if mode == "v25" else 0.0)
    if pointer is not None:
        loss = loss + pointer
        count = count + pointer_count
        components["pointer"] = float(pointer.detach())
    if mode == "v25" and batch is not None and consistency_scale > 0:
        for name, value in (
                ("voice", _voice_consistency(outputs, batch,
                                             getattr(config, "voice_consistency_weight", 0.2))),
                ("tie_pitch", _tie_pitch_consistency(outputs, batch,
                                                     getattr(config, "tie_pitch_weight", 0.3))),
                ("duration", _duration_consistency(outputs, batch, targets,
                                                   getattr(config, "duration_consistency_weight", 0.2)))):
            if value is not None:
                loss = loss + consistency_scale * value
                components[name] = float((consistency_scale * value).detach())
    return loss, count, components
