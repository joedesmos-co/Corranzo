#!/usr/bin/env python3
"""V2.5 real-PDF domain adaptation: short, conservative fine-tune from the
qualified step-2100 checkpoint, with original-data replay.

Why this is adaptation and not a restart
----------------------------------------
The qualified checkpoint's failure on rendered PDFs was measured to live in the
REPRESENTATION feeding the pitch head, not in the pitch head's weights. On
identical pixels and identical targets, replacing only the object box with the
production raster shape (1.0 x 1.5 staff spaces instead of the corpus
1.18 x 1.84) drops ``object.pitch_staff_step`` accuracy from 0.9661 to 0.6723,
and the production staff-band separation drops it to 0.7966; both together give
0.5763. So the region-sampling geometry path must move, which means the visual
trunk, ``visual_projection``, ``object_projection`` and ``geometry_projection``
all have to train. Freezing everything except the pitch head would leave the
crop misaligned and cannot work.

Parameter groups therefore split by how domain-sensitive each block is:

  visual   backbone + visual_projection + object_projection + geometry_projection
           -- reads the raster and the sampled box; this is the broken path.
  pitch    heads.object.pitch_* -- must move for the new geometry regime.
  heads    every other head and feedback projection -- already 0.96-0.99 on the
           original qualification; small LR to avoid forgetting.
  shared   event/pointer/object_memory/notation_bias/notation_decoder -- replay-
           only supervision, and none of it is on the pitch path.

Replay: every step mixes adaptation measures with examples drawn from the
ORIGINAL V2.5 training manifest, so the corpus distribution the checkpoint
earned its capability on never goes stale.

Selection: this trainer never writes a "best" checkpoint. It saves periodic
step checkpoints only. Checkpoint choice is made offline by
``evaluate_realpdf.py`` on the fixed held-out real-PDF and fixed original
qualification sets. Training-set accuracy is never a selection signal.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import sys
import time
from collections import Counter, OrderedDict
from pathlib import Path

import torch

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(REPO / "tools/piano-vision-v25-candidate"))

from piano_vision.v25.config import config_from_dict  # noqa: E402
from piano_vision.v25.data import collate_v25, tensorize_v25  # noqa: E402
from piano_vision.v25.loss import semantic_loss_v25  # noqa: E402
from piano_vision.v25.model import PianoVisionV25  # noqa: E402
from piano_vision.v25.performance import prepare_batch  # noqa: E402
from piano_vision.v2.data import PageResolver  # noqa: E402
from validate_notation_sidecars_v1 import load_score_records  # noqa: E402

from realpdf_data import (RealPdfPageResolver, assert_trainable,  # noqa: E402
                          load_realpdf_records, realpdf_manifest)

SEED = 21701
FACTORY_ROOT = REPO / "tmp/campaign/pdmx-piano-vision-full-v1"
FACTORY_INDEX = REPO / "tmp/campaign/piano-vision-phase214/full-semantic-index.json"
SIDECAR_ROOT = REPO / "tmp/campaign/piano-vision-phase214/notation-sidecars/full-v1"

VISUAL_PREFIXES = ("backbone.", "visual_projection.", "object_projection.",
                   "geometry_projection.")
PITCH_PREFIXES = tuple(f"heads.object.{h}." for h in
                       ("pitch_staff_step", "pitch_written_step", "pitch_octave",
                        "pitch_accidental", "pitch_staff"))
SHARED_PREFIXES = ("event_projector.", "pointer.", "object_memory.",
                   "notation_bias.", "notation_decoder.")


def parameter_groups(model):
    """Four groups, named by domain sensitivity. Asserts full coverage."""
    groups = {"visual": [], "pitch": [], "heads": [], "shared": []}
    for name, param in model.named_parameters():
        if not param.requires_grad:
            continue
        if name.startswith(VISUAL_PREFIXES):
            groups["visual"].append(param)
        elif name.startswith(PITCH_PREFIXES):
            groups["pitch"].append(param)
        elif name.startswith(SHARED_PREFIXES):
            groups["shared"].append(param)
        else:
            groups["heads"].append(param)
    covered = sum(len(v) for v in groups.values())
    total = sum(1 for p in model.parameters() if p.requires_grad)
    if covered != total:
        raise AssertionError(f"parameter groups cover {covered} of {total} trainable tensors")
    return groups


def group_report(model):
    groups = parameter_groups(model)
    return {name: {"tensors": len(params),
                   "parameters": sum(p.numel() for p in params)}
            for name, params in groups.items()}


def atomic_write_json(path, payload):
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True))
    os.replace(tmp, path)


def tree_to(value, device):
    if torch.is_tensor(value):
        return value.to(device, non_blocking=True)
    if isinstance(value, dict):
        return {k: tree_to(v, device) for k, v in value.items()}
    if isinstance(value, list):
        return [tree_to(v, device) for v in value]
    if isinstance(value, tuple):
        return tuple(tree_to(v, device) for v in value)
    return value


class AdaptationSource:
    """Real-PDF measures, tensorized through the canonical path.

    The ``object.rest`` head is masked out by default. The qualified corpus
    never supervised its positive class (REST labels were UNAVAILABLE there), so
    training it on real-PDF rests would be an unrelated behaviour change with no
    bearing on the pitch problem this campaign exists to solve. Replay keeps the
    head exactly where the qualification left it. Opt in with
    ``--train-rest-head`` only when a rest campaign is intended.
    """

    def __init__(self, manifest_path, corpus_index_path, config, train_rest_head=False,
                 campaign_split="adaptation"):
        assert_trainable(campaign_split)
        self.manifest = realpdf_manifest(manifest_path, "train")
        if self.manifest.get("campaign_split") not in (None, campaign_split):
            raise PermissionError(
                f"manifest declares campaign split {self.manifest['campaign_split']!r} "
                f"but {campaign_split!r} was requested")
        self.campaign_split = campaign_split
        self.config = config
        self.train_rest_head = train_rest_head
        self.resolver = RealPdfPageResolver(corpus_index_path)
        self.cache: OrderedDict = OrderedDict()
        self.entries = self.manifest["examples"]
        self.masked = 0

    def _records(self, score_id):
        if score_id not in self.cache:
            self.cache[score_id] = load_realpdf_records(score_id, self.campaign_split, self.resolver.index_path)
            while len(self.cache) > 48:
                self.cache.popitem(last=False)
        else:
            self.cache.move_to_end(score_id)
        return self.cache[score_id]

    def materialize(self, entry):
        records = self._records(entry["score_id"])
        record = next(r for r in records if r["exampleId"] == entry["example_id"])
        sample, _selected, _lookup = tensorize_v25(record, records, self.resolver, self.config)
        if not self.train_rest_head:
            rest = (sample.get("targets", {}).get("object") or {}).get("rest")
            if rest is not None and bool(rest["mask"].any()):
                rest["mask"] = torch.zeros_like(rest["mask"])
                self.masked += 1
        return sample


class ReplaySource:
    """Original V2.5 training distribution, for capability retention."""

    def __init__(self, manifest_path, config, with_sidecars=True):
        self.manifest = realpdf_manifest(manifest_path, "train")
        self.config = config
        self.with_sidecars = with_sidecars
        self.resolver = PageResolver(FACTORY_ROOT, index_path=str(FACTORY_INDEX))
        self.cache: OrderedDict = OrderedDict()
        self.entries = self.manifest["examples"]

    def _records(self, score_id):
        if score_id not in self.cache:
            self.cache[score_id] = load_score_records(score_id, "train")
            while len(self.cache) > 32:
                self.cache.popitem(last=False)
        else:
            self.cache.move_to_end(score_id)
        return self.cache[score_id]

    def materialize(self, entry):
        from piano_vision.v25.data import attach_pointer_targets
        from piano_vision.v2.data import attach_notation_sidecar
        records = self._records(entry["score_id"])
        record = next(r for r in records if r["exampleId"] == entry["example_id"])
        sample, selected, lookup = tensorize_v25(record, records, self.resolver, self.config)
        if self.with_sidecars:
            sidecar_path = SIDECAR_ROOT / entry["sidecar"]
            if sidecar_path.exists():
                sidecar = json.loads(sidecar_path.read_text())
                known = [r for r in sidecar["regions"] if r["state"] == "KNOWN"]
                if known:
                    sample = attach_notation_sidecar(sample, sidecar, record,
                                                     self.resolver, self.config)
                    sample = attach_pointer_targets(sample, sidecar, record, selected, lookup)
        return sample


def pack_micros(samples, views_per_micro):
    micros, current, current_views = [], [], 0
    for sample in samples:
        views = int(sample["images"].shape[0])
        if current and current_views + views > views_per_micro:
            micros.append(current)
            current, current_views = [], 0
        current.append(sample)
        current_views += views
    if current:
        micros.append(current)
    return micros


def build_contract(args, out_root, model, config):
    contract = {
        "run": "v25-realpdf-adaptation",
        "purpose": "domain adaptation of the qualified step-2100 checkpoint to "
                   "production-rendered PDFs; architecture unchanged",
        "architecture": "V2.5-MEDIUM",
        "parameters": sum(p.numel() for p in model.parameters()),
        "model_config": config.to_dict(),
        "init_checkpoint": args.init_checkpoint,
        "optimizer": {
            "name": "AdamW", "grad_clip": 1.0, "weight_decay": args.weight_decay,
            "lr": {"visual": args.lr_visual, "pitch": args.lr_pitch,
                   "heads": args.lr_heads, "shared": args.lr_shared},
        },
        "scheduler": {"name": "cosine-warmup", "warmup_steps": args.warmup_steps,
                      "horizon_steps": args.schedule_horizon,
                      "minimum_ratio": args.schedule_min_ratio},
        "batching": {"samples_per_step": args.samples_per_step,
                     "adapt_ratio": args.adapt_ratio,
                     "views_per_micro": args.views_per_micro,
                     "packing": "greedy view-budget, deterministic order"},
        "replay": {"manifest": args.replay_manifest,
                   "policy": "every optimizer step draws (1 - adapt_ratio) of its "
                             "window from the original V2.5 training manifest"},
        "adaptation": {"manifest": args.adapt_manifest,
                       "corpus_index": args.corpus_index,
                       "render_dpi": 150,
                       "contract": "production _render_pdf_pages / _analyze_page / "
                                   "_detect_page_objects / build_page_records"},
        "labels": {"source": "matched MusicXML via musicxml_truth + align_objects",
                   "model_predictions_used_as_truth": False},
        "precision": "fp32",
        "consistency_scale": args.consistency_scale,
        "seed": SEED,
        "parameter_groups": group_report(model),
        "checkpoint_selection": "offline only, on fixed held-out real PDF and fixed "
                                "original qualification; never on training accuracy",
        "campaign_request": {k: v for k, v in vars(args).items() if k != "out"},
    }
    contract["digest"] = hashlib.sha256(
        json.dumps(contract, sort_keys=True).encode()).hexdigest()
    atomic_write_json(out_root / "contract.json", contract)
    return contract


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", required=True)
    parser.add_argument("--init-checkpoint", required=True,
                        help="the qualified step-2100 V2.5 checkpoint-final.pt")
    parser.add_argument("--adapt-manifest", required=True)
    parser.add_argument("--corpus-index", required=True)
    parser.add_argument("--adapt-split", default="adaptation",
                        help="campaign split backing --adapt-manifest")
    parser.add_argument("--replay-manifest", required=True,
                        help="the ORIGINAL V2.5 train manifest (factory records)")
    parser.add_argument("--config", default=None)
    parser.add_argument("--contract", default=str(
        REPO / "tmp/campaign/piano-vision-phase214/v25-windows-transfer-20260927/contract.json"),
        help="qualified step-2100 contract; supplies the frozen model config")
    parser.add_argument("--max-steps", type=int, default=300)
    parser.add_argument("--allow-long", action="store_true",
                        help="permit more than --max-steps; a campaign gate, not a knob")
    parser.add_argument("--lr-visual", type=float, default=1.2e-4)
    parser.add_argument("--lr-pitch", type=float, default=2.0e-4)
    parser.add_argument("--lr-heads", type=float, default=3.0e-5)
    parser.add_argument("--lr-shared", type=float, default=1.5e-5)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--warmup-steps", type=int, default=30)
    parser.add_argument("--schedule-horizon", type=int, default=300)
    parser.add_argument("--schedule-min-ratio", type=float, default=0.1)
    parser.add_argument("--samples-per-step", type=int, default=8)
    parser.add_argument("--adapt-ratio", type=float, default=0.5,
                        help="fraction of each window drawn from real-PDF measures; "
                             "the rest is original-distribution replay")
    parser.add_argument("--views-per-micro", type=int, default=32)
    parser.add_argument("--consistency-scale", type=float, default=0.0,
                        help="label-free structural penalties; 0 during a short "
                             "adaptation run because adaptation records carry no "
                             "notation sidecars")
    parser.add_argument("--checkpoint-every", type=int, default=50)
    parser.add_argument("--train-rest-head", action="store_true",
                        help="also supervise object.rest on real-PDF rests; off by "
                             "default because the qualified corpus never saw its "
                             "positive class and this campaign is about pitch")
    parser.add_argument("--pin-memory", action="store_true")
    parser.add_argument("--device", default=None)
    parser.add_argument("--profile-only", type=int, default=0,
                        help="run N measured steps and exit; no checkpoints, no "
                             "selection. Use this to get a real seconds/step.")
    args = parser.parse_args()

    if args.adapt_ratio <= 0 or args.adapt_ratio >= 1:
        raise ValueError("--adapt-ratio must be in (0, 1); replay is mandatory")
    if args.max_steps > 300 and not args.allow_long:
        raise SystemExit(
            f"--max-steps {args.max_steps} exceeds the 300-step adaptation gate. "
            f"Pass --allow-long only after the short qualification run passes both "
            f"evaluation gates.")
    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    if args.profile_only > 300 and not args.allow_long:
        raise SystemExit("--profile-only is capped at 300 steps")

    contract_doc = json.loads(Path(args.contract).read_text())
    config = config_from_dict(json.loads(Path(args.config).read_text())["model_config"]
                              if args.config else contract_doc["model_config"])

    out_root = Path(args.out)
    (out_root / "checkpoints").mkdir(parents=True, exist_ok=True)
    torch.manual_seed(SEED)
    started = time.time()

    model = PianoVisionV25(config).to(device)
    payload = torch.load(args.init_checkpoint, map_location=device, weights_only=False)
    if "model" not in payload:
        raise SystemExit("init checkpoint has no 'model' state dict")
    model.load_state_dict(payload["model"], strict=True)
    print(json.dumps({"init": args.init_checkpoint,
                      "init_step": payload.get("step"), "init_tag": payload.get("tag"),
                      "init_architecture": payload.get("architecture")}), flush=True)

    groups = parameter_groups(model)
    optimizer = torch.optim.AdamW([
        {"params": groups["visual"], "lr": args.lr_visual, "tag": "visual"},
        {"params": groups["pitch"], "lr": args.lr_pitch, "tag": "pitch"},
        {"params": groups["heads"], "lr": args.lr_heads, "tag": "heads"},
        {"params": groups["shared"], "lr": args.lr_shared, "tag": "shared"},
    ], weight_decay=args.weight_decay)

    contract = build_contract(args, out_root, model, config)

    def schedule_factor(step):
        import math
        warmup = max(0, min(args.warmup_steps, args.schedule_horizon - 1))
        if warmup and step < warmup:
            return max(1e-4, (step + 1) / warmup)
        total = max(1, args.schedule_horizon)
        progress = (step - warmup) / max(1, total - warmup)
        cosine = 0.5 * (1 + math.cos(math.pi * min(1.0, max(0.0, progress))))
        return args.schedule_min_ratio + (1 - args.schedule_min_ratio) * cosine

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, schedule_factor)

    adaptation = AdaptationSource(args.adapt_manifest, args.corpus_index, config,
                                    train_rest_head=args.train_rest_head,
                                    campaign_split=args.adapt_split)
    replay = ReplaySource(args.replay_manifest, config)
    if not adaptation.entries:
        raise SystemExit("adaptation manifest is empty")
    if not replay.entries:
        raise SystemExit("replay manifest is empty")
    print(json.dumps({"adaptation_entries": len(adaptation.entries),
                      "adaptation_scores": adaptation.manifest["scores"],
                      "replay_entries": len(replay.entries)}), flush=True)

    rng = random.Random(SEED)
    adapt_order = list(range(len(adaptation.entries)))
    rng.shuffle(adapt_order)
    replay_order = list(range(len(replay.entries)))
    rng.shuffle(replay_order)
    cursor = {"adapt": 0, "replay": 0}

    def next_adapt():
        if cursor["adapt"] >= len(adapt_order):
            rng.shuffle(adapt_order)
            cursor["adapt"] = 0
        entry = adaptation.entries[adapt_order[cursor["adapt"]]]
        cursor["adapt"] += 1
        return entry

    def next_replay():
        if cursor["replay"] >= len(replay_order):
            rng.shuffle(replay_order)
            cursor["replay"] = 0
        entry = replay.entries[replay_order[cursor["replay"]]]
        cursor["replay"] += 1
        return entry

    def to_device(batch):
        batch = prepare_batch(batch, consistency=args.consistency_scale > 0)
        if args.pin_memory and str(device).startswith("cuda"):
            def pin(value):
                if torch.is_tensor(value):
                    return value.pin_memory()
                if isinstance(value, dict):
                    return {k: pin(v) for k, v in value.items()}
                if isinstance(value, (list, tuple)):
                    return type(value)(pin(v) for v in value)
                return value
            batch = pin(batch)
        return tree_to(batch, device)

    metrics_path = out_root / "metrics.jsonl"
    head_totals, head_correct = Counter(), Counter()
    losses = []
    step = 0
    total = args.profile_only or args.max_steps
    model.train()
    while step < total:
        window = args.samples_per_step
        n_adapt = max(1, int(round(window * args.adapt_ratio)))
        n_replay = window - n_adapt
        picked = [("adapt", next_adapt()) for _ in range(n_adapt)]
        picked += [("replay", next_replay()) for _ in range(n_replay)]
        samples, kinds = [], []
        for kind, entry in picked:
            try:
                samples.append(adaptation.materialize(entry) if kind == "adapt"
                               else replay.materialize(entry))
                kinds.append(kind)
            except Exception as exc:  # noqa: BLE001 - a bad example must not kill the run
                print(json.dumps({"skipped": entry["example_id"], "kind": kind,
                                  "error": f"{type(exc).__name__}: {exc}"}), flush=True)
        if not samples:
            continue
        micros = pack_micros(samples, args.views_per_micro)
        step_started = time.perf_counter()
        optimizer.zero_grad(set_to_none=True)
        last_loss, last_parts = None, {}
        for micro_samples in micros:
            micro = to_device(collate_v25(micro_samples))
            output = model(micro)
            loss, count, _ = semantic_loss_v25(
                output, micro["targets"], micro, config,
                consistency_scale=args.consistency_scale, report_components=False)
            if not torch.isfinite(loss) or int(count) == 0:
                raise FloatingPointError("invalid adaptation loss or no supervision")
            (loss / max(1, len(micros))).backward()
            last_loss = loss
            with torch.no_grad():
                for head, logits in output["object"].items():
                    payload = (micro["targets"].get("object") or {}).get(head)
                    if payload is None or not int(payload["mask"].sum()):
                        continue
                    key = f"object.{head}"
                    head_correct[key] += int(
                        ((logits.argmax(-1) == payload["target"]) & payload["mask"]).sum())
                    head_totals[key] += int(payload["mask"].sum())
            del output, micro
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
        optimizer.step()
        scheduler.step()
        step += 1
        elapsed = time.perf_counter() - step_started
        losses.append(float(last_loss.detach()) if last_loss is not None else None)
        row = {"step": step, "seconds": elapsed, "kinds": Counter(kinds),
               "loss_last_micro": losses[-1], "micros": len(micros),
               "lr": {g["tag"]: g["lr"] for g in optimizer.param_groups},
               "train_object_accuracy": {
                   k: head_correct[k] / head_totals[k] for k in sorted(head_totals)},
               "selection_use": "NONE - diagnostic only, never a selection signal"}
        if str(device).startswith("cuda"):
            torch.cuda.synchronize()
            row["peak_allocated_bytes"] = torch.cuda.max_memory_allocated()
            row["peak_reserved_bytes"] = torch.cuda.max_memory_allocated()
        with open(metrics_path, "a") as stream:
            stream.write(json.dumps(row) + "\n")
        if step % 5 == 0 or step == 1:
            print(json.dumps({"step": step, "seconds": round(elapsed, 3),
                              "loss": row["loss_last_micro"]}), flush=True)
        if args.profile_only:
            continue
        if step % args.checkpoint_every == 0 or step == total:
            torch.save({"step": step, "tag": f"step-{step}", "model": model.state_dict(),
                        "config": config.to_dict(), "contract_digest": contract["digest"],
                        "architecture": "piano-vision/2.5",
                        "init_checkpoint": args.init_checkpoint,
                        "init_step": payload.get("step")},
                       out_root / "checkpoints" / f"checkpoint-step-{step}.pt")

    measured = [json.loads(line)["seconds"] for line in metrics_path.read_text().splitlines()]
    summary = {
        "steps": step,
        "elapsed_s": round(time.time() - started, 1),
        "seconds_mean": sum(measured) / max(1, len(measured)),
        "seconds_median": sorted(measured)[len(measured) // 2] if measured else None,
        "seconds_min": min(measured) if measured else None,
        "loss_first": losses[0] if losses else None,
        "loss_last": losses[-1] if losses else None,
        "device": str(device), "torch": torch.__version__,
        "gpu": torch.cuda.get_device_name() if str(device).startswith("cuda") else None,
        "profile_only": bool(args.profile_only),
        "checkpoint_selection": "none; select offline on the fixed evaluation sets",
    }
    atomic_write_json(out_root / "summary.json", summary)
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == "__main__":
    main()
