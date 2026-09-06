"""Command-line entry points for Corranzo Piano Vision v1."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from .config import freeze_config, load_config
from .dashboard import DashboardStore, serve_dashboard
from .data import SemanticShardDataset, build_dataset_index, make_loader
from .evaluator import evaluate_model, write_evaluation
from .gate import evaluate_launch_gate
from .model import PianoVisionV1
from .readiness import prepare_full, review_full
from .trainer import Trainer, select_device
from .validation import parameter_report, run_overfit, validate_sample


TOOL_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = TOOL_ROOT.parents[1]


def parser():
    value = argparse.ArgumentParser(description=__doc__)
    commands = value.add_subparsers(dest="command", required=True)

    inspect = commands.add_parser("inspect-model")
    inspect.add_argument("--output", type=Path)

    index = commands.add_parser("build-index")
    index.add_argument("--dataset-dir", type=Path, required=True)
    index.add_argument("--output", type=Path, required=True)
    index.add_argument("--verify-hashes", action="store_true")

    freeze = commands.add_parser("freeze-config")
    freeze.add_argument("--config", type=Path, required=True)
    freeze.add_argument("--output", type=Path, required=True)

    validate = commands.add_parser("validate-sample")
    validate.add_argument("--sample-dir", type=Path, default=REPO_ROOT / "tmp/campaign/piano-vision-phase212y/factory-sample-run")
    validate.add_argument("--campaign-dir", type=Path, default=REPO_ROOT / "tmp/campaign/piano-vision-phase214")
    validate.add_argument("--config", type=Path)

    overfit = commands.add_parser("overfit")
    overfit.add_argument("--index", type=Path, required=True)
    overfit.add_argument("--campaign-dir", type=Path, default=REPO_ROOT / "tmp/campaign/piano-vision-phase214")
    overfit.add_argument("--steps", type=int, default=120)

    train = commands.add_parser("train")
    train.add_argument("--config", type=Path, required=True)
    train.add_argument("--index", type=Path, required=True)
    train.add_argument("--run-dir", type=Path, required=True)
    train.add_argument("--run-id")
    train.add_argument("--resume", nargs="?", const="latest")

    evaluate = commands.add_parser("evaluate")
    evaluate.add_argument("--config", type=Path, required=True)
    evaluate.add_argument("--index", type=Path, required=True)
    evaluate.add_argument("--checkpoint", type=Path, required=True)
    evaluate.add_argument("--split", choices=("validation", "test"), default="validation")
    evaluate.add_argument("--output", type=Path, required=True)
    evaluate.add_argument("--max-batches", type=int)

    dashboard = commands.add_parser("dashboard")
    dashboard.add_argument("--run-dir", type=Path, required=True)
    dashboard.add_argument("--host", default="127.0.0.1")
    dashboard.add_argument("--port", type=int, default=8774)

    prepare = commands.add_parser("prepare-full")
    prepare.add_argument("--factory-dir", type=Path, required=True)
    prepare.add_argument("--campaign-dir", type=Path, required=True)
    prepare.add_argument("--config", type=Path)
    prepare.add_argument("--disk-floor-gib", type=float, default=20.0)
    prepare.add_argument("--quiescence-seconds", type=int, default=300)

    review = commands.add_parser("review-full")
    review.add_argument("--factory-dir", type=Path, required=True)
    review.add_argument("--campaign-dir", type=Path, required=True)
    review.add_argument("--confirm")
    review.add_argument("--quiescence-seconds", type=int, default=300)

    gate = commands.add_parser("gate")
    gate.add_argument("--factory-dir", type=Path, required=True)
    gate.add_argument("--config", type=Path, required=True)
    gate.add_argument("--index", type=Path, required=True)
    gate.add_argument("--output", type=Path)
    gate.add_argument("--disk-floor-gib", type=float, default=20.0)
    gate.add_argument(
        "--human-review-complete",
        action="store_true",
        help="Compatibility flag; a matching human-review.json record is still required",
    )
    gate.add_argument("--review-record", type=Path)
    gate.add_argument("--quiescence-seconds", type=int, default=300)

    launch = commands.add_parser("launch-full")
    launch.add_argument("--factory-dir", type=Path, required=True)
    launch.add_argument("--config", type=Path, required=True)
    launch.add_argument("--index", type=Path, required=True)
    launch.add_argument("--run-dir", type=Path, required=True)
    launch.add_argument("--confirm", required=True)
    launch.add_argument("--disk-floor-gib", type=float, default=20.0)
    return value


def _print_or_write(value, output=None):
    payload = json.dumps(value, indent=2, sort_keys=True) + "\n"
    if output:
        Path(output).parent.mkdir(parents=True, exist_ok=True)
        Path(output).write_text(payload, encoding="utf-8")
    print(payload, end="")


def main(argv=None):
    args = parser().parse_args(argv)
    if args.command == "inspect-model":
        _print_or_write({"schema_version": 1, "models": parameter_report()}, args.output)
    elif args.command == "build-index":
        _print_or_write(build_dataset_index(args.dataset_dir, args.output, args.verify_hashes))
    elif args.command == "freeze-config":
        _print_or_write(freeze_config(load_config(args.config), args.output))
    elif args.command == "validate-sample":
        _print_or_write(validate_sample(args.sample_dir, args.campaign_dir, args.config))
    elif args.command == "overfit":
        _print_or_write(run_overfit(args.index, args.campaign_dir, args.steps))
    elif args.command == "train":
        _print_or_write(Trainer(load_config(args.config), args.index, args.run_dir, args.run_id).run(args.resume))
    elif args.command == "evaluate":
        config = load_config(args.config)
        device, _report = select_device(config["training"].get("device", "auto"))
        model = PianoVisionV1(config["model"]).to(device)
        payload = torch.load(args.checkpoint, map_location=device, weights_only=False)
        model.load_state_dict(payload["model_state"])
        dataset = SemanticShardDataset(args.index, args.split, config["data"], seed=config["training"]["seed"], shuffle=False, augment=False)
        loader = make_loader(dataset, config["training"]["validation_batch_size"], config["training"]["num_workers"], config["training"]["prefetch_factor"])
        report = evaluate_model(model, loader, device, config["loss"], config["uncertainty"], args.max_batches)
        report.update(split=args.split, checkpoint=str(args.checkpoint), model_selection=False)
        write_evaluation(args.output, report)
        _print_or_write(report)
    elif args.command == "dashboard":
        serve_dashboard(args.run_dir, TOOL_ROOT / "dashboard/index.html", args.host, args.port)
    elif args.command == "prepare-full":
        _print_or_write(prepare_full(
            args.factory_dir,
            args.campaign_dir,
            config_path=args.config,
            disk_floor_gib=args.disk_floor_gib,
            quiescence_seconds=args.quiescence_seconds,
        ))
    elif args.command == "review-full":
        _print_or_write(review_full(
            args.factory_dir,
            args.campaign_dir,
            confirmation=args.confirm,
            quiescence_seconds=args.quiescence_seconds,
        ))
    elif args.command == "gate":
        report = evaluate_launch_gate(
            args.factory_dir,
            args.config,
            args.index,
            args.disk_floor_gib,
            args.human_review_complete,
            review_path=args.review_record,
            quiescence_seconds=args.quiescence_seconds,
        )
        if args.output:
            _print_or_write(report, args.output)
        else:
            _print_or_write(report)
    elif args.command == "launch-full":
        if args.confirm != "HUMAN_REVIEW_COMPLETE":
            raise PermissionError("Exact confirmation HUMAN_REVIEW_COMPLETE is required")
        report = evaluate_launch_gate(args.factory_dir, args.config, args.index, args.disk_floor_gib, human_review=True)
        if not report["ready"]:
            raise RuntimeError("Full training gate is closed: " + ", ".join(report["blockers"]))
        run_dir = Path(args.run_dir)
        run_dir.mkdir(parents=True, exist_ok=True)
        authorization = {**report, "human_confirmation": args.confirm}
        (run_dir / "FULL_TRAINING_AUTHORIZED.json").write_text(json.dumps(authorization, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        DashboardStore(run_dir).update(full_training="READY")
        _print_or_write(Trainer(load_config(args.config), args.index, run_dir).run())


if __name__ == "__main__":
    main()
