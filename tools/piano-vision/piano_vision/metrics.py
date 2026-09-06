"""Streaming per-family metrics and complete-measure safety metrics."""

from __future__ import annotations

from collections import defaultdict

import torch

from .model import derive_midi


FAMILY_HEADS = {
    "PITCH_STAFF": ("object", ("pitch_staff_step", "pitch_written_step", "pitch_octave", "pitch_accidental", "pitch_staff")),
    "DURATION": ("object", ("duration_type", "duration_dots", "duration_tuplet_ratio", "duration_grace")),
    "ATTACK": ("relation", ("attack",)),
    "CHORD": ("relation", ("chord",)),
    "LANE": ("object", ("lane",)),
    "LANE_CONTINUATION": ("relation", ("lane_continuation",)),
    "REST": ("object", ("rest",)),
    "TUPLET": ("object", ("tuplet",)),
    "TIE_SUSTAIN": ("relation", ("tie",)),
    "CROSS_STAFF": ("object", ("cross_staff",)),
    "SHARED_HEAD": ("object", ("shared_head",)),
}
BINARY = {
    "attack", "chord", "lane_continuation", "rest", "tuplet", "tie",
    "cross_staff", "cross_staff_relation", "measure_irregular", "arpeggio",
}


class MetricAccumulator:
    def __init__(self, offer_threshold=0.72, complete_threshold=0.82):
        self.offer_threshold = float(offer_threshold)
        self.complete_threshold = float(complete_threshold)
        self.heads = defaultdict(lambda: {"correct": 0, "total": 0, "tp": 0, "fp": 0, "fn": 0, "abstain": 0})
        self.regression = defaultdict(lambda: {"absolute_error": 0.0, "total": 0})
        self.pitch_full_correct = 0
        self.pitch_full_total = 0
        self.pitch_midi_correct = 0
        self.pitch_midi_total = 0
        self.duration_full_correct = 0
        self.duration_full_total = 0
        self.scopes = 0
        self.complete = 0
        self.wrong_complete = 0
        self.abstained_scopes = 0
        self.defect_weight_total = 0
        self.defect_weight_correct = 0
        self.family_scope = defaultdict(lambda: {"offered": 0, "correct": 0, "applicable": 0, "abstained": 0})

    @staticmethod
    def _confidence(logits):
        probability = torch.softmax(logits, dim=-1)
        return probability.max(-1).values

    def update(self, outputs, batch):
        batch_size = batch["image"].shape[0]
        predictions = {}
        confidence = {}
        for group in ("object", "relation", "scope"):
            predictions[group] = {head: logits.argmax(-1) for head, logits in outputs[group].items()}
            confidence[group] = {head: self._confidence(logits) for head, logits in outputs[group].items()}
            for head, prediction in predictions[group].items():
                payload = batch["targets"][group].get(head)
                if payload is None:
                    continue
                mask = payload["mask"]
                target = payload["target"]
                count = int(mask.sum().item())
                if not count:
                    continue
                offered = confidence[group][head] >= self.offer_threshold
                values = self.heads[head]
                values["correct"] += int(((prediction == target) & mask).sum().item())
                values["total"] += count
                values["abstain"] += int((~offered & mask).sum().item())
                if head in BINARY:
                    values["tp"] += int(((prediction == 1) & (target == 1) & mask).sum().item())
                    values["fp"] += int(((prediction == 1) & (target == 0) & mask).sum().item())
                    values["fn"] += int(((prediction == 0) & (target == 1) & mask).sum().item())

        for head, prediction in outputs["regression"].items():
            payload = batch["targets"]["regression"].get(head)
            if payload is None or not bool(payload["mask"].any()):
                continue
            mask = payload["mask"]
            self.regression[head]["absolute_error"] += float(torch.abs(prediction[mask] - payload["target"][mask]).sum().item())
            self.regression[head]["total"] += int(mask.sum().item())

        pitch_heads = ("pitch_staff_step", "pitch_written_step", "pitch_octave", "pitch_accidental", "pitch_staff")
        pitch_mask = torch.ones_like(batch["targets"]["object"][pitch_heads[0]]["mask"])
        pitch_correct = torch.ones_like(pitch_mask)
        for head in pitch_heads:
            payload = batch["targets"]["object"][head]
            pitch_mask &= payload["mask"]
            pitch_correct &= predictions["object"][head] == payload["target"]
        self.pitch_full_total += int(pitch_mask.sum().item())
        self.pitch_full_correct += int((pitch_correct & pitch_mask).sum().item())
        if bool(pitch_mask.any()):
            predicted_midi = derive_midi(
                predictions["object"]["pitch_written_step"],
                predictions["object"]["pitch_octave"],
                predictions["object"]["pitch_accidental"],
            )
            truth_midi = derive_midi(
                batch["targets"]["object"]["pitch_written_step"]["target"],
                batch["targets"]["object"]["pitch_octave"]["target"],
                batch["targets"]["object"]["pitch_accidental"]["target"],
            )
            self.pitch_midi_total += int(pitch_mask.sum().item())
            self.pitch_midi_correct += int(((predicted_midi == truth_midi) & pitch_mask).sum().item())

        duration_heads = ("duration_type", "duration_dots", "duration_tuplet_ratio", "duration_grace")
        duration_mask = torch.ones_like(batch["targets"]["object"][duration_heads[0]]["mask"])
        duration_correct = torch.ones_like(duration_mask)
        for head in duration_heads:
            payload = batch["targets"]["object"][head]
            duration_mask &= payload["mask"]
            duration_correct &= predictions["object"][head] == payload["target"]
        self.duration_full_total += int(duration_mask.sum().item())
        self.duration_full_correct += int((duration_correct & duration_mask).sum().item())

        for example_index in range(batch_size):
            self.scopes += 1
            metadata = batch["metadata"][example_index]
            scope_offered = True
            scope_correct = True
            applicable_families = 0
            correct_families = 0
            for family, (group, heads) in FAMILY_HEADS.items():
                family_stats = self.family_scope[family]
                if not metadata["availability"].get(family, False):
                    family_stats["abstained"] += 1
                    scope_offered = False
                    continue
                head_applicable = False
                family_offered = True
                family_correct = True
                for head in heads:
                    payload = batch["targets"][group][head]
                    mask = payload["mask"][example_index]
                    if not bool(mask.any()):
                        family_offered = False
                        family_correct = False
                        continue
                    head_applicable = True
                    family_offered &= bool((confidence[group][head][example_index][mask] >= self.complete_threshold).all())
                    family_correct &= bool((predictions[group][head][example_index][mask] == payload["target"][example_index][mask]).all())
                if head_applicable:
                    applicable_families += 1
                    family_stats["applicable"] += 1
                if family_offered:
                    family_stats["offered"] += 1
                    family_stats["correct"] += int(family_correct)
                    correct_families += int(family_correct)
                else:
                    family_stats["abstained"] += 1
                scope_offered &= family_offered
                scope_correct &= family_correct
            unsafe_shape = metadata.get("truncated_objects", 0) > 0 or metadata.get("relation_capacity_reached", False)
            scope_offered &= not unsafe_shape
            self.defect_weight_total += applicable_families
            self.defect_weight_correct += correct_families
            if scope_offered:
                self.complete += int(scope_correct)
                self.wrong_complete += int(not scope_correct)
            else:
                self.abstained_scopes += 1

    def summary(self):
        heads = {}
        for head, values in self.heads.items():
            total = values["total"]
            precision = values["tp"] / max(1, values["tp"] + values["fp"])
            recall = values["tp"] / max(1, values["tp"] + values["fn"])
            row = {
                **values,
                "accuracy": values["correct"] / max(1, total),
                "coverage": (total - values["abstain"]) / max(1, total),
            }
            if head in BINARY:
                row.update(precision=precision, recall=recall, f1=2 * precision * recall / max(1e-12, precision + recall))
            heads[head] = row
        regression = {
            head: {**value, "mae": value["absolute_error"] / max(1, value["total"])}
            for head, value in self.regression.items()
        }
        return {
            "heads": heads,
            "regression": regression,
            "pitch": {
                "full_written_accuracy": self.pitch_full_correct / max(1, self.pitch_full_total),
                "derived_midi_accuracy": self.pitch_midi_correct / max(1, self.pitch_midi_total),
                "examples": self.pitch_full_total,
            },
            "duration": {
                "strict_accuracy": self.duration_full_correct / max(1, self.duration_full_total),
                "examples": self.duration_full_total,
            },
            "families": dict(self.family_scope),
            "measures": {
                "scopes": self.scopes,
                "complete_correct": self.complete,
                "wrong_complete": self.wrong_complete,
                "abstentions": self.abstained_scopes,
                "complete_rate": self.complete / max(1, self.scopes),
                "wrong_complete_rate": self.wrong_complete / max(1, self.scopes),
                "defect_weighted_complete": {
                    "correct": self.defect_weight_correct,
                    "total": self.defect_weight_total,
                    "rate": self.defect_weight_correct / max(1, self.defect_weight_total),
                },
            },
        }
