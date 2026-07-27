# Guitar Mapping Sprint 1 — Stage-2 playable string/fret assignment

## Status
**ACCEPTED and frozen (2026-07-26).** Stage-2 mapping optimizer is locked.
Do not continue tuning unless a real playability regression is demonstrated.
Follow-on: **Musical Structure / Interpretation Sprint 1** (repeats/endings).
The two `guitar-standard` false ties remain a narrow future Sustain issue (not Interpretation).

## Preconditions
- **Guitar Pitch Sprint 1** accepted and frozen (stage-1 sounding MIDI provenance).
- Semantic evaluator frozen (`2.0.0` / schema `2`).
- Do not change recognized MIDI / MusicXML pitch emission / notation↔TAB provenance.
- Recorded future Sustain follow-up (not this sprint): two false ties on `guitar-standard-chords-vector`.

## Scope
Stage 2 only: sounding MIDI → string/fret via `deriveTabPositions` / `assignChordPositions`.
Explicit MusicXML/OMR `<technical>` positions still win and are never rewritten.

## Mapping benchmark (independent of semantic OMR)
- Module: `src/features/instruments/guitarMappingQuality.js`
- Runner: `scripts/guitar-mapping-benchmark.mjs`
- Tests: `tests/guitarMappingSprint1.test.js`

## Pre-fix failure classes (derived-from-MIDI path)
| Class | Evidence |
| --- | --- |
| Impossible chord / missing assignment | `guitar-paired-chords` truth-derived: 2 invalid, 2 impossible |
| Excessively wide chord shapes | OMR-MIDI-derived `guitar-standard`: maxSpan **9** |
| Mapping chosen per note (greedy) | Prior `assignChordNotePositions` picked independently by pitch rank |
| No sustain occupancy | New attacks could reuse a string still held by another pitch |
| Weak repeated-note retention | tab-sparse repeat same-string **71.4%** |

Not dominant: same-string conflicts on derived path (already 0); MIDI↔fret mismatch on paired/techniques OMR emit (102/102, 32/32).

## Fix (smallest general optimizer change)
In `src/features/instruments/fretboard.js`:
1. **Joint chord search** when greedy leaves gaps or fretted span > 4; otherwise keep fast greedy for open-position continuity.
2. **Sustain string occupancy** — a held pitch blocks its string until `timeSeconds + durationSeconds`.
3. **Repeated-pitch string preference** when the retained position stays within 4 frets of the hand.
4. Chord cost penalizes span overflow and hand travel; does not globally force lowest frets.

No OMR / MusicXML / piano / tie / articulation / renderer changes.

## Mapping metrics (truth MIDI → derived frets)

| Fixture | Invalid | Impossible | avgJump | p95 | maxSpan | Repeat same-string |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| standard before | 0 | 0 | 0.128 | 2 | 2 | 98% |
| standard after | 0 | 0 | 0.407 | 2 | 2 | 98% |
| paired before | **2** | **2** | 0.645 | 3 | 3 | 85.7% |
| paired after | **0** | **0** | 0.774 | 4 | 3 | 85.9% |
| techniques before | 0 | 0 | 1.226 | 4 | — | 100% |
| techniques after | 0 | 0 | 1.652 | 4 | — | 100% |
| tab-sparse before | 0 | 0 | 1.933 | 10 | — | 71.4% |
| tab-sparse after | 0 | 0 | 2.261 | 10 | — | **95.2%** |

### OMR MIDI→derived (notation-only stress)
| Fixture | maxSpan before → after | Notes |
| --- | --- | --- |
| guitar-standard-chords-vector | **9 → 5** | Wide shapes reduced; still some ≥5-fret grips on dense stacks |
| guitar-paired-chords-vector | 3 → 3 | Stable |
| guitar-tab-sparse-vector | n/a → 4 | Span controlled when chords appear |

Corpus totals (truth-derived): invalid **2→0**, impossible **2→0**, same-string **0→0**.

Jump means rose slightly (0.98→1.27) because sustain occupancy and string retention correctly refuse some lowest-fret / open shortcuts. Max jumps on sparse scales remain hard (musical position shifts of ~10 frets in the source).

## Semantic corpus (gate)
Frozen semantic scores **bitwise unchanged** vs Guitar Pitch Sprint 1 after:
- Overall 60.0%, Pitch 58.4%, all per-fixture Pitch identical
- Piano unchanged; Guitar Pitch unchanged
- Emitted MIDI unchanged (mapping never rewrites `midi`)

## Remaining unplayable / hard cases
- Some dense OMR-derived stacks still need span 5 (physically awkward barre-like grips).
- Sparse scale passages still show p95 jump 10 (true position shifts in the line).
- Explicit TAB positions are not re-optimized (by design).
- False guitar ties on standard-chords remain a Sustain follow-up.

## Acceptance
- [x] Zero invalid string/fret assignments (derived path)
- [x] Zero same-string conflicts
- [x] Fewer impossible / excessively wide shapes (impossible 2→0; standard OMR maxSpan 9→5)
- [~] Jump metrics mixed (validity/sustain tradeoff; not globally lower)
- [x] Emitted MIDI unchanged
- [x] Semantic OMR metrics unchanged
- [x] No fixture-specific hardcoding

## Artifacts
- `tmp/guitar-mapping-sprint-1/before-metrics.json`
- `tmp/guitar-mapping-sprint-1/after-metrics.json`
- `tmp/guitar-mapping-sprint-1/semantic-before.json` / `semantic-after.json`
- `scripts/guitar-mapping-benchmark.mjs`
