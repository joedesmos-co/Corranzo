"""Actual beam search over the same object-set memory used in teacher forcing.

Search scores are sums of token log probabilities, matching the frozen V2
beam harness. No length normalization, syntax repair or target-based rerank.
Malformed/truncated candidates remain review. This does not certify MusicXML.
"""
import torch
from ..v2.notation import NotationCodec


def decode_memory(decoder, memory, tokens, memory_pad=None):
    if tokens.ndim!=2 or not 1<=tokens.shape[1]<=decoder.max_length:
        raise ValueError('Invalid notation sequence shape/capacity')
    n=tokens.shape[1]
    value=decoder.embedding(tokens)+decoder.position[:n][None]
    causal=torch.ones(n,n,dtype=torch.bool,device=tokens.device).triu(1)
    decoded=decoder.decoder(value,memory,tgt_mask=causal,
        tgt_key_padding_mask=tokens==NotationCodec.PAD,memory_key_padding_mask=memory_pad)
    return decoder.output(decoded)


@torch.no_grad()
def beam_generate(decoder, memory, memory_pad=None, width=4, max_new_tokens=1024):
    if decoder.training:raise ValueError('Generation requires eval mode')
    if not 1<=width<=16 or not 1<=max_new_tokens<decoder.max_length:
        raise ValueError('Invalid beam width/budget')
    rows=[];all_candidates=[]
    for row in range(memory.shape[0]):
        tokens=torch.full((1,1),NotationCodec.BOS,dtype=torch.long,device=memory.device)
        scores=memory.new_zeros(1,dtype=torch.float32);finished=torch.zeros(1,dtype=torch.bool,device=memory.device)
        for _ in range(max_new_tokens):
            mem=memory[row:row+1].expand(len(tokens),-1,-1)
            pad=memory_pad[row:row+1].expand(len(tokens),-1) if memory_pad is not None else None
            logits=decode_memory(decoder,mem,tokens,pad)[:,-1].float()
            logits[:,[NotationCodec.PAD,NotationCodec.BOS]]=-torch.inf
            logp=logits.log_softmax(-1)
            # Keep completed paths in the same beam, at unchanged score.
            logp=logp.masked_fill(finished[:,None],-torch.inf)
            logp[:,NotationCodec.PAD]=torch.where(finished,0.,logp[:,NotationCodec.PAD])
            candidates=scores[:,None]+logp
            scores,flat=candidates.flatten().topk(width)
            parents=flat//NotationCodec.VOCAB_SIZE;chosen=flat%NotationCodec.VOCAB_SIZE
            tokens=torch.cat((tokens.index_select(0,parents),chosen[:,None]),1)
            finished=finished.index_select(0,parents)|(chosen==NotationCodec.EOS)
            if bool(finished.all()):break
        all_candidates.append({'tokens':tokens,'log_probability':scores,'terminated':finished})
        rows.append(tokens[0])
    maxlen=max(map(len,rows),default=1)
    result=torch.full((len(rows),maxlen),NotationCodec.PAD,dtype=torch.long,device=memory.device)
    for row,tokens in enumerate(rows):result[row,:len(tokens)]=tokens
    return {'tokens':result,'log_probability':torch.stack([r['log_probability'][0] for r in all_candidates]),
            'terminated':torch.stack([r['terminated'][0] for r in all_candidates]),'width':width,
            'candidates':all_candidates,'calibrated':False,'complete':False,'verifier_applied':False}


@torch.no_grad()
def generate_batch(model,batch,width=4,max_new_tokens=1024):
    if model.training:raise ValueError('Generation requires eval mode')
    output=model(batch,decode_notation=False,return_memory=True)
    if 'notation_memory' not in output:raise ValueError('Source notation regions required')
    active=batch['notation_mask'].flatten().nonzero(as_tuple=False).flatten()
    if not len(active):raise ValueError('No active source notation regions')
    pad=output['notation_memory_pad']
    result=beam_generate(model.notation_decoder,output['notation_memory'].index_select(0,active),
                         pad.index_select(0,active) if pad is not None else None,width,max_new_tokens)
    result['region_indices']=active
    return result


@torch.no_grad()
def component_lane_decode(lane_logits,continuation_prob,relation_index,relation_mask,object_mask,threshold=.95):
    """Ablation only: pool lane evidence within confident relation components.

    Components use predicted relations only; padded/isolated objects survive.
    Canonical lane class labels are retained. No musical correctness guarantee.
    """
    logp=lane_logits.detach().float().log_softmax(-1).cpu()
    prob=continuation_prob.detach().cpu();index=relation_index.detach().cpu();mask=relation_mask.detach().cpu();valid=object_mask.detach().cpu()
    result=logp.argmax(-1)
    for row in range(len(logp)):
        parent=list(range(logp.shape[1]))
        def find(a):
            while parent[a]!=a:parent[a]=parent[parent[a]];a=parent[a]
            return a
        for (a,b),p,keep in zip(index[row].tolist(),prob[row].tolist(),mask[row].tolist()):
            if keep and p>=threshold and valid[row,a] and valid[row,b]:parent[find(b)]=find(a)
        groups={}
        for i in range(len(parent)):
            if valid[row,i]:groups.setdefault(find(i),[]).append(i)
        for items in groups.values():result[row,items]=logp[row,items].sum(0).argmax(-1)
    return result.to(lane_logits.device)
