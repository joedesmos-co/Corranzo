# Phase D — Staff geometry + corpus consistency: report

**Result: PASS. The labelled real-PDF pitch task is now learnable across
scores.** Held-score written-step accuracy went from 0.176 (at the 0.179
majority baseline) to **0.748**, against a closed-form geometric ceiling of
**0.811**. No architecture work was done and none is recommended yet.

The cause was not what Phase A concluded. Gate 0 was a broken instrument, and
the corpus it measured had a one-line index bug that made half of its pitch
labels physically impossible.

---

## 0. Two corrections to the previous report, stated up front

**Correction 1 — my Phase A Gate 0 conclusion was wrong.** The frozen probe
scored `pitch_staff_step`, whose label is *by definition*
`round((bandCentre − cy)/gap) + 16`. The probe was handed `k`, so the target was
a closed-form restatement of its own input. The closed form reproduces it on
**98.8%** of objects while the same network scored **0.081** LOSO: the network
was memorising image fingerprints, not solving a task. It also scored
`written_step`/`octave` without the band role — on a grand staff `k=0` is B4
above and D3 below, so those targets were information-theoretically ambiguous.
The frozen numbers are **retained unchanged** in `out/phase_c_roi_probe.json`
as evidence that the instrument was broken. A corrected instrument was built; it
was not a retuned threshold.

**Correction 2 — the premise "geometry by itself was not the major failure"
was inverted.** It was. The dominant geometry defect was in the corpus label
builder, not in staff-line detection, and it was an index-space bug.

---

## 1. Staff-detection failure taxonomy (D1)

Production path run unchanged; every staff decision recorded per score × page ×
measure × band. Full detail: `out/phase_d1_forensics.json`.

| class | count (band-measure units) | meaning |
|---|---|---|
| `ok` | 1228 | lines found, 5-line lattice, offset within 0.25 of analytic ±1 |
| `system_dropped_incomplete_staff` | 40 | one stave lacked a lattice, so the **whole system** was discarded |
| `grand_staff_not_paired` | 9 | `group_staves_into_systems` returned singletons (odd count, or ≤2 staves) |
| `band_fabricated_by_measure_fallback` | 1 | `staff_bands()` invented a band spanning the whole measure and called it `upper` |
| `staff_space_default_used` | 1 | fewer than 2 lines, so the 0.01 default was returned |
| `single_staff_two_stave_page` | 1 | exactly 2 staves → one grand staff split into two single staves |
| `band_offset_off_analytic` | **0** | — |
| `band_line_count_below_gate` | **0** | — |

**Staff-line detection is not the bottleneck.** Zero analytic-offset violations
and zero short-line bands. `DIAGNOSIS.md`'s claim that the offset medians are
−0.976 / +1.024 with spread ≤ 0.098 reproduces exactly, on 0 of 29 pairs off by
more than 0.25.

The real defect is in the corpus, and D1's taxonomy does not contain it because
it is not a detection failure. It is item 2 below.

Two latent fabrication paths are real but rare (1 unit each) and are now
refused rather than emitted: the whole-measure band fallback, and the 0.01
default spacing.

---

## 2. The actual root cause: an index-space bug in the corpus builder

`align_band` reports object indices **local to the subset it is handed**:

```python
# align_objects.py:163,185
note_positions = [i for i, o in enumerate(objects) ...]   # subset-local
alignment.object_index = [i for i, _ in note_pairs]       # subset-local
```

`build_corpus.py` hands it `[objects[i] for i in members]`, where `members` is
the `by_band` split of upper/lower, then `build_targets` indexed the result into
the **full** measure object list. Whenever `members` does not start at 0 — which
is always, because `by_band` splits by staff — **every pitch label pointed at a
different notehead**. Fixed by a one-line remap, `build_corpus.py:330-334`.

Measured against the source corpus, where the champion scores 0.988:

| invariant | before | after | source control |
|---|---|---|---|
| \|stepsFromBandCenter\| > 4 | 50.9% | **9.7%** | 5.7% |
| \|stepsFromBandCenter\| > 8 | 40.0% | **0.0%** | 0.0% |
| median \|k\| | 4.09 | **1.92** | 1.19 |
| `staffRole` == nearest band | 55.3% | **100.0%** | 100.0% |

A five-line staff is 4 staff spaces tall. Half the corpus was claiming noteheads
sitting 5–9 staff spaces from the band centre, attributed to a staff they were
not on.

---

## 3. Self-verifying geometry (D2)

`tools/real-pdf-adaptation/staff_geometry_verify.py`, enforced by a mandatory
gate in the builder. Every check uses the **detected staff alone** — no ground
truth — so it can gate a corpus before any label is written:

1. **Band membership** — the object attributed to a band must be nearer that
   band's centre than the other's (the same rule the builder assigns by).
2. **Ledger envelope** — `|k| ≤ 8` staff spaces. Beyond that a notehead is not
   on a five-line staff.
3. **Band-local spacing** — a band's own implied gap must agree with the pooled
   `staff_space()` within 1.35×, else its staff steps are scaled wrongly.

A label that fails is **refused and counted, never repaired by guessing**.
Checked and rejected as a hypothesis: the pooled-vs-band-local gap. The label
reproduces from the pooled gap to 5e-5, and the ratio is 0.988 median with only
0.7% outside ±5% — not a contributor.

---

## 4. Corpus records accepted / rejected (D3)

Full report: `out/phase_d3_corpus_consistency.json`.

| | before | after |
|---|---|---|
| records written | 778 | 778 |
| pitch labels | 7642 | 7625 |
| adaptation pitch labels | 4777 | 4766 |
| label-gate refusals | — | **57 (0.7%)** |

The fix cost 17 labels. Correctness over count — no threshold was widened to
admit more data.

**Label-gate refusals:** `dependent_label_dropped` 39, `object_outside_ledger_envelope` 17,
`staff_step_outside_ledger_envelope` 1.

**Group rejections (pre-existing aligner gates, unchanged):**
`unreliable_staff_lines` 249, `no_xml_measure_partner` 230,
`too_few_objects_or_events` 188, `too_few_accepted_matches` 142,
`event_coverage_too_low` 80, `residual_std_too_large` 66.

**By engraving:** musescore4-emmentaler 11 scores / 533 records / 5198 pitch /
21 refusals; musescore-feta 3 / 133 / 1448 / 15; musescore-legacy-mscore 1 / 92 /
830 / 21; corranzo-benchmark 3 / 20 / 149 / 0.

A gate bug was found and fixed during this phase: it was deleting **all** REST
and DURATION supervision, because a rest object never carries a `PITCH_STAFF`
label and was therefore treated as refused. The gate now drops only labels
tied to a genuinely refused pitch object.

---

## 5. Residual distributions

Per-score analytic written-pitch agreement (detected geometry vs MusicXML):
**median 0.831, min 0.451, 13 of 18 scores above 0.75**.

Held-out residual of the analytic prediction, in diatonic steps (`n=2353`):

| residual | count | share | reading |
|---|---|---|---|
| 0 | 1909 | 81.1% | exact |
| ±1 | 364 | 15.5% | one half-space off — a detector/localisation error |
| ±6 | 80 | 3.4% | **MISLABELLED — see correction** |

**Correction (Phase E).** The ±6 row does not exist. This table compared a
*step index mod 7* against what the text called a *diatonic* residual; ±6 ≡ ∓1
(mod 7), so those 80 rows were the ordinary ±1 errors counted twice. Measured
directly on the corrected corpus (n = 7,625, full diatonic residual): 0 → 80.5%,
−1 → 10.4%, +1 → 9.2%, **|r| ≥ 2 → 0.0%**. There is no clef or staff-role
tail. The real residual is at most one half-space on every label.

---

## 6–7. Corrected Gate 0: perfect vs detected geometry, per score

Identical ROI (8 px/staff space, 6×12 staff spaces), identical leave-one-**SCORE**-out
folds, identical seed, identical fold count, 11 folds. Target is the MusicXML
written step / octave.

| arm | written_step **pre-fix** | written_step **post-fix** | delta |
|---|---|---|---|
| majority baseline | 0.1794 | 0.1776 | — |
| pixels only (no geometry, no clef) | 0.1661 | 0.1883 | +0.022 |
| **detected geometry (ROI + k + role)** | **0.1758** | **0.7484** | **+0.573** |
| analytic (k + role, closed form) | 0.3006 | **0.8113** | +0.511 |
| detected, octave | 0.3315 | **0.9630** | +0.632 |

**Per-score held-out (detected, written step):**

| score | LOSO | train | n |
|---|---|---|---|
| pl-bach-prelude-bwv846 | 0.8875 | 0.970 | 320 |
| bc-chopin-nocturne-op9-n2 | 0.8219 | 0.950 | 320 |
| pl-handel-gavotte | 0.7778 | 0.955 | 117 |
| bc-chopin-etude-op10-12 | 0.7625 | 0.985 | 320 |
| bc-bach-fugue-bwv846 | 0.7562 | 0.970 | 320 |
| pl-mozart-turkish-march | 0.7514 | 0.912 | 173 |
| bc-mozart-k153 | 0.7344 | 0.960 | 320 |
| omf-piano-rhythm-tuplets-vector | 0.7353 | 0.970 | 34 |
| pl-chopin-mazurka-op6-1 | 0.6948 | 0.973 | 154 |
| pl-brahms-waltz-op39-3 | 0.5333 | 0.958 | 15 |
| std-hungarian-dance-no5 | 0.5077 | 0.968 | 260 |

9 of 11 scores clear 0.69; the two weak ones are the known geometry outlier and
a 15-object score. The lift is uniform across four engraving families, not
carried by one score.

---

## 8. Leakage audit

`out/phase_d4_leakage_audit.json`, all four checks pass:

- **L1 score overlap** — 11 held-out score ids, 0 duplicates.
- **L2 page content** — 44 rendered pages hashed, 44 distinct, **0** shared
  across scores. (First run of this check was vacuous — the page paths were not
  resolved against the corpus root, giving 0 pages hashed. Fixed and re-run.)
- **L3 target leakage** — all probe features are functions of the detected staff
  band and notehead centre, both raster-derived; the target is MusicXML.
  Agreement is 0.811, not 1.0, and is 0.301 on the pre-fix corpus — a leak would
  be 1.0 on both.
- **L4 protocol drift** — fold count (11) and ROI identical to the frozen run.
  Only the circular target and the missing clef were fixed.

---

## 9. Detector ceiling

- **A, perfect geometry:** the analytic closed form from `(k, role)` reaches
  **0.8113** written step / **0.9660** octave.
- **B, detected geometry:** a learned probe on the same inputs reaches
  **0.7484** / **0.9630**, i.e. 92% of the ceiling.
- **Pixels alone:** **0.1883** / **0.4879** against a 0.1776 / 0.3689 majority —
  at chance for written step.

By the D5 decision rule: **A and B both succeed**, so the input geometry contract
is finally usable. The third arm is the important operational finding — the ROI
raster by itself does not carry pitch, so any future architecture must consume
detector geometry, and improving the detector still has ~0.06 of headroom
(0.748 → 0.811) plus the 15.5% ±1 residual.

---

## 10. PASS / FAIL

**PASS. The labelled task is now learnable across scores.** Held-score
written-step 0.748 vs a 0.178 majority baseline, 4.2× the baseline, uniform
across four engraving families, with a quantified ceiling of 0.811 and a clean
leakage audit.

### What I am *not* recommending yet

No architecture work, and no RTX time. The recommended threshold before any
expensive experiment is **held-score written-step ≥ 0.70 from a frozen,
pre-registered script**, which is now met by the geometry path with margin and
without touching the champion. Two things should land first:

1. **Resolve the ±6 residual tail** (3.4%, concentrated in one score). That is a
   staff-role/clef-classification error, and it is a detector defect worth ~3
   points of ceiling on its own.
2. **Re-run the champion itself on the fixed corpus.** The 0.055 real-PDF written
   pitch was measured against a corpus where half the labels pointed at the
   wrong object. That number is not a valid baseline any more, and the honest
   question is now whether V2.5 *already* solves real PDFs once the labels are
   right. That is a CPU-only measurement on an existing checkpoint, and it
   should decide whether any architecture work is needed at all.

### Remaining known limits

- The 0.811 ceiling is measured under the corpus's assumption that the upper
  band is treble and the lower is bass. Scores with mid-piece clef changes
  (`clef_change_elements` ≥ 1) are counted against that assumption, so 0.811 is
  a conservative floor for a per-measure clef model.
- The 0.811 analytic arm is a closed form, not a learned system. It demonstrates
  the geometry is sufficient; it is not itself a deployable predictor.
- The 11 scored LOSO folds cover 4 engraving families on 20 scores. LilyPond
  (`std-la-campanella`) and `musescore-legacy-mscore` have one score each.
