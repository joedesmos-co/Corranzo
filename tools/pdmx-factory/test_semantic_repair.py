"""Destructive interruption tests use only newly constructed temporary factories."""
import gzip
import hashlib
import io
import json
import sqlite3
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from content_splits import component_splits
from factory import sha256_path
from semantic_repair import SemanticRepair
from semantic_streaming import digest
from test_semantic_streaming import fixture, open_semantic, snapshot


class FixtureRepair(SemanticRepair):
    def rpc(self, message):
        if message['command'] == 'score': return {'ready': True}
        # Target semantics have separate JS regressions; exercise transactional
        # replacement here with a deterministic synthetic target change.
        source, target = message['source'], message['target']
        target['families']['TUPLET'][0]['state'] = 'UNAVAILABLE'
        return {'source': source, 'target': target}


def setup(root):
    contract = fixture(root, scores=3, scopes=9, zero=False)
    archive = root / 'mxl.tar.gz'
    with sqlite3.connect(root / 'factory.sqlite3') as db, tarfile.open(archive, 'w:gz') as tar:
        for score, path in db.execute('SELECT score_id,path FROM canonical ORDER BY score_id'):
            raw = io.BytesIO()
            with zipfile.ZipFile(raw, 'w') as zip:
                zip.writestr('score.xml', '<score-partwise/>')
            payload = raw.getvalue()
            info = tarfile.TarInfo(score + '.mxl'); info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))
            with gzip.open(path, 'rt') as stream: canonical = json.load(stream)
            canonical['provenance'] = {'mxlSha256': hashlib.sha256(payload).hexdigest()}
            for source in canonical['sourceAlignment']['scopes']:
                source['metadata'].update(groupId=score, scopeId=source['metadata']['exampleId'], page=1)
                source['modelInput']['geometry'] = {'scopeBounds': {}, 'pageTransform': {}}
            with gzip.open(path, 'wt') as stream: json.dump(canonical, stream)
            db.execute('UPDATE canonical SET sha256=? WHERE score_id=?', (sha256_path(path), score))
            db.execute('UPDATE scores SET mxl_member=? WHERE score_id=?', (info.name, score))
    emitter = open_semantic(root)
    try: emitter.assemble(100)
    finally: emitter.close()
    with sqlite3.connect(root / 'factory.sqlite3') as db:
        rows = [{'score_id': a, 'before': b, 'split': 'future-test', 'examples': c}
                for a, b, c in db.execute('SELECT score_id,split,COUNT(*) FROM semantic_examples GROUP BY score_id,split')]
    manifest = {'scores': rows, 'after_cross_split_overlaps': 0}
    manifest['digest'] = digest(manifest)
    plan = root / 'splits.json'; plan.write_text(json.dumps(manifest))
    return contract, archive, plan


class RepairTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='semantic-repair-regression-')
        self.root = Path(self.temp.name)
    def tearDown(self): self.temp.cleanup()

    def repair(self, root, hook=None):
        repair = FixtureRepair(root, root/'contract.json', root/'splits.json', 'repair-test', free_floor_gib=0, event_hook=hook)
        try: return repair.run(root/'mxl.tar.gz')
        finally: repair.close()

    def test_transitive_components_preserve_strictest_holdout(self):
        splits = {'a': 'train', 'b': 'validation', 'c': 'future-test', 'd': 'test', 'e': 'train'}
        links = [('a', 'b'), ('b', 'c'), ('d', 'e')]
        expected = component_splits(splits, links)
        self.assertEqual({k: r['split'] for k, r in expected.items()}, {'a':'future-test','b':'future-test','c':'future-test','d':'test','e':'test'})
        self.assertEqual(expected, component_splits(dict(reversed(list(splits.items()))), reversed(links)))

    def test_stage_and_swap_interruptions_preserve_and_resume(self):
        reference = self.root/'reference'; setup(reference); self.repair(reference)
        expected = snapshot(reference)[0]
        for stage in ('stage_shard_published', 'score_staged', 'before_swap_commit', 'swap_committed', 'reclaimed'):
            with self.subTest(stage=stage):
                root = self.root/stage; setup(root)
                original = snapshot(root)[0]
                with sqlite3.connect(root/'factory.sqlite3') as db:
                    old = [Path(r[0]) for r in db.execute('SELECT path FROM semantic_shards')]
                fired = []
                def hook(name, worker):
                    if name == stage and not fired:
                        fired.append(name)
                        raise KeyboardInterrupt('synthetic interruption')
                with self.assertRaises(KeyboardInterrupt): self.repair(root, hook)
                self.assertTrue(fired)
                if stage in ('stage_shard_published', 'score_staged', 'before_swap_commit'):
                    self.assertEqual(snapshot(root)[0], original)
                    self.assertTrue(all(p.exists() for p in old))
                self.repair(root)
                self.assertEqual(snapshot(root)[0], expected)
                self.assertTrue(all(not p.exists() for p in old))
                with sqlite3.connect(root/'factory.sqlite3') as db:
                    self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')

    def test_disk_refusal_and_recipe_change_leave_existing_data(self):
        root = self.root/'disk'; setup(root)
        before = snapshot(root)
        repair = FixtureRepair(root, root/'contract.json', root/'splits.json', 'repair-test', free_floor_gib=0)
        try:
            with patch.object(repair, 'check_disk', side_effect=RuntimeError('DISK_BLOCKER')):
                with self.assertRaisesRegex(RuntimeError, 'DISK_BLOCKER'): repair.run(root/'mxl.tar.gz')
            self.assertEqual(before, snapshot(root))
            repair.initialize()
        finally: repair.close()
        recipe = root/'semantic-revisions/repair-test/recipe.json'; recipe.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'RECIPE_CHANGED'): self.repair(root)
        self.assertEqual(before, snapshot(root))


if __name__ == '__main__': unittest.main()
