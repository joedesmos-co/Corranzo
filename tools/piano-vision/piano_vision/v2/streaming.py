"""Bounded feature caching and provisional page delivery interfaces."""
from collections import OrderedDict
import hashlib

import torch


class FeatureCache:
    """Inference only. Include immutable weights/precision/input identity."""
    def __init__(self,model_digest,precision,max_bytes=256*1024**2):
        if not model_digest or max_bytes<1: raise ValueError("Invalid feature cache identity/budget")
        self.model_digest=model_digest;self.precision=precision;self.max_bytes=max_bytes
        self.rows=OrderedDict();self.bytes=0;self.hits=0;self.misses=0

    def get_views(self,model,images):
        if model.training: raise ValueError("Feature caching is forbidden during training")
        if images.shape[0]!=1: raise ValueError("Cache accepts one page/window at a time")
        results=[]
        for view in images[0]:
            pixels=view.detach().cpu().contiguous().numpy().tobytes()
            key=(self.model_digest,self.precision,tuple(view.shape),hashlib.sha256(pixels).hexdigest())
            if key in self.rows:
                self.hits+=1;self.rows.move_to_end(key);features,size=self.rows[key]
            else:
                self.misses+=1
                with torch.no_grad(): features=model.backbone(view[None])
                size=sum(t.numel()*t.element_size() for t in features)
                while self.rows and self.bytes+size>self.max_bytes:
                    _,(_,old)=self.rows.popitem(last=False);self.bytes-=old
                if size<=self.max_bytes:
                    self.rows[key]=(features,size);self.bytes+=size
            results.append(features)
        return [torch.cat([r[level] for r in results],0) for level in range(len(results[0]))]


def stream_pages(pages,recognize,reconcile):
    """Deliver each page immediately; retain only one unresolved page boundary.

    `reconcile(left,right)` returns left's final report, without truth access.
    Final means boundary processing finished, not high-confidence transcription.
    """
    previous=None;last_index=-1
    for page_index,pixels in pages:
        if page_index!=last_index+1: raise ValueError("Missing/duplicate/out-of-order page")
        report=recognize(page_index,pixels)
        yield {"event":"page_provisional","page":page_index,"result":report,"complete":False}
        if previous is not None:
            yield {"event":"page_final","page":last_index,"result":reconcile(previous,report)}
        previous=report;last_index=page_index
    if previous is not None:
        yield {"event":"page_final","page":last_index,"result":reconcile(previous,None)}

