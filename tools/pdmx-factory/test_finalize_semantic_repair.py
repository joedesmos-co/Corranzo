"""Temporary repaired factories; only the expensive XML/pixel audit is stubbed.

The repair swap, semantic validator, dataset validator and loader all run on
real fixture files. Independent notation algorithms have their own JS tests.
"""
import collections
import gzip
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import finalize_semantic_repair as finalizer
from factory import Factory, sha256_path
from semantic_factory import SemanticFactory, iter_jsonl
from semantic_streaming import digest
from test_semantic_repair import FixtureRepair, setup
from test_semantic_streaming import snapshot


class FinalizationRepair(FixtureRepair):
    def rpc(self, message):
        result = super().rpc(message)
        if message['command'] == 'scope' and message['target']['metadata']['exampleId'].endswith('scope-1'):
            result['target']['families']['TUPLET'][0]['state'] = 'KNOWN'
        return result


class FinalizeRepairTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='repair-finalization-test-')
        self.root = Path(self.temp.name) / 'factory'
        self.contract, self.archive, plan_path = setup(self.root)
        plan = json.loads(plan_path.read_text())
        retained = next(row for row in plan['scores'] if row['before'] != 'future-test')
        retained['split'] = retained['before']
        plan['digest'] = digest({k: v for k, v in plan.items() if k != 'digest'})
        plan_path.write_text(json.dumps(plan))
        self.original = snapshot(self.root)
        repair = FinalizationRepair(self.root, self.contract, plan_path, 'repair-test', free_floor_gib=0)
        try:
            repair.run(self.archive)
        finally:
            repair.close()
        self.baseline = self.root / 'baseline'; self.baseline.mkdir()
        self.families = collections.defaultdict(collections.Counter)
        for example in self.original[0].values():
            for family, labels in example['target']['families'].items():
                self.families[family].update(label['state'] for label in labels)
        (self.baseline / 'baseline-semantic-audit.json').write_text(json.dumps({'families': self.families}))
        (self.baseline / 'physical-db-manifest.jsonl.sha256').write_text('fixture-physical-hash\n')
        self.output = self.root / 'finalization'
        self.report_change = lambda report: None

    def tearDown(self):
        self.temp.cleanup()

    def synthetic_audit(self, root, output, contract, archive, revision):
        examples, _, shards = snapshot(root)
        families = collections.defaultdict(collections.Counter)
        splits = {}
        for example in examples.values():
            for family, labels in example['target']['families'].items():
                families[family].update(label['state'] for label in labels)
            current = splits.setdefault(example['split'], {'examples': 0, 'scores': set(), 'sources': set()})
            current['examples'] += 1
            current['scores'].add(example['scoreId']); current['sources'].add(example['semanticSourceId'])
        for row in splits.values():
            row['scores'] = len(row['scores']); row['sources'] = len(row['sources'])
        recipe = json.loads((root / 'semantic-revisions' / revision / 'recipe.json').read_text())
        with closing(sqlite3.connect(root / 'factory.sqlite3')) as db:
            inventory = finalizer.shard_inventory_digest(db)
        report = {'valid': True, 'errors': [], 'factory_directory': str(root), 'revision': revision,
                  'recipe_digest': digest(recipe), 'shard_inventory_digest': inventory,
                  'contract_digest': 'frozen-test', 'physical': {'database_tables_unchanged': True},
                  'decoded_pages': 3, 'decoded_page_overlaps': 0,
                  'semantic': {'valid': True, 'errors': [], 'examples': len(examples), 'shards': len(shards),
                               'known_labels': sum(row['KNOWN'] for row in families.values()), 'families': families,
                               'known_rest_source_coordinate_errors': 0, 'split_counts': splits},
                  'written': {'valid': True, 'errors': [], 'scores': 3,
                              'tuplets_checked': families['TUPLET']['KNOWN'], 'rests_checked': families['REST']['KNOWN']}}
        self.report_change(report)
        finalizer.save(output / 'full-repair-audit.json', report)
        return report

    def run_finalizer(self, revision='repair-test'):
        with patch.object(finalizer, 'audit', side_effect=self.synthetic_audit), \
             patch.object(SemanticFactory, '_process_score', side_effect=AssertionError('ordinary fingerprint path invoked')), \
             patch.object(SemanticFactory, 'assemble', side_effect=AssertionError('assembler invoked')):
            return finalizer.finalize(self.root, revision, self.contract, self.root/'absent.csv',
                                      self.root/'absent.pdf.tar.gz', self.archive, self.baseline, self.output, free_floor_gib=0)

    def states(self):
        with closing(sqlite3.connect(self.root / 'factory.sqlite3')) as db:
            return dict(db.execute('SELECT key,value FROM state'))

    def assert_blocked(self, reason):
        with self.assertRaisesRegex(ValueError, reason):
            self.run_finalizer()
        self.assertEqual(self.states()['semantic_build_state'], 'FAILED')
        self.assertEqual(self.states()['full_build_state'], 'FAILED')
        self.assertFalse((self.output / 'post-repair-finalization-v1.json').exists())

    def test_changed_target_and_split_finalize_without_original_fingerprint_path(self):
        repaired = snapshot(self.root)
        self.assertNotEqual(self.original[0], repaired[0])
        self.assertNotEqual({key: e['split'] for key, e in self.original[0].items()},
                            {key: e['split'] for key, e in repaired[0].items()})
        worker = SemanticFactory(self.root, self.contract, free_floor_gib=0)
        try:
            row = worker.db.execute('SELECT * FROM canonical ORDER BY score_id LIMIT 1').fetchone()
            target = worker._target_bundle(row['score_id'])
            stored = worker.db.execute('SELECT input_digest FROM semantic_score_progress WHERE score_id=?', (row['score_id'],)).fetchone()[0]
            self.assertNotEqual(worker._input_fingerprint(row, target, True), stored)
        finally:
            worker.close()
        result = self.run_finalizer()
        self.assertEqual(snapshot(self.root), repaired)
        self.assertEqual(result['status'], 'OBJECTIVE_CHECKS_PASSED')
        states = self.states()
        self.assertEqual((states['semantic_build_state'], states['full_build_state']), ('COMPLETE', 'COMPLETE'))
        self.assertTrue(json.loads(states['validation_report'])['valid'])
        ref = json.loads(states['semantic_repair_finalization'])
        self.assertEqual(sha256_path(ref['path']), ref['sha256'])

    def test_incomplete_revision_refused(self):
        with closing(sqlite3.connect(self.root / 'factory.sqlite3')) as db, db:
            db.execute("UPDATE semantic_repair_scores SET status='PENDING' WHERE score_id=(SELECT MIN(score_id) FROM semantic_repair_scores)")
        self.assert_blocked('REPAIR_INCOMPLETE')

    def test_missing_revision_refused(self):
        with self.assertRaisesRegex(ValueError, 'REPAIR_REVISION_MISSING'):
            self.run_finalizer('missing-revision')
        self.assertEqual(self.states()['full_build_state'], 'FAILED')

    def test_unresolved_staging_refused(self):
        stage = self.root / 'semantic-revisions/repair-test/staging/incomplete-swap'
        stage.mkdir()
        self.assert_blocked('UNRESOLVED_REPAIR_STAGING')

    def test_corrupt_shard_refused(self):
        with closing(sqlite3.connect(self.root / 'factory.sqlite3')) as db:
            path = Path(db.execute('SELECT path FROM semantic_shards LIMIT 1').fetchone()[0])
        with path.open('ab') as stream:
            stream.write(b'corruption')
        self.assert_blocked('SEMANTIC_VALIDATION_FAILED')

    def test_missing_shard_refused(self):
        with closing(sqlite3.connect(self.root / 'factory.sqlite3')) as db:
            Path(db.execute('SELECT path FROM semantic_shards LIMIT 1').fetchone()[0]).unlink()
        self.assert_blocked('SEMANTIC_VALIDATION_FAILED')

    def test_db_target_digest_corruption_refused(self):
        with closing(sqlite3.connect(self.root / 'factory.sqlite3')) as db, db:
            db.execute("UPDATE semantic_examples SET target_digest='corrupt' WHERE example_id=(SELECT MIN(example_id) FROM semantic_examples)")
        self.assert_blocked('digest/index mismatch')

    def test_source_split_leakage_refused_with_correct_shard_hash(self):
        with closing(sqlite3.connect(self.root / 'factory.sqlite3')) as db, db:
            paths = dict(db.execute('SELECT split,MIN(path) FROM semantic_shards GROUP BY split'))
            self.assertGreater(len(paths), 1)
            split, path = next(iter(paths.items()))
            other = next(p for s, p in paths.items() if s != split)
            source = next(iter_jsonl(other))['semanticSourceId']
            examples = list(iter_jsonl(path)); examples[0]['semanticSourceId'] = source
            with gzip.open(path, 'wt') as stream:
                for example in examples: stream.write(json.dumps(example) + '\n')
            db.execute('UPDATE semantic_shards SET sha256=? WHERE path=?', (sha256_path(path), path))
        self.assert_blocked('semantic-source split overlap')

    def test_decoded_page_leakage_refused(self):
        self.report_change = lambda report: report.update(decoded_page_overlaps=1)
        self.assert_blocked('DECODED_PAGE_LEAKAGE')

    def test_invalid_written_tuplet_refused(self):
        self.report_change = lambda report: report['written'].update(valid=False, errors=['EXPLICIT_TUPLET_BOUNDARY_CONTRADICTION'])
        self.assert_blocked('WRITTEN_NOTATION_AUDIT_FAILED')

    def test_zero_trusted_rest_refused(self):
        self.report_change = lambda report: report['semantic']['families']['REST'].__setitem__('KNOWN', 0)
        self.assert_blocked('TRUSTED_REST_SUPERVISION_MISSING')

    def test_generic_validator_failure_never_publishes_complete(self):
        with patch.object(Factory, 'validate_dataset', return_value={'valid': False, 'errors': ['physical corrupt']}):
            self.assert_blocked('DATASET_VALIDATION_FAILED')

    def test_loader_failure_never_publishes_complete(self):
        with patch.object(finalizer, 'evaluate_loader', return_value={'futureTestReadByTrainer': True}):
            self.assert_blocked('LOADER_FUTURE_TEST_RESERVATION')


if __name__ == '__main__':
    unittest.main()
