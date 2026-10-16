# Quantization-residual attribution (vs drift-free MIDI truth)

| track | truth BPM | est BPM | matched | residual med | p90 | max | fine | swing | rubato | beatError | onsetError |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| guitarset-ss-comp | 84 | 86 | 158/184 | 0.475 | 0.858 | 0.996 | 18 | 44 | 96 | 0 | 26 |
| guitarset-funk3 | 112 | 74 | 434/492 | 0.525 | 0.907 | 0.998 | 37 | 123 | 274 | 0 | 58 |
| holdout-jazz3 | 137 | 68 | 177/184 | 0.563 | 0.822 | 0.978 | 8 | 83 | 86 | 0 | 7 |
