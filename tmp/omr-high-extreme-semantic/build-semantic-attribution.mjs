#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { parseMusicXml } from '../../src/features/musicxml/parseMusicXml.js'
import {
  normalizeSemanticNotes,
} from '../../src/features/omr/semanticMusicXmlEvaluator.js'
import {
  resolveSemanticEvalOptions,
} from '../../src/features/omr/semanticEvalTolerances.js'
import {
  alignMeasureSequences,
  buildMeasureFingerprint,
} from '../../src/features/omr/semanticMeasureAlignment.js'
import { matchSemanticEvents } from '../../src/features/omr/semanticEventMatching.js'
import { midiToWrittenPitch } from '../../src/features/omr/pitchFromStaffPosition.js'

const root = resolve(import.meta.dirname, '../..')
const trace = JSON.parse(
  readFileSync(join(import.meta.dirname, 'dense-current-stage-trace.json'), 'utf8'),
)
const truthPath = join(
  root,
  'benchmarks/omr-fixtures/piano-dense-advanced-vector/piano-dense-advanced-vector.musicxml',
)
const generatedPath = join(import.meta.dirname, 'dense-current.musicxml')
const outputPath = join(import.meta.dirname, 'high-extreme-semantic-attribution.json')
const options = resolveSemanticEvalOptions({ mode: 'written' })
const frozenRegisterInventory = JSON.parse(
  readFileSync(join(root, 'tmp/omr-high-extreme/high_extreme_inventory_full.json'), 'utf8'),
)
const designatedHighChords = new Set(
  (frozenRegisterInventory.chords ?? [])
    .filter(
      (chord) =>
        chord.fixture === 'piano-dense-advanced-vector' &&
        chord.registerBin === 'high-extreme',
    )
    .map((chord) => `${chord.measure}|${chord.staff}|${chord.onset}`),
)

const truthTiming = parseMusicXml(readFileSync(truthPath, 'utf8'), truthPath)
const generatedTiming = parseMusicXml(readFileSync(generatedPath, 'utf8'), generatedPath)
const truthNotes = normalizeSemanticNotes(truthTiming, options).filter((note) => !note.isRest)
const generatedNotes = normalizeSemanticNotes(generatedTiming, options).filter(
  (note) => !note.isRest,
)

function label(midi) {
  if (!Number.isFinite(midi)) return null
  const pitch = midiToWrittenPitch(midi)
  return `${pitch.step}${pitch.alter ? '#' : ''}${pitch.octave}`
}

function naturalMidi(note) {
  if (!Number.isFinite(note?.midi)) return null
  if (String(note.label ?? '').includes('#')) return note.midi - 1
  if (String(note.label ?? '').includes('b')) return note.midi + 1
  return note.midi
}

function groupNotesByMeasure(notes, measures) {
  const byNumber = new Map(measures.map((measure, index) => [measure.number, index]))
  const byIndex = new Map(measures.map((_, index) => [index, []]))
  for (const note of notes) {
    const index = byNumber.get(note.measureNumber)
    if (index != null) byIndex.get(index).push(note)
  }
  return byIndex
}

const truthByIndex = groupNotesByMeasure(truthNotes, truthTiming.measures)
const generatedByIndex = groupNotesByMeasure(generatedNotes, generatedTiming.measures)
const alignment = alignMeasureSequences(
  truthTiming.measures.map((measure, index) =>
    buildMeasureFingerprint(measure, truthByIndex.get(index) ?? []),
  ),
  generatedTiming.measures.map((measure, index) =>
    buildMeasureFingerprint(measure, generatedByIndex.get(index) ?? []),
  ),
  options,
)

const traceMeasures = new Map(
  trace.captures.flatMap((capture) => capture.measures).map((measure) => [measure.measureNumber, measure]),
)
const alignmentByTruthMeasure = new Map()
for (const pair of alignment.pairs ?? []) {
  if (pair.kind !== 'match') continue
  alignmentByTruthMeasure.set(pair.truthMeasureNumbers[0], pair.generatedMeasureNumbers[0])
}

function finalTrebleEvent(measureNumber, onset) {
  const measure = traceMeasures.get(measureNumber)
  return measure?.finalEvents.find(
    (event) =>
      event.type === 'note' &&
      Math.abs(event.onsetQuarters - onset) < 1e-6 &&
      event.notes.some((note) => note.clef === 'treble'),
  ) ?? null
}

function rawCandidate(rawId) {
  if (!rawId) return null
  const measureNumber = Number(/^m(\d+)-/.exec(rawId)?.[1])
  return traceMeasures.get(measureNumber)?.rawCandidates.find((note) => note.rawId === rawId) ?? null
}

function generatedSemanticContext(note) {
  const event = finalTrebleEvent(note.measureNumber, note.onsetQuarters)
  const candidates = (event?.notes ?? []).filter(
    (entry) => entry.midi === note.midi && (entry.clef === 'bass' ? 2 : 1) === note.staff,
  )
  const selected = candidates[0] ?? null
  return {
    event,
    finalNote: selected,
    raw: rawCandidate(selected?.rawId),
  }
}

function accidentalTrace(measureNumber, rawId) {
  const measure = traceMeasures.get(measureNumber)
  const rawIndex = Number(/-raw-(\d+)$/.exec(rawId ?? '')?.[1])
  const diagnostics = measure?.accidentalDiagnostics ?? {}
  return {
    considered: (diagnostics.detectedCandidates ?? []).filter(
      (candidate) => candidate.noteIndex === rawIndex,
    ),
    selected: (diagnostics.selectedAttachments ?? []).find(
      (candidate) => candidate.noteIndex === rawIndex,
    ) ?? null,
    pathInk: diagnostics.pathInk ?? null,
  }
}

function finalStaffStep(raw) {
  if (!Number.isFinite(raw?.naturalMidi)) return null
  const pitch = midiToWrittenPitch(raw.naturalMidi)
  return `${pitch.step}${pitch.octave}`
}

function classifyPhysicalTone(expected, generatedMeasure, direct, raw) {
  if (!direct || !raw) {
    return {
      stage: 2,
      stageName: 'note candidate creation',
      category: 'note candidate never created',
      evidence: 'No direct-onset generated candidate exists at this vertical chord rank.',
    }
  }
  if (!raw.sourceGlyphId) {
    return {
      stage: 1,
      stageName: 'PDF glyph/path extraction',
      category: 'source glyph not retained',
      evidence: `${raw.rawId} has no extracted PDF notehead glyph identity.`,
    }
  }
  const expectedNatural = naturalMidi(expected)
  if (raw.naturalMidi !== expectedNatural) {
    const delta = raw.naturalMidi - expectedNatural
    return {
      stage: 5,
      mechanismStage: 3,
      stageName: 'staff-position pitch calculation',
      mechanismStageName: 'notehead anchor resolution',
      category: 'wrong staff-step quantization',
      evidence:
        `${raw.rawId} survives extraction/creation/assignment, but anchor ${raw.noteheadAnchor?.source} ` +
        `quantizes ${label(expectedNatural)} as ${label(raw.naturalMidi)} (${delta > 0 ? '+' : ''}${delta} semitones) ` +
        `before key or accidental processing.`,
    }
  }
  const expectedAlter = expected.midi - expectedNatural
  const actualAlter = raw.finalMidi - raw.naturalMidi
  if (actualAlter !== expectedAlter) {
    const alteration = raw.pitchAlteration ?? {}
    if (alteration.localAccidental != null) {
      return {
        stage: 8,
        stageName: 'accidental ownership/binding',
        category: 'accidental detected but bound to wrong tone',
        evidence:
          `${raw.rawId} has the correct natural staff step, then receives local ${alteration.localAccidental} ` +
          `(${actualAlter}) where the printed/truth alteration is ${expectedAlter}.`,
      }
    }
    if (alteration.measureAccidentalState != null) {
      return {
        stage: 9,
        stageName: 'accidental-state propagation',
        category: 'accidental state incorrectly inherited',
        evidence:
          `${raw.rawId} has the correct natural staff step and no local accidental, then inherits ` +
          `${JSON.stringify(alteration.measureAccidentalState)} producing alteration ${actualAlter} instead of ${expectedAlter}.`,
      }
    }
    if (alteration.keyAlteration != null) {
      return {
        stage: 6,
        stageName: 'clef/key-signature application',
        category: 'key signature applied incorrectly',
        evidence: `${raw.rawId} receives key alteration ${alteration.keyAlteration} instead of ${expectedAlter}.`,
      }
    }
    return {
      stage: 7,
      stageName: 'local accidental detection',
      category: 'local accidental not detected',
      evidence: `${raw.rawId} stays natural although the printed/truth alteration is ${expectedAlter}.`,
    }
  }
  return {
    stage: null,
    stageName: 'none',
    category: 'correct through final MusicXML',
    evidence: `${raw.rawId} retains the expected staff step and alteration through MusicXML creation.`,
  }
}

function truthChordKey(note) {
  const onsetBucket = Math.round(
    note.onsetQuarters / Math.max(options.chordOnsetToleranceQuarters, 0.01),
  )
  return `${note.staff ?? 1}|${note.rawVoice ?? note.voice ?? 1}|${onsetBucket}`
}

function matchForAlignment(pair, generatedOverride = null) {
  const truth = truthByIndex.get(pair.truthIndexes[0]) ?? []
  const generated = generatedOverride ?? generatedByIndex.get(pair.generatedIndexes[0]) ?? []
  return matchSemanticEvents(truth, generated, options)
}

function chordBuckets(pair, matched) {
  const buckets = new Map()
  const ensure = (key) => {
    if (!buckets.has(key)) buckets.set(key, { truth: [], generated: [], matches: [] })
    return buckets.get(key)
  }
  for (const match of matched.matches) {
    const bucket = ensure(truthChordKey(match.truth))
    bucket.truth.push(match.truth)
    bucket.generated.push(match.generated)
    bucket.matches.push(match)
  }
  for (const note of matched.missing) ensure(truthChordKey(note)).truth.push(note)
  for (const note of matched.extra) ensure(truthChordKey(note)).generated.push(note)
  return buckets
}

function multisetDiff(expected, generated) {
  const consumed = new Set()
  const missing = []
  for (const midi of expected) {
    const index = generated.findIndex(
      (candidate, candidateIndex) => candidate === midi && !consumed.has(candidateIndex),
    )
    if (index < 0) missing.push(midi)
    else consumed.add(index)
  }
  return {
    missing,
    extra: generated.filter((_, index) => !consumed.has(index)),
  }
}

const toneInventory = []
const chordInventory = []
const physicalCorrectionByCategory = new Map()

for (const pair of alignment.pairs ?? []) {
  if (pair.kind !== 'match') continue
  const truthMeasure = pair.truthMeasureNumbers[0]
  const generatedMeasure = pair.generatedMeasureNumbers[0]
  const matched = matchForAlignment(pair)
  const buckets = chordBuckets(pair, matched)

  for (const bucket of buckets.values()) {
    const truthChord = [...bucket.truth].sort((left, right) => left.midi - right.midi)
    if (
      truthChord.length < 2 ||
      !designatedHighChords.has(
        `${truthMeasure}|${truthChord[0]?.staff ?? 1}|${truthChord[0]?.onsetQuarters}`,
      )
    ) continue
    const onset = truthChord[0].onsetQuarters
    const directEvent = finalTrebleEvent(generatedMeasure, onset)
    const directNotes = [...(directEvent?.notes ?? [])]
      .filter((note) => note.clef === 'treble')
      .sort((left, right) => left.naturalMidi - right.naturalMidi)
    const expectedMidis = truthChord.map((note) => note.midi)
    const generatedMidis = bucket.generated.map((note) => note.midi).sort((a, b) => a - b)
    const exact =
      expectedMidis.length === generatedMidis.length &&
      expectedMidis.every((midi, index) => midi === generatedMidis[index])
    const diff = multisetDiff(expectedMidis, generatedMidis)
    const chordId = `truth-m${truthMeasure}-o${onset}`
    const chordToneRows = []

    for (let rank = 0; rank < truthChord.length; rank += 1) {
      const expected = truthChord[rank]
      const direct = directNotes[rank] ?? null
      const raw = rawCandidate(direct?.rawId)
      const firstFault = classifyPhysicalTone(expected, generatedMeasure, direct, raw)
      const evaluatorMatch = matched.matches.find((entry) => entry.truth.id === expected.id) ?? null
      const evaluatorGenerated = evaluatorMatch?.generated ?? null
      const evaluatorContext = evaluatorGenerated
        ? generatedSemanticContext(evaluatorGenerated)
        : null
      const accidental = raw ? accidentalTrace(generatedMeasure, raw.rawId) : null
      const row = {
        chordId,
        page: trace.captures[0]?.page ?? 1,
        system: traceMeasures.get(generatedMeasure)?.systemIndex ?? null,
        staff: expected.staff,
        truthMeasure,
        generatedMeasure,
        truthEventOnset: onset,
        chordRankLowToHigh: rank,
        expected: {
          id: expected.id,
          midi: expected.midi,
          pitchClass: ((expected.midi % 12) + 12) % 12,
          octave: Math.floor(expected.midi / 12) - 1,
          label: expected.label,
          naturalMidi: naturalMidi(expected),
          accidentalAlter: expected.midi - naturalMidi(expected),
          onsetQuarters: expected.onsetQuarters,
          durationQuarters: expected.durationQuarters,
          staff: expected.staff,
          voice: expected.rawVoice ?? expected.voice,
        },
        physicalCandidate: raw
          ? {
              ...raw,
              finalStaffStep: finalStaffStep(raw),
              rawDiatonicPitchBeforeAccidental: label(raw.naturalMidi),
              staffAssignment: raw.clef === 'bass' ? 2 : 1,
              voiceAssignment: direct?.voice ?? raw.voice ?? 1,
              measureAssignment: generatedMeasure,
              accidentalCandidatesConsidered: accidental.considered,
              accidentalSelected: accidental.selected,
              inheritedAccidentalState:
                raw.pitchAlteration?.localAccidental == null
                  ? raw.pitchAlteration?.measureAccidentalState ?? null
                  : null,
              keySignatureContribution: raw.pitchAlteration?.keyAlteration ?? null,
              octaveRegisterCorrectionApplied: false,
              chordColumnOwnership: {
                eventIndex: directEvent?.eventIndex ?? null,
                eventCx: directEvent?.cx ?? null,
                chordColumnId: directEvent?.chordColumnId ?? null,
              },
            }
          : null,
        evaluatorAlignment: evaluatorMatch
          ? {
              generated: {
                id: evaluatorGenerated.id,
                midi: evaluatorGenerated.midi,
                label: evaluatorGenerated.label,
                measure: evaluatorGenerated.measureNumber,
                onsetQuarters: evaluatorGenerated.onsetQuarters,
                durationQuarters: evaluatorGenerated.durationQuarters,
                staff: evaluatorGenerated.staff,
                voice: evaluatorGenerated.rawVoice ?? evaluatorGenerated.voice,
                rawId: evaluatorContext?.finalNote?.rawId ?? null,
              },
              onsetDifferenceQuarters: evaluatorMatch.onsetDiffQuarters,
              pitchDeltaSemitones: evaluatorMatch.pitchDeltaSemitones,
              onsetCorrect: evaluatorMatch.onsetCorrect,
              pitchCorrect: evaluatorMatch.pitchCorrect,
            }
          : {
              generated: null,
              result: 'missing-after-evaluator-alignment',
            },
        existenceByStage: {
          pdfGlyphExtraction: Boolean(raw?.sourceGlyphId),
          noteCandidateCreation: Boolean(raw),
          noteheadAnchorResolution: Boolean(raw?.noteheadAnchor),
          staffAndMeasureAssignment: Boolean(raw),
          staffPositionPitchCalculation: Number.isFinite(raw?.naturalMidi),
          clefAndKeySignature: Boolean(raw?.pitchAlteration),
          localAccidentalDetection: Boolean(accidental),
          accidentalOwnershipBinding: Boolean(accidental),
          accidentalStatePropagation: Boolean(raw?.pitchAlteration),
          chordGrouping: Boolean(directEvent),
          voiceAssignment: Boolean(directEvent),
          rhythmPackingResnap: Boolean(directEvent),
          deduplicationCoalescing: Boolean(directEvent),
          finalMusicXmlCreation: Boolean(
            generatedNotes.find(
              (note) =>
                note.measureNumber === generatedMeasure &&
                Math.abs(note.onsetQuarters - onset) < 1e-6 &&
                note.midi === direct?.midi &&
                note.staff === expected.staff,
            ),
          ),
          evaluatorAlignment: Boolean(evaluatorMatch),
        },
        transition: {
          removed: false,
          merged: false,
          duplicated: false,
          shifted: Boolean(raw && raw.naturalMidi !== naturalMidi(expected)),
          reassigned: Boolean(
            evaluatorGenerated &&
              (evaluatorGenerated.measureNumber !== generatedMeasure ||
                Math.abs(evaluatorGenerated.onsetQuarters - onset) > 1e-6),
          ),
        },
        firstFault,
      }
      toneInventory.push(row)
      chordToneRows.push(row)
      if (firstFault.stage != null) {
        if (!physicalCorrectionByCategory.has(firstFault.category)) {
          physicalCorrectionByCategory.set(firstFault.category, new Map())
        }
        // Correction projections operate on the direct physical candidate, not
        // on the evaluator-selected (possibly adjacent-onset) surrogate.
        const directSemantic = generatedNotes.find(
          (note) =>
            note.measureNumber === generatedMeasure &&
            Math.abs(note.onsetQuarters - onset) < 1e-6 &&
            note.midi === direct?.midi &&
            note.staff === expected.staff,
        )
        if (directSemantic) {
          physicalCorrectionByCategory
            .get(firstFault.category)
            .set(directSemantic.id, expected.midi)
        }
      }
    }

    chordInventory.push({
      chordId,
      truthMeasure,
      generatedMeasure,
      onset,
      expectedPitches: expectedMidis.map(label),
      generatedPitches: generatedMidis.map(label),
      expectedMidis,
      generatedMidis,
      exact,
      missingTones: diff.missing.map(label),
      extraTones: diff.extra.map(label),
      directPhysicalEvent: directEvent,
      evaluatorProduced: bucket.generated.map((note) => {
        const context = generatedSemanticContext(note)
        const paired = bucket.matches.find((match) => match.generated.id === note.id) ?? null
        return {
          id: note.id,
          midi: note.midi,
          label: note.label,
          pitchClass: ((note.midi % 12) + 12) % 12,
          octave: Math.floor(note.midi / 12) - 1,
          measure: note.measureNumber,
          onsetQuarters: note.onsetQuarters,
          durationQuarters: note.durationQuarters,
          staff: note.staff,
          voice: note.rawVoice ?? note.voice,
          rawId: context.finalNote?.rawId ?? null,
          matchedTruthId: paired?.truth?.id ?? null,
          matchedTruthLabel: paired?.truth?.label ?? null,
          matchedTruthOnset: paired?.truth?.onsetQuarters ?? null,
          evaluatorResult: paired ? 'matched' : 'extra',
        }
      }),
      firstFaultCategories: [...new Set(chordToneRows.map((row) => row.firstFault.category))],
    })
  }
}

function highChordMetrics(chords) {
  return {
    chordCount: chords.length,
    exactCount: chords.filter((chord) => chord.exact).length,
    exactPercent: (100 * chords.filter((chord) => chord.exact).length) / Math.max(1, chords.length),
    missingTones: chords.reduce((sum, chord) => sum + chord.missingTones.length, 0),
    extraTones: chords.reduce((sum, chord) => sum + chord.extraTones.length, 0),
  }
}

function projectedChords(category, corrections) {
  const output = []
  for (const pair of alignment.pairs ?? []) {
    if (pair.kind !== 'match') continue
    const generated = (generatedByIndex.get(pair.generatedIndexes[0]) ?? []).map((note) =>
      corrections.has(note.id) ? { ...note, midi: corrections.get(note.id), label: label(corrections.get(note.id)) } : note,
    )
    const matched = matchForAlignment(pair, generated)
    const truthMeasure = pair.truthMeasureNumbers[0]
    for (const bucket of chordBuckets(pair, matched).values()) {
      const truthChord = [...bucket.truth].sort((left, right) => left.midi - right.midi)
      if (
        truthChord.length < 2 ||
        !designatedHighChords.has(
          `${truthMeasure}|${truthChord[0]?.staff ?? 1}|${truthChord[0]?.onsetQuarters}`,
        )
      ) continue
      const expectedMidis = truthChord.map((note) => note.midi)
      const generatedMidis = bucket.generated.map((note) => note.midi).sort((a, b) => a - b)
      const diff = multisetDiff(expectedMidis, generatedMidis)
      output.push({
        category,
        exact:
          expectedMidis.length === generatedMidis.length &&
          expectedMidis.every((midi, index) => midi === generatedMidis[index]),
        missingTones: diff.missing.map(label),
        extraTones: diff.extra.map(label),
      })
    }
  }
  return output
}

const baselineMetrics = highChordMetrics(chordInventory)
const expectedToneById = new Map(toneInventory.map((tone) => [tone.expected.id, tone]))
const producedToneInventory = chordInventory.flatMap((chord) =>
  chord.evaluatorProduced.map((produced) => {
    const context = generatedNotes.find((note) => note.id === produced.id)
      ? generatedSemanticContext(generatedNotes.find((note) => note.id === produced.id))
      : null
    const pairedExpected = produced.matchedTruthId
      ? expectedToneById.get(produced.matchedTruthId) ?? null
      : null
    const accidental = context?.raw
      ? accidentalTrace(produced.measure, context.raw.rawId)
      : null
    return {
      chordId: chord.chordId,
      ...produced,
      sourceTrace: context?.raw
        ? {
            ...context.raw,
            finalStaffStep: finalStaffStep(context.raw),
            rawDiatonicPitchBeforeAccidental: label(context.raw.naturalMidi),
            accidentalCandidatesConsidered: accidental?.considered ?? [],
            accidentalSelected: accidental?.selected ?? null,
            chordColumnOwnership: {
              eventIndex: context.event?.eventIndex ?? null,
              eventCx: context.event?.cx ?? null,
              chordColumnId: context.event?.chordColumnId ?? null,
            },
          }
        : null,
      firstFaultRelativeToPrintedTone: pairedExpected?.firstFault ?? {
        stage: 15,
        stageName: 'evaluator alignment',
        category: 'unmatched produced tone',
        evidence: `${produced.id} reaches MusicXML but has no truth counterpart after frozen alignment.`,
      },
    }
  }),
)
const categoryCounts = {}
for (const tone of toneInventory) {
  const category = tone.firstFault.category
  if (!categoryCounts[category]) categoryCounts[category] = { tones: 0, chords: new Set() }
  categoryCounts[category].tones += 1
  categoryCounts[category].chords.add(tone.chordId)
}

const projectedGain = []
for (const [category, corrections] of physicalCorrectionByCategory) {
  const metrics = highChordMetrics(projectedChords(category, corrections))
  projectedGain.push({
    category,
    correctedPhysicalCandidates: corrections.size,
    ...metrics,
    exactChordGain: metrics.exactCount - baselineMetrics.exactCount,
    missingToneDelta: metrics.missingTones - baselineMetrics.missingTones,
    extraToneDelta: metrics.extraTones - baselineMetrics.extraTones,
  })
}
projectedGain.sort((left, right) => right.exactChordGain - left.exactChordGain)

const serializableCounts = Object.fromEntries(
  Object.entries(categoryCounts).map(([category, count]) => [
    category,
    { tones: count.tones, chords: count.chords.size },
  ]),
)

writeFileSync(
  outputPath,
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      evaluator: { version: '2.0.0', schema: 2, options },
      alignment,
      baselineMetrics,
      categoryCounts: serializableCounts,
      projectedGain,
      chordInventory,
      toneInventory,
      producedToneInventory,
    },
    null,
    2,
  ),
)

process.stdout.write(`${outputPath}\n`)
