#!/usr/bin/env python3
"""Generate the redistributable Corranzo OMR benchmark corpus.

The scores, engravings, and truth MusicXML are original benchmark material
dedicated to the public domain under CC0-1.0. They are intentionally small but
cover notation structures that exercise different OMR pipeline stages. PDFs
are deterministic (`reportlab` invariant mode); scanned fixtures are seeded,
image-only derivatives of the corresponding vector engraving.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import random
import shutil
import subprocess
import tempfile
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from PIL import Image, ImageEnhance, ImageFilter
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "benchmarks" / "omr-fixtures"
FONT_PATH = OUT_DIR / "font" / "CorranzoBenchmarkMusic.ttf"
DIVISIONS = 12
MEASURE_DURATION = DIVISIONS * 4
PAGE_WIDTH, PAGE_HEIGHT = letter
GUITAR_TUNING = [64, 59, 55, 50, 45, 40]  # string 1 first
GENERATOR_VERSION = 2

NOTEHEAD_BLACK = "\ue0a4"
NOTEHEAD_HALF = "\ue0a3"
NOTEHEAD_WHOLE = "\ue0a2"
G_CLEF = "\ue050"
F_CLEF = "\ue062"
TIME_4 = "\ue084"
TIME_3 = "\ue083"
REST_WHOLE = "\ue4e3"
REST_HALF = "\ue4e4"
REST_EIGHTH = "\ue4e6"
REST_16TH = "\ue4e7"
ARTIC_STACCATO = "\ue4a0"
ARTIC_ACCENT = "\ue4a3"

# Accidental outlines are drawn as PDF paths (not text-layer glyphs) so the
# OMR path/ink accidental primitive can be evaluated without SMuFL text.

STEP_NAMES = ["C", "D", "E", "F", "G", "A", "B"]
NATURAL_SEMITONES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
PITCH_NAMES = {
    0: ("C", 0),
    1: ("C", 1),
    2: ("D", 0),
    3: ("D", 1),
    4: ("E", 0),
    5: ("F", 0),
    6: ("F", 1),
    7: ("G", 0),
    8: ("G", 1),
    9: ("A", 0),
    10: ("A", 1),
    11: ("B", 0),
}


def note(
    *pitches: int,
    duration: int = DIVISIONS,
    staff: int = 1,
    tab: list[tuple[int, int]] | None = None,
    **metadata: Any,
) -> dict[str, Any]:
    return {
        "kind": "note",
        "pitches": list(pitches),
        "duration": duration,
        "staff": staff,
        "tab": tab,
        **metadata,
    }


def rest(duration: int = DIVISIONS, staff: int = 1, **metadata: Any) -> dict[str, Any]:
    return {"kind": "rest", "duration": duration, "staff": staff, **metadata}


def measure(
    *voices: list[dict[str, Any]],
    repeat_start: bool = False,
    repeat_end: bool = False,
    volta: str | None = None,
) -> dict[str, Any]:
    return {
        "voices": [list(voice) for voice in voices],
        "repeatStart": repeat_start,
        "repeatEnd": repeat_end,
        "volta": volta,
    }


def validate_measures(measures: list[dict[str, Any]]) -> None:
    for measure_number, item in enumerate(measures, 1):
        for voice_number, voice in enumerate(item["voices"], 1):
            total = sum(event["duration"] for event in voice)
            if total != MEASURE_DURATION:
                raise ValueError(
                    f"measure {measure_number} voice {voice_number} totals {total}, expected {MEASURE_DURATION}"
                )


def tab_pitch(string: int, fret: int) -> int:
    return GUITAR_TUNING[string - 1] + fret


def tab_event(
    positions: list[tuple[int, int]], duration: int = DIVISIONS, **metadata: Any
) -> dict[str, Any]:
    return note(
        *(tab_pitch(string, fret) for string, fret in positions),
        duration=duration,
        tab=positions,
        **metadata,
    )


def repeat_pattern(pattern: list[int], count: int) -> list[int]:
    return [pattern[index % len(pattern)] for index in range(count)]


def quarter_measure(pitches: list[int], *, staff: int = 1, **metadata: Any) -> dict[str, Any]:
    return measure(
        [
            note(pitch, duration=DIVISIONS, staff=staff, **(metadata if index == 0 else {}))
            for index, pitch in enumerate(pitches)
        ]
    )


def piano_beginner() -> list[dict[str, Any]]:
    patterns = [
        [64, 65, 67, 69],
        [71, 69, 67, 65],
        [64, 67, 69, 67],
        [65, 64, 62, 64],
    ]
    measures = [quarter_measure(patterns[index % len(patterns)]) for index in range(6)]
    measures.append(
        measure(
            [
                note(64, duration=18, dotted=True),
                note(67, duration=6),
                rest(duration=DIVISIONS),
                note(69, duration=DIVISIONS),
            ]
        )
    )
    measures.append(
        measure(
            [
                note(71, duration=6),
                note(69, duration=6),
                note(67, duration=DIVISIONS),
                note(65, duration=DIVISIONS),
                note(64, duration=DIVISIONS),
            ]
        )
    )
    return measures


def piano_grand_voices() -> list[dict[str, Any]]:
    measures = []
    treble_roots = [60, 62, 64, 65, 67, 69, 67, 64]
    bass_roots = [36, 38, 40, 41, 43, 45, 43, 40]
    for index, (root, bass) in enumerate(zip(treble_roots, bass_roots)):
        treble = [
            note(root, root + 4, root + 7, articulation="staccato" if index % 2 == 0 else "accent"),
            note(root + 2, duration=DIVISIONS),
            note(root + 4, root + 7, duration=DIVISIONS),
            note(
                root + 5,
                duration=DIVISIONS,
                tie_start=index == 2,
                tie_stop=index == 3,
                slur_start=index == 0,
                slur_stop=index == 1,
            ),
        ]
        bass_voice = [
            note(bass, bass + 7, duration=DIVISIONS * 2, staff=2),
            note(bass + 5, bass + 12, duration=DIVISIONS * 2, staff=2),
        ]
        measures.append(
            measure(
                treble,
                bass_voice,
                repeat_start=index == 0,
                repeat_end=index == 7,
                volta="1" if index == 6 else ("2" if index == 7 else None),
            )
        )
    return measures


def piano_rhythm_tuplets() -> list[dict[str, Any]]:
    measures = []
    scale = repeat_pattern([64, 65, 67, 69, 71, 72, 71, 69], 16)
    measures.append(measure([note(pitch, duration=6) for pitch in scale[:8]]))
    measures.append(measure([note(pitch, duration=3) for pitch in scale[:16]]))
    measures.append(
        measure(
            [note(pitch, duration=4, tuplet=True) for pitch in [64, 65, 67] for _ in range(4)]
        )
    )
    measures.append(
        measure(
            [
                rest(duration=6),
                note(67, duration=6),
                note(69, duration=18, dotted=True),
                rest(duration=3),
                note(71, duration=3),
                note(72, duration=DIVISIONS),
            ]
        )
    )
    measures.append(
        measure(
            [
                note(72, duration=24, tie_start=True),
                note(72, duration=12, tie_stop=True),
                rest(duration=12),
            ]
        )
    )
    measures.append(measure([rest(duration=48)]))
    measures.append(measure([note(64, 67, duration=6) for _ in range(8)]))
    measures.append(
        measure(
            [
                note(65, duration=9, dotted=True),
                note(67, duration=3),
                note(69, duration=12),
                note(71, duration=6),
                note(72, duration=6),
                rest(duration=12),
            ]
        )
    )
    return measures


def piano_dense() -> list[dict[str, Any]]:
    measures = []
    upper_roots = [60, 62, 64, 65, 67, 69, 71, 72]
    lower_roots = [36, 38, 40, 41, 43, 45, 47, 48]
    for index, (upper, lower) in enumerate(zip(upper_roots, lower_roots)):
        top_voice = []
        for step in range(8):
            pitch = upper + [0, 2, 4, 5, 7, 5, 4, 2][step]
            top_voice.append(
                note(
                    pitch,
                    pitch + 4,
                    pitch + 7,
                    duration=6,
                    articulation="accent" if step in (0, 4) else None,
                )
            )
        bottom_voice = [
            note(lower, lower + 7, lower + 12, duration=12, staff=2),
            note(lower + 2, lower + 9, duration=12, staff=2),
            note(lower + 4, lower + 11, duration=12, staff=2),
            note(lower + 5, lower + 12, duration=12, staff=2),
        ]
        measures.append(measure(top_voice, bottom_voice))
    return measures


def guitar_tab_sparse() -> list[dict[str, Any]]:
    patterns = [
        [(1, 0), (2, 1), (3, 2), (4, 2)],
        [(1, 12), (2, 10), (3, 12), (4, 10)],
        [(1, 3), (2, 3), (3, 4), (4, 5)],
        [(1, 7), (2, 8), (3, 7), (4, 9)],
    ]
    measures = []
    for index in range(8):
        positions = patterns[index % len(patterns)]
        voice = [
            tab_event([position], technique="slide" if beat == 1 and index == 2 else None)
            for beat, position in enumerate(positions)
        ]
        measures.append(
            measure(
                voice,
                repeat_start=index == 0,
                repeat_end=index == 7,
                volta="1" if index == 6 else ("2" if index == 7 else None),
            )
        )
    return measures


def guitar_standard() -> list[dict[str, Any]]:
    shapes = [
        [64, 67],
        [59, 64],
        [55, 59, 64],
        [52, 55, 59, 64],
        [50, 55],
        [45, 52, 57],
        [47, 50, 55, 59],
        [40, 47, 52, 55, 59, 64],
    ]
    measures = []
    for index, shape in enumerate(shapes):
        voice = [
            note(*shape, duration=6),
            note(*(pitch + 2 for pitch in shape[: max(2, len(shape) - 1)]), duration=6),
            note(*shape, duration=12),
            note(*shape[:2], duration=12),
            note(*shape, duration=12),
        ]
        measures.append(measure(voice))
    return measures


def guitar_paired_chords() -> list[dict[str, Any]]:
    shapes = [
        [(1, 0), (2, 1), (3, 0)],
        [(1, 3), (2, 3), (3, 2), (4, 0)],
        [(1, 5), (2, 5), (3, 5), (4, 7), (5, 7)],
        [(1, 12), (2, 12), (3, 12), (4, 14), (5, 14), (6, 12)],
        [(1, 7), (2, 8), (3, 7)],
        [(1, 10), (2, 10), (3, 9), (4, 12)],
        [(1, 2), (2, 3), (3, 2), (4, 4), (5, 5)],
        [(1, 0), (2, 1), (3, 0), (4, 2), (5, 3), (6, 3)],
    ]
    measures = []
    for index, shape in enumerate(shapes):
        voice = [
            tab_event(shape, duration=12),
            tab_event(shape[: max(2, len(shape) - 1)], duration=12),
            tab_event(shape, duration=12),
            tab_event(shape[:2], duration=12),
        ]
        measures.append(
            measure(
                voice,
                repeat_start=index == 0,
                repeat_end=index == 7,
            )
        )
    return measures


def guitar_techniques() -> list[dict[str, Any]]:
    cells = [
        [(1, 5), (1, 7), (1, 8), (1, 7)],
        [(2, 5), (2, 7), (2, 8), (2, 10)],
        [(3, 7), (3, 9), (3, 10), (3, 9)],
        [(4, 7), (4, 9), (4, 10), (4, 12)],
    ]
    measures = []
    techniques = ["hammer-on", "pull-off", "slide", "tie"]
    for index in range(8):
        cell = cells[index % len(cells)]
        voice = []
        for beat, position in enumerate(cell):
            voice.append(
                tab_event(
                    [position],
                    technique=techniques[index % len(techniques)] if beat == 1 else None,
                    tie_start=index == 3 and beat == 3,
                    tie_stop=index == 4 and beat == 0,
                )
            )
        measures.append(measure(voice))
    return measures


@dataclass(frozen=True)
class Fixture:
    id: str
    title: str
    instrument: str
    layout: str
    measures: list[dict[str, Any]]
    categories: tuple[str, ...]
    density: str
    scanned: bool = False
    source_fixture: str | None = None
    annotations: tuple[str, ...] = ()
    expected_outcome: str = "transcribe"


def fixture_catalog() -> list[Fixture]:
    scanned_piano = piano_grand_voices()
    scanned_guitar = guitar_paired_chords()
    return [
        Fixture(
            "piano-beginner-single-vector",
            "CC0 Beginner Line Study",
            "piano",
            "single",
            piano_beginner(),
            ("clean-beginner-single-staff", "rests-dotted-rhythms", "eighth-notes", "modern-vector-pdf"),
            "sparse",
        ),
        Fixture(
            "piano-grand-voices-vector",
            "CC0 Grand Staff Voice Study",
            "piano",
            "grand",
            piano_grand_voices(),
            ("grand-staff", "chords-multiple-voices", "ties-slurs-articulations", "repeats-voltas", "modern-vector-pdf"),
            "medium",
        ),
        Fixture(
            "piano-rhythm-tuplets-vector",
            "CC0 Rhythm and Tuplet Study",
            "piano",
            "single",
            piano_rhythm_tuplets(),
            ("eighth-sixteenth-rhythms", "tuplets", "rests-dotted-rhythms", "ties", "modern-vector-pdf"),
            "medium",
        ),
        Fixture(
            "piano-articulation-scan",
            "CC0 Articulation Scan Study",
            "piano",
            "grand",
            scanned_piano,
            ("scanned-score", "grand-staff", "ties-slurs-articulations", "chords-multiple-voices"),
            "medium",
            scanned=True,
            source_fixture="piano-grand-voices-vector",
        ),
        Fixture(
            "piano-dense-advanced-vector",
            "CC0 Dense Advanced Texture Study",
            "piano",
            "grand",
            piano_dense(),
            ("dense-advanced-score", "grand-staff", "chords-multiple-voices", "eighth-sixteenth-rhythms", "modern-vector-pdf"),
            "dense",
        ),
        Fixture(
            "guitar-tab-sparse-vector",
            "CC0 Sparse TAB Technique Study",
            "guitar",
            "tab",
            guitar_tab_sparse(),
            ("tab-only", "multi-digit-frets", "techniques", "sparse-layout", "capo-repeat-coda", "vector-pdf"),
            "sparse",
            annotations=("Capo 2", "D.S. al Coda", "h  p  /"),
        ),
        Fixture(
            "guitar-standard-chords-vector",
            "CC0 Standard Guitar Chord Study",
            "guitar",
            "standard",
            guitar_standard(),
            ("standard-notation-only", "double-stops", "three-to-six-note-chord-stacks", "sparse-and-dense-layouts", "vector-pdf"),
            "dense",
        ),
        Fixture(
            "guitar-paired-chords-vector",
            "CC0 Paired Notation and TAB Study",
            "guitar",
            "paired",
            guitar_paired_chords(),
            ("paired-notation-tab", "three-to-six-note-chord-stacks", "multi-digit-frets", "dense-layout", "capo-repeat-coda", "vector-pdf"),
            "dense",
            annotations=("Capo 3", "To Coda"),
        ),
        Fixture(
            "guitar-techniques-paired-vector",
            "CC0 Guitar Technique Pairing Study",
            "guitar",
            "paired",
            guitar_techniques(),
            ("paired-notation-tab", "techniques-ties-slides-hammer-ons-pull-offs", "double-stops", "sparse-layout", "vector-pdf"),
            "sparse",
            annotations=("h", "p", "/", "tie"),
        ),
        Fixture(
            "guitar-paired-scan",
            "CC0 Paired Guitar Scan Study",
            "guitar",
            "paired",
            scanned_guitar,
            ("paired-notation-tab", "scanned-score", "multi-digit-frets", "three-to-six-note-chord-stacks", "dense-layout"),
            "dense",
            scanned=True,
            source_fixture="guitar-paired-chords-vector",
            annotations=("Capo 3", "To Coda"),
            expected_outcome="reject-honestly",
        ),
    ]


def midi_to_pitch(midi: int) -> tuple[str, int, int]:
    octave = midi // 12 - 1
    step, alter = PITCH_NAMES[midi % 12]
    return step, alter, octave


def diatonic_number(step: str, octave: int) -> int:
    return octave * 7 + STEP_NAMES.index(step)


def staff_y(midi: int, bottom_y: float, gap: float, clef: str) -> float:
    step, _alter, octave = midi_to_pitch(midi)
    base_step, base_octave = ("E", 4) if clef == "treble" else ("G", 2)
    offset = diatonic_number(step, octave) - diatonic_number(base_step, base_octave)
    return bottom_y + offset * gap / 2


def event_onsets(voice: list[dict[str, Any]]) -> list[tuple[int, dict[str, Any]]]:
    onset = 0
    result = []
    for event in voice:
        result.append((onset, event))
        onset += event["duration"]
    return result


def note_type(duration: int) -> str:
    return {
        48: "whole",
        36: "half",
        24: "half",
        18: "quarter",
        12: "quarter",
        9: "eighth",
        6: "eighth",
        4: "eighth",
        3: "16th",
    }.get(duration, "quarter")


def musicxml_for_fixture(fixture: Fixture) -> str:
    validate_measures(fixture.measures)
    staves = 2 if fixture.layout == "grand" else 1
    part_name = "Piano" if fixture.instrument == "piano" else "Guitar"
    midi_program = 1 if fixture.instrument == "piano" else 25
    lines = [
        '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
        '<score-partwise version="4.0">',
        f"  <work><work-title>{escape(fixture.title)}</work-title></work>",
        "  <identification>",
        "    <creator type=\"composer\">Corranzo OMR Benchmark Project</creator>",
        "    <rights>CC0 1.0 Universal - public domain dedication</rights>",
        "    <encoding><software>Corranzo deterministic OMR benchmark generator</software></encoding>",
        "  </identification>",
        "  <part-list><score-part id=\"P1\">",
        f"    <part-name>{part_name}</part-name>",
        "    <score-instrument id=\"P1-I1\"><instrument-name>"
        + part_name
        + "</instrument-name></score-instrument>",
        f"    <midi-instrument id=\"P1-I1\"><midi-channel>1</midi-channel><midi-program>{midi_program}</midi-program></midi-instrument>",
        "  </score-part></part-list>",
        "  <part id=\"P1\">",
    ]
    for measure_number, item in enumerate(fixture.measures, 1):
        lines.append(f'    <measure number="{measure_number}">')
        if measure_number == 1:
            lines.extend(
                [
                    "      <attributes>",
                    f"        <divisions>{DIVISIONS}</divisions>",
                    "        <key><fifths>0</fifths></key>",
                    "        <time><beats>4</beats><beat-type>4</beat-type></time>",
                    f"        <staves>{staves}</staves>",
                    "        <clef number=\"1\"><sign>G</sign><line>2</line></clef>",
                ]
            )
            if staves == 2:
                lines.append("        <clef number=\"2\"><sign>F</sign><line>4</line></clef>")
            lines.append("      </attributes>")
            lines.append("      <direction placement=\"above\"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>88</per-minute></metronome></direction-type><sound tempo=\"88\"/></direction>")
        if item.get("repeatStart"):
            lines.append('      <barline location="left"><repeat direction="forward"/></barline>')
        if item.get("volta"):
            lines.append(
                f'      <barline location="left"><ending number="{item["volta"]}" type="start"/></barline>'
            )
        for voice_index, voice in enumerate(item["voices"], 1):
            if voice_index > 1:
                lines.append(f"      <backup><duration>{MEASURE_DURATION}</duration></backup>")
            for event in voice:
                if event["kind"] == "rest":
                    lines.extend(
                        [
                            "      <note>",
                            "        <rest/>",
                            f"        <duration>{event['duration']}</duration>",
                            f"        <voice>{voice_index}</voice>",
                            f"        <type>{note_type(event['duration'])}</type>",
                            f"        <staff>{event.get('staff', 1)}</staff>",
                            "      </note>",
                        ]
                    )
                    continue
                for chord_index, midi in enumerate(event["pitches"]):
                    step, alter, octave = midi_to_pitch(midi)
                    lines.append("      <note>")
                    if chord_index > 0:
                        lines.append("        <chord/>")
                    lines.append(f"        <pitch><step>{step}</step>")
                    if alter:
                        lines.append(f"          <alter>{alter}</alter>")
                    lines.append(f"          <octave>{octave}</octave></pitch>")
                    lines.append(f"        <duration>{event['duration']}</duration>")
                    lines.append(f"        <voice>{voice_index}</voice>")
                    lines.append(f"        <type>{note_type(event['duration'])}</type>")
                    if event.get("dotted"):
                        lines.append("        <dot/>")
                    if event.get("tuplet"):
                        lines.append("        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>")
                    if event.get("tie_start"):
                        lines.append('        <tie type="start"/>')
                    if event.get("tie_stop"):
                        lines.append('        <tie type="stop"/>')
                    lines.append(f"        <staff>{event.get('staff', 1)}</staff>")
                    notations = []
                    if event.get("tie_start"):
                        notations.append('<tied type="start"/>')
                    if event.get("tie_stop"):
                        notations.append('<tied type="stop"/>')
                    if event.get("slur_start"):
                        notations.append('<slur type="start" number="1"/>')
                    if event.get("slur_stop"):
                        notations.append('<slur type="stop" number="1"/>')
                    articulation = event.get("articulation")
                    if articulation == "staccato":
                        notations.append("<articulations><staccato/></articulations>")
                    elif articulation == "accent":
                        notations.append("<articulations><accent/></articulations>")
                    if event.get("tuplet") and chord_index == 0:
                        notations.append('<tuplet type="start" number="1"/>')
                    tab = event.get("tab")
                    if tab and chord_index < len(tab):
                        string, fret = tab[chord_index]
                        notations.append(
                            f"<technical><string>{string}</string><fret>{fret}</fret></technical>"
                        )
                    if notations:
                        lines.append("        <notations>" + "".join(notations) + "</notations>")
                    lines.append("      </note>")
        if item.get("repeatEnd"):
            lines.append('      <barline location="right"><repeat direction="backward"/></barline>')
        if item.get("volta"):
            lines.append(
                f'      <barline location="right"><ending number="{item["volta"]}" type="stop"/></barline>'
            )
        lines.append("    </measure>")
    lines.extend(["  </part>", "</score-partwise>", ""])
    return "\n".join(lines)


def register_font() -> None:
    if not FONT_PATH.exists():
        raise FileNotFoundError(
            f"Missing {FONT_PATH}. Run scripts/build-omr-benchmark-font.py first."
        )
    if "CorranzoBenchmarkMusic" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("CorranzoBenchmarkMusic", str(FONT_PATH)))


def draw_staff(c: canvas.Canvas, bottom_y: float, x0: float, x1: float, lines: int) -> list[float]:
    gap = 8.0
    c.setStrokeColorRGB(0.08, 0.08, 0.08)
    c.setLineWidth(0.65)
    ys = []
    for line_index in range(lines):
        y = bottom_y + line_index * gap
        ys.append(y)
        c.line(x0, y, x1, y)
    return ys


def draw_barline(c: canvas.Canvas, x: float, y0: float, y1: float, *, double: bool = False) -> None:
    c.setStrokeColorRGB(0.05, 0.05, 0.05)
    c.setLineWidth(1.0)
    c.line(x, y0, x, y1)
    if double:
        c.setLineWidth(1.8)
        c.line(x + 4, y0, x + 4, y1)


def event_x(measure_x: float, measure_width: float, onset: int, first_measure: bool) -> float:
    left = 0.38 if first_measure else 0.16
    usable = 0.54 if first_measure else 0.72
    return measure_x + measure_width * (left + usable * onset / MEASURE_DURATION)


def draw_music_glyph(c: canvas.Canvas, glyph: str, x: float, y: float, size: float = 16) -> None:
    c.setFont("CorranzoBenchmarkMusic", size)
    c.setFillColorRGB(0.04, 0.04, 0.04)
    c.drawString(x, y, glyph)


def draw_path_accidental(c: canvas.Canvas, alter: int, x: float, y: float, size: float = 11.0) -> None:
    """Draw a local accidental as one filled path (not a text glyph).

    Coordinates are notehead-centered; the mark is placed to the left.
    A single constructPath keeps sharp/flat/natural geometry classifiable
    without relying on fragment clustering.
    """
    ax = x - size * 1.15
    ay = y
    c.setFillColorRGB(0.02, 0.02, 0.02)
    c.setStrokeColorRGB(0.02, 0.02, 0.02)
    path = c.beginPath()
    if alter > 0:
        hw = size * 0.14
        gap = size * 0.28
        # Left vertical
        path.moveTo(ax - gap - hw / 2, ay - size * 0.55)
        path.lineTo(ax - gap + hw / 2, ay - size * 0.55)
        path.lineTo(ax - gap + hw / 2, ay + size * 0.55)
        path.lineTo(ax - gap - hw / 2, ay + size * 0.55)
        path.close()
        # Right vertical
        path.moveTo(ax + gap - hw / 2, ay - size * 0.55)
        path.lineTo(ax + gap + hw / 2, ay - size * 0.55)
        path.lineTo(ax + gap + hw / 2, ay + size * 0.55)
        path.lineTo(ax + gap - hw / 2, ay + size * 0.55)
        path.close()
        # Lower horizontal (slight slant)
        path.moveTo(ax - size * 0.42, ay - size * 0.18 - hw / 2)
        path.lineTo(ax + size * 0.42, ay - size * 0.18 - hw / 2 + size * 0.08)
        path.lineTo(ax + size * 0.42, ay - size * 0.18 + hw / 2 + size * 0.08)
        path.lineTo(ax - size * 0.42, ay - size * 0.18 + hw / 2)
        path.close()
        # Upper horizontal
        path.moveTo(ax - size * 0.42, ay + size * 0.18 - hw / 2)
        path.lineTo(ax + size * 0.42, ay + size * 0.18 - hw / 2 + size * 0.08)
        path.lineTo(ax + size * 0.42, ay + size * 0.18 + hw / 2 + size * 0.08)
        path.lineTo(ax - size * 0.42, ay + size * 0.18 + hw / 2)
        path.close()
        c.drawPath(path, stroke=0, fill=1)
        return
    if alter < 0:
        stem_w = size * 0.16
        path.moveTo(ax - size * 0.28, ay - size * 0.55)
        path.lineTo(ax - size * 0.28 + stem_w, ay - size * 0.55)
        path.lineTo(ax - size * 0.28 + stem_w, ay + size * 0.6)
        path.lineTo(ax - size * 0.28, ay + size * 0.6)
        path.close()
        path.moveTo(ax - size * 0.12, ay + size * 0.05)
        path.curveTo(
            ax + size * 0.55,
            ay + size * 0.35,
            ax + size * 0.5,
            ay - size * 0.15,
            ax - size * 0.12,
            ay - size * 0.35,
        )
        path.close()
        c.drawPath(path, stroke=0, fill=1)
        return
    hw = size * 0.15
    path.moveTo(ax - size * 0.32, ay - size * 0.55)
    path.lineTo(ax - size * 0.32 + hw, ay - size * 0.55)
    path.lineTo(ax - size * 0.32 + hw, ay + size * 0.55)
    path.lineTo(ax - size * 0.32, ay + size * 0.55)
    path.close()
    path.moveTo(ax + size * 0.12, ay - size * 0.55)
    path.lineTo(ax + size * 0.12 + hw, ay - size * 0.55)
    path.lineTo(ax + size * 0.12 + hw, ay + size * 0.55)
    path.lineTo(ax + size * 0.12, ay + size * 0.55)
    path.close()
    path.moveTo(ax - size * 0.32, ay + size * 0.08)
    path.lineTo(ax - size * 0.32 + size * 0.6, ay + size * 0.08)
    path.lineTo(ax - size * 0.32 + size * 0.6, ay + size * 0.08 + hw)
    path.lineTo(ax - size * 0.32, ay + size * 0.08 + hw)
    path.close()
    path.moveTo(ax - size * 0.18, ay - size * 0.22)
    path.lineTo(ax - size * 0.18 + size * 0.6, ay - size * 0.22)
    path.lineTo(ax - size * 0.18 + size * 0.6, ay - size * 0.22 + hw)
    path.lineTo(ax - size * 0.18, ay - size * 0.22 + hw)
    path.close()
    c.drawPath(path, stroke=0, fill=1)


def draw_standard_event(
    c: canvas.Canvas,
    event: dict[str, Any],
    x: float,
    treble_bottom: float,
    bass_bottom: float | None,
    gap: float = 8.0,
) -> list[tuple[float, float]]:
    if event["kind"] == "rest":
        glyph = {
            48: REST_WHOLE,
            24: REST_HALF,
            6: REST_EIGHTH,
            3: REST_16TH,
        }.get(event["duration"], REST_EIGHTH)
        bottom = bass_bottom if event.get("staff") == 2 and bass_bottom is not None else treble_bottom
        draw_music_glyph(c, glyph, x - 5, bottom + gap * 1.5, 14)
        return []

    staff_number = event.get("staff", 1)
    clef = "bass" if staff_number == 2 and bass_bottom is not None else "treble"
    bottom = bass_bottom if clef == "bass" else treble_bottom
    glyph = NOTEHEAD_BLACK
    if event["duration"] >= 48:
        glyph = NOTEHEAD_WHOLE
    elif event["duration"] >= 24:
        glyph = NOTEHEAD_HALF
    positions = []
    for chord_index, midi in enumerate(event["pitches"]):
        y = staff_y(midi, bottom, gap, clef)
        stagger = 2.5 if chord_index > 0 and positions and abs(y - positions[-1][1]) < gap * 0.65 else 0
        _step, alter, _octave = midi_to_pitch(midi)
        if alter:
            # Column-stack accidentals left of the chord tone they alter.
            draw_path_accidental(c, alter, x - 5 + stagger, y, size=10.5)
        draw_music_glyph(c, glyph, x - 5 + stagger, y - 4, 15)
        positions.append((x + stagger, y))
        if y < bottom - gap * 0.65 or y > bottom + gap * 4.65:
            ledger_y = bottom + round((y - bottom) / gap) * gap
            c.setLineWidth(0.7)
            c.line(x - 8, ledger_y, x + 9, ledger_y)
    if event["duration"] < 48 and positions:
        stem_x = max(position[0] for position in positions) + 5
        stem_low = min(position[1] for position in positions)
        stem_high = max(position[1] for position in positions) + 24
        c.setLineWidth(0.8)
        c.line(stem_x, stem_low, stem_x, stem_high)
        if event["duration"] <= 6:
            c.line(stem_x, stem_high, stem_x + 8, stem_high - 6)
        if event["duration"] <= 3:
            c.line(stem_x, stem_high - 5, stem_x + 8, stem_high - 11)
    if event.get("dotted") and positions:
        c.circle(x + 11, positions[0][1] + 1, 1.5, stroke=0, fill=1)
    articulation = event.get("articulation")
    if articulation and positions:
        glyph = ARTIC_STACCATO if articulation == "staccato" else ARTIC_ACCENT
        draw_music_glyph(c, glyph, x - 4, max(y for _x, y in positions) + 15, 9)
    return positions


def draw_tab_event(
    c: canvas.Canvas,
    event: dict[str, Any],
    x: float,
    tab_bottom: float,
    gap: float = 8.0,
) -> None:
    tab = event.get("tab")
    if not tab:
        return
    for string, fret in tab:
        y = tab_bottom + (6 - string) * gap
        value = str(fret)
        width = pdfmetrics.stringWidth(value, "Helvetica-Bold", 8)
        c.setFillColorRGB(1, 1, 1)
        c.rect(x - width / 2 - 1.4, y - 3.1, width + 2.8, 7.4, stroke=0, fill=1)
        c.setFillColorRGB(0.03, 0.03, 0.03)
        c.setFont("Helvetica-Bold", 8)
        c.drawCentredString(x, y - 2.2, value)


def draw_repeat_and_volta(
    c: canvas.Canvas,
    item: dict[str, Any],
    x0: float,
    x1: float,
    y0: float,
    y1: float,
) -> None:
    if item.get("repeatStart"):
        c.circle(x0 + 7, (y0 + y1) / 2 + 4, 1.4, stroke=0, fill=1)
        c.circle(x0 + 7, (y0 + y1) / 2 - 4, 1.4, stroke=0, fill=1)
    if item.get("repeatEnd"):
        c.circle(x1 - 7, (y0 + y1) / 2 + 4, 1.4, stroke=0, fill=1)
        c.circle(x1 - 7, (y0 + y1) / 2 - 4, 1.4, stroke=0, fill=1)
    if item.get("volta"):
        c.setFont("Helvetica", 8)
        c.drawString(x0 + 5, y1 + 12, f"{item['volta']}.")
        c.line(x0 + 3, y1 + 8, x1 - 3, y1 + 8)
        c.line(x0 + 3, y1 + 8, x0 + 3, y1 + 1)


def draw_fixture_pdf(fixture: Fixture, output: Path) -> None:
    register_font()
    output.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(
        str(output), pagesize=letter, invariant=1, pageCompression=1
    )
    c.setTitle(fixture.title)
    c.setAuthor("Corranzo OMR Benchmark Project")
    c.setSubject("CC0-1.0 deterministic OMR benchmark fixture")
    c.setFont("Helvetica-Bold", 16)
    c.drawString(54, 752, fixture.title)
    c.setFont("Helvetica", 8.5)
    c.drawString(54, 736, "Original Corranzo OMR benchmark score - CC0 1.0")
    c.drawRightString(558, 736, f"{fixture.instrument.title()} / {fixture.density}")
    if fixture.annotations:
        c.setFont("Helvetica-Oblique", 8.5)
        c.drawString(54, 718, "   ".join(fixture.annotations))

    systems = [fixture.measures[:4], fixture.measures[4:8]]
    x0, x1 = 70.0, 558.0
    measure_width = (x1 - x0) / 4

    for system_index, system_measures in enumerate(systems):
        if fixture.layout == "grand":
            treble_bottom = 610 - system_index * 270
            bass_bottom = treble_bottom - 82
            draw_staff(c, treble_bottom, x0, x1, 5)
            draw_staff(c, bass_bottom, x0, x1, 5)
            y0, y1 = bass_bottom, treble_bottom + 32
            draw_music_glyph(c, G_CLEF, 74, treble_bottom - 5, 21)
            draw_music_glyph(c, F_CLEF, 74, bass_bottom + 2, 18)
        elif fixture.layout == "paired":
            treble_bottom = 615 - system_index * 285
            bass_bottom = None
            tab_bottom = treble_bottom - 102
            draw_staff(c, treble_bottom, x0, x1, 5)
            draw_staff(c, tab_bottom, x0, x1, 6)
            y0, y1 = tab_bottom, treble_bottom + 32
            draw_music_glyph(c, G_CLEF, 74, treble_bottom - 5, 20)
            c.setFont("Helvetica-Bold", 7)
            for letter_index, tab_letter in enumerate("TAB"):
                c.drawString(77, tab_bottom + 30 - letter_index * 10, tab_letter)
        elif fixture.layout == "tab":
            treble_bottom = None
            bass_bottom = None
            tab_bottom = 585 - system_index * 240
            draw_staff(c, tab_bottom, x0, x1, 6)
            y0, y1 = tab_bottom, tab_bottom + 40
            c.setFont("Helvetica-Bold", 7)
            for letter_index, tab_letter in enumerate("TAB"):
                c.drawString(77, tab_bottom + 30 - letter_index * 10, tab_letter)
        else:
            treble_bottom = 590 - system_index * 230
            bass_bottom = None
            draw_staff(c, treble_bottom, x0, x1, 5)
            y0, y1 = treble_bottom, treble_bottom + 32
            draw_music_glyph(c, G_CLEF, 74, treble_bottom - 5, 20)

        draw_music_glyph(c, TIME_4, 93, y1 - 27, 13)
        draw_music_glyph(c, TIME_4, 93, y1 - 42, 13)
        for boundary in range(5):
            x = x0 + boundary * measure_width
            double = boundary in (0, 4)
            if fixture.layout == "paired":
                draw_barline(c, x, treble_bottom, treble_bottom + 32, double=double)
                draw_barline(c, x, tab_bottom, tab_bottom + 40, double=double)
            else:
                draw_barline(c, x, y0, y1, double=double)

        for local_index, item in enumerate(system_measures):
            measure_x = x0 + local_index * measure_width
            measure_end = measure_x + measure_width
            c.setFont("Helvetica", 7)
            c.setFillColorRGB(0.15, 0.15, 0.15)
            c.drawString(measure_x + 4, y1 + 4, str(system_index * 4 + local_index + 1))
            draw_repeat_and_volta(c, item, measure_x, measure_end, y0, y1)
            for voice in item["voices"]:
                for onset, event in event_onsets(voice):
                    x = event_x(measure_x, measure_width, onset, local_index == 0)
                    if fixture.layout != "tab":
                        positions = draw_standard_event(
                            c,
                            event,
                            x,
                            treble_bottom,
                            bass_bottom,
                        )
                        if event.get("tie_start") and positions:
                            y = min(position[1] for position in positions) - 8
                            c.bezier(x - 3, y, x + 12, y - 7, x + 24, y - 7, x + 36, y)
                        if event.get("slur_start") and positions:
                            y = max(position[1] for position in positions) + 10
                            c.bezier(x - 2, y, x + 20, y + 13, x + 42, y + 13, x + 64, y)
                        if event.get("tuplet") and onset % DIVISIONS == 0:
                            c.setFont("Helvetica", 7)
                            c.drawString(x - 1, treble_bottom + 51, "3")
                    if fixture.layout in ("tab", "paired"):
                        draw_tab_event(c, event, x, tab_bottom)
                    technique = event.get("technique")
                    if technique:
                        label = {"hammer-on": "h", "pull-off": "p", "slide": "/", "tie": "tie"}.get(technique, technique)
                        c.setFont("Helvetica-Oblique", 7)
                        anchor = tab_bottom + 50 if fixture.layout in ("tab", "paired") else y1 + 14
                        c.drawString(x + 5, anchor, label)

    c.setFont("Helvetica", 7.5)
    c.setFillColorRGB(0.25, 0.25, 0.25)
    c.drawString(54, 42, f"Fixture {fixture.id} / generator v{GENERATOR_VERSION}")
    c.drawRightString(558, 42, "Use the paired MusicXML as truth; do not train on titles or coordinates.")
    c.showPage()
    c.save()


def scanned_pdf(vector_pdf: Path, output: Path, seed: int) -> None:
    pdftoppm = shutil.which("pdftoppm")
    if not pdftoppm:
        raise RuntimeError("pdftoppm is required to generate scanned benchmark PDFs")
    with tempfile.TemporaryDirectory(prefix="corranzo-omr-scan-") as tmp:
        prefix = Path(tmp) / "page"
        subprocess.run(
            [pdftoppm, "-f", "1", "-singlefile", "-r", "160", "-png", str(vector_pdf), str(prefix)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        image = Image.open(prefix.with_suffix(".png")).convert("L")
        image = image.rotate(0.32, resample=Image.Resampling.BICUBIC, expand=False, fillcolor=246)
        image = image.filter(ImageFilter.GaussianBlur(radius=0.35))
        pixels = image.load()
        rng = random.Random(seed)
        for _ in range(max(1, image.width * image.height // 110)):
            x = rng.randrange(image.width)
            y = rng.randrange(image.height)
            delta = rng.choice((-10, -7, 6, 8))
            pixels[x, y] = max(0, min(255, pixels[x, y] + delta))
        image = ImageEnhance.Contrast(image).enhance(0.93).convert("RGB")
        jpeg_buffer = io.BytesIO()
        image.save(jpeg_buffer, format="JPEG", quality=86, optimize=False, progressive=False)
        jpeg_buffer.seek(0)
        output.parent.mkdir(parents=True, exist_ok=True)
        c = canvas.Canvas(str(output), pagesize=letter, invariant=1, pageCompression=1)
        c.setTitle(vector_pdf.stem + " scanned benchmark")
        c.setAuthor("Corranzo OMR Benchmark Project")
        c.drawImage(ImageReader(jpeg_buffer), 0, 0, PAGE_WIDTH, PAGE_HEIGHT, mask=None)
        c.showPage()
        c.save()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_provenance(fixtures: list[Fixture]) -> None:
    records = []
    for fixture in fixtures:
        records.append(
            {
                "fixtureId": fixture.id,
                "title": fixture.title,
                "composer": "Corranzo OMR Benchmark Project",
                "arrangerEditor": None,
                "compositionPublicDomainStatus": "Original benchmark composition dedicated to the public domain under CC0-1.0.",
                "editionFileLicense": "CC0-1.0",
                "licenseFile": "LICENSE-CC0-1.0.txt",
                "sourcePage": "https://github.com/joedesmos-co/Corranzo/tree/main/benchmarks/omr-fixtures (generated locally from repository source; no third-party score source)",
                "generatorSource": "scripts/generate-omr-benchmark-corpus.py",
                "generationDate": "2026-07-15",
                "downloadDate": "Not applicable - generated locally on 2026-07-15",
                "allowedRedistributionUse": "Copy, modify, redistribute, benchmark, and train without restriction under the CC0 public-domain dedication.",
                "requiredAttribution": "None; attribution is appreciated but not required.",
                "instrument": fixture.instrument,
                "layout": fixture.layout,
                "density": fixture.density,
                "sourceFormatsAvailable": ["deterministic Python source", "PDF", "MusicXML"],
                "truthVerification": "PDF and MusicXML are generated from the same in-memory event model; automated tests validate checksums, parsing, counts, categories, and license records.",
                "categories": list(fixture.categories),
                "scanned": fixture.scanned,
                "scanSourceFixture": fixture.source_fixture,
                "expectedOutcome": fixture.expected_outcome,
            }
        )
    payload = {
        "schemaVersion": 1,
        "corpusLicense": "CC0-1.0",
        "generatorVersion": GENERATOR_VERSION,
        "records": records,
    }
    (OUT_DIR / "provenance.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8"
    )


def generate() -> dict[str, dict[str, str]]:
    fixtures = fixture_catalog()
    checksums: dict[str, dict[str, str]] = {}
    vector_sources: dict[str, Path] = {}
    for fixture in fixtures:
        validate_measures(fixture.measures)
        fixture_dir = OUT_DIR / fixture.id
        fixture_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = fixture_dir / f"{fixture.id}.pdf"
        xml_path = fixture_dir / f"{fixture.id}.musicxml"
        xml_path.write_text(musicxml_for_fixture(fixture), encoding="utf-8")
        if fixture.scanned:
            source = deepcopy(fixture)
            object.__setattr__(source, "scanned", False)
            vector_temp = fixture_dir / f".{fixture.id}.vector-source.pdf"
            draw_fixture_pdf(source, vector_temp)
            scanned_pdf(vector_temp, pdf_path, seed=int(hashlib.sha256(fixture.id.encode()).hexdigest()[:8], 16))
            vector_temp.unlink()
        else:
            draw_fixture_pdf(fixture, pdf_path)
            vector_sources[fixture.id] = pdf_path
        checksums[fixture.id] = {
            "pdf": sha256(pdf_path),
            "truth": sha256(xml_path),
        }
        print(f"Wrote {pdf_path.relative_to(ROOT)}")
        print(f"Wrote {xml_path.relative_to(ROOT)}")
    write_provenance(fixtures)
    checksum_path = OUT_DIR / "generated-checksums.json"
    checksum_path.write_text(json.dumps(checksums, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {checksum_path.relative_to(ROOT)}")
    return checksums


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--print-catalog", action="store_true")
    args = parser.parse_args()
    if args.print_catalog:
        print(
            json.dumps(
                [
                    {
                        "id": fixture.id,
                        "title": fixture.title,
                        "instrument": fixture.instrument,
                        "layout": fixture.layout,
                        "categories": fixture.categories,
                        "scanned": fixture.scanned,
                        "expectedOutcome": fixture.expected_outcome,
                    }
                    for fixture in fixture_catalog()
                ],
                indent=2,
            )
        )
        return
    generate()


if __name__ == "__main__":
    main()
