import os, sys, json, glob
os.environ['TF_CPP_MIN_LOG_LEVEL']='2'; os.environ['TF_USE_LEGACY_KERAS']='1'
sys.path.insert(0,'/tmp/bp-pkg/pkg'); sys.path.insert(0,'/tmp/bp-pkg')
import numpy as np, tensorflow as tf, soundfile as sf
import bp_models_release as models
SR, N = 22050, 43844
SM='/tmp/bp-pkg/pkg/basic_pitch/saved_models/icassp_2022/nmp'; CKPT=os.path.join(SM,'variables','variables')
MAP=[(0,'batch_normalization','bn'),(1,'conv2d','conv'),(2,'batch_normalization_1','bn'),(3,'contours-reduced','conv'),
     (4,'conv2d_1','conv'),(5,'conv2d_3','conv'),(6,'batch_normalization_2','bn'),(7,'conv2d_2','conv'),(8,'conv2d_4','conv')]
BN=['gamma','beta','moving_mean','moving_variance']
loadv=lambda n: tf.train.load_variable(CKPT, f'layer_with_weights-{n}/.ATTRIBUTES/VARIABLE_VALUE')
def build(ft=None):
    m=models.model(); weighted=[l for l in m.layers if l.weights]
    for (i,name,kind),layer in zip(MAP,weighted):
        layer.set_weights([loadv(f'{i}/{v}') for v in (BN if kind=='bn' else ('kernel','bias'))])
    for l in m.layers:
        if isinstance(l,tf.keras.layers.BatchNormalization): l.trainable=False
    if ft: m.load_weights(ft)
    return m
orig, heads = build(), build('/tmp/bp-pkg/heads.weights.h5')
def run(model, mono):
    fr,on=[],[]
    for s in range(0, max(1,len(mono)-N+1), N):
        seg=mono[s:s+N]
        if len(seg)<N: seg=np.pad(seg,(0,N-len(seg)))
        o=model(tf.constant(seg.reshape(1,N,1)),training=False)
        fr.append(np.asarray(o['note'])[0]); on.append(np.asarray(o['onset'])[0])
    return np.concatenate(fr,0).astype(np.float32), np.concatenate(on,0).astype(np.float32)
def truth(base):
    d=json.load(open(f'/tmp/guitarset/jams/{base}.jams')); out=[]
    for a in d['annotations']:
        if a.get('namespace')!='note_midi' or not a.get('data'): continue
        for o in a['data']:
            m=int(round(float(o['value']))); t=float(o['time']); dur=float(o.get('duration') or 0.1)
            out.append({'midi':m,'onset':round(t,4),'offset':round(t+max(dur,0.02),4)})
    return sorted(out,key=lambda x:(x['onset'],x['midi']))
# FRESH: compositions never used in any prior evaluation, two players, both variants, first key
FRESH={'Rock1','SS1','Funk2'}
bases=[]
for f in sorted(glob.glob('/tmp/guitarset/*_mic.wav')):
    b=os.path.basename(f).replace('_mic.wav','')
    player, rest = b.split('_',1); comp = rest.split('-')[0]
    if comp in FRESH and player in ('02','05') and b.split('-')[1].startswith('1'):
        bases.append(b)
print('fresh takes:', len(bases), bases)
os.makedirs('/tmp/bp-pkg/freshout', exist_ok=True)
man=[]
for b in bases:
    data, sr = sf.read(f'/tmp/guitarset/{b}_mic.wav', dtype='float32', always_2d=True)
    mono=data.mean(axis=1)
    if sr!=SR:
        n=int(len(mono)*SR/sr); mono=np.interp(np.linspace(0,len(mono)-1,n),np.arange(len(mono)),mono).astype(np.float32)
    for tag,model in (('prod',orig),('ft',heads)):
        f,o=run(model,mono)
        f.astype(np.float32).tofile(f'/tmp/bp-pkg/freshout/{b}.{tag}.note.f32')
        o.astype(np.float32).tofile(f'/tmp/bp-pkg/freshout/{b}.{tag}.onset.f32')
    man.append({'base':b,'density':'dense' if b.endswith('_comp') else 'sparse','truth':truth(b)})
json.dump(man, open('/tmp/bp-pkg/freshout/manifest.json','w'))
print('dumped', len(man))
