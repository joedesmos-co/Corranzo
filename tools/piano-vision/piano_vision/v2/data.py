"""Read-only production adapter; source tensors and target derivation are separate.

Only pure train or validation shards may be opened by this development API.
All crop coordinates use one explicit affine mapping, including integer rounding.
"""
import gzip
import hashlib
import json
import math
import re
from collections import Counter, OrderedDict
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from ..data import (CLEFS, PRIMARY_FAMILIES, _bounds, _center, _make_targets, _duration_values,
                    _object_vector, load_dataset_index, iter_jsonl)
from . import INPUT_VERSION
from .model import CONTEXT_CLASSES

SCOPE_ID = re.compile(r":p(\d+)-s(\d+)-x(\d+)$")
LEGACY_ID = re.compile(r":semantic-m(\d+)$")
EDGE_TYPES = ("stem", "beam", "tie", "slur", "chord", "tuplet", "staff", "other")


def source_order(record):
    match = SCOPE_ID.search(record["exampleId"])
    if match:
        return tuple(map(int, match.groups()))
    match = LEGACY_ID.search(record["exampleId"])
    if match:
        return (1, 0, int(match[1]))
    raise ValueError(f"Unrecognized source layout identity: {record['exampleId']}")


def development_scores(index_path, split, limit, seed=21701, validation_role=None):
    if split not in {"train", "validation"}:
        raise PermissionError("Architecture development can open only train and validation")
    if not 1 <= limit <= 64:
        raise ValueError("Development score limit must be 1..64")
    index = load_dataset_index(index_path)
    shards = {s["path"]: s for s in index["shards"]}
    if validation_role is not None and (split!="validation" or validation_role not in {"selection","temperature","risk"}):
        raise ValueError("Invalid validation partition")
    from .calibration import validation_partition
    scores = sorted((s for s in index["scores"] if s["split"] == split and
                     (validation_role is None or validation_partition(s["semantic_source_id"])==validation_role)),
                    key=lambda s: hashlib.sha256(f"{seed}:{s['score_id']}".encode()).hexdigest())[:limit]
    for score in scores:
        records = {}
        for name in score["shards"]:
            if set(shards[name]["splits"]) != {split}:
                raise PermissionError("Mixed-split shards are not opened for architecture development")
            for record in iter_jsonl(Path(index["dataset_root"]) / name):
                if record["split"] != split:
                    raise PermissionError("Shard contents contradict split manifest")
                if record["scoreId"] == score["score_id"]:
                    if record["provenance"].get("runtimeTruthInputs") != []:
                        raise ValueError("Runtime truth firewall violation")
                    if record["exampleId"] in records:
                        raise ValueError("Duplicate semantic example")
                    records[record["exampleId"]] = record
        if len(records) != score["examples"]:
            raise ValueError("Score manifest count mismatch")
        yield sorted(records.values(), key=source_order)


class PageResolver:
    def __init__(self, root, max_pages=3, index_path=None):
        self.root = Path(root)
        self.score = None
        self.paths = {}
        self.pages = OrderedDict()
        self.max_pages = max_pages
        self.assignments = None
        self.historical_split_mismatches = 0
        if index_path is not None:
            index=load_dataset_index(index_path,expected_root=self.root)
            self.assignments={s["score_id"]:s["split"] for s in index["scores"]}

    def page(self, record):
        if record["split"] not in {"train", "validation"}:
            raise PermissionError("Sealed split")
        if self.assignments is not None and self.assignments.get(record["scoreId"])!=record["split"]:
            raise PermissionError("Authoritative score split mismatch")
        if self.score != record["scoreId"]:
            with gzip.open(self.root / "canonical" / f"{record['scoreId']}.json.gz", "rt") as stream:
                canonical = json.load(stream)
            if canonical["scoreId"] != record["scoreId"]:
                raise PermissionError("Canonical source identity mismatch")
            if canonical["split"] != record["split"]:
                # Immutable physical canonical metadata predates the repaired
                # split manifest. Only a digest-verified current index can
                # authorize this source lookup; never reassign anything here.
                if self.assignments is None:
                    raise PermissionError("Historical canonical split requires authoritative index")
                self.historical_split_mismatches+=1
            self.paths = {s["metadata"]["exampleId"]: s["metadata"]["renderedPagePath"]
                          for s in canonical["sourceAlignment"]["scopes"]}
            self.score = record["scoreId"]
        path = self.paths[record["exampleId"]]
        if path not in self.pages:
            with Image.open(path) as image:
                self.pages[path] = image.convert("L").copy()
        self.pages.move_to_end(path)
        while len(self.pages) > self.max_pages:
            self.pages.popitem(last=False)
        return self.pages[path]


def crop_view(page, bounds, height, width, pad=.08):
    """Return pixels, normalized source→view matrix, and inverse."""
    pw, ph = page.size
    x0, y0, x1, y1 = bounds
    px, py = max(.004, (x1 - x0) * pad), max(.004, (y1 - y0) * pad)
    box = (max(0, math.floor((x0 - px) * pw)), max(0, math.floor((y0 - py) * ph)),
           min(pw, math.ceil((x1 + px) * pw)), min(ph, math.ceil((y1 + py) * ph)))
    cw, ch = box[2] - box[0], box[3] - box[1]
    if min(cw, ch) <= 0:
        raise ValueError("Empty source crop")
    scale = min(width / cw, height / ch)
    rw, rh = max(1, round(cw * scale)), max(1, round(ch * scale))
    ox, oy = (width - rw) // 2, (height - rh) // 2
    image = Image.new("L", (width, height), 255)
    image.paste(page.crop(box).resize((rw, rh), Image.Resampling.BILINEAR), (ox, oy))
    matrix = np.array([[pw * rw / cw / width, 0, (ox - box[0] * rw / cw) / width],
                       [0, ph * rh / ch / height, (oy - box[1] * rh / ch) / height],
                       [0, 0, 1]], dtype=np.float64)
    return torch.from_numpy(np.asarray(image, dtype=np.float32).copy()[None] / 255), matrix, np.linalg.inv(matrix)


def map_box(bounds, matrix):
    x0, y0, x1, y1 = bounds
    points = np.array([[x0, y0, 1], [x1, y1, 1]]) @ matrix.T
    points = points[:, :2] / points[:, 2:]
    return points.reshape(-1).astype(np.float32)


def scope_box(record):
    b = record["input"]["modelInput"]["geometry"]["scopeBounds"]
    return (float(b["x0"]), float(b["y0"]), float(b["x1"]), float(b["y1"]))


def primitive_features(record):
    """Resolve string-ID graph evidence conservatively using source geometry.

    Only topology/type/confidence enters; source pitch/duration guesses are not
    targets or privileged inputs. Ambiguous node-to-object matches stay missing.
    """
    m = record["input"]["modelInput"]
    objects = m.get("physicalObjects", [])
    graph = m.get("sourceGraph") or {}
    nodes = {n.get("id"): n for n in graph.get("nodes", [])}
    incident = Counter()
    counts = {}
    for edge in graph.get("edges", []):
        kind = str(edge.get("type", ""))
        slot = next((i for i, t in enumerate(EDGE_TYPES[:-1]) if t in kind), 7)
        for endpoint in (edge.get("from"), edge.get("to")):
            values = counts.setdefault(endpoint, np.zeros(16, dtype=np.float32))
            values[slot] += 1
            values[8 + slot] = max(values[8 + slot], float(edge.get("score") or 0))
            incident[endpoint] += 1
    features = np.zeros((len(objects), 16), dtype=np.float32)
    matched = 0
    for i, obj in enumerate(objects):
        cx, cy = _center(obj)
        x0, x1, y0, y1 = _bounds(obj)
        matches = []
        for identifier, node in nodes.items():
            anchor = node.get("anchor") or {}
            if node.get("kind") != obj.get("kind") or "xNorm" not in anchor or "yNorm" not in anchor:
                continue
            dx = abs(float(anchor["xNorm"]) - cx) / max(x1 - x0, 1e-5)
            dy = abs(float(anchor["yNorm"]) - cy) / max(y1 - y0, 1e-5)
            if dx < .55 and dy < .8:
                matches.append((dx + dy, identifier))
        matches.sort()
        if matches and (len(matches) == 1 or matches[1][0] - matches[0][0] > .2):
            features[i] = counts.get(matches[0][1], 0)
            matched += 1
        # Integer-index producers remain supported.
        features[i] += counts.get(i, 0)
    features[:, :8] = np.log1p(features[:, :8]) / 4
    return features, {"source_nodes": len(nodes), "matched_objects": matched, "source_edges": len(graph.get("edges", []))}


def build_inputs(record, records, resolver, config):
    """Source-only function: no access to `target` or semantic target identity."""
    if any(r["scoreId"] != record["scoreId"] or r["split"] != record["split"] for r in records):
        raise PermissionError("Context must be from the same score and split")
    ordered = sorted(records, key=source_order)
    position = next(i for i, r in enumerate(ordered) if r["exampleId"] == record["exampleId"])
    window = ordered[max(0, position - config.context_radius):position + config.context_radius + 1]
    window = [record] + [r for r in window if r["exampleId"] != record["exampleId"]]
    order_lookup = {r["exampleId"]:i for i,r in enumerate(ordered)}
    views, transforms, inverse, view_keys = [], [], [], []

    def add_view(row, bounds, key):
        pixels, matrix, back = crop_view(resolver.page(row), bounds, config.image_height, config.image_width)
        views.append(pixels); transforms.append(matrix); inverse.append(back); view_keys.append(key)
        return len(views) - 1

    h_boxes, h_views, h_types, h_id, h_parent, h_geometry = [], [], [], [], [], []
    nodes, measure_views = {}, {}

    def add_node(key, box, view, kind, identity, parent=-1):
        if key in nodes:
            return nodes[key]
        nodes[key] = len(h_boxes)
        h_boxes.append(map_box(box, transforms[view])); h_views.append(view); h_types.append(kind)
        h_id.append(identity); h_parent.append(parent)
        h_geometry.append([(box[0]+box[2])/2, (box[1]+box[3])/2, box[2]-box[0], box[3]-box[1]])
        return nodes[key]

    selected, lookup, object_context = [], {}, []
    graph = {}
    graph_audit = []
    for row in window:
        page, system, order = source_order(row)
        m = row["input"]["modelInput"]
        bounds = scope_box(row)
        same_system = [r for r in ordered if source_order(r)[:2] == (page, system)]
        system_bounds = [scope_box(r) for r in same_system]
        sb = (min(b[0] for b in system_bounds), min(b[1] for b in system_bounds),
              max(b[2] for b in system_bounds), max(b[3] for b in system_bounds))
        pk = ("page", page)
        if pk not in nodes:
            pv = add_view(row, (0, 0, 1, 1), pk)
            add_node(pk, (0, 0, 1, 1), pv, 0, [page, -1, -1, -1])
        sk = ("system", page, system)
        if sk not in nodes:
            # Header width includes signature material before first attacks.
            header = (max(0, sb[0] - .04), max(0, sb[1] - .02), min(1, sb[0] + .23), min(1, sb[3] + .02))
            sv = add_view(row, header, sk)
            add_node(sk, header, sv, 1, [page, system, -1, -1], nodes[pk])
        mv = add_view(row, bounds, ("measure", row["exampleId"]))
        measure_views[row["exampleId"]] = mv
        mn = add_node(("measure", row["exampleId"]), bounds, mv, 3,
                      [page, system, -1, order], nodes[sk])
        bands = m["geometry"].get("staffBands", {}).get("staffBands", [])
        staff_nodes = []
        for staff, band in enumerate(bands):
            stkey = ("staff", page, system, staff)
            st = add_node(stkey, (sb[0], band["y0"], min(sb[0] + .23, 1), band["y1"]), h_views[nodes[sk]], 2,
                          [page, system, staff, -1], nodes[sk])
            cm = add_node(("context", row["exampleId"], staff), (bounds[0], band["y0"], bounds[2], band["y1"]), mv, 4,
                          [page, system, staff, order], st)
            staff_nodes.append(cm)
        graph[row["exampleId"]], audit = primitive_features(row)
        graph_audit.append(audit)
        for local, obj in enumerate(m.get("physicalObjects", [])):
            if len(selected) >= config.max_objects:
                break
            _, cy = _center(obj)
            staff = min(range(len(bands)), key=lambda k: abs(cy-(bands[k]["y0"]+bands[k]["y1"])/2)) if bands else -1
            lookup[(row["exampleId"], local)] = len(selected)
            selected.append((row["exampleId"], local, obj, row))
            object_context.append(staff_nodes[staff] if staff >= 0 else mn)

    objects, boxes, obj_views, obj_graph, obj_identity, obj_geometry = [], [], [], [], [], []
    for scope, local, obj, row in selected:
        page, system, order = source_order(row)
        m = row["input"]["modelInput"]
        bounds = m["geometry"]["scopeBounds"]
        objects.append(_object_vector(obj, bounds, m["geometry"].get("staffBands", {}), m.get("sourceGraph", {}).get("state")))
        x0, x1, y0, y1 = _bounds(obj)
        dx, dy = max(x1-x0, .004), max(y1-y0, .004)
        # Region includes glyph-origin uncertainty and neighboring notation ink.
        region = (x0 - dx, y0 - dy, x1 + dx, y1 + dy)
        view = measure_views[scope]
        boxes.append(map_box(region, transforms[view])); obj_views.append(view)
        obj_graph.append(graph[scope][local]); cx, cy = _center(obj)
        obj_identity.append(h_id[object_context[len(objects)-1]])
        obj_geometry.append([cx, cy, dx, dy])
    n = len(objects)
    if n == 0:
        raise ValueError("NO_SOURCE_OBJECTS")
    current = sum(s[0] == record["exampleId"] for s in selected)
    relation_rows = []
    for left in range(current):
        for right in range(n):
            if left == right:
                continue
            l, r = selected[left], selected[right]
            lx, ly = _center(l[2]); rx, ry = _center(r[2])
            same = l[0] == r[0]
            lp, ls, lo = source_order(l[3]); rp, rs, ro = source_order(r[3])
            relative_order = order_lookup[r[0]] - order_lookup[l[0]]
            f = [rx-lx, ry-ly, abs(rx-lx), abs(ry-ly), float(same), np.clip(relative_order/4,-1,1),
                 float(l[2].get("kind")=="notehead"), float(r[2].get("kind")=="notehead"),
                 float(l[2].get("kind")=="rest"), float(r[2].get("kind")=="rest"), float(lp==rp), float(lp==rp and ls==rs)]
            relation_rows.append((left, right, np.array(f, dtype=np.float32)))
    relation_rows.sort(key=lambda r: (not bool(r[2][4]), abs(r[2][5]), r[2][2]+r[2][3], r[0], r[1]))
    omitted_relations = max(0, len(relation_rows) - config.max_relations)
    relation_rows = relation_rows[:config.max_relations]
    total_objects = sum(len(r["input"]["modelInput"].get("physicalObjects", [])) for r in window)
    tensor = lambda x, dtype=torch.float32: torch.tensor(np.asarray(x), dtype=dtype)
    sample = {
        "images": torch.stack(views), "view_mask": torch.ones(len(views), dtype=torch.bool),
        "object_features": tensor(objects), "graph_features": tensor(obj_graph),
        "source_features": tensor(record["input"]["sourceTensor"]),
        "object_boxes": tensor(boxes), "object_view": tensor(obj_views, torch.long),
        "object_mask": torch.ones(n, dtype=torch.bool), "object_context": tensor(object_context, torch.long),
        "hierarchy_boxes": tensor(h_boxes), "hierarchy_view": tensor(h_views, torch.long),
        "hierarchy_type": tensor(h_types, torch.long), "hierarchy_mask": torch.ones(len(h_boxes), dtype=torch.bool),
        "token_geometry": tensor(obj_geometry+h_geometry), "token_identity": tensor(obj_identity+h_id, torch.long),
        "token_parent": tensor([n+p for p in object_context]+[n+p if p>=0 else -1 for p in h_parent], torch.long),
        "relation_index": tensor([[l,r] for l,r,_ in relation_rows], torch.long).reshape(-1,2),
        "relation_features": tensor([f for _,_,f in relation_rows]).reshape(-1,12),
        "relation_mask": torch.ones(len(relation_rows), dtype=torch.bool),
        "metadata": {"input_version": INPUT_VERSION, "example_id": record["exampleId"], "score_id": record["scoreId"],
                     "split": record["split"], "page": source_order(record)[0], "current_objects": current,
                     "truncated_objects": total_objects-n, "omitted_relations": omitted_relations,
                     "proposal_completeness": "UNQUALIFIED", "views": [list(k) for k in view_keys],
                     "object_ids": [f"{s}:{i}" for s,i,_,_ in selected],
                     "object_source_regions": [{"page":source_order(row)[0],"box":[_bounds(obj)[0],_bounds(obj)[2],_bounds(obj)[1],_bounds(obj)[3]]}
                                               for _,_,obj,row in selected],
                     "source_to_view": [m.tolist() for m in transforms], "view_to_source": [m.tolist() for m in inverse],
                     "graph_audit": graph_audit, "scope_node_ids": {r["exampleId"]: nodes[("measure", r["exampleId"])] for r in window}},
    }
    return sample, selected, lookup, relation_rows, nodes


def attach_targets(sample, record, selected, lookup, relations, nodes):
    """Target-only adapter. Metadata may record coverage but cannot enter features."""
    targets = _make_targets(record, selected, lookup, relations)
    reasons = Counter()
    conflicting = {}
    for family in ("DURATION", "REST"):
        for label in record["target"]["families"][family]:
            if label.get("state") != "KNOWN" or len(label.get("objectIndexes",[])) != 1:
                continue
            i=lookup.get((record["exampleId"],label["objectIndexes"][0]))
            if i is None: continue
            value=label.get("value") or {}
            for head,v in _duration_values(value).items():
                group="regression" if head=="duration_quarters" else "object"
                conflicting.setdefault((group,head,i),set()).add(v)
            if value.get("writtenType") not in ("maxima","long","breve","whole","half","quarter","eighth","16th","32nd","64th","128th","256th"):
                targets["object"]["duration_type"]["mask"][i]=False
                reasons["unsupported_duration_type"]+=1
            if not isinstance(value.get("dots",0),int) or not 0<=value.get("dots",0)<=3:
                targets["object"]["duration_dots"]["mask"][i]=False
                reasons["unsupported_dots"]+=1
    for (group,head,i),values in conflicting.items():
        if len(values)>1:
            targets[group][head]["mask"][i]=False
            reasons["conflicting_"+head]+=1
    # Mask invalid/out-of-vocabulary or contradictory fields instead of clamping
    # them into a valid class. V1-compatible object/relation labels are retained.
    for label in record["target"]["families"]["PITCH_STAFF"]:
        if label.get("state") != "KNOWN":
            continue
        value = label.get("value") or {}
        written = value.get("writtenPitch") or {}
        position = value.get("staffPosition") or {}
        checks = {"pitch_written_step": written.get("step") in "CDEFGAB" if isinstance(written.get("step"),str) else False,
                  "pitch_octave": isinstance(written.get("octave"), int) and 0 <= written["octave"] <= 10,
                  "pitch_staff_step": position.get("state", "KNOWN") == "KNOWN" and position.get("stepsFromBandCenter") is not None and -16 <= position["stepsFromBandCenter"] <= 16,
                  "pitch_staff": value.get("staff") in (1,2,3)}
        for local in label.get("objectIndexes", []):
            i = lookup.get((record["exampleId"],local))
            if i is not None:
                for head, valid in checks.items():
                    if not valid:
                        targets["object"][head]["mask"][i] = False
                        reasons["invalid_"+head] += 1
    h = len(sample["hierarchy_mask"])
    targets["context"] = {head: {"target": np.full(h,-1,dtype=np.int64), "mask": np.zeros(h,dtype=bool)} for head in CONTEXT_CLASSES}
    votes = {}
    for scope, local, obj, row in selected:
        if scope != record["exampleId"]:
            continue
        for label in row["target"]["families"]["PITCH_STAFF"]:
            if label.get("state") != "KNOWN" or label.get("objectIndexes") != [local]:
                continue
            value = label.get("value") or {}
            # Context target is assigned by annotated staff, not the source's
            # nearest-band guess (cross-staff notes can disagree with that guess).
            staff = value.get("staff")
            if staff not in (1,2,3):
                continue
            node = nodes.get(("context", scope, staff-1))
            if node is None:
                continue
            key = (value.get("accidentalState") or {}).get("keyContext") or {}
            clef = value.get("clefContext") or {}
            if isinstance(key.get("fifths"),int) and -7 <= key["fifths"] <= 7:
                votes.setdefault(("key_fifths",node),set()).add(key["fifths"]+7)
            if clef.get("state") == "KNOWN":
                c = clef.get("value") or {}
                entries = {"clef": CLEFS.get(c.get("sign")), "clef_line": c.get("line"),
                           "clef_octave": c.get("octaveChange",0)+2}
                for head, v in entries.items():
                    if isinstance(v,int) and 0 <= v < CONTEXT_CLASSES[head]:
                        votes.setdefault((head,node),set()).add(v)
    for (head,node), values in votes.items():
        if len(values) == 1:
            targets["context"][head]["target"][node] = next(iter(values))
            targets["context"][head]["mask"][node] = True
        else:
            reasons["conflicting_"+head] += 1
    targets.pop("scope",None); targets.pop("local_count",None)
    sample["targets"] = {g:{head:{k:torch.from_numpy(np.asarray(v)) for k,v in p.items()} for head,p in group.items()} for g,group in targets.items()}
    sample["metadata"]["target_mask_reasons"] = dict(reasons)
    sample["metadata"]["availability"] = record["target"]["availability"]
    sample["metadata"]["unsupervised_capabilities"] = ["meter", "semantic_role_expansion", "proposal_recall"]
    return sample


def tensorize(record, records, resolver, config):
    sample, selected, lookup, relations, nodes = build_inputs(record, records, resolver, config)
    return attach_targets(sample, record, selected, lookup, relations, nodes)


def collate(samples):
    if not samples:
        raise ValueError("Empty batch")
    sizes = {"object":max(len(s["object_mask"]) for s in samples),
             "hierarchy":max(len(s["hierarchy_mask"]) for s in samples),
             "relation":max(1,max(len(s["relation_mask"]) for s in samples)),
             "view":max(len(s["view_mask"]) for s in samples)}
    result = {"metadata":[s["metadata"] for s in samples]}
    for key in samples[0]:
        if key in {"metadata","targets"} or key.startswith("token_") or key.startswith("notation_"):
            continue
        if key == "source_features":
            result[key] = torch.stack([s[key] for s in samples]); continue
        group = "view" if key == "images" else key.split("_")[0]
        if group == "graph": group = "object"
        values = []
        for s in samples:
            value = s[key]
            padded = value.new_full((sizes[group],)+value.shape[1:],1 if key=="images" else 0)
            padded[:len(value)] = value
            values.append(padded)
        result[key] = torch.stack(values)
    for key in ("token_geometry","token_identity","token_parent"):
        values = []
        for s in samples:
            n = len(s["object_mask"]); h = len(s["hierarchy_mask"])
            v = s[key].clone()
            if key == "token_parent": v[v >= n] += sizes["object"]-n
            value = v.new_full((sizes["object"]+sizes["hierarchy"],)+v.shape[1:], -1 if key!="token_geometry" else 0)
            value[:n] = v[:n]; value[sizes["object"]:sizes["object"]+h] = v[n:]
            values.append(value)
        result[key] = torch.stack(values)
    if "targets" in samples[0]:
        result["targets"] = {}
        for group, heads in samples[0]["targets"].items():
            if group=="notation": continue
            size = sizes["hierarchy" if group=="context" else "object" if group=="regression" else group]
            result["targets"][group] = {}
            for head in heads:
                parts = {}
                for key in ("target","mask"):
                    parts[key] = torch.stack([torch.cat((s["targets"][group][head][key],s["targets"][group][head][key].new_full((size-len(s["targets"][group][head][key]),),False if key=="mask" else -1))) for s in samples])
                result["targets"][group][head] = parts
    if any("notation_tokens" in s for s in samples):
        regions=max(1,max(len(s.get("notation_mask",[])) for s in samples))
        length=max(s.get("notation_tokens",torch.zeros(1,1)).shape[-1] for s in samples)
        result["notation_tokens"]=torch.zeros(len(samples),regions,length,dtype=torch.long)
        result["notation_tokens"][:,:,0]=1  # BOS keeps padded decoder rows finite.
        result["notation_boxes"]=torch.zeros(len(samples),regions,4)
        result["notation_view"]=torch.zeros(len(samples),regions,dtype=torch.long)
        result["notation_mask"]=torch.zeros(len(samples),regions,dtype=torch.bool)
        target=torch.full((len(samples),regions,length),-1,dtype=torch.long)
        target_mask=torch.zeros_like(target,dtype=torch.bool)
        for i,s in enumerate(samples):
            if "notation_tokens" not in s: continue
            r,l=s["notation_tokens"].shape
            result["notation_tokens"][i,:r,:l]=s["notation_tokens"]
            for key in ("notation_boxes","notation_view","notation_mask"):
                result[key][i,:r]=s[key]
            target[i,:r,:l]=s["targets"]["notation"]["target"]
            target_mask[i,:r,:l]=s["targets"]["notation"]["mask"]
        result.setdefault("targets",{})["notation"]={"target":target,"mask":target_mask}
    return result


def attach_notation_sidecar(sample,sidecar,record,resolver,config,max_tokens=4096):
    """Optional immutable supplementary supervision; existing shards stay intact.

    Regions are provided by a source detector/human visual annotation, not by XML
    symbol-class lookup at inference. Oracle-region training is identified in the
    sidecar and never reported as proposal-qualified recognition.
    """
    from copy import deepcopy
    from .notation import NotationCodec,NotationNode
    # Return a separate sample. Failed validation must not partially append
    # views or target metadata to the caller's original record.
    sample={**sample,"metadata":deepcopy(sample["metadata"]),"targets":dict(sample["targets"])}
    if sidecar.get("schema_version")!="notation-supervision/2.0": raise ValueError("Invalid notation sidecar version")
    if sidecar.get("split") not in {"train","validation"} or any(sidecar.get(k)!=record.get(v) for k,v in
        (("score_id","scoreId"),("example_id","exampleId"),("split","split"))):
        raise PermissionError("Notation sidecar identity/split mismatch")
    if not sidecar.get("alignment_validated") or not sidecar.get("source_pixel_digest"):
        raise ValueError("Notation sidecar alignment/pixel identity unqualified")
    page=resolver.page(record)
    pixel_digest=hashlib.sha256(np.asarray(page,dtype=np.uint8).tobytes()).hexdigest()
    if pixel_digest!=sidecar["source_pixel_digest"]: raise ValueError("Notation sidecar pixel digest mismatch")
    rows=sidecar.get("regions",[])
    if len(rows)>128: raise ValueError("NOTATION_REGION_CAPACITY")
    encoded=[];boxes=[];views=[]
    for row in rows:
        if row.get("state")!="KNOWN": continue
        node=NotationNode(**row["target"]).validate()
        if node.region is None or node.region["page"]!=source_order(record)[0]: raise ValueError("Notation region page mismatch")
        if row.get("region_origin") not in {"source-detector","human-visual"}: raise ValueError("Unknown notation region origin")
        source_region=row.get("source_region")
        if source_region!=node.region:
            raise ValueError("Independent source region and aligned target disagree")
        box=source_region["box"]
        pixels,h,back=crop_view(page,box,config.image_height,config.image_width,pad=.15)
        view=len(sample["images"])
        sample["images"]=torch.cat((sample["images"],pixels[None]),0)
        sample["view_mask"]=torch.cat((sample["view_mask"],torch.ones(1,dtype=torch.bool)))
        sample["metadata"]["source_to_view"].append(h.tolist());sample["metadata"]["view_to_source"].append(back.tolist())
        sample["metadata"]["views"].append(["notation",node.id])
        encoded.append(NotationCodec.encode_supervision(node,max_length=max_tokens))
        boxes.append(map_box(box,h));views.append(view)
    if not encoded:return sample
    length=max(map(len,encoded))-1
    tokens=torch.zeros(len(encoded),length,dtype=torch.long);target=torch.full_like(tokens,-1);mask=torch.zeros_like(tokens,dtype=torch.bool)
    for i,sequence in enumerate(encoded):
        n=len(sequence)-1;tokens[i,:n]=torch.tensor(sequence[:-1]);target[i,:n]=torch.tensor(sequence[1:]);mask[i,:n]=True
    sample.update(notation_tokens=tokens,notation_boxes=torch.tensor(np.asarray(boxes)),
                  notation_view=torch.tensor(views,dtype=torch.long),notation_mask=torch.ones(len(encoded),dtype=torch.bool))
    sample["targets"]["notation"]={"target":target,"mask":mask}
    sample["metadata"]["notation_sidecar_digest"]=hashlib.sha256(json.dumps(sidecar,sort_keys=True).encode()).hexdigest()
    sample["metadata"]["notation_proposal_qualified"]=False
    return sample
