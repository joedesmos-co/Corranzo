"""Masked, balanced multi-family objectives for Piano Vision."""

from __future__ import annotations

import torch
import torch.nn.functional as F
from torch import nn


PITCH_HEADS = {
    "pitch_staff_step", "pitch_written_step", "pitch_octave",
    "pitch_accidental", "pitch_staff", "pitch_clef", "pitch_key_fifths",
}
DURATION_HEADS = {"duration_type", "duration_dots", "duration_tuplet_ratio", "duration_grace"}
BINARY_HEADS = {
    "rest", "tuplet", "cross_staff", "arpeggio",
    "attack", "chord", "lane_continuation", "tie", "cross_staff_relation",
    "measure_irregular",
}
RARE_HEADS = {"tuplet", "tie", "cross_staff", "cross_staff_relation", "shared_head", "shared_head_ownership"}


def family_for(group, head):
    if head in PITCH_HEADS:
        return "pitch"
    if head in DURATION_HEADS or head == "duration_quarters":
        return "duration"
    if head == "lane":
        return "lane"
    if head == "lane_continuation":
        return "lane_continuation"
    if head in {"cross_staff", "cross_staff_relation"}:
        return "cross_staff"
    if head in {"shared_head", "shared_head_ownership"}:
        return "shared_head"
    if head in {"attack", "chord", "rest", "tuplet", "tie"}:
        return head
    if group == "scope":
        return "scope"
    return "auxiliary"


def supervision_counts(targets):
    counts = {}
    for group in ("object", "relation", "scope"):
        for head, payload in targets[group].items():
            counts[f"{group}.{head}"] = int(payload["mask"].sum())
    for head, payload in targets["regression"].items():
        counts[f"regression.{head}"] = int(payload["mask"].sum())
    return counts


def supervision_count_stats(targets):
    """Per-head supervised count and positive/negative class counts from targets.

    The class counts mirror exactly what _masked_cross_entropy sees, so
    gradient-accumulation can apply window-level class weights and reproduce
    the native-batch objective for binary (class-balanced) heads.
    """
    stats = {}
    for group in ("object", "relation", "scope"):
        for head, payload in targets[group].items():
            mask = payload["mask"]
            positives = int(((payload["target"] == 1) & mask).sum())
            stats[f"{group}.{head}"] = (int(mask.sum()), positives, int(mask.sum()) - positives)
    for head, payload in targets["regression"].items():
        mask = payload["mask"]
        stats[f"regression.{head}"] = (int(mask.sum()), None, None)
    return stats


def _masked_cross_entropy(logits, target, mask, label_smoothing=0.0, focal_gamma=0.0, rare_cap=1.0, class_weight=None):
    flat_mask = mask.reshape(-1)
    count = flat_mask.sum()
    selected_logits = logits.reshape(-1, logits.shape[-1])[flat_mask]
    selected_target = target.reshape(-1)[flat_mask]
    weight = None
    if selected_logits.shape[-1] == 2 and class_weight is not None:
        weight = torch.stack([torch.ones_like(class_weight), class_weight]).to(selected_logits.device)
    elif selected_logits.shape[-1] == 2 and rare_cap > 1:
        positive = (selected_target == 1).sum().to(torch.float32)
        negative = (selected_target == 0).sum().to(torch.float32)
        positive_weight = torch.where(
            positive > 0,
            (negative / positive.clamp_min(1)).clamp(1, rare_cap),
            torch.ones_like(negative),
        )
        weight = torch.stack([torch.ones_like(positive_weight), positive_weight]).to(selected_logits.device)
    loss = F.cross_entropy(
        selected_logits,
        selected_target,
        weight=weight,
        reduction="none",
        label_smoothing=float(label_smoothing),
    )
    if focal_gamma > 0 and selected_logits.shape[-1] == 2:
        probability = torch.softmax(selected_logits, dim=-1).gather(1, selected_target[:, None]).squeeze(1)
        loss = loss * (1.0 - probability).pow(float(focal_gamma))
    loss = loss.mean()
    loss = torch.where(count > 0, loss, torch.zeros_like(loss))
    return loss, count


class MaskedMultiTaskLoss(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.config = dict(config)
        self.family_weights = dict(config.get("family_weights", {}))
        self.label_smoothing = float(config.get("label_smoothing", 0.0))
        self.focal_gamma = float(config.get("focal_gamma", 0.0))
        self.rare_cap = float(config.get("rare_positive_cap", 1.0))

    def forward(self, outputs, targets, window_head_scale=None, window_class_counts=None):
        device = outputs["embeddings"]["scope"].device
        total = outputs["embeddings"]["scope"].sum() * 0.0
        backward_total = outputs["embeddings"]["scope"].sum() * 0.0
        detail_names = []
        detail_losses = []
        detail_counts = []
        detail_weights = []
        family_names = []
        family_totals = []
        family_divisors = []
        supervised = torch.zeros((), dtype=torch.int64, device=device)
        for group in ("object", "relation", "scope"):
            for head, logits in outputs[group].items():
                payload = targets[group].get(head)
                if payload is None:
                    continue
                family = family_for(group, head)
                head_rare_cap = self.rare_cap if head in RARE_HEADS else min(4.0, self.rare_cap)
                head_focal = self.focal_gamma if head in BINARY_HEADS else 0.0
                head_loss, count = _masked_cross_entropy(
                    logits,
                    payload["target"],
                    payload["mask"],
                    label_smoothing=self.label_smoothing,
                    focal_gamma=head_focal,
                    rare_cap=head_rare_cap,
                )
                divisor = len(PITCH_HEADS) if family == "pitch" else len(DURATION_HEADS) if family == "duration" else 1
                weight = float(self.family_weights.get(family, 1.0)) / divisor
                total = total + head_loss * weight
                if window_head_scale is not None or window_class_counts is not None:
                    head_scale = float(window_head_scale.get(f"{group}.{head}", 1.0))
                    head_mean = head_loss
                    if logits.shape[-1] == 2 and window_class_counts is not None:
                        pos_w, neg_w = window_class_counts.get(f"{group}.{head}", (None, None))
                        if pos_w is not None and neg_w is not None:
                            pos_w = torch.tensor(float(pos_w), device=device)
                            neg_w = torch.tensor(float(neg_w), device=device)
                            positive_weight = torch.where(
                                pos_w > 0,
                                (neg_w / pos_w.clamp_min(1)).clamp(1, head_rare_cap),
                                torch.ones_like(neg_w),
                            )
                            head_mean, _ = _masked_cross_entropy(
                                logits,
                                payload["target"],
                                payload["mask"],
                                label_smoothing=self.label_smoothing,
                                focal_gamma=head_focal,
                                rare_cap=head_rare_cap,
                                class_weight=positive_weight,
                            )
                    backward_total = backward_total + head_mean * weight * head_scale
                detail_names.append(f"{group}.{head}")
                detail_losses.append(head_loss.detach())
                detail_counts.append(count)
                detail_weights.append(weight)
                family_totals.append(head_loss.detach())
                family_divisors.append(divisor)
                family_names.append(family)
                supervised = supervised + count
        for head, prediction in outputs["regression"].items():
            payload = targets["regression"].get(head)
            if payload is None:
                continue
            mask = payload["mask"]
            count = mask.sum()
            head_loss = F.smooth_l1_loss(prediction[mask], payload["target"][mask], beta=0.1)
            head_loss = torch.where(count > 0, head_loss, torch.zeros_like(head_loss))
            family = family_for("regression", head)
            divisor = max(1, len(DURATION_HEADS))
            weight = float(self.family_weights.get(family, 1.0)) / divisor
            total = total + head_loss * weight
            if window_head_scale is not None:
                head_scale = float(window_head_scale.get(f"regression.{head}", 1.0))
                backward_total = backward_total + head_loss * weight * head_scale
            detail_names.append(f"regression.{head}")
            detail_losses.append(head_loss.detach())
            detail_counts.append(count)
            detail_weights.append(weight)
            family_totals.append(head_loss.detach())
            family_divisors.append(divisor)
            family_names.append(family)
            supervised = supervised + count
        if detail_losses:
            loss_values = torch.stack(detail_losses).tolist()
            count_values = torch.stack(detail_counts).tolist()
        else:
            loss_values = []
            count_values = []
        details = {
            name: {
                "loss": loss_values[i],
                "supervised": count_values[i],
                "weight": detail_weights[i],
            }
            for i, name in enumerate(detail_names)
        }
        if family_names:
            family_value_list = torch.stack(family_totals).tolist()
            families = {}
            for name, value, divisor in zip(family_names, family_value_list, family_divisors):
                contributions = float(value) / divisor
                families[name] = families.get(name, 0.0) + contributions
        else:
            families = {}
        supervised_int = int(supervised.item())
        if supervised_int == 0:
            raise RuntimeError("Batch contains no available supervision; unavailable truth was not converted to negative truth")
        if window_head_scale is not None:
            return total, {
                "total": float(total.detach()),
                "supervised": supervised_int,
                "heads": details,
                "families": families,
            }, backward_total
        return total, {
            "total": float(total.detach()),
            "supervised": supervised_int,
            "heads": details,
            "families": families,
        }
