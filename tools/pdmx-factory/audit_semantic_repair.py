"""Full post-repair audit. Read-only factory; all scratch indexes are bounded SQLite."""
import argparse
import collections
import fcntl
import gzip
import hashlib
import json
import math
import resource
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import time
from contextlib import closing
from pathlib import Path
from PIL import Image

from factory import sha256_path
from semantic_factory import firewall_violations, iter_jsonl
from semantic_streaming import digest
from semantic_repair import read_written_xml
from streaming_json import canonical_scopes
from worker_guard import pipeline_guard


def audit(root, output, contract_path, mxl_archive, revision):
    root, output = Path(root).resolve(), Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    def save(name, value): (output/name).write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')
    start = time.time()
    def progress(stage, count):
        result = {'stage': stage, 'count': count, 'elapsed_seconds': time.time()-start,
            'peak_rss_bytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss, 'free_bytes': shutil.disk_usage(root).free}
        save('audit-progress.json', result); print(json.dumps(result), flush=True)
        if result['free_bytes'] < 20*1024**3 + 128*1024**2: raise RuntimeError('DISK_BLOCKER: audit reserve')
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'piano-vision'))
    from piano_vision.data import validate_record_contract
    contract = json.loads(Path(contract_path).read_text())
    recipe = json.loads((root/'semantic-revisions'/revision/'recipe.json').read_text())
    split_manifest = json.loads((root/'semantic-revisions'/revision/'split-manifest.json').read_text())
    assignments = {row['score_id']: row['split'] for row in split_manifest['scores']}
    baseline = json.loads((output/'baseline-semantic-audit.json').read_text())
    errors = []
    if sha256_path(contract_path) != recipe['contract_sha256']:
        errors.append('REPAIR_CONTRACT_CHANGED')
    if digest({k:v for k,v in split_manifest.items() if k!='digest'}) != split_manifest['digest'] or split_manifest['digest'] != recipe['split_digest']:
        errors.append('REPAIR_SPLIT_MANIFEST_CHANGED')
    db = sqlite3.connect((root/'factory.sqlite3').as_uri()+'?mode=ro', uri=True); db.row_factory=sqlite3.Row
    db.executescript('PRAGMA query_only=ON; PRAGMA cache_size=-4096; PRAGMA temp_store=FILE;')
    scratch = output/'audit-index.sqlite3'
    if scratch.exists(): raise ValueError('Existing audit scratch index: preserve it or choose a new audit output')
    ix = sqlite3.connect(scratch)
    ix.executescript('''PRAGMA cache_size=-4096; PRAGMA temp_store=FILE; PRAGMA journal_mode=OFF;
        CREATE TABLE ids(id TEXT PRIMARY KEY); CREATE TABLE identities(kind TEXT,id TEXT,split TEXT,PRIMARY KEY(kind,id));
        CREATE TABLE targets(score TEXT,example TEXT,payload TEXT,PRIMARY KEY(score,example));
        CREATE TABLE pages(score TEXT,path TEXT,hash TEXT,PRIMARY KEY(score,path));
        CREATE TABLE notation_checked(score TEXT PRIMARY KEY);
        CREATE TABLE fingerprints(score TEXT PRIMARY KEY,canonical TEXT,target TEXT,base TEXT);
    ''')
    integrity = db.execute('PRAGMA integrity_check').fetchall()
    if [r[0] for r in integrity] != ['ok'] or db.execute('PRAGMA foreign_key_check').fetchall(): errors.append('SQLITE_INTEGRITY')
    if db.execute("SELECT COUNT(*) FROM semantic_repair_scores WHERE revision=? AND status!='COMPLETE'", (revision,)).fetchone()[0]: errors.append('REPAIR_INCOMPLETE')
    if db.execute("SELECT value FROM state WHERE key='semantic_repair_revision'").fetchone()[0] != revision:
        errors.append('REPAIR_REVISION_NOT_ACTIVE')
    inventory_digest = hashlib.sha256()
    for row in db.execute('SELECT shard_id,path,records,sha256,split FROM semantic_shards ORDER BY shard_id'):
        inventory_digest.update((json.dumps(list(row),separators=(',',':'))+'\n').encode())
    physical_hash = hashlib.sha256()
    for table in ('build_plan','scores','canonical','fragments','shards','preflight_inventory'):
        for row in db.execute('SELECT * FROM '+table+' ORDER BY 1'):
            physical_hash.update((json.dumps({'table':table,'row':dict(row)},separators=(',',':'))+'\n').encode())
    original_hash = (output/'physical-db-manifest.jsonl.sha256').read_text().split()[0]
    physical = {'database_tables_unchanged': physical_hash.hexdigest()==original_hash,
        'original_digest': original_hash, 'current_digest': physical_hash.hexdigest(),
        'frozen_plan':dict(db.execute('SELECT COUNT(*) scores,SUM(i.pages) pages,SUM(i.measures) measures,SUM(i.notes) musicxml_notes FROM build_plan p JOIN preflight_inventory i USING(score_id)').fetchone()),
        'statuses':dict(db.execute('SELECT s.job_state,COUNT(*) FROM build_plan p JOIN scores s USING(score_id) GROUP BY s.job_state'))}
    if not physical['database_tables_unchanged']: errors.append('PHYSICAL_TABLES_CHANGED')
    save('physical-immutability.json',physical); progress('physical_tables',physical['frozen_plan']['scores'])
    repo=Path(__file__).resolve().parents[2]
    for path, expected in recipe['code_hashes'].items():
        if sha256_path(repo/path)!=expected: errors.append('RECIPE_CODE_CHANGED:'+path)
    for n,row in enumerate(db.execute('SELECT c.*,s.metadata_json,p.input_digest FROM canonical c JOIN scores s USING(score_id) JOIN semantic_score_progress p USING(score_id) ORDER BY c.score_id'),1):
        ch=sha256_path(row['path']); md=json.loads(row['metadata_json']);target=md.get('target_bundle');th=sha256_path(target) if target and Path(target).is_file() else None
        if ch!=row['sha256']:errors.append('CANONICAL_HASH:'+row['score_id'])
        base=digest({'canonical':ch,'target':th,'contract':contract,'shardSize':256,'bufferBytes':8*1024*1024,'layout':'SCORE_CHUNKS_V1'})
        ix.execute('INSERT INTO fingerprints VALUES(?,?,?,?)',(row['score_id'],ch,th,base))
        if row['score_id'] in assignments:
            ledger=db.execute('SELECT * FROM semantic_repair_scores WHERE revision=? AND score_id=?',(revision,row['score_id'])).fetchone()
            if not ledger or (ledger['canonical_hash'],ledger['target_hash'])!=(ch,th):errors.append('FROZEN_REPAIR_INPUT_CHANGED:'+row['score_id'])
            for source in canonical_scopes(row['path']):
                ix.execute('INSERT OR IGNORE INTO pages VALUES(?,?,NULL)',(row['score_id'],source['metadata']['renderedPagePath']))
        elif row['input_digest']!=base:errors.append('UNREPAIRED_INPUT_DIGEST:'+row['score_id'])
        if n%500==0:ix.commit();progress('canonical_fingerprints',n)
    ix.commit()
    for row in db.execute('SELECT * FROM fragments'):
        if sha256_path(row['path'])!=row['sha256']:errors.append('PHYSICAL_ARTIFACT_HASH:'+row['path'])
    for shard in db.execute('SELECT * FROM shards'):
        rows=db.execute('SELECT sha256 FROM fragments WHERE shard_id=? ORDER BY score_id',(shard['shard_id'],)).fetchall()
        aggregate=hashlib.sha256(''.join(r[0] for r in rows).encode()).hexdigest()
        if len(rows)!=shard['records'] or aggregate!=shard['aggregate_sha256']:errors.append('PHYSICAL_AGGREGATE_HASH:'+str(shard['shard_id']))
    families=collections.defaultdict(collections.Counter);family_hash=collections.Counter();splits=collections.Counter()
    examples=known_labels=shard_bytes=known_rest=known_tuplets=0;source_rest_errors=0
    manifests={split:gzip.open(output/(split+'-manifest.jsonl.gz'),'wt') for split in ('train','validation','test','future-test')}
    expected_paths={r[0] for r in db.execute('SELECT path FROM semantic_shards')}
    if expected_paths!={str(p.resolve()) for p in (root/'semantic-shards').glob('*.jsonl.gz')}:errors.append('SHARD_INVENTORY_MISMATCH')
    for si,shard in enumerate(db.execute('SELECT * FROM semantic_shards ORDER BY shard_id'),1):
        if sha256_path(shard['path'])!=shard['sha256']:errors.append('SEMANTIC_SHARD_HASH:'+shard['path'])
        shard_bytes+=Path(shard['path']).stat().st_size;count=0
        for e in iter_jsonl(shard['path']):
            validate_record_contract(e,Path(shard['path']));count+=1;examples+=1;split=e['split'];splits[split]+=1
            ix.execute('INSERT INTO ids VALUES(?)',(e['exampleId'],))
            if split!=assignments.get(e['scoreId']):errors.append('SPLIT_ASSIGNMENT:'+e['exampleId'])
            for kind,identity in (('score',e['scoreId']),('source',e['semanticSourceId'])):
                old=ix.execute('SELECT split FROM identities WHERE kind=? AND id=?',(kind,identity)).fetchone()
                if old and old[0]!=split:errors.append('IDENTITY_SPLIT_LEAKAGE')
                ix.execute('INSERT OR IGNORE INTO identities VALUES(?,?,?)',(kind,identity,split))
            if firewall_violations(e['input']['modelInput']) or e['provenance']['runtimeTruthInputs']!=[]:errors.append('INPUT_TRUTH_FIREWALL')
            if e['decoderContract']['configurationDigest']!=contract['configurationDigest']:errors.append('CONTRACT_DIGEST')
            labels=sum(l['state']=='KNOWN' for values in e['target']['families'].values() for l in values);known_labels+=labels
            stored=db.execute('SELECT source_digest,target_digest,split,shard_id,labels FROM semantic_examples WHERE example_id=?',(e['exampleId'],)).fetchone()
            if not stored or tuple(stored)!=(digest(e['input']),digest(e['target']),split,shard['shard_id'],labels):errors.append('EXAMPLE_DIGEST:'+e['exampleId'])
            for family,labels in e['target']['families'].items():
                families[family].update(label['state'] for label in labels)
                family_hash[family]=(family_hash[family]+int(hashlib.sha256(json.dumps([e['exampleId'],labels],sort_keys=True).encode()).hexdigest(),16))%2**256
                if e['target']['availability'][family]!=any(l['state']=='KNOWN' for l in labels):errors.append('AVAILABILITY_MASK:'+family)
            notation={'tuplets':[l for l in e['target']['families']['TUPLET'] if l['state']=='KNOWN'],'rests':[]}
            known_tuplets+=len(notation['tuplets'])
            mi=e['input']['modelInput'];graph=mi['sourceGraph'];transform=mi['geometry']['pageTransform'];bounds=mi['geometry']['scopeBounds']
            for label in e['target']['families']['REST']:
                if label.get('isPositive') is False:errors.append('FABRICATED_REST_NEGATIVE')
                if label['state']!='KNOWN':continue
                known_rest+=1;good=len(label['objectIndexes'])==1
                if good:
                    obj=mi['physicalObjects'][label['objectIndexes'][0]];center=obj['center']
                    candidates=[node for node in graph['nodes'] if node.get('kind')=='rest' and node.get('source')=='vector-glyph' and
                        abs(node['anchor']['x']/transform['sourceWidth']-center['x'])<=.00000051 and
                        abs(node['anchor']['y']/transform['sourceHeight']-center['y'])<=.00000051]
                    good=obj['kind']=='rest' and len(candidates)==1 and all(v is False for v in graph['independence'].values())
                    tolerance=(graph.get('sourceGeometry') or {}).get('staffSpacePx',0)
                    good=good and bounds['x0']-tolerance/transform['sourceWidth']<=center['x']<=bounds['x1']+tolerance/transform['sourceWidth']
                    good=good and bounds['y0']-tolerance/transform['sourceHeight']<=center['y']<=bounds['y1']+tolerance/transform['sourceHeight']
                if not good:
                    source_rest_errors+=1;errors.append('REST_SOURCE_COORDINATE_PROOF:'+label['labelId']);continue
                notation['rests'].append({'label':label,'glyphClass':candidates[0]['glyphClass'],'staffRole':candidates[0]['staffRole']})
            if notation['tuplets'] or notation['rests']:
                ix.execute('INSERT INTO targets VALUES(?,?,?)',(e['scoreId'],e['exampleId'],json.dumps(notation,separators=(',',':'))))
            manifests[split].write(json.dumps({'example_id':e['exampleId'],'score_id':e['scoreId'],'source_id':e['semanticSourceId'],'shard':shard['path']})+'\n')
        if count!=shard['records']:errors.append('SHARD_COUNT:'+str(shard['shard_id']))
        if si%500==0:ix.commit();progress('semantic_records',si)
        if len(errors)>100:raise ValueError(errors[:100])
    ix.commit()
    for stream in manifests.values():stream.close()
    for family in families:
        if family not in ('REST','TUPLET') and (dict(families[family])!=baseline['families'][family] or format(family_hash[family],'064x')!=baseline['family_multiset_digests'][family]):errors.append('UNRELATED_FAMILY_REGRESSION:'+family)
    counts=db.execute('SELECT COUNT(*),SUM(labels) FROM semantic_examples').fetchone()
    if tuple(counts)!=(examples,known_labels):errors.append('SEMANTIC_TOTALS_MISMATCH')
    for split,count in splits.items():
        totals=db.execute('SELECT examples,labels,shards FROM semantic_totals WHERE split=?',(split,)).fetchone()
        actual=db.execute('SELECT COUNT(*),SUM(labels),(SELECT COUNT(*) FROM semantic_shards WHERE split=?) FROM semantic_examples WHERE split=?',(split,split)).fetchone()
        if tuple(totals)!=tuple(actual):errors.append('COUNTER_MISMATCH:'+split)
    if not known_rest or not known_tuplets:errors.append('MISSING_MEANINGFUL_REST_OR_TUPLET_SUPERVISION')
    summary={'examples':examples,'known_labels':known_labels,'shards':len(expected_paths),'semantic_shard_bytes':shard_bytes,
        'families':families,'family_multiset_digests':{k:format(v,'064x') for k,v in family_hash.items()},
        'split_counts':{split:{'examples':count,'scores':ix.execute("SELECT COUNT(*) FROM identities WHERE kind='score' AND split=?",(split,)).fetchone()[0],
            'sources':ix.execute("SELECT COUNT(*) FROM identities WHERE kind='source' AND split=?",(split,)).fetchone()[0]} for split,count in splits.items()},
        'known_rest_source_coordinate_errors':source_rest_errors,'errors':errors,'valid':not errors}
    save('semantic-integrity.json',summary)
    # Fresh decode against the ACTUAL emitted split assignments.
    seen={};overlaps=[];decoded=0
    for score,path in ix.execute('SELECT score,path FROM pages ORDER BY path,score'):
        actual_split=db.execute('SELECT DISTINCT split FROM semantic_examples WHERE score_id=?',(score,)).fetchall()
        if len(actual_split)!=1:raise ValueError('SCORE_SPLIT_LEAKAGE')
        split=actual_split[0][0]
        with Image.open(path) as source:
            gray=source.convert('L');h=hashlib.sha256(f'{gray.width}x{gray.height}:L:'.encode()+gray.tobytes()).hexdigest()
        previous=seen.setdefault(h,(score,split,path))
        if previous[1]!=split:overlaps.append([previous,[score,split,path]])
        decoded+=1
        if decoded%1000==0:progress('decoded_pixels',decoded)
    save('decoded-page-after.json',{'decoded_pages':decoded,'cross_split_overlaps':len(overlaps),'details':overlaps,'valid':not overlaps})
    if overlaps:errors.append('DECODED_PIXEL_SPLIT_LEAKAGE')
    # Reopen original compressed members, never extracted, to independently
    # verify EVERY emitted KNOWN rest/tuplet and the recipe input fingerprints.
    worker=subprocess.Popen(['node','--max-old-space-size=768',str(repo/'tools/semantic-gold/audit-repaired-targets.mjs')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    written={'scores':0,'tuplets_checked':0,'rests_checked':0,'errors':[]}
    try:
        with tarfile.open(mxl_archive,'r|gz') as stream:
            for member in stream:
                ledger=db.execute('SELECT r.*,p.input_digest FROM semantic_repair_scores r JOIN semantic_score_progress p USING(score_id) WHERE r.revision=? AND r.mxl_member=?',(revision,member.name.removeprefix('./'))).fetchone()
                if not ledger:continue
                payload=stream.extractfile(member).read()
                if hashlib.sha256(payload).hexdigest()!=ledger['mxl_hash']:raise ValueError('RAW_MXL_DIGEST_MISMATCH')
                xml=read_written_xml(payload);xml_hash=hashlib.sha256(xml.encode()).hexdigest()
                base=ix.execute('SELECT base FROM fingerprints WHERE score=?',(ledger['score_id'],)).fetchone()[0]
                if digest({'frozen_input':base,'recipe':digest(recipe),'written_xml':xml_hash,'split':assignments[ledger['score_id']]})!=ledger['input_digest']:errors.append('REPAIR_PROGRESS_FINGERPRINT:'+ledger['score_id'])
                records=[json.loads(r[0]) for r in ix.execute('SELECT payload FROM targets WHERE score=? ORDER BY example',(ledger['score_id'],))]
                worker.stdin.write(json.dumps({'xml':xml,'records':records},separators=(',',':'))+'\n');worker.stdin.flush()
                result=json.loads(worker.stdout.readline())
                if 'error' in result:raise ValueError(result['error'])
                written['scores']+=1;written['tuplets_checked']+=result['tuplets_checked'];written['rests_checked']+=result['rests_checked']
                written['errors'].extend(result['errors']);ix.execute('INSERT INTO notation_checked VALUES(?)',(ledger['score_id'],))
                if written['scores']%500==0:ix.commit();progress('original_written_notation',written['scores'])
    finally:
        worker.stdin.close();worker.wait(timeout=30);worker.stdout.close()
    if written['scores']!=len(assignments) or written['tuplets_checked']!=known_tuplets or written['rests_checked']!=known_rest:errors.append('WRITTEN_AUDIT_COVERAGE')
    if written['errors']:errors.append('WRITTEN_SEMANTIC_INTEGRITY')
    written['valid']=not written['errors'] and written['scores']==len(assignments) and written['tuplets_checked']==known_tuplets and written['rests_checked']==known_rest
    save('notation-audit.json',written)
    ix.commit();ix.close();db.close()
    report={'valid':not errors,'errors':errors,'physical':physical,'semantic':summary,'written':written,
        'factory_directory':str(root),'revision':revision,'recipe_digest':digest(recipe),
        'shard_inventory_digest':inventory_digest.hexdigest(),
        'decoded_pages':decoded,'decoded_page_overlaps':len(overlaps),'contract_digest':contract['configurationDigest'],
        'elapsed_seconds':time.time()-start,'free_bytes':shutil.disk_usage(root).free,'peak_rss_bytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}
    save('full-repair-audit.json',report);progress('audit_complete',examples)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--factory-dir',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--model-contract',required=True);parser.add_argument('--mxl-archive',required=True)
    parser.add_argument('--revision',required=True);args=parser.parse_args()
    with pipeline_guard(args.factory_dir):
        with (Path(args.factory_dir)/'semantic-worker.lock').open('a+') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            result=audit(args.factory_dir,args.output,args.model_contract,args.mxl_archive,args.revision)
    if not result['valid']:raise SystemExit(2)
