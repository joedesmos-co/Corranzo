#!/usr/bin/env node

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeSemanticNotes,
} from '../../src/features/omr/semanticMusicXmlEvaluator.js'
import { resolveSemanticEvalOptions } from '../../src/features/omr/semanticEvalTolerances.js'
import {
  alignMeasureSequences,
  buildMeasureFingerprint,
} from '../../src/features/omr/semanticMeasureAlignment.js'
import { matchSemanticEvents } from '../../src/features/omr/semanticEventMatching.js'
import { parseMusicXml } from '../../src/features/musicxml/parseMusicXml.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const GENERATED = join(HERE, 'head-ledger/generated')
const DETAILED = JSON.parse(readFileSync(join(HERE, 'head-ledger/error_inventory.json'), 'utf8'))
const BASELINE = JSON.parse(readFileSync(join(HERE, 'revalidate-head.json'), 'utf8'))
const HIGH_EXTREME = JSON.parse(
  readFileSync(join(ROOT, 'tmp/omr-autonomous/final-register/high_extreme_inventory.json'), 'utf8'),
)
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'benchmarks/omr-benchmark.manifest.json'), 'utf8'))
const OPTIONS = resolveSemanticEvalOptions({ mode: 'written' })

function noteFields(note) {
  if (!note) return null
  return {
    id: note.id ?? null,
    midi: note.midi ?? null,
    label: note.label ?? null,
    onsetQuarters: note.onsetQuarters ?? null,
    durationQuarters: note.durationQuarters ?? null,
    voice: note.rawVoice ?? note.voice ?? null,
    canonicalVoice: note.voice ?? null,
    staff: note.staff ?? null,
    isRest: Boolean(note.isRest),
    isChord: Boolean(note.isChord),
    tieStart: Boolean(note.tieStart),
    tieStop: Boolean(note.tieStop),
    slurStart: Boolean(note.slurStart),
    dots: note.dots ?? 0,
    accidental: note.accidental ?? null,
    stemDirection: note.stemDirection ?? null,
    beams: note.beams ?? null,
    staccato: Boolean(note.staccato),
    accent: Boolean(note.accent),
    tenuto: Boolean(note.tenuto),
    marcato: Boolean(note.marcato),
    timeModification: note.timeModification ?? null,
  }
}

function groupByMeasureIndex(notes, measures) {
  const byIndex = new Map(measures.map((_, index) => [index, []]))
  const byNumber = new Map(measures.map((measure, index) => [measure.number, index]))
  for (const note of notes) {
    const index = byNumber.get(note.measureNumber)
    if (index != null) byIndex.get(index).push(note)
  }
  return byIndex
}

function rebaseOnsets(notes, measureIndexes, measures) {
  if (!notes.length || measureIndexes.length <= 1) return notes
  const baseStart = measures[measureIndexes[0]]?.startQuarters ?? 0
  return notes.map((note) => {
    const measure = measures.find((entry) => entry.number === note.measureNumber)
    const absolute = (measure?.startQuarters ?? 0) + note.onsetQuarters
    return { ...note, onsetQuarters: absolute - baseStart }
  })
}

function dottedDuration(quarters, dots = 0) {
  if (dots > 0) return true
  return [4, 2, 1, 0.5, 0.25, 0.125].some(
    (base) => Math.abs(quarters - base * 1.5) < 1e-6,
  )
}

function bucket(note) {
  const onset = Math.round(
    note.onsetQuarters / Math.max(OPTIONS.chordOnsetToleranceQuarters, 0.01),
  )
  return `${note.staff ?? 1}|${note.voice}|${onset}`
}

function chordExamples(matched) {
  const groups = new Map()
  const extras = new Map()
  const get = (key) => {
    if (!groups.has(key)) groups.set(key, { truth: [], generated: [] })
    return groups.get(key)
  }
  for (const pair of matched.matches) {
    if (pair.truth.isRest) continue
    const group = get(bucket(pair.truth))
    group.truth.push(pair.truth)
    group.generated.push(pair.generated)
  }
  for (const note of matched.missing) {
    if (!note.isRest) get(bucket(note)).truth.push(note)
  }
  for (const note of matched.extra) {
    if (note.isRest) continue
    const key = bucket(note)
    if (!extras.has(key)) extras.set(key, [])
    extras.get(key).push(note)
    get(key)
  }
  const rows = []
  for (const [key, group] of groups) {
    const generated = [...group.generated, ...(extras.get(key) ?? [])]
    const truthMidis = group.truth.map((note) => note.midi).sort((a, b) => a - b)
    const generatedMidis = generated.map((note) => note.midi).sort((a, b) => a - b)
    if (truthMidis.length < 2 && generatedMidis.length < 2) continue
    const exact = truthMidis.length === generatedMidis.length &&
      truthMidis.every((midi, index) => midi === generatedMidis[index])
    if (!exact) {
      rows.push({
        key,
        expectedChordMidis: truthMidis,
        generatedChordMidis: generatedMidis,
        expectedChordNotes: group.truth.map(noteFields),
        generatedChordNotes: generated.map(noteFields),
        expected: noteFields(group.truth[0]),
        generated: noteFields(generated[0]),
        onsetQuarters: group.truth[0]?.onsetQuarters ?? generated[0]?.onsetQuarters ?? null,
        staff: group.truth[0]?.staff ?? generated[0]?.staff ?? null,
        voice: group.truth[0]?.rawVoice ?? group.truth[0]?.voice ??
          generated[0]?.rawVoice ?? generated[0]?.voice ?? null,
      })
    }
  }
  return rows
}

function traceFixture(fixtureId, truthXml, generatedXml) {
  const truthMap = parseMusicXml(truthXml, `${fixtureId}.truth.musicxml`)
  const generatedMap = parseMusicXml(generatedXml, `${fixtureId}.generated.musicxml`)
  const truthNotes = normalizeSemanticNotes(truthMap)
  const generatedNotes = normalizeSemanticNotes(generatedMap)
  const truthMeasures = truthMap.measures ?? []
  const generatedMeasures = generatedMap.measures ?? []
  const truthByIndex = groupByMeasureIndex(truthNotes, truthMeasures)
  const generatedByIndex = groupByMeasureIndex(generatedNotes, generatedMeasures)
  const alignment = alignMeasureSequences(
    truthMeasures.map((measure, index) =>
      buildMeasureFingerprint(measure, truthByIndex.get(index) ?? [])),
    generatedMeasures.map((measure, index) =>
      buildMeasureFingerprint(measure, generatedByIndex.get(index) ?? [])),
    OPTIONS,
  )
  const rows = []
  const push = (measure, code, semanticClass, details = {}) => rows.push({
    fixture: fixtureId,
    measure,
    code,
    class: semanticClass,
    ...details,
  })

  for (const pair of alignment.pairs) {
    const truthNumbers = pair.truthMeasureNumbers.filter((value) => value != null)
    const generatedNumbers = pair.generatedMeasureNumbers.filter((value) => value != null)
    const measure = truthNumbers[0] ?? generatedNumbers[0] ?? null
    if (pair.kind === 'missing') {
      push(measure, 'missing-measure', 'measure-structure', { alignment: pair.kind })
      for (const index of pair.truthIndexes) {
        for (const note of truthByIndex.get(index) ?? []) {
          if (!note.isRest) push(measure, 'missing-note', 'pitch', { expected: noteFields(note) })
        }
      }
      continue
    }
    if (pair.kind === 'extra') {
      push(measure, 'extra-measure', 'measure-structure', { alignment: pair.kind })
      for (const index of pair.generatedIndexes) {
        for (const note of generatedByIndex.get(index) ?? []) {
          if (!note.isRest) push(measure, 'extra-note', 'pitch', { generated: noteFields(note) })
        }
      }
      continue
    }
    if (pair.kind === 'split') push(measure, 'split-measure', 'measure-structure', { alignment: pair.kind })
    if (pair.kind === 'merge') push(measure, 'merged-measure', 'measure-structure', { alignment: pair.kind })

    const truth = rebaseOnsets(
      pair.truthIndexes.flatMap((index) => truthByIndex.get(index) ?? []),
      pair.truthIndexes,
      truthMeasures,
    )
    const generated = rebaseOnsets(
      pair.generatedIndexes.flatMap((index) => generatedByIndex.get(index) ?? []),
      pair.generatedIndexes,
      generatedMeasures,
    )
    const matched = matchSemanticEvents(truth, generated, OPTIONS)
    for (const note of matched.missing) {
      push(measure, note.isRest ? 'missing-rest' : 'missing-note', note.isRest ? 'rhythm' : 'pitch', {
        expected: noteFields(note),
      })
    }
    for (const note of matched.extra) {
      push(measure, note.isRest ? 'extra-rest' : 'extra-note', note.isRest ? 'rhythm' : 'pitch', {
        generated: noteFields(note),
      })
    }
    for (const match of matched.matches) {
      const common = {
        expected: noteFields(match.truth),
        generated: noteFields(match.generated),
        pitchDeltaSemitones: match.pitchDeltaSemitones,
        onsetDiffQuarters: match.onsetDiffQuarters,
        durationDiffQuarters: match.durationDiffQuarters,
      }
      if (match.truth.isRest) continue
      if (!match.pitchCorrect) push(measure, 'incorrect-pitch', 'pitch', common)
      if (!match.durationCorrect) {
        const code = match.truth.dots > 0 && match.generated.dots === 0 &&
          !dottedDuration(match.generated.durationQuarters, match.generated.dots)
          ? 'missing-dot'
          : dottedDuration(match.truth.durationQuarters, match.truth.dots)
            ? 'dotted-rhythm-error'
            : 'duration-mismatch'
        push(measure, code, 'rhythm', common)
      }
      if (!match.onsetCorrect) push(measure, 'onset-mismatch', 'rhythm', common)
      const truthTuplet = match.truth.timeModification
        ? `${match.truth.timeModification.actualNotes}:${match.truth.timeModification.normalNotes}`
        : null
      const generatedTuplet = match.generated.timeModification
        ? `${match.generated.timeModification.actualNotes}:${match.generated.timeModification.normalNotes}`
        : null
      if ((truthTuplet || generatedTuplet) && truthTuplet !== generatedTuplet) {
        push(measure, 'tuplet-mismatch', 'rhythm', common)
      }
      const truthTie = Boolean(match.truth.tieStart || match.truth.tieStop)
      const generatedTie = Boolean(match.generated.tieStart || match.generated.tieStop)
      if (truthTie || generatedTie) {
        const exactTie = Boolean(match.truth.tieStart) === Boolean(match.generated.tieStart) &&
          Boolean(match.truth.tieStop) === Boolean(match.generated.tieStop)
        if (!exactTie) {
          const code = truthTie && !generatedTie
            ? match.generated.slurStart ? 'tie-vs-slur-confusion' : 'missing-tie'
            : 'incorrect-tie'
          push(measure, code, 'sustain', common)
        }
      }
      for (const [field, code] of [
        ['staccato', 'missing-staccato'],
        ['accent', 'missing-accent'],
        ['tenuto', 'missing-tenuto'],
        ['marcato', 'missing-marcato'],
      ]) {
        if (Boolean(match.truth[field]) !== Boolean(match.generated[field])) {
          push(measure, code, 'articulation', common)
        }
      }
    }

    const byStaff = (notes) => {
      const map = new Map()
      for (const note of notes.filter((entry) => !entry.isRest)) {
        const staff = note.staff ?? 1
        if (!map.has(staff)) map.set(staff, { voices: new Set(), midis: [] })
        map.get(staff).voices.add(note.voice ?? 1)
        map.get(staff).midis.push(note.midi)
      }
      return map
    }
    const truthStaff = byStaff(truth)
    const generatedStaff = byStaff(generated)
    for (const [staff, truthLane] of truthStaff) {
      const generatedLane = generatedStaff.get(staff)
      if (!generatedLane) continue
      const truthMidis = [...truthLane.midis].sort((a, b) => a - b).join(',')
      const generatedMidis = [...generatedLane.midis].sort((a, b) => a - b).join(',')
      if (truthMidis === generatedMidis && truthLane.voices.size !== generatedLane.voices.size) {
        push(measure, 'voice-mismatch', 'measure-structure', { staff })
      }
    }
    for (const chord of chordExamples(matched)) {
      push(measure, 'incorrect-chord', 'measure-structure', chord)
    }
  }
  return rows
}

function fixtureManifest(id) {
  return MANIFEST.fixtures.find((fixture) => fixture.id === id)
}

function scoreCandidate(official, candidate) {
  if (official.fixture !== candidate.fixture || official.code !== candidate.code || official.measure !== candidate.measure) {
    return -Infinity
  }
  let score = 1
  const expectedMidi = official.expected?.midi
  const generatedMidi = official.generated?.midi
  if (expectedMidi != null && candidate.expected?.midi === expectedMidi) score += 8
  if (generatedMidi != null && candidate.generated?.midi === generatedMidi) score += 8
  if (official.expected?.onsetQuarters != null && candidate.expected?.onsetQuarters != null) {
    score += Math.max(0, 4 - Math.abs(official.expected.onsetQuarters - candidate.expected.onsetQuarters) * 4)
  }
  if (official.generated?.onsetQuarters != null && candidate.generated?.onsetQuarters != null) {
    score += Math.max(0, 4 - Math.abs(official.generated.onsetQuarters - candidate.generated.onsetQuarters) * 4)
  }
  const leftChord = official.expectedChordMidis ?? []
  const rightChord = candidate.expectedChordMidis ?? []
  if (leftChord.length && JSON.stringify(leftChord) === JSON.stringify(rightChord)) score += 12
  return score
}

function assignCandidates(officialRows, candidateRows) {
  const used = new Set()
  return officialRows.map((official) => {
    let bestIndex = -1
    let bestScore = -Infinity
    for (let index = 0; index < candidateRows.length; index += 1) {
      if (used.has(index)) continue
      const score = scoreCandidate(official, candidateRows[index])
      if (score > bestScore) {
        bestIndex = index
        bestScore = score
      }
    }
    if (bestIndex >= 0 && bestScore > -Infinity) {
      used.add(bestIndex)
      return { ...candidateRows[bestIndex], ...official, traceMatched: true }
    }
    return { ...official, traceMatched: false }
  })
}

function rootCause(row, provenance) {
  const stage = provenance?.firstPipelineStageWhereDivergenceAppears?.stage
  if (row.code === 'incorrect-chord') return stage || 'chord-or-upstream-semantic-integrity'
  if (row.code === 'incorrect-pitch') return stage || 'pitch-mapping-or-accidental-state'
  if (row.code === 'missing-note') return 'missing-candidate-or-measure-alignment'
  if (row.code === 'extra-note') return 'duplicate-or-false-candidate'
  if (row.code === 'onset-mismatch') return 'onset-reconstruction-and-rhythm-packing'
  if (row.code === 'duration-mismatch' || row.code === 'missing-dot' || row.code === 'dotted-rhythm-error') {
    return 'duration-inference-and-rhythm-packing'
  }
  if (row.code.includes('tie')) return 'tie-association-and-emission'
  if (row.code.includes('staccato') || row.code.includes('accent')) return 'articulation-instance-recognition'
  if (row.code.includes('measure')) return 'measure-segmentation-and-alignment'
  if (['tempo-mismatch', 'repeat-mismatch', 'volta-mismatch'].includes(row.code)) {
    return 'interpretation-mark-recognition-and-emission'
  }
  if (row.code.includes('rest')) return 'rest-recognition-and-rhythm-placement'
  return stage || 'unclassified-semantic-pipeline'
}

const auditedHighExtreme = HIGH_EXTREME.chords.filter((chord) => !chord.exactPitchSetMatch)
function sourceAudit(row) {
  if (
    row.fixture === 'piano-articulation-scan' &&
    row.code === 'duration-mismatch' &&
    (row.expected?.staff === 2 || row.staff === 2) &&
    row.expected?.durationQuarters === 2 &&
    row.generated?.durationQuarters === 1
  ) {
    return {
      kind: 'scan-filled-bass-half-vs-quarter',
      expectedDurationQuarters: 2,
      generatedDurationQuarters: 1,
      rationale:
        'MusicXML expects bass half notes, but the printed/scanned PDF shows filled, stemmed quarter-note heads. Source-faithful OMR must emit quarters.',
    }
  }
  if (row.fixture !== 'piano-dense-advanced-vector') return null
  return auditedHighExtreme.find((chord) => {
    if (chord.measure !== row.measure) return false
    const onset = row.onsetQuarters ?? row.expected?.onsetQuarters ?? null
    if (onset != null && Math.abs(onset - chord.onset) > 0.09) return false
    if (row.code === 'incorrect-chord') {
      return JSON.stringify(row.expectedChordMidis) === JSON.stringify(chord.expectedMidis) &&
        JSON.stringify(row.generatedChordMidis) === JSON.stringify(chord.generatedMidis)
    }
    if (row.code === 'incorrect-pitch') {
      return chord.expectedMidis.includes(row.expected?.midi) && chord.generatedMidis.includes(row.generated?.midi)
    }
    return false
  }) ?? null
}

const semanticFiles = readdirSync(GENERATED).filter((name) => name.endsWith('.semantic.json')).sort()
const officialRows = []
const tracedRows = []
for (const semanticName of semanticFiles) {
  const fixtureId = semanticName.replace(/\.semantic\.json$/, '')
  const report = JSON.parse(readFileSync(join(GENERATED, semanticName), 'utf8'))
  const truthPath = join(ROOT, 'benchmarks/omr-fixtures', fixtureId, `${fixtureId}.musicxml`)
  const generatedPath = join(GENERATED, `${fixtureId}.musicxml`)
  tracedRows.push(...traceFixture(
    fixtureId,
    readFileSync(truthPath, 'utf8'),
    readFileSync(generatedPath, 'utf8'),
  ))
  for (const measure of report.measures ?? []) {
    for (const defect of measure.defects ?? []) {
      officialRows.push({
        fixture: fixtureId,
        measure: defect.measureNumber ?? measure.measureNumber ?? null,
        code: defect.code,
        class: defect.class,
        message: defect.message,
        truthMeasureNumbers: measure.truthMeasureNumbers ?? [],
        generatedMeasureNumbers: measure.generatedMeasureNumbers ?? [],
        evaluatorAlignment: measure.alignment ?? null,
        evaluatorAlignmentCost: measure.alignmentCost ?? null,
      })
    }
  }
}

const exactRows = assignCandidates(officialRows, tracedRows)
const detailedPool = DETAILED.mismatches ?? []
const enrichedRows = assignCandidates(exactRows, detailedPool)
const sequence = new Map()
const ledger = enrichedRows.map((row) => {
  const audit = sourceAudit(row)
  const sequenceKey = `${row.fixture}|${row.measure}|${row.code}`
  const index = (sequence.get(sequenceKey) ?? 0) + 1
  sequence.set(sequenceKey, index)
  const fixture = fixtureManifest(row.fixture)
  const expectedChord = row.expectedChordMidis ?? row.expectedChord ?? null
  const generatedChord = row.generatedChordMidis ?? row.generatedChord ?? null
  const cluster = rootCause(row, row)
  const confidence = row.firstPipelineStageWhereDivergenceAppears?.confidence ??
    (row.traceMatched ? 0.8 : 0.45)
  const scanDurationTruth = audit?.kind === 'scan-filled-bass-half-vs-quarter'
  const status = audit ? 'benchmark defect' : 'unresolved'
  const classification = audit ? 'C. Benchmark truth defect' : 'A. Production OMR defect'
  const clusterName = scanDurationTruth
    ? 'benchmark-scan-filled-bass-quarter-vs-half'
    : audit
      ? 'benchmark-hidden-natural-cancellation'
      : cluster
  return {
    id: `${row.fixture}:m${row.measure ?? 'x'}:${row.code}:${index}`,
    fixture: row.fixture,
    pdf: fixture?.pdf ?? `benchmarks/omr-fixtures/${row.fixture}/${row.fixture}.pdf`,
    pdf_page: row.page ?? 1,
    system: row.system ?? null,
    staff: row.staff ?? row.expected?.staff ?? row.generated?.staff ?? null,
    measure: row.measure,
    truth_measure_numbers: row.truthMeasureNumbers,
    generated_measure_numbers: row.generatedMeasureNumbers,
    voice: row.voice ?? row.expected?.voice ?? row.generated?.voice ?? null,
    event: row.expected?.id ?? row.generated?.id ?? row.key ?? null,
    expected_result: row.expected ?? (expectedChord ? { chordMidis: expectedChord } : null),
    generated_result: row.generated ?? (generatedChord ? { chordMidis: generatedChord } : null),
    mismatch_categories: [row.code],
    evaluator_message: row.message,
    evaluator_alignment: {
      kind: row.evaluatorAlignment,
      cost: row.evaluatorAlignmentCost,
    },
    expected_pitch: row.expected?.label ?? row.expected?.midi ?? null,
    generated_pitch: row.generated?.label ?? row.generated?.midi ?? null,
    pitch_delta_semitones: row.pitchDeltaSemitones ?? null,
    expected_onset_quarters: row.expected?.onsetQuarters ?? row.onsetQuarters ?? null,
    generated_onset_quarters: row.generated?.onsetQuarters ?? row.onsetQuarters ?? null,
    expected_duration_quarters: row.expected?.durationQuarters ?? null,
    generated_duration_quarters: row.generated?.durationQuarters ?? null,
    expected_chord_midis: expectedChord,
    generated_chord_midis: generatedChord,
    missing_chord_tones: expectedChord && generatedChord
      ? expectedChord.filter((midi) => !generatedChord.includes(midi))
      : null,
    extra_chord_tones: expectedChord && generatedChord
      ? generatedChord.filter((midi) => !expectedChord.includes(midi))
      : null,
    chord_membership: {
      expected: row.expected?.isChord ?? (expectedChord ? true : null),
      generated: row.generated?.isChord ?? (generatedChord ? true : null),
    },
    accidental: {
      expected: row.expected?.accidental ?? null,
      generated: row.generated?.accidental ?? null,
      provenance: row.accidentalProvenance ?? row.pitchProvenance?.alteration ?? null,
    },
    clef: row.activeClef ?? row.pitchProvenance?.clef ?? null,
    key_signature: row.activeKeySignature ?? row.pitchProvenance?.alteration?.keySignatureFifths ?? null,
    measure_accidental_state: row.pitchProvenance?.alteration?.measureAccidentalState ?? null,
    tie_slur_articulation: {
      expected: row.expected ? {
        tieStart: row.expected.tieStart,
        tieStop: row.expected.tieStop,
        slurStart: row.expected.slurStart,
        staccato: row.expected.staccato,
        accent: row.expected.accent,
      } : null,
      generated: row.generated ? {
        tieStart: row.generated.tieStart,
        tieStop: row.generated.tieStop,
        slurStart: row.generated.slurStart,
        staccato: row.generated.staccato,
        accent: row.generated.accent,
      } : null,
    },
    note_candidate_ids: row.noteCandidateIds ?? [],
    glyph_and_path_ids: row.glyphIds ?? [],
    notehead_anchor_source: row.noteheadPathOrGlyphSource ?? row.computedNoteheadCenter?.anchorDiagnostics?.source ?? null,
    staff_assignment: row.staffAssignmentProvenance ?? null,
    ledger_ownership: {
      candidates: row.nearestLedgerLineCandidates ?? [],
      selected_anchor: row.selectedStaffAnchor ?? null,
    },
    chord_column_ownership: row.chordGroupingProvenance ?? null,
    stem_ownership: row.stemOwnership ?? null,
    beam_ownership: row.beamOwnership ?? null,
    rhythm_packing_provenance: row.durationProvenance ?? null,
    final_musicxml_provenance: {
      generated_file: `tmp/omr-zero-defect/head-ledger/generated/${row.fixture}.musicxml`,
      generated_note_id: row.generated?.id ?? null,
      evaluator_version: BASELINE.evaluatorVersion,
      schema_version: BASELINE.schemaVersion,
    },
    first_incorrect_pipeline_stage: row.firstPipelineStageWhereDivergenceAppears ?? {
      stage: cluster,
      rule: 'Official evaluator defect has no unique candidate-level join yet',
      evidence: row.message,
      confidence,
    },
    visual_pdf_evidence: {
      source_pdf: fixture?.pdf ?? null,
      page: row.page ?? 1,
      measure: row.measure,
      inspected: Boolean(audit),
      finding: audit
        ? 'Printed sharp remains in force through the measure; benchmark MusicXML expects an unprinted natural cancellation.'
        : 'Pending source passage audit for this root-cause experiment.',
      research_reference: audit
        ? 'tmp/omr-autonomous/AUTONOMOUS_OMR_CAMPAIGN_REPORT.md'
        : null,
    },
    confidence,
    root_cause_cluster: clusterName,
    benchmark_source_consistency_classification: classification,
    source_audit: scanDurationTruth
      ? {
          expected_by_benchmark: { durationQuarters: audit.expectedDurationQuarters },
          printed_semantics: { durationQuarters: audit.generatedDurationQuarters, notehead: 'filled-stemmed-quarter' },
          rationale: audit.rationale,
        }
      : audit
        ? {
            expected_by_benchmark: audit.expectedPitches,
            printed_semantics: audit.generatedPitches,
            onset_quarters: audit.onset,
            rationale: 'No natural sign is printed; ordinary measure accidental state carries the earlier sharp.',
          }
        : null,
    projected_defects_eliminated_by_root_fix: null,
    status,
  }
})

const byCode = {}
const byCluster = {}
const byStatus = {}
for (const defect of ledger) {
  byCode[defect.mismatch_categories[0]] = (byCode[defect.mismatch_categories[0]] ?? 0) + 1
  byCluster[defect.root_cause_cluster] = (byCluster[defect.root_cause_cluster] ?? 0) + 1
  byStatus[defect.status] = (byStatus[defect.status] ?? 0) + 1
}
for (const defect of ledger) {
  defect.projected_defects_eliminated_by_root_fix = byCluster[defect.root_cause_cluster]
}

const expectedCounts = Object.fromEntries((BASELINE.aggregate.topDefects ?? []).map((row) => [row.code, row.count]))
const expectedTotal = Object.values(expectedCounts).reduce((sum, count) => sum + count, 0)
const countsMatch = Object.keys(expectedCounts).length === Object.keys(byCode).length &&
  Object.entries(expectedCounts).every(([code, count]) => byCode[code] === count)
if (ledger.length !== expectedTotal || !countsMatch) {
  throw new Error(`Ledger integrity mismatch: total=${ledger.length} expectedTotal=${expectedTotal} byCode=${JSON.stringify(byCode)} expected=${JSON.stringify(expectedCounts)}`)
}

const chordRows = ledger.filter((row) => row.mismatch_categories.includes('incorrect-chord'))
const headInventory = JSON.parse(readFileSync(join(HERE, 'head-ledger/error_inventory.json'), 'utf8'))
const uniqueStructuralIncorrectChords = (headInventory.mismatches ?? []).filter((row) => row.code === 'incorrect-chord').length
const payload = {
  schema_version: 2,
  starting_head: '2366c3727d1c0794a57a2b1ef4ff185a7ce7ab29',
  current_head: '45239caf875ab4c0f94ca81d89c03d3cf3e8de59',
  generated_at: new Date().toISOString(),
  evaluator: { version: BASELINE.evaluatorVersion, schema: BASELINE.schemaVersion, unchanged: true },
  corpus_run: 'tmp/omr-zero-defect/revalidate-head.json',
  summary: {
    status: 'head-45239ca-generated',
    total_defects: ledger.length,
    incorrect_pitch: byCode['incorrect-pitch'],
    incorrect_chord: chordRows.length,
    unique_structural_incorrect_chord_events: uniqueStructuralIncorrectChords,
    onset_mismatch: byCode['onset-mismatch'],
    duration_mismatch: byCode['duration-mismatch'],
    missing_note: byCode['missing-note'],
    extra_note: byCode['extra-note'],
    benchmark_truth_defects: byStatus['benchmark defect'] ?? 0,
    unresolved: byStatus.unresolved ?? 0,
  },
  official_defect_counts: byCode,
  status_counts: byStatus,
  root_cause_clusters: Object.entries(byCluster)
    .map(([cluster, count]) => ({ cluster, count }))
    .sort((left, right) => right.count - left.count || left.cluster.localeCompare(right.cluster)),
  incorrect_chord_inventory: chordRows.map((row) => ({
    id: row.id,
    fixture: row.fixture,
    page: row.pdf_page,
    system: row.system,
    staff: row.staff,
    measure: row.measure,
    voice: row.voice,
    onset: row.expected_onset_quarters,
    duration: row.expected_duration_quarters,
    expected_pitch_set: row.expected_chord_midis,
    generated_pitch_set: row.generated_chord_midis,
    missing_tones: row.missing_chord_tones,
    extra_tones: row.extra_chord_tones,
    first_incorrect_stage: row.first_incorrect_pipeline_stage,
    source_pdf_evidence: row.visual_pdf_evidence,
    benchmark_consistency: row.benchmark_source_consistency_classification,
    root_cause_family: row.root_cause_cluster,
    exact_missing_capability: row.root_cause_cluster,
    status: row.status,
  })),
  defects: ledger,
}

writeFileSync(join(HERE, 'DEFECT_LEDGER.json'), `${JSON.stringify(payload, null, 2)}\n`)
console.log(JSON.stringify({
  total: payload.summary.total_defects,
  byCode,
  byStatus,
  rootCauseClusters: payload.root_cause_clusters,
  chordRows: chordRows.length,
  uniqueStructuralChordEvents: payload.summary.unique_structural_incorrect_chord_events,
}, null, 2))
