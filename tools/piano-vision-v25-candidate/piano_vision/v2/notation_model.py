"""One shared region-conditioned notation decoder, not a head per marking."""
import torch
from torch import nn
from .notation import NotationCodec


class NotationDecoder(nn.Module):
    version="region-notation-sequence/2.0"

    def __init__(self,source_dim,width=256,max_length=4096,
                   cand_geo_dim=6,cand_kinds=4):
        super().__init__()
        self.max_length=max_length
        self.memory=nn.Linear(source_dim,width)
        # D1 candidate-anchor context (additive; zero-initialized for safe init).
        self.cand_gate=nn.Parameter(torch.zeros(1))
        self.cand_geo=nn.Sequential(nn.Linear(cand_geo_dim,width),nn.GELU(),
                                    nn.Linear(width,source_dim))
        nn.init.zeros_(self.cand_geo[2].weight)
        nn.init.zeros_(self.cand_geo[2].bias)
        self.cand_kind=nn.Embedding(cand_kinds,source_dim,padding_idx=0)
        nn.init.zeros_(self.cand_kind.weight)
        self.embedding=nn.Embedding(NotationCodec.VOCAB_SIZE,width,padding_idx=NotationCodec.PAD)
        positions=torch.arange(max_length)[:,None].float()
        frequencies=torch.exp(torch.arange(0,width,2).float()*(-__import__('math').log(10000)/width))
        position=torch.zeros(max_length,width)
        position[:,0::2]=torch.sin(positions*frequencies)
        position[:,1::2]=torch.cos(positions*frequencies)
        self.register_buffer("position",position,persistent=False)
        self.decoder=nn.TransformerDecoder(nn.TransformerDecoderLayer(width,8,768,dropout=0,
                                                                      batch_first=True,norm_first=True),2)
        self.output=nn.Linear(width,NotationCodec.VOCAB_SIZE)

    def _memory_with_candidates(self,region_context,cand):
        """Shared memory builder. cand=None reproduces the legacy single-token path."""
        memory=self.memory(region_context)
        if memory.ndim==2: memory=memory[:,None]
        if cand is None:
            return memory,None
        emb,geo,kind,mask=cand["emb"],cand["geo"],cand["kind"],cand["mask"]
        assert geo.shape[-1]==self.cand_geo[0].in_features, "candidate geo dim mismatch"
        fused=emb+self.cand_geo(geo)+self.cand_kind(kind.clamp_min(0))
        cmem=self.cand_gate*self.memory(fused)
        memory=torch.cat((memory,cmem),1)
        pad=torch.zeros(memory.shape[0],1,dtype=torch.bool,device=memory.device)
        return memory,torch.cat((pad,~mask),1)

    def forward(self,region_context,tokens,cand=None):
        if tokens.ndim!=2 or tokens.shape[1]>self.max_length: raise ValueError("Notation sequence capacity exceeded")
        n=tokens.shape[1]
        value=self.embedding(tokens)+self.position[:n][None]
        memory,mem_mask=self._memory_with_candidates(region_context,cand)
        causal=torch.ones(n,n,dtype=torch.bool,device=tokens.device).triu(1)
        output=self.decoder(value,memory,tgt_mask=causal,tgt_key_padding_mask=tokens==NotationCodec.PAD,
                            memory_key_padding_mask=mem_mask)
        return self.output(output)

    @torch.no_grad()
    def generate(self,region_context,max_new_tokens=512,cand=None):
        """Bounded greedy baseline. Truncated/malformed output remains review.

        This is an executable inference interface, not a qualified OCR decoder.
        No KV cache yet: sequence deployment cost must be measured separately.
        """
        if self.training: raise ValueError("Notation generation requires evaluation mode")
        if not 1<=max_new_tokens<self.max_length: raise ValueError("Invalid notation generation budget")
        n=region_context.shape[0]
        tokens=torch.full((n,1),NotationCodec.BOS,dtype=torch.long,device=region_context.device)
        finished=torch.zeros(n,dtype=torch.bool,device=tokens.device)
        log_probability=torch.zeros(n,device=tokens.device)
        for _ in range(max_new_tokens):
            logits=self(region_context,tokens,cand=cand)[:,-1].float()
            logits[:,[NotationCodec.PAD,NotationCodec.BOS]]=-torch.inf
            probabilities=logits.log_softmax(-1)
            chosen=probabilities.argmax(-1)
            log_probability+=torch.where(finished,0,probabilities.gather(1,chosen[:,None]).squeeze(1))
            chosen=torch.where(finished,NotationCodec.PAD,chosen)
            tokens=torch.cat((tokens,chosen[:,None]),1)
            finished|=chosen==NotationCodec.EOS
            if bool(finished.all()): break
        return {"tokens":tokens,"log_probability":log_probability,"terminated":finished,
                "calibrated":False,"complete":False}
