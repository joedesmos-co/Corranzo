"""Lazy sharded loader for the Phase 2.12Y semantic factory contract."""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import os
import random
import re
import sqlite3
import tempfile
from collections import OrderedDict, defaultdict
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageEnhance
from torch.utils.data import IterableDataset, get_worker_info


SPLITS = ("train", "validation", "test", "future-test")
TRAINER_SPLITS = ("train", "validation")
PRIMARY_FAMILIES = (
    "PITCH_STAFF", "DURATION", "ATTACK", "CHORD", "LANE",
    "LANE_CONTINUATION", "REST", "TUPLET", "TIE_SUSTAIN",
    "CROSS_STAFF", "SHARED_HEAD",
)
OBJECT_HEADS = (
    "pitch_staff_step", "pitch_written_step", "pitch_octave",
    "pitch_accidental", "pitch_staff", "pitch_clef", "pitch_key_fifths",
    "duration_type", "duration_dots", "duration_tuplet_ratio", "duration_grace",
    "lane", "rest", "tuplet", "cross_staff", "shared_head",
    "stem", "beam", "articulation", "dynamic", "pedal", "ottava",
    "ornament", "tremolo", "arpeggio", "accidental_glyph",
)
RELATION_HEADS = (
    "attack", "chord", "lane_continuation", "tie",
    "cross_staff_relation", "shared_head_ownership",
)
SCOPE_HEADS = ("time_signature", "measure_irregular", "repeat_ending", "tempo_class")

WRITTEN_STEPS = {value: index for index, value in enumerate("CDEFGAB")}
CLEFS = {"G": 0, "F": 1, "C": 2, "percussion": 3, "TAB": 4, "none": 5, "other": 6}
DURATION_TYPES = {
    value: index for index, value in enumerate((
        "unknown", "maxima", "long", "breve", "whole", "half", "quarter",
        "eighth", "16th", "32nd", "64th", "128th", "256th",
    ))
}
TUPLET_RATIOS = {
    None: 0,
    (3, 2): 1,
    (2, 3): 2,
    (5, 4): 3,
    (6, 4): 4,
    (7, 4): 5,
    (9, 8): 6,
    (4, 3): 7,
    "other": 8,
}
SCOPE_NUMBER = re.compile(r":semantic-m(\d+)(?:$|[^0-9])")


class SplitLeakageError(RuntimeError):
    pass


class MissingPixelError(RuntimeError):
    pass


class _DiskDuplicateTracker:
    """Disk-backed example-ID uniqueness check with bounded process RAM."""

    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        handle = tempfile.NamedTemporaryFile(prefix="piano-vision-index-", suffix=".sqlite3", dir=directory, delete=False)
        self.path = Path(handle.name)
        handle.close()
        self.connection = sqlite3.connect(self.path)
        self.connection.execute("PRAGMA journal_mode=OFF")
        self.connection.execute("PRAGMA synchronous=OFF")
        self.connection.execute("CREATE TABLE ids(example_id TEXT PRIMARY KEY) WITHOUT ROWID")

    def add(self, example_id):
        try:
            self.connection.execute("INSERT INTO ids(example_id) VALUES(?)", (example_id,))
            return True
        except sqlite3.IntegrityError:
            return False

    def checkpoint(self):
        self.connection.commit()

    def close(self):
        if getattr(self, "connection", None) is not None:
            self.connection.close()
            self.connection = None
        if getattr(self, "path", None) is not None:
            self.path.unlink(missing_ok=True)

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass


def _atomic_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".partial")
    partial.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(partial, path)


def _sha256(path: Path, block_size=1024 * 1024):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(block_size):
            digest.update(chunk)
    return digest.hexdigest()


def _manifest_digest(value):
    payload = {key: item for key, item in value.items() if key != "manifest_digest"}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _dataset_digest(shards, scores):
    """Digest only immutable dataset identity, independent of report metadata."""
    payload = {
        "shards": [
            {
                "path": row["path"],
                "records": row["records"],
                "bytes": row["bytes"],
                "sha256": row["sha256"],
            }
            for row in shards
        ],
        "scores": [
            {
                "score_id": row["score_id"],
                "semantic_source_id": row["semantic_source_id"],
                "split": row["split"],
                "examples": row["examples"],
            }
            for row in scores
        ],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def iter_jsonl(path: Path):
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            if line.strip():
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as error:
                    raise ValueError(f"Invalid JSON in {path}:{line_number}: {error}") from error


def discover_shards(dataset_dir: Path):
    return sorted((Path(dataset_dir) / "semantic-shards").glob("semantic-*.jsonl*"))


def validate_record_contract(record, path=None):
    required = {"schemaVersion", "exampleId", "scoreId", "semanticSourceId", "split", "input", "queries", "target", "decoderContract", "provenance"}
    missing = required - set(record)
    if missing:
        raise ValueError(f"Semantic record missing {sorted(missing)} in {path or '<memory>'}")
    if record["schemaVersion"] != 1 or record["split"] not in SPLITS:
        raise ValueError(f"Unsupported semantic record in {path or '<memory>'}")
    if record["provenance"].get("runtimeTruthInputs") != []:
        raise ValueError(f"Runtime truth input firewall violation in {record['exampleId']}")
    if len(record["input"].get("sourceTensor", [])) != 16:
        raise ValueError(f"Invalid sourceTensor in {record['exampleId']}")
    families = record["target"].get("families", {})
    availability = record["target"].get("availability", {})
    for family in PRIMARY_FAMILIES:
        if family not in families or family not in availability:
            raise ValueError(f"Missing family contract {family} in {record['exampleId']}")


def build_dataset_index(dataset_dir: Path, output_path: Path, verify_hashes=False):
    """Create a small score/shard index without retaining examples in RAM."""
    dataset_dir = Path(dataset_dir).resolve()
    output_path = Path(output_path).resolve()
    shards = discover_shards(dataset_dir)
    if not shards:
        raise FileNotFoundError(f"No semantic shards found under {dataset_dir}")
    score_rows = {}
    source_splits = defaultdict(set)
    score_splits = defaultdict(set)
    shard_rows = []
    duplicate_examples = []
    duplicate_tracker = _DiskDuplicateTracker(output_path.parent)
    family_states = {family: {"known": 0, "ambiguous": 0, "unavailable": 0} for family in PRIMARY_FAMILIES}
    family_availability = {
        family: {
            "examples": 0,
            "available_examples": 0,
            "unavailable_examples": 0,
            "labels": 0,
            "known": 0,
            "ambiguous": 0,
            "unavailable": 0,
            "positive_known": 0,
            "negative_known": 0,
            "by_split": {
                split: {"examples": 0, "available_examples": 0, "labels": 0, "positive_known": 0}
                for split in SPLITS
            },
        }
        for family in PRIMARY_FAMILIES
    }
    for shard in shards:
        records = 0
        splits = set()
        scores_in_shard = set()
        for record in iter_jsonl(shard):
            validate_record_contract(record, shard)
            records += 1
            split = record["split"]
            score = record["scoreId"]
            source = record["semanticSourceId"]
            splits.add(split)
            scores_in_shard.add(score)
            score_splits[score].add(split)
            source_splits[source].add(split)
            if not duplicate_tracker.add(record["exampleId"]) and len(duplicate_examples) < 20:
                duplicate_examples.append(record["exampleId"])
            row = score_rows.setdefault(score, {
                "score_id": score,
                "semantic_source_id": source,
                "split": split,
                "shards": [],
                "examples": 0,
            })
            if row["semantic_source_id"] != source or row["split"] != split:
                raise SplitLeakageError(f"Inconsistent identity for score {score}")
            row["examples"] += 1
            availability = record["target"].get("availability", {})
            for family in PRIMARY_FAMILIES:
                labels = record["target"]["families"].get(family, [])
                summary = family_availability[family]
                split_summary = summary["by_split"][split]
                available = bool(availability.get(family))
                summary["examples"] += 1
                summary["available_examples" if available else "unavailable_examples"] += 1
                split_summary["examples"] += 1
                split_summary["available_examples"] += int(available)
                summary["labels"] += len(labels)
                split_summary["labels"] += len(labels)
                for label in labels:
                    state = str(label.get("state", "")).lower()
                    if state in family_states[family]:
                        family_states[family][state] += 1
                        summary[state] += 1
                    if state == "known":
                        if bool(label.get("isPositive")):
                            summary["positive_known"] += 1
                            split_summary["positive_known"] += 1
                        else:
                            summary["negative_known"] += 1
        relative = str(shard.relative_to(dataset_dir))
        for score in scores_in_shard:
            score_rows[score]["shards"].append(relative)
        shard_rows.append({
            "path": relative,
            "records": records,
            "splits": sorted(splits),
            "bytes": shard.stat().st_size,
            "sha256": _sha256(shard) if verify_hashes else None,
        })
        duplicate_tracker.checkpoint()
    duplicate_tracker.close()
    score_overlap = {key: sorted(value) for key, value in score_splits.items() if len(value) != 1}
    source_overlap = {key: sorted(value) for key, value in source_splits.items() if len(value) != 1}
    if score_overlap or source_overlap or duplicate_examples:
        raise SplitLeakageError(json.dumps({
            "score_overlap": score_overlap,
            "semantic_source_overlap": source_overlap,
            "duplicate_examples": duplicate_examples[:20],
        }, sort_keys=True))
    split_summary = {}
    for split in SPLITS:
        rows = [value for value in score_rows.values() if value["split"] == split]
        split_summary[split] = {
            "scores": len(rows),
            "semantic_sources": len({row["semantic_source_id"] for row in rows}),
            "examples": sum(row["examples"] for row in rows),
        }
    sorted_scores = sorted(score_rows.values(), key=lambda row: row["score_id"])
    manifest = {
        "schema_version": 1,
        "dataset_root": str(dataset_dir),
        "shards": shard_rows,
        "scores": sorted_scores,
        "whole_score_ids": [row["score_id"] for row in sorted_scores],
        "semantic_source_ids": sorted(source_splits),
        "splits": split_summary,
        "family_states": family_states,
        "family_availability": family_availability,
        "dataset_bytes": sum(row["bytes"] for row in shard_rows),
        "whole_score_split_isolation": True,
        "semantic_source_split_isolation": True,
        "duplicate_examples": 0,
        "future_test_reserved": split_summary["future-test"]["scores"] > 0,
        "future_test_lock": "RESERVED_NOT_TRAINER_ACCESSIBLE" if split_summary["future-test"]["scores"] > 0 else "MISSING",
        "hashes_verified": bool(verify_hashes),
        "manifest_frozen": bool(verify_hashes),
        "missing_or_corrupt_shards": [],
    }
    manifest["dataset_digest"] = _dataset_digest(shard_rows, sorted_scores)
    manifest["manifest_digest"] = _manifest_digest(manifest)
    _atomic_json(output_path, manifest)
    return manifest


def load_dataset_index(path: Path, expected_root: Path | None = None):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if value.get("schema_version") != 1 or value.get("manifest_digest") != _manifest_digest(value):
        raise ValueError("Dataset index digest mismatch")
    if not value.get("whole_score_split_isolation") or not value.get("semantic_source_split_isolation"):
        raise SplitLeakageError("Dataset index does not guarantee split isolation")
    if expected_root is not None and Path(value["dataset_root"]).resolve() != Path(expected_root).resolve():
        raise ValueError("Dataset index belongs to a different dataset root")
    return value


def verify_index_shards(index, require_hashes=False):
    root = Path(index["dataset_root"])
    errors = []
    for row in index["shards"]:
        path = root / row["path"]
        if not path.is_file():
            errors.append(f"missing:{row['path']}")
        elif require_hashes and not row.get("sha256"):
            errors.append(f"hash-unavailable:{row['path']}")
        elif row.get("sha256") and _sha256(path) != row["sha256"]:
            errors.append(f"hash-mismatch:{row['path']}")
    return {"valid": not errors, "errors": errors, "shards": len(index["shards"]), "hashes_required": require_hashes}


def scope_order(example_id):
    match = SCOPE_NUMBER.search(example_id)
    return int(match.group(1)) if match else 10**12


class CanonicalImageResolver:
    """Lazily resolves one score's page paths and keeps a two-page image LRU."""

    def __init__(self, dataset_root: Path, image_height: int, image_width: int, allow_synthetic=False, cache_pages=2):
        self.root = Path(dataset_root)
        self.image_height = int(image_height)
        self.image_width = int(image_width)
        self.allow_synthetic = bool(allow_synthetic)
        self.cache_pages = int(cache_pages)
        self._score_id = None
        self._paths = {}
        self._page_cache = OrderedDict()

    def _load_score(self, score_id):
        if self._score_id == score_id:
            return
        self._score_id = score_id
        self._paths = {}
        path = self.root / "canonical" / f"{score_id}.json.gz"
        if path.is_file():
            with gzip.open(path, "rt", encoding="utf-8") as stream:
                payload = json.load(stream)
            for scope in payload.get("sourceAlignment", {}).get("scopes", []):
                metadata = scope.get("metadata", {})
                if metadata.get("exampleId") and metadata.get("renderedPagePath"):
                    self._paths[metadata["exampleId"]] = metadata["renderedPagePath"]

    def _page(self, path):
        path = str(path)
        if path in self._page_cache:
            self._page_cache.move_to_end(path)
            return self._page_cache[path]
        with Image.open(path) as image:
            page = image.convert("L").copy()
        self._page_cache[path] = page
        while len(self._page_cache) > self.cache_pages:
            self._page_cache.popitem(last=False)
        return page

    def _synthetic(self, record):
        seed = int(hashlib.blake2b(record["exampleId"].encode(), digest_size=8).hexdigest(), 16)
        rng = np.random.default_rng(seed)
        image = np.full((self.image_height, self.image_width), 1.0, dtype=np.float32)
        for row in range(5, self.image_height, max(5, self.image_height // 12)):
            image[row:row + 1] = 0.72
        image += rng.normal(0, 0.012, image.shape).astype(np.float32)
        return np.clip(image, 0, 1)

    def resolve(self, record, augment=False, rng=None):
        self._load_score(record["scoreId"])
        path = self._paths.get(record["exampleId"])
        if not path or not Path(path).is_file():
            if self.allow_synthetic:
                return self._synthetic(record), True
            raise MissingPixelError(f"Required pixel source missing for {record['exampleId']}: {path}")
        page = self._page(path)
        bounds = record["input"]["modelInput"]["pixels"]["cropBounds"]
        width, height = page.size
        x0, x1 = float(bounds["x0"]), float(bounds["x1"])
        y0, y1 = float(bounds["y0"]), float(bounds["y1"])
        pad_x = max(0.008, (x1 - x0) * 0.08)
        pad_y = max(0.008, (y1 - y0) * 0.16)
        crop = page.crop((
            max(0, int((x0 - pad_x) * width)),
            max(0, int((y0 - pad_y) * height)),
            min(width, int(math.ceil((x1 + pad_x) * width))),
            min(height, int(math.ceil((y1 + pad_y) * height))),
        )).resize((self.image_width, self.image_height), Image.Resampling.BILINEAR)
        if augment and rng is not None:
            if rng.random() < 0.35:
                crop = ImageEnhance.Contrast(crop).enhance(rng.uniform(0.88, 1.12))
            if rng.random() < 0.25:
                crop = ImageEnhance.Brightness(crop).enhance(rng.uniform(0.93, 1.07))
        value = np.asarray(crop, dtype=np.float32) / 255.0
        if augment and rng is not None and rng.random() < 0.2:
            noise = np.random.default_rng(rng.randrange(2**32)).normal(0, 0.008, value.shape)
            value = np.clip(value + noise, 0, 1).astype(np.float32)
        return value, False


def _center(obj):
    center = obj.get("center") or {}
    bounds = obj.get("bounds") or {}
    return (
        float(center.get("x", (float(bounds.get("x0", 0)) + float(bounds.get("x1", 0))) / 2)),
        float(center.get("y", (float(bounds.get("y0", 0)) + float(bounds.get("y1", 0))) / 2)),
    )


def _bounds(obj):
    cx, cy = _center(obj)
    value = obj.get("bounds") or {}
    return (
        float(value.get("x0", cx)), float(value.get("x1", cx)),
        float(value.get("y0", cy)), float(value.get("y1", cy)),
    )


def _node_graph_features(record):
    graph = record["input"]["modelInput"].get("sourceGraph") or {}
    objects = record["input"]["modelInput"].get("physicalObjects") or []
    incident = defaultdict(list)
    for edge in graph.get("edges", []):
        left = edge.get("fromObjectIndex", edge.get("from"))
        right = edge.get("toObjectIndex", edge.get("to"))
        if isinstance(left, int) and isinstance(right, int):
            incident[left].append((edge, 1, right))
            incident[right].append((edge, -1, left))
    result = []
    for index in range(len(objects)):
        values = np.zeros(16, dtype=np.float32)
        rows = incident.get(index, [])
        scores = [float(row[0].get("score") or 0) for row in rows]
        values[0] = min(1, len(rows) / 16)
        values[1] = min(1, sum(row[1] > 0 for row in rows) / 8)
        values[2] = min(1, sum(row[1] < 0 for row in rows) / 8)
        values[3] = np.mean(scores) if scores else 0
        values[4] = max(scores, default=0)
        for edge, _direction, _other in rows:
            slot = 5 + int.from_bytes(hashlib.blake2b(str(edge.get("type", "unknown")).encode(), digest_size=1).digest(), "big") % 10
            values[slot] = min(1, values[slot] + 0.25)
        values[15] = float(bool(rows))
        result.append(values)
    return result


def _object_vector(obj, current_scope, bands, graph_state):
    cx, cy = _center(obj)
    x0, x1, y0, y1 = _bounds(obj)
    sx0, sx1 = float(current_scope["x0"]), float(current_scope["x1"])
    sy0, sy1 = float(current_scope["y0"]), float(current_scope["y1"])
    sw, sh = max(1e-6, sx1 - sx0), max(1e-6, sy1 - sy0)
    kind = obj.get("kind")
    staff_bands = bands.get("staffBands", []) if isinstance(bands, dict) else []
    upper = next((row for row in staff_bands if row.get("staffRole") == "upper"), None)
    lower = next((row for row in staff_bands if row.get("staffRole") == "lower"), None)
    upper_y = (float(upper["y0"]) + float(upper["y1"])) / 2 if upper else cy
    lower_y = (float(lower["y0"]) + float(lower["y1"])) / 2 if lower else cy
    observed = obj.get("frozenGraphObservation") or obj.get("frozenSourceObservation") or {}
    value = [
        float(kind == "notehead"), float(kind == "rest"), float(kind not in {"notehead", "rest"}),
        cx, cy, max(0, x1 - x0), max(0, y1 - y0),
        (cx - sx0) / sw, (cy - sy0) / sh,
        float(obj.get("geometryConfidence") or 0),
        np.clip((cy - upper_y) / sh, -2, 2), np.clip((cy - lower_y) / sh, -2, 2),
        sw, sh, float(graph_state == "KNOWN"), float(bool(observed)),
        float("coordinateError" in observed), float("staffRole" in observed),
        float(obj.get("geometrySource") == "glyph-font-bbox"),
        float("vector" in str(obj.get("geometrySource", "")).lower()),
        math.sin(cx * math.pi * 2), math.cos(cx * math.pi * 2),
        math.sin(cy * math.pi * 2), math.cos(cy * math.pi * 2),
    ]
    return np.asarray(value, dtype=np.float32)


def _assign(target, mask, index, value):
    if index < 0 or index >= len(target):
        return
    if mask[index] and target[index] != value:
        mask[index] = False
        target[index] = -1
        return
    target[index] = value
    mask[index] = True


def _lane_class(value):
    role = str((value or {}).get("laneRole") or "")
    try:
        return max(0, min(7, int(role.rsplit("-", 1)[1]) - 1))
    except (IndexError, ValueError):
        return 7


def _duration_values(value):
    value = value or {}
    modification = value.get("timeModification") or {}
    ratio = None if not modification else (int(modification.get("actualNotes") or 0), int(modification.get("normalNotes") or 0))
    return {
        "duration_type": DURATION_TYPES.get(str(value.get("writtenType") or "unknown").lower(), 0),
        "duration_dots": max(0, min(3, int(value.get("dots") or 0))),
        "duration_tuplet_ratio": TUPLET_RATIOS.get(ratio, TUPLET_RATIOS["other"]),
        "duration_grace": int(bool(value.get("grace"))),
        "duration_quarters": float(value.get("divisionsNormalizedQuarters") or 0),
    }


def _make_targets(record, selected, object_lookup, relations):
    count = len(selected)
    object_target = {name: np.full(count, -1, dtype=np.int64) for name in OBJECT_HEADS}
    object_mask = {name: np.zeros(count, dtype=np.bool_) for name in OBJECT_HEADS}
    regression_target = {"duration_quarters": np.zeros(count, dtype=np.float32)}
    regression_mask = {"duration_quarters": np.zeros(count, dtype=np.bool_)}
    local_count = sum(scope_id == record["exampleId"] for scope_id, _index, _obj, _record in selected)
    families = record["target"]["families"]

    pitch_by_global = {}
    lane_by_global = {}
    duration_by_global = {}
    for label in families["PITCH_STAFF"]:
        if label.get("state") != "KNOWN" or len(label.get("objectIndexes", [])) != 1:
            continue
        local = label["objectIndexes"][0]
        global_index = object_lookup.get((record["exampleId"], local))
        if global_index is None:
            continue
        value = label.get("value") or {}
        written = value.get("writtenPitch") or {}
        position = value.get("staffPosition") or {}
        accidental = written.get("alter")
        if accidental is None:
            accidental = (value.get("accidentalState") or {}).get("writtenAlter")
        accidental = 0 if accidental is None else int(round(float(accidental)))
        clef_value = ((value.get("clefContext") or {}).get("value") or {}).get("sign")
        key_value = ((value.get("accidentalState") or {}).get("keyContext") or {}).get("fifths")
        entries = {
            "pitch_staff_step": max(0, min(32, int(round(float(position.get("stepsFromBandCenter") or 0))) + 16)),
            "pitch_written_step": WRITTEN_STEPS.get(str(written.get("step") or "C").upper(), 0),
            "pitch_octave": max(0, min(10, int(written.get("octave") or 0))),
            "pitch_accidental": max(0, min(6, accidental + 3)),
            "pitch_staff": max(0, min(2, int(value.get("staff") or 1) - 1)),
            "pitch_clef": CLEFS.get(str(clef_value), CLEFS["other"]),
            "pitch_key_fifths": max(0, min(14, int(key_value or 0) + 7)),
        }
        for name, target_value in entries.items():
            _assign(object_target[name], object_mask[name], global_index, target_value)
        pitch_by_global[global_index] = (entries["pitch_written_step"], entries["pitch_octave"], entries["pitch_accidental"])
        if record["target"]["availability"].get("REST", False):
            _assign(object_target["rest"], object_mask["rest"], global_index, 0)

    for family in ("DURATION", "REST"):
        for label in families[family]:
            if label.get("state") != "KNOWN" or len(label.get("objectIndexes", [])) != 1 or not label.get("value"):
                continue
            global_index = object_lookup.get((record["exampleId"], label["objectIndexes"][0]))
            if global_index is None:
                continue
            values = _duration_values(label["value"])
            for name in ("duration_type", "duration_dots", "duration_tuplet_ratio", "duration_grace"):
                _assign(object_target[name], object_mask[name], global_index, values[name])
            regression_target["duration_quarters"][global_index] = values["duration_quarters"]
            regression_mask["duration_quarters"][global_index] = True
            duration_by_global[global_index] = label["value"]
            if family == "REST":
                _assign(object_target["rest"], object_mask["rest"], global_index, 1)

    for label in families["LANE"]:
        if label.get("state") == "KNOWN" and len(label.get("objectIndexes", [])) == 1:
            global_index = object_lookup.get((record["exampleId"], label["objectIndexes"][0]))
            if global_index is not None:
                lane = _lane_class(label.get("value"))
                _assign(object_target["lane"], object_mask["lane"], global_index, lane)
                lane_by_global[global_index] = lane

    tuplet_positive = set()
    for label in families["TUPLET"]:
        if label.get("state") == "KNOWN" and label.get("isPositive"):
            for local in label.get("objectIndexes", []):
                global_index = object_lookup.get((record["exampleId"], local))
                if global_index is not None:
                    tuplet_positive.add(global_index)
                    _assign(object_target["tuplet"], object_mask["tuplet"], global_index, 1)
    for global_index, value in duration_by_global.items():
        if record["target"]["availability"].get("TUPLET", False) and global_index not in tuplet_positive and not value.get("timeModification"):
            _assign(object_target["tuplet"], object_mask["tuplet"], global_index, 0)

    for label in families["CROSS_STAFF"]:
        if label.get("state") == "KNOWN":
            for local in label.get("objectIndexes", []):
                global_index = object_lookup.get((record["exampleId"], local))
                if global_index is not None:
                    _assign(object_target["cross_staff"], object_mask["cross_staff"], global_index, int(bool(label.get("isPositive"))))
    for label in families["SHARED_HEAD"]:
        if label.get("state") == "KNOWN":
            roles = int((label.get("value") or {}).get("semanticRoleCount") or 1)
            for local in label.get("objectIndexes", []):
                global_index = object_lookup.get((record["exampleId"], local))
                if global_index is not None:
                    _assign(object_target["shared_head"], object_mask["shared_head"], global_index, max(0, min(3, roles - 1)))

    relation_target = {name: np.full(len(relations), -1, dtype=np.int64) for name in RELATION_HEADS}
    relation_mask = {name: np.zeros(len(relations), dtype=np.bool_) for name in RELATION_HEADS}
    relation_position = {(left, right): index for index, (left, right, _features) in enumerate(relations)}

    for head, family in (("attack", "ATTACK"), ("chord", "CHORD")):
        labels = families[family]
        known = [label for label in labels if label.get("state") == "KNOWN"]
        complete = bool(known) and all(label.get("state") == "KNOWN" for label in labels)
        eligible = set()
        positives = set()
        for label in known:
            indexes = [object_lookup.get((record["exampleId"], local)) for local in label.get("objectIndexes", [])]
            indexes = [value for value in indexes if value is not None]
            eligible.update(indexes)
            if label.get("isPositive"):
                positives.update((min(left, right), max(left, right)) for position, left in enumerate(indexes) for right in indexes[position + 1:])
        for relation_index, (left, right, _features) in enumerate(relations):
            key = (min(left, right), max(left, right))
            if key in positives:
                relation_target[head][relation_index] = 1
                relation_mask[head][relation_index] = True
            elif complete and left in eligible and right in eligible:
                relation_target[head][relation_index] = 0
                relation_mask[head][relation_index] = True

    def attach_external(head, family):
        for label in families[family]:
            if label.get("state") != "KNOWN" or len(label.get("objectIndexes", [])) != 1:
                continue
            left = object_lookup.get((record["exampleId"], label["objectIndexes"][0]))
            for external in label.get("externalObjectRefs", []):
                right = object_lookup.get((external.get("scopeId"), external.get("objectIndex")))
                relation_index = relation_position.get((left, right))
                if relation_index is None:
                    relation_index = relation_position.get((right, left)) if head == "cross_staff_relation" else None
                if relation_index is not None:
                    relation_target[head][relation_index] = int(bool(label.get("isPositive")))
                    relation_mask[head][relation_index] = True

    attach_external("lane_continuation", "LANE_CONTINUATION")
    attach_external("tie", "TIE_SUSTAIN")
    attach_external("cross_staff_relation", "CROSS_STAFF")

    # Safe relation negatives only: known different lanes cannot continue and
    # known different written pitches cannot be tied. Ambiguous absence is
    # never converted into a negative target.
    for relation_index, (left, right, _features) in enumerate(relations):
        if record["target"]["availability"].get("LANE_CONTINUATION", False) and not relation_mask["lane_continuation"][relation_index] and left in lane_by_global and right in lane_by_global and lane_by_global[left] != lane_by_global[right]:
            relation_target["lane_continuation"][relation_index] = 0
            relation_mask["lane_continuation"][relation_index] = True
        if record["target"]["availability"].get("TIE_SUSTAIN", False) and not relation_mask["tie"][relation_index] and left in pitch_by_global and right in pitch_by_global and pitch_by_global[left] != pitch_by_global[right]:
            relation_target["tie"][relation_index] = 0
            relation_mask["tie"][relation_index] = True

    return {
        "object": {name: {"target": object_target[name], "mask": object_mask[name]} for name in OBJECT_HEADS},
        "relation": {name: {"target": relation_target[name], "mask": relation_mask[name]} for name in RELATION_HEADS},
        "scope": {name: {"target": np.asarray(-1, dtype=np.int64), "mask": np.asarray(False)} for name in SCOPE_HEADS},
        "regression": {name: {"target": regression_target[name], "mask": regression_mask[name]} for name in regression_target},
        "local_count": local_count,
    }


def tensorize_scope(record, score_records, resolver, config, rng, augment=False):
    records_by_id = {row["exampleId"]: row for row in score_records}
    ordered = sorted(score_records, key=lambda row: scope_order(row["exampleId"]))
    position = next(index for index, row in enumerate(ordered) if row["exampleId"] == record["exampleId"])
    radius = int(config.get("context_scopes", 1))
    context = ordered[max(0, position - radius):position + radius + 1]
    context.sort(key=lambda row: (row["exampleId"] != record["exampleId"], scope_order(row["exampleId"])))
    max_objects = int(config["max_objects"])
    selected = []
    object_lookup = {}
    per_record_graph = {}
    for scope_record in context:
        per_record_graph[scope_record["exampleId"]] = _node_graph_features(scope_record)
        objects = scope_record["input"]["modelInput"].get("physicalObjects", [])
        for local_index, obj in enumerate(objects):
            if len(selected) >= max_objects:
                break
            object_lookup[(scope_record["exampleId"], local_index)] = len(selected)
            selected.append((scope_record["exampleId"], local_index, obj, scope_record))
        if len(selected) >= max_objects:
            break

    current_scope = record["input"]["modelInput"]["geometry"]["scopeBounds"]
    object_features = []
    graph_features = []
    object_xy = []
    adjacency = np.zeros((len(selected), len(selected)), dtype=np.float32)
    sx0, sx1 = float(current_scope["x0"]), float(current_scope["x1"])
    sy0, sy1 = float(current_scope["y0"]), float(current_scope["y1"])
    sw, sh = max(1e-6, sx1 - sx0), max(1e-6, sy1 - sy0)
    for scope_id, local_index, obj, scope_record in selected:
        model_input = scope_record["input"]["modelInput"]
        cx, cy = _center(obj)
        object_features.append(_object_vector(obj, current_scope, model_input["geometry"].get("staffBands", {}), model_input.get("sourceGraph", {}).get("state")))
        graph_features.append(per_record_graph[scope_id][local_index])
        object_xy.append([np.clip((cx - sx0) / sw, 0, 1), np.clip((cy - sy0) / sh, 0, 1)])
    for scope_record in context:
        graph = scope_record["input"]["modelInput"].get("sourceGraph") or {}
        for edge in graph.get("edges", []):
            left = object_lookup.get((scope_record["exampleId"], edge.get("fromObjectIndex", edge.get("from"))))
            right = object_lookup.get((scope_record["exampleId"], edge.get("toObjectIndex", edge.get("to"))))
            if left is not None and right is not None:
                score = max(0.05, float(edge.get("score") or 1.0))
                adjacency[left, right] = max(adjacency[left, right], score)
                adjacency[right, left] = max(adjacency[right, left], score)
    np.fill_diagonal(adjacency, 1.0)

    candidates = OrderedDict()
    current_count = sum(scope_id == record["exampleId"] for scope_id, _local, _obj, _row in selected)
    for query in record["queries"].get("relationQueries", []):
        left = object_lookup.get((record["exampleId"], query.get("leftObjectIndex")))
        right = object_lookup.get((record["exampleId"], query.get("rightObjectIndex")))
        if left is not None and right is not None and left != right:
            candidates.setdefault((left, right), (str(query.get("sourceType") or "PAIR_CANDIDATE"), float(query.get("sourceScore") or 0)))
    for left in range(current_count):
        for right in range(left + 1, current_count):
            candidates.setdefault((left, right), ("LOCAL_PAIR", 0.0))
    neighbor_scopes = defaultdict(list)
    for global_index, (scope_id, _local, obj, _row) in enumerate(selected[current_count:], current_count):
        if obj.get("kind") == "notehead":
            neighbor_scopes[scope_id].append((global_index, obj))
    for left in range(current_count):
        left_obj = selected[left][2]
        if left_obj.get("kind") != "notehead":
            continue
        lx, ly = _center(left_obj)
        for _scope_id, neighbor_objects in neighbor_scopes.items():
            ranked = sorted(neighbor_objects, key=lambda item: (abs(_center(item[1])[1] - ly), abs(_center(item[1])[0] - lx)))
            for right, _obj in ranked[:4]:
                candidates.setdefault((left, right), ("CROSS_SCOPE_NEAREST", 0.0))

    relation_rows = []
    for (left, right), (source_type, source_score) in candidates.items():
        left_scope, _li, left_obj, _lr = selected[left]
        right_scope, _ri, right_obj, _rr = selected[right]
        lx, ly = _center(left_obj)
        rx, ry = _center(right_obj)
        dx, dy = rx - lx, ry - ly
        scope_delta = scope_order(right_scope) - scope_order(left_scope)
        features = np.asarray([
            np.clip(dx / max(sw, 1e-6), -4, 4), np.clip(dy / max(sh, 1e-6), -4, 4),
            min(4, abs(dx) / max(sw, 1e-6)), min(4, abs(dy) / max(sh, 1e-6)),
            float(left_scope == right_scope), np.clip(scope_delta / 4, -1, 1),
            float(left_obj.get("kind") == "notehead"), float(right_obj.get("kind") == "notehead"),
            float(left_obj.get("kind") == "rest"), float(right_obj.get("kind") == "rest"),
            np.clip(source_score, 0, 1),
            (int.from_bytes(hashlib.blake2b(source_type.encode(), digest_size=1).digest(), "big") % 17) / 16,
        ], dtype=np.float32)
        relation_rows.append((left, right, features))
    relation_rows.sort(key=lambda row: (-float(adjacency[row[0], row[1]]), -float(row[2][4]), float(row[2][2] + row[2][3]), row[0], row[1]))
    relation_rows = relation_rows[:int(config["max_relations"])]
    targets = _make_targets(record, selected, object_lookup, relation_rows)
    image, synthetic = resolver.resolve(record, augment=augment, rng=rng)
    relation_index = np.asarray([[left, right] for left, right, _features in relation_rows], dtype=np.int64)
    relation_features = np.stack([features for _left, _right, features in relation_rows]) if relation_rows else np.zeros((0, 12), dtype=np.float32)
    non_known = {
        family: sum(label.get("state") != "KNOWN" for label in record["target"]["families"][family])
        for family in PRIMARY_FAMILIES
    }
    return {
        "image": torch.from_numpy(np.ascontiguousarray(image[None], dtype=np.float32)),
        "source_features": torch.tensor(record["input"]["sourceTensor"], dtype=torch.float32),
        "object_features": torch.from_numpy(np.stack(object_features) if object_features else np.zeros((0, 24), dtype=np.float32)),
        "graph_features": torch.from_numpy(np.stack(graph_features) if graph_features else np.zeros((0, 16), dtype=np.float32)),
        "object_xy": torch.from_numpy(np.asarray(object_xy, dtype=np.float32)),
        "graph_adjacency": torch.from_numpy(adjacency),
        "relation_index": torch.from_numpy(relation_index),
        "relation_features": torch.from_numpy(relation_features),
        "targets": targets,
        "metadata": {
            "example_id": record["exampleId"],
            "score_id": record["scoreId"],
            "semantic_source_id": record["semanticSourceId"],
            "split": record["split"],
            "decoder_contract": record["decoderContract"],
            "availability": record["target"]["availability"],
            "non_known_labels": non_known,
            "synthetic_pixels": synthetic,
            "objects": len(selected),
            "current_objects": current_count,
            "truncated_objects": sum(len(row["input"]["modelInput"].get("physicalObjects", [])) for row in context) - len(selected),
            "relations": len(relation_rows),
            "relation_capacity_reached": len(candidates) > len(relation_rows),
        },
    }


class SemanticShardDataset(IterableDataset):
    def __init__(self, index_path: Path, split: str, data_config, seed=21401, epoch=0, shuffle=False, augment=False, allow_future_test=False):
        super().__init__()
        if split not in SPLITS:
            raise ValueError(f"Unknown split: {split}")
        if split == "future-test" and not allow_future_test:
            raise PermissionError("future-test is reserved and cannot be opened by the trainer")
        self.index_path = Path(index_path)
        self.index = load_dataset_index(self.index_path)
        self.root = Path(self.index["dataset_root"])
        self.split = split
        self.config = dict(data_config)
        self.seed = int(seed)
        self.epoch = int(epoch)
        self.shuffle = bool(shuffle)
        self.augment = bool(augment)
        self._eligibility = None

    def set_epoch(self, epoch):
        self.epoch = int(epoch)

    def record_known_counts(self, record):
        tgt = record.get("target", {})
        availability = tgt.get("availability", {}) or {}
        families = tgt.get("families", {}) or {}
        counts = {}
        for family in PRIMARY_FAMILIES:
            labels = families.get(family) or []
            known = sum(1 for lbl in labels if str(lbl.get("state", "")).lower() == "known")
            counts[family] = {"availability": bool(availability.get(family)), "known": int(known)}
        return counts

    def record_is_trainable(self, record):
        return any(c["availability"] and c["known"] > 0 for c in self.record_known_counts(record).values())

    def _eligibility_scan(self):
        if self._eligibility is not None:
            return self._eligibility
        excluded = []
        per_family = {family: {"available_examples": 0, "known_labels": 0} for family in PRIMARY_FAMILIES}
        total = 0
        for shard in self.index["shards"]:
            if self.split not in shard["splits"]:
                continue
            for record in iter_jsonl(self.root / shard["path"]):
                if record["split"] != self.split:
                    continue
                total += 1
                counts = self.record_known_counts(record)
                trainable = any(c["availability"] and c["known"] > 0 for c in counts.values())
                for family, c in counts.items():
                    per_family[family]["available_examples"] += int(c["availability"])
                    per_family[family]["known_labels"] += int(c["known"])
                if not trainable:
                    excluded.append(record["exampleId"])
        self._eligibility = {"total": total, "trainable": total - len(excluded), "excluded": tuple(sorted(excluded)), "per_family": per_family}
        return self._eligibility

    def eligibility_summary(self):
        e = self._eligibility_scan()
        return {
            "split": self.split,
            "total_examples": e["total"],
            "trainable_examples": e["trainable"],
            "zero_supervision_excluded": len(e["excluded"]),
            "excluded_example_ids": list(e["excluded"]),
            "per_family": {family: dict(v) for family, v in e["per_family"].items()},
        }

    def __len__(self):
        return int(self.index["splits"][self.split]["examples"]) - len(self._eligibility_scan()["excluded"])

    def _records_for_score(self, score):
        seen = set()
        rows = []
        for relative in score["shards"]:
            for record in iter_jsonl(self.root / relative):
                if record["scoreId"] == score["score_id"] and record["exampleId"] not in seen:
                    seen.add(record["exampleId"])
                    rows.append(record)
        if len(rows) != int(score["examples"]):
            raise ValueError(f"Score index mismatch for {score['score_id']}: {len(rows)} != {score['examples']}")
        return sorted(rows, key=lambda row: scope_order(row["exampleId"]))

    def _sequential_score_groups(self):
        current_score = None
        rows = []
        completed = set()
        for shard in self.index["shards"]:
            if self.split not in shard["splits"]:
                continue
            for record in iter_jsonl(self.root / shard["path"]):
                if record["split"] != self.split:
                    continue
                score_id = record["scoreId"]
                if current_score is None:
                    current_score = score_id
                if score_id != current_score:
                    completed.add(current_score)
                    yield sorted(rows, key=lambda row: scope_order(row["exampleId"]))
                    if score_id in completed:
                        raise ValueError(f"Score {score_id} is non-contiguous across semantic shards")
                    current_score, rows = score_id, []
                rows.append(record)
        if rows:
            yield sorted(rows, key=lambda row: scope_order(row["exampleId"]))

    def __iter__(self):
        worker = get_worker_info()
        worker_id = worker.id if worker else 0
        worker_count = worker.num_workers if worker else 1
        rng = random.Random(self.seed + self.epoch * 1009)
        resolver = CanonicalImageResolver(
            self.root,
            self.config["image_height"],
            self.config["image_width"],
            allow_synthetic=self.config.get("allow_synthetic_pixels", False),
        )
        if worker_count == 1:
            groups = self._sequential_score_groups()
        else:
            # Multi-worker mode assigns whole scores, preserving relations and
            # split identity at the cost of repeated bounded shard reads.
            scores = [row for row in self.index["scores"] if row["split"] == self.split]
            if self.shuffle:
                rng.shuffle(scores)
            scores = [row for index, row in enumerate(scores) if index % worker_count == worker_id]
            groups = (self._records_for_score(score) for score in scores)

        def samples():
            excluded = set(self._eligibility_scan()["excluded"]) if self.split == "train" else set()
            for records in groups:
                for record in records:
                    if record["exampleId"] in excluded:
                        continue
                    yield tensorize_scope(record, records, resolver, self.config, rng, augment=self.augment)

        if not self.shuffle:
            yield from samples()
            return
        buffer_size = max(1, int(self.config.get("shuffle_buffer", 32)))
        buffer = []
        for sample in samples():
            buffer.append(sample)
            if len(buffer) >= buffer_size:
                yield buffer.pop(rng.randrange(len(buffer)))
        while buffer:
            yield buffer.pop(rng.randrange(len(buffer)))


def _pad_first(value, size, fill=0):
    shape = (size,) + tuple(value.shape[1:])
    result = torch.full(shape, fill, dtype=value.dtype)
    result[:len(value)] = value
    return result


def collate_semantic(batch):
    if not batch:
        raise ValueError("Cannot collate an empty batch")
    max_objects = max(len(row["object_features"]) for row in batch)
    max_relations = max(1, max(len(row["relation_index"]) for row in batch))
    result = {
        "image": torch.stack([row["image"] for row in batch]),
        "source_features": torch.stack([row["source_features"] for row in batch]),
        "object_features": torch.stack([_pad_first(row["object_features"], max_objects) for row in batch]),
        "graph_features": torch.stack([_pad_first(row["graph_features"], max_objects) for row in batch]),
        "object_xy": torch.stack([_pad_first(row["object_xy"], max_objects) for row in batch]),
        "graph_adjacency": torch.zeros((len(batch), max_objects, max_objects), dtype=torch.float32),
        "relation_index": torch.stack([_pad_first(row["relation_index"], max_relations) for row in batch]),
        "relation_features": torch.stack([_pad_first(row["relation_features"], max_relations) for row in batch]),
        "object_mask": torch.zeros((len(batch), max_objects), dtype=torch.bool),
        "relation_mask": torch.zeros((len(batch), max_relations), dtype=torch.bool),
        "metadata": [row["metadata"] for row in batch],
        "targets": {"object": {}, "relation": {}, "scope": {}, "regression": {}},
    }
    for batch_index, row in enumerate(batch):
        objects = len(row["object_features"])
        relations = len(row["relation_index"])
        result["object_mask"][batch_index, :objects] = True
        result["relation_mask"][batch_index, :relations] = True
        result["graph_adjacency"][batch_index, :objects, :objects] = row["graph_adjacency"]
    for group, heads in (("object", OBJECT_HEADS), ("relation", RELATION_HEADS)):
        size = max_objects if group == "object" else max_relations
        for head in heads:
            targets = []
            masks = []
            for row in batch:
                payload = row["targets"][group][head]
                targets.append(_pad_first(torch.from_numpy(np.asarray(payload["target"])), size, fill=-1))
                masks.append(_pad_first(torch.from_numpy(np.asarray(payload["mask"])), size, fill=False))
            result["targets"][group][head] = {"target": torch.stack(targets), "mask": torch.stack(masks)}
    for head in SCOPE_HEADS:
        result["targets"]["scope"][head] = {
            "target": torch.tensor([int(row["targets"]["scope"][head]["target"]) for row in batch], dtype=torch.long),
            "mask": torch.tensor([bool(row["targets"]["scope"][head]["mask"]) for row in batch], dtype=torch.bool),
        }
    for head in ("duration_quarters",):
        result["targets"]["regression"][head] = {
            "target": torch.stack([_pad_first(torch.from_numpy(row["targets"]["regression"][head]["target"]), max_objects) for row in batch]),
            "mask": torch.stack([_pad_first(torch.from_numpy(row["targets"]["regression"][head]["mask"]), max_objects, fill=False) for row in batch]),
        }
    return result


def make_loader(dataset, batch_size, num_workers=0, prefetch_factor=1, persistent_workers=False):
    options = {
        "dataset": dataset,
        "batch_size": int(batch_size),
        "num_workers": int(num_workers),
        "collate_fn": collate_semantic,
        "pin_memory": False,
    }
    if int(num_workers) > 0:
        options["prefetch_factor"] = max(1, int(prefetch_factor))
        options["persistent_workers"] = bool(persistent_workers)
    return torch.utils.data.DataLoader(**options)
