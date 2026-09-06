"""Deterministic musical-consistency gate for structured candidates.

This is deliberately non-neural. It consumes decoded candidates plus their
confidence/coverage and can reject or abstain without changing model weights.
"""

from __future__ import annotations

from collections import defaultdict


PRIMARY_FAMILIES = (
    "pitch", "duration", "attack", "chord", "lane", "lane_continuation",
    "rest", "tuplet", "tie", "cross_staff", "shared_head",
)
RELATION_FAMILIES = ("attack", "chord", "lane_continuation", "tie", "cross_staff", "shared_head")


def _capacity(time_signature):
    if not time_signature:
        return None
    beats = time_signature.get("beats")
    beat_type = time_signature.get("beat_type") or time_signature.get("beatType")
    if beats is None or not beat_type:
        return None
    return float(beats) * 4.0 / float(beat_type)


def verify_scope(candidate, complete_threshold=0.82, capacity_tolerance=1e-4):
    reasons = []
    families = candidate.get("families", {})
    missing = []
    for family in PRIMARY_FAMILIES:
        row = families.get(family)
        if not row or not row.get("available", True) or not row.get("offered"):
            missing.append(family)
            continue
        if float(row.get("confidence", 0)) < float(complete_threshold):
            reasons.append(f"LOW_CONFIDENCE:{family}")
        if family in RELATION_FAMILIES and not row.get("candidate_complete", False):
            reasons.append(f"RELATION_CANDIDATE_INCOMPLETE:{family}")
    if candidate.get("truncated_objects") or candidate.get("relation_capacity_reached"):
        reasons.append("SOURCE_CANDIDATE_CAPACITY_EXCEEDED")
    if candidate.get("residual_solutions", 1) > int(candidate.get("residual_solution_limit", 24)):
        reasons.append("EXCESSIVE_RESIDUAL_AMBIGUITY")

    events = candidate.get("events", [])
    by_chord = defaultdict(list)
    by_lane = defaultdict(list)
    event_by_id = {}
    for event in events:
        event_by_id[event.get("id")] = event
        if event.get("chord") is not None:
            by_chord[event["chord"]].append(event)
        if event.get("lane") is not None:
            by_lane[event["lane"]].append(event)
    for chord, rows in by_chord.items():
        attacks = {row.get("attack") for row in rows}
        durations = {round(float(row.get("duration_quarters", 0)), 6) for row in rows if not row.get("grace")}
        if len(attacks) > 1:
            reasons.append(f"CHORD_ATTACK_DISAGREEMENT:{chord}")
        if len(durations) > 1:
            reasons.append(f"CHORD_DURATION_DISAGREEMENT:{chord}")
    for lane, rows in by_lane.items():
        attacks = [float(row.get("attack", 0)) for row in rows]
        if any(right < left for left, right in zip(attacks, attacks[1:])):
            reasons.append(f"LANE_ATTACK_ORDER:{lane}")
    for event in events:
        target_id = event.get("tie_to")
        if target_id is None:
            continue
        target = event_by_id.get(target_id)
        if target is None:
            reasons.append(f"TIE_ENDPOINT_MISSING:{event.get('id')}")
        elif event.get("written_pitch") != target.get("written_pitch"):
            reasons.append(f"TIE_PITCH_MISMATCH:{event.get('id')}")

    capacity = _capacity(candidate.get("time_signature"))
    irregular = bool(candidate.get("irregular_measure") or candidate.get("pickup"))
    if capacity is not None and not irregular:
        for lane, rows in by_lane.items():
            total = sum(float(row.get("duration_quarters", 0)) for row in rows if not row.get("grace"))
            if total > capacity + capacity_tolerance:
                reasons.append(f"MEASURE_CAPACITY_EXCEEDED:{lane}:{total:.6f}>{capacity:.6f}")
            if candidate.get("require_exact_capacity") and abs(total - capacity) > capacity_tolerance:
                reasons.append(f"MEASURE_CAPACITY_MISMATCH:{lane}:{total:.6f}!={capacity:.6f}")

    if missing:
        status = "ABSTAIN"
        reasons.insert(0, "MISSING_OR_UNOFFERED:" + ",".join(missing))
    elif reasons:
        status = "REJECTED"
    else:
        status = "COMPLETE"
    return {
        "status": status,
        "complete": status == "COMPLETE",
        "abstained": status == "ABSTAIN",
        "rejected": status == "REJECTED",
        "reasons": reasons,
        "candidate_confidence": min((float(row.get("confidence", 0)) for row in families.values()), default=0.0),
        "wrong_complete_guard": "RELATION_CANDIDATE_COMPLETENESS_GATE_AND_MUSICAL_CONSTRAINTS",
    }
