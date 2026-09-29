"""Phase F - cache the frozen champion's pitch-path state, once.

The adapter is the ONLY thing that will ever train, so the frozen model's
contribution to every training and evaluation batch is computed once, in eval
mode, with gradients disabled, and cached. This makes "only the adapter trains"
a structural property of the experiment rather than a claim in a config file,
and it makes the LOSO protocol cheap enough to run many ablations on CPU.

Cached per record:
  * final_norm(embedding)  - exactly what the frozen heads read, so the adapter
    consumes the same representation the model itself uses
  * the frozen logits of the five adapted pitch heads
  * targets and masks for those heads
  * the staff-relative feature matrix (v26_staff)
  * object mask, score id, engraving, campaign split
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import v26_staff as S  # noqa: E402
from v26_adapter import ADAPTED_PITCH_HEADS  # noqa: E402

H.add_runtime_to_path()
from piano_vision.v2.data import build_inputs, attach_targets, collate  # noqa: E402
from piano_vision.v25.data import attach_object_page_geo  # noqa: E402
from piano_vision.v25.performance import prepare_batch  # noqa: E402

CACHE = H.V26_ROOT / "out/phase_f_cache.npz"
META = H.V26_ROOT / "out/phase_f_cache_meta.json"


def build():
    runtime = H.load_runtime("cpu")
    model = runtime.model
    index = json.loads(H.REALPDF_INDEX.read_text())
    split_doc = json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())
    eng = {s["id"]: s.get("engraving") for s in split_doc["scores"]}

    rows = []
    for score in index["scores"]:
        sid, split = score["score_id"], score["split"]
        records = H.realpdf_scores(split)
        ordered = next((o for s, o in records if s == sid), None)
        if ordered is None:
            continue
        resolver = H.realpdf_resolver()
        for rec in ordered:
            try:
                sample, selected, lookup, relations, nodes = build_inputs(
                    rec, ordered, resolver, runtime.config)
                sample = attach_targets(sample, rec, selected, lookup, relations, nodes)
                sample = attach_object_page_geo(sample, selected)
                batch = prepare_batch(collate([sample]), consistency=False)
                feats = S.features_for_record(rec, int(batch["object_mask"].shape[1]))
                if feats is None:
                    continue
                batch = runtime._to_device(batch)
                with torch.inference_mode():
                    out = model(batch, decode_notation=False, return_memory=True)
            except Exception:
                continue
            emb = model.final_norm(out["embeddings"]["object"])[0].float()
            mask = batch["object_mask"][0].cpu().numpy()
            logits = np.concatenate(
                [out["object"][h][0].float().cpu().numpy() for h in ADAPTED_PITCH_HEADS], -1)
            tgt = np.stack(
                [batch["targets"]["object"][h]["target"][0].cpu().numpy()
                 for h in ADAPTED_PITCH_HEADS], -1)
            msk = np.stack(
                [batch["targets"]["object"][h]["mask"][0].cpu().numpy()
                 for h in ADAPTED_PITCH_HEADS], -1)
            rows.append({
                "emb": emb.numpy().astype(np.float16),
                "logits": logits.astype(np.float16),
                "target": tgt.astype(np.int16),
                "mask": msk,
                "staff": np.asarray(feats, np.float32),
                "object_mask": mask,
                "score": sid, "split": split, "engraving": eng.get(sid),
                "example": rec["exampleId"]})
    print(f"cached {len(rows)} records", flush=True)
    # Records carry different object counts; pad to a common N and rely on
    # object_mask / head mask to exclude the padding everywhere downstream.
    N = max(int(r["object_mask"].shape[0]) for r in rows)
    D = rows[0]["emb"].shape[1]
    C = rows[0]["logits"].shape[1]
    T = rows[0]["target"].shape[1]
    F = rows[0]["staff"].shape[1]

    def pad(arr, width, fill=0.0, dtype=np.float32):
        out = np.full((N, width), fill, dtype)
        n = arr.shape[0]
        out[:n] = arr.astype(dtype)
        return out

    emb = np.stack([pad(r["emb"], D, 0.0, np.float16) for r in rows])
    logits = np.stack([pad(r["logits"], C, 0.0, np.float16) for r in rows])
    target = np.stack([pad(r["target"], T, -1, np.int16) for r in rows])
    mask = np.stack([pad(r["mask"], T, 0, bool) for r in rows])
    staff = np.stack([pad(r["staff"], F, 0.0, np.float32) for r in rows])
    om = np.zeros((len(rows), N), bool)
    for i, r in enumerate(rows):
        om[i, :int(r["object_mask"].shape[0])] = r["object_mask"]
    object_mask = om
    np.savez_compressed(
        CACHE,
        emb=emb, logits=logits, target=target, mask=mask,
        staff=staff, object_mask=object_mask,
        n_objects=np.asarray([int(r["object_mask"].shape[0]) for r in rows]),
        score=np.asarray([r["score"] for r in rows]),
        split=np.asarray([r["split"] for r in rows]),
        engraving=np.asarray([r["engraving"] or "?" for r in rows]),
        example=np.asarray([r["example"] for r in rows]))
    META.write_text(json.dumps(
        {"records": len(rows), "adapted_heads": list(ADAPTED_PITCH_HEADS),
         "checkpoint": str(H.CHECKPOINT), "checkpoint_sha256": rt_sha(runtime)},
        indent=2))
    return rows


def rt_sha(runtime):
    import hashlib
    with open(H.CHECKPOINT, "rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def load():
    d = dict(np.load(CACHE, allow_pickle=True))
    return d


if __name__ == "__main__":
    build()
    d = load()
    print({k: v.shape for k, v in d.items()})
