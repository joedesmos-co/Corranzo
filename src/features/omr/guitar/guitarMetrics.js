/**
 * Guitar Vision — strict per-object scoring.
 *
 * Two stages:
 *
 *   1. Identity. Truth note objects and generated note objects are paired by
 *      optimal assignment within a measure window, minimising total cost over
 *      onset, duration and pitch together. Only after this does any attribute
 *      score get awarded, so a correct pitch cannot be credited to a note that
 *      is at the wrong time or the wrong pitch.
 *
 *   2. Attributes. Each attribute in {@link NOTE_ATTRIBUTES} is scored over the
 *      matched pairs only, with unmatched truth objects counted as misses and
 *      unmatched generated objects as false positives. Marking families are
 *      scored the same way, as anchored set comparisons.
 *
 * The report always includes detection precision/recall and a score-level
 * verdict, so a system cannot post a high attribute accuracy while having
 * invented or lost half the notes.
 */

import { assignOptimal } from './assignment.js'
import {
  MARKING_FAMILIES,
  extractMarkingObjects,
  extractNoteObjects,
  tabConsistencyOf,
} from './guitarObjects.js'

const DEFAULT_MATCH_OPTIONS = {
  /** Maximum onset gap, in quarter notes, for two objects to be considered. */
  onsetWindowQuarters: 0.51,
  /** Maximum pitch gap, in semitones, for two objects to be considered. */
  pitchWindowSemitones: 12,
  /** Maximum duration gap, in quarter notes, before a pair is rejected. */
  durationWindowQuarters: 0.51,
  /** Relative weights used to build the assignment cost. */
  weights: { onset: 3, pitch: 1, duration: 2, rest: 2 },
  tuning: undefined,
  capoFret: 0,
}

function round(value, places = 4) {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function ratio(numerator, denominator, emptyValue = null) {
  if (!denominator) return emptyValue
  return round(numerator / denominator, 4)
}

/**
 * Assignment cost for one truth/generated pair, or Infinity when the pair
 * cannot be the same musical object.
 *
 * The cost deliberately encodes *all three* of onset, duration and pitch. A
 * cost that used only onset would happily pair a note with a wrong-pitch note
 * and then report the pitch error as a recognition failure when the real cause
 * was a misread staff position; using all three lets the assignment find the
 * pairing that is globally most consistent and leaves genuine errors visible.
 */
export function pairCost(truth, generated, options = DEFAULT_MATCH_OPTIONS) {
  const weights = { ...DEFAULT_MATCH_OPTIONS.weights, ...(options.weights ?? {}) }

  if (truth.isRest !== generated.isRest) {
    // A rest never pairs with a pitched note no matter how well the timing fits.
    return Number.POSITIVE_INFINITY
  }

  if (truth.isRest && generated.isRest) {
    return 0
  }

  const onsetGap = Math.abs((generated.positionInMeasure ?? 0) - (truth.positionInMeasure ?? 0))
  if (onsetGap > options.onsetWindowQuarters) return Number.POSITIVE_INFINITY

  const truthDuration = truth.durationQuarters ?? 0
  const generatedDuration = generated.durationQuarters ?? 0
  const durationGap = Math.abs(generatedDuration - truthDuration)
  if (durationGap > options.durationWindowQuarters) return Number.POSITIVE_INFINITY

  const pitchGap =
    Number.isFinite(truth.soundingMidi) && Number.isFinite(generated.soundingMidi)
      ? Math.abs(generated.soundingMidi - truth.soundingMidi)
      : 0
  if (pitchGap > options.pitchWindowSemitones) return Number.POSITIVE_INFINITY

  // Staff/voice are categorical: pairing across a staff or voice boundary is a
  // different object, not a cheaper version of the same one.
  if (truth.staff != null && generated.staff != null && truth.staff !== generated.staff) {
    return Number.POSITIVE_INFINITY
  }

  return weights.onset * onsetGap + weights.pitch * pitchGap + weights.duration * durationGap
}

/**
 * Pair truth and generated note objects.
 *
 * Matching runs per (part, measure) so onset positions are directly comparable
 * and the cost matrix stays small.
 */
/**
 * Group objects into matching buckets.
 *
 * Truth and generated scores do not agree on part identifiers: a score imported
 * from an archive carries a content hash (`P5cabd08…`) while our emitter always
 * writes `P1`. Matching on the raw id therefore pairs nothing at all and reports
 * 100% recall on an empty set, which is exactly the kind of silently-wrong
 * number this module exists to eliminate. Parts are paired by ordinal position
 * instead, which is the only identifier the two sides actually share.
 */
function bucketKey(object, partOrdinal) {
  return `${partOrdinal.get(object.partId) ?? 0}:${object.measureNumber}`
}

function partOrdinals(objects) {
  const ordinal = new Map()
  for (const object of objects) {
    if (!ordinal.has(object.partId)) {
      ordinal.set(object.partId, ordinal.size)
    }
  }
  return ordinal
}

export function matchNoteObjects(truthObjects, generatedObjects, options = {}) {
  const settings = { ...DEFAULT_MATCH_OPTIONS, ...options }
  const truthParts = partOrdinals(truthObjects)
  const generatedParts = partOrdinals(generatedObjects)
  const truthByMeasure = groupBy(truthObjects, (object) => bucketKey(object, truthParts))
  const generatedByMeasure = groupBy(
    generatedObjects,
    (object) => bucketKey(object, generatedParts),
  )

  const matches = []
  const missed = []
  const falsePositives = []
  const keys = new Set([...truthByMeasure.keys(), ...generatedByMeasure.keys()])

  for (const key of keys) {
    const truthList = truthByMeasure.get(key) ?? []
    const generatedList = generatedByMeasure.get(key) ?? []
    if (truthList.length === 0) {
      falsePositives.push(...generatedList)
      continue
    }
    if (generatedList.length === 0) {
      missed.push(...truthList)
      continue
    }

    const cost = truthList.map((truth) =>
      generatedList.map((generated) => pairCost(truth, generated, settings)),
    )
    const assignment = assignOptimal(cost)

    const takenGenerated = new Set()
    truthList.forEach((truth, row) => {
      const column = assignment[row]
      if (column < 0) {
        missed.push(truth)
        return
      }
      const generated = generatedList[column]
      if (takenGenerated.has(column)) {
        // Defensive: optimal assignment is injective, so this cannot happen.
        missed.push(truth)
        return
      }
      takenGenerated.add(column)
      matches.push({ truth, generated, cost: cost[row][column] })
    })
    generatedList.forEach((generated, column) => {
      if (!takenGenerated.has(column)) falsePositives.push(generated)
    })
  }

  return { matches, missed, falsePositives }
}

function groupBy(items, keyOf) {
  const map = new Map()
  for (const item of items) {
    const key = keyOf(item)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(item)
  }
  return map
}

/**
 * Score one attribute over matched pairs.
 *
 * An attribute with nothing to compare reports `accuracy: null`, never 1.
 * Defaulting an empty comparison to a perfect score is how a completely failed
 * match can appear as a clean sweep.
 *
 * `whenPresent` additionally restricts the comparison to pairs where the truth
 * value is non-default. It is what keeps a sparse attribute honest: almost every
 * note has zero augmentation dots, so unconditional dot accuracy reads ~100%
 * even when the recogniser never finds a single dot. The conditional figure
 * answers the question that actually matters — when the score *has* dots, does
 * the engine find them?
 */
function scoreAttribute(matches, read, { whenPresent = null } = {}) {
  let correct = 0
  let comparable = 0
  let conditionalCorrect = 0
  let conditionalComparable = 0
  const errors = []
  for (const match of matches) {
    const truthValue = read(match.truth)
    const generatedValue = read(match.generated)
    if (truthValue == null && generatedValue == null) continue
    comparable += 1
    const same = valuesEqual(truthValue, generatedValue)
    if (same) correct += 1
    else if (errors.length < 25) {
      errors.push({ truth: truthValue, generated: generatedValue })
    }
    if (whenPresent && whenPresent(truthValue)) {
      conditionalComparable += 1
      if (same) conditionalCorrect += 1
    }
  }
  return {
    correct,
    comparable,
    accuracy: ratio(correct, comparable),
    conditionalCorrect,
    conditionalComparable,
    conditionalAccuracy: ratio(conditionalCorrect, conditionalComparable),
    errors,
  }
}

function valuesEqual(left, right) {
  if (left == null && right == null) return true
  if (left == null || right == null) return false
  return left === right
}

/**
 * Families the MusicXML parser populates today.
 *
 * A family that neither side reports is not the same as a family the engine got
 * wrong: if the parser cannot extract dynamics at all, reporting "recall 0"
 * would blame the recogniser for a data-layer gap. Families outside this set are
 * reported as unsupported rather than as failures, so a missing capability is
 * always visible and never silently scored as a defect.
 */
export const EXTRACTABLE_FAMILIES = new Set([
  'tie',
  'slur',
  'staccato',
  'accent',
  'tenuto',
  'marcato',
  'fermata',
  'hairpin',
  'tempoMarking',
  'chordSymbol',
  'graceNote',
  'hammer-on',
  'pull-off',
  'slide',
  'bend',
  'fingering',
  'fret-position',
])

/** Marking families the current parser can actually score. */
export function scoreableMarkingFamilies() {
  return MARKING_FAMILIES.filter((family) => EXTRACTABLE_FAMILIES.has(family))
}

/**
 * Marking families are compared as anchored sets: a marking matches only the
 * same family in the same measure at a nearby position with the same payload.
 */
export function scoreMarkingFamilies(truthMarkings, generatedMarkings, { positionTolerance = 0.26 } = {}) {
  const results = {}
  const truthByFamily = groupBy(truthMarkings, (marking) => marking.family)
  const generatedByFamily = groupBy(generatedMarkings, (marking) => marking.family)

  for (const family of MARKING_FAMILIES) {
    const truthList = truthByFamily.get(family) ?? []
    const generatedList = generatedByFamily.get(family) ?? []
    if (truthList.length === 0 && generatedList.length === 0) {
      results[family] = {
        truth: 0,
        generated: 0,
        matched: 0,
        precision: null,
        recall: null,
        // `scoreable` distinguishes "the parser cannot extract this family"
        // from "the corpus contains none of it". Both are unsupported, but only
        // one of them is a data-layer gap that blocks a metric.
        scoreable: EXTRACTABLE_FAMILIES.has(family),
        supported: false,
      }
      continue
    }

    let matched = 0
    const usedGenerated = new Set()
    for (const truth of truthList) {
      let bestIndex = -1
      let bestGap = Infinity
      generatedList.forEach((generated, index) => {
        if (usedGenerated.has(index)) return
        if (generated.measureNumber !== truth.measureNumber) return
        const gap = Math.abs(
          (generated.positionInMeasure ?? 0) - (truth.positionInMeasure ?? 0),
        )
        if (gap > positionTolerance || gap >= bestGap) return
        if (!payloadEqual(truth.payload, generated.payload)) return
        bestGap = gap
        bestIndex = index
      })
      if (bestIndex >= 0) {
        usedGenerated.add(bestIndex)
        matched += 1
      }
    }

    results[family] = {
      truth: truthList.length,
      generated: generatedList.length,
      matched,
      precision: generatedList.length ? round(matched / generatedList.length, 4) : truthList.length ? 0 : null,
      recall: truthList.length ? round(matched / truthList.length, 4) : generatedList.length ? 0 : null,
      scoreable: EXTRACTABLE_FAMILIES.has(family),
      supported: truthList.length > 0,
    }
  }
  return results
}

function payloadEqual(left, right) {
  const a = left ?? {}
  const b = right ?? {}
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const leftValue = a[key] == null ? null : String(a[key])
    const rightValue = b[key] == null ? null : String(b[key])
    if (leftValue !== rightValue) return false
  }
  return true
}

/**
 * Full strict report for one score pair.
 *
 * `detection` is reported first and prominently because it gates everything
 * else: attribute accuracies computed over a badly-detected score describe a
 * small surviving subset, not the score as a whole.
 *
 * Accepts either raw MusicXML plus a `parse` function, or pre-extracted object
 * lists (`truthNotes` / `generatedNotes`) so a batch run can parse each score
 * once.
 */
export function evaluateGuitarScore({
  generatedXml,
  truthXml,
  parse,
  truthNotes: providedTruthNotes,
  generatedNotes: providedGeneratedNotes,
  truthMarkings,
  generatedMarkings,
  matchOptions = {},
  tabOptions = {},
}) {
  const truthParsed =
    providedTruthNotes == null
      ? requireParse(parse, truthXml, 'truth.musicxml')
      : null
  const generatedParsed =
    providedGeneratedNotes == null
      ? requireParse(parse, generatedXml, 'generated.musicxml')
      : null

  const truthNotes = providedTruthNotes ?? extractNoteObjects(truthParsed)
  const generatedNotes = providedGeneratedNotes ?? extractNoteObjects(generatedParsed)
  const { matches, missed, falsePositives } = matchNoteObjects(truthNotes, generatedNotes, matchOptions)

  const attributes = {
    noteVsRest: scoreAttribute(matches, (object) => (object.isRest ? 'rest' : 'note')),
    soundingPitch: scoreAttribute(matches, (object) => object.soundingMidi),
    writtenPitch: scoreAttribute(matches, (object) => object.writtenPitch),
    onset: scoreAttribute(
      matches,
      (object) => (object.isRest ? null : round(object.positionInMeasure, 3)),
    ),
    duration: scoreAttribute(
      matches,
      (object) => (object.isRest ? null : round(object.durationQuarters ?? 0, 3)),
    ),
    dots: scoreAttribute(matches, (object) => object.dots, {
      whenPresent: (value) => Number(value) > 0,
    }),
    tuplet: scoreAttribute(matches, (object) => object.tuplet, {
      whenPresent: (value) => value != null,
    }),
    string: scoreAttribute(matches, (object) => object.string),
    fret: scoreAttribute(matches, (object) => object.fret),
    voice: scoreAttribute(matches, (object) => object.voice),
    staff: scoreAttribute(matches, (object) => object.staff),
    accidentals: scoreAttribute(matches, (object) => object.accidental, {
      whenPresent: (value) => value != null,
    }),
  }

  const marks = truthMarkings ?? extractMarkingObjects(truthParsed ?? { notes: [] })
  const generatedMarks = generatedMarkings ?? extractMarkingObjects(generatedParsed ?? { notes: [] })
  const markings = scoreMarkingFamilies(marks, generatedMarks)

  const detected = matches.length
  const truthCount = truthNotes.length
  const generatedCount = generatedNotes.length
  const truePositive = detected
  const falseNegative = missed.length
  const falsePositive = falsePositives.length

  const detection = {
    truthNoteCount: truthCount,
    generatedNoteCount: generatedCount,
    matched: truePositive,
    missed: falseNegative,
    falsePositive,
    // An empty truth is a degenerate input, not a perfect result.
    precision: ratio(truePositive, truePositive + falsePositive, 0),
    recall: ratio(truePositive, truePositive + falseNegative, 0),
    f1: ratio(2 * truePositive, 2 * truePositive + falsePositive + falseNegative, 0),
  }

  // Staff/TAB physical consistency, reported for whichever side supplies
  // string/fret and compared against physical truth.
  const consistency = {
    truthConsistent: countConsistent(truthNotes, tabOptions),
    truthCheckable: countCheckable(truthNotes, tabOptions),
    generatedConsistent: countConsistent(generatedNotes, tabOptions),
    generatedCheckable: countCheckable(generatedNotes, tabOptions),
  }
  consistency.truthRate = ratio(consistency.truthConsistent, consistency.truthCheckable, null)
  consistency.generatedRate = ratio(consistency.generatedConsistent, consistency.generatedCheckable, null)

  return {
    version: 1,
    detection,
    attributes,
    markings,
    tabConsistency: consistency,
    /**
     * Families that exist in the notation model but that the current parser
     * cannot extract. Reported so a missing capability is never mistaken for a
     * recognition failure, and so the list shrinks as the data engine grows.
     */
    unscoreableFamilies: MARKING_FAMILIES.filter((family) => !EXTRACTABLE_FAMILIES.has(family)),
    /**
     * The single number a product decision should rest on: how much of the
     * score is simultaneously present, correctly identified, and correct.
     */
    endToEndNoteAccuracy: ratio(truePositive * (attributes.soundingPitch.accuracy ?? 0), truthCount, 0),
  }
}

function countCheckable(objects, tabOptions) {
  return objects.filter((object) => tabConsistencyOf(object, tabOptions) != null).length
}

function countConsistent(objects, tabOptions) {
  let count = 0
  for (const object of objects) {
    const result = tabConsistencyOf(object, tabOptions)
    if (result?.consistent) count += 1
  }
  return count
}

function requireParse(parse, xml, fileName) {
  if (typeof parse !== 'function') {
    throw new TypeError(
      `evaluateGuitarScore needs a \`parse(xml, fileName)\` function to read ${fileName}`,
    )
  }
  return parse(xml, fileName)
}
