"""
Heads-only fine-tune with rehearsal consistency.

Split by COMPOSITION (not take), because every player recorded every
composition: a take split shares music between train and validation.

  train      BN1, BN2, Jazz1, Jazz2        (inspected material, used for fitting)
  validation Funk1, Funk3                  (different compositions, used for selection)
  fresh test Rock1, SS1, Funk2             (never used in any evaluation here)

Trainable: the two output heads only (note (7,3), onset (3,3)); the feature
front end and the contour branch are frozen, BatchNorm frozen. A rehearsal
consistency term (MSE to the frozen original outputs) is applied on
validation-composition windows on alternating steps, which is the direct
antidote to the recall collapse seen in the previous full fine-tune.
"""
import os, sys, json, glob
os.environ['TF_CPP_MIN_LOG_LEVEL']='2'; os.environ['TF_USE_LEGACY_KERAS']='1'
sys.path.insert(0,'/tmp/bp-pkg/pkg'); sys.path.insert(0,'/tmp/bp-pkg')
import numpy as np, tensorflow as tf, soundfile as sf
import bp_models_release as models

SR, N, FPS, FRAMES, MIDI_MIN = 22050, 43844, 22050/256.0, 172, 21
SEED = 20261026
rng = np.random.default_rng(SEED); tf.random.set_seed(SEED)
SM='/tmp/bp-pkg/pkg/basic_pitch/saved_models/icassp_2022/nmp'; CKPT=os.path.join(SM,'variables','variables')
MAP=[(0,'batch_normalization','bn'),(1,'conv2d','conv'),(2,'batch_normalization_1','bn'),(3,'contours-reduced','conv'),
     (4,'conv2d_1','conv'),(5,'conv2d_3','conv'),(6,'batch_normalization_2','bn'),(7,'conv2d_2','conv'),(8,'conv2d_4','conv')]
BN=['gamma','beta','moving_mean','moving_variance']
load=lambda n: tf.train.load_variable(CKPT, f'layer_with_weights-{n}/.ATTRIBUTES/VARIABLE_VALUE')

def build(load_ft=None):
    m = models.model()
    weighted=[l for l in m.layers if l.weights]
    for (i,name,kind),layer in zip(MAP, weighted):
        vals=[load(f'{i}/{v}') for v in (BN if kind=='bn' else ('kernel','bias'))]
        layer.set_weights(vals)
    for layer in m.layers:
        if isinstance(layer, tf.keras.layers.BatchNormalization): layer.trainable=False
    if load_ft: m.load_weights(load_ft)
    return m

def jams(base):
    p=f'/tmp/guitarset/jams/{base}.jams'
    if not os.path.exists(p): return []
    d=json.load(open(p)); out=[]
    for a in d['annotations']:
        if a.get('namespace')!='note_midi' or not a.get('data'): continue
        for o in a['data']:
            m=int(round(float(o['value']))); t=float(o['time']); dur=float(o.get('duration') or 0.1)
            if MIDI_MIN<=m<=108: out.append((t,t+max(dur,0.02),m))
    return out

def takes(comps, players=None):
    fs=glob.glob('/tmp/guitarset/*_mic.wav'); out=[]
    for f in sorted(fs):
        b=os.path.basename(f).replace('_mic.wav','')
        comp=b.split('_')[1].split('-')[0]; player=b.split('_')[0]
        if comp in comps and (players is None or player in players): out.append(b)
    return out

def load_audio(base):
    data, sr = sf.read(f'/tmp/guitarset/{base}_mic.wav', dtype='float32', always_2d=True)
    mono = data.mean(axis=1)
    if sr != SR:
        n=int(len(mono)*SR/sr); mono=np.interp(np.linspace(0,len(mono)-1,n), np.arange(len(mono)), mono).astype(np.float32)
    return np.asarray(mono, np.float32)

def labels(t0, notes):
    note=np.zeros((FRAMES,88),np.float32); onset=np.zeros((FRAMES,88),np.float32)
    for (on,off,midi) in notes:
        p=midi-MIDI_MIN
        if p<0 or p>87: continue
        k0=max(0,int(np.floor((on-t0)*FPS))); k1=min(FRAMES,int(np.ceil((off-t0)*FPS)))
        if k1<=k0: continue
        note[k0:k1,p]=1.0
        k=int(round((on-t0)*FPS))
        if 0<=k<FRAMES: onset[k,p]=1.0
    return note,onset

def dataset(bases, per_take=6):
    xs,ns,os_=[],[],[]
    for b in bases:
        mono=load_audio(b); notes=jams(b); dur=len(mono)/SR
        if not notes: continue
        starts=[0.2+i*(max(0.1,dur-2.4))/max(1,per_take-1) for i in range(per_take)]
        for t0 in starts:
            s=int(t0*SR); seg=mono[s:s+N]
            if len(seg)<N: seg=np.pad(seg,(0,N-len(seg)))
            n,o=labels(t0,notes)
            if n.sum()<8: continue
            xs.append(seg.reshape(N,1)); ns.append(n); os_.append(o)
    return np.asarray(xs,np.float32), np.asarray(ns,np.float32), np.asarray(os_,np.float32)

TR_COMPS=['BN1','BN2','Jazz1','Jazz2']; VA_COMPS=['Funk1','Funk3']; TEST_COMPS=['Rock1','SS1','Funk2']
tr_bases=takes(TR_COMPS); va_bases=takes(VA_COMPS)
print('train takes',len(tr_bases),'val takes',len(va_bases))
Xtr,Ntr,Otr=dataset(tr_bases); Xva,Nva,Ova=dataset(va_bases,per_take=4)
print('train windows',Xtr.shape,'val windows',Xva.shape)

model=build(); original=build()
heads=[model.get_layer('conv2d_2'), model.get_layer('conv2d_4')]
tv=[]
for l in heads: tv += list(l.trainable_variables)
print('trainable tensors:', [(v.name, v.shape.as_list()) for v in tv])

pitch_w=np.ones(88,np.float32); pitch_w[:48-MIDI_MIN]=2.0
note_pos=tf.constant(pitch_w[None,None,:]*6.0,tf.float32); onset_pos=tf.constant(pitch_w[None,None,:]*6.0,tf.float32)
def wbce(y,p,pos):
    eps=1e-7; y=tf.cast(y,tf.float32); p=tf.clip_by_value(tf.cast(p,tf.float32),eps,1-eps)
    w=pos*y+(1-y); L=-(w*(y*tf.math.log(p)+(1-y)*tf.math.log(1-p)))
    return tf.reduce_sum(L)/tf.maximum(tf.reduce_sum(w),1.0)
opt=tf.optimizers.Adam(learning_rate=1e-4)
train_model=tf.keras.Model(inputs=model.input, outputs=[model.get_layer('note').output, model.get_layer('onset').output])
orig_model=tf.keras.Model(inputs=original.input, outputs=[original.get_layer('note').output, original.get_layer('onset').output])

def predict(m,X):
    out=m.predict(X,batch_size=8,verbose=0)
    return {'note':out[0],'onset':out[1]}
def metrics(X,Nt,Ot):
    p=predict(train_model,X); res={}
    for k,y in (('note',Nt),('onset',Ot)):
        pr=p[k]; yb=y>0.5; pb=pr>0.5
        tp=float(np.logical_and(yb,pb).sum()); fp=float(np.logical_and(~yb,pb).sum()); fn=float(np.logical_and(yb,~pb).sum())
        prec=tp/(tp+fp) if tp+fp else 0; rec=tp/(tp+fn) if tp+fn else 0
        res[k]={'f1':round(2*prec*rec/(prec+rec),4) if prec+rec else 0,'p':round(prec,4),'r':round(rec,4)}
    yb=Nt[:,:,:27]>0.5; pb=p['note'][:,:,:27]>0.5
    tp=float(np.logical_and(yb,pb).sum()); fn=float(np.logical_and(yb,~pb).sum())
    res['bassRecall']=round(tp/(tp+fn),4) if tp+fn else 0
    return res

before=metrics(Xva,Nva,Ova); print('BASELINE val', json.dumps(before))
STEPS=150; BATCH=4; LAMBDA=1.0
best=1e9; best_w=None; history=[]
for step in range(STEPS):
    idx=rng.integers(0,len(Xtr),BATCH)
    vi=rng.integers(0,len(Xva),BATCH)
    with tf.GradientTape() as tape:
        out=train_model(Xtr[idx],training=True)
        loss=wbce(Ntr[idx],out[0],note_pos)+wbce(Otr[idx],out[1],onset_pos)
        if step%2==1:   # rehearsal: stay close to the released model on unseen compositions
            r=train_model(Xva[vi],training=True); o=orig_model(Xva[vi],training=False)
            loss += LAMBDA*0.5*(tf.reduce_mean(tf.square(r[0]-o[0]))+tf.reduce_mean(tf.square(r[1]-o[1])))
    grads=tape.gradient(loss,tv)
    opt.apply_gradients(zip(grads,tv))
    if step%30==29 or step==STEPS-1:
        p=predict(train_model,Xva)
        vl=float(wbce(Nva,p['note'],note_pos)+wbce(Ova,p['onset'],onset_pos))
        m=metrics(Xva,Nva,Ova)
        history.append({'step':step,'loss':float(loss),'valLoss':vl,**m})
        print('step %3d loss %.4f | val note F1 %.4f onset F1 %.4f bassRecall %.4f' % (step,float(loss),m['note']['f1'],m['onset']['f1'],m['bassRecall']))
        score = -(m['note']['f1'] + m['onset']['f1'])   # maximise F1, not loss
        if score<best: best=score; best_w={l.name:[w.numpy().copy() for w in l.weights] for l in heads}
if best_w:
    for l in heads: l.set_weights(best_w[l.name])
after=metrics(Xva,Nva,Ova); print('FINE-TUNED val', json.dumps(after))
model.save_weights('/tmp/bp-pkg/heads.weights.h5')
json.dump({'seed':SEED,'steps':STEPS,'batch':BATCH,'lambda':LAMBDA,'lr':1e-4,
           'trainComps':TR_COMPS,'valComps':VA_COMPS,'testComps':TEST_COMPS,
           'trainTakes':len(tr_bases),'valTakes':len(va_bases),'trainWindows':int(len(Xtr)),
           'trainable':[v.name for v in tv],'before':before,'after':after,'history':history},
          open('/tmp/bp-pkg/heads-report.json','w'),indent=1)
print('saved heads.weights.h5 + report')
