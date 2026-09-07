#!/usr/bin/env python3
"""CLI for the generic, archive-native PDMX factory."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from factory import Factory
from input_setup import InputSetup
from preflight import run_preflight
from semantic_factory import SemanticFactory, evaluate_loader, train_smoke
from source_producer_integration import produce_source_coordinates
from worker_guard import assert_no_legacy_worker


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--work-dir", type=Path, required=True)
    result.add_argument("--csv", type=Path, required=True)
    result.add_argument("--pdf-archive", type=Path, required=True)
    result.add_argument("--mxl-archive", type=Path, required=True)
    result.add_argument("--subset-paths", type=Path, required=True)
    result.add_argument("--model-contract", type=Path,
                        default=Path("tmp/campaign/piano-vision-phase212y/factory-model-contract.json"))
    result.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    result.add_argument("--shard-size", type=int, default=16)
    result.add_argument("--free-floor-gib", type=float, default=20.0)
    sub = result.add_subparsers(dest="command", required=True)
    inspect = sub.add_parser("inspect")
    inspect.add_argument("--archive-scan-limit", type=int, default=20)
    filtering = sub.add_parser("filter")
    filtering.add_argument("--limit", type=int, default=1000)
    filtering.add_argument("--reset", action="store_true")
    build = sub.add_parser("build")
    build.add_argument("--max-scores", type=int, default=10)
    build.add_argument("--retry-failed", action="store_true")
    build.add_argument("--interrupt-after", type=int)
    build.add_argument("--retain-cache", action="store_true")
    sub.add_parser("pause")
    sub.add_parser("stop")
    sub.add_parser("resume")
    sub.add_parser("status")
    sub.add_parser("retry-failed")
    sub.add_parser("validate-dataset")
    sub.add_parser("validate-inputs")
    sub.add_parser("freeze-plan")
    sub.add_parser("preflight")
    semantic = sub.add_parser("semantic-build")
    semantic.add_argument("--max-scores", type=int, default=30)
    semantic.add_argument("--interrupt-after", type=int)
    sub.add_parser("semantic-validate")
    trainer = sub.add_parser("trainer-smoke")
    trainer.add_argument("--epochs", type=int, default=3)
    trainer.add_argument("--max-examples", type=int, default=256)
    sub.add_parser("semantic-evaluate")
    producer = sub.add_parser("produce-source-coordinates")
    producer.add_argument("--max-scores", type=int, default=10)
    producer.add_argument("--max-pages", type=int, default=999)
    return result


def main():
    args = parser().parse_args()
    if args.command in ('semantic-build', 'semantic-validate'):
        assert_no_legacy_worker(args.work_dir)
    factory = Factory(args.work_dir, args.csv, args.pdf_archive, args.mxl_archive,
                      args.shard_size, args.free_floor_gib)
    try:
        factory.set_state("input_csv_path", str(args.csv.resolve()))
        factory.set_state("input_pdf_archive_path", str(args.pdf_archive.resolve()))
        factory.set_state("input_mxl_archive_path", str(args.mxl_archive.resolve()))
        factory.set_state("input_subset_paths_path", str(args.subset_paths.resolve()))
        setup = InputSetup(args.work_dir, args.model_contract, args.free_floor_gib)
        setup.save({"metadata": args.csv, "pdfArchive": args.pdf_archive,
                    "mxlArchive": args.mxl_archive, "subsetPaths": args.subset_paths})

        def semantic_action(action):
            semantic_factory = SemanticFactory(args.work_dir, args.model_contract,
                shard_size=max(1, args.shard_size * 16), free_floor_gib=args.free_floor_gib)
            try:
                factory.set_state("model_contract_valid", "true")
                factory.set_state("model_contract_digest", semantic_factory.contract["configurationDigest"])
                return action(semantic_factory)
            finally:
                semantic_factory.close()

        def validate_inputs():
            report = setup.validate()
            factory.set_state("input_validation", json.dumps(report, sort_keys=True))
            if report.get("metadataRows") is not None:
                factory.set_state("metadata_total_rows", str(report["metadataRows"]))
            return report

        def preflight_action():
            while True:
                batch = factory.filter_metadata(1000)
                if batch["scanned"] == 0:
                    break
            factory.freeze_build_plan()
            return run_preflight(factory)

        actions = {
            "inspect": lambda: factory.inspect(args.archive_scan_limit),
            "filter": lambda: factory.filter_metadata(args.limit, args.reset),
            "build": lambda: factory.build(args.max_scores, args.retry_failed, args.interrupt_after, args.retain_cache),
            "pause": factory.pause,
            "stop": factory.stop,
            "resume": factory.resume,
            "status": factory.status,
            "retry-failed": factory.retry_failed,
            "validate-dataset": factory.validate_dataset,
            "validate-inputs": validate_inputs,
            "freeze-plan": factory.freeze_build_plan,
            "preflight": preflight_action,
            "semantic-build": lambda: semantic_action(lambda semantic_factory: semantic_factory.assemble(args.max_scores, args.interrupt_after)),
            "semantic-validate": lambda: semantic_action(lambda semantic_factory: semantic_factory.validate()),
            "trainer-smoke": lambda: train_smoke(args.work_dir, args.epochs, args.max_examples),
            "semantic-evaluate": lambda: evaluate_loader(args.work_dir),
            "produce-source-coordinates": lambda: produce_source_coordinates(
                factory, args.repo_root, args.max_scores, args.max_pages
            ),
        }
        print(json.dumps(actions[args.command](), indent=2, sort_keys=True))
    finally:
        factory.close()


if __name__ == "__main__":
    main()
