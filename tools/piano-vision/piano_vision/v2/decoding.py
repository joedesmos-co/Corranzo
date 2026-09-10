"""Neural-distribution → review-graph boundary, independent of XML serialization.

Incomplete time/role/proposal evidence is retained as review. This module does
not invent onsets from horizontal spacing or invent rests to complete a bar.
"""
from dataclasses import asdict
import torch

from .notation import NotationNode,ONTOLOGY_VERSION,unknown_region


def alternatives(logits,limit=3):
    if not torch.isfinite(logits).all(): raise ValueError("NONFINITE_SEMANTIC_OUTPUT")
    if not 1<=limit<=logits.shape[-1]: raise ValueError("Invalid alternative count")
    probabilities=logits.detach().float().softmax(-1).cpu()
    values,indexes=probabilities.topk(limit,dim=-1)
    return [[{"class_index":int(i),"probability":float(v)} for i,v in zip(ids,row)]
            for ids,row in zip(indexes,values)]


def review_window(output,batch,index=0,unmapped_regions=()):
    """All distributions use the versioned head vocabulary, not implicit MIDI.

    Metadata contains only source identities/regions. It must come from
    build_inputs, never from semantic target IDs. Probabilities are explicitly
    raw until a checkpoint-bound calibration stage has been applied.
    """
    metadata=batch['metadata'][index]
    current=metadata['current_objects'];ids=metadata['object_ids'];regions=metadata['object_source_regions']
    if not 0<=current<=len(ids) or len(regions)!=len(ids): raise ValueError('Invalid source object mapping')
    fields={head:alternatives(logits[index,:current],min(3,logits.shape[-1])) for head,logits in output['object'].items()}
    nodes=[]
    for i in range(current):
        attributes={'distributions':{head:rows[i] for head,rows in fields.items()},
                    'probability_status':'uncalibrated','onset_state':'unresolved','roles_state':'unexpanded'}
        node=NotationNode(ids[i],'event','corranzo:physical-object-semantics',attributes=attributes,
                          region=regions[i],status='needs_review',provenance=[{'stage':'v2-neural-refinement','source_object':ids[i]}])
        nodes.append(asdict(node.validate()))
    relations=[]
    mask=batch['relation_mask'][index]
    pairs=batch['relation_index'][index][mask].cpu().tolist()
    values={head:alternatives(logits[index][mask],min(3,logits.shape[-1])) for head,logits in output['relation'].items()}
    for r,(left,right) in enumerate(pairs):
        relations.append({'anchors':[ids[left],ids[right]],'distributions':{head:rows[r] for head,rows in values.items()}})
    for i,region in enumerate(unmapped_regions):
        nodes.append(unknown_region(region.get('id',f'unknown:{i}'),region['page'],region['box'],
                                    region.get('reason','UNSUPPORTED_NOTATION')))
    context={head:alternatives(logits[index][batch['hierarchy_mask'][index]],min(3,logits.shape[-1]))
             for head,logits in output['context'].items()}
    return {'schema_version':ONTOLOGY_VERSION,'example_id':metadata['example_id'],'score_id':metadata['score_id'],
            'page':metadata['page'],'notations':nodes,'relation_candidates':relations,'context_candidates':context,
            'source_object_ids':ids,'complete':False,'status':'REVIEW',
            'reasons':['PROPOSAL_RECALL_UNQUALIFIED','NOTATION_COVERAGE_UNQUALIFIED','TIMING_AND_ROLES_UNRESOLVED','CALIBRATION_UNQUALIFIED'],
            'overflow':{'objects':metadata['truncated_objects'],'relations':metadata['omitted_relations']}}
