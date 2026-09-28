"""Ordinal-grounded attachment supervision for Piano Vision V2.

D1 lesson (do not repeat): the attachment target ``note_index`` is an XML
document ordinal (``semanticEventIds`` like ``P1-m3-n7``, where ``n7`` counts
``<note>`` elements in document order). Ranking candidates by geometric
distance and treating that rank as the ordinal conflates two different
orderings: geometric rank != XML ordinal. Larger K made it monotonically
worse and damaged notation-type, fermata and metronome families.

This module therefore separates the two orderings explicitly:

* TARGET (supervision only): the XML document ordinal, parsed from
  ``semanticEventIds`` and densely ranked to scope-local classes 0..31
  (+ an explicit overflow class). Never derived from geometry.
* FEATURES (model input only): staff-local x-ascending rank and global
  x-rank computed from source geometry. The head must *learn* the mapping
  from geometric rank to XML ordinal; identity is never assumed.

Notation-type recognition (object/context heads and the shared region
notation decoder) is untouched by this module. Stage-A training freezes
everything except the new attachment head (see ``model.set_ordinal_stage``).
"""

import re

import numpy as np
import torch
import torch.nn.functional as F

from ..data import _center

ALLOWED_SPLITS = ("train", "validation")

# Supported ordinal range: dense scope-local XML-ordinal classes 0..31.
ORDINAL_CLASSES = 32
# Explicit bucket for scopes with more than 32 attachable events.
OVERFLOW_CLASS = 32
N_ATTACHMENT_CLASSES = 33
# Geometry features per object: [staff_id, staff_local_x_rank, global_x_rank, x_center].
ORDINAL_GEO_FEATURES = 4

# ``P1-m3-n7`` -> serial 7. Serial counts <note> elements in part document
# order starting at 1 (see tools/semantic-gold/assembler.mjs).
EVENT_ORDINAL = re.compile(r"-n(\d+)$")


def parse_event_ordinal(event_id):
    """Return the 1-based XML document serial, or None if unparseable."""
    if not isinstance(event_id, str):
        return None
    match = EVENT_ORDINAL.search(event_id)
    if not match:
        return None
    try:
        serial = int(match.group(1))
    except ValueError:
        return None
    return serial if serial >= 1 else None


def _check_record_split(record):
    if record.get("split") not in ALLOWED_SPLITS:
        raise PermissionError("Ordinal supervision can open only train and validation")
    if record.get("provenance", {}).get("runtimeTruthInputs") != []:
        raise ValueError("Runtime truth firewall violation")


def ordinal_geometry_features(selected):
    """Source-only geometry features. Never reads ``target``.

    Staff assignment reuses the nearest-band rule from ``build_inputs``
    (source geometry only). Annotated staff from labels must NOT enter
    features; cross-staff notes may legitimately disagree with this guess
    and the head must learn around that.
    """
    rows = []
    for _scope, _local, obj, row in selected:
        cx, cy = _center(obj)
        bands = ((row.get("input") or {}).get("modelInput") or {}).get("geometry", {}).get("staffBands", {})
        staff_list = bands.get("staffBands", []) if isinstance(bands, dict) else []
        staff = -1
        if staff_list:
            staff = min(
                range(len(staff_list)),
                key=lambda k: abs(cy - (float(staff_list[k]["y0"]) + float(staff_list[k]["y1"])) / 2),
            )
        rows.append({"cx": cx, "staff": staff})
    by_scope_staff = {}
    by_scope = {}
    for i, (entry, (scope, _local, _obj, _row)) in enumerate(zip(rows, selected)):
        by_scope_staff.setdefault((scope, entry["staff"]), []).append((entry["cx"], i))
        by_scope.setdefault(scope, []).append((entry["cx"], i))
    staff_rank = np.zeros(len(rows), dtype=np.float32)
    global_rank = np.zeros(len(rows), dtype=np.float32)
    for group in by_scope_staff.values():
        order = sorted(group)
        denom = max(1, len(order) - 1)
        for rank, (_cx, i) in enumerate(order):
            staff_rank[i] = rank / denom
    for group in by_scope.values():
        order = sorted(group)
        denom = max(1, len(order) - 1)
        for rank, (_cx, i) in enumerate(order):
            global_rank[i] = rank / denom
    features = np.zeros((len(rows), ORDINAL_GEO_FEATURES), dtype=np.float32)
    for i, entry in enumerate(rows):
        features[i] = [min(max(entry["staff"], -1), 7) / 8.0, staff_rank[i], global_rank[i], entry["cx"]]
    return features


def attach_ordinal_targets(sample, record, selected, lookup):
    """Target-only adapter. Reads labels; must not alter features.

    One mask per current-scope object: the dense scope-local rank of its
    attached XML serial. Multi-event objects (shared heads / role
    multiplicity) and cross-family conflicts stay masked with reasons,
    consistent with the RFC: one pitch/duration/lane tuple cannot encode
    multiple independently timed roles.
    """
    from collections import Counter
    _check_record_split(record)
    n = len(selected)
    target = np.full(n, -1, dtype=np.int64)
    mask = np.zeros(n, dtype=bool)
    reasons = Counter()
    serials = {}
    staff_of = {}
    pitch_staff = {}
    for label in record.get("target", {}).get("families", {}).get("PITCH_STAFF", []):
        if label.get("state") != "KNOWN" or len(label.get("objectIndexes", [])) != 1:
            continue
        i = lookup.get((record["exampleId"], label["objectIndexes"][0]))
        if i is None:
            continue
        staff = (label.get("value") or {}).get("staff")
        if staff in (1, 2, 3):
            pitch_staff[i] = staff
    for family, labels in record.get("target", {}).get("families", {}).items():
        for lab in labels:
            if lab.get("state") != "KNOWN" or len(lab.get("objectIndexes", [])) != 1:
                continue
            i = lookup.get((record["exampleId"], lab.get("objectIndexes")[0]))
            if i is None:
                continue
            ids = lab.get("semanticEventIds") or []
            parsed = {parse_event_ordinal(e) for e in ids}
            parsed.discard(None)
            if not parsed:
                if ids:
                    reasons["unparseable_event_id"] += 1
                continue
            if len(parsed) > 1:
                # Multiple distinct XML events on one physical object:
                # shared-head / multi-role multiplicity, explicitly unsupported.
                reasons["multi_event_conflict"] += 1
                serials.setdefault(i, set()).update(parsed)
                continue
            serial = next(iter(parsed))
            if i in serials and serial not in serials[i]:
                reasons["cross_family_conflict"] += 1
            serials.setdefault(i, set()).add(serial)
    conflicting = {i for i, values in serials.items() if len(values) > 1}
    agreed = {i: next(iter(values)) for i, values in serials.items() if len(values) == 1}
    ordered = sorted(set(agreed.values()))
    rank_of = {serial: rank for rank, serial in enumerate(ordered)}
    attached = 0
    for i, serial in agreed.items():
        rank = rank_of[serial]
        if rank >= ORDINAL_CLASSES:
            target[i] = OVERFLOW_CLASS
            mask[i] = True
            reasons["overflow_rank"] += 1
        else:
            target[i] = rank
            mask[i] = True
        attached += 1
        staff_of[i] = pitch_staff.get(i)
    for i in conflicting:
        reasons["conflicting_object_masked"] += 1
    sample = dict(sample)
    sample["targets"] = dict(sample.get("targets", {}))
    sample["targets"]["attachment"] = {
        "ordinal": {"target": torch.from_numpy(target), "mask": torch.from_numpy(mask)},
    }
    metadata = dict(sample.get("metadata", {}))
    metadata["ordinal_mask_reasons"] = dict(reasons)
    metadata["ordinal_attached_current"] = attached
    metadata["ordinal_scope_serials"] = ordered
    # Analysis only: annotated staff per attached object. Never a feature.
    metadata["ordinal_annotated_staff"] = {str(i): staff_of.get(i) for i in agreed}
    sample["metadata"] = metadata
    return sample


def attach_ordinal_features(sample, selected):
    """Append source-only geometry features for the attachment head."""
    sample = dict(sample)
    sample["object_ordinal_features"] = torch.from_numpy(ordinal_geometry_features(selected))
    return sample


def ordinal_metrics(logits, target, mask):
    """Teacher-forced masked accuracy plus majority-class reference."""
    if logits.ndim != 2 or logits.shape[1] != N_ATTACHMENT_CLASSES:
        raise ValueError("Ordinal logits must have 33 classes")
    target = target.clamp_min(0)
    mask = mask.to(torch.bool)
    total = int(mask.sum())
    if total == 0:
        return {"labels": 0, "accuracy": None, "majority_accuracy": None,
                "correct": 0, "majority_correct": 0}
    pred = logits.argmax(-1)
    correct = int(((pred == target) & mask).sum())
    flat = target[mask]
    majority = int(flat.mode().values)
    majority_correct = int((flat == majority).sum())
    return {"labels": total, "accuracy": correct / total,
            "majority_accuracy": majority_correct / total,
            "correct": correct, "majority_correct": majority_correct,
            "majority_class": majority}


def ordinal_loss_value(logits, target, mask):
    """Masked cross-entropy. Empty masks contribute exact zero (finite)."""
    mask_f = mask.to(logits.dtype)
    denom = mask_f.sum()
    if int(mask.sum()) == 0:
        return logits.sum() * 0
    ce = F.cross_entropy(logits.flatten(0, -2), target.clamp_min(0).flatten(), reduction="none").reshape_as(mask_f)
    return (ce * mask_f).sum() / denom.clamp_min(1)


def ordinal_alignment_report(sample):
    """Quantify rank-vs-ordinal agreement on supervised objects.

    Documents the D1 lesson per scope: high disagreement between the
    staff-local geometric rank (feature) and the XML ordinal (target) is
    expected and is exactly why rank must never be used as the target.
    """
    import torch as _torch
    payload = (sample.get("targets", {}) or {}).get("attachment", {}).get("ordinal")
    if payload is None:
        return {"supervised": False}
    mask = payload["mask"]
    if not bool(mask.any()):
        return {"supervised": True, "labels": 0}
    geo = sample.get("object_ordinal_features")
    if geo is None:
        return {"supervised": True, "labels": int(mask.sum()), "geometric_rank_available": False}
    order = _torch.argsort(geo[:, 1], stable=True)
    rank_of = _torch.empty_like(order)
    rank_of[order] = _torch.arange(len(order))
    # Dense-rank the XML targets to the same 0..K-1 scale for comparison.
    tgt = payload["target"]
    agree = int(((rank_of == tgt) & mask).sum())
    total = int(mask.sum())
    return {"supervised": True, "labels": total, "geometric_rank_available": True,
            "rank_equals_ordinal": agree, "rank_ordinal_agreement": agree / total,
            "note": "Agreement below 1.0 is expected; rank is a feature, never the target."}


# ---------------------------------------------------------------------------
# Frozen epoch-1 baseline (reported by the RTX worker; no local copy of the
# checkpoint exists in this checkout, so these are recorded as opaque
# acceptance numbers, not recomputed values).
# ---------------------------------------------------------------------------

BASELINE_FREEZE = {
    "checkpoint": "checkpoint-final.pt",
    "variant": "MEDIUM",
    "refinement": "FULL",
    "step": 35000,
    "full_validation": {"examples": 63086, "evaluated": 63086, "failed_chunks": 0},
    "metrics": {
        "written_pitch_accuracy": 0.9187656751920548,
        "derived_midi_accuracy": 0.9187908273626871,
        "duration_accuracy": 0.9458830913744312,
        "duration_mae_quarters": 0.027465354185764575,
        "token_accuracy": 0.9961283166095038,
        "tie_f1": 0.9589653230640678,
        "tuplet_f1": 0.8083833142395039,
        "object_lane_accuracy": 0.687525,
        "object_pitch_accidental_accuracy": 0.956774,
    },
    "supersedes": "checkpoint-best",
    "provenance": "RTX worker full-validation report; recorded verbatim, not recomputed on Mac",
}

# Acceptance gates for the ordinal-attachment candidate vs the frozen baseline.
GATES = {
    # Max absolute drop in notation-type (object/context head) accuracy.
    "notation_type_regression_tolerance": 0.002,
    # Max absolute drop in staff/voice (pitch_staff, lane) accuracy.
    "staff_voice_regression_tolerance": 0.002,
    # Min absolute ordinal-accuracy gain over the same-mask majority baseline.
    "ordinal_min_absolute_gain": 0.10,
    # Min relative ordinal error-rate reduction vs majority baseline.
    "ordinal_min_error_reduction": 0.25,
    # Max absolute drop per family on the frozen generation cohort.
    "generation_family_regression_tolerance": 0.01,
}


def gate_report(candidate, baseline_heads=None, generation=None):
    """Decide PASS/FAIL/PENDING against the frozen baseline.

    ``candidate``: dict with ``ordinal`` (from ``ordinal_metrics``) and
    ``head_deltas`` mapping head name -> (candidate_acc, baseline_acc).
    ``generation``: None (PENDING) or dict family -> (candidate_f1, baseline_f1).
    """
    gates = []
    ordinal = candidate.get("ordinal") or {}
    if not ordinal.get("labels"):
        gates.append({"gate": "ordinal_labels_present", "status": "FAIL",
                      "detail": "no supervised ordinal labels"})
    else:
        acc = ordinal["accuracy"] or 0.0
        maj = ordinal["majority_accuracy"] or 0.0
        gain = acc - maj
        acc_err = 1 - acc
        maj_err = 1 - maj
        err_reduction = (maj_err - acc_err) / maj_err if maj_err > 0 else 0.0
        gates.append({"gate": "ordinal_absolute_gain", "status": "PASS" if gain >= GATES["ordinal_min_absolute_gain"] else "FAIL",
                      "detail": f"gain={gain:.4f} acc={acc:.4f} majority={maj:.4f}"})
        gates.append({"gate": "ordinal_error_reduction", "status": "PASS" if err_reduction >= GATES["ordinal_min_error_reduction"] else "FAIL",
                      "detail": f"reduction={err_reduction:.4f}"})
    for head, pair in (candidate.get("head_deltas") or {}).items():
        new, old = pair
        if new is None or old is None:
            gates.append({"gate": f"head_{head}_measured", "status": "FAIL", "detail": "missing accuracy"})
            continue
        tol = GATES["staff_voice_regression_tolerance"] if head in ("pitch_staff", "lane") else GATES["notation_type_regression_tolerance"]
        gates.append({"gate": f"head_{head}_stable", "status": "PASS" if new - old >= -tol else "FAIL",
                      "detail": f"candidate={new:.4f} baseline={old:.4f} tol={tol}"})
    if generation is None:
        gates.append({"gate": "generation_cohort", "status": "PENDING",
                      "detail": "frozen generation cohort not evaluated; required on RTX worker"})
    else:
        for family, pair in generation.items():
            new, old = pair
            ok = new - old >= -GATES["generation_family_regression_tolerance"]
            gates.append({"gate": f"generation_{family}_stable", "status": "PASS" if ok else "FAIL",
                          "detail": f"candidate={new:.4f} baseline={old:.4f}"})
    statuses = [g["status"] for g in gates]
    verdict = "FAIL" if "FAIL" in statuses else "PENDING" if "PENDING" in statuses else "PASS"
    return {"verdict": verdict, "gates": gates, "baseline": BASELINE_FREEZE["checkpoint"],
            "tolerances": GATES}
