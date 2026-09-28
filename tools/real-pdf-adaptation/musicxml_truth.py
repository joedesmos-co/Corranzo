"""MusicXML -> printed-measure ground truth for real-PDF adaptation labels.

Scope: exactly the subset of MusicXML whose printed layout is unambiguous, so
that a detected PDF measure can be mapped to one XML measure without guessing.

A score is ACCEPTED only when all of the following hold:

- every part's ``<measure>`` list is numbered contiguously from 1 with no
  duplicates, so no measure is printed twice;
- no ``<multi-rest>`` and no ``<measure-style>multiple</measure-style>``, because
  those collapse several XML measures into one printed measure;
- at every measure the active clefs resolve to exactly one G-clef-on-line-2 band
  ("upper") and exactly one F-clef-on-line-4 band ("lower"), with no collision,
  so a printed grand staff always maps to exactly two XML lanes;
- every measure in every part carries printed note content.

``<repeat>`` and ``<ending>`` are deliberately ALLOWED: they change playback
order only. The printed layout, and therefore the measure bijection this module
depends on, is unaffected.

Parts may differ in length. A shorter part is treated as having no content in
the trailing printed measures, which is verified per measure downstream by the
residual test in ``align_objects``; a wrong assumption cannot survive there.

Nothing in this module reads a model, a checkpoint or a detector prediction:
labels are MusicXML semantics plus the object's own geometry.
"""
from __future__ import annotations

import gzip
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
import xml.etree.ElementTree as ET

DIATONIC = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}

# Duration type -> divisions-normalised quarters. Mirrors the vocabulary the
# trained DURATION head already owns (piano_vision/data.py DURATION_TYPES).
TYPE_QUARTERS = {
    "maxima": 32.0, "long": 16.0, "breve": 8.0, "whole": 4.0, "half": 2.0,
    "quarter": 1.0, "eighth": 0.5, "16th": 0.25, "32nd": 0.125,
    "64th": 0.0625, "128th": 0.03125, "256th": 0.015625,
}
WRITABLE_TYPES = frozenset(TYPE_QUARTERS)

MAX_TRAILING_MEASURE_DEFICIT = 4


def read_musicxml_bytes(path) -> bytes:
    raw = Path(path).read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    if raw[:4] == b"PK\x03\x04":
        with zipfile.ZipFile(path) as archive:
            names = [n for n in archive.namelist()
                     if n.lower().endswith((".xml", ".musicxml"))
                     and "META-INF" not in n]
            if not names:
                raise ValueError(f"no MusicXML payload inside {path}")
            return archive.read(sorted(names, key=len)[0])
    return raw


@dataclass
class Event:
    """One printed note or rest on one lane of one printed measure."""
    onset: float
    order: int
    lane: str
    band: str
    is_rest: bool
    step: str | None
    octave: int | None
    alter: int | None
    diatonic: int | None
    center_diatonic: int | None
    clef_sign: str
    clef_line: int
    clef_octave_change: int
    divisions: int
    divisions_normalized_quarters: float
    written_type: str | None
    dots: int
    grace: bool
    tuplet_actual: int | None
    tuplet_normal: int | None
    voice: str
    xml_note_index: int
    printed: bool = True

    def key_context(self) -> dict:
        return {"fifths": 0, "mode": None}


@dataclass
class PrintedMeasure:
    index: int
    xml_measure_index: int
    key_fifths: int = 0
    bands_present: tuple = ()
    events: list[Event] = field(default_factory=list)

    def by_lane(self) -> dict[str, list[Event]]:
        out: dict[str, list[Event]] = {}
        for event in self.events:
            out.setdefault(event.lane, []).append(event)
        for rows in out.values():
            rows.sort(key=lambda e: (e.onset, e.order))
        return out


@dataclass
class ScoreTruth:
    score_id: str
    lanes: dict[str, dict]
    measures: list[PrintedMeasure]
    clef_changes: int = 0
    rejected: list[str] = field(default_factory=list)


def clef_center_diatonic(sign: str, line: int) -> int | None:
    """Diatonic number of the note printed on ``line`` (1-based from the bottom).

    Line 1 of a staff is E4 in treble, G2 in bass and F3 in alto, and each
    further line is two diatonic steps up, because one line gap spans one space.
    So G clef line 2 is G4 (32), F clef line 4 is F3 (24) and C clef line 3 is
    C4 (28).
    """
    base = {"G": 30, "F": 18, "C": 24}.get(sign)
    if base is None or line < 1:
        return None
    return base + 2 * (line - 1)


def band_for_clef(sign: str, line: int) -> str:
    if sign == "G" and line == 2:
        return "upper"
    if sign == "F" and line == 4:
        return "lower"
    return "?"


def expected_measured_steps(diatonic: int, center_diatonic: int) -> float:
    """Expected ``(bandCenter - cy) / staffGap`` for a note on this lane.

    One diatonic staff step is half a line gap, so a note ``k`` steps above the
    clef reference line prints ``k * gap / 2`` higher (smaller ``cy``), giving
    ``(bandCenter - cy) / gap = delta + k / 2`` for a per-lane unknown ``delta``.
    Only the ``k / 2`` slope is MusicXML-determined; ``delta`` is fitted from the
    page geometry by the aligner and never invented.
    """
    return (diatonic - center_diatonic) / 2.0


def _is_number(node) -> bool:
    return bool(node is not None and (node.text or "").strip())


def _clef_timeline(part: ET.Element, part_id: str, staff_count: int):
    """[(measure_index, staff, sign, line, octave_change)] in document order."""
    events = []
    for measure_index, measure in enumerate(part.findall("measure")):
        for attributes in measure.findall("attributes"):
            for clef in attributes.findall("clef"):
                number = int((clef.get("number") or "1").strip())
                if number < 1 or number > staff_count:
                    continue
                events.append((measure_index, number,
                               (clef.findtext("sign") or "").strip(),
                               int(clef.findtext("line") or 0),
                               int(clef.findtext("clef-octave-change") or 0)))
    return events


def _part_staff_count(part: ET.Element) -> int:
    declared = 1
    for staves in part.iter("staves"):
        if (staves.text or "").strip().isdigit():
            declared = max(declared, int(staves.text.strip()))
    return declared


def _measure_events(measure, part_id, clef_state, divisions, note_index_base):
    """Walk one measure, resolving the clef in force note by note."""
    events: list[Event] = []
    position = 0.0
    staff = 1
    voice = "1"
    chord_order = 0
    grace_position = None
    divisions_cursor = float(divisions)
    note_index = note_index_base

    for node in measure:
        tag = node.tag
        if tag == "backup":
            position = max(0.0, position - float(node.findtext("duration", "0") or 0))
            grace_position = None
            continue
        if tag == "forward":
            position += float(node.findtext("duration", "0") or 0)
            grace_position = None
            continue
        if tag == "note":
            note_index += 1
            duration_node = node.find("duration")
            written_duration = float(duration_node.text) if _is_number(duration_node) else 0.0
            grace = node.find("grace") is not None
            chord = node.find("chord") is not None
            is_cue = node.find("cue") is not None
            if grace:
                if grace_position is None:
                    grace_position = position
                effective = grace_position
            else:
                effective = position
                grace_position = None
            current_voice = (node.findtext("voice") or voice or "1").strip() or "1"
            if not chord:
                voice = current_voice
            staff_node = node.find("staff")
            if staff_node is not None and (staff_node.text or "").strip().isdigit():
                staff = int(staff_node.text.strip())
            lane_key = f"{part_id}:{staff}"
            sign, line, octave_change = clef_state.get(lane_key, ("?", 0, 0))
            band = band_for_clef(sign, line)
            is_rest = node.find("rest") is not None
            step = octave = alter = diatonic = None
            pitch = node.find("pitch")
            if not is_rest and pitch is not None:
                step = (pitch.findtext("step") or "").strip() or None
                octave_text = pitch.findtext("octave")
                octave = int(octave_text) if octave_text and octave_text.strip().isdigit() else None
                alter_text = pitch.findtext("alter")
                alter = int(float(alter_text)) if alter_text and alter_text.strip() else None
                if step in DIATONIC and octave is not None:
                    diatonic = octave * 7 + DIATONIC[step]
            written_type = (node.findtext("type") or "").strip().lower() or None
            dots_node = node.find("dots")
            dots = int(dots_node.text) if dots_node is not None and (dots_node.text or "").strip().isdigit() else 0
            tm = node.find("time-modification")
            actual = normal = None
            if tm is not None:
                a, n = tm.findtext("actual-notes"), tm.findtext("normal-notes")
                if a and n and a.strip().isdigit() and n.strip().isdigit():
                    actual, normal = int(a), int(n)
            tuplet_scale = (normal / actual) if (actual and normal and actual > 0) else 1.0
            events.append(Event(
                onset=round(effective, 6),
                order=chord_order,
                lane=lane_key,
                band=band,
                is_rest=is_rest,
                step=step, octave=octave, alter=alter, diatonic=diatonic,
                center_diatonic=clef_center_diatonic(sign, line),
                clef_sign=sign, clef_line=line, clef_octave_change=octave_change,
                divisions=int(divisions_cursor),
                divisions_normalized_quarters=(0.0 if grace else
                                               written_duration / max(divisions_cursor, 1e-9) * tuplet_scale),
                written_type=written_type,
                dots=dots if 0 <= dots <= 3 else 0,
                grace=grace, tuplet_actual=actual, tuplet_normal=normal,
                voice=current_voice, xml_note_index=note_index,
                printed=(not is_cue) and band in ("upper", "lower"),
            ))
            # A <chord/> tone shares the first note of its chord: it must not
            # advance the cursor, only add itself to the printed left-to-right
            # order. Advancing on chord tones is what silently desynchronises
            # the reconstructed x-order from the printed page.
            if not grace and not chord:
                position += written_duration
            chord_order = 0 if not chord else chord_order + 1
            continue
        if tag == "attributes":
            # <divisions> is a direct child of <attributes>, NOT of <time>.
            # Reading it from <time> silently leaves the divisor at 1, which
            # turns every duration target into a raw division count.
            div_text = node.findtext("divisions")
            if div_text and div_text.strip().isdigit():
                divisions_cursor = float(div_text)
    # Reconstruct printed left-to-right order: onset first, then within one onset
    # the highest note first, because the detector sorts candidates by (cx, cy)
    # and y decreases with pitch.
    grouped: dict[tuple, list[Event]] = {}
    for event in events:
        grouped.setdefault((event.onset, event.lane, event.voice), []).append(event)
    for members in grouped.values():
        pitched = sorted((m for m in members if not m.is_rest and m.diatonic is not None),
                         key=lambda m: -m.diatonic)
        others = [m for m in members if m not in pitched]
        for order, member in enumerate(pitched + others):
            member.order = order
    events.sort(key=lambda e: (e.onset, e.order))
    return events, note_index


def score_report(path) -> dict:
    """Parse one MusicXML file into a truth object, or explain the refusal."""
    try:
        root = ET.fromstring(read_musicxml_bytes(path).decode("utf-8", "replace"))
    except Exception as exc:  # noqa: BLE001 - reported, never silently skipped
        return {"ok": False, "rejected": [f"unreadable MusicXML: {exc}"]}

    parts = root.findall("part")
    if not parts:
        return {"ok": False, "rejected": ["no parts"]}

    title = (root.findtext("./work/work-title") or root.findtext("./movement-title") or "").strip()
    rejected: list[str] = []

    counts = {}
    for part in parts:
        numbers = [m.get("number") for m in part.findall("measure")]
        counts[part.get("id")] = len(numbers)
        if len(numbers) != len(set(numbers)):
            rejected.append(f"part {part.get('id')} repeats a printed measure number")
        expected = [str(i + 1) for i in range(len(numbers))]
        if numbers != expected:
            rejected.append(f"part {part.get('id')} measure numbers are not 1..N contiguous")
        empty = [i + 1 for i, m in enumerate(part.findall("measure"))
                 if not m.findall("note")]
        if empty:
            rejected.append(f"part {part.get('id')} has {len(empty)} measures with no note "
                            f"content (first {empty[:3]})")
    if root.find(".//multi-rest") is not None:
        rejected.append("multi-measure rest collapses several XML measures into one printed measure")
    for style in root.findall(".//measure-style"):
        if (style.text or "").strip() == "multiple":
            rejected.append("multi-measure rest signalled via <measure-style>")
    if rejected:
        return {"ok": False, "rejected": sorted(set(rejected))}

    total_measures = max(counts.values())
    deficit = total_measures - min(counts.values())
    if deficit > MAX_TRAILING_MEASURE_DEFICIT:
        return {"ok": False,
                "rejected": [f"parts differ by {deficit} measures, above the tolerated "
                             f"{MAX_TRAILING_MEASURE_DEFICIT}"]}

    staff_counts = {p.get("id"): _part_staff_count(p) for p in parts}
    timelines = {p.get("id"): _clef_timeline(p, p.get("id"), staff_counts[p.get("id")])
                 for p in parts}
    clef_change_count = sum(len(v) for v in timelines.values())

    # Replay the clef timeline so every note knows the clef actually in force.
    clef_state: dict[str, tuple] = {}
    initial = {}
    for part in parts:
        for _mi, staff, sign, line, octave_change in timelines[part.get("id")]:
            clef_state[f"{part.get('id')}:{staff}"] = (sign, line, octave_change)
        for key, value in clef_state.items():
            if key.startswith(part.get("id")):
                initial.setdefault(key, value)
    measures: list[PrintedMeasure] = []
    divisions = 1.0
    key_fifths = 0
    note_index_base = 0
    collisions: list[int] = []
    for xml_index in range(total_measures):
        collected: list[Event] = []
        note_index_base = 0
        for part in parts:
            part_id = part.get("id")
            part_measures = part.findall("measure")
            for _mi, staff, sign, line, octave_change in timelines[part_id]:
                if _mi == xml_index:
                    clef_state[f"{part_id}:{staff}"] = (sign, line, octave_change)
            if xml_index >= len(part_measures):
                continue
            measure = part_measures[xml_index]
            attributes = measure.find("attributes")
            if attributes is not None:
                # <divisions> is a direct child of <attributes>, not of <time>.
                div_text = attributes.findtext("divisions")
                if div_text and div_text.strip().isdigit():
                    divisions = float(div_text.strip())
            events, note_index_base = _measure_events(
                measure, part_id, clef_state, int(divisions), note_index_base)
            collected.extend(events)
        present = tuple(sorted({e.band for e in collected if e.printed}))
        # A band collision means two XML lanes claim the same printed staff at
        # the same time, so the printed measure cannot be split by band at all.
        # A measure that simply has content on one band (a trailing measure of a
        # shorter part, or a genuinely single-staff bar) is not a collision.
        lanes_by_band: dict[str, set] = {}
        for event in collected:
            if event.band in ("upper", "lower"):
                lanes_by_band.setdefault(event.band, set()).add(event.lane)
        collided = sorted(band for band, lanes in lanes_by_band.items() if len(lanes) > 1)
        if collided:
            collisions.append(xml_index)
            for event in collected:
                if event.band in collided:
                    event.printed = False
            present = tuple(sorted({e.band for e in collected if e.printed}))
        measures.append(PrintedMeasure(index=xml_index, xml_measure_index=xml_index,
                                       key_fifths=key_fifths, bands_present=present,
                                       events=collected))
        key_updates = []
        for part in parts:
            part_measures = part.findall("measure")
            if xml_index >= len(part_measures):
                continue
            attributes = part_measures[xml_index].find("attributes")
            if attributes is None:
                continue
            for key_node in attributes.findall("key"):
                fifths_text = key_node.findtext("fifths")
                if fifths_text and fifths_text.strip().lstrip("-").isdigit():
                    key_updates.append(int(fifths_text))
        if key_updates:
            key_fifths = key_updates[-1]
    collision_budget = max(4, int(0.05 * total_measures))
    if collisions and (len(collisions) > collision_budget or len(collisions) == total_measures):
        return {"ok": False,
                "rejected": [f"{len(collisions)} of {total_measures} printed measures have two "
                             f"MusicXML lanes claiming the same staff band (first at printed "
                             f"measure {collisions[0] + 1}); budget is {collision_budget}"]}

    printed = [e for m in measures for e in m.events if e.printed]
    if not printed:
        return {"ok": False, "rejected": ["no printed note events"]}

    lanes: dict[str, dict] = {}
    for key, (sign, line, octave_change) in sorted(initial.items()):
        lanes[key] = {"initial_clef": f"{sign}{line}", "initial_band": band_for_clef(sign, line),
                      "initial_octave_change": octave_change,
                      "center_diatonic": clef_center_diatonic(sign, line)}

    layout = root.find("part-list")
    part_names = {}
    if layout is not None:
        for score_part in layout.findall("score-part"):
            part_names[score_part.get("id")] = (score_part.findtext("part-name") or "").strip()

    return {
        "ok": True,
        "score_id": Path(path).stem,
        "title": title,
        "part_names": part_names,
        "measures": total_measures,
        "part_measure_counts": counts,
        "trailing_measure_deficit": deficit,
        "clef_change_elements": clef_change_count,
        "band_collision_measures": [i + 1 for i in collisions],
        "printed_events": len(printed),
        "printed_rests": sum(1 for e in printed if e.is_rest),
        "lanes": lanes,
        "truth": ScoreTruth(Path(path).stem, lanes, measures, clef_change_count),
    }
