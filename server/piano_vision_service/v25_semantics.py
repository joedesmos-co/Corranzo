"""V2.5 semantic decode: object heads + relation heads -> score events.

Everything here reuses the qualified runtime's own vocabulary and decode
helpers. Nothing is hand-rolled:

* ``piano_vision.data.DURATION_TYPES`` / ``TUPLET_RATIOS`` / ``WRITTEN_STEPS``
  are the class vocabularies the heads were trained on.
* ``piano_vision.model.derive_midi`` is the only sanctioned written-pitch ->
  MIDI conversion ("derive MIDI after structured pitch prediction; never a
  learned class").
* ``piano_vision.v25.generation.component_lane_decode`` and
  ``piano_vision.v25.decoding.voice_tracks`` are the canonical lane/voice
  decoders used by the qualification evaluator.
* ``piano_vision.v25.decoding.pointer_owners`` resolves region owners.

Object existence and type stay with the visual detector; V2.5 supplies
pitch, duration, accidental, rest, tuplet, lane, chord and tie semantics.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Sequence

import torch

from piano_vision.data import DURATION_TYPES, TUPLET_RATIOS
from piano_vision.model import WRITTEN_STEPS, derive_midi
from piano_vision.v25.generation import component_lane_decode
from piano_vision.v25.decoding import pointer_owners, voice_tracks

# index -> name, the inverse of piano_vision.data.WRITTEN_STEPS
WRITTEN_STEP_NAMES = tuple(WRITTEN_STEPS)
DURATION_TYPE_NAMES = tuple(DURATION_TYPES)
TUPLET_RATIO_NAMES = tuple(TUPLET_RATIOS)
# index -> (actualNotes, normalNotes); None means "no tuplet".
TUPLET_SCALE = {index: (None if name == "other" or not isinstance(name, tuple)
                        else (name[0] / name[1],))
                for index, name in enumerate(TUPLET_RATIO_NAMES)}

ACCIDENTAL_NAMES = {
    0: "flat-flat-flat", 1: "double-flat", 2: "flat", 3: None,
    4: "sharp", 5: "double-sharp", 6: "sharp-sharp-sharp",
}
MUSICXML_ACCIDENTAL = {
    "flat": "flat", "double-flat": "flat-flat", "flat-flat-flat": "flat-flat-flat",
    "sharp": "sharp", "double-sharp": "double-sharp", "sharp-sharp-sharp": "sharp-sharp-sharp",
}
# MusicXML note-type vocabulary; the extra long values are not writable.
WRITABLE_DURATION_TYPES = {
    "breve": "breve", "whole": "whole", "half": "half", "quarter": "quarter",
    "eighth": "eighth", "16th": "16th", "32nd": "32nd", "64th": "64th",
    "128th": "128th", "256th": "256th",
}
TYPE_QUARTERS = {
    "maxima": 32.0, "long": 16.0, "breve": 8.0, "whole": 4.0, "half": 2.0,
    "quarter": 1.0, "eighth": 0.5, "16th": 0.25, "32nd": 0.125, "64th": 0.0625,
    "128th": 0.03125, "256th": 0.015625,
}


@dataclass
class ObjectSemantics:
    """Decoded V2.5 semantics for one object slot."""

    slot: int
    kind: str
    step: str
    octave: int
    alter: int
    midi: int
    staff: int
    rest: bool
    rest_probability: float
    duration_type: str
    dots: int
    tuplet_ratio: int
    tuplet: bool
    grace: bool
    lane: int
    pitch_confidence: float
    duration_confidence: float
    duration_quarters: float
    chord_with: Optional[int] = None
    note_index: Optional[int] = None
    tie_start: bool = False
    tie_stop: bool = False


@dataclass
class MeasureSemantics:
    """Everything decoded for one measure, still keyed by object slot."""

    measure_number: int
    objects: list[ObjectSemantics]
    onsets: list[list[int]] = field(default_factory=list)
    voices: dict[int, int] = field(default_factory=dict)
    key_fifths: int = 0
    meter_numerator: int = 4
    meter_denominator: int = 4
    meter_confidence: float = 0.0
    clef_by_staff: dict[int, tuple[str, int]] = field(default_factory=dict)
    pointer_owner: Optional[int] = None
    generated_notation: Optional[dict] = None


def _argmax_with_confidence(logits: torch.Tensor) -> tuple[int, float]:
    probability = torch.softmax(logits.detach().float(), -1)
    value, index = probability.max(-1)
    return int(index), float(value)


def decode_object_heads(output: dict, slots: Sequence[int], kinds: Sequence[str],
                        row: int = 0) -> list[ObjectSemantics]:
    """Argmax-decode the trained object heads for the given slots.

    ``kinds`` is the visual detector's authoritative object type. V2.5's rest
    head is still decoded and reported as evidence, but it cannot reclassify a
    detected notehead as a rest (or drop a detected rest).
    """
    heads = output["object"]
    results: list[ObjectSemantics] = []
    for slot in slots:
        step_index, step_conf = _argmax_with_confidence(heads["pitch_written_step"][row, slot])
        octave_index, octave_conf = _argmax_with_confidence(heads["pitch_octave"][row, slot])
        accidental_index, accidental_conf = _argmax_with_confidence(heads["pitch_accidental"][row, slot])
        staff_index, staff_conf = _argmax_with_confidence(heads["pitch_staff"][row, slot])
        duration_index, duration_conf = _argmax_with_confidence(heads["duration_type"][row, slot])
        dots, dots_conf = _argmax_with_confidence(heads["duration_dots"][row, slot])
        ratio_index, _ratio_conf = _argmax_with_confidence(heads["duration_tuplet_ratio"][row, slot])
        grace_index, _grace_conf = _argmax_with_confidence(heads["duration_grace"][row, slot])
        lane_index, _lane_conf = _argmax_with_confidence(heads["lane"][row, slot])
        tuplet_index, _tuplet_conf = _argmax_with_confidence(heads["tuplet"][row, slot])
        rest_index, rest_conf = _argmax_with_confidence(heads["rest"][row, slot])

        step = WRITTEN_STEP_NAMES[step_index]
        octave = int(octave_index)
        alter = int(accidental_index) - 3
        # The sanctioned written-pitch -> MIDI conversion. Detector geometry is
        # never substituted for the trained pitch heads.
        midi = int(derive_midi(step_index, octave_index, accidental_index))
        duration_type = DURATION_TYPE_NAMES[duration_index]
        if duration_type not in TYPE_QUARTERS:
            duration_type = "quarter"
        quarters = TYPE_QUARTERS[duration_type] * (2.0 - 0.5 ** int(dots))
        scale = TUPLET_SCALE.get(int(ratio_index))
        if scale:
            quarters *= scale
        pitch_confidence = min(step_conf, octave_conf, accidental_conf, staff_conf)
        results.append(ObjectSemantics(
            slot=int(slot),
            kind=kinds[slot],
            step=step,
            octave=octave,
            alter=alter,
            midi=midi,
            staff=int(staff_index) + 1,
            rest=kinds[slot] == "rest",
            rest_probability=rest_conf if int(rest_index) == 1 else 1.0 - rest_conf,
            duration_type=duration_type,
            dots=int(dots),
            tuplet_ratio=int(ratio_index),
            tuplet=bool(int(tuplet_index)) or scale is not None,
            grace=bool(int(grace_index)),
            lane=int(lane_index),
            pitch_confidence=pitch_confidence,
            duration_confidence=min(duration_conf, dots_conf),
            duration_quarters=quarters,
        ))
    return results


def decode_measure(output: dict, batch: dict, *, measure_number: int, slots: Sequence[int],
                   kinds: Sequence[str], max_staff: int = 2,
                   row: int = 0) -> tuple[MeasureSemantics, set[tuple[int, int]]]:
    """Decode object, relation and lane semantics for one measure.

    Returns the measure semantics plus the confident CHORD pairs keyed by
    object slot, which the caller needs to build onsets. ``max_staff`` is the
    staff count the detector measured for the measure; the trained staff head is
    clamped to it because a 2-staff measure cannot carry staff 3.
    """
    objects = decode_object_heads(output, slots, kinds, row)
    for entry in objects:
        entry.staff = max(1, min(int(max_staff), entry.staff))
    result = MeasureSemantics(measure_number=measure_number, objects=objects)

    continuation = output["relation"]["lane_continuation"].softmax(-1)[..., 1]
    relation_index = batch["relation_index"]
    relation_mask = batch["relation_mask"]
    # Canonical lane pooling: confident lane-continuation components vote.
    lanes = component_lane_decode(
        output["object"]["lane"], continuation, relation_index, relation_mask,
        batch["object_mask"])
    # Canonical voice tracks: connected components of confident continuations.
    tracks = voice_tracks(continuation, relation_index, relation_mask)
    lane_by_slot = {int(slot): int(lanes[0][slot]) for slot in slots}
    voice_by_slot = {int(slot): int(tracks[0][slot]) for slot in slots
                     if int(slot) < int(tracks.shape[1])}
    for entry in objects:
        entry.lane = lane_by_slot.get(entry.slot, entry.lane)
    result.voices = voice_by_slot

    # Chord grouping: the trained CHORD relation decides which objects share an
    # onset; the canonical detector x geometry is only the tie-breaker.
    chord_probability = output["relation"]["chord"].softmax(-1)[..., 1]
    paired: set[tuple[int, int]] = set()
    for edge, keep in enumerate(relation_mask[0].tolist()):
        if not keep:
            continue
        left, right = (int(v) for v in relation_index[0, edge].tolist())
        if left not in result.voices or right not in result.voices:
            continue
        if float(chord_probability[0, edge]) >= 0.5:
            paired.add((min(left, right), max(left, right)))
    return result, paired


def decode_context(output: dict, measure_node_slot: int, row: int = 0) -> dict:
    """Key/meter/clef semantics for the measure's context node."""
    context = output["context"]
    key_index, _key_conf = _argmax_with_confidence(context["key_fifths"][row, measure_node_slot])
    numerator, numerator_conf = _argmax_with_confidence(context["meter_numerator"][row, measure_node_slot])
    denominator, _denominator_conf = _argmax_with_confidence(
        context["meter_denominator"][row, measure_node_slot])
    clef_index, _clef_conf = _argmax_with_confidence(context["clef"][row, measure_node_slot])
    clef_line, _line_conf = _argmax_with_confidence(context["clef_line"][row, measure_node_slot])
    clefs = ("G", "F", "C", "percussion", "TAB", "none", "other")
    return {
        "key_fifths": int(key_index) - 7,
        "meter_numerator": int(numerator),
        "meter_denominator": int(denominator),
        "meter_confidence": float(numerator_conf),
        "clef": clefs[int(clef_index)] if int(clef_index) < len(clefs) else "other",
        "clef_line": int(clef_line),
    }


def group_onsets(objects: Sequence[ObjectSemantics], x_by_slot: dict[int, float],
                 chord_pairs: set[tuple[int, int]], x_tolerance: float) -> list[list[int]]:
    """Group object slots into onsets.

    Two objects share an onset when the trained CHORD relation groups them or
    when their detector x positions coincide within ``x_tolerance``. Object slot
    order (already canonical reading order) is preserved inside each onset.
    """
    parent = {entry.slot: entry.slot for entry in objects}
    by_slot = {entry.slot: entry for entry in objects}

    def find(node: int) -> int:
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for left, right in chord_pairs:
        # A chord is one onset inside one staff, and a printed rest is never a
        # chord tone. The trained CHORD relation is only a proposal here.
        a, b = by_slot.get(left), by_slot.get(right)
        if a is None or b is None or a.rest or b.rest or a.staff != b.staff:
            continue
        union(left, right)
    ordered = sorted(objects, key=lambda entry: entry.slot)
    for i, first in enumerate(ordered):
        for second in ordered[i + 1:]:
            if find(first.slot) == find(second.slot):
                continue
            # A printed rest never shares an onset with a notehead, and a chord
            # never crosses staves.
            if first.rest or second.rest or first.staff != second.staff:
                continue
            gap = abs(x_by_slot.get(first.slot, 0.0) - x_by_slot.get(second.slot, 0.0))
            if gap <= x_tolerance:
                union(first.slot, second.slot)
    groups: dict[int, list[int]] = {}
    for entry in ordered:
        groups.setdefault(find(entry.slot), []).append(entry.slot)
    onsets = list(groups.values())
    for onset in onsets:
        onset.sort(key=lambda slot: x_by_slot.get(slot, 0.0))
    onsets.sort(key=lambda onset: min(x_by_slot.get(slot, 0.0) for slot in onset))
    return onsets


def apply_relations(semantics: MeasureSemantics, output: dict, batch: dict,
                    chord_pairs: set[tuple[int, int]]) -> None:
    """Attach trained CHORD and TIE relations to the decoded objects."""
    tie_probability = output["relation"]["tie"].softmax(-1)[..., 1]
    by_slot = {entry.slot: entry for entry in semantics.objects}
    for edge, keep in enumerate(batch["relation_mask"][0].tolist()):
        if not keep:
            continue
        left, right = (int(v) for v in batch["relation_index"][0, edge].tolist())
        if left in by_slot and right in by_slot and (min(left, right), max(left, right)) in chord_pairs:
            if not by_slot[left].rest and not by_slot[right].rest:
                by_slot[left].chord_with = by_slot[right].slot
                by_slot[right].chord_with = by_slot[left].slot
        if left in by_slot and float(tie_probability[0, edge]) >= 0.5:
            # The relation runs from an earlier to a later object: a tie start
            # continues into the later object of the pair.
            earlier, later = (left, right) if left < right else (right, left)
            if earlier in by_slot and later in by_slot:
                by_slot[earlier].tie_start = True
                by_slot[later].tie_stop = True


def pointer_owner_for_measure(output: dict, batch: dict) -> Optional[int]:
    owners = pointer_owners(output.get("attachment", {}).get("pointer"),
                            batch["object_mask"].shape[1])
    if owners is None:
        return None
    return int(owners.reshape(-1)[0])
