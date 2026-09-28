#!/usr/bin/env python3
"""Bounded train-only profile. CPU timings are never RTX estimates."""
import argparse
import contextlib
import hashlib
import json
from pathlib import Path
import platform
import statistics
import sys
import time
import torch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from piano_vision.v25.config import PRESETS, config_from_dict
from piano_vision.v25.model import PianoVisionV25
from piano_vision.v25.loss import semantic_loss_v25
from piano_vision.v25.data import tensorize_v25, attach_pointer_targets, collate_v25
from piano_vision.v2.data import PageResolver, attach_notation_sidecar
from validate_notation_sidecars_v1 import load_score_records

CAMPAIGN = ROOT / 'tmp/campaign/piano-vision-phase214'


def tree_to(value, device):
    if torch.is_tensor(value): return value.to(device, non_blocking=True)
    if isinstance(value, dict): return {k:tree_to(v,device) for k,v in value.items()}
    if isinstance(value, list): return [tree_to(v,device) for v in value]
    if isinstance(value, tuple): return tuple(tree_to(v,device) for v in value)
    return value


def manifest(path, split):
    doc = json.loads(Path(path).read_text())
    digest = hashlib.sha256(json.dumps({k:v for k,v in doc.items() if k!='digest'},sort_keys=True).encode()).hexdigest()
    if doc['split'] != split or doc['digest'] != digest:
        raise ValueError('Manifest split/content digest mismatch')
    if any(e['split'] != split for e in doc['examples']): raise PermissionError('Mixed split')
    return doc


def real_batches(config, examples=1, offset=0, split='train', views_per_micro=32):
    if split not in {'train', 'validation'}: raise PermissionError('Sealed split')
    doc=manifest(CAMPAIGN/f'v2-serious-medium-full-v1/{split}.json',split)
    order=torch.randperm(len(doc['examples']),generator=torch.Generator().manual_seed(21701)).tolist() if split=='train' else list(range(len(doc['examples'])))
    entries=[doc['examples'][i] for i in order[offset:offset+examples]]
    resolver=PageResolver(ROOT/'tmp/campaign/pdmx-piano-vision-full-v1',index_path=str(CAMPAIGN/'full-semantic-index.json'))
    samples=[]; timings=[]; cache={}
    for e in entries:
        start=time.perf_counter()
        if e['score_id'] not in cache: cache[e['score_id']]=load_score_records(e['score_id'],split)
        records=cache[e['score_id']]; record=next(r for r in records if r['exampleId']==e['example_id'])
        sample,selected,lookup=tensorize_v25(record,records,resolver,config)
        sc=json.loads((CAMPAIGN/'notation-sidecars/full-v1'/e['sidecar']).read_text())
        if any(r['state']=='KNOWN' for r in sc['regions']):
            sample=attach_notation_sidecar(sample,sc,record,resolver,config)
            sample=attach_pointer_targets(sample,sc,record,selected,lookup)
        samples.append(sample);timings.append(time.perf_counter()-start)
    micros=[];current=[];views=0
    for s in samples:
        v=len(s['images'])
        if current and views+v>views_per_micro: micros.append(collate_v25(current));current=[];views=0
        current.append(s);views+=v
    if current: micros.append(collate_v25(current))
    return micros, {'manifest_digest':doc['digest'],'example_ids':[e['example_id'] for e in entries], 'materialize_seconds':timings}


def sync(device):
    if str(device).startswith('cuda'): torch.cuda.synchronize()
    elif str(device)=='mps': torch.mps.synchronize()


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--out',required=True);ap.add_argument('--device',default='cpu')
    ap.add_argument('--engine',choices=['reference','optimized','compact'],default='reference')
    ap.add_argument('--examples',type=int,default=1);ap.add_argument('--offset',type=int,default=0)
    ap.add_argument('--steps',type=int,default=3);ap.add_argument('--warmup',type=int,default=1)
    ap.add_argument('--consistency-scale',type=float,default=0)
    ap.add_argument('--threads',type=int,default=4);ap.add_argument('--checkpoint')
    ap.add_argument('--trace',action='store_true');ap.add_argument('--tiny',action='store_true')
    args=ap.parse_args();torch.set_num_threads(args.threads);torch.manual_seed(21701)
    from campaign_runtime import writable_output
    out=writable_output(args.out);out.mkdir(parents=True,exist_ok=False)
    cfg=PRESETS['medium']
    if args.tiny:
        sys.path.insert(0, str(Path(__file__).resolve().parent / 'tests'))
        from test_v25_data import TINY_DATA
        cfg=TINY_DATA
    batches,info=real_batches(cfg,args.examples,args.offset)
    torch.manual_seed(21701)
    if args.engine=='reference':
        from piano_vision.v25.reference_model import PianoVisionV25 as Model
        from piano_vision.v25.reference_loss import semantic_loss_v25 as loss_fn
    else:
        from piano_vision.v25.model import PianoVisionV25 as Model
        from piano_vision.v25.loss import semantic_loss_v25 as loss_fn
        from piano_vision.v25.performance import prepare_batch
        started=time.perf_counter()
        batches=[prepare_batch(b) for b in batches]
        info["prepare_batch_seconds"]=time.perf_counter()-started
    model=Model(cfg).to(args.device)
    if args.engine=="compact": model.compact_feedback=True
    if args.checkpoint: model.load_state_dict(torch.load(args.checkpoint,map_location='cpu',weights_only=False)['model'],strict=True)
    optimizer=torch.optim.AdamW([p for p in model.parameters() if p.requires_grad],lr=1e-5)
    info['shapes']=[{k:list(v.shape) for k,v in b.items() if torch.is_tensor(v)} for b in batches]
    # Each replay performs the same full sample window; data time is reported separately.
    batches=[tree_to(b,args.device) for b in batches]
    durations=[];losses=[];stage_times=[]
    def step():
        optimizer.zero_grad(set_to_none=True);values=[];stages={}
        for b in batches:
            sync(args.device);start=time.perf_counter()
            with torch.profiler.record_function('v25.forward'): pred=model(b)
            sync(args.device);stages['forward']=stages.get('forward',0)+time.perf_counter()-start;start=time.perf_counter()
            with torch.profiler.record_function('v25.loss'):
                kw={} if args.engine=='reference' else {'report_components':False}
                loss,_,_=loss_fn(pred,b['targets'],b,cfg,consistency_scale=args.consistency_scale,**kw)
            sync(args.device);stages['loss']=stages.get('loss',0)+time.perf_counter()-start;start=time.perf_counter()
            with torch.profiler.record_function('v25.backward'): (loss/len(batches)).backward()
            sync(args.device);stages['backward']=stages.get('backward',0)+time.perf_counter()-start
            values.append(float(loss.detach()))
        start=time.perf_counter()
        with torch.profiler.record_function('v25.optimizer'):
            torch.nn.utils.clip_grad_norm_(model.parameters(),1.,error_if_nonfinite=True);optimizer.step()
        sync(args.device);stages['optimizer']=time.perf_counter()-start
        return sum(values)/len(values),stages
    for _ in range(args.warmup): step()
    if args.device.startswith('cuda'):torch.cuda.reset_peak_memory_stats()
    for i in range(args.steps):
        sync(args.device);start=time.perf_counter();loss,stages=step();sync(args.device)
        durations.append(time.perf_counter()-start);losses.append(loss);stage_times.append(stages)
        print(json.dumps({'step':i,'seconds':durations[-1],'loss':loss}),flush=True)
    activities=[torch.profiler.ProfilerActivity.CPU]
    if args.device.startswith('cuda'):activities.append(torch.profiler.ProfilerActivity.CUDA)
    with torch.profiler.profile(activities=activities,record_shapes=True,profile_memory=True) as prof: step()
    (out/'operators.txt').write_text(prof.key_averages().table(sort_by='self_cpu_time_total',row_limit=45))
    ops=[{'name':e.key,'calls':e.count,'self_cpu_us':e.self_cpu_time_total,'cpu_us':e.cpu_time_total,'self_device_us':e.self_device_time_total,'device_us':e.device_time_total,'self_cpu_memory':e.self_cpu_memory_usage} for e in prof.key_averages()]
    (out/'operators.json').write_text(json.dumps(ops,indent=2))
    if args.trace:prof.export_chrome_trace(str(out/'trace.json'))
    from campaign_runtime import source_digest
    report={'source_sha256':source_digest(),'checkpoint':args.checkpoint,'checkpoint_sha256':hashlib.file_digest(open(args.checkpoint,'rb'),'sha256').hexdigest() if args.checkpoint else None,'platform':platform.platform(),'torch':torch.__version__,'device':args.device,'engine':args.engine,'config':cfg.to_dict(),'consistency_scale':args.consistency_scale,'seed':21701,'threads':args.threads,**info,'seconds_per_step':durations,'median_seconds':statistics.median(durations),'losses':losses,'stage_seconds':stage_times,'peak_allocated_bytes':torch.cuda.max_memory_allocated() if args.device.startswith('cuda') else None,'peak_reserved_bytes':torch.cuda.max_memory_reserved() if args.device.startswith('cuda') else None,'rtx_speedup':None,'note':'Warm replay of one real train window; excludes cold data and validation/checkpoint I/O. Instrumented stage timing includes synchronization.'}
    (out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)

if __name__=='__main__':main()
