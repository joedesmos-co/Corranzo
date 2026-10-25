"""Dump note/onset probability matrices for the untouched 05_* takes, for the
released model and the fine-tuned model, with non-overlapping windows (the same
treatment for both). Extraction and scoring happen in Node with the production
extractor, so no logic is ported here."""
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
load=lambda n: tf.train.load_variable(CKPT, f'layer_with_weights-{n}/.ATTRIBUTES/VARIABLE_VALUE')

def build(with_ft):
    m = models.model()
    # Map by POSITION in the weighted-layer list (Keras renames duplicates when
    # a second model is built in the same process), asserting shapes each time.
    weighted = [l for l in m.layers if l.weights]
    assert len(weighted) == len(MAP), (len(weighted), len(MAP))
    for (i, name, kind), layer in zip(MAP, weighted):
        vals=[load(f'{i}/{v}') for v in (BN if kind=='bn' else ('kernel','bias'))]
        assert [tuple(w.shape.as_list()) for w in layer.weights] == [tuple(v.shape) for v in vals], (name, layer.name)
        layer.set_weights(vals)
    for layer in m.layers:
        if isinstance(layer, tf.keras.layers.BatchNormalization): layer.trainable=False
    if with_ft: m.load_weights('/tmp/bp-pkg/finetuned.weights.h5')
    return m

orig, ft = build(False), build(True)
def run(model, mono):
    frames, onsets = [], []
    for s in range(0, max(1, len(mono) - N + 1), N):
        seg = mono[s:s+N]
        if len(seg) < N: seg = np.pad(seg, (0, N-len(seg)))
        out = model(tf.constant(seg.reshape(1,N,1)), training=False)
        frames.append(np.asarray(out['note'])[0]); onsets.append(np.asarray(out['onset'])[0])
    if not frames:
        seg = np.pad(mono, (0, N-len(mono)))[:N]
        out = model(tf.constant(seg.reshape(1,N,1)), training=False)
        frames=[np.asarray(out['note'])[0]]; onsets=[np.asarray(out['onset'])[0]]
    return np.concatenate(frames,0).astype(np.float32), np.concatenate(onsets,0).astype(np.float32)

def truth(base):
    d=json.load(open(f'/tmp/guitarset/jams/{base}.jams')); out=[]
    for a in d['annotations']:
        if a.get('namespace')!='note_midi' or not a.get('data'): continue
        for o in a['data']:
            m=int(round(float(o['value']))); t=float(o['time']); dur=float(o.get('duration') or 0.1)
            out.append({'midi':m,'onset':round(t,4),'offset':round(t+max(dur,0.02),4)})
    return sorted(out, key=lambda x:(x['onset'],x['midi']))

bases = sorted({os.path.basename(f).replace('_mic.wav','') for f in glob.glob('/tmp/guitarset/05_*_mic.wav')})
# a priori choice: 5 comps + 5 solos, alphabetical (no performance-based selection)
comps=[b for b in bases if b.endswith('_comp')][:5]; solos=[b for b in bases if b.endswith('_solo')][:5]
chosen=comps+solos
os.makedirs('/tmp/bp-pkg/testout', exist_ok=True)
manifest=[]
for base in chosen:
    data, sr = sf.read(f'/tmp/guitarset/{base}_mic.wav', dtype='float32', always_2d=True)
    mono = data.mean(axis=1)
    if sr != SR:
        n=int(len(mono)*SR/sr); mono=np.interp(np.linspace(0,len(mono)-1,n), np.arange(len(mono)), mono).astype(np.float32)
    for tag, model in (('prod', orig), ('ft', ft)):
        f, o = run(model, mono)
        f.astype(np.float32).tofile(f'/tmp/bp-pkg/testout/{base}.{tag}.note.f32')
        o.astype(np.float32).tofile(f'/tmp/bp-pkg/testout/{base}.{tag}.onset.f32')
    manifest.append({'base': base, 'density': 'dense' if base.endswith('_comp') else 'sparse',
                     'frameCount': int(f.shape[0]), 'truth': truth(base)})
    print('%s: %d frames, %d reference notes' % (base, f.shape[0], len(manifest[-1]['truth'])))
json.dump(manifest, open('/tmp/bp-pkg/testout/manifest.json','w'))
print('dumped', len(manifest), 'takes x 2 models')
