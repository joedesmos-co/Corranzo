# Beam/Stem Phase 2 Regression Analysis

Generated: 2026-06-30T17:48:18.477Z

## Inputs

- Baseline/reverted reports: `tmp/omr-benchmark-iter/beam-stem2-reverted`
- Broad cap reports: `tmp/omr-benchmark-iter/beam-stem2`
- Tight cap reports: `tmp/omr-benchmark-iter/beam-stem2-tight`
- Source command requested by handoff: `npm run omr:benchmark-dashboard`

## Executive summary

The failed Phase 2 cap runs did not prove that the beam graph is bad at finding ink. They proved that event-level beam duration caps are the wrong abstraction. The beam/stem graph is highly attached to noteheads, but the cap applied one beam-derived duration to an existing musical event. In dense measures, one existing event can contain multiple voices, sustained chord tones, or a beamed attack plus an overhanging note. Shortening that whole event changed written MusicXML timing and sometimes evaluator alignment.

The broad cap regressed because it converted many near-beam or dotted-looking durations (`3->2`) into plain eighths. The tight cap removed those near/dotted cases, but still regressed because the remaining long-to-eighth caps hit ambiguous events where beam evidence belonged to only one note or voice inside the event.

Clean Gymnopedie remained unchanged across the failed runs and the reverted baseline.

## Dense metric comparison

| Run | Duration | Wrong dur Δ | Onset | Wrong onset Δ | Pitch | Wrong pitch Δ | Chord | Chord mismatch Δ | Notes | Measures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Reverted baseline | 80.96% | 0 | 71.81% | 0 | 34.34% | 0 | 66.41% | 0 | 2808 (0) | 127 (0) |
| Broad cap | 80.11% | +21 | 70.46% | +35 | 34.48% | -7 | 66.41% | 0 | 2808 (0) | 127 (0) |
| Tight cap | 80.82% | +4 | 71.81% | 0 | 34.34% | 0 | 66.41% | 0 | 2808 (0) | 127 (0) |

## Clean metric comparison

| Run | Pitch | Pitch Δ | Duration | Duration Δ | Onset | Onset Δ | Chord | Chord Δ | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Reverted baseline | 100.00% | 0.0000 | 99.79% | 0.0000 | 100.00% | 0.0000 | 100.00% | 0.0000 | 469 (0) |
| Broad cap | 100.00% | 0.0000 | 99.79% | 0.0000 | 100.00% | 0.0000 | 100.00% | 0.0000 | 469 (0) |
| Tight cap | 100.00% | 0.0000 | 99.79% | 0.0000 | 100.00% | 0.0000 | 100.00% | 0.0000 | 469 (0) |

## Beam/stem baseline reliability

| Measure | Value |
| --- | --- |
| Notes in graph | 2808 |
| Stem attachment | 99.96% |
| Beam attachment | 32.76% |
| Average confidence | 0.8617 |
| Disagreement rate | 67.13% |
| Graph beamed but current long | 344 |
| Current short without beam graph | 1400 |
| Current beam probe without graph | 141 |

Interpretation: stem attachment is strong enough to keep investing in beam/stem diagnostics. Beam attachment is partial, and the disagreement rate shows that beams cannot safely overwrite current rhythm until ownership and voice context are explicit.

## Broad cap failure

Cap summary: candidates=177, noteCandidates=303, applied=177, appliedNotes=303

| Skipped reason | Count |
| --- | --- |
| unbeamed-group | 1888 |
| not-too-long | 429 |
| mixed-event-has-unbeamed-note | 48 |
| weaker-duplicate-candidate | 8 |
| low-confidence-beam | 4 |

| Affected measures | Improved dur | Worsened dur | Same dur | Dur Δ | Onset Δ | Pitch Δ | Error Δ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 87 | 14 | 15 | 58 | +21 | +35 | -7 | +51 |

Top broad-cap worsened measures:

| Measure | Caps | Notes | Dur Δ | Onset Δ | Pitch Δ | Error Δ | Retained cap samples |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 89 | 5 | 12 | +7 | 0 | 0 | +7 | 4->2/n3, 3->2/n3, 3->2/n3, 3->2/n2, 3->2/n1 |
| 34 | 2 | 4 | +4 | +1 | 0 | +5 | 4->2/n2, 3->2/n2 |
| 33 | 3 | 6 | +4 | 0 | 0 | +4 | 3->2/n2, 4->2/n2, 3->2/n2 |
| 93 | 3 | 6 | +4 | 0 | 0 | +4 | 4->2/n2, 3->2/n2, 3->2/n2 |
| 114 | 2 | 4 | +4 | 0 | 0 | +4 | 4->2/n2, 3->2/n2 |
| 109 | 5 | 5 | +3 | +2 | -1 | +5 | 3->2/n1, 4->2/n1, 3->2/n1, 3->2/n1, 3->2/n1 |
| 94 | 2 | 4 | +3 | 0 | 0 | +3 | 3->2/n2, 3->2/n2 |
| 25 | 3 | 3 | +3 | 0 | 0 | +3 | 3->2/n1, 3->2/n1, 3->2/n1 |
| 113 | 4 | 8 | +2 | 0 | 0 | +2 | 3->2/n2, 3->2/n2, 4->2/n2, 3->2/n2 |
| 90 | 4 | 10 | +1 | +3 | -1 | +3 | 3->2/n3, 3->2/n1, 4->2/n3, 3->2/n3 |

Top broad-cap improved measures:

| Measure | Caps | Notes | Dur Δ | Onset Δ | Pitch Δ | Error Δ | Retained cap samples |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 28 | 3 | 7 | -3 | 0 | 0 | -3 | 8->2/n3, 4->2/n3, 3->2/n1 |
| 95 | 2 | 6 | -2 | 0 | 0 | -2 | 4->2/n3, 3->2/n3 |
| 103 | 1 | 2 | -2 | 0 | 0 | -2 | 3->2/n2 |
| 35 | 2 | 6 | -2 | +2 | 0 | 0 | 3->2/n3, 3->2/n3 |
| 7 | 3 | 4 | -1 | -1 | 0 | -2 | 4->2/n1, 3->2/n2, 3->2/n1 |
| 20 | 2 | 3 | -1 | -1 | -1 | -2 | 3->2/n2, 3->2/n1 |
| 82 | 4 | 8 | -1 | 0 | 0 | -1 | 3->2/n1, 3->2/n1, 3->2/n3, 3->2/n1, 3->2/n3, 3->2/n1 |
| 5 | 3 | 3 | -1 | 0 | 0 | -1 | 4->2/n1, 4->2/n1, 4->2/n1, 4->2/n1 |
| 61 | 2 | 3 | -1 | 0 | 0 | -1 | 3->2/n2, 12->2/n1 |
| 74 | 3 | 3 | -1 | 0 | 0 | -1 | 3->2/n1, 3->2/n1, 3->2/n1 |

Broad-cap category signals:

| Category | Measures | Caps | Notes | Dur Δ | Onset Δ | Pitch Δ | Error Δ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3->2 caps: likely dotted/near-correct beamed notes | 82 | 167 | 288 | +22 | +35 | -7 | +52 |
| multi-note event caps: beam belongs to only part of an event | 47 | 110 | 236 | +18 | +21 | -4 | +34 |
| long-to-eighth caps: likely sustained voice/overlap collapse | 4 | 11 | 22 | -3 | 0 | 0 | -3 |
| 4->2 caps: quarter-like event shortened to eighth | 20 | 60 | 116 | +22 | +9 | -3 | +29 |
| single-note event caps | 40 | 67 | 67 | +3 | +14 | -3 | +17 |

Broad-cap sample shape signals:

| Shape | Samples | Measures | Dur Δ | Onset Δ | Pitch Δ | Error Δ | Measures |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3->2/n2 | 41 | 32 | +24 | +10 | -1 | +33 | 7, 20, 32, 33, 34, 36, 40, 43, 44, 57, 58, 59 |
| 3->2/n1 | 86 | 52 | +7 | +21 | -7 | +24 | 1, 3, 4, 7, 8, 9, 12, 13, 14, 15, 16, 17 |
| 4->2/n2 | 7 | 7 | +18 | +3 | 0 | +21 | 32, 33, 34, 92, 93, 113, 114 |
| 3->2/n3 | 29 | 18 | +3 | +12 | -2 | +12 | 27, 30, 35, 36, 42, 46, 47, 64, 68, 82, 88, 89 |
| 4->2/n3 | 7 | 7 | +3 | +5 | -2 | +6 | 27, 28, 29, 89, 90, 95, 108 |
| 4->2/n1 | 10 | 7 | +1 | +1 | -1 | +2 | 2, 5, 6, 7, 29, 83, 109 |
| 6->2/n2 | 2 | 2 | +1 | 0 | 0 | +1 | 8, 29 |
| 6->2/n3 | 1 | 1 | 0 | 0 | 0 | 0 | 29 |
| 12->2/n1 | 1 | 1 | -1 | 0 | 0 | -1 | 61 |
| 8->2/n3 | 1 | 1 | -3 | 0 | 0 | -3 | 28 |

## Tight cap failure

Cap summary: candidates=28, noteCandidates=55, applied=28, appliedNotes=55

| Skipped reason | Count |
| --- | --- |
| unbeamed-group | 1888 |
| not-too-long | 429 |
| near-beam-value-or-dotted | 156 |
| mixed-event-has-unbeamed-note | 48 |
| low-confidence-beam | 4 |
| weaker-duplicate-candidate | 1 |

| Affected measures | Improved dur | Worsened dur | Same dur | Dur Δ | Onset Δ | Pitch Δ | Error Δ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 22 | 5 | 7 | 10 | +4 | 0 | 0 | +4 |

Top tight-cap worsened measures:

| Measure | Caps | Notes | Dur Δ | Onset Δ | Pitch Δ | Error Δ | Retained cap samples |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 89 | 1 | 3 | +2 | 0 | 0 | +2 | 4->2/n3 |
| 33 | 1 | 2 | +2 | 0 | 0 | +2 | 4->2/n2 |
| 34 | 1 | 2 | +2 | 0 | 0 | +2 | 4->2/n2 |
| 93 | 1 | 2 | +2 | 0 | 0 | +2 | 4->2/n2 |
| 113 | 1 | 2 | +2 | 0 | 0 | +2 | 4->2/n2 |
| 114 | 1 | 2 | +2 | 0 | 0 | +2 | 4->2/n2 |
| 109 | 1 | 1 | +1 | 0 | 0 | +1 | 4->2/n1 |
| 29 | 4 | 9 | 0 | 0 | 0 | 0 | 6->2/n3, 6->2/n2, 4->2/n3, 4->2/n1 |
| 27 | 1 | 3 | 0 | 0 | 0 | 0 | 4->2/n3 |
| 90 | 1 | 3 | 0 | 0 | 0 | 0 | 4->2/n3 |

Top tight-cap improved measures:

| Measure | Caps | Notes | Dur Δ | Onset Δ | Pitch Δ | Error Δ | Retained cap samples |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 28 | 2 | 6 | -3 | 0 | 0 | -3 | 8->2/n3, 4->2/n3 |
| 95 | 1 | 3 | -3 | 0 | 0 | -3 | 4->2/n3 |
| 5 | 3 | 3 | -1 | 0 | 0 | -1 | 4->2/n1, 4->2/n1, 4->2/n1, 4->2/n1 |
| 7 | 1 | 1 | -1 | 0 | 0 | -1 | 4->2/n1 |
| 61 | 1 | 1 | -1 | 0 | 0 | -1 | 12->2/n1 |
| 29 | 4 | 9 | 0 | 0 | 0 | 0 | 6->2/n3, 6->2/n2, 4->2/n3, 4->2/n1 |
| 27 | 1 | 3 | 0 | 0 | 0 | 0 | 4->2/n3 |
| 90 | 1 | 3 | 0 | 0 | 0 | 0 | 4->2/n3 |
| 108 | 1 | 3 | 0 | 0 | 0 | 0 | 4->2/n3 |
| 8 | 1 | 2 | 0 | 0 | 0 | 0 | 6->2/n2 |

Tight-cap category signals:

| Category | Measures | Caps | Notes | Dur Δ | Onset Δ | Pitch Δ | Error Δ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3->2 caps: likely dotted/near-correct beamed notes | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| multi-note event caps: beam belongs to only part of an event | 15 | 19 | 46 | +6 | 0 | 0 | +6 |
| long-to-eighth caps: likely sustained voice/overlap collapse | 4 | 8 | 18 | -4 | 0 | 0 | -4 |
| 4->2 caps: quarter-like event shortened to eighth | 20 | 26 | 52 | +5 | 0 | 0 | +5 |
| single-note event caps | 7 | 9 | 9 | -2 | 0 | 0 | -2 |

Tight-cap sample shape signals:

| Shape | Samples | Measures | Dur Δ | Onset Δ | Pitch Δ | Error Δ | Measures |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4->2/n2 | 7 | 7 | +10 | 0 | 0 | +10 | 32, 33, 34, 92, 93, 113, 114 |
| 6->2/n2 | 2 | 2 | 0 | 0 | 0 | 0 | 8, 29 |
| 6->2/n3 | 1 | 1 | 0 | 0 | 0 | 0 | 29 |
| 4->2/n1 | 10 | 7 | -1 | 0 | 0 | -1 | 2, 5, 6, 7, 29, 83, 109 |
| 12->2/n1 | 1 | 1 | -1 | 0 | 0 | -1 | 61 |
| 8->2/n3 | 1 | 1 | -3 | 0 | 0 | -3 | 28 |
| 4->2/n3 | 7 | 7 | -4 | 0 | 0 | -4 | 27, 28, 29, 89, 90, 95, 108 |

## Failure categories

1. Beam evidence correct but duration already handled: both failed runs skipped 429 `not-too-long` candidates. That means current rhythm logic had already shortened many beamed notes to at or below the beam value. The runtime cap mostly targeted the hard residual cases, not the easy wins.

2. Dotted or near-correct values were flattened: the broad run changed many `3->2` events. Those are visually beamed, but the current duration was often a dotted/near-beam value or part of a local subdivision. Flattening them produced the broad onset regression and increased wrong durations.

3. Beam belonged to one voice while the existing event represented more than one voice: the diagnostics skipped 48 `mixed-event-has-unbeamed-note` cases, and the top worsened measures include multi-note caps. Event-level caps cannot distinguish a beamed attack from a sustained chord tone or accompaniment voice.

4. Capping broke sustained/voice overlap: the tight run removed the obvious `3->2` near/dotted cases and still regressed. Its remaining long-to-eighth and quarter-to-eighth caps are exactly the cases where a beamed stem can coexist with a longer sounding or written voice in the current event model.

5. Evaluator rematching amplified the damage: broad caps did not change note or measure count, but wrong onsets increased. Shortened durations altered the generated timeline enough that the evaluator rematched neighboring notes differently, so some pitch and onset changes are downstream alignment artifacts rather than direct detection changes.

6. Staff-line or ornament artifacts are not the primary explanation: clean stayed unchanged and stem attachment remained high. Dense false positives may exist, but the dominant failure is ownership of valid beam evidence, not raw visual beam extraction.

## Extra signal needed before beams affect runtime

- Stem direction per notehead, not only per event.
- Per-note beam count and beam level, not a single event-level inferred unit.
- Beam group boundaries: start, continue, end, hook, and whether a note shares the same beam span.
- Voice ownership before duration overwrite: a beamed upper voice and a sustained lower voice must be separate rhythmic objects.
- Separate written duration from sounding sustain/playback duration so a short beamed attack does not erase an overhanging note or tied sustain.
- A simulation/evaluator gate that proves a beam-derived edit improves duration without increasing onset/chord errors before it reaches MusicXML.

## Recommended next safe milestone

Do not retry event-level beam duration caps. The next safe milestone is diagnostics-only Beam Ownership Reconstruction:

1. Build per-note `BeamOwnershipCandidate` records: notehead id, stem id, stem direction, beam ids, beam level count, beam group boundary role, and local event id.
2. Compare those candidates against existing musical events to flag event-level conflicts: mixed stem directions, beamed plus unbeamed notes, same event with multiple beam groups, and long-duration notes inside a beamed event.
3. Add an offline simulation report that predicts a per-note or per-voice split but does not write MusicXML.
4. Only after the simulation improves dense duration without onset/chord regression should runtime MusicXML generation consume the beam graph.

This keeps the reliable Phase 1 extraction work, but moves the next benchmark bet from duration capping to voice-safe beam ownership.
