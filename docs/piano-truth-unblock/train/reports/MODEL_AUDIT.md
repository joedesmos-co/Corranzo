# P1 — Model composition audit: what the three trained models are, how they
combine, what is missing, and what depends on source truth at inference

## 1. The three components (frozen checkpoints, CPU)

| probe | heads | DEV evidence (dev20, n=5,371/5,001) |
|---|---|---|
| common (LocalModel) | kind, pitch, dur, dots, staff, acc, grace, cue, voice | kind 0.996, pitch 0.665, dur 0.804, dots 0.964, staff 0.712, acc 0.980, grace P/R 0/0, cue P/R 0/0, voice 0.807 |
| membership (LocalModel) | 18 binary flags | in_beam P/R 0.92/0.95, chord_tone 0.94/0.96, tie_start 0.46/0.18, tie_end 0.62/0.10, slur 0.56/0.11, tuplet/artic/ornament/fingering/arpeg/gliss/pedal/octave/hairpin P/R 0/0 or unevaluable |
| context (ContextModel) | staff, voice, kind, pitch, dur | staff 0.822, voice 0.807 |

All three consume the same per-object inputs (64×64 crop + 256×48 strip +
5-dim geometry) built from oracle SVG boxes. They were trained independently;
no joint inference path existed before this task.

## 2. Combination rule (implemented in scripts/infer.py, deterministic)

| target | winner | evidence |
|---|---|---|
| kind, pitch, dur, dots, acc | common | only serious candidate (context pitch/dur are reference-only) |
| staff | context | 0.822 > 0.712 |
| voice | context | 0.8071 vs 0.8066 (tie; architectural purpose + P4 structural adjudication) |
| grace, cue | membership | only head with P/R evidence (grace R=0.047; cue support 0) |
| 16 binary flags | membership | sole source |

Ties broken by architectural purpose where DEV is tied (voice); P4 measures
whether the choice matters structurally.

## 3. Missing prediction heads (nothing predicted for these)

detection/boxes, onset_ppq regression, chord grouping, relationship endpoints
(tie/slur partners, beam groups, tuplet members + ratio), measure-aware voice
(flat class only), navigation (repeat/ending expansion, segno/coda/dc/ds/fine
semantics), text/tempo/dynamics content, pedal spans, octave direction,
tuplet ratio, slur endpoints, artic/ornament/fingering TYPES (presence only),
mRest-vs-rest distinction beyond duration, breath/caesura, mNum/reh/harm
content, multiRest.

## 4. Source-truth dependence at inference (stage B oracle inputs)

The decoder legitimately consumes, in addition to model predictions:
- oracle boxes (SVG note/rest/notehead bboxes) — replacement: trained detector
  (does not exist; stage C unavailable);
- oracle page structure: measure map + order, staff systems, barline forms —
  replacement: staff-system + barline detector (does not exist);
- oracle clef/key/meter per measure+staff — replacement: clef/key classifiers
  (do not exist);
- oracle divisions/part/staff-count — structural constants;
- notehead_x from oracle boxes (for chord grouping) — replacement: same detector.

Never consumed: pitches, durations, identities, onsets, relationships,
accidentals, voices, text content. The decoder code takes `structure` as an
explicit parameter so predicted structure slots in without redesign.

## 5. What "25-head product recognition" would require (and does not exist)

A product claim would need, beyond the above: a detector, structure
prediction, relationship pairing, sequence-level rhythm validation, navigation
expansion, and real-scan robustness. None of these exist. This task builds the
deterministic decoder over oracle structure and measures exactly how far
predictions alone carry reconstruction — nothing more is claimed.
