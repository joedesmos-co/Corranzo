"""Bounded fixtures only: never construct a writer against the full factory."""

import gzip
import io
import json
import os
import resource
import sqlite3
import subprocess
import sys
import tempfile
import tracemalloc
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from contextlib import closing

sys.path.insert(0, str(Path(__file__).resolve().parent))
from factory import Factory, sha256_path, utc_now
from full_pipeline import run
from legacy_semantic_reference import LegacySemanticFactory
from semantic_factory import SemanticFactory, FAMILIES, SemanticExampleLoader, evaluate_loader, semantic_split
from streaming_json import JsonReader, canonical_scopes


def fixture(root, scores=5, scopes=9, padding=0, zero=True):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    contract = root / 'contract.json'
    contract.write_text(json.dumps({'scaleAuthorized': True, 'runtimeTruthInputs': [], 'configurationDigest': 'frozen-test'}))
    f = Factory(root, root/'absent.csv', root/'absent.pdf.tar.gz', root/'absent.mxl.tar.gz', free_floor_gib=0)
    for n in range(scores):
        score = f'score-{n:05d}'
        target = root / f'{score}.targets.jsonl.gz'
        canonical = root / 'canonical' / f'{score}.json.gz'
        count = 0 if zero and n == scores-1 else scopes
        with gzip.open(canonical, 'wt') as c, gzip.open(target, 'wt') as t:
            c.write('{"sourceAlignment":{"scopes":[')
            for i in range(count):
                eid = f'{score}:scope-{i}'
                source = {'metadata': {'exampleId': eid}, 'modelInput': {
                    'physicalObjects': [{'objectIndex': 0, 'kind': 'notehead', 'center': {'x': .1, 'y': .2}}],
                    'sourceGraph': {'nodes': [], 'edges': []}, 'padding': 'x'*padding,
                    'pixels': {'required': True},
                }}
                families = {family: [{'state': 'KNOWN', 'value': {'fraction': .125, 'ordinal': i}, 'isPositive': True},
                                     {'state': 'UNKNOWN', 'value': None}, {'state': 'AMBIGUOUS', 'value': {}}] for family in FAMILIES}
                if i:
                    c.write(',')
                c.write(json.dumps(source))
                t.write(json.dumps({'metadata': {'exampleId': eid, 'groupId': score}, 'families': families})+'\n')
            c.write(']},"unused":{"nested":[1,2,{"x":"y"}]}}')
        f.db.execute("INSERT INTO scores(score_id,csv_row,filter_state,job_state,metadata_json,updated_at) VALUES(?,?,?,?,?,?)",
                     (score,n,'ACCEPT_PIANO','COMPLETE',json.dumps({'target_bundle':str(target)}),utc_now()))
        f.db.execute('INSERT INTO canonical VALUES(?,?,?,?,?,?,?,?,?)', (score,str(canonical),sha256_path(canonical),'train',1,count,count,count,count))
        f.db.execute('INSERT INTO build_plan VALUES(?,?,?)', (score,n,utc_now()))
    f.db.commit()
    for key,value in {'metadata_cursor':str(scores),'metadata_total_rows':str(scores),'preflight_state':'COMPLETE','model_contract_valid':'true'}.items():
        f.set_state(key,value)
    f.close()
    return contract


def open_semantic(root, cls=SemanticFactory, **kwargs):
    return cls(root, Path(root)/'contract.json', shard_size=4, free_floor_gib=0, **kwargs)


def snapshot(root):
    examples = {}
    for split in ('train','validation','test','future-test'):
        for row in SemanticExampleLoader(root,split):
            if row['exampleId'] in examples:
                raise AssertionError('Duplicate semantic example')
            examples[row['exampleId']] = row
    with closing(sqlite3.connect(Path(root)/'factory.sqlite3')) as db:
        hashes = db.execute('SELECT example_id,source_digest,target_digest,split,labels FROM semantic_examples ORDER BY example_id').fetchall()
        shards = [(Path(path).name, records, digest) for path,records,digest in db.execute('SELECT path,records,sha256 FROM semantic_shards ORDER BY shard_id')]
    return examples, hashes, shards


class StreamingSemanticTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='semantic-regression-')
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def assemble(self, root, cls=SemanticFactory, **kwargs):
        s = open_semantic(root, cls, **kwargs)
        try:
            return s.assemble(10000)
        finally:
            s.close()

    def test_content_equivalence_and_stream_parser(self):
        old,new = self.root/'old', self.root/'new'
        fixture(old); fixture(new)
        a = self.assemble(old, LegacySemanticFactory)
        b = self.assemble(new)
        self.assertEqual(snapshot(old)[:2], snapshot(new)[:2])
        for key in ('valid','examples','semanticLabels','wholeScoreSplitIsolation','semanticSourceSplitIsolation','futureHeldoutScores'):
            self.assertEqual(a[key],b[key])
        self.assertLessEqual(b['bufferPeakExamples'],4)
        # A scope crossing the reader's chunk boundary preserves exact numbers/strings.
        large = self.root/'large'; fixture(large,1,2,padding=140000,zero=False)
        p = next((large/'canonical').glob('*.gz'))
        with gzip.open(p,'rt') as stream:
            expected = json.load(stream)['sourceAlignment']['scopes']
        self.assertEqual(list(canonical_scopes(p)),expected)
        self.assertEqual(JsonReader(io.StringIO(' '*65534+'1e-12')).value(),1e-12)

    def test_incremental_clean_stop_resume_and_zero_score(self):
        root, reference = self.root/'resume', self.root/'reference'
        fixture(root); fixture(reference)
        self.assemble(reference)
        s = open_semantic(root)
        try:
            report = s.assemble(100,interrupt_after=2)
            self.assertEqual(report['state'],'PAUSED')
            self.assertEqual(s.db.execute('SELECT COUNT(*) FROM semantic_examples').fetchone()[0],18)
            self.assertEqual(s.db.execute("SELECT COUNT(*) FROM semantic_score_progress WHERE status='COMPLETE'").fetchone()[0],2)
            hashes = snapshot(root)[2]
        finally:
            s.close()
        self.assertTrue(self.assemble(root)['valid'])
        self.assertEqual(snapshot(root),snapshot(reference))
        self.assertEqual(snapshot(root)[2][:len(hashes)],hashes)
        s = open_semantic(root)
        try:
            with patch.object(s, '_target_bundle', wraps=s._target_bundle), patch('semantic_streaming.canonical_scopes', side_effect=AssertionError('completed score regenerated')):
                report = s.assemble(100)
            self.assertEqual(report['examplesEmitted'],0)
            self.assertEqual(s.db.execute("SELECT COUNT(*) FROM semantic_score_progress WHERE status='EMPTY'").fetchone()[0],1)
        finally:
            s.close()

    def test_sigint_partial_publish_and_commit_interruptions(self):
        reference = self.root/'reference'; fixture(reference); self.assemble(reference)
        for stage in ('partial_fsynced','shard_published','before_commit','committed'):
            with self.subTest(stage=stage):
                root=self.root/stage;fixture(root)
                fired=[]
                def hook(current, worker):
                    if current==stage and not fired:
                        fired.append(True)
                        raise KeyboardInterrupt()
                s=open_semantic(root,event_hook=hook)
                try:
                    self.assertEqual(s.assemble(100)['state'],'PAUSED')
                    if stage!='committed':
                        self.assertEqual(s.db.execute('SELECT COUNT(*) FROM semantic_shards').fetchone()[0],0)
                    self.assertFalse(list((root/'semantic-shards').glob('*.partial')))
                finally:s.close()
                self.assertTrue(self.assemble(root)['valid'])
                self.assertEqual(snapshot(root),snapshot(reference))

    def test_process_crash_resume(self):
        root, reference = self.root/'crash', self.root/'reference'
        fixture(root);fixture(reference);self.assemble(reference)
        script = """import os,sys
from semantic_factory import SemanticFactory
def hook(stage,s):
    if stage=='shard_published': os._exit(73)
s=SemanticFactory(sys.argv[1],sys.argv[1]+'/contract.json',shard_size=4,free_floor_gib=0,event_hook=hook)
s.assemble(100)
"""
        env={**os.environ,'PYTHONPATH':str(Path(__file__).parent)}
        result=subprocess.run([sys.executable,'-c',script,str(root)],env=env,capture_output=True)
        self.assertEqual(result.returncode,73,result.stderr)
        self.assertTrue(self.assemble(root)['valid'])
        self.assertEqual(snapshot(root),snapshot(reference))

    def test_digest_conflicts_missing_targets_and_split_isolation(self):
        root=self.root/'changed';fixture(root)
        self.assemble(root)
        p=next(root.glob('*.targets.jsonl.gz'))
        with gzip.open(p,'at') as f:f.write(json.dumps({'metadata':{'exampleId':'changed'},'families':{}})+'\n')
        with self.assertRaisesRegex(RuntimeError,'DIGEST_MISMATCH'):
            self.assemble(root)
        missing=self.root/'missing';fixture(missing)
        next(missing.glob('*.targets.jsonl.gz')).unlink()
        self.assertTrue(self.assemble(missing)['valid'])
        self.assertEqual(self.assemble(missing)['examplesEmitted'],0)
        with closing(sqlite3.connect(missing/'factory.sqlite3')) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM semantic_score_progress WHERE status='SKIPPED'").fetchone()[0],1)
        overlap=self.root/'overlap';fixture(overlap,20,1,zero=False)
        for p in overlap.glob('*.targets.jsonl.gz'):
            with gzip.open(p,'rt') as f:row=json.loads(next(f))
            row['metadata']['groupId']='shared-across-splits'
            with gzip.open(p,'wt') as f:f.write(json.dumps(row)+'\n')
        with self.assertRaisesRegex(RuntimeError,'SPLIT_OVERLAP'):
            self.assemble(overlap)

    def test_disk_floor_and_status_progress(self):
        root=self.root/'progress';fixture(root)
        s=open_semantic(root)
        try:
            with patch('semantic_streaming.shutil.disk_usage',return_value=SimpleNamespace(free=0)):
                with self.assertRaisesRegex(RuntimeError,'DISK_BLOCKER'):s.assemble(100)
            self.assertEqual(s.db.execute('SELECT COUNT(*) FROM semantic_shards').fetchone()[0],0)
            s.assemble(100,interrupt_after=1)
        finally:s.close()
        f=Factory(root,root/'missing',root/'missing',root/'missing',free_floor_gib=0)
        try:
            status=f.status()
            self.assertEqual(status['semantic']['canonicalScoresTotal'],5)
            self.assertEqual(status['semantic']['scoresProcessed'],1)
            self.assertEqual(status['semantic']['examplesEmitted'],9)
            self.assertEqual(status['music']['semanticLabels'],99)
            self.assertEqual(status['progress']['units']['trainingExamples']['denominatorState'],'CALCULATING')
            self.assertEqual(status['progress']['units']['semanticScores']['denominator'],5)
        finally:f.close()

    def test_pipeline_semantic_only_never_opens_archives(self):
        root=self.root/'pipeline';contract=fixture(root)
        args=SimpleNamespace(work_dir=root,model_contract=contract,disk_floor_gib=0,semantic_only=True,
                             csv=root/'absent',pdf_archive=root/'absent',mxl_archive=root/'absent',subset_paths=root/'absent')
        with patch('full_pipeline.InputSetup',side_effect=AssertionError('input rescan')), \
             patch.object(Factory,'inspect',side_effect=AssertionError('archive inspection')), \
             patch.object(Factory,'build',side_effect=AssertionError('physical build')), \
             patch('full_pipeline.produce_source_coordinates',side_effect=AssertionError('source producer')):
            result=run(args)
        self.assertEqual(result['state'],'COMPLETE')
        self.assertTrue(result['generic']['valid'])
        self.assertEqual(sum(v['examples'] for v in result['evaluation']['splits'].values()),36)

    def test_memory_bound_in_fresh_processes(self):
        results=[]
        for scores,scopes in ((8,16),(80,16),(1,1280)):
            script="""import json,resource,sys,tracemalloc
from test_semantic_streaming import fixture,open_semantic
fixture(sys.argv[1],int(sys.argv[2]),scopes=int(sys.argv[3]),padding=4096,zero=False)
tracemalloc.start()
s=open_semantic(sys.argv[1]);r=s.assemble(10000);s.close()
print(json.dumps({'scores':int(sys.argv[2]),'examples':r['examples'],'peak':tracemalloc.get_traced_memory()[1],'rss':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'buffer':r['bufferPeakExamples']}))
"""
            result=subprocess.run([sys.executable,'-c',script,str(self.root/f'memory-{scores}'),str(scores),str(scopes)],
                env={**os.environ,'PYTHONPATH':str(Path(__file__).parent)},capture_output=True,text=True,check=True)
            results.append(json.loads(result.stdout))
        self.assertEqual(results[1]['examples'],results[0]['examples']*10)
        self.assertLess(results[1]['peak'],results[0]['peak']*2+2_000_000)
        self.assertLessEqual(results[1]['buffer'],4)
        self.assertEqual(results[2]['examples'],results[1]['examples'])
        self.assertLess(results[2]['peak'],results[0]['peak']*2+2_000_000)
        self.assertLess(results[2]['rss'],results[0]['rss']*2)
        print('MEMORY_EVIDENCE',json.dumps(results))

    def test_validated_sample_content_equivalence(self):
        from semantic_factory import iter_jsonl
        sample=Path(__file__).resolve().parents[2]/'tmp/campaign/piano-vision-phase212y/factory-sample-run/semantic-shards'
        if not sample.is_dir():
            self.skipTest('Optional validated sample is not available in this checkout')
        examples=[]
        for shard in sorted(sample.glob('*.jsonl.gz')):
            for row in iter_jsonl(shard):
                examples.append(row)
                if len(examples)==64:break
            if len(examples)==64:break
        groups={}
        for row in examples:groups.setdefault(row['scoreId'],[]).append(row)
        for name in ('sample-old','sample-new'):
            root=self.root/name;contract=fixture(root,scores=0)
            contract.write_text(json.dumps({'scaleAuthorized':True,'runtimeTruthInputs':[],
                'configurationDigest':examples[0]['decoderContract']['configurationDigest']}))
            with closing(sqlite3.connect(root/'factory.sqlite3')) as db:
                for n,(score,rows) in enumerate(groups.items()):
                    canonical=root/'canonical'/f'{score}.json.gz';target=root/f'{score}.target.jsonl.gz'
                    with gzip.open(canonical,'wt') as c:
                        json.dump({'sourceAlignment':{'scopes':[{'metadata':{'exampleId':r['exampleId']},'modelInput':r['input']['modelInput']} for r in rows]}},c)
                    with gzip.open(target,'wt') as t:
                        for r in rows:t.write(json.dumps({'metadata':{'exampleId':r['exampleId'],'groupId':r['semanticSourceId']},'families':r['target']['families']})+'\n')
                    db.execute("INSERT INTO scores(score_id,csv_row,filter_state,job_state,metadata_json,updated_at) VALUES(?,?,?,?,?,?)",
                        (score,n,'ACCEPT_PIANO','COMPLETE',json.dumps({'target_bundle':str(target)}),utc_now()))
                    db.execute('INSERT INTO canonical VALUES(?,?,?,?,?,?,?,?,?)',(score,str(canonical),sha256_path(canonical),'train',1,len(rows),0,0,len(rows)))
                db.commit()
        a=self.assemble(self.root/'sample-old',LegacySemanticFactory)
        b=self.assemble(self.root/'sample-new')
        self.assertTrue(a['valid'] and b['valid'])
        self.assertEqual(snapshot(self.root/'sample-old')[:2],snapshot(self.root/'sample-new')[:2])
        self.assertEqual(snapshot(self.root/'sample-new')[0],{r['exampleId']:r for r in examples})
        print('SAMPLE_EQUIVALENCE',json.dumps({'examples':b['examples'],'labels':b['semanticLabels'],'scores':len(groups),'valid':b['valid']}))

    def test_existing_example_digest_mismatch_is_not_overwritten(self):
        root=self.root/'legacy-mismatch';fixture(root,1,1,zero=False)
        s=open_semantic(root)
        try:
            s.db.execute('INSERT INTO semantic_examples VALUES(?,?,?,?,?,?,?,?,?)',
                ('score-00000:scope-0','score-00000',semantic_split('score-00000'),0,'unemitted','wrong','wrong',11,utc_now()))
            s.db.commit()
            with self.assertRaisesRegex(RuntimeError,'EXISTING_EXAMPLE_DIGEST_MISMATCH'):s.assemble(100)
            self.assertEqual(s.db.execute('SELECT source_digest FROM semantic_examples').fetchone()[0],'wrong')
        finally:s.close()

    def test_concurrent_legacy_guard_and_invalid_physical_resume(self):
        from worker_guard import assert_no_legacy_worker
        root=self.root/'guard';fixture(root)
        fake=SimpleNamespace(stdout=f'999 python /repo/tools/pdmx-factory/full_pipeline.py --work-dir {root}\n')
        with patch('worker_guard.subprocess.run',return_value=fake):
            with self.assertRaisesRegex(RuntimeError,'WORKER_STILL_PRESENT'):assert_no_legacy_worker(root)
        with closing(sqlite3.connect(root/'factory.sqlite3')) as db:
            db.execute("UPDATE scores SET job_state='PENDING' WHERE score_id='score-00000'");db.commit()
        args=SimpleNamespace(work_dir=root,semantic_only=True)
        with self.assertRaisesRegex(RuntimeError,'PHYSICAL_PHASE_NOT_COMPLETE'):run(args)

    def test_existing_legacy_outputs_adopted_without_new_shards(self):
        root=self.root/'legacy';fixture(root)
        self.assemble(root,LegacySemanticFactory)
        before=snapshot(root)
        report=self.assemble(root)
        self.assertTrue(report['valid'])
        self.assertEqual(report['examplesEmitted'],0)
        self.assertEqual(before,snapshot(root))

    def test_byte_bound_pause_flags_and_corrupt_shard(self):
        root=self.root/'byte-bound';fixture(root,1,20,padding=4096,zero=False)
        s=open_semantic(root,buffer_bytes=7000)
        try:
            report=s.assemble(100)
            self.assertLessEqual(report['bufferPeakExamples'],2)
            self.assertLess(report['bufferPeakBytes'],15000)
            shard=s.db.execute('SELECT path FROM semantic_shards LIMIT 1').fetchone()[0]
        finally:s.close()
        with Path(shard).open('ab') as f:f.write(b'corrupt')
        with self.assertRaisesRegex(RuntimeError,'VALIDATION_FAILED'):
            self.assemble(root,buffer_bytes=7000)
        paused=self.root/'paused';contract=fixture(paused)
        with closing(sqlite3.connect(paused/'factory.sqlite3')) as db:
            db.execute("INSERT OR REPLACE INTO state VALUES('paused','true')")
            db.execute("INSERT OR REPLACE INTO state VALUES('stop_requested','true')");db.commit()
        self.assertEqual(self.assemble(paused)['state'],'PAUSED')
        args=SimpleNamespace(work_dir=paused,model_contract=contract,disk_floor_gib=0,semantic_only=True,resume=True,
            csv=paused/'absent',pdf_archive=paused/'absent',mxl_archive=paused/'absent',subset_paths=paused/'absent')
        self.assertEqual(run(args)['state'],'COMPLETE')


if __name__=='__main__':unittest.main(verbosity=2)
