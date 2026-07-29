/**
 * User-facing problem categories for recognition reports.
 * Labels avoid internal OMR jargon.
 */

export const RECOGNITION_PROBLEM_CATEGORIES = Object.freeze([
  { id: 'wrong-notes', label: 'Wrong notes' },
  { id: 'wrong-rhythm', label: 'Wrong rhythm or note values' },
  { id: 'missing-notes', label: 'Missing notes' },
  { id: 'extra-notes', label: 'Extra notes' },
  { id: 'chords-voices', label: 'Chords or voices' },
  { id: 'rests', label: 'Rests' },
  { id: 'ties-slurs', label: 'Ties or slurs' },
  { id: 'accidentals-key', label: 'Accidentals or key signature' },
  { id: 'articulations', label: 'Articulations' },
  { id: 'tempo-repeats', label: 'Tempo or repeats' },
  { id: 'guitar-tab', label: 'Guitar or TAB' },
  { id: 'playback-lag', label: 'Playback lag or choppiness' },
  { id: 'failed-to-generate', label: 'Score failed to generate' },
  { id: 'other', label: 'Other' },
])

export const RECOGNITION_PROBLEM_CATEGORY_IDS = Object.freeze(
  RECOGNITION_PROBLEM_CATEGORIES.map((entry) => entry.id),
)

export function isRecognitionProblemCategory(value) {
  return RECOGNITION_PROBLEM_CATEGORY_IDS.includes(value)
}

export function labelForRecognitionProblemCategory(id) {
  return RECOGNITION_PROBLEM_CATEGORIES.find((entry) => entry.id === id)?.label ?? 'Other'
}
