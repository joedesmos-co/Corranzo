import os, json, sys, hashlib
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'
os.environ['TF_USE_LEGACY_KERAS'] = '1'
sys.path.insert(0, '/tmp/bp-pkg/pkg')
sys.path.insert(0, '/tmp/bp-pkg')
import numpy as np
import tensorflow as tf
import bp_models_release as models

SM = '/tmp/bp-pkg/pkg/basic_pitch/saved_models/icassp_2022/nmp'
CKPT = os.path.join(SM, 'variables', 'variables')
N = 43844

# ---- explicit, auditable mapping: checkpoint layer -> Keras layer --------
# Verified by shape AND by role in the architecture (see docs). The two dead
# layers in the public models.py are absent from the released checkpoint.
MAP = [
    (0, 'batch_normalization',   'bn'),
    (1, 'conv2d',                'conv'),   # contour  (3,39) on the CQT stack
    (2, 'batch_normalization_1', 'bn'),
    (3, 'contours-reduced',      'conv'),   # contour reduction (5,5) -> 1
    (4, 'conv2d_1',              'conv'),   # notes pre (7,7) -> 32
    (5, 'conv2d_3',              'conv'),   # onsets (5,5) -> 32
    (6, 'batch_normalization_2', 'bn'),
    (7, 'conv2d_2',              'conv'),   # note output (7,3) -> 1
    (8, 'conv2d_4',              'conv'),   # onset output (3,3) on 33 ch -> 1
]
BN_ORDER = ['gamma', 'beta', 'moving_mean', 'moving_variance']

def load(name):
    return tf.train.load_variable(CKPT, f'layer_with_weights-{name}/.ATTRIBUTES/VARIABLE_VALUE')

model = models.model()
layers = {l.name: l for l in model.layers if l.weights}
audit = []
for index, layer_name, kind in MAP:
    layer = layers[layer_name]
    if kind == 'bn':
        values = [load(f'{index}/{v}') for v in BN_ORDER]
    else:
        values = [load(f'{index}/{v}') for v in ('kernel', 'bias')]
    expected = [tuple(w.shape.as_list()) for w in layer.weights]
    got = [tuple(v.shape) for v in values]
    assert expected == got, f'shape mismatch at layer {index} {layer_name}: {expected} vs {got}'
    layer.set_weights(values)
    audit.append({
        'checkpointLayer': index,
        'kerasLayer': layer_name,
        'kind': kind,
        'tensors': [
            {'name': f'layer_with_weights-{index}/{n}', 'shape': list(s),
             'sha1': hashlib.sha1(np.ascontiguousarray(v).tobytes()).hexdigest()[:12]}
            for n, v, s in zip(BN_ORDER if kind == 'bn' else ('kernel', 'bias'), values, got)
        ],
    })
print('mapped %d layers, %d tensors' % (len(audit), sum(len(a['tensors']) for a in audit)))
matched = [a for a in audit if a['kerasLayer'] in layers]
print('every mapped layer exists in the model:', len(matched) == len(MAP))
print('unmapped weighted Keras layers:', [n for n in layers if n not in {a["kerasLayer"] for a in audit}] or 'none')
json.dump(audit, open('/tmp/bp-pkg/mapping.json', 'w'), indent=1)

# ---- reference model ----------------------------------------------------
serve = tf.saved_model.load(SM).signatures['serving_default']

SR = 22050
def tone(midi, seconds=2.0, amp=0.2, harmonics=5):
    f = 440 * 2 ** ((midi - 69) / 12)
    # exactly one model window (43844 samples), which is what the SavedModel takes
    t = np.arange(min(int(seconds * SR), N)) / SR
    if len(t) < N:
        t = np.arange(N) / SR
    out = np.zeros_like(t)
    for h in range(1, harmonics + 1):
        out += np.sin(2 * np.pi * f * h * t) / h
    return (out * amp).astype(np.float32)

def clip(path, start=0.0):
    import soundfile as sf
    data, sr = sf.read(path, dtype='float32', always_2d=True)
    mono = data.mean(axis=1)
    if sr != SR:
        n = int(len(mono) * SR / sr)
        mono = np.interp(np.linspace(0, len(mono) - 1, n), np.arange(len(mono)), mono).astype(np.float32)
    s = int(start * SR)
    seg = mono[s:s + N]
    if len(seg) < N:
        seg = np.pad(seg, (0, N - len(seg)))
    return seg.astype(np.float32)

signals = {
    'silence': np.zeros(N, dtype=np.float32),
    'tone-A4-loud': tone(69, 2.0, 0.3),
    'tone-E2-bass': tone(40, 2.0, 0.25),
    'tone-E6-high': tone(88, 2.0, 0.25),
    'tone-A4-quiet': tone(69, 2.0, 0.005),
    'chord-Cmaj': (tone(60, 2.0, 0.15) + tone(64, 2.0, 0.12) + tone(67, 2.0, 0.12)).astype(np.float32),
}
for name, path in (('real-guitar', '/tmp/guitarset/02_BN1-129-Eb_solo_mic.wav'),
                   ('real-piano', '/Users/ryland/Documents/scoreflow-audio-vision/benchmarks/mic-real/clips/piano-schubert2-triad.wav'),
                   ('real-guitar-dense', '/tmp/guitarset/02_BN1-129-Eb_comp_mic.wav')):
    if os.path.exists(path):
        signals[name] = clip(path, 1.0)

rows = []
for name, audio in signals.items():
    x = tf.constant(audio.reshape(1, N, 1).astype(np.float32))
    ref = {k: v.numpy().astype(np.float64) for k, v in serve(x).items()}
    out = model(x, training=False)
    row = {'signal': name}
    worst = 0.0
    for k in ('note', 'onset', 'contour'):
        a, b = ref[k], np.asarray(out[k], dtype=np.float64)
        diff = np.abs(a - b)
        row[k] = {'maxAbs': float(diff.max()), 'meanAbs': float(diff.mean()),
                  'over1e4': float((diff > 1e-4).mean()), 'refMin': float(a.min()), 'refMax': float(a.max())}
        worst = max(worst, float(diff.max()))
    row['worst'] = worst
    rows.append(row)
    print('%-18s note %.3e  onset %.3e  contour %.3e  (note range %.4f..%.4f)'
          % (name, row['note']['maxAbs'], row['onset']['maxAbs'], row['contour']['maxAbs'],
             row['note']['refMin'], row['note']['refMax']))

json.dump(rows, open('/tmp/bp-pkg/equivalence.json', 'w'), indent=1)
worst = max(r['worst'] for r in rows)
print('\nWORST OVER ALL SIGNALS: %.3e' % worst)
print('RESULT:', 'EQUIVALENT (<1e-4)' if worst < 1e-4 else 'NOT EQUIVALENT')
