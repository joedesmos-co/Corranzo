#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const data = JSON.parse(
  readFileSync(join(import.meta.dirname, 'high-extreme-semantic-attribution.json'), 'utf8'),
)
const corpus = JSON.parse(
  readFileSync(join(import.meta.dirname, 'baseline-semantic.json'), 'utf8'),
)
const height = 1294
const lines = []

function add(value = '') {
  lines.push(value)
}

function safe(value) {
  return String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function pct(value, digits = 3) {
  return `${(value * 100).toFixed(digits)}%`
}

function anchorSummary(raw) {
  const anchor = raw?.noteheadAnchor
  if (!anchor) return '—'
  const metric = Number.isFinite(anchor.fallbackYNorm)
    ? `metric ${Number(anchor.fallbackYNorm * height).toFixed(1)}px`
    : 'metric —'
  const final = Number.isFinite(anchor.yNorm)
    ? `${anchor.source} ${Number(anchor.yNorm * height).toFixed(1)}px`
    : anchor.source
  return `${metric}; ${final}${anchor.rejectedReason ? `; reject=${anchor.rejectedReason}` : ''}`
}

function accidentalSummary(candidate) {
  if (!candidate) return '—'
  const selected = candidate.accidentalSelected
  const local = candidate.pitchAlteration?.localAccidental
  const carry =
    candidate.inheritedAccidentalState ??
    (local == null ? candidate.pitchAlteration?.measureAccidentalState : null)
  const keyContribution =
    candidate.keySignatureContribution ?? candidate.pitchAlteration?.keyAlteration
  return [
    selected
      ? `selected ${selected.type}@${Number(selected.glyph.x).toFixed(1)},${Number(selected.glyph.y).toFixed(1)} score=${selected.score}`
      : local
        ? `local ${local}`
        : 'no local',
    carry != null ? `carry=${JSON.stringify(carry)}` : null,
    keyContribution != null
      ? `key=${keyContribution}`
      : 'key=0',
  ].filter(Boolean).join('; ')
}

function countBy(rows, keyFn) {
  const result = new Map()
  for (const row of rows) {
    const key = keyFn(row)
    result.set(key, (result.get(key) ?? 0) + 1)
  }
  return [...result.entries()].sort((left, right) => right[1] - left[1])
}

function ledgerFinding(chord) {
  const pitches = chord.expectedPitches
  if (pitches.some((pitch) => /^D6/.test(pitch))) {
    return 'Top D6 sits above two visible ledger rows; adjacent ledger ink does not hide the head.'
  }
  if (pitches.some((pitch) => /^C#?6/.test(pitch))) {
    return 'The upper C6/C#6 head is crossed by its second ledger line.'
  }
  if (pitches.some((pitch) => /^A#?5/.test(pitch))) {
    return 'The upper A5/A#5 head is crossed by the first ledger line.'
  }
  if (pitches.some((pitch) => /^B5/.test(pitch))) {
    return 'B5 is between/above visible ledger rows; ledger ink is adjacent rather than through the body.'
  }
  return 'No ledger row crosses a head in this chord; the top G/G# is immediately above the staff.'
}

add('# High-extreme semantic attribution report')
add()
add('- Starting and final HEAD: `beeb5f066e7bdcb3043df5fa001c92abdadb0088` (`beeb5f0`)')
add('- Evaluator: frozen `2.0.0` / schema `2`; evaluator, fixtures, truth, scoring, and thresholds unchanged')
add('- Production `src/` and `tests/`: clean before attribution and clean after validation')
add('- Decision: **REJECT / LEAVE PRODUCTION UNCHANGED**')
add('- Commit created: none')
add()
add('## Executive finding')
add()
add('The corrected trace proves that the dominant residual is not accidental ownership, voice routing, grouping, or evaluator alignment. **43 of 60 designated high-extreme expected tones first become semantically wrong at staff-position pitch calculation after a rejected glyph-metric anchor.** Every one is an embedded MuseScore SMuFL black notehead (`g_d1_f3`, U+E0A4), remains on treble staff 1 / voice 1 / the correct physical measure and chord column, and quantizes exactly one diatonic step low before any accidental is applied. The 14 tones that stay correct use trusted ink anchors. Only one tone first fails at accidental binding and two at accidental-state carry.')
add()
add('An isolated offline correction of the 43 physical candidates projects high-extreme exact from 25% to 85%, but every general production mechanism that can realize it belongs to a strategy explicitly excluded or previously rejected in this campaign: optical/font center profiles, raster/body recovery, broad stacked ownership, or a hard-coded register/MIDI shift. The independently actionable accidental category projects only 30%, below the 35% acceptance floor. No production experiment was therefore promoted.')
add()
add('## Phase log')
add()
add('1. Verified exact full HEAD and clean production tree; read all eight prerequisite reports in full.')
add('2. Re-ran the frozen 9-fixture semantic baseline before any implementation.')
add('3. Reproduced the dense fixture and captured PDF glyphs, raw note candidates, anchor provenance, natural pitch, accidental candidate/selection/state, final events, MusicXML, and frozen evaluator matching.')
add('4. Rejected the prior inventory join: truth m1 aligns to generated m1+m2, so later truth mN aligns to generated mN+1. The old inventory looked up truth measure geometry first and attached the preceding generated measure. All attribution below uses the actual frozen alignment.')
add('5. Visually rendered and inspected every one of the 15 incorrect designated chords in source measure bands 5-8.')
add('6. Simulated each mutually exclusive first-fault category in isolation without editing the evaluator or production code.')
add('7. Determined that the only gate-clearing category requires prohibited/rejected anchor mechanisms. No runtime/test edit was made, so no revert was necessary.')
add('8. Ran focused tests, the full unit suite, production build, and heavy-score harness on unchanged `beeb5f0`.')
add()
add('## Exact runtime path and 15-stage trace')
add()
add('| # | Stage | Current implementation / retained evidence |')
add('|---:|---|---|')
add('| 1 | PDF glyph/path extraction | `makePdfTextExtractor` and vector operator extraction; `textGlyphsToImage` converts PDF coordinates and retains font/codepoint/origin. |')
add('| 2 | Note candidate creation | `noteheadsForMeasure` creates one candidate per existing U+E0A2-E0A4 glyph; no high-extreme physical candidate is absent. |')
add('| 3 | Notehead anchor resolution | `resolveNoteheadAnchor`; vector metric is `fallbackYNorm`, ledger/ink result is `yNorm` plus `source`, classifier, and reject reason. |')
add('| 4 | Staff/measure assignment | `vectorGlyphInMeasure`, grand-staff role resolution, and generated measure grid; designated tones remain treble/staff 1. |')
add('| 5 | Staff-position pitch | `resolvePitchFromGrandStaff` / `midiFromStaffPosition`; this is the first semantic fault for 43 tones. |')
add('| 6 | Clef/key signature | `resolveNotePitchWithMeasureState`; clef is treble and detected fifths are 0 in the traced measures. |')
add('| 7 | Local accidental detection | `detectVectorPathAccidentals` emits glyph-shaped sharp candidates with path provenance. |')
add('| 8 | Accidental ownership/binding | `assignLocalAccidentals` scores x/y/staff-line proximity; one A5 receives the neighboring F-sharp path. |')
add('| 9 | Accidental-state propagation | Measure-local `accidentalState` keyed by clef + written step/octave; two natural tones inherit a prior sharp in the frozen truth interpretation. |')
add('| 10 | Chord grouping | `groupVectorNoteheads`, beat-slot merge, and chord proximity; all 60 expected physical candidates remain in direct chord events. |')
add('| 11 | Voice assignment | Treble candidates serialize in voice 1; no cross-staff or cross-voice transition occurs. |')
add('| 12 | Rhythm packing/resnap | Dense lane normalization, beam/onset refinement, coalescing, reconstruction, and clamping; designated onsets remain deterministic. |')
add('| 13 | Deduplication/coalescing | Spatial `dedupeNoteheads` and `coalesceSameOnsetChordEvents`; no designated physical candidate is removed or duplicated. |')
add('| 14 | MusicXML creation | `buildOmrMusicXml`; raw candidate IDs are joined to final normalized MusicXML notes by aligned generated measure/onset/staff/MIDI. |')
add('| 15 | Evaluator alignment | `alignMeasureSequences` then `matchSemanticEvents`; alignment confidence 0.9486. It reassigns 24 expected tones to nearby generated onsets and leaves 3 missing, but is downstream of the physical staff-step faults. |')
add()
add('## Frozen baseline reproduced')
add()
add('| Metric | Reproduced value |')
add('|---|---:|')
add(`| Overall | ${pct(corpus.aggregate.meanOverall)} |`)
add(`| Pitch | ${pct(corpus.aggregate.classes.pitch.meanScore)} |`)
add(`| Rhythm | ${pct(corpus.aggregate.classes.rhythm.meanScore)} |`)
add(`| High-extreme exact | ${data.baselineMetrics.exactPercent.toFixed(0)}% (${data.baselineMetrics.exactCount}/${data.baselineMetrics.chordCount}) |`)
add(`| High-extreme missing / extra | ${data.baselineMetrics.missingTones} / ${data.baselineMetrics.extraTones} |`)
add('| Low-extreme exact / missing | 76.47% / 6 |')
add('| Guitar-standard Pitch / Rhythm | 86% / 100% |')
add(`| Global incorrect pitch / chord | ${corpus.aggregate.topDefects.find((item) => item.code === 'incorrect-pitch').count} / ${corpus.aggregate.topDefects.find((item) => item.code === 'incorrect-chord').count} |`)
add(`| Global missing / extra | ${corpus.aggregate.topDefects.find((item) => item.code === 'missing-note').count} / ${corpus.aggregate.topDefects.find((item) => item.code === 'extra-note').count} |`)
add()
add('## Root-cause clusters')
add()
add('| Mutually exclusive first fault | Tones | Chords touched | Perfect isolated projection | Exact gain | Missing delta | Extra delta |')
add('|---|---:|---:|---:|---:|---:|---:|')
for (const [category, count] of Object.entries(data.categoryCounts)) {
  const projection = data.projectedGain.find((item) => item.category === category)
  add(`| ${safe(category)} | ${count.tones} | ${count.chords} | ${projection ? `${projection.exactPercent.toFixed(0)}% (${projection.exactCount}/20)` : 'n/a'} | ${projection ? projection.exactChordGain : '—'} | ${projection ? projection.missingToneDelta : '—'} | ${projection ? projection.extraToneDelta : '—'} |`)
}
add()
add('Counts for the 46 incorrect expected tones:')
add()
add('| Dimension | Counts |')
add('|---|---|')
const incorrect = data.toneInventory.filter((tone) => tone.firstFault.stage != null)
add(`| Failure stage | ${countBy(incorrect, (tone) => `S${tone.firstFault.stage} ${tone.firstFault.stageName}`).map(([key, count]) => `${safe(key)} ×${count}`).join('; ')} |`)
add(`| Pitch class | ${countBy(incorrect, (tone) => tone.expected.label.replace(/\d+$/, '')).map(([key, count]) => `${safe(key)} ×${count}`).join('; ')} |`)
add(`| Octave | ${countBy(incorrect, (tone) => tone.expected.octave).map(([key, count]) => `${safe(key)} ×${count}`).join('; ')} |`)
add(`| Glyph/font | ${countBy(incorrect, (tone) => `${tone.physicalCandidate?.noteheadFont?.fontName}/${tone.physicalCandidate?.sourceGlyph?.codepoint}`).map(([key, count]) => `${safe(key)} ×${count}`).join('; ')} |`)
add(`| Anchor outcome | ${countBy(incorrect, (tone) => `${tone.physicalCandidate?.noteheadAnchor?.source}/${tone.physicalCandidate?.noteheadAnchor?.rejectedReason}`).map(([key, count]) => `${safe(key)} ×${count}`).join('; ')} |`)
add()
add('### Complete expected-tone first-fault inventory (60/60)')
add()
add('| Chord | Rank | Expected | Direct raw/final | PDF glyph and origin | Vector metric; ledger/ink result | Assignment/column | Accidental transition | Frozen evaluator result | First fault |')
add('|---|---:|---|---|---|---|---|---|---|---|')
for (const tone of data.toneInventory) {
  const raw = tone.physicalCandidate
  const evalResult = tone.evaluatorAlignment.generated
    ? `${tone.evaluatorAlignment.generated.label} gM${tone.evaluatorAlignment.generated.measure}@${tone.evaluatorAlignment.generated.onsetQuarters} Δp=${tone.evaluatorAlignment.pitchDeltaSemitones} Δt=${tone.evaluatorAlignment.onsetDifferenceQuarters}`
    : 'missing'
  add(`| ${safe(`m${tone.truthMeasure}@${tone.truthEventOnset}`)} | ${tone.chordRankLowToHigh} | ${safe(`${tone.expected.label} (${tone.expected.midi}; nat ${tone.expected.naturalMidi}; alt ${tone.expected.accidentalAlter}; dur ${tone.expected.durationQuarters})`)} | ${safe(raw ? `${raw.rawId}: ${raw.naturalMidi}→${raw.finalMidi}` : 'absent')} | ${safe(raw ? `${raw.sourceGlyphId} ${raw.sourceGlyph?.fontName}/${raw.sourceGlyph?.codepoint} @${Number(raw.originalGlyphOrigin.x).toFixed(1)},${Number(raw.originalGlyphOrigin.y).toFixed(1)}` : '—')} | ${safe(anchorSummary(raw))} | ${safe(raw ? `gM${tone.generatedMeasure}; treble/s1/v${raw.voiceAssignment}; event ${raw.chordColumnOwnership.eventIndex} x=${Number(raw.chordColumnOwnership.eventCx).toFixed(1)}` : '—')} | ${safe(accidentalSummary(raw))} | ${safe(evalResult)} | ${safe(tone.firstFault.stage == null ? 'correct' : `S${tone.firstFault.stage} ${tone.firstFault.category}`)} |`)
}
add()
add('### Complete produced-tone inventory contributing to the 20 frozen chord records (58/58)')
add()
add('| Chord | Produced tone | Generated location | Raw source | Glyph/anchor | Accidental | Evaluator ownership | First fault relative to printed tone |')
add('|---|---|---|---|---|---|---|---|')
for (const produced of data.producedToneInventory) {
  const raw = produced.sourceTrace
  const ownership = produced.evaluatorResult === 'matched'
    ? `${produced.matchedTruthLabel} truth@${produced.matchedTruthOnset}`
    : 'extra/unmatched'
  add(`| ${safe(produced.chordId.replace('truth-', ''))} | ${safe(`${produced.label} (${produced.midi})`)} | ${safe(`gM${produced.measure}@${produced.onsetQuarters}; dur ${produced.durationQuarters}; s${produced.staff}/v${produced.voice}`)} | ${safe(raw ? `${raw.rawId}: nat ${raw.naturalMidi}→${raw.finalMidi}` : '—')} | ${safe(raw ? `${raw.sourceGlyphId}; ${anchorSummary(raw)}` : '—')} | ${safe(accidentalSummary(raw))} | ${safe(ownership)} | ${safe(`S${produced.firstFaultRelativeToPrintedTone.stage ?? '—'} ${produced.firstFaultRelativeToPrintedTone.category}`)} |`)
}
add()
add('The machine-readable inventory `high-extreme-semantic-attribution.json` retains every considered accidental candidate, selected/rejected attachment, raw and final coordinates, full pitch-alteration state, per-stage existence flags, transition flags, and evaluator IDs without truncating table cells.')
add()
add('## Visual verification of all 15 incorrect chords')
add()
add('The source PDF was rendered at 1000 px page width and reviewed both as a full page and as enlarged measure 5-8 bands. The paired truth interpretation is visually supported in every listed chord. All are treble-clef, staff 1, voice 1, three distinct filled heads with upward stems; no cross-staff notes, opposing voices, or displaced seconds occur. Sharps are local to individual printed tones, not whole-chord symbols.')
add()
add('| Chord | Source x | Printed notes | Printed accidentals | Ledger/head relation | Other visual ownership | Corpus supported |')
add('|---|---:|---|---|---|---|---|')
for (const chord of data.chordInventory.filter((chord) => !chord.exact)) {
  const sharpTones = chord.expectedPitches.filter((pitch) => pitch.includes('#'))
  add(`| m${chord.truthMeasure}@${chord.onset} | ${Number(chord.directPhysicalEvent?.cx).toFixed(1)} | ${safe(chord.expectedPitches.join(' '))} | ${safe(sharpTones.length ? `sharp on ${sharpTones.join(', ')}` : 'none')} | ${safe(ledgerFinding(chord))} | Distinct origins; one treble voice; no displaced second/cross-staff ownership. | yes |`)
}
add()
add('## Selected root cause')
add()
add('The exact dominant transition is:')
add()
add('`PDF U+E0A4 glyph exists` → `candidate exists` → `ink/ledger body rejects` → `glyph-metrics-fallback` → **`midiFromStaffPosition` chooses the adjacent lower diatonic step** → accidental processing continues from that already-wrong natural pitch.')
add()
add('For all 43 tones, the delta is one written staff step: D→C, E→D, F→E, G→F, A→G, or B→A. Semitone deltas are -1 or -2 only because diatonic step sizes differ. The font family and glyph are constant; 39 reject as `no-head-sized-component`, four as `component-outside-font-origin-range`. This is not an octave error, wrong clef, wrong staff, missing candidate, chord merge, or evaluator-only error.')
add()
add('## Alternatives rejected')
add()
add('- Accidental binding: one first-fault tone; perfect correction reaches 30%, below the gate.')
add('- Accidental-state carry: two tones; removes two missing/two extra but yields no new exact chord in isolation.')
add('- Evaluator alignment: downstream re-pairing is real (24 nearby-onset reassignments), but the direct physical candidates are already wrong at stage 5. Evaluator changes are frozen and prohibited.')
add('- Staff/clef/voice/measure/chord ownership: trace shows the candidates survive with the correct ownership; changing those semantics would not address the first fault.')
add('- Raster, broad component/fragment recovery, broad stacked ownership, and optical-center profiles: explicitly out of scope and already rejected by preceding campaigns.')
add('- Uniform register or MIDI shifting: would hard-code a symptom and violates the global MIDI-window / song-specific correction constraints.')
add()
add('## Production change and tests')
add()
add('No production or test file was changed. No focused production test was added because the only gate-clearing mechanism is excluded; adding a test for an unimplemented or prohibited behavior would not back a production fix. Diagnostic scripts and JSON remain under `tmp/` only and are not commit candidates.')
add()
add('| Validation | Result |')
add('|---|---|')
add('| Focused anchor/ledger/accidental/extreme/rhythm tests | PASS: 6 files, 81 tests |')
add('| High-extreme fixture and attribution | PASS/reproduced: 20 chords, 25% exact, 23 missing, 21 extra |')
add('| Frozen semantic corpus | PASS: 9/9; evaluator 2.0.0/schema 2 |')
add('| Low-extreme and Guitar-standard gates | unchanged: 76.47% / missing 6; 86% Pitch / 100% Rhythm |')
add('| Full OMR, Guitar/TAB, microphone, playback/audio, ownership/switching, report/export, and full unit suite | PASS: 282 files; 2,852 passed; 5 skipped |')
add('| Production build | PASS; existing chunk-size advisory only |')
add('| Heavy-score performance harness | PASS: 802 notes/49 measures; cold parse 38.13 ms; visual groups 3.97 ms; cache hit true; all relative assertions true |')
add()
add('## Before/after and acceptance decision')
add()
add('| Metric | Before | After accepted production |')
add('|---|---:|---:|')
add('| High-extreme exact | 25% | 25% (unchanged) |')
add('| High-extreme missing / extra | 23 / 21 | 23 / 21 |')
add(`| Overall | ${pct(corpus.aggregate.meanOverall)} | ${pct(corpus.aggregate.meanOverall)} |`)
add(`| Pitch / Rhythm | ${pct(corpus.aggregate.classes.pitch.meanScore)} / ${pct(corpus.aggregate.classes.rhythm.meanScore)} | same |`)
add('| Low-extreme exact / missing | 76.47% / 6 | same |')
add('| Guitar-standard Pitch / Rhythm | 86% / 100% | same |')
add()
add('**Decision: REVERT/REJECT.** There were no production/test edits to revert. The working tree remains production-clean at exact `beeb5f066e7bdcb3043df5fa001c92abdadb0088`; no commit was created.')
add()
add('## Next blocker')
add()
add('The next blocker is a safe, newly authorized source of optical-center/staff-step evidence for embedded SMuFL heads when trusted ink anchoring rejects. It must be materially different from the rejected fixed optical profiles, raster recovery, and broad stacked ownership, and must independently clear the semantic gate. Accidental-state work should remain secondary until that dominant natural-step fault is resolved.')
add()

process.stdout.write(lines.join('\n'))
