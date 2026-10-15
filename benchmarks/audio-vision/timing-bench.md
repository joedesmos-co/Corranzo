# Timing benchmark (frozen; JAMS beat/downbeat references)

| recording | ref BPM | measured-from-beats | meter | est BPM | err | ratio | class | phase (beats) | downbeat hits | onsets missed | quant resid | mean dur (ref beats) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| guitarset-ss-comp | 84 | 84 (match true) | 4/4 | 86 | 2 | 1.0238 | 1 | -0.192 | 2/8 | 1/184 | 0.1725 | 0.551 |
| guitarset-funk3 | 112 | 112 (match true) | 4/4 | 74 | -38 | 0.6607 | 2/3 | 0.1099 | 1/8 | 6/492 | 0.2517 | 0.471 |
| guitarset-rock2 | 142 | 142 (match true) | 4/4 | 96 | -46 | 0.6761 | 2/3 | -0.0524 | 0/8 | 5/547 | 0.2301 | 0.527 |
| guitarset-bn2 | 131 | 131 (match true) | 4/4 | 129 | -2 | 0.9847 | 1 | -0.0918 | 0/8 | 1/239 | 0.4 | 0.533 |
| guitarset-jazz2 | 110 | 110 (match true) | 4/4 | 112 | 2 | 1.0182 | 1 | -0.1597 | 2/8 | 10/252 | 0.1563 | 0.686 |

Reference verification notes: `measured-from-beats` recomputes tempo from the median annotated beat gap, so a mismatch means the tempo annotation does not describe the annotated beats.

