# Guitar Pitch Sprint 1 — Stage-1 sounding pitch provenance

## Preconditions accepted
- **Pitch Research Spike 6**: frozen as completed **no-ship** research. Production raster chord separation unchanged.
- **Pitch Sprint 4** remains the prior accepted corpus baseline (Overall 60.3%, Pitch 53.0%, …, `piano-articulation-scan` Pitch 29%).
- Evaluator frozen (`2.0.0` / schema `2`).
- No work on ActiveScore, raster chord separation, AdSense, playback realism, or unrelated UI.

## Status
**ACCEPTED and frozen (2026-07-26).** Stage-1 sounding-pitch provenance is locked.
Follow-on work: **Guitar Mapping Sprint 1** (stage-2 string/fret playability) — does not modify these fixes.

## Stage separation
1. **Frozen here:** standard-notation OMR → emitted MusicXML pitch (stage 1).
2. **Mapping sprint:** sounding MIDI → playable string/fret assignment (stage 2).

## Guitar-only pitch taxonomy (pre-fix RCA)

| Fixture | Pitch | Dominant incorrect buckets | Notes |
| --- | ---: | --- | --- |
| guitar-techniques-paired-vector | 72% | accidental ×2 | Frets already matched pitch 30/32 |
| guitar-paired-chords-vector | 31% | one-step ×16, accidental ×9, larger ×5 | Frets often matched **truth** while MusicXML pitch did not (50/102 fret↔midi consistent) |
| guitar-standard-chords-vector | 2% | larger-interval ×27, octave ×5 | Internal staff midis already matched truth chord tones; MusicXML was systematically −12 |
| guitar-tab-sparse-vector | 70% | small residual | TAB-only; fret↔midi already consistent |

### Trace conclusion (representative errors)
PDF → staff geometry → treble clef → notehead center → staff degree → internal MIDI was often **already correct** for notation-only guitar.

Dominant root cause was **not** false grand staff, wrong treble anchor, or fret optimization:
1. **Double 8vb on MusicXML emission** — `buildOmrMusicXml` subtracted `writtenOctaveOffset * 12` even though `midiFromStaffPosition` already yields concert/sounding MIDI (matches TAB + CC0 truth).
2. **TAB pairing dropped sounding pitch** — `mergeCombinedNote` set `soundingPitch: true` and frets but left `midi` as (often wrong) notation MIDI instead of `tabMidi`, contradicting the pairing module contract.

Also verified: every guitar fixture with `grandStaff: false` stays single-staff through system grouping, MusicXML emission (no `<staves>` / `<staff>`), semantic eval, and fretboard mapping. Clef still emits `<clef-octave-change>-1</clef-octave-change>` for display.

Not fixed here (remain after sprint):
- Measure splits / missing+extra chord tones on dense guitar pages
- Residual staff-position / accidental errors on unpaired or mispaired heads
- Spurious tie marks on `guitar-standard-chords-vector` (pre-existing; newly visible after pitch pairing)

## Fix (smallest general recognition change)
1. `buildOmrMusicXml.js` — keep guitar clef octave-change; **do not** re-apply `writtenOctaveOffset` to `<pitch>`.
2. `pairNotationTabEvents.js` — when notation↔TAB pair succeeds, set `midi = tabMidi` (retain `notationMidi` for diagnostics).

No fixture/measure/pitch hardcoding. No tie/articulation detector changes. No merge/staff-line retunes. Evaluator untouched.

## Corpus scoreboard (Pitch Sprint 4 → Guitar Pitch Sprint 1)

| Class | Before | After | Δ |
| --- | ---: | ---: | ---: |
| Overall | 60.3% | 60.0% | −0.3 |
| Pitch | 53.0% | 58.4% | **+5.3** |
| Rhythm | 64.4% | 65.2% | +0.7 |
| Sustain/Tie | 57.8% | 46.7% | −11.1† |
| Articulation | 83.9% | 83.9% | 0.0 |
| Measure structure | 62.9% | 66.1% | +3.2 |

† **Sustain exposure only** on `guitar-standard-chords-vector`: before den **0** (vacuous 100%), after den **2** with 0 TP / 2 incorrect-tie FP. Truth has **0** ties; gen still emits 4 spurious ties (untouched detector). Sustain **TP unchanged** (still 0 on that fixture; piano Sustain TP unchanged). Articulation TP unchanged on all fixtures.

### Guitar Pitch

| Fixture | Before | After | Δ |
| --- | ---: | ---: | ---: |
| guitar-techniques-paired-vector | 72% | **78%** | +5.6 |
| guitar-paired-chords-vector | 31% | **48%** | +17.5 |
| guitar-standard-chords-vector | 2% | **27%** | +25.0 |
| guitar-tab-sparse-vector | 70% | 70% | 0 |
| **Guitar-only mean** | **43.9%** | **55.9%** | **+12.0** |

### Piano fixtures
All unchanged (beginner 94%, grand 62%, tuplets 91%, artic-scan 29%, dense 27%; Sustain/Articulation TP unchanged).

### Defect rollups
| Code | Before | After | Δ |
| --- | ---: | ---: | ---: |
| incorrect-pitch | 212 | 172 | −40 |
| missing-note | 238 | 216 | −22 |
| extra-note | 227 | 205 | −22 |

### Incorrect-pitch buckets (after, guitar)
| Fixture | accidental | one-step | small | larger | octave |
| --- | ---: | ---: | ---: | ---: | ---: |
| techniques | 0 | 0 | 0 | 0 | 0 |
| paired-chords | 0 | 5 | 2 | 0 | 0 |
| standard-chords | 7 | 3 | 1 | 8 | 1 |
| tab-sparse | 1 | 0 | 2 | 1 | 0 |

Larger-interval / octave mass on standard-chords collapsed vs Sprint 4 taxonomy (27 larger + 5 octave → 8 + 1).

## Fret-mapping audit (stage 2 report only — not optimized)

| Fixture | Fret rows | MIDI matches fret | Same-string conflicts | Large position jumps (≥5 frets) |
| --- | ---: | ---: | ---: | ---: |
| tab-sparse | 40 | 40/40 | 0 | 4 |
| paired-chords | 102 | **102/102** (was 50/102) | 0 | (see JSON) |
| techniques | 32 | **32/32** | 0 | 0 |
| standard-chords | 0 | n/a (notation-only) | 0 | n/a |

After stage-1 fix, paired/techniques frets are consistent with emitted MIDI. Remaining fret issues are jump size / musical playability, not MIDI↔fret disagreement. No fret optimizer changes.

## Acceptance
- [x] Guitar Pitch improves measurably (mean +12.0 pp; paired +17.5; standard +25.0; techniques +5.6)
- [x] Piano fixtures unchanged
- [x] No Sustain TP loss (exposure only)
- [x] No Articulation TP loss
- [x] Class drop >1 pp explained (Sustain den 0→2 on standard-chords)
- [x] Evaluator untouched
- [x] No fixture/measure/pitch hardcoding
- [x] `grandStaff: false` remains single-staff end-to-end

## Artifacts
- `tmp/guitar-pitch-sprint-1/before.json` (Pitch Sprint 4 copy)
- `tmp/guitar-pitch-sprint-1/after.json`
- `tmp/guitar-pitch-sprint-1/guitar-taxonomy.json`
- `tmp/guitar-pitch-sprint-1/*.after.omr.musicxml`
- Spike 6 freeze: `tmp/pitch-spike-6/REPORT.md`
