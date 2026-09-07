#!/usr/bin/env python3
"""Resumable, user-launched full Corranzo PDMX factory pipeline.

The localhost dashboard starts this entry point only after all four inputs,
the model contract, and disk safety validate. It streams selected archive
members in bounded batches and relies on the generic factory's persisted state
for resume/retry.
"""

from __future__ import annotations

import argparse
import json
import traceback
from pathlib import Path

from factory import Factory
from input_setup import InputSetup
from preflight import run_preflight
from semantic_factory import SemanticFactory, evaluate_loader
from source_producer_integration import produce_source_coordinates
from worker_guard import pipeline_guard, physical_complete


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--work-dir", type=Path, required=True)
    result.add_argument("--csv", type=Path, required=True)
    result.add_argument("--pdf-archive", type=Path, required=True)
    result.add_argument("--mxl-archive", type=Path, required=True)
    result.add_argument("--subset-paths", type=Path, required=True)
    result.add_argument("--model-contract", type=Path, required=True)
    result.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    result.add_argument("--disk-floor-gib", type=float, default=20.0)
    result.add_argument("--batch-size", type=int, default=10)
    result.add_argument("--filter-batch-size", type=int, default=1000)
    result.add_argument("--semantic-only", action="store_true", help="Require completed physical work; never scan archives or run physical stages")
    result.add_argument("--resume", action="store_true", help="Explicitly clear persisted pause/stop flags for semantic-only resume")
    return result


def run(args):
    with pipeline_guard(args.work_dir):
        return _run(args)


def _run(args):
    completed_physical = physical_complete(args.work_dir)
    if getattr(args, "semantic_only", False) and not completed_physical:
        raise RuntimeError("PHYSICAL_PHASE_NOT_COMPLETE: refusing semantic-only resume")
    if getattr(args, 'resume', False) and not getattr(args, 'semantic_only', False):
        raise RuntimeError('--resume requires --semantic-only')
    if not completed_physical:
        setup = InputSetup(args.work_dir, args.model_contract, args.disk_floor_gib)
        setup.save({
            "metadata": args.csv,
            "pdfArchive": args.pdf_archive,
            "mxlArchive": args.mxl_archive,
            "subsetPaths": args.subset_paths,
        })
        admission = setup.validate(include_fingerprint=False)
        if not admission["buildAuthorized"]:
            raise RuntimeError("Full build is not authorized: " + ", ".join(admission["buildDisabledReasons"]))

    factory = Factory(
        args.work_dir, args.csv, args.pdf_archive, args.mxl_archive,
        shard_size=16, free_floor_gib=args.disk_floor_gib,
    )
    try:
        factory.check_disk()
        if getattr(args, 'resume', False):
            factory.set_state('paused', 'false')
            factory.set_state('stop_requested', 'false')
        factory.set_state("full_build_state", "RUNNING")
        if not completed_physical:
            factory.set_state("input_csv_path", str(args.csv.resolve()))
            factory.set_state("input_pdf_archive_path", str(args.pdf_archive.resolve()))
            factory.set_state("input_mxl_archive_path", str(args.mxl_archive.resolve()))
            factory.set_state("input_subset_paths_path", str(args.subset_paths.resolve()))
            factory.set_state("input_validation", json.dumps(admission, sort_keys=True))
            factory.set_state("metadata_total_rows", str(admission["metadataRows"]))
            factory.set_state("full_pdmx_started", "true")
            factory.set_state("full_build_state", "RUNNING")
            factory.set_state("model_contract_valid", "true")
            factory.inspect()

            while True:
                filtered = factory.filter_metadata(args.filter_batch_size)
                if filtered["scanned"] == 0:
                    break
            factory.freeze_build_plan()
            if factory.get_state("preflight_state") != "COMPLETE":
                run_preflight(factory)

            while True:
                if factory.get_state("paused", "false") == "true" or factory.get_state("stop_requested", "false") == "true":
                    factory.set_state("full_build_state", "PAUSED")
                    return {"state": "PAUSED", "status": factory.status()}
                pending = factory.db.execute(
                    "SELECT COUNT(*) FROM scores WHERE filter_state='AMBIGUOUS_INSTRUMENTATION' AND job_state='PENDING'"
                ).fetchone()[0]
                if not pending:
                    break
                produce_source_coordinates(factory, args.repo_root, min(args.batch_size, pending))
                result = factory.build(min(args.batch_size, pending))
                if result.get("processed", 0) == 0:
                    raise RuntimeError("Pipeline made no progress while candidates remained")

        factory.set_state("physical_build_state", "COMPLETE")
        semantic = SemanticFactory(args.work_dir, args.model_contract, shard_size=256, free_floor_gib=args.disk_floor_gib)
        try:
            canonical = factory.db.execute("SELECT COUNT(*) FROM canonical").fetchone()[0]
            assembled = semantic.assemble(max_scores=max(1, canonical))
            if assembled.get("state") == "PAUSED":
                factory.set_state("full_build_state", "PAUSED")
                return {"state": "PAUSED", "assembly": assembled}
            if assembled.get("state") != "COMPLETE":
                raise RuntimeError("Semantic assembly did not complete")
            semantic_validation = assembled
        finally:
            semantic.close()
        generic_validation = factory.validate_dataset()
        evaluation = evaluate_loader(args.work_dir)
        if not generic_validation["valid"] or not semantic_validation["valid"]:
            raise RuntimeError("Final generic or semantic validation failed")
        factory.set_state("full_build_state", "COMPLETE")
        return {
            "state": "COMPLETE",
            "generic": generic_validation,
            "semantic": semantic_validation,
            "assembly": assembled,
            "evaluation": evaluation,
        }
    except KeyboardInterrupt:
        factory.set_state("full_build_state", "PAUSED")
        return {"state": "PAUSED"}
    except Exception:
        factory.set_state("full_build_state", "FAILED")
        factory.log("ERROR", "FULL_PIPELINE", traceback.format_exc())
        raise
    finally:
        factory.close()


def main():
    print(json.dumps(run(parser().parse_args()), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
