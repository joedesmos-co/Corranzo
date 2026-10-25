"""
Bounded fine-tune of the reconstructed Basic Pitch model.

Data: GuitarSet (CC BY 4.0). Train = takes 02_*, validation = takes 00_*/04_*
(earlier development material), TEST = takes 05_* (never inspected by any
model decision, sealed before this run).

Objective: note + onset BCE with a bass register weight, contour head frozen
(sample weight 0). Batchnorm frozen so the released statistics survive.
"""
import os, sys, json, glob, random
os.environ['TF_CPP_MIN_LOG_LEVEL']='2'; os.environ['TF_USE_LEGACY_KERAS']='1'
sys.path.insert(0,'/tmp/bp-pkg/pkg'); sys.path.insert(0,'/tmp/bp-pkg')
import numpy as np, tensorflow as tf, soundfile as sf
import bp_models_release as models

SR, N, FPS = 22050, 43844, 22050/256.0   # 86.13 frames/s
FRAMES = 172
MIDI_MIN = 21
SEED = 20261025
random.seed(SEED); np.random.seed(SEED); tf.random.set_seed(SEED)

def jams_notes(base):
    p = f'/tmp/guitarset/jams/{base}.jams'
    d = json.load(open(p)); out=[]
    for a in d['annotations']:
        if a.get('namespace')!='note_midi' or not a.get('data'): continue
        for o in a['data']:
            m = int(round(float(o['value']))); t = float(o['time']); dur = float(o.get('duration') or 0.1)
            if MIDI_MIN <= m <= 108: out.append((t, t+max(dur,0.02), m))
    return sorted(out)

def load_take(base):
    data, sr = sf.read(f'/tmp/guitarset/{base}_mic.wav', dtype='float32', always_2d=True)
    mono = data.mean(axis=1)
    if sr != SR:
        n = int(len(mono)*SR/sr); mono = np.interp(np.linspace(0,len(mono)-1,n), np.arange(len(mono)), mono).astype(np.float32)
    return np.asarray(mono, dtype=np.float32)

def labels_for(t0, notes):
    note = np.zeros((FRAMES, 88), np.float32)
    onset = np.zeros((FRAMES, 88), np.float32)
    for (on, off, midi) in notes:
        p = midi - MIDI_MIN
        if p < 0 or p > 87: continue
        k0 = int(np.floor((on - t0) * FPS)); k1 = int(np.ceil((off - t0) * FPS))
        k0 = max(0, k0); k1 = min(FRAMES, k1)
        if k1 <= k0: continue
        note[k0:k1, p] = 1.0
        if 0 <= int(round((on - t0) * FPS)) < FRAMES:
            onset[int(round((on - t0) * FPS)), p] = 1.0
    return note, onset

def build(bases, per_take=6):
    xs, ns, os_ = [], [], []
    for base in bases:
        mono = load_take(base); notes = jams_notes(base)
        dur = len(mono)/SR
        starts = [0.2 + i*(max(0.1, dur-2.4))/max(1,per_take-1) for i in range(per_take)]
        for t0 in starts:
            s = int(t0*SR); seg = mono[s:s+N]
            if len(seg) < N: seg = np.pad(seg, (0, N-len(seg)))
            note, onset = labels_for(t0, notes)
            if note.sum() < 8: continue          # skip windows with no music
            xs.append(seg.reshape(N,1)); ns.append(note); os_.append(onset)
    return (np.asarray(xs, np.float32), np.asarray(ns, np.float32), np.asarray(os_, np.float32))

def take_list(prefixes):
    out=[]
    for p in prefixes:
        out += sorted({os.path.basename(f).replace('_mic.wav','') for f in glob.glob(f'/tmp/guitarset/{p}*_mic.wav')})
    return out

train_bases = take_list(['02_'])
val_bases = take_list(['00_','04_'])
print('train takes', len(train_bases), '| val takes', len(val_bases))
Xtr, Ntr, Otr = build(train_bases)
Xva, Nva, Ova = build(val_bases, per_take=4)
print('train windows', Xtr.shape, '| val windows', Xva.shape)
print('train bass note fraction: %.3f' % (Ntr[:,:, :27].mean()), 'mid %.3f' % (Ntr[:,:,27:51].mean()), 'high %.3f' % (Ntr[:,:,51:].mean()))

# ---- model + weights -----------------------------------------------------
SM='/tmp/bp-pkg/pkg/basic_pitch/saved_models/icassp_2022/nmp'; CKPT=os.path.join(SM,'variables','variables')
MAP=[(0,'batch_normalization','bn'),(1,'conv2d','conv'),(2,'batch_normalization_1','bn'),(3,'contours-reduced','conv'),
     (4,'conv2d_1','conv'),(5,'conv2d_3','conv'),(6,'batch_normalization_2','bn'),(7,'conv2d_2','conv'),(8,'conv2d_4','conv')]
BN=['gamma','beta','moving_mean','moving_variance']
load=lambda n: tf.train.load_variable(CKPT, f'layer_with_weights-{n}/.ATTRIBUTES/VARIABLE_VALUE')

def build_model(weights=True):
    m = models.model(); L={l.name:l for l in m.layers if l.weights}
    if weights:
        for i,n,k in MAP: L[n].set_weights([load(f'{i}/{v}') for v in (BN if k=='bn' else ('kernel','bias'))])
    for layer in m.layers:
        if isinstance(layer, tf.keras.layers.BatchNormalization):
            layer.trainable = False           # keep the released statistics
    return m

def bass_weight(midi_axis_len, cutoff=48):
    w = np.ones(midi_axis_len, np.float32); w[:cutoff-MIDI_MIN] = 2.0; return w

model = build_model(True)
# Normalised weighted BCE (the form Basic Pitch's own weighted loss uses):
# the loss is divided by the total weight mass, not by the number of bins, so
# the sparse positive class is not drowned by the negatives. Pitch weights
# emphasise the low register, which is where recall is worst.
NOTE_POS_WEIGHT, ONSET_POS_WEIGHT, BASS_MULT = 1.0, 8.0, 2.0
pitch_weight = bass_weight(88)
def _weighted_bce(y_true, y_pred, pos_weight):
    eps = 1e-7
    y = tf.cast(y_true, tf.float32); p = tf.clip_by_value(tf.cast(y_pred, tf.float32), eps, 1.0 - eps)
    w = pos_weight[None, None, :] * y + (1.0 - y)
    loss = -(w * (y * tf.math.log(p) + (1.0 - y) * tf.math.log(1.0 - p)))
    return tf.reduce_sum(loss) / tf.maximum(tf.reduce_sum(w), 1.0)
note_pos = tf.constant(pitch_weight[None, None, :] * NOTE_POS_WEIGHT, tf.float32)
onset_pos = tf.constant(pitch_weight[None, None, :] * ONSET_POS_WEIGHT, tf.float32)
def loss_note(y_true, y_pred): return _weighted_bce(y_true, y_pred, note_pos)
def loss_onset(y_true, y_pred): return _weighted_bce(y_true, y_pred, onset_pos)
opt = tf.keras.optimizers.Adam(learning_rate=1e-4)
# Train only the note and onset heads: the contour head is for pitch bends and
# is not used by the note extractor, so it keeps its released weights. A
# separate model over the SAME layers gives those two outputs and nothing else.
train_model = tf.keras.Model(
    inputs=model.input,
    outputs=[model.get_layer('note').output, model.get_layer('onset').output],
)
train_model.compile(optimizer=opt, loss=[loss_note, loss_onset])

def val_metrics(m):
    pred = m.predict(Xva, batch_size=8, verbose=0)
    if not isinstance(pred, dict):
        pred = {'note': pred[1], 'onset': pred[2]}
    out = {}
    for k, y in (('note', Nva), ('onset', Ova)):
        p = pred[k]
        bce = float(tf.reduce_mean(tf.keras.backend.binary_crossentropy(y, p)).numpy())
        yb, pb = y.reshape(-1) > 0.5, p.reshape(-1) > 0.5
        tp = float(np.logical_and(yb,pb).sum()); fp = float(np.logical_and(~yb,pb).sum()); fn = float(np.logical_and(yb,~pb).sum())
        prec = tp/(tp+fp) if tp+fp else 0.0; rec = tp/(tp+fn) if tp+fn else 0.0
        out[k] = {'bce': bce, 'precision': round(prec,4), 'recall': round(rec,4),
                  'f1': round(2*prec*rec/(prec+rec),4) if prec+rec else 0.0}
    # bass-only note recall
    yb = Nva[:,:, :27] > 0.5; pb = pred['note'][:,:,:27] > 0.5
    tp = float(np.logical_and(yb,pb).sum()); fn = float(np.logical_and(yb,~pb).sum())
    out['noteBassRecall'] = round(tp/(tp+fn),4) if tp+fn else 0.0
    return out

before = val_metrics(model)
print('BASELINE val:', json.dumps(before))

# ---- fine-tune -----------------------------------------------------------
class Logger(tf.keras.callbacks.Callback):
    def __init__(self): super().__init__(); self.best = 1e9; self.best_weights = None; self.history=[]
    def on_epoch_end(self, epoch, logs=None):
        m = val_metrics(model)  # the full 3-head model, not the 2-head training view
        score = m['note']['bce'] + m['onset']['bce']
        self.history.append({'epoch': epoch, 'loss': float(logs.get('loss', 0)), 'val': m, 'score': score})
        print('epoch %d loss %.4f | val note bce %.4f f1 %.4f | onset bce %.4f f1 %.4f | bassRecall %.4f'
              % (epoch, logs.get('loss',0), m['note']['bce'], m['note']['f1'], m['onset']['bce'], m['onset']['f1'], m['noteBassRecall']))
        if score < self.best:
            self.best = score
            # Save by layer name so the restore matches the full model exactly.
            self.best_weights = {layer.name: [w.numpy().copy() for w in layer.weights]
                                 for layer in model.layers if layer.weights}
            print('   new best (score %.4f)' % score)

logger = Logger()
train_model.fit(Xtr, [Ntr, Otr], batch_size=4, epochs=12, verbose=0, callbacks=[logger], shuffle=True)

if logger.best_weights is not None:
    for layer in model.layers:
        if layer.name in logger.best_weights:
            layer.set_weights(logger.best_weights[layer.name])
after = val_metrics(model)
print('FINE-TUNED val:', json.dumps(after))
model.save_weights('/tmp/bp-pkg/finetuned.weights.h5')
json.dump({'seed': SEED, 'trainTakes': len(train_bases), 'valTakes': len(val_bases),
           'trainWindows': int(Xtr.shape[0]), 'valWindows': int(Xva.shape[0]),
           'before': before, 'after': after, 'history': logger.history},
          open('/tmp/bp-pkg/finetune-report.json','w'), indent=1)
print('saved weights + report')
