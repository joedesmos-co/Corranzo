import { parseMusicXml } from '../musicxml/parseMusicXml.js'
import {
  matchMeasureNotes,
  matchMeasureNotesGreedy,
} from './omrMeasureNoteMatching.js'

export const OMR_ACCURACY_SOURCE = {
  STAFF_DETECTION: 'staff-detection',
  MEASURE_ALLOCATION: 'measure-allocation',
  NOTEHEAD_DETECTION: 'notehead-detection',
  PITCH_MAPPING: 'pitch-mapping',
  RHYTHM_INFERENCE: 'rhythm-inference',
  CHORD_GROUPING: 'chord-grouping',
  MIXED: 'mixed',
  NONE: 'no-dominant-error',
}

export const OMR_ACCURACY_DEFAULTS = {
  onsetToleranceQuarters: 0.25,
  durationToleranceQuarters: 0.25,
  timeToleranceSeconds: 0.15,
  matchWindowQuarters: 0.75,
  chordOnsetToleranceQuarters: 0.08,
  worstMeasureCount: 10,
  exampleLimit: 40,
}

const SOURCE_LABELS = {
  [OMR_ACCURACY_SOURCE.STAFF_DETECTION]: 'Staff detection',
  [OMR_ACCURACY_SOURCE.MEASURE_ALLOCATION]: 'Measure allocation',
  [OMR_ACCURACY_SOURCE.NOTEHEAD_DETECTION]: 'Notehead detection',
  [OMR_ACCURACY_SOURCE.PITCH_MAPPING]: 'Pitch mapping',
  [OMR_ACCURACY_SOURCE.RHYTHM_INFERENCE]: 'Rhythm inference',
  [OMR_ACCURACY_SOURCE.CHORD_GROUPING]: 'Chord grouping',
  [OMR_ACCURACY_SOURCE.MIXED]: 'Mixed errors',
  [OMR_ACCURACY_SOURCE.NONE]: 'No dominant error',
}

function round(value, places = 4) {
  if (!Number.isFinite(value)) {
    return null
  }
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}

function ratio(numerator, denominator, emptyValue = 1) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return emptyValue
  }
  return clamp01(numerator / denominator)
}

function pct(value) {
  return `${Math.round(clamp01(value) * 100)}%`
}

function noteLabel(midi) {
  if (midi == null) {
    return 'rest'
  }
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const octave = Math.floor(midi / 12) - 1
  return `${names[((midi % 12) + 12) % 12]}${octave}`
}

function measureByNumber(timingMap) {
  return new Map((timingMap?.measures ?? []).map((measure) => [measure.number, measure]))
}

export function normalizeTimingMapNotes(timingMap) {
  const measures = measureByNumber(timingMap)
  return (timingMap?.notes ?? [])
    .filter((note) => !note.isRest && note.midi != null)
    .map((note, index) => {
      const measure = measures.get(note.measureNumber)
      const measureStart = measure?.startQuarters ?? 0
      const onsetQuarters = Number(note.quarterTime) - measureStart
      const durationQuarters = Number(note.durationQuarters)
      return {
        id: note.id ?? `note-${index}`,
        partId: note.partId ?? null,
        measureNumber: note.measureNumber,
        onsetQuarters: Number.isFinite(onsetQuarters) ? onsetQuarters : 0,
        durationQuarters: Number.isFinite(durationQuarters) ? durationQuarters : 0,
        quarterTime: Number(note.quarterTime),
        timeSeconds: Number(note.timeSeconds),
        durationSeconds: Number(note.durationSeconds),
        midi: note.midi,
        label: note.label ?? noteLabel(note.midi),
        voice: note.voice ?? null,
        isChord: Boolean(note.isChord),
      }
    })
    .sort(
      (left, right) =>
        left.measureNumber - right.measureNumber ||
        left.onsetQuarters - right.onsetQuarters ||
        left.midi - right.midi,
    )
}

function groupByMeasure(notes) {
  const grouped = new Map()
  for (const note of notes) {
    const measureNumber = note.measureNumber
    if (!grouped.has(measureNumber)) {
      grouped.set(measureNumber, [])
    }
    grouped.get(measureNumber).push(note)
  }
  return grouped
}

function compactNote(note) {
  if (!note) {
    return null
  }
  return {
    id: note.id,
    measureNumber: note.measureNumber,
    onsetQuarters: round(note.onsetQuarters, 3),
    durationQuarters: round(note.durationQuarters, 3),
    midi: note.midi,
    label: note.label ?? noteLabel(note.midi),
    partId: note.partId ?? null,
    voice: note.voice ?? null,
  }
}

function compactMismatch(match) {
  return {
    measureNumber: match.truth.measureNumber,
    onsetDiffQuarters: round(match.onsetDiffQuarters, 3),
    timeDiffSeconds: round(match.timeDiffSeconds, 3),
    durationDiffQuarters: round(match.durationDiffQuarters, 3),
    pitchDeltaSemitones: match.pitchDeltaSemitones,
    truth: compactNote(match.truth),
    generated: compactNote(match.generated),
  }
}

function onsetGroups(notes, tolerance) {
  const groups = []
  for (const note of notes) {
    let group = groups.find(
      (entry) => Math.abs(entry.onsetQuarters - note.onsetQuarters) <= tolerance,
    )
    if (!group) {
      group = { onsetQuarters: note.onsetQuarters, notes: [] }
      groups.push(group)
    }
    group.notes.push(note)
    group.onsetQuarters =
      group.notes.reduce((sum, entry) => sum + entry.onsetQuarters, 0) / group.notes.length
  }
  return groups.sort((left, right) => left.onsetQuarters - right.onsetQuarters)
}

function compareChordGroups(truthNotes, generatedNotes, options) {
  const truthGroups = onsetGroups(truthNotes, options.chordOnsetToleranceQuarters)
  const generatedGroups = onsetGroups(generatedNotes, options.chordOnsetToleranceQuarters)
  const usedGenerated = new Set()
  let mismatchCount = 0
  let comparableCount = 0
  const examples = []

  truthGroups.forEach((truthGroup, truthIndex) => {
    let bestIndex = -1
    let bestDiff = Infinity
    generatedGroups.forEach((generatedGroup, generatedIndex) => {
      if (usedGenerated.has(generatedIndex)) {
        return
      }
      const diff = Math.abs(truthGroup.onsetQuarters - generatedGroup.onsetQuarters)
      if (diff < bestDiff) {
        bestDiff = diff
        bestIndex = generatedIndex
      }
    })
    if (bestIndex < 0 || bestDiff > options.matchWindowQuarters) {
      mismatchCount += truthGroup.notes.length
      comparableCount += truthGroup.notes.length
      examples.push({
        measureNumber: truthGroup.notes[0]?.measureNumber ?? null,
        onsetQuarters: round(truthGroup.onsetQuarters, 3),
        truthCount: truthGroup.notes.length,
        generatedCount: 0,
      })
      return
    }

    usedGenerated.add(bestIndex)
    const generatedGroup = generatedGroups[bestIndex]
    const delta = Math.abs(truthGroup.notes.length - generatedGroup.notes.length)
    mismatchCount += delta
    comparableCount += Math.max(truthGroup.notes.length, generatedGroup.notes.length)
    if (delta > 0) {
      examples.push({
        measureNumber: truthGroup.notes[0]?.measureNumber ?? null,
        onsetQuarters: round(truthGroup.onsetQuarters, 3),
        truthCount: truthGroup.notes.length,
        generatedCount: generatedGroup.notes.length,
        truthGroupIndex: truthIndex,
      })
    }
  })

  generatedGroups.forEach((generatedGroup, generatedIndex) => {
    if (usedGenerated.has(generatedIndex)) {
      return
    }
    mismatchCount += generatedGroup.notes.length
    comparableCount += generatedGroup.notes.length
    examples.push({
      measureNumber: generatedGroup.notes[0]?.measureNumber ?? null,
      onsetQuarters: round(generatedGroup.onsetQuarters, 3),
      truthCount: 0,
      generatedCount: generatedGroup.notes.length,
    })
  })

  return {
    mismatchCount,
    comparableCount,
    accuracy: 1 - ratio(mismatchCount, comparableCount, 0),
    examples,
  }
}

function summarizeMeasure({
  measureNumber,
  truthNotes,
  generatedNotes,
  matched,
  missing,
  extra,
  wrongPitches,
  wrongDurations,
  wrongOnsets,
  wrongTimes,
  chordMismatchCount,
}) {
  const errorCount =
    missing.length +
    extra.length +
    wrongPitches.length +
    wrongDurations.length +
    wrongOnsets.length +
    wrongTimes.length +
    chordMismatchCount
  const denominator = Math.max(truthNotes.length, generatedNotes.length, 1)
  return {
    measureNumber,
    truthNoteCount: truthNotes.length,
    generatedNoteCount: generatedNotes.length,
    matchedNoteCount: matched.length,
    missingNoteCount: missing.length,
    extraNoteCount: extra.length,
    wrongPitchCount: wrongPitches.length,
    wrongDurationCount: wrongDurations.length,
    wrongOnsetCount: wrongOnsets.length,
    wrongTimeCount: wrongTimes.length,
    chordMismatchCount,
    errorCount,
    errorRate: round(clamp01(errorCount / denominator), 4),
  }
}

function firstAlignmentBreak(perMeasure) {
  for (const measure of perMeasure) {
    const countBase = Math.max(measure.truthNoteCount, measure.generatedNoteCount, 1)
    const noteDetectionErrors = measure.missingNoteCount + measure.extraNoteCount
    const timingErrors = measure.wrongOnsetCount + measure.wrongDurationCount
    if (
      measure.errorRate >= 0.5 ||
      noteDetectionErrors >= Math.max(2, Math.ceil(countBase * 0.35)) ||
      timingErrors >= Math.max(2, Math.ceil(measure.matchedNoteCount * 0.5))
    ) {
      return {
        measureNumber: measure.measureNumber,
        reason: [
          noteDetectionErrors > 0 ? `missing/extra=${noteDetectionErrors}` : null,
          measure.wrongPitchCount > 0 ? `wrongPitch=${measure.wrongPitchCount}` : null,
          timingErrors > 0 ? `timing=${timingErrors}` : null,
          measure.chordMismatchCount > 0 ? `chord=${measure.chordMismatchCount}` : null,
        ].filter(Boolean).join(', '),
        errorRate: measure.errorRate,
      }
    }
  }
  return null
}

function sourceScores({ metrics, totals, firstBreak, generatedOmrDiagnostics }) {
  const maxNoteCount = Math.max(totals.truthNoteCount, totals.generatedNoteCount, 1)
  const missingExtraRate =
    (totals.missingNoteCount + totals.extraNoteCount) / maxNoteCount
  const wrongPitchRate = totals.wrongPitchCount / Math.max(totals.matchedNoteCount, 1)
  const wrongDurationRate = totals.wrongDurationCount / Math.max(totals.matchedNoteCount, 1)
  const wrongOnsetRate = totals.wrongOnsetCount / Math.max(totals.matchedNoteCount, 1)
  const wrongTimeRate = totals.wrongTimeCount / Math.max(totals.matchedNoteCount, 1)
  const noteCountDeltaRate = Math.abs(totals.noteCountDifference) / maxNoteCount
  const measureDeltaRate = Math.abs(totals.measureCountDifference) / Math.max(totals.truthMeasureCount, 1)
  const pages = Number(generatedOmrDiagnostics?.pages)
  const pagesWithSystems = Number(generatedOmrDiagnostics?.pagesWithSystems)
  const systems = Number(generatedOmrDiagnostics?.systems)
  const staffDetectionPenalty =
    Number.isFinite(pages) && pages > 0 && Number.isFinite(pagesWithSystems)
      ? 1 - pagesWithSystems / pages
      : 0
  const noSystemsPenalty = Number.isFinite(systems) && systems <= 0 ? 1 : 0

  return {
    [OMR_ACCURACY_SOURCE.STAFF_DETECTION]: clamp01(
      Math.max(noSystemsPenalty, staffDetectionPenalty) * 0.9,
    ),
    [OMR_ACCURACY_SOURCE.MEASURE_ALLOCATION]: clamp01(
      measureDeltaRate * 1.1 +
        (firstBreak ? 0.22 : 0) +
        Math.max(0, missingExtraRate - noteCountDeltaRate) * 0.45 +
        Math.max(0, 0.8 - Math.max(metrics.onsetAccuracy, metrics.timeAccuracy)) * 0.25,
    ),
    [OMR_ACCURACY_SOURCE.NOTEHEAD_DETECTION]: clamp01(
      missingExtraRate * 0.55 + noteCountDeltaRate * 0.8,
    ),
    [OMR_ACCURACY_SOURCE.PITCH_MAPPING]: clamp01(wrongPitchRate * 0.95),
    [OMR_ACCURACY_SOURCE.RHYTHM_INFERENCE]: clamp01(
      Math.max(wrongDurationRate, wrongOnsetRate, wrongTimeRate) * 0.9,
    ),
    [OMR_ACCURACY_SOURCE.CHORD_GROUPING]: clamp01(
      (1 - metrics.chordGroupingAccuracy) * 0.9,
    ),
  }
}

function identifyPrimaryErrorSource({ metrics, totals, firstBreak, generatedOmrDiagnostics }) {
  const scores = sourceScores({ metrics, totals, firstBreak, generatedOmrDiagnostics })
  const ordered = Object.entries(scores).sort((left, right) => right[1] - left[1])
  const [source, score] = ordered[0] ?? [OMR_ACCURACY_SOURCE.NONE, 0]
  const close = ordered.filter(([, value]) => score > 0 && value >= score - 0.08)
  const selected =
    score < 0.12
      ? OMR_ACCURACY_SOURCE.NONE
      : close.length > 1 && close[1][1] >= 0.2
        ? OMR_ACCURACY_SOURCE.MIXED
        : source

  const evidence = [
    `pitch=${pct(metrics.pitchAccuracy)}`,
    `duration=${pct(metrics.durationAccuracy)}`,
    `onset=${pct(metrics.onsetAccuracy)}`,
    `time=${pct(metrics.timeAccuracy)}`,
    `noteDetectionF1=${pct(metrics.noteDetectionF1)}`,
    `measureCountAccuracy=${pct(metrics.measureCountAccuracy)}`,
  ]
  if (firstBreak) {
    evidence.push(`firstBreak=m${firstBreak.measureNumber} (${firstBreak.reason})`)
  }
  if (totals.noteCountDifference !== 0) {
    evidence.push(`noteCountDifference=${totals.noteCountDifference}`)
  }
  if (totals.measureCountDifference !== 0) {
    evidence.push(`measureCountDifference=${totals.measureCountDifference}`)
  }

  return {
    source: selected,
    label: SOURCE_LABELS[selected],
    confidence: round(selected === OMR_ACCURACY_SOURCE.NONE ? 1 - score : score, 3),
    scores: Object.fromEntries(
      Object.entries(scores).map(([key, value]) => [key, round(value, 4)]),
    ),
    evidence,
  }
}

export function evaluateOmrAccuracy({
  generatedMusicXml,
  groundTruthMusicXml,
  generatedFileName = 'generated.omr.musicxml',
  groundTruthFileName = 'ground-truth.musicxml',
  generatedOmrDiagnostics = null,
  options = {},
} = {}) {
  if (!generatedMusicXml || !groundTruthMusicXml) {
    throw new Error('OMR accuracy evaluation requires generated and ground-truth MusicXML.')
  }
  return evaluateOmrAccuracyFromTimingMaps({
    generatedTimingMap: parseMusicXml(generatedMusicXml, generatedFileName),
    groundTruthTimingMap: parseMusicXml(groundTruthMusicXml, groundTruthFileName),
    generatedOmrDiagnostics,
    options,
  })
}

export function evaluateOmrAccuracyFromTimingMaps({
  generatedTimingMap,
  groundTruthTimingMap,
  generatedOmrDiagnostics = null,
  options = {},
} = {}) {
  const resolvedOptions = { ...OMR_ACCURACY_DEFAULTS, ...options }
  const truthNotes = normalizeTimingMapNotes(groundTruthTimingMap)
  const generatedNotes = normalizeTimingMapNotes(generatedTimingMap)
  const truthByMeasure = groupByMeasure(truthNotes)
  const generatedByMeasure = groupByMeasure(generatedNotes)
  const truthMeasureNumbers = (groundTruthTimingMap?.measures ?? []).map((measure) => measure.number)
  const generatedMeasureNumbers = (generatedTimingMap?.measures ?? []).map((measure) => measure.number)
  const measureNumbers = [...new Set([...truthMeasureNumbers, ...generatedMeasureNumbers])]
    .filter((number) => Number.isFinite(number))
    .sort((left, right) => left - right)

  const totals = {
    truthMeasureCount: truthMeasureNumbers.length,
    generatedMeasureCount: generatedMeasureNumbers.length,
    measureCountDifference: generatedMeasureNumbers.length - truthMeasureNumbers.length,
    truthNoteCount: truthNotes.length,
    generatedNoteCount: generatedNotes.length,
    noteCountDifference: generatedNotes.length - truthNotes.length,
    matchedNoteCount: 0,
    correctPitchCount: 0,
    correctDurationCount: 0,
    correctOnsetCount: 0,
    correctTimeCount: 0,
    missingNoteCount: 0,
    extraNoteCount: 0,
    wrongPitchCount: 0,
    wrongDurationCount: 0,
    wrongOnsetCount: 0,
    wrongTimeCount: 0,
    chordMismatchCount: 0,
    chordComparableCount: 0,
    greedyCorrectPitchCount: 0,
    pitchCorrectAtCorrectOnsetCount: 0,
    onsetCorrectMatchedCount: 0,
  }

  const missingNotes = []
  const extraNotes = []
  const wrongPitches = []
  const wrongDurations = []
  const wrongOnsets = []
  const wrongTimes = []
  const chordGroupMismatches = []
  const perMeasure = []

  for (const measureNumber of measureNumbers) {
    const truthMeasureNotes = truthByMeasure.get(measureNumber) ?? []
    const generatedMeasureNotes = generatedByMeasure.get(measureNumber) ?? []
    const matched = matchMeasureNotes(truthMeasureNotes, generatedMeasureNotes, resolvedOptions)
    const greedyMatched = matchMeasureNotesGreedy(
      truthMeasureNotes,
      generatedMeasureNotes,
      resolvedOptions,
    )
    const chordGroups = compareChordGroups(
      truthMeasureNotes,
      generatedMeasureNotes,
      resolvedOptions,
    )
    const wrongPitchMatches = matched.matches.filter((match) => !match.pitchCorrect)
    const wrongDurationMatches = matched.matches.filter((match) => !match.durationCorrect)
    const wrongOnsetMatches = matched.matches.filter((match) => !match.onsetCorrect)
    const wrongTimeMatches = matched.matches.filter((match) => !match.timeCorrect)

    totals.matchedNoteCount += matched.matches.length
    totals.correctPitchCount += matched.matches.filter((match) => match.pitchCorrect).length
    totals.greedyCorrectPitchCount += greedyMatched.matches.filter((match) => match.pitchCorrect).length
    for (const match of matched.matches) {
      if (!match.onsetCorrect) {
        continue
      }
      totals.onsetCorrectMatchedCount += 1
      if (match.pitchCorrect) {
        totals.pitchCorrectAtCorrectOnsetCount += 1
      }
    }
    totals.correctDurationCount += matched.matches.filter((match) => match.durationCorrect).length
    totals.correctOnsetCount += matched.matches.filter((match) => match.onsetCorrect).length
    totals.correctTimeCount += matched.matches.filter((match) => match.timeCorrect).length
    totals.missingNoteCount += matched.missing.length
    totals.extraNoteCount += matched.extra.length
    totals.wrongPitchCount += wrongPitchMatches.length
    totals.wrongDurationCount += wrongDurationMatches.length
    totals.wrongOnsetCount += wrongOnsetMatches.length
    totals.wrongTimeCount += wrongTimeMatches.length
    totals.chordMismatchCount += chordGroups.mismatchCount
    totals.chordComparableCount += chordGroups.comparableCount

    missingNotes.push(...matched.missing.map(compactNote))
    extraNotes.push(...matched.extra.map(compactNote))
    wrongPitches.push(...wrongPitchMatches.map(compactMismatch))
    wrongDurations.push(...wrongDurationMatches.map(compactMismatch))
    wrongOnsets.push(...wrongOnsetMatches.map(compactMismatch))
    wrongTimes.push(...wrongTimeMatches.map(compactMismatch))
    chordGroupMismatches.push(...chordGroups.examples)

    perMeasure.push(
      summarizeMeasure({
        measureNumber,
        truthNotes: truthMeasureNotes,
        generatedNotes: generatedMeasureNotes,
        matched: matched.matches,
        missing: matched.missing,
        extra: matched.extra,
        wrongPitches: wrongPitchMatches,
        wrongDurations: wrongDurationMatches,
        wrongOnsets: wrongOnsetMatches,
        wrongTimes: wrongTimeMatches,
        chordMismatchCount: chordGroups.mismatchCount,
      }),
    )
  }

  const comparisonDenominator = Math.max(
    totals.truthNoteCount,
    totals.generatedNoteCount,
    1,
  )
  const noteDetectionPrecision = ratio(totals.matchedNoteCount, totals.generatedNoteCount)
  const noteDetectionRecall = ratio(totals.matchedNoteCount, totals.truthNoteCount)
  const noteDetectionF1 =
    noteDetectionPrecision + noteDetectionRecall > 0
      ? (2 * noteDetectionPrecision * noteDetectionRecall) /
        (noteDetectionPrecision + noteDetectionRecall)
      : 0
  const metrics = {
    pitchAccuracy: round(totals.correctPitchCount / comparisonDenominator, 4),
    matchedPitchAccuracy: round(ratio(totals.correctPitchCount, totals.matchedNoteCount), 4),
    durationAccuracy: round(totals.correctDurationCount / comparisonDenominator, 4),
    matchedDurationAccuracy: round(ratio(totals.correctDurationCount, totals.matchedNoteCount), 4),
    onsetAccuracy: round(totals.correctOnsetCount / comparisonDenominator, 4),
    matchedOnsetAccuracy: round(ratio(totals.correctOnsetCount, totals.matchedNoteCount), 4),
    timeAccuracy: round(totals.correctTimeCount / comparisonDenominator, 4),
    matchedTimeAccuracy: round(ratio(totals.correctTimeCount, totals.matchedNoteCount), 4),
    measureCountAccuracy: round(
      1 -
        Math.abs(totals.measureCountDifference) /
          Math.max(totals.truthMeasureCount, totals.generatedMeasureCount, 1),
      4,
    ),
    noteDetectionPrecision: round(noteDetectionPrecision, 4),
    noteDetectionRecall: round(noteDetectionRecall, 4),
    noteDetectionF1: round(noteDetectionF1, 4),
    chordGroupingAccuracy: round(
      1 - ratio(totals.chordMismatchCount, totals.chordComparableCount, 0),
      4,
    ),
    pitchAccuracyAtCorrectOnset: round(
      ratio(totals.pitchCorrectAtCorrectOnsetCount, totals.onsetCorrectMatchedCount, 0),
      4,
    ),
    orderSensitivePitchRecovery: round(
      (totals.correctPitchCount - totals.greedyCorrectPitchCount) / comparisonDenominator,
      4,
    ),
  }

  const firstBreak = firstAlignmentBreak(perMeasure)
  const worstMeasures = [...perMeasure]
    .sort(
      (left, right) =>
        right.errorRate - left.errorRate ||
        right.errorCount - left.errorCount ||
        left.measureNumber - right.measureNumber,
    )
    .slice(0, resolvedOptions.worstMeasureCount)
  const primaryErrorSource = identifyPrimaryErrorSource({
    metrics,
    totals,
    firstBreak,
    generatedOmrDiagnostics,
  })

  const limit = resolvedOptions.exampleLimit
  return {
    version: 1,
    summary: {
      generatedTitle: generatedTimingMap?.title ?? generatedTimingMap?.fileName ?? null,
      groundTruthTitle: groundTruthTimingMap?.title ?? groundTruthTimingMap?.fileName ?? null,
      primaryErrorSource,
      firstAlignmentBreak: firstBreak,
    },
    metrics,
    totals,
    worstMeasures,
    perMeasure,
    debug: {
      missingNotes: missingNotes.slice(0, limit),
      extraNotes: extraNotes.slice(0, limit),
      wrongPitches: wrongPitches.slice(0, limit),
      wrongDurations: wrongDurations.slice(0, limit),
      wrongOnsets: wrongOnsets.slice(0, limit),
      wrongTimes: wrongTimes.slice(0, limit),
      chordGroupMismatches: chordGroupMismatches.slice(0, limit),
      truncated: {
        missingNotes: Math.max(0, missingNotes.length - limit),
        extraNotes: Math.max(0, extraNotes.length - limit),
        wrongPitches: Math.max(0, wrongPitches.length - limit),
        wrongDurations: Math.max(0, wrongDurations.length - limit),
        wrongOnsets: Math.max(0, wrongOnsets.length - limit),
        wrongTimes: Math.max(0, wrongTimes.length - limit),
        chordGroupMismatches: Math.max(0, chordGroupMismatches.length - limit),
      },
    },
    options: resolvedOptions,
    generatedOmrDiagnostics,
  }
}

function metricLine(label, value) {
  return `${label}: ${pct(value)}`
}

function examplesLine(label, examples, formatter) {
  if (!examples?.length) {
    return `${label}: none`
  }
  return `${label}: ${examples.slice(0, 5).map(formatter).join('; ')}`
}

export function formatOmrAccuracyReport(report) {
  if (!report) {
    return 'No OMR accuracy report.'
  }
  const lines = []
  lines.push('OMR accuracy report')
  lines.push(`Generated: ${report.summary.generatedTitle ?? 'unknown'}`)
  lines.push(`Ground truth: ${report.summary.groundTruthTitle ?? 'unknown'}`)
  lines.push(
    `Likely main issue: ${report.summary.primaryErrorSource.label} (${report.summary.primaryErrorSource.source})`,
  )
  lines.push(`Evidence: ${report.summary.primaryErrorSource.evidence.join(' | ')}`)
  lines.push('')
  lines.push(metricLine('Pitch accuracy', report.metrics.pitchAccuracy))
  lines.push(metricLine('Matched pitch accuracy', report.metrics.matchedPitchAccuracy))
  if (Number.isFinite(report.metrics.pitchAccuracyAtCorrectOnset)) {
    lines.push(
      metricLine('Pitch accuracy at correct onset', report.metrics.pitchAccuracyAtCorrectOnset),
    )
  }
  if (Number.isFinite(report.metrics.orderSensitivePitchRecovery)) {
    lines.push(
      metricLine('Order-sensitive pitch recovery', report.metrics.orderSensitivePitchRecovery),
    )
  }
  lines.push(metricLine('Duration accuracy', report.metrics.durationAccuracy))
  lines.push(metricLine('Onset accuracy', report.metrics.onsetAccuracy))
  lines.push(metricLine('Onset time accuracy', report.metrics.timeAccuracy))
  lines.push(metricLine('Measure count accuracy', report.metrics.measureCountAccuracy))
  lines.push(metricLine('Note detection F1', report.metrics.noteDetectionF1))
  lines.push(metricLine('Chord grouping accuracy', report.metrics.chordGroupingAccuracy))
  lines.push(
    `Note count: generated ${report.totals.generatedNoteCount}, truth ${report.totals.truthNoteCount}, diff ${report.totals.noteCountDifference}`,
  )
  lines.push(
    `Measure count: generated ${report.totals.generatedMeasureCount}, truth ${report.totals.truthMeasureCount}, diff ${report.totals.measureCountDifference}`,
  )
  if (report.summary.firstAlignmentBreak) {
    lines.push(
      `First likely alignment break: measure ${report.summary.firstAlignmentBreak.measureNumber} (${report.summary.firstAlignmentBreak.reason})`,
    )
  } else {
    lines.push('First likely alignment break: none')
  }
  lines.push('')
  lines.push('Worst measures:')
  for (const measure of report.worstMeasures) {
    lines.push(
      `  m${measure.measureNumber}: error ${pct(measure.errorRate)}; truth ${measure.truthNoteCount}, generated ${measure.generatedNoteCount}, missing ${measure.missingNoteCount}, extra ${measure.extraNoteCount}, pitch ${measure.wrongPitchCount}, duration ${measure.wrongDurationCount}, onset ${measure.wrongOnsetCount}, time ${measure.wrongTimeCount}, chord ${measure.chordMismatchCount}`,
    )
  }
  lines.push('')
  lines.push(
    examplesLine('Missing notes', report.debug.missingNotes, (note) => {
      return `m${note.measureNumber}@${note.onsetQuarters} ${note.label}`
    }),
  )
  lines.push(
    examplesLine('Extra notes', report.debug.extraNotes, (note) => {
      return `m${note.measureNumber}@${note.onsetQuarters} ${note.label}`
    }),
  )
  lines.push(
    examplesLine('Wrong pitches', report.debug.wrongPitches, (entry) => {
      return `m${entry.measureNumber}@${entry.truth.onsetQuarters} ${entry.generated.label} vs ${entry.truth.label}`
    }),
  )
  lines.push(
    examplesLine('Wrong durations', report.debug.wrongDurations, (entry) => {
      return `m${entry.measureNumber}@${entry.truth.onsetQuarters} ${entry.generated.durationQuarters}q vs ${entry.truth.durationQuarters}q`
    }),
  )
  lines.push(
    examplesLine('Wrong onsets', report.debug.wrongOnsets, (entry) => {
      return `m${entry.measureNumber} ${entry.generated.onsetQuarters}q vs ${entry.truth.onsetQuarters}q`
    }),
  )
  lines.push(
    examplesLine('Wrong onset times', report.debug.wrongTimes, (entry) => {
      return `m${entry.measureNumber} delta ${entry.timeDiffSeconds}s`
    }),
  )
  lines.push(
    examplesLine('Chord grouping mismatches', report.debug.chordGroupMismatches, (entry) => {
      return `m${entry.measureNumber}@${entry.onsetQuarters} truth ${entry.truthCount}, generated ${entry.generatedCount}`
    }),
  )
  const ties = report.generatedOmrDiagnostics?.ties
  if (ties) {
    lines.push('')
    lines.push(
      `Ties: detected ${ties.detectedTieCount}, applied ${ties.appliedTieCount}, uncertain slurs ${ties.uncertainSlurCount}`,
    )
    if (ties.appliedTiePairs?.length) {
      lines.push(
        examplesLine('Applied tie pairs', ties.appliedTiePairs.slice(0, 10), (pair) => {
          return `m${pair.fromMeasure}->m${pair.toMeasure} midi ${pair.midi} (${pair.source})`
        }),
      )
    }
  }
  const rests = report.generatedOmrDiagnostics?.rests
  if (rests) {
    lines.push('')
    lines.push(
      `Rests: detected ${rests.detectedRestGlyphCount} glyph(s), applied ${rests.appliedRestEventCount} vector rest event(s), skipped ${rests.skippedMixedRestCount ?? 0}`,
    )
    const skippedReasons = rests.skippedReasons ?? {}
    const reasonSummary = Object.entries(skippedReasons)
      .map(([reason, count]) => `${reason}=${count}`)
      .join(', ')
    if (reasonSummary) {
      lines.push(`Skipped rest reasons: ${reasonSummary}`)
    }
  }
  const staccato = report.generatedOmrDiagnostics?.staccato
  if (staccato) {
    lines.push('')
    lines.push(
      `Staccato: detected ${staccato.detectedStaccatoCount}, applied ${staccato.appliedStaccatoCount}`,
    )
  }
  const accent = report.generatedOmrDiagnostics?.accent
  if (accent) {
    lines.push('')
    lines.push(
      `Accent: detected ${accent.detectedAccentCount}, applied ${accent.appliedAccentCount}`,
    )
  }
  return lines.join('\n')
}
