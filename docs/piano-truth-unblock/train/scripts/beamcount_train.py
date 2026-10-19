#!/usr/bin/env python3
"""Bounded image-based beam-count classifier (4 classes: 0/1/2/3 beams).
Labels derived from SVG beam polygons (structural supervision on renders only).
No SVG at inference. CPU. Writes models/beamcount.pt + reports/beamcount.json.
"""
from __future__ import annotations
import json, time
from collections import Counter
from pathlib import Path
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F

HERE=Path(__file__).resolve().parent
TRAIN=HERE.parent
EPOCHS,LR,BATCH=4,3e-4,256
SEED=0

class SmallCNN(nn.Module):
    def __init__(self, n_out=4):
        super().__init__()
        def C(i,o): return nn.Sequential(nn.Conv2d(i,o,3,padding=1),nn.BatchNorm2d(o),nn.ReLU())
        self.feat=nn.Sequential(C(1,8),C(8,16),nn.MaxPool2d(2),C(16,32),C(32,32),nn.MaxPool2d(2),C(32,32),nn.AdaptiveAvgPool2d((4,4)),nn.Flatten())
        self.head=nn.Sequential(nn.Linear(32*16,128),nn.ReLU(),nn.Linear(128,n_out))
    def forward(self,t): return self.head(self.feat(t))

def main():
    t0=time.time()
    X=np.load(TRAIN/'data'/'v1_train100.npz')['X'][:8000]
    y=np.load(TRAIN/'data'/'beamcount_train100.npy')[:8000]
    m=y>=0
    X=X[m]; y=y[m]
    # class weights
    cnt=Counter(y.tolist())
    w=np.array([1.0/max(1,cnt[c]) for c in range(4)],dtype=np.float32)
    w=w/w.mean()
    print('train dist',dict(cnt),flush=True)
    # split 10% held out by index
    rng=np.random.default_rng(SEED)
    perm=rng.permutation(len(X))
    nval=max(1,len(X)//10)
    val=perm[:nval]; tr=perm[nval:]
    Xt=torch.from_numpy(X[tr][:,None]).float()/255; Yt=torch.from_numpy(y[tr]).long()
    Xv=torch.from_numpy(X[val][:,None]).float()/255; Yv=torch.from_numpy(y[val]).long()
    torch.manual_seed(SEED)
    net=SmallCNN(4)
    opt=torch.optim.AdamW(net.parameters(),lr=LR)
    Wt=torch.from_numpy(w)
    for ep in range(EPOCHS):
        net.train()
        p=torch.randperm(len(Xt))
        for s in range(0,len(Xt),BATCH):
            idx=p[s:s+BATCH]
            opt.zero_grad()
            lg=net(Xt[idx])
            loss=F.cross_entropy(lg,Yt[idx],weight=Wt)
            loss.backward(); opt.step()
        net.eval()
        with torch.no_grad():
            acc=float((net(Xv).argmax(-1)==Yv).float().mean())
        print(f'epoch {ep+1} heldout_acc={acc:.4f} t={time.time()-t0:.0f}s',flush=True)
    net.eval()
    with torch.no_grad():
        acc=float((net(Xv).argmax(-1)==Yv).float().mean())
    print('FINAL heldout acc',acc,flush=True)
    # dev20 eval
    Xd=np.load(TRAIN/'data'/'v1_dev20.npz')['X']
    yd=np.load(TRAIN/'data'/'beamcount_dev20.npy')
    md=yd>=0
    Xd=X[d][:,None] if False else Xd[md][:,None]
    yd=yd[md]
    with torch.no_grad():
        pred=net(torch.from_numpy(Xd).float()/255).argmax(-1).numpy()
    devacc=float((pred==yd).mean())
    print('dev20 acc',devacc,'n',len(yd),flush=True)
    # per-class
    for c in range(4):
        mm=(yd==c)
        if mm.sum():
            print(f'  class {c}: acc {float((pred[mm]==c).mean()):.4f} n {int(mm.sum())}',flush=True)
    if acc>=0.85 and devacc>=0.80:
        torch.save({'state':net.state_dict()}, TRAIN/'models'/'beamcount.pt')
        print('PASS saved models/beamcount.pt',flush=True)
    else:
        print('FAIL no artifact',flush=True)
    import json
    (TRAIN/'reports'/'beamcount.json').write_text(json.dumps({'heldout':acc,'dev20':devacc,'dev_n':int(len(yd))},indent=1))

if __name__=='__main__':
    main()
