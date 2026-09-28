"""Source-only CPU plans and equivalent tensor operations for V2.5.

Plans must be built after collation, before device transfer. They are ephemeral
batch data, never checkpoint parameters or supervision. Reference fallbacks
remain available for callers that have not prepared a batch.
"""
import torch
from torch.nn import functional as F
from ..v2.visual import RegionSampler


def sampling_plan(view_index, mask, views):
    if view_index.device.type != 'cpu' or mask.device.type != 'cpu':
        raise ValueError('Build sampling plans on CPU before transfer')
    b,n=view_index.shape
    buckets=[[] for _ in range(b*views)]
    inverse=[0]*(b*n);valid=[False]*(b*n)
    for row,(ids,keep) in enumerate(zip(view_index.tolist(),mask.tolist())):
        for col,(v,active) in enumerate(zip(ids,keep)):
            if active and 0<=v<views:buckets[row*views+v].append(row*n+col)
    q=max(1,max(map(len,buckets),default=0))
    indices=torch.zeros(b*views,q,dtype=torch.long)
    for group,items in enumerate(buckets):
        if items:indices[group,:len(items)]=torch.tensor(items)
        for slot,obj in enumerate(items):inverse[obj]=group*q+slot;valid[obj]=True
    return {'indices':indices,'inverse':torch.tensor(inverse),
            'valid':torch.tensor(valid,dtype=torch.bool),'batch':b,'objects':n}


class PackedRegionSampler(RegionSampler):
    def forward(self, features, boxes, view_index, mask, views_per_batch, plan=None):
        if plan is None:
            return super().forward(features,boxes,view_index,mask,views_per_batch)
        b,n,_=boxes.shape
        pos=boxes[...,:2].unsqueeze(2)+self.grid*(boxes[...,2:]-boxes[...,:2]).unsqueeze(2)
        ids=plan['indices'];q=ids.shape[1]
        grid=pos.flatten(0,1).index_select(0,ids.flatten()).reshape(b*views_per_batch,q,len(self.grid),2)*2-1
        result=[]
        for feature in features:
            sampled=F.grid_sample(feature,grid,mode='bilinear',align_corners=False,padding_mode='zeros')
            packed=sampled.permute(0,2,1,3).flatten(2).flatten(0,1)
            value=packed.index_select(0,plan['inverse']).reshape(b,n,-1)
            result.append(value*plan['valid'].reshape(b,n,1))
        return torch.cat(result,-1)


def voice_plan(index, mask):
    """Preserve reference pair lookup, duplicate/padding and triple order exactly."""
    if index.device.type!='cpu' or mask.device.type!='cpu':
        raise ValueError('Build voice plans on CPU before transfer')
    rev=[];triples=[]
    for row,(edges,active) in enumerate(zip(index.tolist(),mask.tolist())):
        table={a*4096+c:e for e,(a,c) in enumerate(edges)}
        rev.append([table.get(c*4096+a,-1) for a,c in edges])
        if row>=2:continue
        succ={}
        for e,((a,c),keep) in enumerate(zip(edges,active)):
            if keep:succ.setdefault(a,[]).append(e)
        first={a:{ } for a in succ}
        for a,items in succ.items():
            for e in items:first[a].setdefault(edges[e][1],e)
        for e in [e for e,keep in enumerate(active) if keep][:256]:
            a,c=edges[e]
            for f in succ.get(c,[])[:8]:
                g=first.get(a,{}).get(edges[f][1])
                if g is not None:triples.append((row,e,f,g))
    return {'reverse':torch.tensor(rev,dtype=torch.long).reshape(mask.shape),
            'triples':torch.tensor(triples,dtype=torch.long).reshape(-1,4)}


def prepare_batch(batch, consistency=True):
    """Return an augmented CPU batch without altering the caller's tensors."""
    result=dict(batch)
    if consistency and 'relation_index' in batch:
        result['voice_plan']=voice_plan(batch['relation_index'],batch['relation_mask'])
    if 'images' in batch:
        views=batch['images'].shape[1]
        result['semantic_sampling_plan']=sampling_plan(
            torch.cat((batch['object_view'],batch['hierarchy_view']),1),
            torch.cat((batch['object_mask'],batch['hierarchy_mask']),1),views)
        if 'notation_boxes' in batch:
            result['notation_sampling_plan']=sampling_plan(batch['notation_view'],batch['notation_mask'],views)
    return result


def compact_relation_messages(feedback, outputs, batch, objects):
    """Aggregate 14 probabilities before the affine projection to 480 features.

    Linear maps commute with sums. Bias is included only for nonzero degree.
    This retains every edge/head, parameter, gradient path and normalization.
    """
    names=list(feedback)
    probability=torch.cat([outputs['relation'][name].softmax(-1) for name in names],-1)
    edge_mask=batch['relation_mask'].unsqueeze(-1).to(probability.dtype)
    probability=probability*edge_mask
    b,n,_=objects.shape
    pooled=probability.new_zeros(b,n,probability.shape[-1]);degree=probability.new_zeros(b,n,1)
    for end in (0,1):
        index=batch['relation_index'][...,end,None]
        pooled=pooled.scatter_add(1,index.expand(-1,-1,probability.shape[-1]),probability)
        degree=degree.scatter_add(1,index,edge_mask)
    pooled=pooled/degree.clamp_min(1)
    parts=pooled.split([feedback[name].in_features for name in names],dim=-1)
    messages=sum(feedback[name](p) for name,p in zip(names,parts))
    return messages*(degree>0)
