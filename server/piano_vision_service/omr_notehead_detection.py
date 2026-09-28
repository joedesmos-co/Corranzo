"""Raster proposals ported from src/features/omr/detectOmr{Noteheads,Rests}.js.

Pitch here is a geometric deduplication key; V2.5 owns output semantics.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

# Constants from Corranzo detectOmrNoteheads.js
WINDOW = 5
MIN_DARK = 10
MERGE_X = 7
MERGE_Y = 5

# Constants from Corranzo detectOmrRests.js
REST_WINDOW = 7
MIN_REST_DARK = 8
MAX_REST_DARK = 32


@dataclass
class NoteheadCandidate:
    """Detected notehead with all evidence."""
    midi: int
    clef: str
    cx: int
    cy: int
    x_norm: float
    y_norm: float
    ledger: Dict[str, Any]
    pitch_mapping: Any
    position_in_measure: float
    measure_number: int
    page: int
    detection_evidence: Dict[str, Any]
    object_type: str = "notehead"  # Visual detector owns this
    source_bbox: Optional[Dict[str, float]] = None


@dataclass
class RestCandidate:
    """Detected rest with all evidence."""
    cx: int
    cy: int
    x_norm: float
    y_norm: float
    position_in_measure: float
    measure_number: int
    page: int
    confidence: float
    object_type: str = "rest"  # Visual detector owns this
    source_bbox: Optional[Dict[str, float]] = None


def ink_mask(image_data, threshold):
    cache = image_data.setdefault("_ink_masks", {})
    if threshold not in cache:
        rgba = np.asarray(image_data["data"]).reshape(image_data["height"], image_data["width"], 4)
        alpha = rgba[:, :, 3].astype(float) / 255
        lum = rgba[:, :, :3] @ np.array([0.299, 0.587, 0.114])
        cache[threshold] = lum * alpha + 255 * (1-alpha) < threshold
    return cache[threshold]


def is_ink(data: np.ndarray, index: int, threshold: int) -> bool:
    """Check if pixel at index is ink (darker than threshold)."""
    if index < 0 or index + 3 >= len(data):
        return False
    alpha = float(data[index + 3]) / 255
    lum = sum(float(data[index + i]) * weight for i, weight in enumerate((0.299, 0.587, 0.114)))
    return lum * alpha + 255 * (1 - alpha) < threshold


def content_pixel_bounds(image_data: Dict[str, Any], box: Dict[str, float]) -> Dict[str, int]:
    """Find content bounds in pixel coordinates for a measure box."""
    width = image_data["width"]
    height = image_data["height"]
    
    left = int(box["x0"] * width)
    right = math.ceil(box["x1"] * width)
    top = int(box["y0"] * height)
    bottom = math.ceil(box["y1"] * height)
    
    left = max(0, left)
    right = min(width - 1, right)
    top = max(0, top)
    bottom = min(height - 1, bottom)
    
    return {"left": left, "right": right, "top": top, "bottom": bottom}


def is_likely_staff_line(image_data: Dict[str, Any], cx: int, cy: int, 
                         threshold: int, bounds: Dict[str, int]) -> bool:
    """Check if horizontal line at cy is a staff line."""
    return bool(ink_mask(image_data, threshold)[cy, bounds["left"]:bounds["right"]+1].mean() > 0.55)


def is_likely_barline(image_data: Dict[str, Any], cx: int, cy: int,
                      threshold: int, y0: float, y1: float) -> bool:
    """Check if vertical line at cx is a barline."""
    data = image_data["data"]
    width = image_data["width"]
    height = image_data["height"]
    top = int(y0 * height)
    bottom = min(height - 1, math.ceil(y1 * height))
    run = 0
    for y in range(top, bottom + 1):
        idx = (y * width + cx) * 4
        if is_ink(data, idx, threshold):
            run += 1
    return run / max(1, bottom - top + 1) > 0.62


def max_vertical_ink_run(image_data: Dict[str, Any], cx: int,
                         threshold: int, top: int, bottom: int) -> int:
    """Max contiguous vertical ink run at cx."""
    ink = ink_mask(image_data, threshold)
    if cx < 0 or cx >= image_data["width"]:
        return 0
    column = ink[max(0,top):min(image_data["height"],bottom+1), cx]
    edges = np.diff(np.r_[False, column, False].astype(np.int8))
    lengths = np.flatnonzero(edges == -1) - np.flatnonzero(edges == 1)
    return int(lengths.max()) if len(lengths) else 0


def is_likely_beam_ink(image_data: Dict[str, Any], cx: int, cy: int, threshold: int) -> bool:
    """Check if there's beam-like horizontal ink near cx, cy."""
    data = image_data["data"]
    width = image_data["width"]
    run = 0
    for x in range(cx - 8, cx + 9):
        if x < 0 or x >= width:
            continue
        idx = (cy * width + x) * 4
        if is_ink(data, idx, threshold):
            run += 1
    return run >= 9


def dark_count_in_window(image_data: Dict[str, Any], cx: int, cy: int,
                         threshold: int, bounds: Dict[str, int]) -> Tuple[int, int]:
    """Count dark pixels in window around cx, cy."""
    ink = ink_mask(image_data, threshold)
    half = WINDOW // 2
    region = ink[max(bounds["top"], cy-half):min(bounds["bottom"], cy+half)+1,
                 max(bounds["left"], cx-half):min(bounds["right"], cx+half)+1]
    return int(region.sum()), int(region.size)


def horizontal_run_covering(image_data: Dict[str, Any], cx: int, cy: int,
                            threshold: int, left: int, right: int, 
                            search_half: int) -> int:
    """Length of contiguous horizontal ink run covering cx on row cy."""
    data = image_data["data"]
    width = image_data["width"]
    
    def ink_at_x(x: int) -> bool:
        return left <= x <= right and is_ink(data, (cy * width + x) * 4, threshold)
    
    center = cx
    if not ink_at_x(center):
        center = -1
        for d in range(1, search_half + 1):
            if ink_at_x(cx - d):
                center = cx - d
                break
            if ink_at_x(cx + d):
                center = cx + d
                break
    if center < 0:
        return 0
    
    a = center
    b = center
    while a - 1 >= left and ink_at_x(a - 1):
        a -= 1
    while b + 1 <= right and ink_at_x(b + 1):
        b += 1
    return b - a + 1


def fill_ratio(image_data: Dict[str, Any], cx: int, cy: int,
               threshold: int, bounds: Dict[str, int],
               half_w: int, half_h: int) -> float:
    """Fill ratio in box around cx, cy."""
    ink = ink_mask(image_data, threshold)
    region = ink[max(bounds["top"], cy-half_h):min(bounds["bottom"], cy+half_h)+1,
                 max(bounds["left"], cx-half_w):min(bounds["right"], cx+half_w)+1]
    return float(region.mean()) if region.size else 0.0


def compact_wide_row_count(image_data: Dict[str, Any], cx: int, cy: int,
                           threshold: int, bounds: Dict[str, int],
                           half_w: int, half_h: int, min_width: int) -> int:
    """Count rows with wide ink runs in the box."""
    data = image_data["data"]
    width = image_data["width"]
    wide_rows = 0
    for y in range(cy - half_h, cy + half_h + 1):
        if y < bounds["top"] or y > bounds["bottom"]:
            continue
        row_ink = 0
        for x in range(cx - half_w, cx + half_w + 1):
            if x < bounds["left"] or x > bounds["right"]:
                continue
            if is_ink(data, (y * width + x) * 4, threshold):
                row_ink += 1
        if row_ink >= min_width:
            wide_rows += 1
    return wide_rows


def ink_bounding_box(image_data: Dict[str, Any], cx: int, cy: int,
                     threshold: int, radius_x: int, radius_y: int) -> Dict[str, int]:
    """Bounding box of ink within a local window."""
    data = image_data["data"]
    width = image_data["width"]
    height = image_data["height"]
    min_x = width
    max_x = -1
    min_y = height
    max_y = -1
    count = 0
    for y in range(cy - radius_y, cy + radius_y + 1):
        if y < 0 or y >= height:
            continue
        for x in range(cx - radius_x, cx + radius_x + 1):
            if x < 0 or x >= width:
                continue
            if is_ink(data, (y * width + x) * 4, threshold):
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y
                count += 1
    if count == 0:
        return {"w": 0, "h": 0, "count": 0}
    return {"w": max_x - min_x + 1, "h": max_y - min_y + 1, "count": count,
            "x0": min_x / width, "y0": min_y / height,
            "x1": (max_x + 1) / width, "y1": (max_y + 1) / height}


def staff_space_px(measure_box: Dict[str, float], height: int) -> float:
    """Estimate staff space in pixels from measure box staff lines."""
    treble = measure_box.get("staffLines", {}).get("treble", [])
    bass = measure_box.get("staffLines", {}).get("bass", [])
    lines = treble if len(treble) >= 2 else bass
    if len(lines) >= 2:
        ys = sorted([v * height for v in lines])
        spacing = (ys[-1] - ys[0]) / (len(ys) - 1)
        if 3 <= spacing <= 48:
            return spacing
    return 8.0


def js_round(value):
    """Math.round, including negative half-integers."""
    return math.floor(value + 0.5)


def clamp_int(value: float, lo: int, hi: int) -> int:
    return max(lo, min(hi, js_round(value)))


def detect_noteheads_in_measure(image_data: Dict[str, Any],
                                measure_box: Dict[str, Any],
                                ink_threshold: int,
                                options: Dict[str, Any] = {}) -> List[NoteheadCandidate]:
    """
    Full port of Corranzo's detectNoteheadsInMeasure with ALL mature filters.
    """
    dense = options.get("dense", False)
    skip_dense_fallback = options.get("skipDenseFallback", False)
    pitch_anchor_offset_ratio = options.get("pitchAnchorOffsetRatio", 0.0)
    expand_ledger_bounds = options.get("expandLedgerBounds", dense)
    
    data = image_data["data"]
    width = image_data["width"]
    height = image_data["height"]
    
    ss = staff_space_px(measure_box, height)
    
    # Content bounds for this measure
    ledger_margin_norm = (ss * 2.75) / height if expand_ledger_bounds else 0
    bounds = content_pixel_bounds(image_data, {
        "x0": measure_box.get("playableX0", measure_box["x0"]),
        "x1": measure_box["x1"],
        "y0": max(0, measure_box["y0"] - ledger_margin_norm),
        "y1": min(1, measure_box["y1"] + ledger_margin_norm),
    })
    
    if bounds["right"] < bounds["left"] or bounds["bottom"] < bounds["top"]:
        return []

    step = 2 if dense else 3
    max_vertical_ratio = 0.28 if dense else 0.34
    
    # Notehead shape gates, scaled to staff space
    mid_half_w = clamp_int(ss * 0.75, 2, 12)
    mid_half_h = clamp_int(ss * 0.6, 2, 10)
    outer_half_w = clamp_int(ss * 1.2, mid_half_w + 2, 20)
    outer_half_h = clamp_int(ss * 0.95, mid_half_h + 2, 18)
    
    min_mid_fill = 0.26 if dense else 0.3
    max_horizontal_run = max(48, js_round(ss * 12))
    max_outer_fill = 0.97 if dense else 0.96
    min_aspect = 0.12
    max_aspect = 8.0
    
    merge_x = 5 if dense else MERGE_X
    merge_y = 4 if dense else MERGE_Y
    
    candidates = []
    measure_width = bounds["right"] - bounds["left"] + 1
    
    ink = ink_mask(image_data, ink_threshold)
    staff_rows = ink[bounds["top"]:bounds["bottom"]+1, bounds["left"]:bounds["right"]+1].mean(axis=1) > 0.55
    bar_top = max(0, math.floor(measure_box["y0"] * height))
    bar_bottom = min(height-1, math.ceil(measure_box["y1"] * height))
    bar_columns = ink[bar_top:bar_bottom+1].mean(axis=0) > 0.62
    vertical_runs = [max_vertical_ink_run(image_data, x, ink_threshold, bounds["top"], bounds["bottom"])
                     for x in range(bounds["left"], bounds["right"]+1)]
    for cy in range(bounds["top"], bounds["bottom"] + 1, step):
        if staff_rows[cy-bounds["top"]]:
            continue
        for cx in range(bounds["left"], bounds["right"] + 1, step):
            if bar_columns[max(0,cx-3):min(width,cx+4)].any():
                continue
            vertical_run = vertical_runs[cx-bounds["left"]]
            if dense and vertical_run <= WINDOW and is_likely_beam_ink(image_data, cx, cy, ink_threshold):
                continue
            band_height = bounds["bottom"] - bounds["top"] + 1
            if vertical_run / max(1, band_height) > max_vertical_ratio:
                continue
            
            left_margin = max(4, int(measure_width * 0.05))
            right_margin = max(6, int(measure_width * 0.1))
            if cx - bounds["left"] < left_margin or bounds["right"] - cx < right_margin:
                continue
            
            dark, total = dark_count_in_window(image_data, cx, cy, ink_threshold, bounds)
            if total == 0 or dark < MIN_DARK:
                continue
            
            candidates.append({"cx": cx, "cy": cy})
    
    # --- STAGE 2: Merge nearby candidates ---
    merged = []
    for point in candidates:
        existing = None
        for item in merged:
            if abs(item["cx"] - point["cx"]) <= merge_x and abs(item["cy"] - point["cy"]) <= merge_y:
                existing = item
                break
        if existing:
            existing["cx"] = js_round((existing["cx"] + point["cx"]) / 2)
            existing["cy"] = js_round((existing["cy"] + point["cy"]) / 2)
            existing["count"] = existing.get("count", 1) + 1
        else:
            merged.append({**point, "count": 1})
    
    # --- STAGE 3: Shape gates on merged blobs ---
    detected = []
    for item in merged:
        cx, cy = item["cx"], item["cy"]
        
        # 1. Long horizontal ink = beam, tie/slur, ledger line or staff remnant
        if horizontal_run_covering(image_data, cx, cy, ink_threshold,
                                    bounds["left"], bounds["right"], mid_half_w) > max_horizontal_run:
            continue
        
        # 2. Mid fill ratio - primary discriminator
        mid_fill = fill_ratio(image_data, cx, cy, ink_threshold, bounds, mid_half_w, mid_half_h)
        if mid_fill < min_mid_fill:
            continue
        
        # 3. Wide rows - notehead must have several dense rows
        wide_rows = compact_wide_row_count(
            image_data, cx, cy, ink_threshold, bounds,
            mid_half_w, mid_half_h, max(4, js_round(ss * 0.4))
        )
        if wide_rows < max(3, js_round(ss * 0.28)):
            continue
        
        # 4. Vertical run vs wide rows - reject tall thin strokes
        local_vertical_run = max_vertical_ink_run(
            image_data, cx, ink_threshold, bounds["top"], bounds["bottom"]
        )
        if local_vertical_run > ss * 2.5 and wide_rows < max(5, js_round(ss * 0.42)):
            continue
        
        # 5. Over-dense neighbourhood = inside beam body, thick text or barline
        if fill_ratio(image_data, cx, cy, ink_threshold, bounds, outer_half_w, outer_half_h) > max_outer_fill:
            continue
        
        # 6. Roughly round bounding box
        blob = ink_bounding_box(image_data, cx, cy, ink_threshold, outer_half_w, outer_half_h)
        if blob["count"] == 0:
            continue
        aspect = blob["w"] / max(1, blob["h"])
        if aspect < min_aspect or aspect > max_aspect:
            continue
        
        # 7. Outside system bounds - extra strictness
        original_top = int(measure_box["y0"] * height)
        original_bottom = math.ceil(measure_box["y1"] * height)
        outside_system_bounds = cy < original_top or cy > original_bottom
        if outside_system_bounds and (wide_rows < max(5, js_round(ss * 0.55)) or aspect < 0.45 or aspect > 2.5):
            continue
        
        # --- Pitch resolution (port from Corranzo) ---
        y_norm = (cy - ss * pitch_anchor_offset_ratio) / height
        x_norm = cx / width
        
        pitch_mapping = _resolve_pitch_from_grand_staff(
            y_norm, measure_box.get("staffLines", {}), measure_box.get("staffClefs")
        )
        clef = pitch_mapping.get("clef", "treble")
        midi = pitch_mapping.get("midi")
        if midi is None:
            continue
        
        line_ys = pitch_mapping.get("lineYs", [])
        ledger = _estimate_ledger_line_count(y_norm, line_ys)
        
        # Staff step residual for quality ranking
        sorted_line_ys = sorted(line_ys)
        line_gap = 0
        if len(sorted_line_ys) >= 5:
            line_gap = (sorted_line_ys[-1] - sorted_line_ys[0]) / (len(sorted_line_ys) - 1)
        step_coordinate = 0
        if line_gap > 0:
            step_coordinate = (sorted_line_ys[-1] - y_norm) / (line_gap / 2)
        staff_step_residual = abs(step_coordinate - js_round(step_coordinate))
        
        position_in_measure = (cx - bounds["left"]) / max(1, measure_width)
        
        detected.append(NoteheadCandidate(
            midi=midi,
            clef=clef,
            cx=cx,
            cy=cy,
            x_norm=x_norm,
            y_norm=y_norm,
            ledger=ledger,
            pitch_mapping=pitch_mapping,
            position_in_measure=position_in_measure,
            measure_number=measure_box.get("measureNumber", 1),
            page=measure_box.get("page", 1),
            detection_evidence={
                "source": "raster-shape",
                "midFill": mid_fill,
                "wideRows": wide_rows,
                "staffStepResidual": staff_step_residual,
                "verticalRun": local_vertical_run,
                "pitchAnchorOffsetRatio": pitch_anchor_offset_ratio,
            },
            source_bbox={key: blob[key] for key in ("x0", "y0", "x1", "y1")},
        ))
    
    # --- Dense fallback ---
    if dense and not skip_dense_fallback:
        normal_detected = detect_noteheads_in_measure(image_data, measure_box, ink_threshold, {
            **options, "dense": False, "skipDenseFallback": True
        })
        for note in normal_detected:
            already_detected = any(
                abs(entry.cx - note.cx) <= MERGE_X and abs(entry.cy - note.cy) <= MERGE_Y
                for entry in detected
            )
            if not already_detected:
                detected.append(note)
    
    # --- Final deduplication by pitch ---
    return _dedupe_same_pitch_raster_candidates(detected, ss)


# ============================================================
# PITCH RESOLUTION (simplified port from Corranzo pitchFromStaffPosition.js)
# ============================================================

def _midi_from_staff_position(y_norm, line_ys, clef="treble"):
    """pitchFromStaffPosition.js:midiFromStaffPosition, including ledger range."""
    if not line_ys or max(line_ys) <= min(line_ys):
        return None
    gap = (max(line_ys) - min(line_ys)) / 4
    offset = js_round((max(line_ys) - y_norm) / gap * 2)
    if offset < -16 or offset > 24:
        return None
    diatonic = (2 * 7 + 4 if clef == "bass" else 4 * 7 + 2) + offset
    return (diatonic // 7 + 1) * 12 + (0, 2, 4, 5, 7, 9, 11)[diatonic % 7]


def _resolve_pitch_from_grand_staff(y_norm, staff_lines, staff_clefs=None):
    """JS resolveStaffRoleForY/resolvePitchFromGrandStaff (static clef state)."""
    staff_lines = staff_lines or {}
    treble, bass = staff_lines.get("treble", []), staff_lines.get("bass", [])
    if isinstance(staff_clefs, (list, tuple)):
        staff_clefs = dict(zip(("upper", "lower"), staff_clefs))
    source = staff_clefs if staff_clefs is not None else {"upper": "treble", "lower": "bass"}
    clefs = {role: "bass" if source.get(role) == "bass" else "treble" for role in ("upper", "lower")}
    dist = lambda lines: min((abs(y_norm - y) for y in lines), default=float("inf"))
    td, bd = dist(treble), dist(bass)
    role, ambiguous, spans = "upper", False, None
    if treble and bass:
        tg, bg = (max(treble)-min(treble))/4, (max(bass)-min(bass))/4
        split = staff_lines.get("splitY")
        sm = min(tg, bg) * 0.35
        tt, tb = min(treble)-tg*4, max(treble)+tg*4
        bt, bb = min(bass)-bg*4, max(bass)+bg*4
        if split is not None and math.isfinite(split):
            tb, bt = min(tb, split-sm), max(bt, split+sm)
        it, ib = tt <= y_norm <= tb, bt <= y_norm <= bb
        margin = min(tg, bg)*0.2
        if it and not ib: role = "upper"
        elif ib and not it: role = "lower"
        elif td+margin < bd: role = "upper"
        elif bd+margin < td: role = "lower"
        else:
            ambiguous = True
            role = ("upper" if y_norm <= split else "lower") if split is not None else ("upper" if td <= bd else "lower")
        spans = {"treble": {"top": tt, "bottom": tb, "gap": tg, "lines": sorted(treble)},
                 "bass": {"top": bt, "bottom": bb, "gap": bg, "lines": sorted(bass)}}
    other = "lower" if role == "upper" else "upper"
    clef = "bass" if role == "lower" else "treble"
    lines = bass if role == "lower" else treble
    sign = clefs[role]
    # refineGrandStaffPitchMapping: deep lower-staff fallback for weak clef state.
    if role == "lower" and sign == "treble" and lines:
        gap = (max(lines)-min(lines))/4
        if y_norm >= max(lines)+gap*0.1 and _midi_from_staff_position(y_norm, lines, "bass") is not None:
            sign = "bass"
    return {"yNorm": y_norm, "staffRole": role, "clef": clef, "clefSign": sign,
            "midi": _midi_from_staff_position(y_norm, lines, sign), "lineYs": lines,
            "alternateStaffRole": other, "alternateClef": "bass" if other == "lower" else "treble",
            "alternateClefSign": clefs[other],
            "alternateMidi": _midi_from_staff_position(y_norm, treble if role == "lower" else bass, clefs[other]),
            "clefOctaveChange": 0, "alternateClefOctaveChange": 0, "staffClefs": clefs,
            "trebleLineDistance": td, "bassLineDistance": bd, "ambiguous": ambiguous, "staffBounds": spans}


def _estimate_ledger_line_count(y_norm, line_ys):
    """Exact estimateLedgerLineCount: 0.35-space gate and ceil, per staff."""
    if not line_ys or max(line_ys) <= min(line_ys):
        return {"direction": None, "count": 0}
    top, bottom = min(line_ys), max(line_ys)
    gap = (bottom-top)/4
    if y_norm < top-gap*0.35:
        return {"direction": "above", "count": math.ceil((top-y_norm)/gap)}
    if y_norm > bottom+gap*0.35:
        return {"direction": "below", "count": math.ceil((y_norm-bottom)/gap)}
    return {"direction": None, "count": 0}


def _dedupe_same_pitch_raster_candidates(notes: List[NoteheadCandidate], 
                                          staff_space: float) -> List[NoteheadCandidate]:
    """Deduplicate same-pitch raster candidates."""
    x_tolerance = max(5, staff_space * 0.85)
    
    def note_quality(note: NoteheadCandidate):
        ev = note.detection_evidence
        def finite(key, fallback):
            value = ev.get(key, fallback)
            return value if value is not None and math.isfinite(value) else fallback
        return (
            finite("staffStepResidual", float('inf')),
            finite("verticalRun", float('inf')),
            -finite("midFill", 0),
            note.cx,
        )
    
    ranked = sorted(notes, key=note_quality)
    kept = []
    for note in ranked:
        duplicate = any(
            abs(entry.cx - note.cx) <= x_tolerance and
            entry.clef == note.clef and
            (entry.midi == note.midi or
             abs(entry.cy - note.cy) < max(2, staff_space * 0.46) or
             (abs(entry.cx - note.cx) <= max(2, staff_space * 0.24) and
              abs(entry.cy - note.cy) < max(2, staff_space * 0.5)))
            for entry in kept
        )
        if not duplicate:
            kept.append(note)
    
    kept.sort(key=lambda n: (n.cx, n.cy))
    return kept


# ============================================================
# REST DETECTION (complete port of Corranzo detectOmrRests.js)
# ============================================================

def detect_rests_in_measure(image_data: Dict[str, Any],
                            measure_box: Dict[str, Any],
                            ink_threshold: int,
                            notehead_points: List[Dict[str, Any]] = []) -> List[RestCandidate]:
    """
    Full port of Corranzo's detectRestsInMeasure.
    """
    bounds = content_pixel_bounds(image_data, {
        "x0": measure_box["x0"],
        "x1": measure_box["x1"],
        "y0": measure_box["y0"],
        "y1": measure_box["y1"],
    })
    width = image_data["width"]
    height = image_data["height"]
    measure_width = bounds["right"] - bounds["left"] + 1
    rests = []
    step = 4
    
    for cy in range(bounds["top"], bounds["bottom"] + 1, step):
        for cx in range(bounds["left"], bounds["right"] + 1, step):
            if is_likely_staff_line(image_data, cx, cy, ink_threshold, bounds):
                continue
            
            # Skip near noteheads
            near_note = any(
                abs(point["cx"] - cx) <= 8 and abs(point["cy"] - cy) <= 8
                for point in notehead_points
            )
            if near_note:
                continue
            
            dark = 0
            half = REST_WINDOW // 2
            for y in range(cy - half, cy + half + 1):
                for x in range(cx - half, cx + half + 1):
                    if 0 <= y < height and 0 <= x < width:
                        idx = (y * width + x) * 4
                        if is_ink(image_data["data"], idx, ink_threshold):
                            dark += 1
            
            if dark < MIN_REST_DARK or dark > MAX_REST_DARK:
                continue
            
            vertical_run = max_vertical_ink_run(image_data, cx, ink_threshold, bounds["top"], bounds["bottom"])
            if vertical_run > 10:
                continue
            
            # Merge nearby rests
            existing = None
            for item in rests:
                if abs(item.cx - cx) <= 8 and abs(item.cy - cy) <= 8:
                    existing = item
                    break
            if existing:
                existing.cx = js_round((existing.cx + cx) / 2)
                existing.cy = js_round((existing.cy + cy) / 2)
            else:
                rests.append(RestCandidate(
                    cx=cx, cy=cy,
                    x_norm=0, y_norm=0,
                    position_in_measure=0,
                    measure_number=measure_box.get("measureNumber", 1),
                    page=measure_box.get("page", 1),
                    confidence=0.62,
                ))
    
    # Convert to normalized coordinates
    result = []
    for rest in rests:
        rest.x_norm = rest.cx / width
        rest.y_norm = rest.cy / height
        rest.position_in_measure = (rest.cx - bounds["left"]) / max(1, measure_width)
        result.append(rest)
    
    return result


# ============================================================
# HYBRID DETECTOR INTERFACE
# ============================================================

@dataclass
class HybridProposals:
    """Results from hybrid visual detector + V2.5 semantic enrichment."""
    noteheads: List[NoteheadCandidate]
    rests: List[RestCandidate]
    
    # Tracking for audit
    detector_notehead_count: int = 0
    detector_rest_count: int = 0
    v25_input_notehead_count: int = 0
    v25_input_rest_count: int = 0
    v25_output_notehead_count: int = 0
    v25_output_rest_count: int = 0
    final_musicxml_note_count: int = 0
    final_musicxml_rest_count: int = 0


class HybridDetector:
    """
    Hybrid architecture: Visual detector owns object existence/type,
    V2.5 provides semantic enrichment only.
    """
    
    def __init__(self, config, runtime):
        self.config = config
        self.runtime = runtime
    
    def process_measure(self, image_data: Dict[str, Any], 
                        measure_box: Dict[str, Any],
                        ink_threshold: int) -> HybridProposals:
        """Process a single measure through hybrid pipeline."""
        
        from .omr_raster_filters import detect_filtered_noteheads
        noteheads = detect_filtered_noteheads(image_data, measure_box, ink_threshold)

        # Detect rests
        notehead_points = [{"cx": nh.cx, "cy": nh.cy} for nh in noteheads]
        rests = detect_rests_in_measure(image_data, measure_box, ink_threshold, notehead_points)
        
        # --- TRACKING ---
        proposals = HybridProposals(
            noteheads=noteheads,
            rests=rests,
            detector_notehead_count=len(noteheads),
            detector_rest_count=len(rests),
        )
        
        return proposals
    
    def enrich_with_v25(self, proposals: HybridProposals, 
                        image_data: Dict[str, Any],
                        measure_box: Dict[str, Any],
                        crop_meta: Dict[str, Any],
                        page_analysis: Any) -> HybridProposals:
        """
        Feed real proposals to V2.5 for semantic enrichment ONLY.
        V2.5 must not change object existence or visual type.
        """
        # Build V2.5 batch with real proposals (types already authoritative)
        # ... (existing canonical batch builder logic)
        pass
    
    def apply_v25_output(self, proposals: HybridProposals,
                         v25_output: Dict[str, Any],
                         batch: Dict[str, Any],
                         crop_meta: Dict[str, Any],
                         page_analysis: Any) -> HybridProposals:
        """
        Apply V2.5 semantic heads to proposals WITHOUT changing object type.
        """
        # For each proposal, get V2.5 semantic predictions
        # But object_type remains from visual detector
        # ... (existing conversion logic, but respect detector's type)
        pass


def build_v25_batch_with_real_proposals(
    crops: List[Dict],
    metadata: List[Dict],
    page_analyses: List,
    config,
    all_proposals: List[HybridProposals],
) -> Dict:
    """
    Build V2.5 batch using REAL proposals from hybrid detector.
    Object types come from visual detector, not V2.5.
    """
    # This replaces the synthetic grid with real proposals
    # ... (integrate with existing canonical builder)
    pass


# Export main functions
__all__ = [
    "NoteheadCandidate",
    "RestCandidate", 
    "HybridProposals",
    "HybridDetector",
    "detect_noteheads_in_measure",
    "detect_rests_in_measure",
    "build_v25_batch_with_real_proposals",
    "is_ink",
    "content_pixel_bounds",
    "is_likely_staff_line",
    "is_likely_barline",
    "max_vertical_ink_run",
    "is_likely_beam_ink",
    "dark_count_in_window",
    "horizontal_run_covering",
    "fill_ratio",
    "compact_wide_row_count",
    "ink_bounding_box",
    "staff_space_px",
    "clamp_int",
]