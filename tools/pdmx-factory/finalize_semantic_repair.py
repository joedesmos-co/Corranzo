"""Validate and publish an existing repair revision; never assemble examples.

Keep this separate from the frozen repair writer: changing its code would
invalidate the recipe that identifies already published repaired shards.
"""
import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path

from audit_semantic_repair import audit
from factory import Factory, sha256_path, utc_now
from semantic_factory import FAMILIES, SemanticFactory, evaluate_loader
from semantic_streaming import digest, sync_directory
from worker_guard import physical_complete, pipeline_guard


def require(condition, blocker):
    if not condition:
        raise ValueError(blocker)


def save(path, value):
    partial = path.with_suffix(path.suffix + '.partial')
    with partial.open('w') as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
    os.replace(partial, path)
    sync_directory(path.parent)


def shard_inventory_digest(db):
    result = hashlib.sha256()
    for row in db.execute('SELECT shard_id,path,records,sha256,split FROM semantic_shards ORDER BY shard_id'):
        result.update((json.dumps(list(row), separators=(',', ':')) + '\n').encode())
    return result.hexdigest()


def check_revision(root, db, revision, contract):
    require(revision.replace('-', '').isalnum(), 'UNSAFE_REPAIR_REVISION')
    directory = root / 'semantic-revisions' / revision
    require((directory / 'recipe.json').is_file(), 'REPAIR_REVISION_MISSING')
    recipe = json.loads((directory / 'recipe.json').read_text())
    manifest = json.loads((directory / 'split-manifest.json').read_text())
    require(recipe['version'] == revision, 'REPAIR_RECIPE_REVISION_MISMATCH')
    require(sha256_path(contract) == recipe['contract_sha256'], 'REPAIR_CONTRACT_CHANGED')
    require(digest({k: v for k, v in manifest.items() if k != 'digest'}) == manifest['digest']
            == recipe['split_digest'], 'REPAIR_SPLIT_MANIFEST_CHANGED')
    repo = Path(__file__).resolve().parents[2]
    require(all(sha256_path(repo / path) == expected for path, expected in recipe['code_hashes'].items()),
            'REPAIR_WRITER_CODE_CHANGED')
    state = dict(db.execute('SELECT key,value FROM state'))
    require(state.get('semantic_repair_revision') == revision, 'REPAIR_REVISION_NOT_ACTIVE')
    rows = list(db.execute('SELECT * FROM semantic_repair_scores WHERE revision=?', (revision,)))
    assignments = {row['score_id']: row for row in manifest['scores']}
    require(rows and len(assignments) == len(manifest['scores']) == len(rows)
            and {row['score_id'] for row in rows} == set(assignments), 'REPAIR_LEDGER_COVERAGE')
    require(all(row['status'] == 'COMPLETE' for row in rows), 'REPAIR_INCOMPLETE')
    require(not list((directory / 'staging').glob('*')), 'UNRESOLVED_REPAIR_STAGING')
    require(not list((root / 'semantic-shards').glob('*.partial')), 'UNRESOLVED_SHARD_STAGING')
    accepted = {r[0] for r in db.execute("SELECT score_id FROM scores WHERE job_state='COMPLETE'")}
    require(set(assignments) == accepted, 'REPAIR_ACCEPTED_SCORE_COVERAGE')
    ranks = {'train': 0, 'validation': 1, 'test': 2, 'future-test': 3}
    for row in rows:
        assignment = assignments[row['score_id']]
        require(assignment['split'] in ranks and assignment['before'] in ranks
                and ranks[assignment['split']] >= ranks[assignment['before']], 'REPAIR_HOLDOUT_DEMOTION')
        progress = db.execute('SELECT status,examples FROM semantic_score_progress WHERE score_id=?',
                              (row['score_id'],)).fetchone()
        actual = db.execute('SELECT COUNT(*),MIN(split),MAX(split) FROM semantic_examples WHERE score_id=?',
                            (row['score_id'],)).fetchone()
        require(progress and progress['status'] == 'COMPLETE'
                and progress['examples'] == actual[0] == row['expected_examples'] == assignment['examples'],
                'REPAIR_SCORE_TOTALS_MISMATCH')
        require(actual[1] == actual[2] == assignment['split'], 'REPAIR_SCORE_SPLIT_MISMATCH')
    return {'revision': revision, 'complete_scores': len(rows), 'recipe_digest': digest(recipe),
            'split_manifest_digest': manifest['digest'], 'contract_sha256': recipe['contract_sha256'],
            'shard_inventory_digest': shard_inventory_digest(db), 'staging_empty': True}


def check_repair_audit(report, root, revision, binding, contract, baseline, semantic):
    require(report['factory_directory'] == str(root) and report['revision'] == revision
            and report['recipe_digest'] == binding['recipe_digest']
            and report['shard_inventory_digest'] == binding['shard_inventory_digest'], 'REPAIR_AUDIT_BINDING')
    require(report['contract_digest'] == json.loads(contract.read_text())['configurationDigest'],
            'REPAIR_AUDIT_CONTRACT')
    require(report['physical']['database_tables_unchanged'], 'PHYSICAL_TABLES_CHANGED')
    require(report['decoded_pages'] > 0 and report['decoded_page_overlaps'] == 0, 'DECODED_PAGE_LEAKAGE')
    current, written = report['semantic'], report['written']
    require(written['valid'] and not written['errors']
            and written['scores'] == binding['complete_scores'], 'WRITTEN_NOTATION_AUDIT_FAILED')
    families = current['families']
    require(set(families) == set(FAMILIES), 'SEMANTIC_FAMILY_MISSING')
    require(families['REST'].get('KNOWN', 0) > 0 and current['known_rest_source_coordinate_errors'] == 0
            and written['rests_checked'] == families['REST']['KNOWN'], 'TRUSTED_REST_SUPERVISION_MISSING')
    require(written['tuplets_checked'] == families['TUPLET'].get('KNOWN', 0), 'TUPLET_AUDIT_COVERAGE')
    for family in FAMILIES:
        if baseline['families'][family].get('KNOWN', 0):
            require(families[family].get('KNOWN', 0) > 0, 'KNOWN_FAMILY_SUPERVISION_MISSING:' + family)
    require((current['examples'], current['known_labels'], current['shards'])
            == (semantic['examples'], semantic['semanticLabels'], semantic['shards']), 'AUDIT_SEMANTIC_TOTALS_MISMATCH')
    require(report['valid'] and not report['errors'] and current['valid'] and not current['errors'],
            'REPAIR_AUDIT_FAILED:' + repr(report['errors']))


def finalize(root, revision, contract, csv, pdf_archive, mxl_archive, baseline_dir, output, free_floor_gib=20):
    root, contract, output = Path(root).resolve(), Path(contract).resolve(), Path(output).resolve()
    baseline_dir = Path(baseline_dir).resolve()
    require((root / 'factory.sqlite3').is_file(), 'FACTORY_DATABASE_MISSING')
    # A new output directory preserves every previous audit and failed attempt.
    output.mkdir(parents=True, exist_ok=False)
    report = {'schemaVersion': 1, 'kind': 'POST_REPAIR_FINALIZATION', 'revision': revision,
              'factory_directory': str(root), 'started_at': utc_now(), 'human_review_complete': False,
              'training_started': False, 'checks': {}, 'status': 'RUNNING'}

    def stage(name):
        report['stage'] = name
        report['free_bytes'] = shutil.disk_usage(root).free
        require(report['free_bytes'] >= free_floor_gib * 1024**3 + 128 * 1024**2, 'DISK_BLOCKER: finalization reserve')
        save(output / 'progress.json', report)
        print(json.dumps({'stage': name, 'timestamp': utc_now(), 'free_bytes': report['free_bytes']}), flush=True)

    with pipeline_guard(root):
        semantic = SemanticFactory(root, contract, free_floor_gib=free_floor_gib)
        try:
            db = semantic.db
            report['previous_states'] = dict(db.execute("SELECT key,value FROM state WHERE key IN ('semantic_build_state','full_build_state','semantic_last_error')"))
            with db:
                db.executemany('INSERT OR REPLACE INTO state VALUES(?,?)',
                               [('semantic_build_state', 'RUNNING'), ('full_build_state', 'RUNNING'), ('validation_report', '{}')])
            stage('repair_completion')
            require(physical_complete(root), 'PHYSICAL_FACTORY_NOT_COMPLETE')
            binding = check_revision(root, db, revision, contract)
            report['binding'] = binding
            report['checks']['repair_complete'] = True
            stage('current_semantic_validation')
            semantic_result = semantic.validate()
            save(output / 'semantic-validation.json', semantic_result)
            require(semantic_result['valid'] and not semantic_result['errors']
                    and not semantic_result['assemblyErrorCount'] and semantic_result['futureHeldoutReserved']
                    and semantic_result['wholeScoreSplitIsolation'] and semantic_result['semanticSourceSplitIsolation'],
                    'SEMANTIC_VALIDATION_FAILED:' + repr(semantic_result['errors']))
            report['checks']['semantic_validation'] = True
            stage('independent_repair_audit')
            audit_dir = output / 'audit'; audit_dir.mkdir()
            for name in ('baseline-semantic-audit.json', 'physical-db-manifest.jsonl.sha256'):
                shutil.copyfile(baseline_dir / name, audit_dir / name)
            # Fresh hashes, pixels and written-notation checks. This never calls
            # assemble(), _process_score(), or any repair/emission operation.
            audited = audit(root, audit_dir, contract, mxl_archive, revision)
            baseline = json.loads((audit_dir / 'baseline-semantic-audit.json').read_text())
            check_repair_audit(audited, root, revision, binding, contract, baseline, semantic_result)
            report['checks']['independent_repair_audit'] = True
            report['physical'] = audited['physical']
            report['semantic'] = audited['semantic']
            report['written'] = audited['written']
            report['decoded_pages'] = audited['decoded_pages']
            report['decoded_page_overlaps'] = audited['decoded_page_overlaps']
            stage('generic_dataset_validation')
            factory = Factory(root, csv, pdf_archive, mxl_archive, free_floor_gib=free_floor_gib)
            try:
                generic = factory.validate_dataset()
            finally:
                factory.close()
            save(output / 'dataset-validation.json', generic)
            require(generic['valid'] and not generic['errors'], 'DATASET_VALIDATION_FAILED:' + repr(generic['errors']))
            report['checks']['dataset_validation'] = True
            stage('loader_evaluation')
            loader = evaluate_loader(root)
            save(output / 'loader-evaluation.json', loader)
            require(loader['futureTestReadByTrainer'] is False, 'LOADER_FUTURE_TEST_RESERVATION')
            require(set(loader['splits']) == {'train', 'validation', 'test', 'future-test'}, 'LOADER_SPLITS_MISSING')
            for split, actual in loader['splits'].items():
                expected = audited['semantic']['split_counts'].get(split, {'examples': 0, 'scores': 0, 'sources': 0})
                require((actual['examples'], actual['scores'], actual['semanticSources'])
                        == (expected['examples'], expected['scores'], expected['sources']), 'LOADER_COUNTS_MISMATCH:' + split)
            report['checks']['loader_evaluation'] = True
            stage('publish_validated_revision')
            require(check_revision(root, db, revision, contract) == binding, 'REVISION_CHANGED_DURING_FINALIZATION')
            require([row[0] for row in db.execute('PRAGMA quick_check')] == ['ok']
                    and not db.execute('PRAGMA foreign_key_check').fetchall(), 'DATABASE_INTEGRITY')
            report['checks']['database_integrity'] = True
            evidence = ['semantic-validation.json', 'dataset-validation.json', 'loader-evaluation.json',
                        'audit/full-repair-audit.json', 'audit/baseline-semantic-audit.json', 'audit/physical-db-manifest.jsonl.sha256']
            report['artifacts'] = {name: sha256_path(output / name) for name in evidence}
            report['validator_sha256'] = sha256_path(Path(__file__))
            report['completed_at'] = utc_now()
            report['status'] = 'OBJECTIVE_CHECKS_PASSED'
            # Persist the evidence before publishing COMPLETE. The DB commits
            # both states and the exact attestation reference in one transaction.
            attestation = output / 'post-repair-finalization-v1.json'
            save(attestation, report)
            with db:
                db.executemany('INSERT OR REPLACE INTO state VALUES(?,?)', [
                    ('semantic_build_state', 'COMPLETE'), ('full_build_state', 'COMPLETE'), ('semantic_last_error', ''),
                    ('semantic_repair_finalization', json.dumps({'path': str(attestation), 'sha256': sha256_path(attestation),
                                                              'revision': revision, 'completed_at': report['completed_at']}, sort_keys=True))])
            db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            return report
        except BaseException as error:
            with semantic.db:
                semantic.db.executemany('INSERT OR REPLACE INTO state VALUES(?,?)', [
                    ('semantic_build_state', 'FAILED'), ('full_build_state', 'FAILED'),
                    ('semantic_repair_finalization_error', str(error)[:4096])])
            report.update(status='BLOCKED', error=repr(error), failed_at=utc_now())
            save(output / 'blocked.json', report)
            raise
        finally:
            semantic.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('factory-dir', 'revision', 'model-contract', 'csv', 'pdf-archive', 'mxl-archive', 'baseline-dir', 'output'):
        parser.add_argument('--' + flag, required=True)
    parser.add_argument('--disk-floor-gib', type=float, default=20)
    args = parser.parse_args()
    if args.disk_floor_gib < 20:
        parser.error('The production disk floor must be at least 20 GiB')
    result = finalize(args.factory_dir, args.revision, args.model_contract, args.csv, args.pdf_archive,
                      args.mxl_archive, args.baseline_dir, args.output, args.disk_floor_gib)
    print(json.dumps({'status': result['status'], 'revision': result['revision'], 'checks': result['checks']}, sort_keys=True))
