"""Phase G3 - the staff-anchored high-resolution ROI.

The ONE live architecture hypothesis left after Phases F and G: the champion's
frozen object embedding is spatially under-resolved for pitch. It is a 3x3
bilinear sample of a 3x-expanded object box - fewer samples than the five staff
lines the head must resolve - so the staff structure that determines pitch is
never resolved.

This builds the candidate replacement as a CROP, with no target-derived
geometry and no score identity:

  origin       the notehead's own staff band centre, projected along the STAFF
               axis, so the crop is anchored to the staff rather than to the
               measure scope (the scope height is what broke object_features
               10..11)
  scale        the band's OWN detected five-line gap (corpus/2.1)
  extent       a fixed field of view in staff-space units, identical for every
               object, so the tensor size never carries information
  content      all five staff lines, ledger lines, and enough horizontal
               context for the accidental and chord relation

The whole V2.5 model stays frozen. Only this small encoder and the pitch
readout train.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
from piano_vision.v2.data import build_inputs, attach_targets, collate, _center  # noqa: E402
from piano_vision.v25.data import attach_object_page_geo  # noqa: E402
from piano_vision.v25.performance import prepare_batch  # noqa: E402

# Field of view in staff spaces. 12.0 tall comfortably contains a 5-line staff
# (4 spaces) plus 4 spaces of ledger room either side; 7.0 wide carries the
# accidental and neighbouring chord tone.
FOV_W_SPACES = 7.0
FOV_H_SPACES = 12.0
CURRENT = None


def staff_of(obj, bands):
    if not bands:
        return None
    cy = _center(obj)[1]
    return min(bands, key=lambda b: abs(cy - (float(b["y0"]) + float(b["y1"])) / 2))


def crop(page, obj, bands, px_per_space, shift_spaces=0.0, wrong_staff=False):
    """Staff-anchored crop, optionally perturbed for the causal ablation.

    shift_spaces   translate vertically, in staff spaces, before sampling
    wrong_staff    anchor to the OTHER band instead of the assigned one
    """
    if len(bands) < 2 and not wrong_staff:
        return None
    band = staff_of(obj, bands)
    if band is None:
        return None
    if wrong_staff and len(bands) >= 2:
        other = [b for b in bands if b is not band]
        band = other[0] if other else band
    pw, ph = page.size
    gap = (float(band["y1"]) - float(band["y0"])) / 4.0
    if gap <= 1e-9:
        return None
    centre = (float(band["y0"]) + float(band["y1"])) / 2
    # The notehead's offset from the band centre, in staff spaces. The crop is
    # centred on the BAND, not the notehead, so the notehead's vertical position
    # inside the tensor is exactly the quantity pitch depends on.
    cy = _center(obj)[1]
    offset_spaces = (centre - cy) / gap
    cx = _center(obj)[0]
    w = FOV_W_SPACES * gap
    h = FOV_H_SPACES * gap
    x0 = int(round((cx - w / 2) * pw)); x1 = int(round((cx + w / 2) * pw))
    y0 = int(round((centre - shift_spaces * gap - h / 2) * ph))
    y1 = int(round((centre - shift_spaces * gap + h / 2) * ph))
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    # pad by edge replication so a boundary crop does not shift the tensor
    im = page.crop((x0, y0, x1, y1))
    out = (int(round(FOV_W_SPACES * px_per_space)),
           int(round(FOV_H_SPACES * px_per_space)))
    im = im.resize(out, Image.Resampling.BILINEAR)
    a = np.asarray(im.convert("L"), dtype=np.float32) / 255.0
    return a, float(offset_spaces)


def build(density, tag, max_records=60, limit=10 ** 9):
    groups = H.realpdf_scores("adaptation") + H.realpdf_scores("validation") \
        + H.realpdf_scores("heldout-test") + H.realpdf_scores("diagnostic")
    rois, ks, scores, ys, keys = [], [], [], [], []
    for sid, ordered in groups:
        resolver = H.realpdf_resolver()
        for rec in ordered[:max_records]:
            if len(rois) >= limit:
                break
            try:
                page = resolver.page(rec)
                sample, selected, lookup, relations, nodes = build_inputs(
                    rec, ordered, resolver, CURRENT)
                sample = attach_targets(sample, rec, selected, lookup, relations, nodes)
                sample = attach_object_page_geo(sample, selected)
                batch = prepare_batch(collate([sample]), consistency=False)
            except Exception:
                continue
            m = rec["input"]["modelInput"]
            bands = m.get("geometry", {}).get("staffBands", {}).get("staffBands", [])
            t = batch["targets"]["object"]
            n_obj = int(t["pitch_staff_step"]["mask"][0].shape[0])
            lab = {}
            for L in rec["target"]["families"].get("PITCH_STAFF", []):
                if L.get("state") != "KNOWN" or not L.get("isPositive"):
                    continue
                for ix in (L.get("objectIndexes") or []):
                    lab[ix] = L
            for i, obj in enumerate(m.get("physicalObjects", [])):
                if obj.get("kind") != "notehead" or i >= n_obj or i not in lab:
                    continue
                if not bool(t["pitch_written_step"]["mask"][0][i].item()):
                    continue
                r = crop(page, obj, bands, density)
                if r is None:
                    continue
                a, off = r
                ts = int(t["pitch_written_step"]["target"][0][i].item())
                to = int(t["pitch_octave"]["target"][0][i].item())
                ta = int(t["pitch_accidental"]["target"][0][i].item())
                if ts < 0 or to < 0 or ta < 0:
                    continue
                rois.append(a[None].astype(np.float16))
                ks.append(off)
                scores.append(sid)
                ys.append([ts, to, ta])
                keys.append((rec["exampleId"], i))
    d = {"roi": np.concatenate(rois, 0), "k": np.asarray(ks, np.float32),
         "score": np.asarray(scores), "y": np.asarray(ys, np.int64),
         # join key back to the frozen-embedding cache: (exampleId, objectSlot)
         "example": np.asarray([x[0] for x in keys]),
         "obj": np.asarray([x[1] for x in keys], np.int64)}
    np.savez_compressed(H.V26_ROOT / f"out/roi21_d{int(density)}.npz", **d)
    return d


if __name__ == "__main__":
    CURRENT = H.load_runtime("cpu").config
    for dens in (4, 8, 16):
        d = build(dens, f"d{dens}")
        print(f"density {dens} px/space -> roi {d['roi'].shape}", flush=True)
