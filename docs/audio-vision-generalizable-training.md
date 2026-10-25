# Audio Vision — generalizable Basic Pitch training: the second fine-tune, and what really blocks it

Research only. Production still ships the released 0.92 MB model at
`0.65 / 0.50 / 3`. Nothing here is integrated.

## 1. Dataset registry and the leakage that broke the first pilot

GuitarSet is **6 players × 15 compositions × 2 keys/tempos × 2 variants
(comp/solo) = 360 takes, 3.05 h**, all **CC BY 4.0** with note-level JAMS
truth. Crucially, **every player recorded every composition**: a split by take
number or by player still puts the same *music* on both sides.

| composition | used before this round? |
|---|---|
| BN1, BN2, BN3, Funk1, Funk3, Jazz1, Jazz2, SS3 | yes — development/holdout/test in earlier sessions |
| **Rock1, Rock2, Rock3, SS1, SS2, Funk2, Jazz3** | **never** |

The first pilot trained on takes `02_*` and validated on `00_*`/`04_*` — the
same compositions, different players. Its validation gain (+0.034 note F1) did
not transfer, which is exactly what composition leakage predicts. This round
splits by **composition**:

* train: BN1, BN2, Jazz1, Jazz2 (96 takes)
* validation: Funk1, Funk3 (48 takes) — different music, already inspected, so
  it is selection-only
* fresh test: **Rock1, SS1, Funk2 × players 02 and 05, both variants, first
  key (16 takes)** — compositions never used in any evaluation here

Spotify's own training mixture is not documented, so overlap between the
released weights and GuitarSet cannot be excluded. That uncertainty is
inherited by every fine-tune and is stated rather than hidden.

## 2. Diagnosis of the first failure — the objective, not just the data

Two concrete mechanisms were found and measured:

1. **An unnormalised weighted BCE** collapsed the onset head while the loss
   fell 30x (recall 0.72 → 0.06). Discarded.
2. **A note positive-weight of 1.0** lets the sparse negatives dominate: every
   gradient step teaches the model to predict fewer notes. Measured on
   validation: note precision 0.897 → 0.968 with recall 0.668 → 0.449. The
   model becomes conservative, not better.

The released model is already calibrated across a far larger and more varied
corpus than the 3 hours here. Fine-tuning on one instrument narrows its
decision boundary. That is the failure mode both pilots share.

## 3. The controlled experiment actually run

**Heads-only fine-tune with rehearsal consistency** — the most conservative
adaptation available: the feature front end (CQT BN, contour branch, both
feature convs) and all BatchNorm layers frozen; only the two output heads
train (`conv2d_2` note 7×3 = 224 weights, `conv2d_4` onset 3×3×33 = 298
weights). Objective: normalised weighted BCE (bass ×2, note/onset positive
weight 6), plus, on alternating steps, an MSE consistency term against the
frozen original model evaluated on **validation-composition** windows (a
rights-clean teacher — the released weights themselves). Adam 1e-4, batch 4,
150 steps, seed 20261026, early stopping on **validation frame F1**, not loss.

Validation (Funk1/Funk3, composition-disjoint):

| | note F1 | onset F1 | bass recall |
|---|---|---|---|
| released weights | 0.766 | 0.227 | 0.594 |
| best heads checkpoint | 0.744 | **0.366** | 0.540 |

The onset head improves, the note head regresses; the combined early-stopping
score hides a trade-off rather than a win.

## 4. Fresh evaluation — the decisive result

16 takes from **compositions never used in any evaluation**, production
extractor and matcher unchanged, one evaluation only:

| model | micro F1 | precision | recall | dense | sparse | bass | mid | high | missed | false | octave |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **released weights** | **0.772** | 0.807 | **0.739** | **0.726** | 0.892 | **0.597** | **0.758** | **0.845** | **642** | 436 | 117 |
| heads-only fine-tune | 0.705 | **0.901** | 0.579 | 0.616 | **0.918** | 0.325 | 0.618 | 0.639 | 1036 | **156** | **38** |

The fine-tune converts the model from generous to conservative: +0.094
precision, 280 fewer false notes, 79 fewer octave errors — at the cost of
−0.160 recall (394 more missed notes), −0.11 dense F1 and a **halved bass
recall**. On unfamiliar music it is clearly worse.

## 5. What this establishes

* The reconstructed architecture is trainable and behaves exactly like the
  released model (verified in the previous round: 5.4e-7 vs SavedModel,
  3.0e-5 vs the TF.js graph).
* **Two independent, properly split fine-tunes both lose to the released
  weights on music no decision touched.** The limit is not architecture,
  licensing or tooling — it is **data scale and diversity**: 3 hours of one
  instrument cannot re-calibrate a model trained on a multi-corpus mixture.
* The failure is systematic and diagnosable (precision/recall trade), not
  random noise: both runs landed in the same place.

## 6. The concrete data pipeline this justifies

Do not run another underpowered fine-tune. The next attempt needs, in order:

1. **10–50 h of rights-clean, multi-instrument audio with note truth.** Routes:
   * **synthesized renders from MIDI** using an in-house additive synthesiser
     (no third-party sample library, so no sample rights; we already have a
     harmonic-stack renderer in `scripts/lib/synthReference.mjs`) — unlimited
     data, exact labels, clean licence;
   * **Slakh2100** only after verifying the exact per-file licence (CC BY 4.0
     claimed, not verified here);
   * GuitarSet remains the only real-instrument, real-annotation source.
2. **Composition- and performer-disjoint splits** (this round's split is the
   template; the fresh compositions Rock1/SS1/Funk2 are now spent).
3. **Objective that matches the metric**: the extractor works on onsets and
   frames, but the score is complete-event F1. Train with a positive-weighted
   note loss (≥6) *and* select on event-level F1 computed through the real
   extractor, not frame BCE — the two pilots both looked fine on val loss and
   failed on event F1.
4. **Only then** consider unfreezing the feature front end.

## 7. Reproduce

`benchmarks/audio-vision/bp-train-heads.py` (training), `bp-dump-fresh.py`
(matrix dump for the fresh split), `bp-heads-pilot.json` (validation history),
`bp-heads-fresh-compositions.json` (the fresh result). Environment: Python
3.12 venv, `tensorflow==2.21.0` + `tf-keras` (`TF_USE_LEGACY_KERAS=1`).

## 8. Export status

Not attempted this round: no candidate beat the released weights, so exporting
one would have been wasted work. The path is unchanged and documented
(`bp_models_release.py` → SavedModel → TF.js converter in its own venv, then
the probability-equivalence battery from the previous round).
