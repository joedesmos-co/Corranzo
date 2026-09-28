"""V2.5 supervision adapters. All additive; V2 samples stay intact.

- event targets derive from existing ATTACK/CHORD relation labels only.
- pointer targets resolve a sidecar region owner only under a conservative
  uniqueness contract; anything else stays masked with a recorded reason.
- page-space geometry tensors are source-only (physical boxes, sidecar
  source regions); they never carry target semantics.
"""
import torch
import numpy as np

from ..data import _center
from ..v2.data import source_order

NULL_SENTINEL = -2


def attach_object_page_geo(sample, selected):
    """Per-object page-space geometry [cx, cy, page]. Source-only."""
    rows = []
    for scope, _local, obj, row in selected:
        cx, cy = _center(obj)
        rows.append([cx, cy, float(source_order(row)[0])])
    sample = dict(sample)
    sample["object_page_geo"] = torch.tensor(np.asarray(rows, dtype=np.float32))
    return sample


def attach_event_targets(sample):
    """Same-event supervision from ATTACK/CHORD relation labels.

    Positive when either head says grouped; negative when either safely says
    not grouped and neither says grouped; masked otherwise. Chord takes
    priority because chord tones share an onset by definition.
    """
    sample = dict(sample)
    sample["targets"] = dict(sample.get("targets", {}))
    rel = sample["targets"].get("relation", {})
    attack = rel.get("attack")
    chord = rel.get("chord")
    if attack is None and chord is None:
        return sample
    n = len(next(iter(rel.values()))["target"])
    target = torch.zeros(n, dtype=torch.float32)
    mask = torch.zeros(n, dtype=torch.bool)
    a_t = attack["target"] if attack is not None else torch.full((n,), -1)
    a_m = attack["mask"] if attack is not None else torch.zeros(n, dtype=torch.bool)
    c_t = chord["target"] if chord is not None else torch.full((n,), -1)
    c_m = chord["mask"] if chord is not None else torch.zeros(n, dtype=torch.bool)
    pos = ((a_m & (a_t == 1)) | (c_m & (c_t == 1)))
    neg = ~pos & ((a_m & (a_t == 0)) | (c_m & (c_t == 0)))
    target[pos] = 1.0
    mask[pos | neg] = True
    sample["targets"]["attachment"] = dict(sample["targets"].get("attachment", {}))
    sample["targets"]["attachment"]["event"] = {"target": target, "mask": mask}
    return sample


def attach_pointer_targets(sample, sidecar, record, selected, lookup):
    """Single-candidate region->object owner resolution.

    Row order matches v2.attach_notation_sidecar KNOWN order. A row is
    supervised only when the owner is provably unique WITHOUT any rank or
    XML-order assumption (note_index counts every <note> element per part
    -- rests, grace, cue and chord tones included -- so x-rank
    correspondence is NOT assumed):

      1. kind is a pitched-note-attached articulation (staccato, accent,
         tenuto, staccatissimo). Fermatas can sit on rests; dynamics,
         pedal, tempo and metronome marks are staff-level: always masked.
      2. the sidecar target carries an integer staff;
      3. the current scope contains EXACTLY ONE notehead whose KNOWN
         single PITCH_STAFF label equals that staff, KNOWN non-grace
         (DURATION), KNOWN single LANE whose part prefix matches the
         sidecar's MusicXML part (kills cross-part ambiguity);
      4. the region and the candidate share the source page.

    Otherwise the row is masked with a reason. note_index is recorded for
    analysis but never used as a target (D1 lesson). Coverage is reported
    in metadata; low coverage is an honest signal, not a failure.
    Residual limitation: cue notes have no supervision and could, in
    principle, coincide with a single-candidate texture; this is
    documented, not silently assumed away.
    """
    from collections import Counter
    PITCHED_OWNER_KINDS = {
        "attribute:staccato", "attribute:accent", "attribute:tenuto",
        "attribute:staccatissimo",
    }
    sample = dict(sample)
    sample["targets"] = dict(sample.get("targets", {}))
    rows = [r for r in sidecar.get("regions", []) if r.get("state") == "KNOWN"]
    page = source_order(record)[0]
    geo = []
    for r in rows:
        box = (r.get("source_region") or {}).get("box") or [0, 0, 1, 1]
        geo.append([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2, float(page)])
    sample["notation_region_geo"] = (torch.tensor(np.asarray(geo, dtype=np.float32))
                                     if geo else torch.zeros(0, 3))
    staff_of, grace_of, lane_of, lane_part = {}, {}, {}, {}
    multi = set()
    for label in record.get("target", {}).get("families", {}).get("PITCH_STAFF", []):
        if label.get("state") == "KNOWN" and len(label.get("objectIndexes", [])) == 1:
            i = lookup.get((record["exampleId"], label["objectIndexes"][0]))
            if i is not None:
                staff = (label.get("value") or {}).get("staff")
                if i in staff_of and staff_of[i] != staff:
                    multi.add(i)
                staff_of[i] = staff
    for label in record.get("target", {}).get("families", {}).get("DURATION", []):
        if label.get("state") == "KNOWN" and len(label.get("objectIndexes", [])) == 1:
            i = lookup.get((record["exampleId"], label["objectIndexes"][0]))
            if i is not None:
                grace_of[i] = bool((label.get("value") or {}).get("grace"))
    for label in record.get("target", {}).get("families", {}).get("LANE", []):
        if label.get("state") == "KNOWN" and len(label.get("objectIndexes", [])) == 1:
            i = lookup.get((record["exampleId"], label["objectIndexes"][0]))
            if i is None:
                continue
            role = str(((label.get("value") or {}).get("laneRole")) or "")
            if ":" not in role:
                multi.add(i)
                continue
            part, _ = role.split(":", 1)
            if i in lane_of and (lane_of[i], lane_part[i]) != (role, part):
                multi.add(i)
            lane_of[i], lane_part[i] = role, part
    current_noteheads = [(i, obj) for i, (scope, local, obj, _row) in enumerate(selected)
                         if scope == record["exampleId"] and obj.get("kind") == "notehead"]
    target = torch.full((len(rows),), NULL_SENTINEL, dtype=torch.long)
    mask = torch.zeros(len(rows), dtype=torch.bool)
    reasons = Counter()
    for r, row in enumerate(rows):
        node = row.get("target") or {}
        if node.get("type") not in PITCHED_OWNER_KINDS:
            reasons["not_note_attached_kind"] += 1
            continue
        attrs = node.get("attributes") or {}
        try:
            s = int(attrs.get("staff"))
        except (TypeError, ValueError):
            reasons["unresolvable_attributes"] += 1
            continue
        xml_part = None
        for prov in node.get("provenance") or []:
            if prov.get("source") == "musicxml" and prov.get("part"):
                xml_part = str(prov["part"])
                break
        cands = [i for i, _ in current_noteheads
                 if staff_of.get(i) == s and i not in multi
                 and i in grace_of and not grace_of[i]
                 and i in lane_of and (xml_part is None or lane_part.get(i) == xml_part)]
        if len(cands) != 1:
            reasons["staff_not_singleton"] += 1
            continue
        target[r] = cands[0]
        mask[r] = True
    sample["targets"]["attachment"] = dict(sample["targets"].get("attachment", {}))
    sample["targets"]["attachment"]["pointer"] = {"target": target, "mask": mask}
    meta = dict(sample.get("metadata", {}))
    meta["pointer_rows"] = len(rows)
    meta["pointer_supervised"] = int(mask.sum())
    meta["pointer_mask_reasons"] = dict(reasons)
    sample["metadata"] = meta
    return sample


def tensorize_v25(record, records, resolver, config):
    """Single-pass V2.5 materialization: build_inputs -> attach_targets ->
    event/page-geo adapters. Skips the retired ordinal adapters. Returns
    (sample, selected, lookup) so the trainer can attach sidecar-dependent
    pointer targets without re-running crops."""
    from ..v2.data import build_inputs, attach_targets
    sample, selected, lookup, relations, nodes = build_inputs(
        record, records, resolver, config)
    sample = attach_targets(sample, record, selected, lookup, relations, nodes)
    sample = attach_object_page_geo(sample, selected)
    sample = attach_event_targets(sample)
    return sample, selected, lookup


def collate_v25(samples):
    """v2.collate plus V2.5 extras: object_page_geo, notation_region_geo,
    targets.attachment.event (relation-keyed) and .pointer (region-keyed,
    null sentinel mapped to the batch null class)."""
    from ..v2.data import collate as collate_v2
    # v2.collate pads every targets["attachment"] head to the OBJECT size
    # (ordinal legacy). V2.5 attachment heads are heterogeneously keyed
    # (event=relation, pointer=region), so detach them first and pad here.
    stripped = []
    detached = []
    for s in samples:
        s = dict(s)
        targets = dict(s.get("targets", {}))
        detached.append(targets.pop("attachment", None))
        s["targets"] = targets
        stripped.append(s)
    result = collate_v2(stripped)
    n_obj = result["object_mask"].shape[1]
    pad_geo = torch.zeros(len(stripped), n_obj, 3)
    for i, s in enumerate(stripped):
        g = s.get("object_page_geo")
        if g is not None:
            pad_geo[i, :len(g)] = g
    result["object_page_geo"] = pad_geo
    if "notation_tokens" in result:
        regions = result["notation_tokens"].shape[1]
        reg_geo = torch.zeros(len(stripped), regions, 3)
        for i, s in enumerate(stripped):
            g = s.get("notation_region_geo")
            if g is not None and len(g):
                reg_geo[i, :len(g)] = g
        result["notation_region_geo"] = reg_geo
    attach = {}
    if any(detached):
        m_rel = result["relation_mask"].shape[1]
        evt_t = torch.zeros(len(stripped), m_rel)
        evt_m = torch.zeros(len(stripped), m_rel, dtype=torch.bool)
        for i, s in enumerate(stripped):
            payload = (detached[i] or {}).get("event")
            if payload is None:
                continue
            evt_t[i, :len(payload["target"])] = payload["target"].float()
            evt_m[i, :len(payload["target"])] = payload["mask"]
        attach["event"] = {"target": evt_t, "mask": evt_m}
    if "notation_tokens" in result:
        regions = result["notation_tokens"].shape[1]
        max_cur = 0
        for m in result["metadata"]:
            max_cur = max(max_cur, int(m.get("current_objects", 0)))
        ptr_t = torch.full((len(stripped), regions), max_cur, dtype=torch.long)
        ptr_m = torch.zeros(len(stripped), regions, dtype=torch.bool)
        for i, s in enumerate(stripped):
            payload = (detached[i] or {}).get("pointer")
            if payload is None:
                continue
            t = payload["target"]
            n = min(len(t), regions)
            mapped = t[:n].clone()
            mapped[mapped == NULL_SENTINEL] = max_cur
            ptr_t[i, :n] = mapped
            ptr_m[i, :n] = payload["mask"][:n]
        attach["pointer"] = {"target": ptr_t, "mask": ptr_m}
        result["pointer_null_class"] = max_cur
    if attach:
        result.setdefault("targets", {})["attachment"] = attach
    return result
