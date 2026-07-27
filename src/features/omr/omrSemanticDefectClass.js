/**
 * Semantic OMR defect taxonomy for validation and prioritization.
 *
 * Perceived playback quality is often limited by musical semantics even when
 * pitches are correct. Classify defects into these classes before choosing the
 * next recognition investigation.
 *
 * Priority (real-score playback impact when pitch is frequently correct):
 *   1. rhythm
 *   2. sustain (ties)
 *   3. articulation
 *   4. measure-structure
 *   5. playback
 *   6. pitch (still tracked; often not the dominant perceived failure)
 */

export const OMR_SEMANTIC_DEFECT_CLASS = Object.freeze({
  PITCH: 'pitch',
  RHYTHM: 'rhythm',
  SUSTAIN: 'sustain',
  ARTICULATION: 'articulation',
  MEASURE_STRUCTURE: 'measure-structure',
  INTERPRETATION: 'interpretation',
  PLAYBACK: 'playback',
})

/** Human-facing labels for reports. */
export const OMR_SEMANTIC_DEFECT_LABEL = Object.freeze({
  [OMR_SEMANTIC_DEFECT_CLASS.PITCH]: 'Pitch',
  [OMR_SEMANTIC_DEFECT_CLASS.RHYTHM]: 'Rhythm',
  [OMR_SEMANTIC_DEFECT_CLASS.SUSTAIN]: 'Sustain (ties)',
  [OMR_SEMANTIC_DEFECT_CLASS.ARTICULATION]: 'Articulation',
  [OMR_SEMANTIC_DEFECT_CLASS.MEASURE_STRUCTURE]: 'Measure structure',
  [OMR_SEMANTIC_DEFECT_CLASS.INTERPRETATION]: 'Interpretation',
  [OMR_SEMANTIC_DEFECT_CLASS.PLAYBACK]: 'Playback',
})

/**
 * Investigation priority when pitches are largely correct but playback sounds wrong.
 * Lower number = investigate first.
 */
export const OMR_SEMANTIC_DEFECT_PRIORITY = Object.freeze({
  [OMR_SEMANTIC_DEFECT_CLASS.RHYTHM]: 1,
  [OMR_SEMANTIC_DEFECT_CLASS.SUSTAIN]: 2,
  [OMR_SEMANTIC_DEFECT_CLASS.ARTICULATION]: 3,
  [OMR_SEMANTIC_DEFECT_CLASS.MEASURE_STRUCTURE]: 4,
  [OMR_SEMANTIC_DEFECT_CLASS.INTERPRETATION]: 5,
  [OMR_SEMANTIC_DEFECT_CLASS.PLAYBACK]: 6,
  [OMR_SEMANTIC_DEFECT_CLASS.PITCH]: 7,
})

export const OMR_SEMANTIC_DEFECT_CLASS_ORDER = Object.freeze([
  OMR_SEMANTIC_DEFECT_CLASS.RHYTHM,
  OMR_SEMANTIC_DEFECT_CLASS.SUSTAIN,
  OMR_SEMANTIC_DEFECT_CLASS.ARTICULATION,
  OMR_SEMANTIC_DEFECT_CLASS.MEASURE_STRUCTURE,
  OMR_SEMANTIC_DEFECT_CLASS.INTERPRETATION,
  OMR_SEMANTIC_DEFECT_CLASS.PLAYBACK,
  OMR_SEMANTIC_DEFECT_CLASS.PITCH,
])

/**
 * Map fine-grained named error buckets → semantic class.
 * Keeps existing bucket vocabulary; this is a roll-up layer.
 */
export const NAMED_BUCKET_TO_SEMANTIC_CLASS = Object.freeze({
  pitch: OMR_SEMANTIC_DEFECT_CLASS.PITCH,
  accidentals: OMR_SEMANTIC_DEFECT_CLASS.PITCH,
  duration: OMR_SEMANTIC_DEFECT_CLASS.RHYTHM,
  onset: OMR_SEMANTIC_DEFECT_CLASS.RHYTHM,
  tuplets: OMR_SEMANTIC_DEFECT_CLASS.RHYTHM,
  rests: OMR_SEMANTIC_DEFECT_CLASS.RHYTHM,
  ties: OMR_SEMANTIC_DEFECT_CLASS.SUSTAIN,
  // Slurs are articulation/phrase marks, not sustain — keep them out of ties.
  slurs: OMR_SEMANTIC_DEFECT_CLASS.ARTICULATION,
  chord: OMR_SEMANTIC_DEFECT_CLASS.MEASURE_STRUCTURE,
  'extra/missing-notes': OMR_SEMANTIC_DEFECT_CLASS.MEASURE_STRUCTURE,
})

/**
 * Duration-error subcategories → semantic class.
 * Tie-sustain duration wrongs are sustain, not generic rhythm.
 */
export const DURATION_CATEGORY_TO_SEMANTIC_CLASS = Object.freeze({
  'too-short': OMR_SEMANTIC_DEFECT_CLASS.RHYTHM,
  'too-long': OMR_SEMANTIC_DEFECT_CLASS.RHYTHM,
  'beamed-subdivision': OMR_SEMANTIC_DEFECT_CLASS.RHYTHM,
  'bass-sustain': OMR_SEMANTIC_DEFECT_CLASS.SUSTAIN,
  'melody-accompaniment': OMR_SEMANTIC_DEFECT_CLASS.RHYTHM,
  'rest-gap': OMR_SEMANTIC_DEFECT_CLASS.RHYTHM,
  'tie-sustain': OMR_SEMANTIC_DEFECT_CLASS.SUSTAIN,
  'onset-coupled': OMR_SEMANTIC_DEFECT_CLASS.RHYTHM,
  other: OMR_SEMANTIC_DEFECT_CLASS.RHYTHM,
})

/** Sub-topics under each class for triage notes / sprint planning. */
export const OMR_SEMANTIC_DEFECT_FOCUS = Object.freeze({
  [OMR_SEMANTIC_DEFECT_CLASS.RHYTHM]: [
    'note-duration-types',
    'dotted-values',
    'multi-voice-duration-consistency',
    'rest-duration',
    'rest-placement',
    'measure-balancing',
    'onset-alignment',
    'tuplets',
  ],
  [OMR_SEMANTIC_DEFECT_CLASS.SUSTAIN]: [
    'tie-detection',
    'cross-measure-sustain',
    'tie-vs-slur-discrimination',
  ],
  [OMR_SEMANTIC_DEFECT_CLASS.ARTICULATION]: [
    'staccato',
    'accent',
    'tenuto',
    'marcato',
  ],
  [OMR_SEMANTIC_DEFECT_CLASS.MEASURE_STRUCTURE]: [
    'barlines',
    'measure-count',
    'voice-lanes',
    'chord-grouping',
    'extra-missing-notes',
  ],
  [OMR_SEMANTIC_DEFECT_CLASS.PLAYBACK]: [
    'engine-timeline',
    'written-vs-sounding-duration',
    'expression-mapping',
  ],
  [OMR_SEMANTIC_DEFECT_CLASS.PITCH]: [
    'staff-position',
    'accidentals',
    'octave',
    'key-signature',
  ],
})

function toCount(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function round(value, places = 4) {
  if (!Number.isFinite(value)) {
    return null
  }
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

export function resolveSemanticDefectClass(token) {
  if (!token || typeof token !== 'string') {
    return null
  }
  if (Object.values(OMR_SEMANTIC_DEFECT_CLASS).includes(token)) {
    return token
  }
  if (NAMED_BUCKET_TO_SEMANTIC_CLASS[token]) {
    return NAMED_BUCKET_TO_SEMANTIC_CLASS[token]
  }
  if (DURATION_CATEGORY_TO_SEMANTIC_CLASS[token]) {
    return DURATION_CATEGORY_TO_SEMANTIC_CLASS[token]
  }
  return null
}

/**
 * Roll named-bucket counts into semantic classes.
 * Optional articulationGap / playbackGap can be supplied when diagnostics exist.
 */
export function summarizeSemanticDefectClasses({
  namedBuckets = null,
  durationErrorHistogram = null,
  articulationGap = 0,
  playbackGap = 0,
} = {}) {
  const classes = Object.fromEntries(
    OMR_SEMANTIC_DEFECT_CLASS_ORDER.map((semanticClass) => [semanticClass, 0]),
  )

  const buckets = namedBuckets?.buckets ?? namedBuckets ?? {}
  for (const [bucket, count] of Object.entries(buckets)) {
    const semanticClass = NAMED_BUCKET_TO_SEMANTIC_CLASS[bucket]
    if (semanticClass) {
      classes[semanticClass] += toCount(count)
    }
  }

  // Duration histogram can re-attribute tie-sustain / bass-sustain into Sustain.
  if (durationErrorHistogram && typeof durationErrorHistogram === 'object') {
    const durationBucketCount = toCount(buckets.duration)
    if (durationBucketCount > 0) {
      let sustainFromDuration = 0
      for (const [category, count] of Object.entries(durationErrorHistogram)) {
        if (DURATION_CATEGORY_TO_SEMANTIC_CLASS[category] === OMR_SEMANTIC_DEFECT_CLASS.SUSTAIN) {
          sustainFromDuration += toCount(count)
        }
      }
      const move = Math.min(durationBucketCount, sustainFromDuration)
      if (move > 0) {
        classes[OMR_SEMANTIC_DEFECT_CLASS.RHYTHM] = Math.max(
          0,
          classes[OMR_SEMANTIC_DEFECT_CLASS.RHYTHM] - move,
        )
        classes[OMR_SEMANTIC_DEFECT_CLASS.SUSTAIN] += move
      }
    }
  }

  classes[OMR_SEMANTIC_DEFECT_CLASS.ARTICULATION] += toCount(articulationGap)
  classes[OMR_SEMANTIC_DEFECT_CLASS.PLAYBACK] += toCount(playbackGap)

  const total = Object.values(classes).reduce((sum, count) => sum + count, 0)
  const ranked = OMR_SEMANTIC_DEFECT_CLASS_ORDER.map((semanticClass) => ({
    class: semanticClass,
    label: OMR_SEMANTIC_DEFECT_LABEL[semanticClass],
    priority: OMR_SEMANTIC_DEFECT_PRIORITY[semanticClass],
    count: classes[semanticClass],
    share: total > 0 ? round(classes[semanticClass] / total) : null,
    focus: OMR_SEMANTIC_DEFECT_FOCUS[semanticClass],
  }))
    .filter((entry) => entry.count > 0)
    .sort(
      (left, right) =>
        right.count - left.count || left.priority - right.priority || left.class.localeCompare(right.class),
    )

  // Priority-ordered view for "what to work on next" when counts are close.
  const byPriority = [...OMR_SEMANTIC_DEFECT_CLASS_ORDER]
    .map((semanticClass) => ({
      class: semanticClass,
      label: OMR_SEMANTIC_DEFECT_LABEL[semanticClass],
      priority: OMR_SEMANTIC_DEFECT_PRIORITY[semanticClass],
      count: classes[semanticClass],
      focus: OMR_SEMANTIC_DEFECT_FOCUS[semanticClass],
    }))
    .filter((entry) => entry.count > 0)

  return {
    classes,
    total,
    ranked,
    byPriority,
    largestClass: ranked[0]
      ? {
          class: ranked[0].class,
          label: ranked[0].label,
          count: ranked[0].count,
          share: ranked[0].share,
          priority: ranked[0].priority,
        }
      : null,
    priorityGuidance:
      'When pitches are mostly correct, prioritize rhythm → sustain (ties) → articulation before pitch work.',
  }
}

/**
 * Build articulation gap from generated OMR diagnostics (staccato/accent today;
 * tenuto/marcato reserved when diagnostics appear).
 */
export function articulationGapFromDiagnostics(diagnostics = {}) {
  const safe = diagnostics ?? {}
  const staccato = safe.staccato ?? {}
  const accent = safe.accent ?? {}
  const staccatoGap = Math.max(
    0,
    toCount(staccato.detectedStaccatoCount) - toCount(staccato.appliedStaccatoCount),
  )
  const accentGap = Math.max(
    0,
    toCount(accent.detectedAccentCount) - toCount(accent.appliedAccentCount),
  )
  return staccatoGap + accentGap
}
