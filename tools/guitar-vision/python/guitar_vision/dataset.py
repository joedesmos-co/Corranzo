"""Guitar Vision — dataset for proposal-conditioned recognition.

Reads the data-engine records (targets) and the three rendered views (images)
and turns them into tensors.

## Two things this deliberately does not do

**It does not invent string or fret labels from the target itself at training
time.** The fret digit is read from the *rendered* SVG, and the string is
recovered from which TAB line the digit sits on. If the label were derived from
the same box the model is scored against, the model would be scored on its own
input and every number would be meaningless. The label path is the engraved
glyph; the geometry path is the box; they are independent by construction.

**It does not train on anything but the training split.** The synthetic corpus is
generated train-only (see ``generate-synthetic.mjs``, which refuses any other
split), and this loader additionally refuses any record whose manifest entry is
not labelled ``train``.

Shapes per sample:
    images       (V, 1, H, W)  one grayscale plane per view
    boxes        (N, 4)        normalised [x0, y0, x1, y1]
    object_type  (N,)          index into OBJECT_TYPES
    string       (N,)          0 = none, 1..6 = string, 7 = not on a TAB staff
    fret         (N,)          0..24 valid, 25 = not a fret
    view         (N,)          which view the object belongs to
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

import numpy as np
import torch
from PIL import Image, ImageOps

OBJECT_TYPES = ("notehead", "fret-digit", "accidental", "augmentation-dot", "marking", "rest")
OBJECT_TYPE_INDEX = {name: index for index, name in enumerate(OBJECT_TYPES)}

VIEW_NAMES = ("full-page", "notation", "tab")
VIEW_INDEX = {name: index for index, name in enumerate(VIEW_NAMES)}

# Minimum planes per view. The actual count is derived from the view's own aspect
# ratio, because a plane can be filled contiguously *and* without distortion only
# when it shows a square of the content — so the number of planes needed is the
# content's aspect, rounded up.
#
# Getting this wrong is what cost three loader revisions:
#
#  - 3 planes for a 12:1 strip stretched each one into a square, squashing every
#    digit to 30% of its width. "3" and "8" differ mostly in how much of their
#    width is closed, so that is not a cosmetic distortion.
#  - stretching replaced by scale-to-fit, at a fixed count, made each plane show
#    only the part of its slot that fitted, so consecutive planes had *gaps*
#    between them and any object in a gap belonged to no plane at all: 27% of
#    objects survived, and the ones that did were fine. This is the failure that
#    looks least like a bug.
#
# Deriving the count from the aspect fixes both, and the counts differ per page, so
# ``collate`` pads the plane axis to the batch maximum with blank planes. No
# object ever references a padded plane, so the padding is inert.
MIN_PLANES_PER_VIEW = {"full-page": 1, "notation": 1, "tab": 1}

# How much consecutive planes overlap, as a fraction of a plane's width.
#
# Sized to the widest object a plane can hold. A two-digit fret is about 23% of a
# TAB plane's width, and an object straddling a boundary has to be *whole* in one
# of the two planes: ``plane_box`` drops a box that crosses an edge rather than
# clipping it, because a clipped box is narrower than the glyph it names. So the
# overlap has to exceed the widest object, and 0.3 is that with margin.
PLANE_OVERLAP = 0.30

NO_STRING = 0
NO_FRET = 25
MAX_FRET = 24


def view_rect(record: dict[str, Any], is_tab: bool) -> tuple[float, float, float, float]:
    """The page-relative rectangle a view's image actually covers.

    A view is a *crop* of the page, not the page. The rasteriser crops to the
    union of that kind's bands - padded by ``VIEW_PADDING_UNITS``, and recorded
    per band as ``cropUnits`` - so the PNG's (0,0) is the crop's top-left and not
    the page's. The record's object boxes are page-normalised, so a box has to be
    brought into the crop's frame before it can index it.

    It is the **crop** rectangle and not the band rectangle that matters, and the
    distinction is exact rather than approximate. Composing the trim inset onto the
    band and then scaling by the crop's pixel width is off by whatever fraction of
    the padding sits between them; composing it onto the crop makes the inset
    algebra cancel, so the resulting fraction is exactly the box's fraction of the
    trimmed content and the tiling needs no correction. Measured over 76 fixtures
    that difference is worth up to 86 crop pixels - a fifth of a digit's width.

    Getting the frame wrong is silent and total. Measured on a paired score, the
    first version of this loader indexed a TAB crop with page coordinates: a digit
    genuinely at page y 0.73-0.78 landed at crop y 0.21-0.38, so the sampler was
    pointed at the measure above the digits. An ink test over 710 objects found
    ink on only 14.5%, and no head could have learned anything from that.
    """
    bands = [band for band in record["bands"] if bool(band.get("isTab")) == is_tab]
    width = float(record["contentWidthUnits"])
    height = float(record["contentHeightUnits"])
    if not bands or width <= 0 or height <= 0:
        return (0.0, 0.0, 1.0, 1.0)
    # `cropUnits` is the canonical contract. A record without it predates the
    # coordinate fix and falls back to the band, which is the old behaviour.
    boxes = [band.get("cropUnits") or band["boxUnits"] for band in bands]
    left = min(box[0] for box in boxes) / width
    top = min(box[1] for box in boxes) / height
    right = max(box[2] for box in boxes) / width
    bottom = max(box[3] for box in boxes) / height
    return (left, top, right, bottom)


def page_box_to_view(
    box: list[float], frame: tuple[float, float, float, float]
) -> list[float] | None:
    """Take a page-normalised box into a view's own normalised frame."""
    x0, y0, x1, y1 = frame
    span_x = x1 - x0
    span_y = y1 - y0
    if span_x <= 0 or span_y <= 0:
        return None
    return [
        (box[0] - x0) / span_x,
        (box[1] - y0) / span_y,
        (box[2] - x0) / span_x,
        (box[3] - y0) / span_y,
    ]


def plane_box(box: list[float], rect: tuple[float, float, float, float]) -> list[float] | None:
    """Map a view-space box into the plane coordinates of one tile.

    ``rect`` is the tile's span within the view. The box is shifted and scaled
    into that span, so a box lands on the same pixels whether the view is one tile
    wide or four.

    Returns ``None`` when the box falls entirely outside the tile. A box is not
    clipped: a partly visible object clipped to the tile edge would be reported
    with a width that no longer matches its glyph, and a detector trained on that
    learns to expect truncated digits.
    """
    x0, y0, x1, y1 = rect
    span_x = x1 - x0
    span_y = y1 - y0
    if span_x <= 0 or span_y <= 0:
        return None
    left, top, right, bottom = box
    # Fully contained, or dropped. A box straddling the tile edge would map to
    # coordinates outside [0, 1], and the sampler would read off the edge of the
    # plane. Tiles do not overlap, so a straddling object has to be dropped rather
    # than clipped: a clipped box is a narrower box than the glyph it names.
    if left < x0 or right > x1 or top < y0 or bottom > y1:
        return None
    return [
        (left - x0) / span_x,
        (top - y0) / span_y,
        (right - x0) / span_x,
        (bottom - y0) / span_y,
    ]


@dataclass(frozen=True)
class Paths:
    records: Path
    views: Path


def _read_record(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def _load_view(
    views_dir: Path,
    view: str,
    score_id: str,
    size: tuple[int, int],
    tiles: int,
    trace: dict[str, Any] | None = None,
    trim_override: tuple[int, int, int, int] | None = None,
) -> tuple[list[tuple[np.ndarray, tuple[float, float, float, float]]], tuple[float, float, float, float]] | None:
    """Cut a view into a fixed number of side-by-side tiles, each at full height.

    ## Why a wide view cannot be one plane

    A TAB view is a single wide strip, about 12:1. Fitted into a square plane it
    becomes 256x20, so the six staff lines collapse into 20 rows and a fret digit
    into less than one pixel. The model is then asked to read a glyph that is not
    there, and the answer is not "hard" - it is arbitrary. No amount of training
    recovers information discarded at load time.

    Scaling to cover instead would preserve resolution but crop most of the page
    away, so a digit in the last system would simply be missing. Tiling keeps
    both: every tile gets the full height, so a digit is as tall as it needs to
    be, and the tiles together cover the page.

    ## Why a fixed count

    The count is fixed rather than derived from the aspect ratio so that a batch
    of pages stacks. A page that happened to be slightly wider would otherwise
    produce one more tile than its neighbour and the batch would not collate. A
    narrow view still gets `tiles` planes, padded with white on the right, which
    keeps the geometry honest: the content occupies a sub-rect and the boxes say
    so.

    Each tile returns the span it occupies in the *view's own content*
    coordinates. Boxes are mapped through that span into plane coordinates.
    Skipping the mapping is how the first version sampled 55 pixels below the
    digit it was told to read.
    """
    candidate = views_dir / view / f"{score_id}.png"
    if not candidate.exists():
        return None
    width, height = size
    with Image.open(candidate) as image:
        grey = image.convert("L")
        source_width, source_height = grey.size

        # Trim white margins before anything else. The rasteriser crops to the
        # union of a kind's bands, and a band is a rectangle of engraved space
        # that includes the indent before the first system, so a TAB crop can
        # carry a quarter of its width as blank paper. Paying for that in tiles
        # costs resolution where the glyphs are: a 4-tile split of a strip where
        # one tile is empty gives every digit a quarter of the pixels it needs.
        # Trimming first is free, and it recovers that.
        original_width, original_height = grey.size
        inverted = ImageOps.invert(grey)
        detected = inverted.getbbox() or (0, 0, original_width, original_height)
        # ``trim_override`` is diagnostic-only and never consulted unless a caller
        # passes it. It exists because the trim is derived from the raster content,
        # so a page rendered with one glyph suppressed can trim differently from the
        # same page with the glyph present - and a differing trim changes
        # ``scaled_width``, the span, the overlap and therefore the tile rects.
        # Differencing two such pages measures a layout change, not the glyph.
        # Pinning the trim to the A page's own value isolates the glyph again.
        # The default path below is byte-identical to having no override at all.
        trim = detected if trim_override is None else trim_override
        if trace is not None:
            trace["detected_trim"] = detected
            trace["trim_applied"] = trim
            trace["trim_pinned"] = trim_override is not None
            trace["source_size"] = (original_width, original_height)
            trace["source_grey"] = np.asarray(grey, dtype=np.uint8)
        if trim != (0, 0, original_width, original_height):
            grey = grey.crop(trim)
        source_width, source_height = grey.size
        if trace is not None:
            trace["trimmed_size"] = (source_width, source_height)
            trace["trimmed_grey"] = np.asarray(grey, dtype=np.uint8)

        # Height fills the plane. For a strip view the scaled content is wider
        # than one tile, which is what the tiling below divides up.
        scale = height / source_height
        scaled_width = max(1, int(round(source_width * scale)))
        scaled_height = max(1, int(round(source_height * scale)))
        array = np.asarray(
            grey.resize((scaled_width, scaled_height), Image.LANCZOS), dtype=np.float32
        ) / 255.0
        if trace is not None:
            trace["scale"] = scale
            trace["scaled_size"] = (scaled_width, scaled_height)
            trace["resized_array"] = array

    # The trim changed the view's content frame, so it has to be reported back and
    # composed with the band's rect. `inset` is the fraction of the original crop
    # that was removed, and it is what keeps the boxes aligned after trimming.
    # A plane shows a **square** of the content, so the resize is uniform on both
    # axes and no glyph is squashed. The advance is that square, so the planes
    # cover the strip with no gaps, and each one is widened by ``PLANE_OVERLAP``
    # so an object straddling a boundary is whole in at least one of them.
    #
    # The overlap is not optional and not cosmetic. ``plane_box`` refuses to clip a
    # box that crosses a plane edge, because a clipped box is narrower than the
    # glyph it names and a detector trained on that learns to expect truncated
    # digits. So without overlap a boundary object is dropped instead, and a
    # two-digit fret is about 23% of a plane's width, so the overlap has to be
    # at least that. Measured cost of getting it wrong: a quarter of the fret
    # digits vanished from the corpus.
    span = scaled_height
    overlap = max(1, int(round(span * PLANE_OVERLAP)))
    output: list[tuple[np.ndarray, tuple[float, float, float, float]]] = []
    start = 0
    while start < scaled_width:
        end = min(scaled_width, start + span + overlap)
        strip = array[:, start:end]
        strip_width = max(1, end - start)
        plane = np.ones((height, width), dtype=np.float32)
        if strip.shape[0] != height or strip_width != width:
            strip = np.asarray(
                Image.fromarray(
                    (np.clip(strip, 0, 1) * 255).astype(np.uint8)
                ).resize((width, height), Image.LANCZOS),
                dtype=np.float32,
            ) / 255.0
        plane[:, : min(width, strip_width)] = strip[:, : min(width, strip_width)]
        output.append((plane, (start / scaled_width, 0.0, end / scaled_width, 1.0)))
        if trace is not None:
            # The strip is the slice *before* the strip->square resize, kept
            # separately from the plane so a stage-by-stage diff can tell a lost
            # slice from a lost resample.
            trace["tiles"].append(
                {
                    "index": len(trace["tiles"]),
                    "start": start,
                    "end": end,
                    "span": span,
                    "overlap": overlap,
                    "rect": (start / scaled_width, 0.0, end / scaled_width, 1.0),
                    "strip": array[:, start:end].copy(),
                    "plane": plane.copy(),
                }
            )
        # Advance by the span, not by the tile's width. Advancing by `end - start`
        # makes consecutive tiles *contiguous* - tile k ends exactly where tile k+1
        # begins - so the overlap is never realised and `plane_box` refuses every
        # box that crosses the seam. That is the whole reason `overlap` exists, and
        # the comment above says so: a boundary object has to be whole in at least
        # one plane. Advancing by the span makes consecutive planes share `overlap`
        # array columns, which is what the constant was sized for. Measured cost of
        # the contiguous version: 26% of fret digits were assigned to no tile at all.
        start += span
    if len(output) < tiles:
        # Honour the requested minimum with blank planes. A batch pads to its own
        # maximum anyway, so these only matter for a page that is narrower than the
        # minimum; they carry no object and are inert.
        for _ in range(tiles - len(output)):
            output.append(
                (np.ones((height, width), dtype=np.float32), (0.0, 0.0, 0.0, 0.0))
            )
    # The trim, expressed in the *original crop's* fractions. build_sample
    # composes this with the band rect so the boxes survive the trim.
    inset = (
        trim[0] / original_width,
        trim[1] / original_height,
        (original_width - trim[2]) / original_width,
        (original_height - trim[3]) / original_height,
    )
    if trace is not None:
        trace["inset"] = inset
        trace["plane_count"] = len(output)
    return output, inset


def string_for_object(record: dict[str, Any], obj: dict[str, Any]) -> int:
    """Which TAB string line a fret digit sits on, 1-based from the top.

    A fret digit's identity as a *TAB* object is entirely which of six lines it
    is on, so this is the label that matters, and it comes from geometry rather
    than from anything the engraver wrote. A digit that is not near a line is
    reported as unknown rather than snapped to the nearest one: a confident wrong
    string is worse than an abstention.
    """
    if obj.get("objectType") != "fret-digit":
        return NO_STRING
    tab_bands = [band for band in record["bands"] if band.get("isTab")]
    if not tab_bands:
        return NO_STRING
    band = tab_bands[0]
    top, bottom = band["boxUnits"][1], band["boxUnits"][3]
    centre = (obj["boxUnits"][1] + obj["boxUnits"][3]) / 2.0
    if bottom <= top:
        return NO_STRING
    # Six lines evenly spanning the band: line 1 is the topmost.
    relative = (centre - top) / (bottom - top)
    index = int(round(relative * 5.0))
    if index < 0 or index > 5:
        return NO_STRING
    distance = abs(relative - index / 5.0)
    if distance > 0.12:
        return 7  # off-line: present but not assignable
    return index + 1


def fret_for_object(obj: dict[str, Any]) -> int:
    text = obj.get("fret")
    if obj.get("objectType") != "fret-digit" or not text:
        return NO_FRET
    try:
        value = int(str(text).strip())
    except ValueError:
        return NO_FRET
    return value if 0 <= value <= MAX_FRET else NO_FRET


def view_for_object(record: dict[str, Any], obj: dict[str, Any]) -> int:
    """Which view an object belongs to.

    TAB objects live in the TAB view and everything else in the notation view. The
    full-page view is context, not a detection surface, and keeping it out of the
    object set stops the model being scored twice for the same note.
    """
    return VIEW_INDEX["tab"] if obj.get("onTab") else VIEW_INDEX["notation"]


def build_sample(
    record: dict[str, Any],
    views_dir: Path,
    size: tuple[int, int],
    traces: dict[str, dict[str, Any]] | None = None,
    trim_overrides: dict[str, tuple[int, int, int, int]] | None = None,
) -> dict[str, torch.Tensor] | None:
    """Assemble one page: every plane of every view, plus its objects.

    An object is assigned to the single plane that contains it. Planes within a
    view do not overlap, so the assignment is unambiguous.

    The plane count is per page, derived from each view's aspect ratio, so pages
    do not all have the same shape. ``collate`` pads the plane axis to the batch
    maximum with blank planes; no object references one, so the padding is inert.

    ``traces`` and ``trim_overrides`` are diagnostic-only pass-throughs, both
    defaulting to ``None``. Omitted, this function is byte-identical to the
    two-argument form: they decide only whether production's own intermediates get
    recorded, and whether a caller-supplied trim replaces the content-derived one.
    Neither can change a pixel or a coordinate.
    """
    planes: list[np.ndarray] = []
    rects: list[list[tuple[float, float, float, float]]] = []
    insets: dict[str, tuple[float, float, float, float]] = {}
    for name in VIEW_NAMES:
        if traces is not None:
            traces.setdefault(name, {})["tiles"] = []
        loaded = _load_view(
            views_dir,
            name,
            record["scoreId"],
            size,
            MIN_PLANES_PER_VIEW[name],
            trace=traces.get(name) if traces is not None else None,
            trim_override=(
                trim_overrides.get(name) if trim_overrides is not None else None
            ),
        )
        if loaded is None:
            return None
        tiles, inset = loaded
        for plane, rect in tiles:
            planes.append(plane)
        rects.append([rect for _, rect in tiles])
        insets[name] = inset
    image_stack = torch.from_numpy(np.stack(planes)[:, None, :, :])

    objects = record.get("objects", [])
    if not objects:
        return None

    # Each view is a crop of the page, and the record's boxes are page-normalised,
    # so the frames have to be reconciled before anything can be indexed.
    # The view's own frame is the *crop* rectangle the rasteriser cut, then
    # narrowed by however much white margin the loader trimmed off it. Both are
    # needed: the crop says which part of the page the image shows, the inset says
    # which part of the image survived the trim. Composing them in this order makes
    # the two cancel exactly - see ``view_rect``.
    frames = {}
    for name, is_tab in (("full-page", None), ("notation", False), ("tab", True)):
        base = (0.0, 0.0, 1.0, 1.0) if is_tab is None else view_rect(record, is_tab)
        i = insets[name]
        bx0, by0, bx1, by1 = base
        frames[name] = (
            bx0 + i[0] * (bx1 - bx0),
            by0 + i[1] * (by1 - by0),
            bx0 + (1 - i[2]) * (bx1 - bx0),
            by0 + (1 - i[3]) * (by1 - by0),
        )

    boxes, types, strings, frets, views = [], [], [], [], []
    for obj in objects:
        if obj["objectType"] not in OBJECT_TYPE_INDEX:
            continue
        view_index = view_for_object(record, obj)
        in_view = page_box_to_view(
            obj["box"], frames[VIEW_NAMES[view_index]]
        )
        if in_view is None:
            continue
        placed = False
        for tile_index, rect in enumerate(rects[view_index]):
            mapped = plane_box(in_view, rect)
            if mapped is None:
                continue
            boxes.append(mapped)
            types.append(OBJECT_TYPE_INDEX[obj["objectType"]])
            strings.append(string_for_object(record, obj))
            frets.append(fret_for_object(obj))
            # The global tile index, which is what the samplers index by.
            views.append(sum(len(tiles) for tiles in rects[:view_index]) + tile_index)
            placed = True
            break
        if not placed:
            # A glyph the tiling dropped. Counted rather than silently discarded;
            # a high drop rate means the tile count is too low for the corpus.
            continue

    if not boxes:
        return None

    return {
        "score_id": record["scoreId"],
        "images": image_stack,
        "boxes": torch.tensor(boxes, dtype=torch.float32),
        "object_type": torch.tensor(types, dtype=torch.long),
        "string": torch.tensor(strings, dtype=torch.long),
        "fret": torch.tensor(frets, dtype=torch.long),
        "view": torch.tensor(views, dtype=torch.long),
    }


def collate(samples: Sequence[dict[str, torch.Tensor]], max_objects: int) -> dict[str, torch.Tensor]:
    """Pad a batch to a fixed object count.

    Objects beyond ``max_objects`` are dropped and reported through the mask, so
    a dense page truncates visibly rather than silently shifting every later
    object's index.
    """
    batch_size = len(samples)
    counts = [min(int(sample["object_type"].shape[0]), max_objects) for sample in samples]

    # Pages have different plane counts, because the count follows each view's
    # aspect ratio. Padded with blank planes up to the batch maximum, so a batch
    # stacks. No object references a padded plane - an object is only ever
    # assigned to a plane that contains it - so the padding cannot be sampled and
    # cannot leak anything.
    tile_count = max(int(sample["images"].shape[0]) for sample in samples)
    if any(int(sample["images"].shape[0]) != tile_count for sample in samples):
        padded = []
        for sample in samples:
            planes = sample["images"]
            missing = tile_count - int(planes.shape[0])
            if missing > 0:
                planes = torch.cat(
                    [planes, planes.new_ones((missing, 1, *planes.shape[2:]))], dim=0
                )
            padded.append(planes)
        images = torch.stack(padded)
    else:
        images = torch.stack([sample["images"] for sample in samples])

    boxes = torch.zeros(batch_size, max_objects, 4)
    # Padded slots carry the "no object" class, one past the real vocabulary.
    # Scoring them as a real class would ask the model to classify nothing.
    object_type = torch.full((batch_size, max_objects), len(OBJECT_TYPES), dtype=torch.long)
    string = torch.full((batch_size, max_objects), NO_STRING, dtype=torch.long)
    fret = torch.full((batch_size, max_objects), NO_FRET, dtype=torch.long)
    view = torch.zeros(batch_size, max_objects, dtype=torch.long)
    mask = torch.zeros(batch_size, max_objects, dtype=torch.bool)

    for index, (sample, count) in enumerate(zip(samples, counts)):
        boxes[index, :count] = sample["boxes"][:count]
        object_type[index, :count] = sample["object_type"][:count]
        string[index, :count] = sample["string"][:count]
        fret[index, :count] = sample["fret"][:count]
        view[index, :count] = sample["view"][:count]
        mask[index, :count] = True

    return {
        "images": images,
        "tiles": tile_count,
        "boxes": boxes,
        "object_type": object_type,
        "string": string,
        "fret": fret,
        "view": view,
        "object_mask": mask,
        "object_counts": torch.tensor(counts, dtype=torch.long),
    }


def load_dataset(
    records_dir: Path,
    views_dir: Path,
    *,
    size: tuple[int, int] = (512, 512),
    limit: int = 0,
    traces: dict[str, dict[str, Any]] | None = None,
    trim_overrides: dict[str, dict[str, tuple[int, int, int, int]]] | None = None,
) -> list[dict[str, torch.Tensor]]:
    """Load every record in ``records_dir`` through the production path.

    ``traces`` (keyed by scoreId, then view name) and ``trim_overrides`` are
    diagnostic-only and default to ``None``, which leaves this function
    byte-identical to the four-keyword form. They exist so the paired-differencing
    harness can observe production's real intermediates and, for a labelled
    diagnostic only, pin a content-derived trim; neither adds a transform, a
    scale or an offset to the load itself.
    """
    records = sorted(records_dir.glob("*.record.json"))
    if limit:
        records = records[:limit]
    samples = []
    for path in records:
        record = _read_record(path)
        # setdefault, not get: the per-page trace has to be stored back under its
        # scoreId or the caller receives an empty dict and concludes the loader
        # captured nothing.
        page_traces = (
            traces.setdefault(record["scoreId"], {}) if traces is not None else None
        )
        sample = build_sample(
            record,
            views_dir,
            size,
            traces=page_traces,
            trim_overrides=(
                trim_overrides.get(record["scoreId"]) if trim_overrides is not None else None
            ),
        )
        if sample is not None:
            samples.append(sample)
    return samples
