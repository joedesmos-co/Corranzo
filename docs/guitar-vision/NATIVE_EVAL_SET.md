# Native-font evaluation set (FROZEN)

Score-disjoint from every TRAIN-tuned score (Txо `pdmx-QmTxoAbitsi9`
and Qmek `pdmx2-QmekQbhC1yAP` are both `train` split). Sealed TEST is
not part of this set and is never opened.

| sample | split | tab digits | rests | noteheads | raster width |
|---|---|---|---|---|---|
| pdmx-QmTJRwrHUET3 | heldout | 613 | 50 | 613 | 1700 (p1) / 1400 (p2,p3) |
| pdmx-QmZ5K3BV9FDR | heldout | 168 | 6 | 277 | 1900 |
| pdmx2-QmVDaX5YmZCx | heldout | 142 | 10 | 142 | 1700 |
| guitar-ode-to-joy | heldout | 28 | 0 | 28 | 1700 |

Rasterisation uses each score's own embedded document font (NO training-font
override). Geometry is inferred from pixels only: staff lines by
contiguous horizontal run, canonical units-per-pixel =
measured_staff_gap / 315, then scale-normalised to the detector's trained
26px gap. No SVG metadata, viewBox, page dimensions, fixture manifests or
GT coordinates are consumed at inference.

Runner:
```
tools/guitar-vision/proof-raster-baseline.py --work <workdir> --pages 1,2 --width W --out /tmp/proof/rz/<sample>
tools/guitar-vision/proof-raster-baseline.py --score --work <workdir> --report .../raster-report.json --out .../score.json
```

Per-page results are committed under
`datasets/guitar-vision/proof-detection/native-eval/`. Thresholds and
model selection must NOT be tuned on this set; it is scored at most once
per committed model.
