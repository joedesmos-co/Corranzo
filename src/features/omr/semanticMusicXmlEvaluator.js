/**
 * Semantic MusicXML evaluator (hardened).
 *
 * Ground-truth vs generated comparison with measure alignment, voice/staff-aware
 * matching, error-independent class scores, written vs performed modes, and
 * transparent numerators/denominators. Recognition is not modified.
 */

import { parseMusicXml } from '../musicxml/parseMusicXml.js'
import {
  OMR_SEMANTIC_DEFECT_CLASS,
  OMR_SEMANTIC_DEFECT_LABEL,
} from './omrSemanticDefectClass.js'
import {
  SEMANTIC_EVALUATOR_VERSION,
  SEMANTIC_EVAL_SCHEMA_VERSION,
  describeSemanticEvalTolerances,
  resolveSemanticEvalOptions,
} from './semanticEvalTolerances.js'
import {
  alignMeasureSequences,
  buildMeasureFingerprint,
} from './semanticMeasureAlignment.js'
import {
  matchSemanticEvents,
  summarizeChordIntegrity,
} from './semanticEventMatching.js'

export {
  SEMANTIC_EVALUATOR_VERSION,
  SEMANTIC_EVAL_SCHEMA_VERSION,
  SEMANTIC_EVAL_DEFAULTS,
  SEMANTIC_EVAL_TOLERANCES,
  describeSemanticEvalTolerances,
  resolveSemanticEvalOptions,
} from './semanticEvalTolerances.js'

export const SEMANTIC_DEFECT_CODE = Object.freeze({
  MISSING_NOTE: 'missing-note',
  EXTRA_NOTE: 'extra-note',
  INCORRECT_PITCH: 'incorrect-pitch',
  DURATION_MISMATCH: 'duration-mismatch',
  DOTTED_RHYTHM_ERROR: 'dotted-rhythm-error',
  MISSING_DOT: 'missing-dot',
  REST_DURATION_ERROR: 'rest-duration-error',
  MISSING_REST: 'missing-rest',
  EXTRA_REST: 'extra-rest',
  ONSET_MISMATCH: 'onset-mismatch',
  TUPLET_MISMATCH: 'tuplet-mismatch',
  MISSING_TIE: 'missing-tie',
  INCORRECT_TIE: 'incorrect-tie',
  TIE_VS_SLUR: 'tie-vs-slur-confusion',
  MISSING_STACCATO: 'missing-staccato',
  MISSING_ACCENT: 'missing-accent',
  MISSING_TENUTO: 'missing-tenuto',
  MISSING_MARCATO: 'missing-marcato',
  VOICE_MISMATCH: 'voice-mismatch',
  INCORRECT_BARLINE: 'incorrect-barline',
  INCORRECT_CHORD: 'incorrect-chord',
  MISSING_VOICE: 'missing-voice',
  MISSING_MEASURE: 'missing-measure',
  EXTRA_MEASURE: 'extra-measure',
  SPLIT_MEASURE: 'split-measure',
  MERGED_MEASURE: 'merged-measure',
  REPEAT_MISMATCH: 'repeat-mismatch',
  VOLTA_MISMATCH: 'volta-mismatch',
  DACAPO_MISMATCH: 'dacapo-mismatch',
  DALSEGNO_MISMATCH: 'dalsegno-mismatch',
  CODA_MISMATCH: 'coda-mismatch',
  SEGNO_MISMATCH: 'segno-mismatch',
  TEMPO_MISMATCH: 'tempo-mismatch',
  PLAYBACK_DURATION_MISMATCH: 'playback-duration-mismatch',
  MEASURE_TIMING_MISMATCH: 'measure-timing-mismatch',
  TIMELINE_MISMATCH: 'timeline-mismatch',
})

const DEFECT_LABEL = Object.freeze({
  [SEMANTIC_DEFECT_CODE.MISSING_NOTE]: 'Missing note',
  [SEMANTIC_DEFECT_CODE.EXTRA_NOTE]: 'Extra note',
  [SEMANTIC_DEFECT_CODE.INCORRECT_PITCH]: 'Incorrect pitch',
  [SEMANTIC_DEFECT_CODE.DURATION_MISMATCH]: 'Duration mismatch',
  [SEMANTIC_DEFECT_CODE.DOTTED_RHYTHM_ERROR]: 'Dotted rhythm error',
  [SEMANTIC_DEFECT_CODE.MISSING_DOT]: 'Missing dot',
  [SEMANTIC_DEFECT_CODE.REST_DURATION_ERROR]: 'Rest duration incorrect',
  [SEMANTIC_DEFECT_CODE.MISSING_REST]: 'Missing rest',
  [SEMANTIC_DEFECT_CODE.EXTRA_REST]: 'Extra rest',
  [SEMANTIC_DEFECT_CODE.ONSET_MISMATCH]: 'Onset timing difference',
  [SEMANTIC_DEFECT_CODE.TUPLET_MISMATCH]: 'Tuplet mismatch',
  [SEMANTIC_DEFECT_CODE.MISSING_TIE]: 'Missing tie',
  [SEMANTIC_DEFECT_CODE.INCORRECT_TIE]: 'Incorrect tie',
  [SEMANTIC_DEFECT_CODE.TIE_VS_SLUR]: 'Tie vs slur confusion',
  [SEMANTIC_DEFECT_CODE.MISSING_STACCATO]: 'Missing staccato',
  [SEMANTIC_DEFECT_CODE.MISSING_ACCENT]: 'Missing accent',
  [SEMANTIC_DEFECT_CODE.MISSING_TENUTO]: 'Missing tenuto',
  [SEMANTIC_DEFECT_CODE.MISSING_MARCATO]: 'Missing marcato',
  [SEMANTIC_DEFECT_CODE.VOICE_MISMATCH]: 'Voice mismatch',
  [SEMANTIC_DEFECT_CODE.INCORRECT_BARLINE]: 'Incorrect barline',
  [SEMANTIC_DEFECT_CODE.INCORRECT_CHORD]: 'Incorrect chord',
  [SEMANTIC_DEFECT_CODE.MISSING_VOICE]: 'Missing voice',
  [SEMANTIC_DEFECT_CODE.MISSING_MEASURE]: 'Missing measure',
  [SEMANTIC_DEFECT_CODE.EXTRA_MEASURE]: 'Extra measure',
  [SEMANTIC_DEFECT_CODE.SPLIT_MEASURE]: 'Split measure',
  [SEMANTIC_DEFECT_CODE.MERGED_MEASURE]: 'Merged measure',
  [SEMANTIC_DEFECT_CODE.REPEAT_MISMATCH]: 'Repeat mismatch',
  [SEMANTIC_DEFECT_CODE.VOLTA_MISMATCH]: 'Volta mismatch',
  [SEMANTIC_DEFECT_CODE.DACAPO_MISMATCH]: 'D.C. mismatch',
  [SEMANTIC_DEFECT_CODE.DALSEGNO_MISMATCH]: 'D.S. mismatch',
  [SEMANTIC_DEFECT_CODE.CODA_MISMATCH]: 'Coda mismatch',
  [SEMANTIC_DEFECT_CODE.SEGNO_MISMATCH]: 'Segno mismatch',
  [SEMANTIC_DEFECT_CODE.TEMPO_MISMATCH]: 'Tempo change mismatch',
  [SEMANTIC_DEFECT_CODE.PLAYBACK_DURATION_MISMATCH]: 'Playback duration mismatch',
  [SEMANTIC_DEFECT_CODE.MEASURE_TIMING_MISMATCH]: 'Measure timing mismatch',
  [SEMANTIC_DEFECT_CODE.TIMELINE_MISMATCH]: 'Timeline mismatch',
})

const CODE_TO_CLASS = Object.freeze(
  Object.fromEntries(
    Object.entries(DEFECT_LABEL).map(([code]) => {
      if (
        [
          SEMANTIC_DEFECT_CODE.MISSING_NOTE,
          SEMANTIC_DEFECT_CODE.EXTRA_NOTE,
          SEMANTIC_DEFECT_CODE.INCORRECT_PITCH,
        ].includes(code)
      ) {
        return [code, OMR_SEMANTIC_DEFECT_CLASS.PITCH]
      }
      if (
        [
          SEMANTIC_DEFECT_CODE.DURATION_MISMATCH,
          SEMANTIC_DEFECT_CODE.DOTTED_RHYTHM_ERROR,
          SEMANTIC_DEFECT_CODE.MISSING_DOT,
          SEMANTIC_DEFECT_CODE.REST_DURATION_ERROR,
          SEMANTIC_DEFECT_CODE.MISSING_REST,
          SEMANTIC_DEFECT_CODE.EXTRA_REST,
          SEMANTIC_DEFECT_CODE.ONSET_MISMATCH,
          SEMANTIC_DEFECT_CODE.TUPLET_MISMATCH,
        ].includes(code)
      ) {
        return [code, OMR_SEMANTIC_DEFECT_CLASS.RHYTHM]
      }
      if (
        [
          SEMANTIC_DEFECT_CODE.MISSING_TIE,
          SEMANTIC_DEFECT_CODE.INCORRECT_TIE,
          SEMANTIC_DEFECT_CODE.TIE_VS_SLUR,
        ].includes(code)
      ) {
        return [code, OMR_SEMANTIC_DEFECT_CLASS.SUSTAIN]
      }
      if (
        [
          SEMANTIC_DEFECT_CODE.MISSING_STACCATO,
          SEMANTIC_DEFECT_CODE.MISSING_ACCENT,
          SEMANTIC_DEFECT_CODE.MISSING_TENUTO,
          SEMANTIC_DEFECT_CODE.MISSING_MARCATO,
        ].includes(code)
      ) {
        return [code, OMR_SEMANTIC_DEFECT_CLASS.ARTICULATION]
      }
      if (
        [
          SEMANTIC_DEFECT_CODE.PLAYBACK_DURATION_MISMATCH,
          SEMANTIC_DEFECT_CODE.MEASURE_TIMING_MISMATCH,
          SEMANTIC_DEFECT_CODE.TIMELINE_MISMATCH,
        ].includes(code)
      ) {
        return [code, OMR_SEMANTIC_DEFECT_CLASS.PLAYBACK]
      }
      if (
        [
          SEMANTIC_DEFECT_CODE.REPEAT_MISMATCH,
          SEMANTIC_DEFECT_CODE.VOLTA_MISMATCH,
          SEMANTIC_DEFECT_CODE.DACAPO_MISMATCH,
          SEMANTIC_DEFECT_CODE.DALSEGNO_MISMATCH,
          SEMANTIC_DEFECT_CODE.CODA_MISMATCH,
          SEMANTIC_DEFECT_CODE.SEGNO_MISMATCH,
          SEMANTIC_DEFECT_CODE.TEMPO_MISMATCH,
        ].includes(code)
      ) {
        return [code, OMR_SEMANTIC_DEFECT_CLASS.INTERPRETATION]
      }
      return [code, OMR_SEMANTIC_DEFECT_CLASS.MEASURE_STRUCTURE]
    }),
  ),
)

const SEVERITY_WEIGHT = Object.freeze({
  [OMR_SEMANTIC_DEFECT_CLASS.RHYTHM]: 4,
  [OMR_SEMANTIC_DEFECT_CLASS.SUSTAIN]: 4,
  [OMR_SEMANTIC_DEFECT_CLASS.PITCH]: 3,
  [OMR_SEMANTIC_DEFECT_CLASS.MEASURE_STRUCTURE]: 3,
  [OMR_SEMANTIC_DEFECT_CLASS.ARTICULATION]: 2,
  [OMR_SEMANTIC_DEFECT_CLASS.INTERPRETATION]: 2,
  [OMR_SEMANTIC_DEFECT_CLASS.PLAYBACK]: 1,
})

const CLASS_KEYS = Object.freeze([
  'pitch',
  'rhythm',
  'sustain',
  'articulation',
  'measureStructure',
  'interpretation',
  'playback',
])

export const SEMANTIC_EVAL_UNSUPPORTED = Object.freeze([
  'ornaments (trills, turns, mordents)',
  'fermata / breath marks',
  'dynamics as scored values (p/f continuum)',
  'hairpins / wedges',
  'octave-shift (ottava)',
  'cue notes / grace-note playback semantics',
  'cross-staff beaming encoding details',
  'figured bass / harmony realization',
  'lyrics / text directions (except D.C./D.S./Fine words)',
  'multiple <part> alignment beyond primary written sequence',
  'score-timewise documents',
  'microtonal / non-MIDI pitch systems',
])

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

function durationLabel(quarters) {
  if (!Number.isFinite(quarters) || quarters <= 0) {
    return 'unknown'
  }
  for (const [base, name] of [
    [4, 'whole'],
    [2, 'half'],
    [1, 'quarter'],
    [0.5, 'eighth'],
    [0.25, '16th'],
    [0.125, '32nd'],
  ]) {
    if (Math.abs(quarters - base) < 1e-6) {
      return name
    }
    if (Math.abs(quarters - base * 1.5) < 1e-6) {
      return `dotted ${name}`
    }
  }
  return `${round(quarters, 3)}q`
}

function isDottedDuration(quarters, dots = 0) {
  if (dots > 0) {
    return true
  }
  if (!Number.isFinite(quarters) || quarters <= 0) {
    return false
  }
  return [4, 2, 1, 0.5, 0.25, 0.125].some((base) => Math.abs(quarters - base * 1.5) < 1e-6)
}

function tupletKey(tm) {
  return tm ? `${tm.actualNotes}:${tm.normalNotes}` : null
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

function hasSlurStart(note) {
  return (note.slurs ?? []).some((slur) => slur.type === 'start')
}

function measureByNumber(timingMap) {
  return new Map((timingMap?.measures ?? []).map((measure) => [measure.number, measure]))
}

function emptyClassStats() {
  return {
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    ignored: 0,
    unsupported: 0,
    presentInTruth: 0,
    compared: 0,
  }
}

function finalizeClassStats(stats, options) {
  const denominator = stats.truePositives + stats.falsePositives + stats.falseNegatives
  const numerator = stats.truePositives
  const score = denominator > 0 ? clamp01(numerator / denominator) : 1
  const coverage =
    stats.presentInTruth > 0 ? clamp01(stats.compared / stats.presentInTruth) : 1
  const reliable = coverage >= options.minReliableCoverage || stats.presentInTruth === 0
  return {
    numerator,
    denominator,
    truePositives: stats.truePositives,
    falsePositives: stats.falsePositives,
    falseNegatives: stats.falseNegatives,
    ignored: stats.ignored,
    unsupported: stats.unsupported,
    presentInTruth: stats.presentInTruth,
    compared: stats.compared,
    coverage: round(coverage, 4),
    coveragePercent: pct(coverage),
    score: round(score, 4),
    percent: pct(score),
    reliable,
    displayPercent: reliable ? pct(score) : `${pct(score)} (low coverage ${pct(coverage)})`,
  }
}

function makeDefect(code, message, extras = {}) {
  return {
    code,
    class: CODE_TO_CLASS[code],
    message: message ?? DEFECT_LABEL[code] ?? code,
    ...extras,
  }
}

function markingSignature(marking = {}) {
  return JSON.stringify({
    forwardRepeat: Boolean(marking.forwardRepeat),
    backwardRepeat: Boolean(marking.backwardRepeat),
    backwardRepeatTimes: marking.backwardRepeatTimes ?? null,
    endingStartNumbers: marking.endingStartNumbers ?? null,
    endingStop: Boolean(marking.endingStop),
    endingDiscontinue: Boolean(marking.endingDiscontinue),
  })
}

export function normalizeSemanticNotes(
  timingMap,
  { includeRests = true, excludeTabMirrors = true } = {},
) {
  const measures = measureByNumber(timingMap)
  return (timingMap?.notes ?? [])
    .filter((note) => {
      if (excludeTabMirrors && note.isTabMirror) {
        return false
      }
      if (note.isRest) {
        return includeRests
      }
      return note.midi != null
    })
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
        midi: note.isRest ? null : note.midi,
        label: note.isRest ? 'rest' : (note.label ?? noteLabel(note.midi)),
        voice: note.voice ?? 1,
        staff: note.staff ?? 1,
        isRest: Boolean(note.isRest),
        isChord: Boolean(note.isChord),
        tieStart: Boolean(note.tieStart),
        tieStop: Boolean(note.tieStop),
        staccato: Boolean(note.staccato),
        accent: Boolean(note.accent),
        tenuto: Boolean(note.tenuto),
        marcato: Boolean(note.marcato),
        dots: Number(note.dots) || 0,
        timeModification: note.timeModification ?? null,
        slurStart: hasSlurStart(note),
        slurs: note.slurs ?? [],
      }
    })
    .sort(
      (left, right) =>
        left.measureNumber - right.measureNumber ||
        (left.staff ?? 1) - (right.staff ?? 1) ||
        left.voice - right.voice ||
        left.onsetQuarters - right.onsetQuarters ||
        (left.midi ?? -1) - (right.midi ?? -1),
    )
}

export function extractInterpretationMarks(xmlString) {
  if (!xmlString || typeof xmlString !== 'string') {
    return []
  }
  const marks = []
  const measureRe = /<measure\b([^>]*)>([\s\S]*?)<\/measure>/gi
  let match
  while ((match = measureRe.exec(xmlString)) != null) {
    const attrs = match[1] ?? ''
    const body = match[2] ?? ''
    const numberMatch = attrs.match(/\bnumber="([^"]+)"/i)
    const measureNumber = numberMatch ? Number(String(numberMatch[1]).split('.')[0]) : null
    const push = (kind) => {
      marks.push({
        measureNumber: Number.isFinite(measureNumber) ? measureNumber : null,
        kind,
      })
    }
    if (/\bsound\b[^>]*\bdacapo\s*=\s*"(?:yes|true|1)"/i.test(body) || /\bD\.?\s*C\.?\b/i.test(body)) {
      push('dacapo')
    }
    if (/\bsound\b[^>]*\bdalsegno\s*=\s*"(?:yes|true|1)"/i.test(body) || /\bD\.?\s*S\.?\b/i.test(body)) {
      push('dalsegno')
    }
    if (
      /\bsound\b[^>]*\btocoda\s*=/i.test(body) ||
      /<coda\b/i.test(body) ||
      /\bTo\s+Coda\b/i.test(body)
    ) {
      push('coda')
    }
    if (/\bsound\b[^>]*\bcoda\s*=/i.test(body) && !/\btocoda\s*=/i.test(body)) {
      push('coda')
    }
    if (/<segno\b/i.test(body) || /\bsound\b[^>]*\bsegno\s*=/i.test(body)) {
      push('segno')
    }
  }
  return marks
}

function countKinds(marks) {
  const counts = Object.create(null)
  for (const mark of marks) {
    counts[mark.kind] = (counts[mark.kind] ?? 0) + 1
  }
  return counts
}

function groupNotesByMeasureIndex(notes, measures) {
  const byIndex = new Map(measures.map((_, index) => [index, []]))
  const byNumber = new Map(measures.map((measure, index) => [measure.number, index]))
  for (const note of notes) {
    const index = byNumber.get(note.measureNumber)
    if (index == null) {
      continue
    }
    byIndex.get(index).push(note)
  }
  return byIndex
}

function rebaseOnsets(notes, measureIndexes, measures) {
  if (!notes.length || measureIndexes.length <= 1) {
    return notes
  }
  const baseStart = measures[measureIndexes[0]]?.startQuarters ?? 0
  return notes.map((note) => {
    const measure = measures.find((entry) => entry.number === note.measureNumber)
    const absolute = (measure?.startQuarters ?? 0) + note.onsetQuarters
    return { ...note, onsetQuarters: absolute - baseStart }
  })
}

function recordDetection(matched, stats, localDefects, measureRef) {
  for (const note of matched.missing) {
    if (note.isRest) {
      stats.rhythm.presentInTruth += 1
      stats.rhythm.compared += 1
      stats.rhythm.falseNegatives += 1
      localDefects.push(
        makeDefect(
          SEMANTIC_DEFECT_CODE.MISSING_REST,
          `Missing rest (${durationLabel(note.durationQuarters)})`,
          { measureNumber: measureRef },
        ),
      )
      continue
    }
    stats.pitch.presentInTruth += 1
    stats.pitch.compared += 1
    stats.pitch.falseNegatives += 1
    localDefects.push(
      makeDefect(SEMANTIC_DEFECT_CODE.MISSING_NOTE, `Missing note ${note.label}`, {
        measureNumber: measureRef,
      }),
    )
  }
  for (const note of matched.extra) {
    if (note.isRest) {
      stats.rhythm.compared += 1
      stats.rhythm.falsePositives += 1
      localDefects.push(
        makeDefect(
          SEMANTIC_DEFECT_CODE.EXTRA_REST,
          `Extra rest (${durationLabel(note.durationQuarters)})`,
          { measureNumber: measureRef },
        ),
      )
      continue
    }
    stats.pitch.compared += 1
    stats.pitch.falsePositives += 1
    localDefects.push(
      makeDefect(SEMANTIC_DEFECT_CODE.EXTRA_NOTE, `Extra note ${note.label}`, {
        measureNumber: measureRef,
      }),
    )
  }
}

function recordAttributes(matches, stats, localDefects, measureRef) {
  for (const pair of matches) {
    if (pair.truth.isRest) {
      stats.rhythm.presentInTruth += 1
      stats.rhythm.compared += 1
      if (pair.durationCorrect) {
        stats.rhythm.truePositives += 1
      } else {
        stats.rhythm.falseNegatives += 1
        localDefects.push(
          makeDefect(
            SEMANTIC_DEFECT_CODE.REST_DURATION_ERROR,
            `Rest duration incorrect (${durationLabel(pair.generated.durationQuarters)}; expected ${durationLabel(pair.truth.durationQuarters)})`,
            { measureNumber: measureRef },
          ),
        )
      }
      continue
    }

    stats.pitch.presentInTruth += 1
    stats.pitch.compared += 1
    if (pair.pitchCorrect) {
      stats.pitch.truePositives += 1
    } else {
      stats.pitch.falseNegatives += 1
      localDefects.push(
        makeDefect(
          SEMANTIC_DEFECT_CODE.INCORRECT_PITCH,
          `Incorrect pitch ${pair.generated.label} (expected ${pair.truth.label})`,
          { measureNumber: measureRef },
        ),
      )
    }

    stats.rhythm.presentInTruth += 1
    stats.rhythm.compared += 1
    if (pair.durationCorrect) {
      stats.rhythm.truePositives += 1
    } else {
      stats.rhythm.falseNegatives += 1
      const generatedDotted = isDottedDuration(
        pair.generated.durationQuarters,
        pair.generated.dots,
      )
      if (pair.truth.dots > 0 && pair.generated.dots === 0 && !generatedDotted) {
        localDefects.push(
          makeDefect(SEMANTIC_DEFECT_CODE.MISSING_DOT, 'Missing dot', {
            measureNumber: measureRef,
          }),
        )
      } else if (isDottedDuration(pair.truth.durationQuarters, pair.truth.dots)) {
        localDefects.push(
          makeDefect(
            SEMANTIC_DEFECT_CODE.DOTTED_RHYTHM_ERROR,
            `${durationLabel(pair.truth.durationQuarters)} detected as ${durationLabel(pair.generated.durationQuarters)}`,
            { measureNumber: measureRef },
          ),
        )
      } else {
        localDefects.push(
          makeDefect(
            SEMANTIC_DEFECT_CODE.DURATION_MISMATCH,
            `${capitalize(durationLabel(pair.truth.durationQuarters))} detected as ${durationLabel(pair.generated.durationQuarters)}`,
            { measureNumber: measureRef },
          ),
        )
      }
    }

    stats.rhythm.presentInTruth += 1
    stats.rhythm.compared += 1
    if (pair.onsetCorrect) {
      stats.rhythm.truePositives += 1
    } else {
      stats.rhythm.falseNegatives += 1
      localDefects.push(
        makeDefect(
          SEMANTIC_DEFECT_CODE.ONSET_MISMATCH,
          `Onset off by ${round(pair.onsetDiffQuarters, 3)} quarters`,
          { measureNumber: measureRef },
        ),
      )
    }

    const truthTuplet = tupletKey(pair.truth.timeModification)
    const generatedTuplet = tupletKey(pair.generated.timeModification)
    if (truthTuplet || generatedTuplet) {
      stats.rhythm.presentInTruth += 1
      stats.rhythm.compared += 1
      if (truthTuplet === generatedTuplet) {
        stats.rhythm.truePositives += 1
      } else {
        stats.rhythm.falseNegatives += 1
        localDefects.push(
          makeDefect(
            SEMANTIC_DEFECT_CODE.TUPLET_MISMATCH,
            `Tuplet ${generatedTuplet ?? 'none'} (expected ${truthTuplet ?? 'none'})`,
            { measureNumber: measureRef },
          ),
        )
      }
    }

    const truthTie = Boolean(pair.truth.tieStart || pair.truth.tieStop)
    const generatedTie = Boolean(pair.generated.tieStart || pair.generated.tieStop)
    if (truthTie || generatedTie) {
      if (truthTie) {
        stats.sustain.presentInTruth += 1
      }
      stats.sustain.compared += 1
      const startOk = Boolean(pair.truth.tieStart) === Boolean(pair.generated.tieStart)
      const stopOk = Boolean(pair.truth.tieStop) === Boolean(pair.generated.tieStop)
      if (startOk && stopOk) {
        stats.sustain.truePositives += 1
      } else if (truthTie && !generatedTie && pair.generated.slurStart) {
        stats.sustain.falseNegatives += 1
        localDefects.push(
          makeDefect(SEMANTIC_DEFECT_CODE.TIE_VS_SLUR, 'Tie vs slur confusion', {
            measureNumber: measureRef,
          }),
        )
      } else if (truthTie && !generatedTie) {
        stats.sustain.falseNegatives += 1
        localDefects.push(
          makeDefect(SEMANTIC_DEFECT_CODE.MISSING_TIE, 'Missing tie', {
            measureNumber: measureRef,
          }),
        )
      } else {
        stats.sustain.falsePositives += 1
        localDefects.push(
          makeDefect(SEMANTIC_DEFECT_CODE.INCORRECT_TIE, 'Incorrect tie', {
            measureNumber: measureRef,
          }),
        )
      }
    }

    for (const [field, code, message] of [
      ['staccato', SEMANTIC_DEFECT_CODE.MISSING_STACCATO, 'Missing staccato'],
      ['accent', SEMANTIC_DEFECT_CODE.MISSING_ACCENT, 'Missing accent'],
      ['tenuto', SEMANTIC_DEFECT_CODE.MISSING_TENUTO, 'Missing tenuto'],
      ['marcato', SEMANTIC_DEFECT_CODE.MISSING_MARCATO, 'Missing marcato'],
    ]) {
      if (!pair.truth[field] && !pair.generated[field]) {
        continue
      }
      if (pair.truth[field]) {
        stats.articulation.presentInTruth += 1
      }
      stats.articulation.compared += 1
      if (pair.truth[field] && pair.generated[field]) {
        stats.articulation.truePositives += 1
      } else if (pair.truth[field] && !pair.generated[field]) {
        stats.articulation.falseNegatives += 1
        localDefects.push(makeDefect(code, message, { measureNumber: measureRef }))
      } else {
        stats.articulation.falsePositives += 1
        localDefects.push(
          makeDefect(code, `Unexpected ${field}`, { measureNumber: measureRef }),
        )
      }
    }
  }
}

function recordVoiceLanes(truthNotes, generatedNotes, stats, localDefects, measureRef) {
  const truthStaves = new Set(truthNotes.map((note) => note.staff ?? 1))
  const generatedStaves = new Set(generatedNotes.map((note) => note.staff ?? 1))
  for (const staff of truthStaves) {
    stats.measureStructure.presentInTruth += 1
    stats.measureStructure.compared += 1
    if (generatedStaves.has(staff)) {
      stats.measureStructure.truePositives += 1
    } else {
      stats.measureStructure.falseNegatives += 1
      localDefects.push(
        makeDefect(
          SEMANTIC_DEFECT_CODE.MISSING_VOICE,
          `Missing staff/voice lane (staff ${staff})`,
          { measureNumber: measureRef },
        ),
      )
    }
  }

  // Same pitches present but assigned to fewer/more raw voice lanes on the same staff.
  const byStaff = (notes) => {
    const map = new Map()
    for (const note of notes.filter((entry) => !entry.isRest)) {
      const staff = note.staff ?? 1
      if (!map.has(staff)) {
        map.set(staff, { voices: new Set(), midis: [] })
      }
      map.get(staff).voices.add(note.voice ?? 1)
      map.get(staff).midis.push(note.midi)
    }
    return map
  }
  const truthByStaff = byStaff(truthNotes)
  const generatedByStaff = byStaff(generatedNotes)
  for (const [staff, truthLane] of truthByStaff) {
    const generatedLane = generatedByStaff.get(staff)
    if (!generatedLane) {
      continue
    }
    const truthMidis = [...truthLane.midis].sort((a, b) => a - b).join(',')
    const generatedMidis = [...generatedLane.midis].sort((a, b) => a - b).join(',')
    if (
      truthMidis === generatedMidis &&
      truthLane.voices.size !== generatedLane.voices.size
    ) {
      stats.measureStructure.presentInTruth += 1
      stats.measureStructure.compared += 1
      stats.measureStructure.falseNegatives += 1
      localDefects.push(
        makeDefect(SEMANTIC_DEFECT_CODE.VOICE_MISMATCH, 'Voice mismatch', {
          measureNumber: measureRef,
        }),
      )
    }
  }
}
function compareInterpretation(
  alignment,
  truthMeasures,
  generatedMeasures,
  truthXml,
  generatedXml,
  truthMap,
  generatedMap,
  stats,
  defects,
  options,
) {
  for (const pair of alignment.pairs) {
    if (pair.kind !== 'match') {
      continue
    }
    const truthMeasure = truthMeasures[pair.truthIndexes[0]]
    const generatedMeasure = generatedMeasures[pair.generatedIndexes[0]]
    if (!truthMeasure || !generatedMeasure) {
      continue
    }
    const truthMarking = truthMeasure.marking ?? {}
    const generatedMarking = generatedMeasure.marking ?? {}
    const hasRepeat =
      truthMarking.forwardRepeat ||
      truthMarking.backwardRepeat ||
      generatedMarking.forwardRepeat ||
      generatedMarking.backwardRepeat
    if (hasRepeat) {
      stats.interpretation.presentInTruth += 1
      stats.interpretation.compared += 1
      if (
        Boolean(truthMarking.forwardRepeat) === Boolean(generatedMarking.forwardRepeat) &&
        Boolean(truthMarking.backwardRepeat) === Boolean(generatedMarking.backwardRepeat) &&
        (truthMarking.backwardRepeatTimes ?? null) ===
          (generatedMarking.backwardRepeatTimes ?? null)
      ) {
        stats.interpretation.truePositives += 1
      } else {
        stats.interpretation.falseNegatives += 1
        defects.push(
          makeDefect(SEMANTIC_DEFECT_CODE.REPEAT_MISMATCH, 'Repeat mismatch', {
            measureNumber: truthMeasure.number,
          }),
        )
      }
    }
    const hasVolta =
      truthMarking.endingStartNumbers ||
      truthMarking.endingStop ||
      generatedMarking.endingStartNumbers ||
      generatedMarking.endingStop
    if (hasVolta) {
      stats.interpretation.presentInTruth += 1
      stats.interpretation.compared += 1
      if (markingSignature(truthMarking) === markingSignature(generatedMarking)) {
        stats.interpretation.truePositives += 1
      } else {
        stats.interpretation.falseNegatives += 1
        defects.push(
          makeDefect(SEMANTIC_DEFECT_CODE.VOLTA_MISMATCH, 'Volta mismatch', {
            measureNumber: truthMeasure.number,
          }),
        )
      }
    }
  }

  const truthCounts = countKinds(extractInterpretationMarks(truthXml))
  const generatedCounts = countKinds(extractInterpretationMarks(generatedXml))
  for (const [kind, code, label] of [
    ['dacapo', SEMANTIC_DEFECT_CODE.DACAPO_MISMATCH, 'D.C.'],
    ['dalsegno', SEMANTIC_DEFECT_CODE.DALSEGNO_MISMATCH, 'D.S.'],
    ['coda', SEMANTIC_DEFECT_CODE.CODA_MISMATCH, 'Coda'],
    ['segno', SEMANTIC_DEFECT_CODE.SEGNO_MISMATCH, 'Segno'],
  ]) {
    const truthCount = truthCounts[kind] ?? 0
    const generatedCount = generatedCounts[kind] ?? 0
    if (truthCount === 0 && generatedCount === 0) {
      continue
    }
    stats.interpretation.presentInTruth += Math.max(truthCount, 1)
    stats.interpretation.compared += Math.max(truthCount, generatedCount, 1)
    if (truthCount === generatedCount) {
      stats.interpretation.truePositives += Math.max(truthCount, 1)
    } else {
      stats.interpretation.falseNegatives += 1
      defects.push(
        makeDefect(code, `${label} count ${generatedCount} (expected ${truthCount})`, {
          measureNumber: null,
        }),
      )
    }
  }

  const truthTempo = truthMap?.tempoChanges ?? []
  const generatedTempo = generatedMap?.tempoChanges ?? []
  if (truthTempo.length === 0 && generatedTempo.length <= 1) {
    return
  }
  for (const entry of truthTempo) {
    stats.interpretation.presentInTruth += 1
    stats.interpretation.compared += 1
    const found = generatedTempo.some(
      (candidate) =>
        Math.abs(candidate.quarterTime - entry.quarterTime) <=
          options.tempoOnsetToleranceQuarters &&
        Math.abs(candidate.bpm - entry.bpm) <= options.tempoToleranceBpm,
    )
    if (found) {
      stats.interpretation.truePositives += 1
    } else {
      stats.interpretation.falseNegatives += 1
      const measure =
        (truthMap?.measures ?? []).find(
          (m) => entry.quarterTime >= m.startQuarters && entry.quarterTime < m.endQuarters,
        )?.number ?? null
      defects.push(
        makeDefect(
          SEMANTIC_DEFECT_CODE.TEMPO_MISMATCH,
          `Tempo ${entry.bpm} BPM missing or wrong at q=${round(entry.quarterTime, 2)}`,
          { measureNumber: measure },
        ),
      )
    }
  }
}

function comparePerformed(truthMap, generatedMap, stats, defects, options) {
  const truthDuration = Number(truthMap?.durationSeconds)
  const generatedDuration = Number(generatedMap?.durationSeconds)
  if (Number.isFinite(truthDuration) && truthDuration > 0) {
    stats.playback.presentInTruth += 1
    stats.playback.compared += 1
    if (
      Math.abs((generatedDuration || 0) - truthDuration) <=
      options.playbackDurationToleranceSeconds
    ) {
      stats.playback.truePositives += 1
    } else {
      stats.playback.falseNegatives += 1
      defects.push(
        makeDefect(
          SEMANTIC_DEFECT_CODE.PLAYBACK_DURATION_MISMATCH,
          `Playback duration ${round(generatedDuration, 2)}s (expected ${round(truthDuration, 2)}s)`,
          { measureNumber: null },
        ),
      )
    }
  }

  const truthTimeline = truthMap?.performedMeasureTimeline?.entries ?? []
  const generatedTimeline = generatedMap?.performedMeasureTimeline?.entries ?? []
  if (truthTimeline.length > 0 || generatedTimeline.length > 0) {
    stats.playback.presentInTruth += 1
    stats.playback.compared += 1
    const truthSig = truthTimeline
      .map((entry) => `${entry.writtenMeasureNumber}:${entry.repeatPass ?? 1}`)
      .join('|')
    const generatedSig = generatedTimeline
      .map((entry) => `${entry.writtenMeasureNumber}:${entry.repeatPass ?? 1}`)
      .join('|')
    if (truthSig === generatedSig) {
      stats.playback.truePositives += 1
    } else {
      stats.playback.falseNegatives += 1
      defects.push(
        makeDefect(
          SEMANTIC_DEFECT_CODE.TIMELINE_MISMATCH,
          `Performed timeline length ${generatedTimeline.length} (expected ${truthTimeline.length})`,
          { measureNumber: null },
        ),
      )
    }
  }

  const generatedByNumber = measureByNumber(generatedMap)
  for (const measure of truthMap?.measures ?? []) {
    stats.playback.presentInTruth += 1
    stats.playback.compared += 1
    const generated = generatedByNumber.get(measure.number)
    if (!generated) {
      stats.playback.falseNegatives += 1
      defects.push(
        makeDefect(
          SEMANTIC_DEFECT_CODE.MEASURE_TIMING_MISMATCH,
          `Measure ${measure.number} missing from generated timeline`,
          { measureNumber: measure.number },
        ),
      )
      continue
    }
    const startDiff = Math.abs(
      (generated.startTimeSeconds ?? 0) - (measure.startTimeSeconds ?? 0),
    )
    const lengthDiff = Math.abs(
      (generated.endTimeSeconds ?? 0) -
        (generated.startTimeSeconds ?? 0) -
        ((measure.endTimeSeconds ?? 0) - (measure.startTimeSeconds ?? 0)),
    )
    if (
      startDiff <= options.measureTimingToleranceSeconds &&
      lengthDiff <= options.measureTimingToleranceSeconds
    ) {
      stats.playback.truePositives += 1
    } else {
      stats.playback.falseNegatives += 1
      defects.push(
        makeDefect(
          SEMANTIC_DEFECT_CODE.MEASURE_TIMING_MISMATCH,
          `Measure ${measure.number} timing mismatch`,
          { measureNumber: measure.number },
        ),
      )
    }
  }
}

export function evaluateSemanticMusicXml({
  groundTruthMusicXml,
  generatedMusicXml,
  groundTruthFileName = 'truth.musicxml',
  generatedFileName = 'generated.musicxml',
  options = {},
  meta = {},
} = {}) {
  if (!groundTruthMusicXml || !generatedMusicXml) {
    throw new Error('evaluateSemanticMusicXml requires groundTruthMusicXml and generatedMusicXml')
  }
  return evaluateSemanticMusicXmlFromTimingMaps({
    groundTruthTimingMap: parseMusicXml(groundTruthMusicXml, groundTruthFileName),
    generatedTimingMap: parseMusicXml(generatedMusicXml, generatedFileName),
    groundTruthMusicXml,
    generatedMusicXml,
    options,
    meta,
  })
}

export function evaluateSemanticMusicXmlFromTimingMaps({
  groundTruthTimingMap,
  generatedTimingMap,
  groundTruthMusicXml = '',
  generatedMusicXml = '',
  options = {},
  meta = {},
} = {}) {
  const resolvedOptions = resolveSemanticEvalOptions(options)
  const mode = resolvedOptions.mode
  const runWritten = mode === 'written' || mode === 'both'
  const runPerformed = mode === 'performed' || mode === 'both'

  const truthNotes = normalizeSemanticNotes(groundTruthTimingMap)
  const generatedNotes = normalizeSemanticNotes(generatedTimingMap)
  const truthMeasures = groundTruthTimingMap?.measures ?? []
  const generatedMeasures = generatedTimingMap?.measures ?? []
  const truthNotesByIndex = groupNotesByMeasureIndex(truthNotes, truthMeasures)
  const generatedNotesByIndex = groupNotesByMeasureIndex(generatedNotes, generatedMeasures)

  const alignment = alignMeasureSequences(
    truthMeasures.map((measure, index) =>
      buildMeasureFingerprint(measure, truthNotesByIndex.get(index) ?? []),
    ),
    generatedMeasures.map((measure, index) =>
      buildMeasureFingerprint(measure, generatedNotesByIndex.get(index) ?? []),
    ),
    resolvedOptions,
  )

  const stats = Object.fromEntries(CLASS_KEYS.map((key) => [key, emptyClassStats()]))
  const defects = []
  const measureReports = []

  if (runWritten) {
    for (const pair of alignment.pairs) {
      const truthNums = pair.truthMeasureNumbers.filter((n) => n != null)
      const genNums = pair.generatedMeasureNumbers.filter((n) => n != null)
      const measureRef = truthNums[0] ?? genNums[0] ?? null
      const localDefects = []

      if (pair.kind === 'missing') {
        stats.measureStructure.presentInTruth += 1
        stats.measureStructure.compared += 1
        stats.measureStructure.falseNegatives += 1
        localDefects.push(
          makeDefect(
            SEMANTIC_DEFECT_CODE.MISSING_MEASURE,
            `Missing measure ${truthNums.join(',')}`,
            { measureNumber: measureRef, alignment: pair.kind },
          ),
        )
        for (const truthIndex of pair.truthIndexes) {
          for (const note of truthNotesByIndex.get(truthIndex) ?? []) {
            if (note.isRest) {
              stats.rhythm.presentInTruth += 1
              stats.rhythm.ignored += 1
              continue
            }
            stats.pitch.presentInTruth += 1
            stats.pitch.compared += 1
            stats.pitch.falseNegatives += 1
            localDefects.push(
              makeDefect(SEMANTIC_DEFECT_CODE.MISSING_NOTE, `Missing note ${note.label}`, {
                measureNumber: measureRef,
                alignment: 'unmatched-measure',
              }),
            )
          }
        }
        defects.push(...localDefects)
        measureReports.push(makeMeasureReport(measureRef, truthNums, genNums, pair, localDefects))
        continue
      }

      if (pair.kind === 'extra') {
        stats.measureStructure.compared += 1
        stats.measureStructure.falsePositives += 1
        localDefects.push(
          makeDefect(
            SEMANTIC_DEFECT_CODE.EXTRA_MEASURE,
            `Extra measure ${genNums.join(',')}`,
            { measureNumber: measureRef, alignment: pair.kind },
          ),
        )
        for (const generatedIndex of pair.generatedIndexes) {
          for (const note of (generatedNotesByIndex.get(generatedIndex) ?? []).filter(
            (entry) => !entry.isRest,
          )) {
            stats.pitch.compared += 1
            stats.pitch.falsePositives += 1
            localDefects.push(
              makeDefect(SEMANTIC_DEFECT_CODE.EXTRA_NOTE, `Extra note ${note.label}`, {
                measureNumber: measureRef,
                alignment: 'unmatched-measure',
              }),
            )
          }
        }
        defects.push(...localDefects)
        measureReports.push(makeMeasureReport(measureRef, truthNums, genNums, pair, localDefects))
        continue
      }

      if (pair.kind === 'split' || pair.kind === 'merge') {
        stats.measureStructure.presentInTruth += 1
        stats.measureStructure.compared += 1
        stats.measureStructure.falseNegatives += 1
        localDefects.push(
          makeDefect(
            pair.kind === 'split'
              ? SEMANTIC_DEFECT_CODE.SPLIT_MEASURE
              : SEMANTIC_DEFECT_CODE.MERGED_MEASURE,
            pair.kind === 'split'
              ? `Split measure ${truthNums.join(',')} → ${genNums.join(',')}`
              : `Merged measures ${truthNums.join(',')} → ${genNums.join(',')}`,
            { measureNumber: measureRef, alignment: pair.kind },
          ),
        )
      } else {
        stats.measureStructure.presentInTruth += 1
        stats.measureStructure.compared += 1
        stats.measureStructure.truePositives += 1
      }

      const truthMeasureNotes = rebaseOnsets(
        pair.truthIndexes.flatMap((index) => truthNotesByIndex.get(index) ?? []),
        pair.truthIndexes,
        truthMeasures,
      )
      const generatedMeasureNotes = rebaseOnsets(
        pair.generatedIndexes.flatMap((index) => generatedNotesByIndex.get(index) ?? []),
        pair.generatedIndexes,
        generatedMeasures,
      )

      const matched = matchSemanticEvents(
        truthMeasureNotes,
        generatedMeasureNotes,
        resolvedOptions,
      )
      recordDetection(matched, stats, localDefects, measureRef)
      recordAttributes(matched.matches, stats, localDefects, measureRef)
      recordVoiceLanes(
        truthMeasureNotes,
        generatedMeasureNotes,
        stats,
        localDefects,
        measureRef,
      )

      const chord = summarizeChordIntegrity(
        matched.matches,
        matched.missing,
        matched.extra,
        resolvedOptions,
      )
      if (chord.comparableCount > 0) {
        stats.measureStructure.presentInTruth += chord.comparableCount
        stats.measureStructure.compared += chord.comparableCount
        stats.measureStructure.truePositives += chord.comparableCount - chord.mismatchCount
        stats.measureStructure.falseNegatives += chord.mismatchCount
        for (const example of chord.examples) {
          localDefects.push(
            makeDefect(SEMANTIC_DEFECT_CODE.INCORRECT_CHORD, 'Incorrect chord', {
              measureNumber: measureRef,
              truth: example.truth,
              generated: example.generated,
            }),
          )
        }
      }

      if (pair.kind === 'match') {
        const truthMeasure = truthMeasures[pair.truthIndexes[0]]
        const generatedMeasure = generatedMeasures[pair.generatedIndexes[0]]
        if (truthMeasure && generatedMeasure) {
          const lengthDiff = Math.abs(
            (truthMeasure.lengthQuarters ?? 0) - (generatedMeasure.lengthQuarters ?? 0),
          )
          stats.measureStructure.presentInTruth += 1
          stats.measureStructure.compared += 1
          if (lengthDiff <= resolvedOptions.measureLengthToleranceQuarters) {
            stats.measureStructure.truePositives += 1
          } else {
            stats.measureStructure.falseNegatives += 1
            localDefects.push(
              makeDefect(
                SEMANTIC_DEFECT_CODE.INCORRECT_BARLINE,
                `Incorrect barline / measure length (${round(generatedMeasure.lengthQuarters, 2)}q; expected ${round(truthMeasure.lengthQuarters, 2)}q)`,
                { measureNumber: measureRef },
              ),
            )
          }
        }
      }

      defects.push(...localDefects)
      measureReports.push(makeMeasureReport(measureRef, truthNums, genNums, pair, localDefects))
    }

    compareInterpretation(
      alignment,
      truthMeasures,
      generatedMeasures,
      groundTruthMusicXml,
      generatedMusicXml,
      groundTruthTimingMap,
      generatedTimingMap,
      stats,
      defects,
      resolvedOptions,
    )
  } else {
    stats.interpretation.ignored += 1
    stats.measureStructure.ignored += 1
    stats.pitch.ignored += 1
    stats.rhythm.ignored += 1
    stats.sustain.ignored += 1
    stats.articulation.ignored += 1
  }

  if (runPerformed) {
    comparePerformed(
      groundTruthTimingMap,
      generatedTimingMap,
      stats,
      defects,
      resolvedOptions,
    )
  } else {
    stats.playback.ignored += 1
  }

  // Attach score-level interpretation/playback defects onto measure reports when possible
  for (const defect of defects) {
    if (defect.measureNumber == null) {
      continue
    }
    let report = measureReports.find((entry) => entry.measureNumber === defect.measureNumber)
    if (!report) {
      report = makeMeasureReport(defect.measureNumber, [defect.measureNumber], [], {
        kind: 'match',
        cost: 0,
      }, [])
      measureReports.push(report)
    }
    if (!report.defects.some((entry) => entry.code === defect.code && entry.message === defect.message)) {
      report.defects.push(compactDefect(defect))
      report.summary.push(defect.message)
      report.severity = scoreSeverity(report.defects)
    }
  }

  const classes = Object.fromEntries(
    CLASS_KEYS.map((key) => [key, finalizeClassStats(stats[key], resolvedOptions)]),
  )
  const scores = Object.fromEntries(CLASS_KEYS.map((key) => [key, classes[key].score]))
  const scorePercents = Object.fromEntries(
    CLASS_KEYS.map((key) => [key, classes[key].displayPercent]),
  )
  const reliableClasses = CLASS_KEYS.filter((key) => classes[key].reliable)
  const overall =
    reliableClasses.length > 0
      ? round(
          reliableClasses.reduce((sum, key) => sum + classes[key].score, 0) /
            reliableClasses.length,
          4,
        )
      : 0

  const defectMeasures = measureReports.filter(
    (entry) => entry.unmatched || entry.defects.length > 0,
  )
  const worstMeasures = [...defectMeasures]
    .sort(
      (left, right) =>
        right.severity - left.severity ||
        (left.measureNumber ?? 0) - (right.measureNumber ?? 0),
    )
    .slice(0, resolvedOptions.worstMeasureLimit)
  const firstDivergence = defectMeasures[0] ?? null

  return {
    schemaVersion: SEMANTIC_EVAL_SCHEMA_VERSION,
    evaluatorVersion: SEMANTIC_EVALUATOR_VERSION,
    kind: 'semantic-musicxml-evaluation',
    mode,
    gitCommit: meta.gitCommit ?? null,
    scores,
    scorePercents,
    classes,
    overall,
    overallPercent: pct(overall),
    labels: Object.fromEntries(
      CLASS_KEYS.map((key) => [
        key,
        OMR_SEMANTIC_DEFECT_LABEL[
          {
            pitch: OMR_SEMANTIC_DEFECT_CLASS.PITCH,
            rhythm: OMR_SEMANTIC_DEFECT_CLASS.RHYTHM,
            sustain: OMR_SEMANTIC_DEFECT_CLASS.SUSTAIN,
            articulation: OMR_SEMANTIC_DEFECT_CLASS.ARTICULATION,
            measureStructure: OMR_SEMANTIC_DEFECT_CLASS.MEASURE_STRUCTURE,
            interpretation: OMR_SEMANTIC_DEFECT_CLASS.INTERPRETATION,
            playback: OMR_SEMANTIC_DEFECT_CLASS.PLAYBACK,
          }[key]
        ],
      ]),
    ),
    alignment: {
      confidence: alignment.confidence,
      matchedCount: alignment.matchedCount,
      unmatchedTruthCount: alignment.unmatchedTruthCount,
      unmatchedGeneratedCount: alignment.unmatchedGeneratedCount,
      totalCost: alignment.totalCost,
      pairs: alignment.pairs.map((pair) => ({
        kind: pair.kind,
        truthMeasureNumbers: pair.truthMeasureNumbers,
        generatedMeasureNumbers: pair.generatedMeasureNumbers,
        cost: round(pair.cost, 4),
      })),
    },
    measures: defectMeasures,
    worstMeasures,
    firstDivergence: firstDivergence
      ? {
          measureNumber: firstDivergence.measureNumber,
          truthMeasureNumbers: firstDivergence.truthMeasureNumbers,
          generatedMeasureNumbers: firstDivergence.generatedMeasureNumbers,
          alignment: firstDivergence.alignment,
          unmatched: firstDivergence.unmatched,
          defectCount: firstDivergence.defects.length,
        }
      : null,
    topDefects: summarizeTopDefects(defects, resolvedOptions.topDefectLimit),
    topDefectClasses: summarizeTopClasses(defects),
    totals: {
      truthNoteCount: truthNotes.filter((n) => !n.isRest).length,
      generatedNoteCount: generatedNotes.filter((n) => !n.isRest).length,
      truthRestCount: truthNotes.filter((n) => n.isRest).length,
      generatedRestCount: generatedNotes.filter((n) => n.isRest).length,
      truthMeasureCount: truthMeasures.length,
      generatedMeasureCount: generatedMeasures.length,
      defectCount: defects.length,
    },
    tolerances: describeSemanticEvalTolerances(resolvedOptions),
    unsupportedFeatures: SEMANTIC_EVAL_UNSUPPORTED,
    playback: {
      truthDurationSeconds: groundTruthTimingMap?.durationSeconds ?? null,
      generatedDurationSeconds: generatedTimingMap?.durationSeconds ?? null,
      truthWrittenDurationSeconds: groundTruthTimingMap?.writtenDurationSeconds ?? null,
      generatedWrittenDurationSeconds: generatedTimingMap?.writtenDurationSeconds ?? null,
    },
    options: resolvedOptions,
  }
}

function makeMeasureReport(measureRef, truthNums, genNums, pair, localDefects) {
  const unmatched = pair.kind === 'missing' || pair.kind === 'extra'
  return {
    measureNumber: measureRef,
    truthMeasureNumbers: truthNums,
    generatedMeasureNumbers: genNums,
    alignment: pair.kind,
    unmatched,
    alignmentCost: round(pair.cost ?? 0, 4),
    defects: localDefects.map(compactDefect),
    summary: localDefects.map((defect) => defect.message),
    severity: scoreSeverity(localDefects),
  }
}

function scoreSeverity(defectList) {
  return defectList.reduce((sum, defect) => sum + (SEVERITY_WEIGHT[defect.class] ?? 1), 0)
}

function compactDefect(defect) {
  return {
    code: defect.code,
    class: defect.class,
    message: defect.message,
    measureNumber: defect.measureNumber ?? null,
  }
}

function summarizeTopDefects(defects, limit) {
  const counts = new Map()
  for (const defect of defects) {
    if (!counts.has(defect.code)) {
      counts.set(defect.code, {
        code: defect.code,
        class: defect.class,
        label: DEFECT_LABEL[defect.code] ?? defect.code,
        count: 0,
      })
    }
    counts.get(defect.code).count += 1
  }
  return [...counts.values()]
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code))
    .slice(0, limit)
}

function summarizeTopClasses(defects) {
  const counts = new Map()
  for (const defect of defects) {
    counts.set(defect.class, (counts.get(defect.class) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([semanticClass, count]) => ({
      class: semanticClass,
      label: OMR_SEMANTIC_DEFECT_LABEL[semanticClass] ?? semanticClass,
      count,
    }))
    .sort((left, right) => right.count - left.count)
}

export function assertSemanticSelfCheck(report) {
  const problems = []
  if (report.totals.defectCount !== 0) {
    problems.push(`expected 0 defects, got ${report.totals.defectCount}`)
  }
  for (const key of CLASS_KEYS) {
    const entry = report.classes[key]
    if (entry.presentInTruth === 0 && entry.denominator === 0) {
      continue
    }
    if (entry.score !== 1) {
      problems.push(`${key} score ${entry.score} (expected 1)`)
    }
    if (entry.presentInTruth > 0 && entry.coverage < 1) {
      problems.push(`${key} coverage ${entry.coverage} (expected 1)`)
    }
  }
  if (
    (report.alignment?.unmatchedTruthCount ?? 0) > 0 ||
    (report.alignment?.unmatchedGeneratedCount ?? 0) > 0
  ) {
    problems.push(`alignment unmatched measures (confidence ${report.alignment.confidence})`)
  }
  return { ok: problems.length === 0, problems }
}

export function formatCompactSummary(report) {
  const parts = CLASS_KEYS.map((key) => {
    const short = {
      pitch: 'P',
      rhythm: 'R',
      sustain: 'S',
      articulation: 'A',
      measureStructure: 'M',
      interpretation: 'I',
      playback: 'Pb',
    }[key]
    return `${short}:${report.classes[key].percent}`
  })
  const first = report.firstDivergence?.measureNumber ?? '-'
  return (
    `semantic ${report.overallPercent} [${parts.join(' ')}] ` +
    `align:${pct(report.alignment?.confidence ?? 0)} ` +
    `defects:${report.totals.defectCount} first:${first}`
  )
}

export function formatSemanticMusicXmlReport(report, { compact = false } = {}) {
  if (compact) {
    return formatCompactSummary(report)
  }
  const lines = []
  lines.push('OMR semantic evaluation')
  lines.push('=======================')
  lines.push(
    `schema v${report.schemaVersion} · evaluator v${report.evaluatorVersion}` +
      (report.gitCommit ? ` · ${report.gitCommit}` : '') +
      ` · mode=${report.mode}`,
  )
  lines.push(
    `Alignment confidence: ${pct(report.alignment?.confidence ?? 0)}` +
      ` (${report.alignment?.matchedCount ?? 0} matched, ` +
      `${report.alignment?.unmatchedTruthCount ?? 0} missing, ` +
      `${report.alignment?.unmatchedGeneratedCount ?? 0} extra)`,
  )
  lines.push('')
  lines.push('Overall semantic score')
  lines.push('')
  for (const [key, label] of [
    ['pitch', 'Pitch'],
    ['rhythm', 'Rhythm'],
    ['sustain', 'Sustain'],
    ['articulation', 'Articulation'],
    ['measureStructure', 'Measure'],
    ['interpretation', 'Interpretation'],
    ['playback', 'Playback'],
  ]) {
    const entry = report.classes[key]
    const dots = '.'.repeat(Math.max(2, 16 - label.length))
    lines.push(
      `${label} ${dots} ${entry.displayPercent}  ` +
        `(${entry.numerator}/${entry.denominator}; cov ${entry.coveragePercent})`,
    )
  }
  lines.push('')
  lines.push(`Overall ${'.'.repeat(10)} ${report.overallPercent}`)
  if (report.firstDivergence) {
    lines.push(
      `First divergence: measure ${report.firstDivergence.measureNumber}` +
        (report.firstDivergence.unmatched ? ' (unmatched)' : ''),
    )
  }
  lines.push('')

  if (report.worstMeasures?.length) {
    lines.push('Worst measures')
    for (const measure of report.worstMeasures.slice(0, 5)) {
      lines.push(
        `- Measure ${measure.measureNumber} (severity ${measure.severity}` +
          `${measure.unmatched ? ', unmatched' : ''}): ` +
          `${(measure.summary ?? []).slice(0, 3).join('; ')}`,
      )
    }
    lines.push('')
  }

  if (report.measures?.length) {
    lines.push('Per-measure report')
    lines.push('')
    for (const measure of report.measures) {
      const align =
        measure.alignment && measure.alignment !== 'match' ? ` [${measure.alignment}]` : ''
      lines.push(`Measure ${measure.measureNumber}${align}`)
      for (const message of measure.summary ?? []) {
        lines.push(`- ${message}`)
      }
      lines.push('')
    }
  } else {
    lines.push('Per-measure report')
    lines.push('')
    lines.push('(no measure-level defects)')
    lines.push('')
  }

  lines.push('Top recurring defects:')
  if (!report.topDefects?.length) {
    lines.push('(none)')
  } else {
    report.topDefects.forEach((entry, index) => {
      lines.push(`${index + 1}. ${entry.label} (${entry.count})`)
    })
  }
  if (report.topDefectClasses?.length) {
    lines.push('')
    lines.push(
      `Top defect classes: ${report.topDefectClasses
        .map((entry) => `${entry.label} (${entry.count})`)
        .join(', ')}`,
    )
  }
  lines.push('')
  lines.push(
    `Totals: ${report.totals.defectCount} defects · ` +
      `${report.totals.truthNoteCount} truth notes · ` +
      `${report.totals.generatedNoteCount} generated notes · ` +
      `${report.totals.truthMeasureCount}→${report.totals.generatedMeasureCount} measures`,
  )
  return lines.join('\n')
}
