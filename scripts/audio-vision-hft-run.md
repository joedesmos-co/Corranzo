# Reproducing the hFT-Transformer side of the comparison (research only)

The candidate is **not** part of the product and is **not** licensed for it:
the code is MIT, but the weights were trained on MAESTRO (CC BY-NC-SA 3.0), so
commercial use is unresolved. This is a measurement rig, kept so the numbers in
`docs/audio-vision-transcription-alternatives.md` can be re-derived.

## What was done

```bash
# 1. the repository (MIT) and its released checkpoint (20.5 MB)
git clone --depth 1 https://github.com/sony/hFT-Transformer.git /tmp/hFT
cd /tmp/hFT
curl -sL -o checkpoint.zip \
  https://github.com/sony/hFT-Transformer/releases/download/ismir2023/checkpoint.zip
unzip -o -q checkpoint.zip -d checkpoint/

# 2. three local patches, because the released code assumes CUDA + torchaudio.load
#    (see model/amt.py in this rig):
#    - WAV reading through soundfile (torchaudio 2.11 needs TorchCodec otherwise)
#    - torch.load map_location='cpu' for the CUDA-saved checkpoint
#    - every submodule's hard-coded device moved to CPU
#    - corpus/config_bench.json adds input.min_value = feature.log_offset

# 3. the 12 comparison recordings (5 unseen GuitarSet takes + 7 usable Vienna
#    piano clips) copied into corpus/wav, listed in corpus/list/test.list
python3 corpus/conv_wav2fe.py -d_list corpus/list -d_wav corpus/wav \
  -d_feature corpus/feature -config corpus/config_bench.json
python3 evaluation/m_inference.py -f_config corpus/config_bench.json \
  -f_list corpus/list/test.list -d_cp checkpoint/checkpoint/MAESTRO-V3 \
  -m model_016_003.pkl -d_wav corpus/wav -d_fe corpus/feature \
  -d_mpe corpus/mpe -d_note corpus/note -calc_feature -calc_transcript \
  -thred_onset 0.5 -thred_offset 0.5 -thred_mpe 0.5
```

Inference: 12 recordings, ~150 s of audio, 36 s wall on CPU (M-series), model
load included — about 0.24x realtime in PyTorch.

## Scoring

```bash
node --expose-gc scripts/audio-vision-model-comparison.mjs \
  --hft-notes /tmp/hFT/corpus/note
```

The Node script runs production Basic Pitch on the same files with the same
matcher and the same truth (GuitarSet JAMS; Vienna clips with the `align-probe`
δ applied and the corpus's four excluded clips skipped), and writes
`benchmarks/audio-vision/model-comparison.json`.

## Numbers that matter

| corpus | Basic Pitch micro F1 | hFT micro F1 |
|---|---|---|
| 5 unseen GuitarSet takes | **0.838** | 0.653 |
| 7 Vienna piano clips | 0.417 | 0.430 |

A cascade (`BP ∪ hFT`) would recover 35 of BP's 157 guitar misses while adding
247 false notes — 14 % precision on the additions.
