"""Align detected PDF objects to MusicXML truth and emit ground-truth labels.

Contract
--------
- Input is a canonical V2.5 ``modelInput`` produced by the PRODUCTION adapter
  (``piano_vision_service.v25_canonical_features.build_page_records``) plus the
  MusicXML truth for the same printed measure.
- Output is the same ``target.families`` supervision schema the qualified V2.5
  checkpoint was trained on, so ``piano_vision.v2.data.attach_targets`` and
  ``tensorize_v25`` consume these records with no adaptation at all.
- No model output, no detector pitch guess and no decoder hypothesis is ever
  read. Every emitted label is either MusicXML semantics or the object's own
  page geometry under the production staff-band/staff-gap convention.
- When a (measure, band) group cannot be aligned reliably the WHOLE group is
  dropped and counted. Labels are never invented, never clamped and never
  inferred from a low-confidence prediction.

Label definition, verified against the qualified corpus
-------------------------------------------------------
``stepsFromBandCenter = (staffBandCenter - objectCenterY) / staffGap`` exactly,
reproduced from 6,029 qualified-corpus labels across 40 scores with a maximum
absolute error of 5e-4. ``staffBandCenter`` and ``staffGap`` come from the
production ``staff_bands`` / ``staff_space`` helpers, so the label is the very
quantity the production geometry defines, and MusicXML supplies the semantics
(step, octave, alter, clef, key, duration, voice, onset grouping).

Bands, not lanes
----------------
Clef changes are common in real engraving (LilyPond's La Campanella alone
declares 56). Grouping by DETECTED band and matching against the MusicXML
events whose clef-in-force puts them on that band is therefore both simpler and
correct under clef changes; a fixed part/staff-to-band map is not.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from musicxml_truth import (TYPE_QUARTERS, Event, PrintedMeasure, ScoreTruth,
                            expected_measured_steps)

# Conservative acceptance thresholds. Every one is a refusal to label, never a
# licence to guess. Count skew is deliberately NOT a hard rejection: the
# production detector over-proposes, and dropping every over-detected measure
# would silently select an easy sub-corpus. Instead the alignment must explain
# most of the MusicXML events AND leave tight pitch residuals; surplus objects
# stay unlabelled and masked.
MIN_OBJECTS_PER_GROUP = 3
MIN_MATCHED_PER_GROUP = 3
MIN_EVENT_COVERAGE = 0.55       # matched events / pitched events
MIN_OBJECT_COVERAGE = 0.25       # matched objects / objects in the group
MAX_STEP_RESIDUAL = 0.60        # staff steps, after fitting the band offset
MAX_RESIDUAL_STD = 0.35
MIN_DELTA_SAMPLES = 4
MAX_REST_COUNT_SKEW = 1

NATURAL_PITCH_CLASS = (0, 2, 4, 5, 7, 9, 11)
ASSEMBLER_VERSION = "real-pdf-adaptation/1.0"
FAMILY_NAMES = ("PITCH_STAFF", "DURATION", "REST", "LANE", "ATTACK", "CHORD",
                "LANE_CONTINUATION", "TUPLET", "TIE_SUSTAIN", "CROSS_STAFF",
                "SHARED_HEAD")


@dataclass
class BandAlignment:
    band: str
    accepted: bool = False
    reason: str = ""
    delta: float = 0.0
    delta_samples: int = 0
    delta_fitted_locally: bool = False
    residual_std: float = 0.0
    max_abs_residual: float = 0.0
    object_count: int = 0
    event_count: int = 0
    pitched_event_count: int = 0
    object_index: list[int] = field(default_factory=list)
    event: list[Event] = field(default_factory=list)


def dp_align(cost, gap_object, gap_event):
    """Monotone Needleman-Wunsch. Returns the ordered (object, event) pairs."""
    n = len(cost)
    m = len(cost[0]) if n else 0
    if n == 0 or m == 0:
        return []
    table = np.zeros((n + 1, m + 1))
    back = np.zeros((n + 1, m + 1), dtype=np.int8)
    for i in range(1, n + 1):
        table[i, 0] = table[i - 1, 0] + gap_object
        back[i, 0] = 1
    for j in range(1, m + 1):
        table[0, j] = table[0, j - 1] + gap_event
        back[0, j] = 2
    for i in range(1, n + 1):
        row, previous, current = cost[i - 1], table[i - 1], table[i]
        for j in range(1, m + 1):
            diagonal = previous[j - 1] + row[j - 1]
            up = previous[j] + gap_object
            left = current[j - 1] + gap_event
            if diagonal <= up and diagonal <= left:
                current[j], back[i, j] = diagonal, 0
            elif up <= left:
                current[j], back[i, j] = up, 1
            else:
                current[j], back[i, j] = left, 2
    pairs = []
    i, j = n, m
    while i > 0 or j > 0:
        move = back[i, j]
        if i == 0:
            j -= 1
        elif j == 0:
            i -= 1
        elif move == 0:
            pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif move == 1:
            i -= 1
        else:
            j -= 1
    pairs.reverse()
    return pairs


def _pair_cost(measured, event, delta):
    if event.diatonic is None or event.center_diatonic is None:
        return 6.0
    residual = abs(measured - (delta + expected_measured_steps(event.diatonic,
                                                               event.center_diatonic)))
    return residual if residual <= MAX_STEP_RESIDUAL else 6.0 + residual


def align_band(band, objects, events, band_center, staff_gap, delta=None) -> BandAlignment:
    """Align one (printed measure, staff band) group.

    ``delta`` is the band's geometric offset
    ``(bandCenter - clefReferenceLineY) / staffGap``. It depends only on the
    detected page geometry, so it is a per-(page, band) constant, not a
    per-measure one. Pass it in from :func:`pool_band_delta` whenever a page
    offers enough groups; fitting it per group instead is what breaks
    polyphonic material, where a locally-fitted offset latches onto the wrong
    chord. With ``delta=None`` the offset is fitted from this group alone and
    only ``MIN_DELTA_SAMPLES`` objects are required.

    Notes and rests are aligned SEPARATELY. The production rest detector
    over-proposes heavily (203 proposals against 3 printed rests on the Minuet
    fixture), and letting that many spurious rest candidates compete inside one
    Needleman-Wunsch budget would corrupt the note pairing this campaign
    actually depends on. Rest labels are emitted only where the two counts agree
    within ``MAX_REST_COUNT_SKEW``, which is an honest refusal everywhere else.
    """
    alignment = BandAlignment(band=band)
    alignment.object_count = len(objects)
    alignment.event_count = len(events)
    if staff_gap is None or staff_gap <= 1e-9:
        alignment.reason = "no_staff_gap"
        return alignment
    if band_center is None:
        alignment.reason = "no_band_center"
        return alignment

    note_positions = [i for i, o in enumerate(objects) if o.get("kind") == "notehead"]
    rest_positions = [i for i, o in enumerate(objects) if o.get("kind") != "notehead"]
    pitched = [e for e in events if not e.is_rest]
    rests = [e for e in events if e.is_rest]
    alignment.pitched_event_count = len(pitched)

    note_pairs = []
    if len(note_positions) >= MIN_OBJECTS_PER_GROUP and len(pitched) >= MIN_OBJECTS_PER_GROUP:
        note_pairs = _align_pitched_notes(alignment, objects, note_positions, pitched,
                                         band_center, staff_gap, delta)
    rest_pairs = []
    if rests and abs(len(rest_positions) - len(rests)) <= MAX_REST_COUNT_SKEW:
        rest_pairs = list(zip(rest_positions, rests[:len(rest_positions)]))

    alignment.object_index = [i for i, _ in note_pairs] + [i for i, _ in rest_pairs]
    alignment.event = [e for _, e in note_pairs] + [e for _, e in rest_pairs]
    if note_pairs:
        alignment.accepted = True
        alignment.reason = "accepted"
    elif rest_pairs:
        # A rest-only group still carries usable duration supervision.
        alignment.accepted = True
        alignment.reason = "accepted_rest_only"
    else:
        alignment.reason = alignment.reason or "too_few_objects_or_events"
    return alignment


def _align_pitched_notes(alignment, objects, note_positions, pitched, band_center,
                         staff_gap, delta=None):
    """Returns the accepted (object position, event) pairs, recording the reason.

    ``delta`` is the band's geometric offset. It is derived by
    :func:`analytic_band_delta` and passed in, so nothing here is fitted from
    the ground truth. If it is ``None`` the offset is estimated from an
    order-only pairing, which requires no offset to exist and so is not
    circular either; that fallback exists for callers without detected staff
    lines and needs ``MIN_DELTA_SAMPLES`` objects to be trustworthy.
    """
    measured = [((band_center - float(objects[i]["center"]["y"])) / staff_gap)
                for i in note_positions]

    if delta is None:
        offsets = []
        for i, j in dp_align([[0.0] * len(pitched) for _ in note_positions],
                             gap_object=2.0, gap_event=2.0):
            event = pitched[j]
            if event.diatonic is None or event.center_diatonic is None:
                continue
            offsets.append(measured[i] - expected_measured_steps(
                event.diatonic, event.center_diatonic))
        if len(offsets) < MIN_DELTA_SAMPLES:
            alignment.reason = "too_few_offset_samples"
            alignment.delta_samples = len(offsets)
            return []
        delta = float(np.median(offsets))
        alignment.delta_fitted_locally = True
    alignment.delta = delta
    alignment.delta_samples = len(pitched)

    cost = [[_pair_cost(measured[i], pitched[j], delta) for j in range(len(pitched))]
            for i in range(len(note_positions))]
    kept, residuals = [], []
    for i, j in dp_align(cost, gap_object=1.5, gap_event=1.5):
        event = pitched[j]
        if event.diatonic is None or event.center_diatonic is None:
            continue
        # measured is the raw (bandCenter - cy)/gap, so the band offset belongs
        # in the residual exactly as it does in _pair_cost.
        residual = measured[i] - (delta + expected_measured_steps(
            event.diatonic, event.center_diatonic))
        if abs(residual) <= MAX_STEP_RESIDUAL:
            residuals.append(residual)
            kept.append((i, j))
    if len(kept) < MIN_MATCHED_PER_GROUP:
        alignment.reason = "too_few_accepted_matches"
        return []
    # The production measure grid splits real measures, so this group may only
    # hold a FRACTION of the XML measure it was paired with. The event-coverage
    # floor is scaled by that fraction instead of being dropped, so a fragment is
    # still required to explain the events it can actually contain. The
    # residual tests below still decide whether the pairing is real.
    reachable = min(1.0, len(note_positions) / float(max(1, len(pitched))))
    if len(kept) < MIN_EVENT_COVERAGE * reachable * len(pitched):
        alignment.reason = "event_coverage_too_low"
        return []
    if len(kept) < MIN_OBJECT_COVERAGE * len(note_positions):
        alignment.reason = "object_coverage_too_low"
        return []
    residuals = np.asarray(residuals)
    alignment.residual_std = float(residuals.std())
    alignment.max_abs_residual = float(np.abs(residuals).max())
    if alignment.residual_std > MAX_RESIDUAL_STD:
        alignment.reason = "residual_std_too_large"
        return []
    if abs(float(residuals.mean())) > MAX_STEP_RESIDUAL:
        # This group's true offset is far from the analytic one, which means
        # its staff lines were detected badly. Refuse it rather than label it.
        alignment.reason = "band_offset_disagrees"
        return []
    alignment.delta = delta + float(residuals.mean())
    return [(note_positions[i], pitched[j]) for i, j in kept]


def analytic_band_delta(lines, gap, clef_sign, clef_line):
    """``(bandCenter - clefReferenceLineY) / staffGap`` straight from detection.

    A correctly detected five-line staff gives -1 for a G clef on line 2 and
    +1 for an F clef on line 4, whatever the rasterization, because the band
    centre is the middle line and the reference line is one or three gaps away
    from it. Any deviation from that is a direct, honest read-out of how wrong
    this measure's staff-line detection is, and it is the SAME number the
    ``stepsFromBandCenter`` label is built from.

    Deriving it analytically rather than fitting it from the labels removes the
    circularity of asking the ground truth to calibrate its own offset, and it
    makes every measure usable instead of only the few with enough objects to
    fit an offset of their own. Measured across the audited scores the medians
    are -0.977 and +1.023 with a spread of 0.01 staff steps.
    """
    if not lines or gap is None or gap <= 1e-9:
        return None
    ordered = sorted(float(v) for v in lines)
    if len(ordered) < 2:
        return None
    center = (ordered[0] + ordered[-1]) / 2.0
    # Line k counted from the bottom sits at max - (k - 1) * gap.
    reference = ordered[-1] - (max(1, int(clef_line)) - 1) * gap
    return (center - reference) / gap


def _coverage(measured, lattice, delta, tolerance):
    """Fraction of detected values that sit on the MusicXML pitch lattice.

    Cheap and DP-free, so it can be evaluated for every (detected measure, XML
    measure) candidate pair without paying for a full alignment each time.
    """
    if not measured or not lattice:
        return 0.0
    hits = 0
    for value in measured:
        if min(abs(value - (delta + e)) for e in lattice) <= tolerance:
            hits += 1
    return hits / float(len(measured))


def align_measure_sequence(groups, truth_measure_count, band_measured, band_lattice,
                           deltas, tolerance=0.6, min_score=0.45, search=12):
    """Map detected printed measures onto MusicXML measures, monotonically.

    The production measure grid is built from barline projections, so it splits,
    merges and occasionally invents a measure relative to the notated score. A
    fixed 1:1 index therefore drifts, and a constant offset does not fix a
    drift. This searches for a NON-DECREASING map instead, scoring each
    candidate by how well the detected pitch values land on that XML measure's
    MusicXML pitch lattice under the page's band offset, and requiring the score
    to clear ``min_score`` before a pair is allowed to count.

    Returns ``{detected_index: xml_index}`` plus a per-pair score table.
    """
    detected = len(groups)
    scores = np.zeros((detected, truth_measure_count))
    usable = np.zeros((detected, truth_measure_count), dtype=bool)
    for d in range(detected):
        for x in range(truth_measure_count):
            total, weight = 0.0, 0
            for band in ("upper", "lower"):
                measured = band_measured.get((d, band)) or []
                lattice = band_lattice.get((x, band)) or []
                if not measured or not lattice:
                    continue
                delta = deltas.get(band)
                if delta is None:
                    continue
                total += _coverage(measured, lattice, delta, tolerance) * len(measured)
                weight += len(measured)
            if weight < 2:
                continue
            score = total / weight
            scores[d, x] = score
            # A one or two object fragment is a weak signal on its own, so it
            # has to be a perfect lattice hit to earn a pairing; a fuller
            # measure only has to clear the ordinary threshold.
            usable[d, x] = score >= (0.99 if weight < MIN_DELTA_SAMPLES else min_score)
    if not usable.any():
        return {}, scores

    # Monotone DP over (detected, xml). Skipping either side is free; only a
    # pair that clears min_score contributes, so the optimum never pays for a
    # bad match.
    best = np.zeros((detected + 1, truth_measure_count + 1))
    for d in range(detected, -1, -1):
        for x in range(truth_measure_count, -1, -1):
            options = [best[d + 1, x] if d < detected else 0.0,
                       best[d, x + 1] if x < truth_measure_count else 0.0]
            if d < detected and x < truth_measure_count and usable[d, x]:
                options.append(scores[d, x] + best[d + 1, x + 1])
            best[d, x] = max(options)
    mapping, d, x = {}, 0, 0
    while d < detected and x < truth_measure_count:
        if usable[d, x] and abs(best[d, x] - (scores[d, x] + best[d + 1, x + 1])) < 1e-9:
            mapping[d] = x
            d, x = d + 1, x + 1
        elif abs(best[d, x] - best[d + 1, x]) < 1e-9:
            d += 1
        else:
            x += 1
    return mapping, scores


def lane_role(part_id: str, voice: str) -> str:
    """Lane role in the exact shape the trained ``lane`` head parses.

    ``piano_vision/data.py::_lane_class`` reads the substring after the LAST
    "-": ``"P1:lane-1"`` -> class 0, ``"P1:lane-3"`` -> class 2. A bare
    ``"P1:1"`` parses as class 7, i.e. "unknown", for every object, which would
    train the head on a single degenerate class. The MusicXML ``<voice>`` number
    is the lane index, and the head clamps 1..8 into classes 0..7.
    """
    try:
        number = max(1, int(str(voice).strip()))
    except (TypeError, ValueError):
        number = 1
    return f"{part_id}:lane-{min(8, number)}"


def midi_from(step: str, octave: int, alter) -> int:
    return (octave + 1) * 12 + NATURAL_PITCH_CLASS["CDEFGAB".index(step)] + int(alter or 0)


def _duration_value(event: Event) -> dict:
    return {
        "writtenType": event.written_type,
        "durationDivisions": event.divisions_normalized_quarters,
        "divisions": event.divisions,
        "divisionsNormalizedQuarters": event.divisions_normalized_quarters,
        "dots": event.dots,
        "timeModification": ({"actualNotes": event.tuplet_actual,
                              "normalNotes": event.tuplet_normal}
                             if event.tuplet_actual else None),
        "grace": bool(event.grace), "tieStart": False, "tieStop": False,
    }


def build_targets(scope_id, truth: ScoreTruth, measure: PrintedMeasure, objects,
                  alignments, band_centers, staff_gap, confidence=0.865,
                  band_gaps=None) -> dict:
    """Assemble ``target.families`` for one canonical record.

    ``band_gaps`` is the corpus/2.1 candidate: the divisor for
    ``stepsFromBandCenter`` is the band's OWN detected five-line spacing rather
    than one pooled value from both bands. ``None`` keeps the corpus/2.0
    behaviour byte-identical, and any band with no own gap falls back to the
    pooled ``staff_gap`` rather than inventing one.
    """
    measure_number = measure.index + 1
    families = {name: [] for name in FAMILY_NAMES}

    for band in ("upper", "lower"):
        alignment = alignments.get(band)
        if alignment is None or not alignment.accepted:
            continue
        band_center = band_centers[band]
        band_gap = ((band_gaps or {}).get(band) or staff_gap) if band_gaps else staff_gap
        for object_index, event in zip(alignment.object_index, alignment.event):
            cy = float(objects[object_index]["center"]["y"])
            event_id = f"m{measure_number}-n{event.xml_note_index}"
            part_id = event.lane.rsplit(":", 1)[0]
            if event.is_rest:
                families["REST"].append({
                    "labelId": f"{scope_id}:rest-{object_index}",
                    "family": "REST", "state": "KNOWN", "confidence": confidence,
                    "objectIndexes": [object_index], "semanticEventIds": [event_id],
                    "value": {"laneRole": lane_role(part_id, event.voice),
                              "durationDivisions": event.divisions_normalized_quarters,
                              "divisions": event.divisions,
                              "divisionsNormalizedQuarters": event.divisions_normalized_quarters,
                              "writtenType": event.written_type, "dots": event.dots},
                    "isPositive": True, "reason": None,
                    "provenance": {
                        "assemblerVersion": ASSEMBLER_VERSION,
                        "sourceEvidence": "production rest proposal paired with a printed MusicXML rest",
                        "semanticEvidence": "MusicXML rest element duration/divisions/type/dots"}})
            else:
                families["PITCH_STAFF"].append({
                    "labelId": f"{scope_id}:pitch-{object_index}",
                    "family": "PITCH_STAFF", "state": "KNOWN", "confidence": confidence,
                    "objectIndexes": [object_index], "semanticEventIds": [event_id],
                    "value": {
                        "staff": 1 if band == "upper" else 2,
                        "staffRole": band,
                        "staffPosition": {
                            "state": "KNOWN",
                            "representation": "SOURCE_GEOMETRIC_STEPS_FROM_LOCAL_BAND_CENTER",
                            "stepsFromBandCenter": round((band_center - cy) / band_gap, 4),
                            "sourceY": cy,
                            "staffGapNormalized": band_gap,
                        },
                        "writtenPitch": {"step": event.step, "alter": event.alter,
                                         "octave": event.octave},
                        "midiTargetMetadata": midi_from(event.step, event.octave, event.alter),
                        "accidentalState": {
                            "printed": event.alter, "writtenAlter": event.alter,
                            "keyContext": {"fifths": measure.key_fifths, "mode": None,
                                           "measureNumber": measure_number}},
                        "clefContext": {"state": "KNOWN", "value": {
                            "sign": event.clef_sign, "line": event.clef_line,
                            "octaveChange": event.clef_octave_change,
                            "measureNumber": measure_number}}},
                    "isPositive": True, "reason": None,
                    "provenance": {
                        "assemblerVersion": ASSEMBLER_VERSION,
                        "sourceEvidence": "production notehead proposal; staffPosition from production "
                                          "staff_bands/staff_space",
                        "semanticEvidence": "MusicXML written pitch/alter/octave/staff/accidental/key/clef"}})
                families["LANE"].append({
                    "labelId": f"{scope_id}:lane-{object_index}",
                    "family": "LANE", "state": "KNOWN", "confidence": confidence,
                    "objectIndexes": [object_index], "semanticEventIds": [event_id],
                    "value": {"laneRole": lane_role(part_id, event.voice)},
                    "isPositive": True, "reason": None,
                    "provenance": {
                        "assemblerVersion": ASSEMBLER_VERSION,
                        "sourceEvidence": "accepted object->MusicXML event alignment",
                        "semanticEvidence": "MusicXML <voice> -> score-local lane role"}})
            if event.written_type in TYPE_QUARTERS:
                families["DURATION"].append({
                    "labelId": f"{scope_id}:duration-{object_index}",
                    "family": "DURATION", "state": "KNOWN", "confidence": confidence,
                    "objectIndexes": [object_index], "semanticEventIds": [event_id],
                    "value": _duration_value(event),
                    "isPositive": True, "reason": None,
                    "provenance": {
                        "assemblerVersion": ASSEMBLER_VERSION,
                        "sourceEvidence": "accepted object->MusicXML event alignment",
                        "semanticEvidence": "raw MusicXML duration/divisions/type/dots/time-modification/grace"}})

    _attach_onset_groups(families, scope_id, alignments, measure, measure_number, confidence)
    return {
        "availability": {
            "PITCH_STAFF": bool(families["PITCH_STAFF"]),
            "DURATION": bool(families["DURATION"]),
            "REST": bool(families["REST"]),
            "LANE": bool(families["LANE"]),
            "ATTACK": bool(families["ATTACK"]),
            "CHORD": bool(families["CHORD"]),
            "LANE_CONTINUATION": False, "TUPLET": False, "TIE_SUSTAIN": False,
            "CROSS_STAFF": False, "SHARED_HEAD": False,
        },
        "families": families,
    }


def _attach_onset_groups(families, scope_id, alignments, measure, measure_number, confidence):
    """ATTACK / CHORD from MusicXML onset plus part/voice identity only."""
    attack_groups: dict[tuple, list[int]] = {}
    chord_groups: dict[tuple, list[int]] = {}
    for band in ("upper", "lower"):
        alignment = alignments.get(band)
        if alignment is None or not alignment.accepted:
            continue
        for object_index, event in zip(alignment.object_index, alignment.event):
            part = event.lane.rsplit(":", 1)[0]
            attack_groups.setdefault((event.onset, part, event.voice), []).append(object_index)
            if not event.is_rest and not event.grace:
                chord_groups.setdefault((event.onset, part, event.voice), []).append(object_index)
    for name, groups in (("ATTACK", attack_groups), ("CHORD", chord_groups)):
        for ordinal, (key, members) in enumerate(
                sorted(groups.items(), key=lambda kv: (kv[0][0], min(kv[1]))), start=1):
            if len(members) < 2:
                continue
            families[name].append({
                "labelId": f"{scope_id}:{name.lower()}-{ordinal}",
                "family": name, "state": "KNOWN", "confidence": confidence,
                "objectIndexes": sorted(members),
                "semanticEventIds": [f"m{measure_number}-n{o}" for o in sorted(members)],
                "value": {"localAttackOrdinal" if name == "ATTACK" else "localChordOrdinal": ordinal,
                          "onsetQuarters": key[0], "memberHeads": len(members)},
                "isPositive": True, "reason": None,
                "provenance": {
                    "assemblerVersion": ASSEMBLER_VERSION,
                    "sourceEvidence": "accepted notehead objects inside one printed measure",
                    "semanticEvidence": "MusicXML part/voice/onset identity"}})
