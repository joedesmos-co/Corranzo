"""Phase A0/A1 - what does the `accidental` target actually mean?

The G5 report calls the accidental head the binding component. Before acting on
that, the target must be pinned down, because `accidental` is easy to
mis-describe as "recognise the printed accidental glyph".

`align_objects.build_targets` writes:

    "accidentalState": {"printed": event.alter, "writtenAlter": event.alter, ...}
    "keyContext": {"fifths": measure.key_fifths, ...}

and `musicxml_truth` fills `event.alter` straight from MusicXML
`<pitch><alter>`. In MusicXML that element is the EFFECTIVE alteration that
turns the step into the sounding pitch - it is set for key-signature notes even
when there is no printed `<accidental>` element at all.

If that is what the head is being asked to predict, this is a pitch-class /
semantic task, not a glyph task, and the "accidental-glyph bottleneck" framing
would be wrong. This script decides it by measurement:

  * the exact class vocabulary and its distribution
  * the confusion matrix of the current accidental head
  * per-class precision / recall / F1
  * cross-tabulation against the key signature
  * the accuracy of a PURE RULE (fifths + printed accidental element), which is
    the ceiling any glyph-free semantic model could reach
  * stratification by accidental source
"""
from __future__ import annotations

import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import phase_f_cache as CACHE  # noqa: E402
from phase_g5a_metrics import evaluate  # noqa: E402
from v26_adapter import ADAPTED_PITCH_HEADS, PITCH_HEAD_SIZES  # noqa: E402

# pitch_accidental = max(0, min(6, alter + 3)), so class == alter + 3.
CLASSES = {0: "alter-3", 1: "double-flat(-2)", 2: "FLAT(-1)", 3: "NATURAL(0)",
           4: "SHARP(+1)", 5: "double-sharp(+2)", 6: "alter+3"}
OFF = np.cumsum([0] + [PITCH_HEAD_SIZES[h] for h in ADAPTED_PITCH_HEADS])
J = {"step": 1, "oct": 2, "acc": 3}


def accidental_logits(d):
    j = ADAPTED_PITCH_HEADS.index("pitch_accidental")
    return d["logits"][..., OFF[j]:OFF[j + 1]]


def musicxml_facts(sid, split):
    """Per (example, objectIndex): the raw MusicXML accidental evidence.

    Reads the paired source directly, so the target can be compared with what a
    reader of the score would see: the key signature in force, and whether an
    <accidental> element is actually printed on the note.
    """
    sys.path.insert(0, str(H.V26_ROOT / "tools/real-pdf-adaptation"))
    root = H.V26_ROOT / "public/fixtures"
    # the split manifest maps score id -> (pdf, musicxml)
    doc = json.loads((H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())
    entry = next((s for s in doc["scores"] if s["id"] == sid), None)
    if entry is None:
        return {}
    mpath = root.parent / entry["musicxml"] if entry["musicxml"].startswith("public") \
        else H.V26_ROOT / entry["musicxml"]
    if not mpath.exists():
        return {}
    try:
        if mpath.suffix == ".mxl":
            z = zipfile.ZipFile(mpath)
            nm = [x for x in z.namelist()
                  if x.endswith((".xml", ".musicxml")) and "META" not in x.upper()][0]
            tree = ET.fromstring(z.read(nm))
        else:
            tree = ET.parse(mpath).getroot()
    except Exception:
        return {}
    part = tree.find("part")
    measures = part.findall("measure") if part is not None else []
    per_measure = []
    for mi, meas in enumerate(measures):
        fifths = meas.findtext("attributes/key/fifths")
        key = int(fifths) if fifths and fifths.strip() else None
        notes = []
        for nd in meas.findall("note"):
            pit = nd.find("pitch")
            if pit is None:
                continue
            acc_el = nd.find("accidental")
            notes.append({
                "step": pit.findtext("step"),
                "alter": pit.findtext("alter"),
                "octave": pit.findtext("octave"),
                "printed_accidental": (acc_el.get("accidental")
                                       if acc_el is not None else None),
                "staff": nd.findtext("staff"),
                "voice": nd.findtext("voice")})
        per_measure.append({"measure_index": mi, "fifths": key, "notes": notes})
    return {sid: per_measure}


def key_alter(fifths, step):
    """The alteration the key signature alone applies to this step."""
    if fifths is None:
        return 0
    sharp_order = "FCGDAEB"
    flat_order = "BEADGCF"
    s = (step or "").upper()
    if fifths > 0 and s in sharp_order[:fifths]:
        return 1
    if fifths < 0 and s in flat_order[:-fifths]:
        return -1
    return 0


def main():
    d = CACHE.load()
    logits = torch.tensor(d["logits"].astype(np.float32))
    ev = evaluate(logits, d["target"], d["mask"], d["object_mask"])
    m = ev["m"]
    N = int(m.sum())

    flat = m.reshape(-1)
    pred = ev["p_acc"].reshape(-1)[flat]
    true = ev["t_acc"].reshape(-1)[flat]
    # (record, object) coordinates of every scored row, for the source audit
    R, Nobj = m.shape
    rr, cc = np.where(m)
    coords = list(zip(rr.tolist(), cc.tolist()))

    # ---- vocabulary and distribution ----
    dist = Counter(true.tolist())
    print("=== A0 accidental target vocabulary (N=%d) ===" % N)
    for c in sorted(dist):
        print("  class %d %-18s n=%-5d %.4f" % (c, CLASSES.get(c, "?"),
                                                 dist[c], dist[c] / N))
    print("  -> the target is an ALTERATION (-2..+2 mapped to 0..4), not a glyph")

    # ---- confusion matrix of the frozen head ----
    cm = np.zeros((7, 7), np.int64)
    for p_, t_ in zip(pred.tolist(), true.tolist()):
        cm[t_, p_] += 1
    print("\n=== A1 confusion matrix (rows=true, cols=pred) ===")
    print("        " + "".join("%7d" % c for c in range(7)))
    for t in range(7):
        if cm[t].sum() == 0:
            continue
        print("  true %d " % t + "".join("%7d" % v for v in cm[t]))
    print("\n  per-class:")
    for c in range(7):
        n = cm[c].sum()
        if n == 0:
            continue
        prec = cm[c, c] / max(1, cm[:, c].sum())
        rec = cm[c, c] / n
        f1 = 2 * prec * rec / max(1e-9, prec + rec)
        print("   class %d %-18s N=%-5d P=%.4f R=%.4f F1=%.4f"
              % (c, CLASSES.get(c, "?"), n, prec, rec, f1))

    # ---- accidental accuracy overall + majority ----
    acc = float((pred == true).mean())
    maj = max(dist.values()) / N
    print("\n  P(accidental) = %.4f   majority baseline = %.4f (class %d)"
          % (acc, maj, dist.most_common(1)[0][0]))

    # ---- A0 semantics: is the target a key-signature + printed-glyph product? ----
    facts = {}
    for s in sorted(set(d["score"].tolist())):
        facts.update(musicxml_facts(s, ""))
    print("\n=== A0 semantics check ===")
    print("  scores with MusicXML readable: %d of %d"
          % (len(facts), len(set(d["score"].tolist()))))
    hit_key_only = tot = 0
    hit_key_or_printed = tot2 = 0
    printed_present = 0
    agree_key = Counter()
    for (r, o) in coords:
        sid = str(d["score"][r])
        pm = facts.get(sid)
        if pm is None:
            continue
        obj_notes = pm[0]["notes"] if pm else []
        if o >= len(obj_notes):
            continue
        note = obj_notes[o]
        ta = note["alter"]
        ta = int(float(ta)) if ta not in (None, "") else 0
        cls = ta + 3
        tot += 1
        ka = key_alter(pm[0]["fifths"], note["step"])
        hit_key_only += (ka + 3 == cls)
        pa = note["printed_accidental"]
        if pa:
            printed_present += 1
        pv = {"sharp": 1, "flat": -1, "natural": 0,
              "sharp-sharp": 2, "flat-flat": -2,
              "double-sharp": 2, "double-flat": -2}.get(pa)
        eff = pv if pv is not None else ka
        hit_key_or_printed += (eff + 3 == cls)
        agree_key[(ka + 3, cls)] += 1
    if tot:
        print("  matched objects: %d" % tot)
        print("  rule 'key signature alone'      accuracy: %.4f"
              % (hit_key_only / tot))
        print("  rule 'key or printed glyph'    accuracy: %.4f"
              % (hit_key_or_printed / tot))
        print("  objects with a printed <accidental> element: %d (%.4f)"
              % (printed_present, printed_present / tot))
        print("  model on the same rows: %.4f" % acc)
    out = {"N": N, "vocabulary": CLASSES,
           "class_distribution": {int(k): int(v) for k, v in dist.items()},
           "P_accidental_frozen_head": round(acc, 6),
           "majority_baseline": round(maj, 6),
           "confusion_matrix": cm.tolist(),
           "semantics": {"rule_key_signature_only": hit_key_only / tot if tot else None,
                         "rule_key_or_printed": hit_key_or_printed / tot if tot else None,
                         "objects_with_printed_accidental": printed_present,
                         "matched_objects": tot}}
    p = H.write_json("phase_a0_accidental_target.json", out)
    print("\nwrote", p)


if __name__ == "__main__":
    main()
