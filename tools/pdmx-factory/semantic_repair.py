"""Repair only derived semantics, atomically replacing one score at a time.

Old shards stay registered and on disk until a bounded, resumable staging
emitter finishes the score. One main-DB transaction swaps the indexes; only
then may the proven superseded files be reclaimed. Raw/canonical inputs never
change. Archive members are read in memory, one at a time, without extraction.
"""
import argparse
import fcntl
import gzip
import hashlib
import io
import json
import os
import shutil
import signal
import sqlite3
import subprocess
import tarfile
import time
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from contextlib import closing

from factory import sha256_path, utc_now
from semantic_factory import SemanticFactory, iter_jsonl
from semantic_streaming import digest, sync_directory
from streaming_json import canonical_scopes
from worker_guard import physical_complete, pipeline_guard

CODE_FILES = ['tools/pdmx-factory/semantic_repair.py', 'tools/pdmx-factory/semantic-repair-worker.mjs',
    'tools/pdmx-factory/semantic_streaming.py', 'tools/pdmx-factory/semantic_factory.py',
    'tools/pdmx-factory/content_splits.py', 'tools/semantic-gold/assembler.mjs',
    'tools/semantic-gold/tuplet-structure.mjs', 'tools/semantic-gold/rest-alignment.mjs',
    'tools/semantic-gold/repair-scope.mjs']


def read_written_xml(payload):
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        root = None
        if 'META-INF/container.xml' in archive.namelist():
            for node in ET.fromstring(archive.read('META-INF/container.xml')).iter():
                if node.tag.rsplit('}', 1)[-1] == 'rootfile':
                    root = node.get('full-path'); break
        if not root:
            roots = [n for n in archive.namelist() if n.endswith(('.xml', '.musicxml')) and not n.startswith('META-INF/')]
            if len(roots) != 1: raise ValueError('AMBIGUOUS_MUSICXML_ROOT')
            root = roots[0]
        if archive.getinfo(root).file_size > 64 * 1024**2: raise ValueError('MUSICXML_EXCEEDS_BOUNDED_SCORE_LIMIT')
        return archive.read(root).decode('utf-8-sig')


class ScoreRepairEmitter(SemanticFactory):
    def __init__(self, stage, contract, main_root, revision, split, first_shard, recipe, xml_hash, rpc, disk_observer=None, **kwargs):
        super().__init__(stage, contract, **kwargs)
        self.shard_dir = Path(main_root) / 'semantic-shards'
        self.revision, self.assigned_split, self.first_shard = revision, split, first_shard
        self.recipe, self.xml_hash, self.rpc = recipe, xml_hash, rpc
        self.disk_observer = disk_observer

    def _disk_check(self, reserve=0):
        super()._disk_check(reserve)
        if self.disk_observer: self.disk_observer(reserve)

    def _next_shard_id(self):
        return max(self.first_shard, super()._next_shard_id())

    def _shard_path(self, shard_id, split):
        return self.shard_dir / f'semantic-{self.revision}-{split}-{shard_id:05d}.jsonl.gz'

    def _split_for_score(self, score_id):
        return self.assigned_split

    def _input_fingerprint(self, row, target_path, target_exists):
        return digest({'frozen_input': super()._input_fingerprint(row, target_path, target_exists),
                       'recipe': self.recipe, 'written_xml': self.xml_hash, 'split': self.assigned_split})

    def _transform_scope(self, source, target):
        result = self.rpc({'command': 'scope', 'source': source, 'target': target})
        # The repair contract changes only REST and TUPLET target families.
        for family, labels in target['families'].items():
            if family not in ('REST', 'TUPLET') and labels != result['target']['families'][family]:
                raise ValueError('UNRELATED_SEMANTIC_FAMILY_CHANGED:' + family)
        count = len(source['modelInput']['physicalObjects'])
        if source['modelInput']['physicalObjects'] != result['source']['modelInput']['physicalObjects'][:count]:
            raise ValueError('FROZEN_PHYSICAL_OBJECT_CHANGED')
        return result['source'], result['target']


class SemanticRepair:
    def __init__(self, root, contract, split_manifest, revision, free_floor_gib=20, event_hook=None):
        self.root, self.contract = Path(root).resolve(), Path(contract).resolve()
        if not revision.replace('-', '').isalnum(): raise ValueError('Unsafe revision')
        self.revision, self.event_hook = revision, event_hook
        self.floor = int(free_floor_gib * 1024**3)
        self.db = sqlite3.connect(self.root / 'factory.sqlite3')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('PRAGMA synchronous=FULL; PRAGMA fullfsync=ON; PRAGMA cache_size=-4096; PRAGMA temp_store=FILE;')
        self.directory = self.root / 'semantic-revisions' / revision
        self.directory.mkdir(parents=True, exist_ok=True)
        manifest = json.loads(Path(split_manifest).read_text())
        supplied_digest = manifest.pop('digest')
        if digest(manifest) != supplied_digest: raise ValueError('SPLIT_MANIFEST_DIGEST_MISMATCH')
        manifest['digest'] = supplied_digest
        if manifest['after_cross_split_overlaps'] != 0: raise ValueError('REPAIRED_SPLITS_NOT_ISOLATED')
        self.assignments = {row['score_id']: row for row in manifest['scores']}
        repo = Path(__file__).resolve().parents[2]
        self.recipe = {'version': revision, 'split_digest': supplied_digest,
                       'code_hashes': {p: sha256_path(repo / p) for p in CODE_FILES},
                       'contract_sha256': sha256_path(self.contract)}
        self.recipe_digest = digest(self.recipe)
        self.manifest = manifest
        self.node = None
        self.min_free = shutil.disk_usage(root).free
        progress_path = self.directory / 'progress.json'
        if progress_path.exists():
            self.min_free = min(self.min_free, json.loads(progress_path.read_text())['minimum_observed_free_bytes'])

    def check_disk(self, reserve=128 * 1024**2):
        free = shutil.disk_usage(self.root).free
        self.min_free = min(self.min_free, free)
        if free < self.floor + reserve: raise RuntimeError('DISK_BLOCKER: repair floor plus bounded score reserve')
        return free

    def event(self, name):
        if self.event_hook: self.event_hook(name, self)

    def rpc(self, value):
        if self.node is None:
            self.node = subprocess.Popen(['node', '--max-old-space-size=768', str(Path(__file__).with_name('semantic-repair-worker.mjs'))],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        self.node.stdin.write(json.dumps(value, separators=(',', ':')) + '\n'); self.node.stdin.flush()
        line = self.node.stdout.readline()
        if not line: raise RuntimeError('SEMANTIC_REPAIR_WORKER_EXITED')
        result = json.loads(line)
        if 'error' in result: raise RuntimeError(result['error'])
        return result

    def initialize(self):
        self.check_disk()
        recipe_path = self.directory / 'recipe.json'
        if recipe_path.exists():
            if json.loads(recipe_path.read_text()) != self.recipe: raise ValueError('REPAIR_RECIPE_CHANGED: use a new reviewed revision')
        else:
            for path, value in [(recipe_path, self.recipe), (self.directory / 'split-manifest.json', self.manifest)]:
                with path.open('x') as stream:
                    json.dump(value, stream, sort_keys=True, indent=2); stream.flush(); os.fsync(stream.fileno())
            sync_directory(self.directory)
        snapshot = self.directory / 'historical-semantic-index.jsonl.gz'
        if not snapshot.exists():
            partial = snapshot.with_suffix('.partial')
            with partial.open('wb') as raw:
                with gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0) as out:
                    for table in ('semantic_examples', 'semantic_shards', 'semantic_score_progress', 'semantic_totals', 'semantic_identities'):
                        for row in self.db.execute('SELECT * FROM ' + table + ' ORDER BY 1'):
                            self.check_disk()
                            out.write((json.dumps({'table': table, 'row': dict(row)}, separators=(',', ':')) + '\n').encode())
                raw.flush(); os.fsync(raw.fileno())
            os.replace(partial, snapshot); sync_directory(self.directory)
            (self.directory / 'historical-semantic-index.sha256').write_text(sha256_path(snapshot) + '\n')
        self.db.executescript('''CREATE TABLE IF NOT EXISTS semantic_repair_scores(
            revision TEXT,score_id TEXT,mxl_member TEXT,status TEXT,first_shard INTEGER,
            old_shards TEXT,canonical_hash TEXT,target_hash TEXT,mxl_hash TEXT,
            expected_examples INTEGER,updated_at TEXT,PRIMARY KEY(revision,score_id));
            CREATE INDEX IF NOT EXISTS repair_member ON semantic_repair_scores(revision,mxl_member);
        ''')
        with self.db:
            for score, assignment in self.assignments.items():
                row = self.db.execute('SELECT mxl_member FROM scores WHERE score_id=?', (score,)).fetchone()
                if not row: raise ValueError('REPAIR_SCORE_MISSING')
                self.db.execute('INSERT OR IGNORE INTO semantic_repair_scores VALUES(?,?,?,\'PENDING\',NULL,NULL,NULL,NULL,NULL,?,?)',
                    (self.revision, score, row[0], assignment['examples'], utc_now()))
            self.db.execute("INSERT OR REPLACE INTO state VALUES('semantic_build_state','RUNNING')")
            self.db.execute("INSERT OR REPLACE INTO state VALUES('semantic_repair_revision',?)", (self.revision,))
            self.db.execute("INSERT OR REPLACE INTO state VALUES('validation_report','{}')")
        self.event('initialized')

    def stage_path(self, score):
        return self.directory / 'staging' / hashlib.sha256(score.encode()).hexdigest()[:24]

    def reclaim(self, row):
        if row['status'] != 'COMPLETE': return
        # Recheck replacement durability before deleting any superseded file.
        for path, expected in self.db.execute('SELECT DISTINCT s.path,s.sha256 FROM semantic_shards s JOIN semantic_examples e USING(shard_id) WHERE e.score_id=?', (row['score_id'],)):
            if sha256_path(path) != expected: raise ValueError('REPLACEMENT_HASH_CHANGED')
        for shard in json.loads(row['old_shards'] or '[]'):
            path = Path(shard['path'])
            if path.parent != self.root / 'semantic-shards': raise ValueError('UNSAFE_RECLAIM_PATH')
            if self.db.execute('SELECT 1 FROM semantic_shards WHERE path=?', (str(path),)).fetchone():
                raise ValueError('REFUSE_RECLAIM_REGISTERED_SHARD')
            if path.exists():
                if sha256_path(path) != shard['sha256']: raise ValueError('RETIRED_SHARD_HASH_CHANGED')
                path.unlink()
        sync_directory(self.root / 'semantic-shards')
        stage = self.stage_path(row['score_id'])
        if stage.exists(): shutil.rmtree(stage)

    def repair_score(self, record, payload):
        score = record['score_id']
        row = self.db.execute('SELECT * FROM canonical WHERE score_id=?', (score,)).fetchone()
        original = self.db.execute('SELECT * FROM scores WHERE score_id=?', (score,)).fetchone()
        metadata = json.loads(original['metadata_json'])
        target = Path(metadata['target_bundle'])
        if not target.is_absolute(): raise ValueError('Repair requires resolved original target path')
        canonical_hash, target_hash, mxl_hash = sha256_path(row['path']), sha256_path(target), hashlib.sha256(payload).hexdigest()
        if canonical_hash != row['sha256']: raise ValueError('CANONICAL_HASH_MISMATCH')
        # Read provenance only, one bounded canonical score, to verify raw member identity.
        with gzip.open(row['path'], 'rt') as stream:
            canonical = json.load(stream)
        if canonical['provenance']['mxlSha256'] != mxl_hash: raise ValueError('ARCHIVE_MEMBER_HASH_MISMATCH')
        del canonical
        xml = read_written_xml(payload)
        xml_hash = hashlib.sha256(xml.encode()).hexdigest()
        scopes = []
        for source in canonical_scopes(row['path']):
            md = source['metadata']
            scopes.append({'metadata': {k: md[k] for k in ('groupId', 'scopeId', 'page')}, 'modelInput': {
                'geometry': source['modelInput']['geometry'], 'sourceGraph': {'sourceScope': source['modelInput']['sourceGraph'].get('sourceScope')}}})
        self.rpc({'command': 'score', 'xml': xml, 'scopes': scopes})
        del xml, scopes
        if record['status'] == 'PENDING':
            old = [dict(s) for s in self.db.execute('SELECT DISTINCT s.* FROM semantic_shards s JOIN semantic_examples e USING(shard_id) WHERE e.score_id=? ORDER BY s.shard_id', (score,))]
            for shard in old:
                if sha256_path(shard['path']) != shard['sha256']: raise ValueError('OLD_SHARD_CORRUPT')
                if any(ex['scoreId'] != score for ex in iter_jsonl(shard['path'])): raise ValueError('NON_SCORE_LOCAL_LEGACY_SHARD')
            self.check_disk(max(128 * 1024**2, sum(Path(s['path']).stat().st_size for s in old) * 4))
            first = self.db.execute('SELECT COALESCE(MAX(shard_id),-1)+1 FROM semantic_shards').fetchone()[0]
            with self.db:
                self.db.execute('UPDATE semantic_repair_scores SET status=\'STAGING\',first_shard=?,old_shards=?,canonical_hash=?,target_hash=?,mxl_hash=?,updated_at=? WHERE revision=? AND score_id=?',
                    (first, json.dumps(old), canonical_hash, target_hash, mxl_hash, utc_now(), self.revision, score))
            record = self.db.execute('SELECT * FROM semantic_repair_scores WHERE revision=? AND score_id=?', (self.revision, score)).fetchone()
        if (record['canonical_hash'], record['target_hash'], record['mxl_hash']) != (canonical_hash, target_hash, mxl_hash):
            raise ValueError('REPAIR_INPUT_CHANGED')
        stage = self.stage_path(score); stage.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(stage / 'factory.sqlite3')) as db, db:
            for table in ('scores', 'state'):
                exists = db.execute('SELECT 1 FROM sqlite_master WHERE name=?', (table,)).fetchone()
                if not exists:
                    db.execute(self.db.execute('SELECT sql FROM sqlite_master WHERE name=?', (table,)).fetchone()[0])
            db.execute('INSERT OR IGNORE INTO scores VALUES(' + ','.join('?' for _ in original) + ')', tuple(original))
        emitter = ScoreRepairEmitter(stage, self.contract, self.root, self.revision, self.assignments[score]['split'],
            record['first_shard'], self.recipe_digest, xml_hash, self.rpc, free_floor_gib=self.floor / 1024**3,
            event_hook=lambda name, worker: self.event('stage_' + name),
            disk_observer=lambda reserve: self.check_disk(max(reserve, 128 * 1024**2)))
        try:
            emitter._process_score(row)
            result = emitter.validate()
            if not result['valid'] or result['examples'] != record['expected_examples'] or result['assemblyErrorCount']:
                raise ValueError('STAGED_SCORE_VALIDATION_FAILED:' + str(result))
        finally:
            emitter.close()
        self.event('score_staged')
        self.check_disk()
        self.db.execute('ATTACH DATABASE ? AS repaired', (str(stage / 'factory.sqlite3'),))
        try:
            with self.db:
                old = json.loads(record['old_shards'])
                old_split, old_count, old_labels = self.db.execute(
                    'SELECT split,COUNT(*),SUM(labels) FROM semantic_examples WHERE score_id=? GROUP BY split', (score,)).fetchone()
                sources = [r[0] for r in self.db.execute('SELECT identity FROM repaired.semantic_identities WHERE kind=\'source\'')]
                self.db.execute('DELETE FROM semantic_examples WHERE score_id=?', (score,))
                for shard in old: self.db.execute('DELETE FROM semantic_shards WHERE shard_id=?', (shard['shard_id'],))
                self.db.execute('DELETE FROM semantic_score_progress WHERE score_id=?', (score,))
                self.db.execute('DELETE FROM semantic_assembly_errors WHERE score_id=?', (score,))
                self.db.execute('DELETE FROM semantic_identities WHERE kind=\'score\' AND identity=?', (score,))
                for source in sources: self.db.execute('DELETE FROM semantic_identities WHERE kind=\'source\' AND identity=?', (source,))
                for table in ('semantic_examples', 'semantic_shards', 'semantic_score_progress', 'semantic_identities'):
                    self.db.execute('INSERT INTO ' + table + ' SELECT * FROM repaired.' + table)
                self.db.execute('UPDATE semantic_totals SET examples=examples-?,labels=labels-?,shards=shards-? WHERE split=?',
                                (old_count, old_labels, len(old), old_split))
                for split, examples, labels, shards in self.db.execute('SELECT * FROM repaired.semantic_totals'):
                    self.db.execute('''INSERT INTO semantic_totals VALUES(?,?,?,?) ON CONFLICT(split) DO UPDATE SET
                        examples=examples+excluded.examples,labels=labels+excluded.labels,shards=shards+excluded.shards''',
                        (split, examples, labels, shards))
                self.db.execute('UPDATE semantic_repair_scores SET status=\'COMPLETE\',updated_at=? WHERE revision=? AND score_id=?', (utc_now(), self.revision, score))
                self.event('before_swap_commit')
            self.event('swap_committed')
        finally:
            self.db.execute('DETACH DATABASE repaired')
        record = self.db.execute('SELECT * FROM semantic_repair_scores WHERE revision=? AND score_id=?', (self.revision, score)).fetchone()
        self.reclaim(record)
        self.event('reclaimed')

    def run(self, mxl_archive, max_scores=None):
        self.initialize()
        for row in self.db.execute('SELECT * FROM semantic_repair_scores WHERE revision=? AND status=\'COMPLETE\'', (self.revision,)):
            if self.stage_path(row['score_id']).exists(): self.reclaim(row)
        done = 0
        with tarfile.open(mxl_archive, 'r|gz') as stream:
            for member in stream:
                record = self.db.execute('SELECT * FROM semantic_repair_scores WHERE revision=? AND mxl_member=?', (self.revision, member.name.removeprefix('./'))).fetchone()
                if not record or record['status'] == 'COMPLETE': continue
                self.check_disk()
                if not member.isfile() or member.size > 64 * 1024**2: raise ValueError('UNSAFE_OR_OVERSIZED_MXL_MEMBER')
                self.repair_score(record, stream.extractfile(member).read())
                done += 1
                if done % 50 == 0:
                    self.progress()
                if max_scores and done >= max_scores: break
        if not max_scores and self.db.execute("SELECT COUNT(*) FROM semantic_repair_scores WHERE revision=? AND status!='COMPLETE'", (self.revision,)).fetchone()[0]:
            raise ValueError('REPAIR_ARCHIVE_MEMBERS_MISSING')
        return self.progress()

    def progress(self):
        states = dict(self.db.execute('SELECT status,COUNT(*) FROM semantic_repair_scores WHERE revision=? GROUP BY status', (self.revision,)))
        with self.db:
            self.db.execute('DELETE FROM semantic_totals')
            self.db.execute('''INSERT INTO semantic_totals SELECT e.split,COUNT(*),SUM(e.labels),
                (SELECT COUNT(*) FROM semantic_shards s WHERE s.split=e.split) FROM semantic_examples e GROUP BY e.split''')
        result = {'revision': self.revision, 'scores': states, 'minimum_observed_free_bytes': self.min_free,
                  'free_bytes': self.check_disk(), 'timestamp': utc_now(), 'state': 'REPAIR_REGENERATED_PENDING_FULL_AUDIT' if set(states) == {'COMPLETE'} else 'REPAIR_IN_PROGRESS'}
        (self.directory / 'progress.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result), flush=True)
        return result

    def close(self):
        if self.node is not None:
            self.node.stdin.close()
            try: self.node.wait(timeout=10)
            except subprocess.TimeoutExpired: self.node.terminate(); self.node.wait(timeout=10)
        self.db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--factory-dir', required=True)
    parser.add_argument('--model-contract', required=True)
    parser.add_argument('--split-manifest', required=True)
    parser.add_argument('--mxl-archive', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--max-scores', type=int)
    args = parser.parse_args()
    if not physical_complete(args.factory_dir): raise RuntimeError('PHYSICAL_FACTORY_NOT_COMPLETE')
    def stop(*_): raise KeyboardInterrupt('graceful semantic repair stop')
    signal.signal(signal.SIGTERM, stop)
    with pipeline_guard(args.factory_dir):
        with (Path(args.factory_dir) / 'semantic-worker.lock').open('a+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            repair = SemanticRepair(args.factory_dir, args.model_contract, args.split_manifest, args.revision)
            try:
                repair.run(args.mxl_archive, args.max_scores)
            except BaseException:
                repair.db.rollback()
                with repair.db: repair.db.execute("INSERT OR REPLACE INTO state VALUES('semantic_build_state','PAUSED')")
                raise
            finally: repair.close()


if __name__ == '__main__': main()
