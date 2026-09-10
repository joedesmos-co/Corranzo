"""Bounded architecture experiments. There is intentionally no full-train command."""
import argparse
import contextlib
from collections import Counter
from dataclasses import replace
import gc
import hashlib
import json
import os
from pathlib import Path
import platform
import resource
import statistics
import threading
import time

import numpy as np
import torch

from ..config import load_config,model_config
from ..data import CanonicalImageResolver,tensorize_scope,collate_semantic,scope_order,_center
from ..model import PianoVisionV1
from ..evaluator import move_to_device
from .config import PRESETS
from .data import development_scores,PageResolver,tensorize,build_inputs,collate,source_order,scope_box
from .model import PianoVisionV2
from .loss import semantic_loss
from .streaming import FeatureCache
from .checkpoint import save_checkpoint


def write_json(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists(): raise FileExistsError('Experiment artifacts are immutable; choose a new output path')
    with path.open('x') as f: json.dump(value,f,indent=2,sort_keys=True,allow_nan=False);f.write('\n')


def sync(device):
    if device.type=='mps': torch.mps.synchronize()
    elif device.type=='cuda': torch.cuda.synchronize()


def precision_context(device,precision):
    return torch.autocast(device_type=device.type,dtype=torch.float16) if precision=='fp16' else contextlib.nullcontext()


def model_report():
    rows=[]
    for name,config in PRESETS.items():
        m=PianoVisionV2(config);count=sum(p.numel() for p in m.parameters())
        groups={key:sum(p.numel() for p in module.parameters()) for key,module in m.named_children()}
        rows.append({'variant':name,'parameters':count,'config':config.to_dict(),'modules':groups,
                     'raw_weight_bytes':{'fp32':count*4,'fp16':count*2,'int8_estimate':count},
                     'int8_measured':False,'notation_decoder_supervised_in_production':False})
        del m
    return rows


def audit(index_path,train_scores=12,validation_scores=6,per_score=8):
    import random
    index=json.loads(Path(index_path).read_text());resolver=PageResolver(index['dataset_root'],index_path=index_path)
    v1_config=load_config()['data'];v1_resolver=CanonicalImageResolver(Path(index['dataset_root']),192,512)
    samples=[];family_counts=Counter();known_counts=Counter();positive_counts=Counter();subtypes=Counter();target_fields=Counter()
    coord_errors=[];fingerprints=[]
    for split,limit in (('train',train_scores),('validation',validation_scores)):
        for records in development_scores(index_path,split,limit):
            fingerprints.append({'score_id':records[0]['scoreId'],'split':split,'scope_count':len(records)})
            positions=np.linspace(0,len(records)-1,min(per_score,len(records)),dtype=int)
            for position in positions:
                record=records[position]
                v1=tensorize_scope(record,records,v1_resolver,v1_config,random.Random(0))
                v2=tensorize(record,records,resolver,PRESETS['compact'])
                current=record['input']['modelInput'];page=resolver.page(record)
                b=current['pixels']['cropBounds'];pw,ph=page.size
                x0,x1,y0,y1=[float(b[k]) for k in ('x0','x1','y0','y1')]
                px=max(.008,(x1-x0)*.08);py=max(.008,(y1-y0)*.16)
                left=max(0,int((x0-px)*pw));right=min(pw,int(np.ceil((x1+px)*pw)))
                top=max(0,int((y0-py)*ph));bottom=min(ph,int(np.ceil((y1+py)*ph)))
                sb=current['geometry']['scopeBounds']
                for obj in current.get('physicalObjects',[]):
                    cx,cy=_center(obj)
                    old=np.array([(cx-sb['x0'])/(sb['x1']-sb['x0'])*512,(cy-sb['y0'])/(sb['y1']-sb['y0'])*192])
                    correct=np.array([(cx*pw-left)/(right-left)*512,(cy*ph-top)/(bottom-top)*192])
                    coord_errors.append(float(np.linalg.norm(old-correct)))
                edges=current.get('sourceGraph',{}).get('edges',[])
                targets={f'{g}.{h}':int(p['mask'].sum()) for g,group in v2['targets'].items() for h,p in group.items()}
                samples.append({'example_id':record['exampleId'],'split':split,'physical_objects':len(current.get('physicalObjects',[])),
                                'v1_order_unparsed':scope_order(record['exampleId'])==10**12,
                                'v1_truncated_objects':v1['metadata']['truncated_objects'],'v1_relation_overflow':v1['metadata']['relation_capacity_reached'],
                                'v1_graph_nonzero_objects':int((v1['graph_features'].abs().sum(-1)>0).sum()),
                                'v2_truncated_objects':v2['metadata']['truncated_objects'],'v2_omitted_relations':v2['metadata']['omitted_relations'],
                                'v2_graph_nonzero_objects':int((v2['graph_features'].abs().sum(-1)>0).sum()),
                                'v2_views':len(v2['images']),'v2_objects':len(v2['object_mask']),
                                'string_graph_edges':sum(isinstance(e.get('from'),str) or isinstance(e.get('to'),str) for e in edges),
                                'v2_target_counts':targets,'v2_mask_reasons':v2['metadata']['target_mask_reasons']})
                for family,labels in record['target']['families'].items():
                    family_counts[family]+=len(labels)
                    for label in labels:
                        if label.get('state')!='KNOWN': continue
                        known_counts[family]+=1;positive_counts[family]+=int(bool(label.get('isPositive')))
                        value=label.get('value')
                        if isinstance(value,dict):
                            for key in value: target_fields[family+'.'+key]+=1
                            if family in ('DURATION','REST'):
                                subtypes[family+'.type.'+str(value.get('writtenType'))]+=1
                                subtypes[family+'.grace.'+str(value.get('grace'))]+=1
                                subtypes[family+'.ratio.'+json.dumps(value.get('timeModification'),sort_keys=True)]+=1
    target_counts=Counter()
    for s in samples: target_counts.update(s['v2_target_counts'])
    summary={'audited_scores':len(fingerprints),'audited_scopes':len(samples),'objects_for_coordinate_error':len(coord_errors),
             'v1_coordinate_error_pixels':{'median':float(np.median(coord_errors)),'p95':float(np.percentile(coord_errors,95)),
                                           'max':max(coord_errors)},
             'v1_unparsed_scope_ids':sum(s['v1_order_unparsed'] for s in samples),
             'v1_scopes_with_truncated_objects':sum(s['v1_truncated_objects']>0 for s in samples),
             'v2_scopes_with_truncated_objects':sum(s['v2_truncated_objects']>0 for s in samples),
             'v1_scopes_with_pair_overflow':sum(s['v1_relation_overflow'] for s in samples),
             'v2_scopes_with_pair_overflow':sum(s['v2_omitted_relations']>0 for s in samples),
             'v1_graph_nonzero_objects':sum(s['v1_graph_nonzero_objects'] for s in samples),
             'v2_graph_nonzero_objects':sum(s['v2_graph_nonzero_objects'] for s in samples)}
    return {'kind':'bounded-production-architecture-audit','dataset_digest':index['dataset_digest'],
            'manifest_digest':index['manifest_digest'],'selection':'deterministic source-hash score sample; evenly spaced scopes',
            'test_opened':False,'future_test_opened':False,'source_archives_opened':False,
            'summary':summary,'historical_canonical_split_mismatches':resolver.historical_split_mismatches,
            'scores':fingerprints,'samples':samples,'sample_known_labels':dict(known_counts),
            'sample_positive_labels':dict(positive_counts),'sample_subtypes':dict(subtypes),'sample_target_fields':dict(target_fields),
            'v2_supervision_counts':dict(target_counts),'counts_are_full_corpus_estimates':False,
            'full_corpus_family_metadata':index.get('family_availability',{}),'full_corpus_splits_metadata':index['splits']}


class MemorySampler:
    def __init__(self,device): self.device=device;self.driver=0;self.allocated=0;self.stop=threading.Event()
    def sample(self):
        while not self.stop.wait(.01):
            if self.device.type=='mps':
                self.driver=max(self.driver,torch.mps.driver_allocated_memory());self.allocated=max(self.allocated,torch.mps.current_allocated_memory())
    def __enter__(self): self.thread=threading.Thread(target=self.sample,daemon=True);self.thread.start();return self
    def __exit__(self,*args): self.stop.set();self.thread.join()
    def report(self):
        rss=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        if platform.system()!='Darwin':rss*=1024
        return {'process_peak_rss_bytes':rss,'sampled_mps_driver_peak_bytes':self.driver or None,
                'sampled_mps_tensor_peak_bytes':self.allocated or None,'sampling_interval_seconds':.01,
                'peak_caveat':'RSS is process lifetime high-water; MPS values are sampled lower bounds, not exact device peaks'}


def workload(index_path,config):
    groups=list(development_scores(index_path,'train',8))
    eligible=[g for g in groups if 8<=len(g)<=40]
    records=min(eligible or groups,key=lambda g:abs(len(g)-16))
    resolver=PageResolver(json.loads(Path(index_path).read_text())['dataset_root'],index_path=index_path)
    representative=sorted(records,key=lambda r:len(r['input']['modelInput']['physicalObjects']))[min(len(records)-1,round(.75*(len(records)-1)))]
    return records,representative,resolver


def benchmark(index_path,variant,device_name='mps',precision='fp32',steps=8,batch_size=2):
    if not 2<=steps<=20 or not 1<=batch_size<=4:raise ValueError('Benchmark must remain bounded')
    if precision=='fp16' and device_name=='cpu':raise ValueError('CPU FP16 is not a target configuration')
    torch.manual_seed(21701);torch.set_num_threads(4);device=torch.device(device_name)
    config=PRESETS[variant];records,representative,resolver=workload(index_path,config)
    sample=tensorize(representative,records,resolver,config)
    batch=move_to_device(collate([sample]*batch_size),device)
    one=move_to_device(collate([sample]),device)
    model=PianoVisionV2(config).to(device);optimizer=torch.optim.AdamW(model.parameters(),lr=3e-4)
    times=[];train_times=[]
    with MemorySampler(device) as memory:
        model.train()
        for step in range(steps+2):
            sync(device);t=time.perf_counter();optimizer.zero_grad(set_to_none=True)
            with precision_context(device,precision):
                output=model(batch);loss,count=semantic_loss(output,batch['targets'])
            if not torch.isfinite(loss) or int(count)==0:raise FloatingPointError('Invalid benchmark loss/supervision')
            loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1.0,error_if_nonfinite=True);optimizer.step();sync(device)
            if step>=2:train_times.append(time.perf_counter()-t)
        model.eval()
        with torch.no_grad():
            for step in range(steps+2):
                sync(device);t=time.perf_counter()
                with precision_context(device,precision):output=model(one)
                sync(device)
                if step>=2:times.append(time.perf_counter()-t)
        mem=memory.report()
    # A measured conditional short score: source layout/proposals supplied from
    # train records. Includes loading/tensorization and cached CNN/context passes.
    # It excludes a new photo/PDF detector, notation token generation and export.
    page_times={};cache=FeatureCache('benchmark-current-weights',precision);start=time.perf_counter()
    with torch.no_grad():
        for record in records:
            t=time.perf_counter();sample=build_inputs(record,records,resolver,config)[0]
            b=move_to_device(collate([sample]),device)
            with precision_context(device,precision):
                features=cache.get_views(model,b['images']);result=model(b,features)
            sync(device);page=source_order(record)[0];page_times[page]=page_times.get(page,0)+(time.perf_counter()-t)
    total=time.perf_counter()-start
    parameters=sum(p.numel() for p in model.parameters())
    result={'variant':variant,'parameters':parameters,'raw_weight_bytes':{'fp32':parameters*4,'fp16':parameters*2,'int8_estimate':parameters},
            'device':str(device),'precision':precision,'torch':torch.__version__,'platform':platform.platform(),
            'cpu_threads':torch.get_num_threads(),'training_batch_size':batch_size,'timed_steps':steps,
            'training_examples_per_second':batch_size/statistics.mean(train_times),'training_step_seconds':train_times,
            'inference_median_seconds':statistics.median(times),'inference_p95_seconds':float(np.percentile(times,95)),
            'inference_samples_seconds':times,'memory':mem,'representative_example':representative['exampleId'],
            'workload':{'views':one['images'].shape[1],'image_shape':list(one['images'].shape[-2:]),
                        'objects':one['object_mask'].shape[1],'relations':int(one['relation_mask'].sum())},
            'conditional_short_score':{'score_id':records[0]['scoreId'],'scopes':len(records),'pages':len(page_times),
                                       'seconds':total,'per_page_seconds':page_times,'cache_hits':cache.hits,'cache_misses':cache.misses,
                                       'cache_bytes':cache.bytes,'full_omr_end_to_end':False},
            'excludes':['new source proposal/layout detection','PDF/photo normalization','notation sequence decoding','constraint search/export'],
            'test_opened':False,'future_test_opened':False,'weights_are_trained':False,'quality_comparison':False}
    return result


def smoke(index_path,variant,steps=100,examples=4,device_name='mps',ablation='full',checkpoint=None,validation_scores=0):
    if not 1<=steps<=500 or not 1<=examples<=16:raise ValueError('Smoke bounds: <=500 steps, <=16 train examples')
    torch.manual_seed(21701);torch.set_num_threads(4)
    config=PRESETS[variant]
    if ablation=='no-refinement':config=replace(config,refinement_steps=0)
    config=replace(config,dropout=0,source_dropout=0)
    groups=list(development_scores(index_path,'train',2));resolver=PageResolver(json.loads(Path(index_path).read_text())['dataset_root'],index_path=index_path)
    samples=[]
    for records in groups:
        for record in records:
            sample=tensorize(record,records,resolver,config)
            if any(bool(p['mask'].any()) for p in sample['targets']['object'].values()):samples.append(sample)
            if len(samples)>=examples:break
        if len(samples)>=examples:break
    device=torch.device(device_name);batch=move_to_device(collate(samples),device)
    if ablation=='no-global':
        for bi,sample in enumerate(samples):
            for vi,key in enumerate(sample['metadata']['views']):
                if key[0] in {'page','system'}:batch['images'][bi,vi].fill_(1)
    model=PianoVisionV2(config).to(device);optimizer=torch.optim.AdamW(model.parameters(),lr=5e-4,weight_decay=1e-4)
    def evaluate():
        model.eval()
        with torch.no_grad():
            output=model(batch);loss,count=semantic_loss(output,batch['targets']);metrics={}
            for group in ('object','relation','context'):
                for head,logits in output[group].items():
                    payload=batch['targets'][group].get(head)
                    if payload is None:continue
                    mask=payload['mask'];n=int(mask.sum())
                    if n:metrics[group+'.'+head]={'accuracy':float((logits.argmax(-1)[mask]==payload['target'][mask]).float().mean()),'labels':n}
        return float(loss),metrics
    before,_=evaluate();started=time.perf_counter();losses=[]
    for step in range(steps):
        model.train();optimizer.zero_grad(set_to_none=True);output=model(batch);loss,count=semantic_loss(output,batch['targets'])
        if not torch.isfinite(loss) or int(count)==0:raise FloatingPointError('Smoke loss invalid')
        loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1.,error_if_nonfinite=True);optimizer.step()
        if step==0 or (step+1)%20==0:losses.append({'step':step+1,'loss':float(loss.detach())})
    sync(device);elapsed=time.perf_counter()-started;after,metrics=evaluate()
    saved=None
    if checkpoint:
        saved=save_checkpoint(checkpoint,model,optimizer,steps,json.loads(Path(index_path).read_text())['dataset_digest'])
    validation=None
    if validation_scores:
        if not 1<=validation_scores<=8:raise ValueError('Bounded validation uses at most eight selection scores')
        scores=[];counts=Counter();correct=Counter();loss_sum=0.;scopes=0
        with torch.no_grad():
            for records in development_scores(index_path,'validation',validation_scores,validation_role='selection'):
                scores.append({'score_id':records[0]['scoreId'],'semantic_source_id':records[0]['semanticSourceId']})
                for position in np.linspace(0,len(records)-1,min(3,len(records)),dtype=int):
                    sample=tensorize(records[position],records,resolver,config);vb=move_to_device(collate([sample]),device)
                    if ablation=='no-global':
                        for vi,key in enumerate(sample['metadata']['views']):
                            if key[0] in {'page','system'}:vb['images'][:,vi].fill_(1)
                    out=model(vb);vl,_=semantic_loss(out,vb['targets']);loss_sum+=float(vl);scopes+=1
                    for group in ('object','relation','context'):
                        for head,logits in out[group].items():
                            payload=vb['targets'][group].get(head)
                            if payload is None:continue
                            mask=payload['mask'];key=group+'.'+head;counts[key]+=int(mask.sum())
                            correct[key]+=int(((logits.argmax(-1)==payload['target'])&mask).sum())
        validation={'split':'validation','partition':'selection','scores':scores,'scopes':scopes,
                    'mean_scope_loss':loss_sum/max(1,scopes),'head_metrics':{k:{'correct':correct[k],'labels':n,'accuracy':correct[k]/n} for k,n in counts.items() if n},
                    'complete_score_accuracy_measured':False,'sufficient_for_capacity_selection':False,
                    'interpretation':'Tiny training fixture and bounded held-out scopes; diagnostic only, not a trained-capacity ranking'}
    return {'variant':variant,'ablation':ablation,'steps':steps,'examples':len(samples),'example_ids':[s['metadata']['example_id'] for s in samples],
            'split':'train','device':device_name,'loss_before':before,'loss_after':after,'loss_history':losses,
            'elapsed_seconds':elapsed,'effective_examples_per_second':steps*len(samples)/elapsed,'head_metrics':metrics,
            'checkpoint':saved,'generalization_measured':validation is not None,'validation':validation,'test_opened':False,'future_test_opened':False,
            'overfit_criterion_loss_ratio':.25,'overfit_pass':after<before*.25}


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['inspect','audit','benchmark','smoke'])
    parser.add_argument('--index',type=Path);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--variant',choices=list(PRESETS),default='compact');parser.add_argument('--device',choices=['cpu','mps'],default='mps')
    parser.add_argument('--precision',choices=['fp32','fp16'],default='fp32');parser.add_argument('--steps',type=int)
    parser.add_argument('--batch-size',type=int,default=2);parser.add_argument('--examples',type=int,default=4)
    parser.add_argument('--ablation',choices=['full','no-refinement','no-global'],default='full');parser.add_argument('--checkpoint',type=Path)
    parser.add_argument('--validation-scores',type=int,default=0)
    args=parser.parse_args(argv)
    if args.output.exists():raise FileExistsError('Output already exists')
    if args.command!='inspect' and args.index is None:parser.error('--index is required')
    if args.command=='inspect':result={'models':model_report()}
    elif args.command=='audit':result=audit(args.index)
    elif args.command=='benchmark':result=benchmark(args.index,args.variant,args.device,args.precision,args.steps or 8,args.batch_size)
    else:result=smoke(args.index,args.variant,args.steps or 100,args.examples,args.device,args.ablation,args.checkpoint,args.validation_scores)
    write_json(args.output,result);print(json.dumps({'output':str(args.output),'command':args.command,'finished':True}))
