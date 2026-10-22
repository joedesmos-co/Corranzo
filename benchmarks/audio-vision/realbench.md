# Audio Vision real-audio benchmark (natural recordings, truth-labeled)

clips=46 · onset tolerance ±100ms · Basic Pitch = real weights (CPU backend), spectral = model-free baseline

overall Basic Pitch: P=0.551 R=0.701 F1=0.599
overall spectral: P=0.269 R=0.309 F1=0.242

| instrument | n | BP P/R/F1 | SPEC P/R/F1 |
|---|---|---|---|
| piano | 7 | 0.082/0.119/0.096 | 0.101/0.058/0.073 |
| acoustic-guitar | 21 | 0.675/0.802/0.719 | 0.407/0.378/0.357 |
| electric-guitar | 18 | 0.59/0.811/0.654 | 0.174/0.327/0.175 |

| split | n | BP P/R/F1 | SPEC P/R/F1 |
|---|---|---|---|
| dev | 15 | 0.623/0.759/0.664 | 0.304/0.285/0.268 |
| eval | 22 | 0.441/0.608/0.491 | 0.172/0.32/0.181 |
| eval-fresh | 9 | 0.7/0.833/0.753 | 0.45/0.322/0.35 |
