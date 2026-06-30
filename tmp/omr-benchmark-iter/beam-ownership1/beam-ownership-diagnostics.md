# Beam Ownership Reconstruction Phase 1 Diagnostics

Generated: 2026-06-30T17:57:56.963Z

## Inputs

- Dense report: `tmp/omr-benchmark-dashboard/fixtures/dense.json`
- Clean report: `tmp/omr-benchmark-dashboard/fixtures/clean.json`

## Benchmark guardrail

| Fixture | Pitch | Duration | Onset | Chord | Notes | Measures | Wrong dur | Wrong onset | Chord mismatch |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dense | 34.34% | 80.96% | 71.81% | 66.41% | 2808 | 127 | 223 | 480 | 1134 |
| clean | 100.00% | 99.79% | 100.00% | 100.00% | 469 | 78 | 1 | 0 | 0 |

These diagnostics are read-only. They add ownership fields to OMR diagnostics and do not feed MusicXML generation.

## Dense ownership summary

| Measure | Value |
| --- | --- |
| Owned noteheads | 2808 |
| Notes with stem direction | 2807 |
| Notes with beams | 1061 |
| Notes without beams | 1747 |
| Notes with beam group | 920 |
| Beam groups | 239 |
| Note events | 1669 |
| Mixed ownership events | 133 |
| Split-candidate events | 24 |
| Split-candidate notes | 67 |
| Stem attachment rate | 99.96% |
| Beam attachment rate | 32.76% |
| Beam/stem confidence | 0.8617 |

## Clean ownership summary

| Measure | Value |
| --- | --- |
| Owned noteheads | 469 |
| Notes with stem direction | 469 |
| Notes with beams | 0 |
| Mixed ownership events | 0 |
| Split-candidate events | 0 |

## Dense voice roles

| Role | Notes |
| --- | --- |
| stemmed-sustain-or-quarter-voice | 1746 |
| beamed-eighth-voice | 1061 |
| unattached-or-rest-like-notehead | 1 |

## Dense stem directions

| Direction | Notes |
| --- | --- |
| down | 1729 |
| up | 1078 |

## Mixed ownership reasons

| Reason | Events |
| --- | --- |
| beamed-and-unbeamed-notes | 133 |
| multiple-likely-voices | 133 |
| mixed-stem-directions | 94 |
| event-longer-than-beam-unit | 24 |

## Split candidate reasons

| Reason | Events |
| --- | --- |
| beamed-and-unbeamed-notes | 24 |
| event-longer-than-beam-unit | 24 |
| multiple-likely-voices | 24 |
| mixed-stem-directions | 21 |

## Split candidate samples

| Measure | Event | Start | Duration | Beam unit | Beamed/unbeamed | Stem dirs | Beam groups | Reasons |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6 | 7 | 7 | 3 | 2 | 1/2 | up | rg-6-1 | beamed-and-unbeamed-notes, multiple-likely-voices, event-longer-than-beam-unit |
| 23 | 1 | 0 | 3 | 2 | 2/1 | down, up | rg-23-3 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 24 | 1 | 0 | 3 | 2 | 1/2 | down, up | rg-24-2 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 29 | 4 | 8 | 4 | 2 | 1/2 | down | rg-29-2 | beamed-and-unbeamed-notes, multiple-likely-voices, event-longer-than-beam-unit |
| 32 | 3 | 4 | 3 | 2 | 1/1 | down, up | rg-32-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 33 | 10 | 11 | 3 | 2 | 1/1 | down, up | rg-33-2 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 35 | 11 | 13 | 3 | 2 | 2/1 | down, up | rg-35-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 38 | 7 | 8 | 3 | 2 | 2/1 | down, up | rg-38-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 40 | 7 | 9 | 3 | 2 | 2/1 | down, up | rg-40-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 47 | 14 | 12 | 4 | 2 | 1/2 | down | rg-47-1 | beamed-and-unbeamed-notes, multiple-likely-voices, event-longer-than-beam-unit |
| 60 | 3 | 3 | 3 | 2 | 1/1 | down, up | rg-60-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 66 | 7 | 8 | 3 | 2 | 2/1 | down, up | rg-66-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 70 | 7 | 8 | 3 | 2 | 2/1 | down, up | rg-70-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 85 | 1 | 0 | 3 | 2 | 1/2 | down, up | rg-85-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 92 | 3 | 4 | 3 | 2 | 1/1 | down, up | rg-92-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 93 | 10 | 11 | 3 | 2 | 1/1 | down, up | rg-93-2 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 96 | 7 | 7 | 3 | 2 | 2/1 | down, up | rg-96-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 98 | 7 | 9 | 3 | 2 | 2/1 | down, up | rg-98-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 100 | 7 | 8 | 3 | 2 | 2/1 | down, up | rg-100-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 102 | 7 | 8 | 3 | 2 | 2/1 | down, up | rg-102-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 118 | 7 | 8 | 3 | 2 | 2/1 | down, up | rg-118-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 120 | 7 | 8 | 3 | 2 | 2/1 | down, up | rg-120-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 122 | 7 | 9 | 3 | 2 | 2/1 | down, up | rg-122-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 126 | 7 | 8 | 3 | 2 | 2/1 | down, up | rg-126-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |

## Mixed ownership samples

| Measure | Event | Start | Duration | Beam unit | Beamed/unbeamed | Stem dirs | Beam groups | Reasons |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6 | 7 | 7 | 3 | 2 | 1/2 | up | rg-6-1 | beamed-and-unbeamed-notes, multiple-likely-voices, event-longer-than-beam-unit |
| 7 | 0 | 0 | 2 |  | 2/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 8 | 5 | 9 | 2 |  | 2/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 9 | 2 | 4 | 1 |  | 1/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 9 | 6 | 8 | 2 | 2 | 1/1 | up | rg-9-1 | beamed-and-unbeamed-notes, multiple-likely-voices |
| 16 | 6 | 8 | 2 |  | 1/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 23 | 1 | 0 | 3 | 2 | 2/1 | down, up | rg-23-3 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 24 | 1 | 0 | 3 | 2 | 1/2 | down, up | rg-24-2 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 25 | 1 | 0 | 2 | 2 | 2/1 | down, up | rg-25-2 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 26 | 0 | 0 | 2 |  | 1/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 26 | 4 | 5 | 2 |  | 2/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 26 | 7 | 9 | 2 |  | 2/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 29 | 4 | 8 | 4 | 2 | 1/2 | down | rg-29-2 | beamed-and-unbeamed-notes, multiple-likely-voices, event-longer-than-beam-unit |
| 30 | 0 | 0 | 2 |  | 2/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 30 | 4 | 5 | 1 |  | 2/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 32 | 3 | 4 | 3 | 2 | 1/1 | down, up | rg-32-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 33 | 0 | 0 | 2 |  | 1/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 33 | 6 | 7 | 1 | 2 | 1/1 | down, up | rg-33-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 33 | 7 | 8 | 2 |  | 1/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 33 | 10 | 11 | 3 | 2 | 1/1 | down, up | rg-33-2 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 34 | 0 | 0 | 2 |  | 1/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 35 | 11 | 13 | 3 | 2 | 2/1 | down, up | rg-35-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 36 | 0 | 0 | 2 |  | 2/1 | down | none | beamed-and-unbeamed-notes, multiple-likely-voices |
| 36 | 6 | 8 | 2 |  | 2/1 | down | none | beamed-and-unbeamed-notes, multiple-likely-voices |
| 36 | 10 | 12 | 2 |  | 1/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 38 | 0 | 0 | 2 |  | 2/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 38 | 6 | 8 | 2 |  | 2/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 38 | 7 | 8 | 3 | 2 | 2/1 | down, up | rg-38-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 38 | 10 | 12 | 2 |  | 1/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 39 | 3 | 2 | 2 | 2 | 1/1 | up | rg-39-1 | beamed-and-unbeamed-notes, multiple-likely-voices |
| 39 | 9 | 7 | 2 | 2 | 1/1 | down, up | rg-39-3 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 40 | 0 | 0 | 2 |  | 2/1 | down | none | beamed-and-unbeamed-notes, multiple-likely-voices |
| 40 | 6 | 9 | 1 |  | 2/1 | down | none | beamed-and-unbeamed-notes, multiple-likely-voices |
| 40 | 7 | 9 | 3 | 2 | 2/1 | down, up | rg-40-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 40 | 10 | 13 | 2 |  | 1/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 42 | 0 | 0 | 2 |  | 2/1 | down | none | beamed-and-unbeamed-notes, multiple-likely-voices |
| 42 | 10 | 13 | 1 |  | 1/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 44 | 0 | 0 | 2 |  | 2/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 44 | 6 | 8 | 2 |  | 2/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 44 | 10 | 12 | 2 |  | 1/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 44 | 12 | 14 | 2 | 2 | 1/1 | down, up | rg-44-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 46 | 0 | 0 | 2 |  | 2/1 | down | none | beamed-and-unbeamed-notes, multiple-likely-voices |
| 46 | 10 | 13 | 2 |  | 1/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 47 | 14 | 12 | 4 | 2 | 1/2 | down | rg-47-1 | beamed-and-unbeamed-notes, multiple-likely-voices, event-longer-than-beam-unit |
| 56 | 11 | 11 | 2 | 2 | 1/1 | down, up | rg-56-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 57 | 16 | 15 | 1 | 2 | 1/1 | up | rg-57-1 | beamed-and-unbeamed-notes, multiple-likely-voices |
| 59 | 2 | 1 | 2 | 2 | 1/1 | down | rg-59-1 | beamed-and-unbeamed-notes, multiple-likely-voices |
| 59 | 6 | 6 | 2 | 2 | 1/2 | down, up | rg-59-2 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 60 | 3 | 3 | 3 | 2 | 1/1 | down, up | rg-60-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 64 | 0 | 0 | 2 |  | 2/1 | down | none | beamed-and-unbeamed-notes, multiple-likely-voices |
| 64 | 6 | 8 | 2 |  | 2/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 64 | 10 | 12 | 2 |  | 1/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 66 | 0 | 0 | 2 |  | 2/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 66 | 6 | 8 | 2 |  | 2/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 66 | 7 | 8 | 3 | 2 | 2/1 | down, up | rg-66-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 66 | 10 | 12 | 2 |  | 1/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 67 | 7 | 6 | 2 | 2 | 1/1 | up | rg-67-2 | beamed-and-unbeamed-notes, multiple-likely-voices |
| 67 | 9 | 8 | 1 | 2 | 1/1 | down, up | rg-67-3 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 68 | 0 | 0 | 2 |  | 2/1 | down | none | beamed-and-unbeamed-notes, multiple-likely-voices |
| 68 | 6 | 9 | 1 |  | 2/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |
| 70 | 0 | 0 | 2 |  | 2/1 | down | none | beamed-and-unbeamed-notes, multiple-likely-voices |
| 70 | 6 | 8 | 2 |  | 2/1 | down | none | beamed-and-unbeamed-notes, multiple-likely-voices |
| 70 | 7 | 8 | 3 | 2 | 2/1 | down, up | rg-70-1 | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 70 | 10 | 13 | 1 |  | 1/1 | down, up | none | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices |

## Interpretation

- The useful signal is no longer just whether an event is beamed. It is whether individual noteheads inside the event have incompatible ownership.
- Split candidates are events where a beamed note has a shorter beam-implied unit than the event duration and the event also contains another ownership class, such as an unbeamed note or different stem direction.
- These cases explain why event-level beam caps regressed: the beam evidence can be correct for one note while the event duration still belongs to a sustained or overlapping voice.

## Recommended Phase 2 slice

Use this ownership graph for simulation first, not MusicXML output:

1. Select only split-candidate events with exactly one beamed ownership group and at least one unbeamed/stemmed sustain note.
2. Require different stem directions or different likely voice ids inside the same event.
3. Keep note count and measure count fixed: simulate splitting the beamed noteheads to the beam-implied duration while preserving the sustained noteheads at the original event duration.
4. Score the simulated events against the evaluator before generating MusicXML.
5. Promote to runtime only if duration improves and onset/chord/pitch stay stable on dense while clean remains unchanged.
