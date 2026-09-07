"""Versioned whole-score components from decoded page content; read-only factory."""
import argparse
import gzip
import hashlib
import json
import os
import shutil
import sqlite3
from pathlib import Path
from PIL import Image
from streaming_json import canonical_scopes
from semantic_streaming import digest, sync_directory

STRICTNESS = {'train': 0, 'validation': 1, 'test': 2, 'future-test': 3}


def component_splits(scores, links):
    parent = {score: score for score in scores}
    def root(score):
        while parent[score] != score:
            parent[score] = parent[parent[score]]
            score = parent[score]
        return score
    for left, right in links:
        a, b = root(left), root(right)
        parent[max(a, b)] = min(a, b)
    strict = {}
    for score, split in scores.items():
        group = root(score)
        strict[group] = max(strict.get(group, split), split, key=STRICTNESS.__getitem__)
    return {score: {'component': root(score), 'split': strict[root(score)]} for score in sorted(scores)}


def build_content_plan(factory_dir, output, version):
    factory_dir, output = Path(factory_dir).resolve(), Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    final = output / 'split-manifest.json'
    if final.exists():
        raise ValueError('Version already frozen; choose a new version instead of overwriting')
    db = sqlite3.connect((factory_dir / 'factory.sqlite3').as_uri() + '?mode=ro', uri=True)
    ix = sqlite3.connect(output / 'page-index.sqlite3')
    ix.executescript('PRAGMA cache_size=-2048; PRAGMA temp_store=FILE; CREATE TABLE pages(score TEXT,path TEXT,hash TEXT,PRIMARY KEY(score,path)); CREATE INDEX page_hash ON pages(hash);')
    scores = {score: {'before': split, 'examples': count} for score, split, count in db.execute(
        'SELECT score_id,split,COUNT(*) FROM semantic_examples GROUP BY score_id,split ORDER BY score_id')}
    if len(scores) != db.execute('SELECT COUNT(DISTINCT score_id) FROM semantic_examples').fetchone()[0]:
        raise ValueError('Existing score split overlap')
    canonical_manifest = output / 'canonical-inputs.jsonl.gz'
    with gzip.open(canonical_manifest, 'wt') as manifest:
        for n, (score, path, expected) in enumerate(db.execute('SELECT score_id,path,sha256 FROM canonical ORDER BY score_id'), 1):
            from factory import sha256_path
            actual = sha256_path(path)
            if actual != expected: raise ValueError('CANONICAL_HASH_MISMATCH:' + score)
            manifest.write(json.dumps({'score_id': score, 'path': path, 'sha256': actual}) + '\n')
            if score not in scores: continue
            count = 0
            for source in canonical_scopes(path):
                count += 1
                page = Path(source['metadata']['renderedPagePath']).resolve()
                ix.execute('INSERT OR IGNORE INTO pages VALUES(?,?,NULL)', (score, str(page)))
            if count != scores[score]['examples']: raise ValueError('SCOPE_COUNT_MISMATCH:' + score)
            if n % 500 == 0:
                ix.commit()
                print(json.dumps({'stage': 'canonical', 'scores': n}), flush=True)
    ix.commit()
    db.close()
    links = []
    seen = {}
    before_overlaps = 0
    with gzip.open(output / 'decoded-pages.jsonl.gz', 'wt') as manifest:
        for n, (score, path) in enumerate(ix.execute('SELECT score,path FROM pages ORDER BY path,score'), 1):
            if shutil.disk_usage(output).free < 20 * 1024**3 + 64 * 1024**2:
                raise RuntimeError('DISK_BLOCKER: page audit reserve')
            with Image.open(path) as image:
                gray = image.convert('L')
                h = hashlib.sha256(f'{gray.width}x{gray.height}:L:'.encode() + gray.tobytes()).hexdigest()
            prior = seen.setdefault(h, score)
            links.append((prior, score))
            before_overlaps += scores[prior]['before'] != scores[score]['before']
            ix.execute('UPDATE pages SET hash=? WHERE score=? AND path=?', (h, score, path))
            manifest.write(json.dumps({'score_id': score, 'path': path, 'pixel_sha256': h}) + '\n')
            if n % 1000 == 0:
                ix.commit()
                print(json.dumps({'stage': 'decoded_pages', 'pages': n, 'cross_split': before_overlaps}), flush=True)
    ix.commit()
    assignments = component_splits({score: row['before'] for score, row in scores.items()}, links)
    rows = [{'score_id': score, **scores[score], **assignments[score]} for score in sorted(scores)]
    counts = {}
    for stage in ('before', 'split'):
        counts[stage] = {split: {'scores': sum(r[stage] == split for r in rows),
            'examples': sum(r['examples'] for r in rows if r[stage] == split)} for split in STRICTNESS}
    after = sum(assignments[a]['split'] != assignments[b]['split'] for a, b in links)
    result = {'schema_version': 2, 'version': version, 'policy': 'WHOLE_SCORE_DECODED_PAGE_COMPONENT_STRICTEST_HOLDOUT',
        'strictness': list(STRICTNESS), 'factory_directory': str(factory_dir), 'scores': rows,
        'counts': counts, 'decoded_pages': len(links), 'before_cross_split_overlaps': before_overlaps,
        'after_cross_split_overlaps': after, 'changed_scores': sum(r['before'] != r['split'] for r in rows)}
    result['digest'] = digest(result)
    partial = final.with_suffix('.partial')
    with partial.open('w') as stream:
        json.dump(result, stream, sort_keys=True, indent=2)
        stream.flush(); os.fsync(stream.fileno())
    os.replace(partial, final); sync_directory(output)
    ix.close()
    print(json.dumps({k: v for k, v in result.items() if k != 'scores'}, indent=2), flush=True)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--factory-dir', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    build_content_plan(args.factory_dir, args.output, args.version)
